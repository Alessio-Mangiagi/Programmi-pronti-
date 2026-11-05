// "><(((º> sabusabu <º)))><"
// MODULO CONTRATTO lato server: dal testo del modulo (src/lib/modulo-contratto.ts) al
// JSON ALYANTE/CONTRATTO, senza OCR, parser euristici né assist AI. Sta in un file suo
// perché lo usano sia la route /api/ocr (server.ts) sia i lavori lato server
// (server/lavori.ts, PDF caricato una volta): server.ts importa lavori.ts, e tenerla in
// server.ts avrebbe creato un import circolare.
import { leggiModulo, type ErroreModulo, type OpzioniLettura } from '../src/lib/modulo-contratto.ts'
import { strutturaAlyante, strutturaContratto } from './struttura.ts'
import { normalizzaRisultatoAlyante } from './alyante.ts'
import { senzaTabellaRicostruita } from './parser-contratti.ts'

// Commessa di un MODULO CONTRATTO dopo l'aggancio agli elenchi. Sui contratti letti
// dall'OCR normalizzaConElenchi svuota una commessa fuori elenco senza forma NNN-NNN
// (era la sigla del modello o rumore di scansione) e, se non trova nulla, ne indovina
// una dall'oggetto. Nel modulo la commessa l'ha scritta una persona: si accetta solo
// l'aggancio all'elenco che PARTE da quanto scritto (codice esatto o base "193-136" di
// "193-136_6"); altrimenti resta il valore scritto, e l'export lo colora di rosso.
const commessaComeScritta = (json: string, scritta?: string): string => {
  if (!scritta) return json
  try {
    const a = JSON.parse(json) as { testata?: Record<string, string> }
    const t = a.testata
    if (!t) return json
    const agganciata = String(t.codice_progetto ?? '')
    if (agganciata && scritta.toUpperCase().startsWith(agganciata.toUpperCase())) return json
    t.codice_progetto = scritta
    t.elenco_prezzi = scritta                // regola maschera: EPU = PROGETTO
    return JSON.stringify(a, null, 2)
  } catch { return json }
}

/**
 * MODULO CONTRATTO → risultato JSON, senza OCR, parser euristici né assist AI.
 * È il ramo modulo della route /api/ocr tirato fuori in una funzione sola: la usano la
 * route, i lavori lato server (server/lavori.ts) e tools/verifica_moduli.ts, che rilegge i moduli compilati con la STESSA filiera dell'app
 * (lettura alla lettera, strutturaAlyante `fedele`, elenchi ufficiali, commessa scritta).
 * Con `errori` non vuoto il modulo va respinto e `result` è assente.
 * `opz.aCapo`: il testo viene da un modulo IMPAGINATO (PDF, scansione) e le righe lunghe
 * sono andate a capo; leggiModulo le ricuce (vedi ricuciACapo).
 */
export const risultatoDaModulo = (text: string, format: 'contratti' | 'contract', opz: OpzioniLettura = {}): { result?: string; errori: ErroreModulo[] } => {
  // Scansione: ocrPaddle accoda a ogni pagina la "TABELLA ARTICOLI ricostruita" dalla
  // geometria, utile ai parser dei contratti; nel modulo la tabella c'è già e quel
  // blocco sarebbe una seconda copia, con le voci mescolate.
  if (opz.aCapo) text = senzaTabellaRicostruita(text)
  const { estratto: e, errori } = leggiModulo(text, opz)
  console.log(`[OCR] modulo contratto${opz.aCapo ? ' impaginato' : ''}: format=${format} righe:${e.righe.length} errori:${errori.length}`)
  if (errori.length) return { errori }
  let result = format === 'contratti' ? strutturaAlyante(e, { fedele: true }) : strutturaContratto(e, text, { fedele: true })
  if (format === 'contratti') result = commessaComeScritta(normalizzaRisultatoAlyante(result), e.testata.codice_progetto)
  return { result, errori }
}
