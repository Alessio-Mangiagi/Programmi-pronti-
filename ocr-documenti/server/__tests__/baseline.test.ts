/**
 * Regressione dei parser sui contratti reali.
 *
 * tests/baseline/<nome>/ (fuori da git: documenti aziendali) contiene, per ogni
 * contratto passato dal banco di prova (tools/harness.ts), il testo OCR e i JSON
 * che ne uscivano. Qui si rigioca SOLO la parte deterministica — testo → estrai →
 * struttura → elenchi ufficiali — e si pretende lo stesso risultato: una modifica
 * ai parser che cambia un'estrazione si vede subito, senza rifare l'OCR.
 *
 * Baseline assente (clone pulito, CI) → suite saltata, non fallita.
 * Cambiamento voluto → `npm run baseline:aggiorna` riscrive i JSON dal solo ocr.txt
 * (stessa pipeline di qui, niente OCR); il diff in git — tests/baseline è ignorato,
 * quindi si confronta a mano o con il diff di vitest prima di aggiornare.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { ROOT } from '../config.ts'
// "><(((º> sabusabu <º)))><"
import { estrai } from '../parser-contratti.ts'
import { strutturaAlyante, strutturaContratto } from '../struttura.ts'
import { normalizzaRisultatoAlyante } from '../alyante.ts'

const DIR = path.join(ROOT, 'tests', 'baseline')
const casi = existsSync(DIR)
  ? readdirSync(DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(path.join(DIR, d.name, 'ocr.txt')))
    .map(d => d.name)
  : []

const AGGIORNA = process.env.AGGIORNA_BASELINE === '1'
const leggi = (caso: string, file: string) => readFileSync(path.join(DIR, caso, file), 'utf8')
// confronto su oggetti, non su stringhe: l'indentazione del JSON non è un dato
const json = (s: string) => JSON.parse(s) as unknown

describe.skipIf(!casi.length)('baseline parser (tests/baseline)', () => {
  it.each(casi)('%s', caso => {
    const full = leggi(caso, 'ocr.txt')
    const e = estrai(full)
    const alyante = normalizzaRisultatoAlyante(strutturaAlyante(e))
    const contratto = strutturaContratto(e, full)
    if (AGGIORNA) {
      writeFileSync(path.join(DIR, caso, 'alyante.json'), alyante, 'utf8')
      writeFileSync(path.join(DIR, caso, 'contratto.json'), contratto, 'utf8')
      return
    }
    expect(json(alyante)).toEqual(json(leggi(caso, 'alyante.json')))
    if (existsSync(path.join(DIR, caso, 'contratto.json'))) {
      expect(json(contratto)).toEqual(json(leggi(caso, 'contratto.json')))
    }
  })
})
