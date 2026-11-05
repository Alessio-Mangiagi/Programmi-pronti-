// "><(((º> sabusabu <º)))><"
/**
 * MODULO CONTRATTO (.txt) → contratto IMPAGINATO in PDF, nativo e "scansionato".
 *
 * Prova del formato: se i contratti arrivassero già scritti secondo il modulo, il
 * programma li leggerebbe giusti? Il .txt si legge alla lettera per costruzione; un
 * documento vero invece arriva in PDF — stampato dal computer (testo nativo) oppure
 * stampato, firmato e ripassato dallo scanner (solo immagini, tocca all'OCR). Qui ogni
 * modulo diventa entrambe le cose, impaginato come un documento: titolo, sezioni,
 * campi "ETICHETTA: valore" che vanno a capo, elenco prezzi in tabella con le celle
 * separate da "|" come vuole il modulo e l'intestazione ripetuta su ogni pagina.
 *
 *   npm run modulo-in-pdf                       # tutti i *_modulo.txt di contratti/moduli/
 *   npm run modulo-in-pdf -- percorso/x_modulo.txt
 *
 * Esce in contratti/formattati/ (cartella fuori da git, come contratti/):
 *   <nome>_formattato.pdf             PDF col testo (Edge headless, page.pdf)
 *   <nome>_formattato_scansione.pdf   le stesse pagine come immagini (pdf_come_scansione.py)
 * Poi: npm run harness -- --cartella contratti/formattati, e
 *      npm run confronta-moduli -- --variante formattato (o formattato_scansione).
 *
 * Le note "#" del modulo NON vanno nel documento: sono spiegazioni per chi compila, e in
 * un PDF una nota lunga andrebbe a capo perdendo il "#". Il piè di pagina invece è una
 * nota ("# Pagina 1 di 3"): il lettore la salta.
 */
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright-core'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR_MODULI = path.join(ROOT, 'contratti', 'moduli')
const DIR_OUT = path.join(ROOT, 'contratti', 'formattati')
// stesso interprete dell'harness: .venv-gpu se c'è (ha pypdfium2, PIL e numpy)
const PYTHON_BIN = process.env.PYTHON_BIN
  || (existsSync(path.join(ROOT, '.venv-gpu', 'Scripts', 'python.exe'))
    ? path.join(ROOT, '.venv-gpu', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venv', 'Scripts', 'python.exe'))

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const RE_SEZIONE = /^\[\s*(TESTATA|IMPORTI|RIGHE|FINE)\s*\]$/i
const RE_SEP_MD = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/
// colonne numeriche dell'elenco prezzi: allineate a destra e mai a capo
const NUMERICHE = /^(QUANTITA|QTA|PREZZO|IMPORTO)/i

/**
 * Testo del modulo → pagina HTML. Si legge solo la FORMA (sezioni, campi, celle) e si
 * ricopia ogni valore così com'è: la correttezza dei valori la giudica il lettore del
 * programma, non questo strumento.
 */
const moduloInHtml = (txt: string, titolo: string): string => {
  const corpo: string[] = []
  let sezione = ''
  let intestazione: string[] | null = null
  let bordi = false
  const righe: string[][] = []
  const chiudiTabella = () => {
    if (!intestazione) return
    const cella = (v: string, k: number, tag: 'th' | 'td') => {
      const num = NUMERICHE.test(intestazione![k] ?? '')
      // la DESCRIZIONE è l'unica cella che va a capo: tutte le altre su una riga sola, così
      // nel testo estratto la prima riga della voce porta tutte le celle e i "|"
      const cls = /^DESCR/i.test(intestazione![k] ?? '') ? 'descr' : num ? 'num' : 'corta'
      const sep = k < intestazione!.length - 1 ? `<${tag} class="sep">|</${tag}>` : ''
      return `<${tag} class="${cls}">${esc(v)}</${tag}>${sep}`
    }
    corpo.push('<table><thead><tr>' + intestazione.map((v, k) => cella(v, k, 'th')).join('') + '</tr></thead><tbody>'
      + righe.map(r => '<tr>' + intestazione!.map((_, k) => cella(r[k] ?? '', k, 'td')).join('') + '</tr>').join('')
      + '</tbody></table>')
    intestazione = null
  }
  for (const grezza of txt.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const l = grezza.trim()
    if (!l || l.startsWith('#') || l.startsWith('//')) continue
    if (/MODULO\s+CONTRATTO\s+OCR\s+v1/i.test(l)) {
      corpo.push(`<h1>${esc(l)}</h1>`, `<p class="nota"># ${esc(titolo)} — documento impaginato secondo il modulo</p>`)
      continue
    }
    const sez = RE_SEZIONE.exec(l)
    if (sez) {
      chiudiTabella()
      sezione = sez[1].toUpperCase()
      corpo.push(`<h2>${esc(l)}</h2>`)
      continue
    }
    if (sezione === 'RIGHE') {
      if (RE_SEP_MD.test(l)) continue
      if (!intestazione) bordi = l.startsWith('|')
      const c = (bordi ? l.replace(/^\|/, '').replace(/\|\s*$/, '') : l).split('|').map(x => x.trim())
      if (!intestazione) intestazione = c
      else righe.push(c)
      continue
    }
    // [TESTATA] / [IMPORTI]: "ETICHETTA: valore", etichetta in grassetto
    const m = /^([^:|]+?)\s*:\s*(.*)$/.exec(l)
    corpo.push(m
      ? `<p class="campo"><b>${esc(m[1])}:</b> ${esc(m[2])}</p>`
      : `<p class="campo">${esc(l)}</p>`)
  }
  chiudiTabella()
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 16mm 14mm 18mm 14mm; }
    body { font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; color: #000; }
    h1 { font-size: 15pt; margin: 0 0 2mm; }
    h2 { font-size: 11pt; margin: 6mm 0 2mm; break-after: avoid; }
    .nota { color: #555; font-size: 8pt; margin: 0 0 3mm; }
    /* rientro sospeso: il valore che va a capo resta sotto il valore */
    .campo { margin: 0 0 1.2mm; padding-left: 8mm; text-indent: -8mm; break-inside: avoid; }
    table { border-collapse: collapse; width: 100%; font-size: 8.5pt; }
    tr { break-inside: avoid; }
    th, td { vertical-align: top; padding: 1mm 0.8mm; border-bottom: 0.4pt solid #999; text-align: left; }
    th { border-bottom: 0.8pt solid #000; }
    .sep { color: #444; padding: 1mm 0.3mm; }
    .corta, .num { white-space: nowrap; }
    .num { text-align: right; }
  </style></head><body>${corpo.join('\n')}</body></html>`
}

// ── esecuzione ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2)
const files: string[] = []
for (const a of args.length ? args : [DIR_MODULI]) {
  const p = path.resolve(a)
  if (!existsSync(p)) { console.error(`✗ non trovato: ${a}`); continue }
  if (statSync(p).isDirectory()) { for (const n of readdirSync(p).sort()) if (/_modulo\.txt$/i.test(n)) files.push(path.join(p, n)) }
  else files.push(p)
}
mkdirSync(DIR_OUT, { recursive: true })

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage()
for (const f of files) {
  const base = path.basename(f).replace(/_modulo\.txt$/i, '')
  const nativo = path.join(DIR_OUT, `${base}_formattato.pdf`)
  const scansione = path.join(DIR_OUT, `${base}_formattato_scansione.pdf`)
  await page.setContent(moduloInHtml(readFileSync(f, 'utf8'), base), { waitUntil: 'load' })
  await page.pdf({
    path: nativo, format: 'A4', printBackground: true, displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    // piè di pagina = nota "#": il lettore del modulo la salta
    footerTemplate: '<div style="font-size:8px;font-family:Arial;width:100%;text-align:center;color:#555"># Pagina <span class="pageNumber"></span> di <span class="totalPages"></span></div>',
  })
  const r = spawnSync(PYTHON_BIN, [path.join(ROOT, 'tools', 'pdf_come_scansione.py'), nativo, scansione], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  if (r.status !== 0) console.error(`✗ ${base}: scansione non riuscita — ${(r.stderr || '').slice(-300)}`)
  console.log(`✓ ${base}\n    ${path.relative(ROOT, nativo)}\n    ${path.relative(ROOT, scansione)}`)
}
await browser.close()
process.exit(0)
