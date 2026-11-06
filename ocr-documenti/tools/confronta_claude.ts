// "><(((º> sabusabu <º)))><"
/**
 * Confronto SCANSIONE DEL PROGRAMMA ↔ EXCEL PREPARATO DA CLAUDE (modalità Claude).
 *
 * In contratti/scansioni/ ci sono gli Excel Import_Contratti che Claude ha preparato su
 * claude.ai leggendo i PDF di contratti/ (guida 4.3, «Modalità Claude»); l'harness
 * (tools/harness.ts) produce in tests/out/<pdf>/alyante.json quello che il programma
 * estrae da solo, senza AI. Qui si confrontano le celle che finiscono in Alyante:
 * testata colonna per colonna, elenco prezzi voce per voce (tools/confronto-excel.ts,
 * stessa logica di tools/confronta_moduli.ts).
 *
 * L'Excel di Claude NON è la verità: anche Claude sbaglia letture, voci e testata. Dove
 * esiste un modulo contratto scritto a mano (contratti/moduli/, commento in testa
 * `leggendo "<pdf>"`) il confronto è a tre: programma e Claude contro il modulo, così si
 * vede chi dei due ha ragione quando non sono d'accordo.
 *
 *   npm run harness                  # prima: il programma scansiona i PDF di contratti/
 *   npm run confronta-claude         # tutti gli Excel di contratti/scansioni/
 *   npm run confronta-claude -- Warm MADA   # solo quelli il cui nome contiene Warm o MADA
 *
 * L'Excel di Claude si abbina al PDF dal nome: "<pdf>_Import_Contratti(3).xlsx" (con o
 * senza il numero del download, anche troncato in "_Import_Cont.xlsx"), oppure un nome
 * accorciato contenuto in quello del PDF. Scrive in contratti/scansioni/
 * _confronto_programma.md (riepilogo + dettaglio) e _confronto_programma.json.
 */
process.env.OCR_LIB_MODE = '1'                 // il server non deve mettersi in ascolto
process.env.OLLAMA_BASE = 'http://127.0.0.1:1'

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import * as XLSX from 'xlsx'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR_CONTRATTI = path.join(ROOT, 'contratti')
const DIR_SCANSIONI = path.join(DIR_CONTRATTI, 'scansioni')
const DIR_MODULI = path.join(DIR_CONTRATTI, 'moduli')
const DIR_OUT = path.join(ROOT, 'tests', 'out')

const { risultatoDaModulo, ELENCHI } = await import('../server.ts')
const { eModulo } = await import('../src/lib/modulo-contratto.ts')
const { impostaElenchi } = await import('../src/lib/elenchi-client.ts')
impostaElenchi(ELENCHI)
const { COLS, norm, euro, quasi, somiglianza, righeExcel, confrontaTestata, confrontaVoci, voci, totaleVoci, conta } =
  await import('./confronto-excel.ts')
type Cella = import('./confronto-excel.ts').Cella
type Campo = import('./confronto-excel.ts').Campo
type ConfrontoVoce = import('./confronto-excel.ts').ConfrontoVoce
type Voce = import('./confronto-excel.ts').Voce

// ── Excel di Claude → righe nell'ordine di IMPORT_CONTRATTI_COLS ────────────────
// Le colonne si cercano per nome nell'intestazione (Claude può spostarle o ometterne);
// DATA CONTRATTO arriva come numero di serie Excel e torna data, come nell'export.
const leggiExcelClaude = (file: string): Cella[][] => {
  const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, blankrows: false, defval: '' })
  const [intestazione = [], ...corpo] = rows
  const pos = COLS.map(c => intestazione.findIndex(h => norm(String(h)) === norm(c)))
  return corpo.map(r => COLS.map((c, k) => {
    const v = pos[k] >= 0 ? r[pos[k]] : ''
    if (c === 'DATA CONTRATTO' && typeof v === 'number') return new Date(1899, 11, 30 + v)
    return (typeof v === 'number' || typeof v === 'string') ? v : String(v ?? '')
  }))
}

// ── abbinamento Excel di Claude ↔ PDF ────────────────────────────────────────────
const chiave = (s: string) => norm(s).replace(/ /g, '')
const radiceExcel = (n: string) => n.replace(/_Import_Cont\w*\s*(\(\d+\))?\.xlsx$/i, '').replace(/\.xlsx$/i, '')
const documenti = readdirSync(DIR_CONTRATTI).filter(f => /\.(pdf|docx)$/i.test(f))
/** PDF di contratti/ per un Excel di Claude: nome uguale, se no l'unico che lo contiene. */
const pdfPer = (xlsx: string): string | null => {
  const k = chiave(radiceExcel(xlsx))
  const uguali = documenti.filter(d => chiave(d.replace(/\.(pdf|docx)$/i, '')) === k)
  if (uguali.length === 1) return uguali[0]
  const contiene = documenti.filter(d => chiave(d.replace(/\.(pdf|docx)$/i, '')).includes(k))
  return contiene.length === 1 ? contiene[0] : null
}

// Moduli scritti a mano, indicizzati per il PDF da cui sono stati compilati.
const moduli = new Map<string, string>()
if (existsSync(DIR_MODULI)) {
  for (const n of readdirSync(DIR_MODULI)) {
    if (!/_modulo\.(txt|md)$/i.test(n)) continue
    const txt = readFileSync(path.join(DIR_MODULI, n), 'utf8')
    const m = /leggendo\s+"([^"]+)"/i.exec(txt)
    if (m && eModulo(txt)) moduli.set(m[1], txt)
  }
}

// Esiti dell'ultimo harness: un PDF finito in errore può avere in tests/out un
// alyante.json vecchio, che non va confrontato come se fosse la scansione di oggi.
const erroriHarness = new Map<string, string>()
try {
  for (const e of JSON.parse(readFileSync(path.join(DIR_OUT, '_report.json'), 'utf8')) as { file: string; errore?: string }[]) {
    if (e.errore) erroriHarness.set(e.file, e.errore)
  }
} catch { /* nessun report: si confronta quello che c'è */ }

/** Punteggio di un Excel contro il modulo scritto a mano: testata giusta e voci esatte. */
interface Punteggio { testata: number; campi: number; esatte: number; voci: number }
interface Esito {
  excel: string; documento: string; stato: 'confrontato' | 'nessun PDF' | 'non scansionato' | 'errore del programma'
  errore?: string
  campi: Campo[]; voci: ConfrontoVoce[]
  vociClaude: number; vociProgramma: number; descrizioniSimili: number; abbinate: number
  ripetute: number          // voci dell'Excel di Claude che ripetono una voce già presente
  totaleClaude: number; totaleProgramma: number
  modulo?: { programma: Punteggio; claude: Punteggio }
}
const RIPETUTA = 'voce ripetuta nell\'Excel di Claude'

const punteggio = (rif: Cella[][], altro: Cella[][], alt: Record<string, string[]>, altRif: Record<string, string[]>): Punteggio => {
  const campi = confrontaTestata(rif[0] ?? [], altro[0] ?? [], alt, altRif)
  const vs = confrontaVoci(voci(rif), voci(altro))
  return {
    testata: conta(campi, 'uguale') + conta(campi, 'simile'),
    campi: campi.filter(c => c.esito !== 'vuoto in entrambi').length,
    esatte: conta(vs, 'esatta'),
    voci: vs.filter(v => v.rif).length,
  }
}
const fornitore = (json: string) => String((JSON.parse(json) as { testata?: Record<string, string> }).testata?.fornitore ?? '')

const confronta = (xlsx: string): Esito => {
  const documento = pdfPer(xlsx) ?? ''
  const esito: Esito = { excel: xlsx, documento, stato: 'confrontato', campi: [], voci: [], vociClaude: 0, vociProgramma: 0, descrizioniSimili: 0, abbinate: 0, ripetute: 0, totaleClaude: 0, totaleProgramma: 0 }
  if (!documento) return { ...esito, stato: 'nessun PDF' }
  const radice = documento.replace(/\.(pdf|docx)$/i, '')
  const errore = erroriHarness.get(radice)
  if (errore) return { ...esito, stato: 'errore del programma', errore }
  const outJson = path.join(DIR_OUT, radice, 'alyante.json')
  if (!existsSync(outJson)) return { ...esito, stato: 'non scansionato' }

  const prgJson = readFileSync(outJson, 'utf8')
  const rCla = leggiExcelClaude(path.join(DIR_SCANSIONI, xlsx))
  const rPrg = righeExcel(prgJson)
  // il programma ha letto anche il nome della ditta: vale se Claude ha messo il nome
  const altPrg = { FORNITORE: [fornitore(prgJson)] }
  esito.campi = confrontaTestata(rCla[0] ?? [], rPrg[0] ?? [], altPrg)
  const vCla = voci(rCla), vPrg = voci(rPrg)
  esito.vociClaude = vCla.length
  esito.vociProgramma = vPrg.length
  esito.totaleClaude = totaleVoci(vCla)
  esito.totaleProgramma = totaleVoci(vPrg)
  esito.voci = confrontaVoci(vCla, vPrg, 'Claude')
  // Voce di Claude rimasta senza compagna ma uguale (codice, quantità e prezzo) a una
  // voce precedente dello stesso Excel: è l'elenco prezzi ripetuto, che nel PDF compare
  // spesso due volte (GFM: 212 voci per 108). Il programma i doppioni li toglie fondendo
  // le pagine, quindi non è una voce che gli manca: si conta a parte. Il testo non si
  // pretende identico (le due copie sono letture di pagine diverse). Nella seconda copia
  // Claude a volte perde il codice e lo lascia in testa alla descrizione ("95054 | UHF…"):
  // una voce senza codice con quantità e prezzo di una voce codificata è quella copia.
  // Due voci senza codice invece devono anche somigliarsi nel testo, se no due voci "a
  // corpo" diverse con gli stessi numeri sembrerebbero la stessa.
  const stessiNumeri = (x: Voce, r: Voce) => quasi(x.qta, r.qta) && quasi(x.prezzo, r.prezzo)
  esito.voci.forEach((v, i) => {
    if (v.esito !== 'mancante' || !v.rif) return
    const r = v.rif
    const prima = vCla.indexOf(r)
    const doppia = norm(r.articolo)
      ? vCla.slice(0, prima).some(x => norm(x.articolo) === norm(r.articolo) && stessiNumeri(x, r))
      : vCla.some(x => x !== r && norm(x.articolo) !== '' && stessiNumeri(x, r))
        || vCla.slice(0, prima).some(x => norm(x.articolo) === '' && stessiNumeri(x, r) && somiglianza(x.descrizione, r.descrizione) >= 0.8)
    if (doppia) {
      esito.voci[i] = { ...v, note: RIPETUTA }
      esito.ripetute++
    }
  })
  // descrizioni delle voci abbinate: stesse parole per almeno l'80% (l'OCR sbaglia lettere)
  const abbinate = esito.voci.filter(v => v.rif && v.prog)
  esito.abbinate = abbinate.length
  esito.descrizioniSimili = abbinate.filter(v => somiglianza(v.prog!.descrizione, v.rif!.descrizione) >= 0.8).length

  const txtModulo = moduli.get(documento)
  if (txtModulo) {
    const { result: modJson, errori } = risultatoDaModulo(txtModulo, 'contratti')
    if (!errori.length && modJson) {
      const rMod = righeExcel(modJson)
      const altMod = { FORNITORE: [fornitore(modJson)] }
      esito.modulo = {
        programma: punteggio(rMod, rPrg, altPrg, altMod),
        claude: punteggio(rMod, rCla, {}, altMod),
      }
    }
  }
  return esito
}

// ── esecuzione ──────────────────────────────────────────────────────────────
const filtri = process.argv.slice(2).filter(a => !a.startsWith('--'))
const excel = readdirSync(DIR_SCANSIONI)
  .filter(f => /\.xlsx$/i.test(f) && !f.startsWith('_') && !f.startsWith('~$'))
  .filter(f => !filtri.length || filtri.some(x => f.toLowerCase().includes(x.toLowerCase())))
  .sort((a, b) => a.localeCompare(b, 'it'))
const esiti = excel.map(confronta)

const breve = (s: string, n = 48) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
const md: string[] = ['# Scansione del programma ↔ Excel preparato da Claude', '',
  'Riferimento = Excel Import_Contratti preparato da Claude in modalità Claude (contratti/scansioni/); ' +
  'programma = `npm run harness` sul PDF originale, **senza AI**. Confronto sulle celle dell\'Excel Import_Contratti ' +
  '(tools/confronta_claude.ts). L\'Excel di Claude non è la verità: dove c\'è un modulo scritto a mano ' +
  '(contratti/moduli/) le ultime due colonne dicono chi dei due ci si avvicina di più.', '',
  '«Voci Claude» non conta le voci che l\'Excel di Claude ripete (elenco prezzi copiato due volte): sono nella colonna «Ripetute».', '',
  '| Contratto | Testata uguale | Voci Claude | Voci programma | Esatte | Diverse | Mancanti | In più | Ripetute in Claude | Descrizioni simili | Totale Claude | Totale programma | Col modulo: programma | Col modulo: Claude |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
const dettaglio: string[] = []

console.log('')
for (const e of esiti) {
  const nome = e.documento || e.excel
  if (e.stato !== 'confrontato') {
    const motivo = e.stato === 'errore del programma' ? `errore del programma: ${(e.errore ?? '').split('\n')[0]}` : e.stato
    console.log(`· ${breve(nome, 70)}: ${motivo}`)
    md.push(`| ${breve(nome)} | ${motivo.replace(/\|/g, '/')} | | | | | | | | | | | | |`)
    continue
  }
  const ok = conta(e.campi, 'uguale') + conta(e.campi, 'simile')
  const pieni = e.campi.filter(c => c.esito !== 'vuoto in entrambi').length
  const esatte = conta(e.voci, 'esatta')
  const diverse = conta(e.voci, 'valori diversi') + conta(e.voci, 'codice diverso')
  const mancanti = conta(e.voci, 'mancante') - e.ripetute, inPiu = conta(e.voci, 'in più')
  const vociClaude = e.vociClaude - e.ripetute
  const p = (x?: Punteggio) => (x ? `testata ${x.testata}/${x.campi} · voci ${x.esatte}/${x.voci}` : '')
  console.log(`■ ${nome}`)
  console.log(`    testata ${ok}/${pieni} uguale a Claude · voci Claude ${vociClaude}${e.ripetute ? ` (+${e.ripetute} ripetute)` : ''}, programma ${e.vociProgramma} · esatte ${esatte} · diverse ${diverse} · mancanti ${mancanti} · in più ${inPiu} · descrizioni simili ${e.descrizioniSimili}/${e.abbinate}`)
  console.log(`    totale voci: Claude ${euro(e.totaleClaude)} · programma ${euro(e.totaleProgramma)}`)
  if (e.modulo) console.log(`    col modulo scritto a mano → programma ${p(e.modulo.programma)} · Claude ${p(e.modulo.claude)}`)
  for (const c of e.campi.filter(c => c.esito === 'diverso' || c.esito === 'mancante')) {
    console.log(`    ✗ ${c.colonna}: Claude "${c.riferimento.slice(0, 60)}" · programma "${c.programma.slice(0, 60) || '—'}"`)
  }
  md.push(`| ${breve(nome)} | ${ok}/${pieni} | ${vociClaude} | ${e.vociProgramma} | ${esatte} | ${diverse} | ${mancanti} | ${inPiu} | ${e.ripetute || ''} | ${e.descrizioniSimili}/${e.abbinate} | ${euro(e.totaleClaude)} | ${euro(e.totaleProgramma)} | ${p(e.modulo?.programma)} | ${p(e.modulo?.claude)} |`)
  dettaglio.push(`## ${nome}`, '', `Excel di Claude: \`${e.excel}\``, '',
    '| Colonna | Claude | Programma | Esito |', '|---|---|---|---|',
    ...e.campi.map(c => `| ${c.colonna} | ${c.riferimento.replace(/\|/g, '/') || '—'} | ${c.programma.replace(/\|/g, '/') || '—'} | ${c.esito} |`), '',
    '| Esito | Articolo (Claude) | Articolo (programma) | QTA Claude / programma | PREZZO Claude / programma | Note |', '|---|---|---|---|---|---|',
    ...e.voci.map(v => `| ${v.esito} | ${v.rif?.articolo || '—'} | ${v.prog?.articolo || '—'} | ${v.rif ? v.rif.qta : '—'} / ${v.prog ? v.prog.qta : '—'} | ${v.rif ? v.rif.prezzo : '—'} / ${v.prog ? v.prog.prezzo : '—'} | ${v.note} |`), '')
}

// totali sui contratti confrontati
const fatti = esiti.filter(e => e.stato === 'confrontato')
const somma = (f: (e: Esito) => number) => fatti.reduce((s, e) => s + f(e), 0)
const tCampi = somma(e => e.campi.filter(c => c.esito !== 'vuoto in entrambi').length)
const tOk = somma(e => conta(e.campi, 'uguale') + conta(e.campi, 'simile'))
const tEsatte = somma(e => conta(e.voci, 'esatta')), tCla = somma(e => e.vociClaude - e.ripetute)
const riassunto = `${fatti.length}/${esiti.length} contratti confrontati · testata uguale a Claude ${tOk}/${tCampi} (${pct(tOk, tCampi)}) · voci esatte ${tEsatte}/${tCla} (${pct(tEsatte, tCla)})`
console.log(`\n${riassunto}`)
md.splice(2, 0, `**${riassunto}**`, '')
writeFileSync(path.join(DIR_SCANSIONI, '_confronto_programma.md'), [...md, '', ...dettaglio].join('\n'), 'utf8')
writeFileSync(path.join(DIR_SCANSIONI, '_confronto_programma.json'), JSON.stringify(esiti, null, 2), 'utf8')
console.log(`Dettaglio → ${path.relative(ROOT, path.join(DIR_SCANSIONI, '_confronto_programma.md'))}`)
process.exit(0)
