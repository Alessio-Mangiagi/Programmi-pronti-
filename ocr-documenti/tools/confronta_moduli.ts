// "><(((º> sabusabu <º)))><"
/**
 * Confronto SCANSIONE DEL PROGRAMMA ↔ MODULO DI RIFERIMENTO compilato a mano.
 *
 * Il modulo contratto scritto da una persona leggendo il PDF è il "valore giusto";
 * l'harness (tools/harness.ts) produce in tests/out/<pdf>/alyante.json quello che il
 * programma estrae da solo (OCR/testo nativo + parser). Qui i due passano dalla stessa
 * costruzione dell'Excel (buildImportContrattiRowsFromAlyante) e si confrontano le celle
 * che finiscono in Alyante: testata colonna per colonna, elenco prezzi voce per voce.
 *
 *   npm run harness -- <filtro>      # prima: il programma scansiona i PDF
 *   npm run confronta-moduli         # moduli in contratti/moduli/
 *   npm run confronta-moduli -- percorso/modulo.txt
 *
 * Il PDF d'origine si ricava dal commento in testa al modulo:
 *   # Modulo compilato a mano leggendo "Contratto_fornitura.pdf" ...
 * Scrive accanto ai moduli _confronto.md (dettaglio leggibile) e _confronto.json.
 *
 * --variante <nome>: invece del PDF d'origine si confronta il documento ricavato dal
 * modulo stesso, <modulo senza _modulo.txt>_<nome>.pdf (tools/modulo_in_pdf.ts:
 * "formattato" = PDF nativo, "formattato_scansione" = lo stesso passato da scanner).
 * Esce in _confronto_<nome>.md/.json, senza toccare il confronto con gli originali.
 *   npm run harness -- --cartella contratti/formattati
 *   npm run confronta-moduli -- --variante formattato
 */
process.env.OCR_LIB_MODE = '1'
process.env.OLLAMA_BASE = 'http://127.0.0.1:1'

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR_DEFAULT = path.join(ROOT, 'contratti', 'moduli')
const DIR_OUT = path.join(ROOT, 'tests', 'out')

const { risultatoDaModulo, ELENCHI } = await import('../server.ts')
const { eModulo } = await import('../src/lib/modulo-contratto.ts')
const { impostaElenchi } = await import('../src/lib/elenchi-client.ts')
// percorso non letterale: vedi tools/verifica_moduli.ts (import-contratti tira dentro DOM)
type Cella = string | number | Date
const IMPORT_CONTRATTI = '../src/lib/import-contratti.ts'
const { IMPORT_CONTRATTI_COLS: COLS, buildImportContrattiRowsFromAlyante } = await import(IMPORT_CONTRATTI) as {
  IMPORT_CONTRATTI_COLS: string[]
  buildImportContrattiRowsFromAlyante: (source: string) => Cella[][] | null
}
impostaElenchi(ELENCHI)

// Colonne di testata confrontate (uguali su ogni riga dell'Excel: si guarda la prima).
// DESCR.CONTR = OGGETTO per regola della maschera, non si conta due volte.
const COL_TESTATA = ['DITTA', 'CODICE CONTRATTO', 'PROGETTO', 'FORNITORE', 'DIVISIONE', 'DATA CONTRATTO',
  'IMP ANTICIPI', '%RECUPERO ANTIC', 'IMP ONERI SICUREZZA', 'COND.PAG', 'OGGETTO', 'CIG', 'CUP', 'RG', 'RI']
const ci = (c: string) => COLS.indexOf(c)

const testo = (v: Cella | undefined): string =>
  v instanceof Date ? v.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : String(v ?? '').trim()
const norm = (s: string) => s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim()
const num = (v: Cella | undefined): number => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')))
const euro = (n: number) => (isFinite(n) ? n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—')
// stesso numero a meno di arrotondamenti al centesimo (prezzi stampati a 2 decimali)
const quasi = (a: number, b: number) => (isFinite(a) && isFinite(b) ? Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 0.001) : !isFinite(a) && !isFinite(b))
// somiglianza fra testi lunghi (OGGETTO): parole in comune / parole del riferimento
const somiglianza = (a: string, b: string): number => {
  const pa = new Set(norm(a).split(' ').filter(w => w.length > 2))
  const pb = new Set(norm(b).split(' ').filter(w => w.length > 2))
  if (!pb.size) return pa.size ? 0 : 1
  let comuni = 0
  for (const w of pb) if (pa.has(w)) comuni++
  return comuni / pb.size
}

type EsitoCampo = 'uguale' | 'simile' | 'diverso' | 'mancante' | 'vuoto in entrambi'
interface Campo { colonna: string; riferimento: string; programma: string; esito: EsitoCampo }
interface Voce { articolo: string; descrizione: string; um: string; qta: number; prezzo: number }
interface ConfrontoVoce { esito: 'esatta' | 'valori diversi' | 'codice diverso' | 'mancante' | 'in più'; rif?: Voce; prog?: Voce; note: string }
interface Esito {
  modulo: string; documento: string; scansionato: boolean
  campi: Campo[]; voci: ConfrontoVoce[]
  totaleRif: number; totalePrg: number; importoRif: string; importoPrg: string
}

const voci = (rows: Cella[][]): Voce[] => rows.map(r => ({
  articolo: testo(r[ci('ARTICOLO')]), descrizione: testo(r[ci('DES ARTICOLO')]), um: testo(r[ci('UM')]),
  qta: num(r[ci('QTA')]), prezzo: num(r[ci('PREZZO')]),
}))

/**
 * Elenco prezzi: abbinamento voce per voce in TRE passate su tutto l'elenco — prima le
 * esatte (codice + quantità + prezzo), poi lo stesso codice con valori diversi, poi gli
 * stessi valori con codice diverso. Una passata sola per voce non basta: con più voci
 * dello stesso codice (B.07.115.A ×3) la prima si prendeva la riga esatta di un'altra.
 */
const confrontaVoci = (rif: Voce[], prg: Voce[]): ConfrontoVoce[] => {
  const usate = new Set<number>()
  const esiti: (ConfrontoVoce | null)[] = rif.map(() => null)
  const stessiValori = (a: Voce, b: Voce) => quasi(a.qta, b.qta) && quasi(a.prezzo, b.prezzo)
  const trova = (pred: (p: Voce) => boolean) => prg.findIndex((p, k) => !usate.has(k) && pred(p))
  const passata = (crea: (r: Voce) => ConfrontoVoce | null) => rif.forEach((r, i) => { if (!esiti[i]) esiti[i] = crea(r) })
  passata(r => {
    const cod = norm(r.articolo)
    const k = cod ? trova(p => norm(p.articolo) === cod && stessiValori(p, r)) : -1
    if (k < 0) return null
    usate.add(k)
    return { esito: 'esatta', rif: r, prog: prg[k], note: '' }
  })
  passata(r => {
    const cod = norm(r.articolo)
    const k = cod ? trova(p => norm(p.articolo) === cod) : -1
    if (k < 0) return null
    const p = prg[k]
    usate.add(k)
    const d = [!quasi(p.qta, r.qta) && `QTA ${p.qta} invece di ${r.qta}`, !quasi(p.prezzo, r.prezzo) && `PREZZO ${p.prezzo} invece di ${r.prezzo}`].filter(Boolean)
    return { esito: 'valori diversi', rif: r, prog: p, note: d.join('; ') }
  })
  passata(r => {
    const k = (isFinite(r.qta) || isFinite(r.prezzo)) ? trova(p => stessiValori(p, r)) : -1
    if (k < 0) return null
    usate.add(k)
    return { esito: norm(prg[k].articolo) === norm(r.articolo) ? 'esatta' : 'codice diverso', rif: r, prog: prg[k], note: norm(prg[k].articolo) === norm(r.articolo) ? '' : `articolo "${prg[k].articolo || '—'}" invece di "${r.articolo || '—'}"` }
  })
  const out = esiti.map((e, i) => e ?? { esito: 'mancante' as const, rif: rif[i], note: 'voce non trovata nella scansione' })
  prg.forEach((p, k) => { if (!usate.has(k)) out.push({ esito: 'in più', prog: p, note: 'voce della scansione che il modulo non ha' }) })
  return out
}

// --variante <nome>: vedi intestazione
const iVar = process.argv.indexOf('--variante')
const variante = iVar > 0 ? (process.argv[iVar + 1] ?? '') : ''

const confronta = (file: string): Esito | null => {
  const txt = readFileSync(file, 'utf8')
  if (!eModulo(txt)) return null
  const m = /leggendo\s+"([^"]+)"/i.exec(txt)
  const documento = variante
    ? `${path.basename(file).replace(/_modulo\.(txt|md)$/i, '')}_${variante}.pdf`
    : m?.[1] ?? ''
  const esito: Esito = { modulo: path.basename(file), documento, scansionato: false, campi: [], voci: [], totaleRif: 0, totalePrg: 0, importoRif: '', importoPrg: '' }
  const { result: rifJson, errori } = risultatoDaModulo(txt, 'contratti')
  if (errori.length || !rifJson) throw new Error(`${esito.modulo}: il modulo di riferimento ha errori, correggilo prima (npm run moduli)`)
  const outJson = path.join(DIR_OUT, documento.replace(/\.(pdf|docx)$/i, ''), 'alyante.json')
  if (!documento || !existsSync(outJson)) return esito
  esito.scansionato = true
  const prgJson = readFileSync(outJson, 'utf8')
  const rRif = buildImportContrattiRowsFromAlyante(rifJson) ?? []
  const rPrg = buildImportContrattiRowsFromAlyante(prgJson) ?? []
  const t0 = rRif[0] ?? [], p0 = rPrg[0] ?? []
  for (const col of COL_TESTATA) {
    const a = testo(t0[ci(col)]), b = testo(p0[ci(col)])
    let e: EsitoCampo
    if (!a && !b) e = 'vuoto in entrambi'
    else if (!b) e = 'mancante'
    else if (norm(a) === norm(b) || (isFinite(num(a)) && isFinite(num(b)) && /^[\d.,]+$/.test(a) && quasi(num(b), num(a)))) e = 'uguale'
    else if (col === 'OGGETTO' || col === 'FORNITORE') e = somiglianza(b, a) >= 0.6 ? 'simile' : 'diverso'
    else e = 'diverso'
    esito.campi.push({ colonna: col, riferimento: a, programma: b, esito: e })
  }
  esito.importoRif = String((JSON.parse(rifJson) as { importi?: Record<string, string> }).importi?.importo_lavori ?? '')
  esito.importoPrg = String((JSON.parse(prgJson) as { importi?: Record<string, string> }).importi?.importo_lavori ?? '')
  const vRif = voci(rRif), vPrg = voci(rPrg)
  esito.totaleRif = vRif.reduce((s, v) => s + (isFinite(v.qta * v.prezzo) ? v.qta * v.prezzo : 0), 0)
  esito.totalePrg = vPrg.reduce((s, v) => s + (isFinite(v.qta * v.prezzo) ? v.qta * v.prezzo : 0), 0)
  esito.voci = confrontaVoci(vRif, vPrg)
  return esito
}

// ── esecuzione ──────────────────────────────────────────────────────────────
const args = process.argv.slice(2).filter((a, k, tutti) => a !== '--variante' && tutti[k - 1] !== '--variante')
const files: string[] = []
for (const a of args.length ? args : [DIR_DEFAULT]) {
  const p = path.resolve(a)
  if (!existsSync(p)) { console.error(`✗ non trovato: ${a}`); continue }
  if (statSync(p).isDirectory()) { for (const n of readdirSync(p).sort()) if (/\.(txt|md)$/i.test(n) && !n.startsWith('_')) files.push(path.join(p, n)) }
  else files.push(p)
}

const esiti = files.map(confronta).filter((e): e is Esito => !!e)
const conta = <T extends string>(xs: { esito: T }[], k: T) => xs.filter(x => x.esito === k).length
const md: string[] = ['# Scansione del programma ↔ modulo compilato a mano', '',
  variante
    ? `Riferimento = modulo contratto scritto leggendo il PDF; programma = \`npm run harness\` sul documento ricavato dal modulo (\`${variante}\`, tools/modulo_in_pdf.ts).`
    : 'Riferimento = modulo contratto scritto leggendo il PDF; programma = `npm run harness` (assist AI spento).',
  'Confronto sulle celle dell\'Excel Import_Contratti.', '']

console.log('')
for (const e of esiti) {
  if (!e.scansionato) {
    console.log(`· ${e.modulo}: "${e.documento}" non ancora scansionato (manca tests/out/…/alyante.json)`)
    md.push(`## ${e.documento || e.modulo}`, '', '_Non scansionato._', '')
    continue
  }
  const ok = conta(e.campi, 'uguale') + conta(e.campi, 'simile')
  const pieni = e.campi.filter(c => c.esito !== 'vuoto in entrambi').length
  const esatte = conta(e.voci, 'esatta')
  const nRif = e.voci.filter(v => v.rif).length
  console.log(`■ ${e.documento}`)
  console.log(`    testata ${ok}/${pieni} giuste · voci esatte ${esatte}/${nRif} · diverse ${conta(e.voci, 'valori diversi') + conta(e.voci, 'codice diverso')} · mancanti ${conta(e.voci, 'mancante')} · in più ${conta(e.voci, 'in più')}`)
  console.log(`    totale voci: modulo ${euro(e.totaleRif)} · scansione ${euro(e.totalePrg)}`)
  for (const c of e.campi.filter(c => c.esito === 'diverso' || c.esito === 'mancante')) {
    console.log(`    ✗ ${c.colonna}: modulo "${c.riferimento.slice(0, 60)}" · scansione "${c.programma.slice(0, 60) || '—'}"`)
  }
  md.push(`## ${e.documento}`, '',
    `Testata **${ok}/${pieni}** · voci esatte **${esatte}/${nRif}** · totale voci modulo ${euro(e.totaleRif)}, scansione ${euro(e.totalePrg)} · importo lavori modulo ${e.importoRif || '—'}, scansione ${e.importoPrg || '—'}`, '',
    '| Colonna | Modulo (a mano) | Scansione | Esito |', '|---|---|---|---|',
    ...e.campi.map(c => `| ${c.colonna} | ${c.riferimento.replace(/\|/g, '/') || '—'} | ${c.programma.replace(/\|/g, '/') || '—'} | ${c.esito} |`), '',
    '| Esito | Articolo (modulo) | Articolo (scansione) | QTA modulo / scansione | PREZZO modulo / scansione | Note |', '|---|---|---|---|---|---|',
    ...e.voci.map(v => `| ${v.esito} | ${v.rif?.articolo || '—'} | ${v.prog?.articolo || '—'} | ${v.rif ? v.rif.qta : '—'} / ${v.prog ? v.prog.qta : '—'} | ${v.rif ? v.rif.prezzo : '—'} / ${v.prog ? v.prog.prezzo : '—'} | ${v.note} |`), '')
}
const dirOut = files.length ? path.dirname(files[0]) : DIR_DEFAULT
const suffisso = variante ? `_${variante}` : ''
writeFileSync(path.join(dirOut, `_confronto${suffisso}.md`), md.join('\n'), 'utf8')
writeFileSync(path.join(dirOut, `_confronto${suffisso}.json`), JSON.stringify(esiti, null, 2), 'utf8')
console.log(`\nDettaglio → ${path.relative(ROOT, path.join(dirOut, `_confronto${suffisso}.md`))}`)
process.exit(0)
