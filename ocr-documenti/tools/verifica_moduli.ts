// "><(((º> sabusabu <º)))><"
/**
 * Verifica offline dei MODULI CONTRATTO compilati (src/lib/modulo-contratto.ts): ogni
 * modulo passa dalla STESSA filiera della route /api/ocr — lettura alla lettera,
 * strutturaAlyante `fedele`, elenchi ufficiali, commessa come scritta — senza OCR,
 * senza parser euristici e senza assist AI. È la prova che un contratto riscritto nel
 * modulo produce l'Import_Contratti anche quando Ollama/Claude non ci sono.
 *
 *   npm run moduli                         # tutti i .txt/.md in contratti/moduli/
 *   npm run moduli -- percorso/a/modulo.txt altra/cartella
 *
 * Per ogni modulo valido scrive accanto al file:
 *   <nome>.alyante.json            il JSON formato ALYANTE (come lo riceve l'app)
 *   <nome>_Import_Contratti.xlsx   le righe della maschera Alyante (stesse colonne dell'app,
 *                                  senza le celle rosse di validazione, che fa il browser)
 * e a video: errori con il numero di riga, voci, somma delle voci contro IMPORTO LAVORI,
 * codici agganciati agli elenchi (PROGETTO, DITTA, DIVISIONE, COND.PAG, RG/RI).
 * Esce con codice 1 se almeno un modulo è respinto.
 */
process.env.OCR_LIB_MODE = '1'                 // server.ts come libreria: niente listen
process.env.OLLAMA_BASE = 'http://127.0.0.1:1' // nessun assist AI, nemmeno per sbaglio

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import XLSX from 'xlsx'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIR_DEFAULT = path.join(ROOT, 'contratti', 'moduli')

const { risultatoDaModulo, ELENCHI } = await import('../server.ts')
const { descriviErrori, eModulo } = await import('../src/lib/modulo-contratto.ts')
const { impostaElenchi } = await import('../src/lib/elenchi-client.ts')
// import-contratti.ts importa salvataggio.ts (DOM: document/window, usati solo nel
// browser per salvare il file). Col percorso non letterale tsc non lo segue, così
// tsconfig.server.json resta senza lib DOM; i tipi usati qui sono dichiarati a mano.
type CellaImport = string | number | Date
const IMPORT_CONTRATTI = '../src/lib/import-contratti.ts'
const { IMPORT_CONTRATTI_COLS, buildImportContrattiRowsFromAlyante } = await import(IMPORT_CONTRATTI) as {
  IMPORT_CONTRATTI_COLS: string[]
  buildImportContrattiRowsFromAlyante: (source: string) => CellaImport[][] | null
}
// l'export legge gli elenchi da getElenchi(): nel browser arrivano da /api/elenchi,
// qui si passano quelli già caricati dal server
impostaElenchi(ELENCHI)

// Argomenti = file o cartelle; nessuno → contratti/moduli/. Dentro le cartelle solo
// .txt/.md, escluso il modulo vuoto e i file di uscita di questo strumento.
const elencaModuli = (args: string[]): string[] => {
  const out: string[] = []
  for (const a of args.length ? args : [DIR_DEFAULT]) {
    const p = path.resolve(a)
    if (!existsSync(p)) { console.error(`✗ non trovato: ${a}`); continue }
    if (statSync(p).isDirectory()) {
      for (const n of readdirSync(p).sort()) if (/\.(txt|md)$/i.test(n)) out.push(path.join(p, n))
    } else out.push(p)
  }
  return out
}

const numIt = (s: unknown): number => parseFloat(String(s ?? '').replace(/\./g, '').replace(',', '.'))
const euro = (n: number): string => n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const moduli = elencaModuli(process.argv.slice(2))
if (!moduli.length) { console.error('Nessun modulo da verificare.'); process.exit(1) }

let respinti = 0
for (const file of moduli) {
  const nome = path.basename(file)
  const testo = readFileSync(file, 'utf8')
  if (!eModulo(testo)) { console.log(`· ${nome}: non è un modulo contratto (manca la riga di versione), saltato`); continue }

  const { result, errori } = risultatoDaModulo(testo, 'contratti')
  if (errori.length || !result) {
    respinti++
    console.log(`✗ ${nome} — RESPINTO (${errori.length} errori)\n${descriviErrori(errori).replace(/^/gm, '    ')}`)
    continue
  }

  const base = file.replace(/\.(txt|md)$/i, '')
  writeFileSync(`${base}.alyante.json`, result, 'utf8')
  const rows = buildImportContrattiRowsFromAlyante(result) ?? []
  const ws = XLSX.utils.aoa_to_sheet([IMPORT_CONTRATTI_COLS, ...rows])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Contratti')
  // XLSX.writeFile nella build ESM non ha accesso a fs: si scrive il buffer a mano
  writeFileSync(`${base}_Import_Contratti.xlsx`, XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer)

  // La somma delle voci non è un errore del modulo (l'importo dell'Art. 4 può includere
  // voci a corpo o opzionali): si mostra perché è il primo controllo che fa chi rilegge.
  const a = JSON.parse(result) as { testata: Record<string, string>; importi: Record<string, string>; righe: Record<string, string>[] }
  const somma = a.righe.reduce((s, r) => s + (numIt(r.importo) || 0), 0)
  const importo = numIt(a.importi.importo_lavori)
  const quadra = isFinite(importo) ? (Math.abs(somma - importo) < 0.05 ? '= importo lavori' : `≠ importo lavori ${euro(importo)} (diff. ${euro(somma - importo)})`) : ''
  const col = (c: string) => IMPORT_CONTRATTI_COLS.indexOf(c)
  const r0 = rows[0] ?? []
  const cella = (c: string) => String(r0[col(c)] ?? '') || '—'
  console.log(`✓ ${nome} — ${a.righe.length} voci, somma ${euro(somma)} ${quadra}`)
  console.log(`    PROGETTO ${cella('PROGETTO')} · DITTA ${cella('DITTA')} · DIVISIONE ${cella('DIVISIONE')} · COND.PAG ${cella('COND.PAG')} · RG ${cella('RG')} · RI ${cella('RI')}`)
}
console.log(`\n${moduli.length - respinti}/${moduli.length} moduli letti senza errori.`)
process.exit(respinti ? 1 : 0)
