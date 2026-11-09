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
 * Scrive accanto ai moduli _confronto.md (dettaglio leggibile) e _confronto.json, e a video
 * (e in testa a _confronto.md) i TOTALI: testata giusta, voci esatte, voci con quantità e
 * prezzo giusti, campi di testata sbagliati per colonna — i numeri da guardare dopo ogni
 * modifica dei parser (docs/RICERCA_OCR_SOLUZIONE.md).
 *
 * --variante <nome>: invece del PDF d'origine si confronta il documento ricavato dal
 * modulo stesso, <modulo senza _modulo.txt>_<nome>.pdf (tools/modulo_in_pdf.ts:
 * "formattato" = PDF nativo, "formattato_scansione" = lo stesso passato da scanner).
 * Esce in _confronto_<nome>.md/.json, senza toccare il confronto con gli originali.
 *   npm run harness -- --cartella contratti/formattati
 *   npm run confronta-moduli -- --variante formattato
 *
 * --da-moduli <cartella>: dalla parte del programma, invece dell'harness, un ALTRO modulo
 * dello stesso documento preso da <cartella> (abbinato col commento `leggendo "<pdf>"`),
 * riletto con la stessa filiera (risultatoDaModulo, senza AI). Serve a misurare un modo
 * diverso di compilare il modulo, per esempio partendo solo dal testo OCR .MD invece che
 * dal PDF (contratti/moduli-da-md). Esce in _confronto_<nome cartella>.md/.json.
 *   npm run moduli -- contratti/moduli-da-md
 *   npm run confronta-moduli -- --da-moduli contratti/moduli-da-md
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
impostaElenchi(ELENCHI)
// testata, voci e abbinamento in comune con tools/confronta_claude.ts
const { righeExcel, confrontaTestata, confrontaVoci, voci, totaleVoci, conta, euro } = await import('./confronto-excel.ts')
type Campo = import('./confronto-excel.ts').Campo
type ConfrontoVoce = import('./confronto-excel.ts').ConfrontoVoce

// `nota`: perché il confronto non c'è (es. il modulo di --da-moduli è respinto)
interface Esito {
  modulo: string; documento: string; scansionato: boolean
  campi: Campo[]; voci: ConfrontoVoce[]
  totaleRif: number; totalePrg: number; importoRif: string; importoPrg: string
  nota?: string
}

// --variante <nome>: vedi intestazione
const iVar = process.argv.indexOf('--variante')
const variante = iVar > 0 ? (process.argv[iVar + 1] ?? '') : ''
// --da-moduli <cartella>: vedi intestazione. Indice documento (PDF) → modulo di quella
// cartella, dal commento `leggendo "<pdf>"` che ogni modulo porta in testa.
const iDa = process.argv.indexOf('--da-moduli')
const daModuli = iDa > 0 && process.argv[iDa + 1] ? path.resolve(process.argv[iDa + 1]) : ''
const moduliAlternativi = new Map<string, string>()
if (daModuli) {
  for (const n of readdirSync(daModuli).sort()) {
    if (!/\.(txt|md)$/i.test(n) || n.startsWith('_')) continue
    const txt = readFileSync(path.join(daModuli, n), 'utf8')
    const m = /leggendo\s+"([^"]+)"/i.exec(txt)
    if (eModulo(txt) && m) moduliAlternativi.set(m[1], path.join(daModuli, n))
  }
}
const chiProgramma = daModuli ? `modulo di ${path.basename(daModuli)}` : 'scansione'
// intestazione di colonna del lato confrontato nelle tabelle di _confronto*.md
const altro = daModuli ? path.basename(daModuli) : 'scansione'

// JSON ALYANTE del "programma": il modulo alternativo (--da-moduli) o l'uscita dell'harness.
// null + nota = documento senza confronto (non scansionato, modulo mancante o respinto).
const jsonProgramma = (documento: string): { json: string | null; nota?: string } => {
  if (daModuli) {
    const f = moduliAlternativi.get(documento)
    if (!f) return { json: null, nota: `nessun modulo per "${documento}" in ${path.basename(daModuli)}` }
    const { result, errori } = risultatoDaModulo(readFileSync(f, 'utf8'), 'contratti')
    if (errori.length || !result) return { json: null, nota: `${path.basename(f)} respinto: ${errori.length} errori (npm run moduli)` }
    return { json: result }
  }
  const outJson = path.join(DIR_OUT, documento.replace(/\.(pdf|docx)$/i, ''), 'alyante.json')
  return existsSync(outJson) ? { json: readFileSync(outJson, 'utf8') } : { json: null, nota: 'manca tests/out/…/alyante.json' }
}

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
  if (!documento) return esito
  const { json: prgJson, nota } = jsonProgramma(documento)
  if (!prgJson) return { ...esito, nota }
  esito.scansionato = true
  const rRif = righeExcel(rifJson)
  const rPrg = righeExcel(prgJson)
  esito.campi = confrontaTestata(rRif[0] ?? [], rPrg[0] ?? [])
  esito.importoRif = String((JSON.parse(rifJson) as { importi?: Record<string, string> }).importi?.importo_lavori ?? '')
  esito.importoPrg = String((JSON.parse(prgJson) as { importi?: Record<string, string> }).importi?.importo_lavori ?? '')
  const vRif = voci(rRif), vPrg = voci(rPrg)
  esito.totaleRif = totaleVoci(vRif)
  esito.totalePrg = totaleVoci(vPrg)
  esito.voci = confrontaVoci(vRif, vPrg)
  return esito
}

// ── esecuzione ──────────────────────────────────────────────────────────────
const OPZIONI = ['--variante', '--da-moduli']
const args = process.argv.slice(2).filter((a, k, tutti) => !OPZIONI.includes(a) && !OPZIONI.includes(tutti[k - 1]))
const files: string[] = []
for (const a of args.length ? args : [DIR_DEFAULT]) {
  const p = path.resolve(a)
  if (!existsSync(p)) { console.error(`✗ non trovato: ${a}`); continue }
  if (statSync(p).isDirectory()) { for (const n of readdirSync(p).sort()) if (/\.(txt|md)$/i.test(n) && !n.startsWith('_')) files.push(path.join(p, n)) }
  else files.push(p)
}

const esiti = files.map(confronta).filter((e): e is Esito => !!e)
const md: string[] = [daModuli ? `# Modulo di ${path.basename(daModuli)} ↔ modulo compilato a mano` : '# Scansione del programma ↔ modulo compilato a mano', '',
  daModuli
    ? `Riferimento = modulo contratto scritto leggendo il PDF; confrontato = il modulo dello stesso documento in \`${path.relative(ROOT, daModuli)}\`, riletto alla lettera (risultatoDaModulo, senza AI).`
    : variante
    ? `Riferimento = modulo contratto scritto leggendo il PDF; programma = \`npm run harness\` sul documento ricavato dal modulo (\`${variante}\`, tools/modulo_in_pdf.ts).`
    : 'Riferimento = modulo contratto scritto leggendo il PDF; programma = `npm run harness` (assist AI spento).',
  'Confronto sulle celle dell\'Excel Import_Contratti.', '']

console.log('')
for (const e of esiti) {
  if (!e.scansionato) {
    console.log(`· ${e.modulo}: "${e.documento}" senza confronto (${e.nota ?? 'documento non indicato nel modulo'})`)
    md.push(`## ${e.documento || e.modulo}`, '', `_Senza confronto: ${e.nota ?? 'documento non indicato nel modulo'}._`, '')
    continue
  }
  const ok = conta(e.campi, 'uguale') + conta(e.campi, 'simile')
  const pieni = e.campi.filter(c => c.esito !== 'vuoto in entrambi').length
  const esatte = conta(e.voci, 'esatta')
  const nRif = e.voci.filter(v => v.rif).length
  console.log(`■ ${e.documento}`)
  console.log(`    testata ${ok}/${pieni} giuste · voci esatte ${esatte}/${nRif} · diverse ${conta(e.voci, 'valori diversi') + conta(e.voci, 'codice diverso')} · mancanti ${conta(e.voci, 'mancante')} · in più ${conta(e.voci, 'in più')}`)
  console.log(`    totale voci: modulo ${euro(e.totaleRif)} · ${chiProgramma} ${euro(e.totalePrg)}`)
  for (const c of e.campi.filter(c => c.esito === 'diverso' || c.esito === 'mancante')) {
    console.log(`    ✗ ${c.colonna}: modulo "${c.riferimento.slice(0, 60)}" · ${chiProgramma} "${c.programma.slice(0, 60) || '—'}"`)
  }
  md.push(`## ${e.documento}`, '',
    `Testata **${ok}/${pieni}** · voci esatte **${esatte}/${nRif}** · totale voci modulo ${euro(e.totaleRif)}, ${chiProgramma} ${euro(e.totalePrg)} · importo lavori modulo ${e.importoRif || '—'}, ${chiProgramma} ${e.importoPrg || '—'}`, '',
    `| Colonna | Modulo (a mano) | ${daModuli ? altro : 'Scansione'} | Esito |`, '|---|---|---|---|',
    ...e.campi.map(c => `| ${c.colonna} | ${c.riferimento.replace(/\|/g, '/') || '—'} | ${c.programma.replace(/\|/g, '/') || '—'} | ${c.esito} |`), '',
    `| Esito | Articolo (modulo) | Articolo (${altro}) | QTA modulo / ${altro} | PREZZO modulo / ${altro} | Note |`, '|---|---|---|---|---|---|',
    ...e.voci.map(v => `| ${v.esito} | ${v.rif?.articolo || '—'} | ${v.prog?.articolo || '—'} | ${v.rif ? v.rif.qta : '—'} / ${v.prog ? v.prog.qta : '—'} | ${v.rif ? v.rif.prezzo : '—'} / ${v.prog ? v.prog.prezzo : '—'} | ${v.note} |`), '')
}
// Totali su tutti i documenti confrontati: sono i numeri che si guardano a ogni modifica
// dei parser (docs/RICERCA_OCR_SOLUZIONE.md §3 e §7). «Quantità e prezzo giusti» conta
// anche le voci col codice diverso: il valore economico è giusto, l'articolo no.
const confrontati = esiti.filter(e => e.scansionato)
if (confrontati.length) {
  const somma = (f: (e: Esito) => number) => confrontati.reduce((s, e) => s + f(e), 0)
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')
  const campiOk = somma(e => conta(e.campi, 'uguale') + conta(e.campi, 'simile'))
  const campiPieni = somma(e => e.campi.filter(c => c.esito !== 'vuoto in entrambi').length)
  const nRif = somma(e => e.voci.filter(v => v.rif).length)
  const esatte = somma(e => conta(e.voci, 'esatta'))
  const qtaPrezzo = esatte + somma(e => conta(e.voci, 'codice diverso'))
  const righe = [
    `Documenti confrontati: ${confrontati.length}`,
    `Testata giusta: ${campiOk}/${campiPieni} (${pct(campiOk, campiPieni)})`,
    `Voci esatte: ${esatte}/${nRif} (${pct(esatte, nRif)})`,
    `Voci con quantità e prezzo giusti: ${qtaPrezzo}/${nRif} (${pct(qtaPrezzo, nRif)})`,
    `Valori diversi ${somma(e => conta(e.voci, 'valori diversi'))} · mancanti ${somma(e => conta(e.voci, 'mancante'))} · in più ${somma(e => conta(e.voci, 'in più'))}`,
  ]
  console.log(`\n── Totale ──\n${righe.join('\n')}`)
  // campi di testata sbagliati per colonna: dicono quale regola guardare per prima
  const perColonna = new Map<string, number>()
  for (const e of confrontati) for (const c of e.campi) if (c.esito === 'diverso' || c.esito === 'mancante') perColonna.set(c.colonna, (perColonna.get(c.colonna) ?? 0) + 1)
  const colonne = [...perColonna].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(' · ')
  if (colonne) console.log(`Testata sbagliata per colonna: ${colonne}`)
  md.splice(4, 0, '## Totale', '', ...righe.map(r => `- ${r}`), ...(colonne ? [`- Testata sbagliata per colonna: ${colonne}`] : []), '')
}
const dirOut = files.length ? path.dirname(files[0]) : DIR_DEFAULT
const suffisso = daModuli ? `_${path.basename(daModuli)}` : variante ? `_${variante}` : ''
writeFileSync(path.join(dirOut, `_confronto${suffisso}.md`), md.join('\n'), 'utf8')
writeFileSync(path.join(dirOut, `_confronto${suffisso}.json`), JSON.stringify(esiti, null, 2), 'utf8')
console.log(`\nDettaglio → ${path.relative(ROOT, path.join(dirOut, `_confronto${suffisso}.md`))}`)
process.exit(0)
