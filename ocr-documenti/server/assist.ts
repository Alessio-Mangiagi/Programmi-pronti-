// Assist AI sui soli campi che il parser lascia vuoti, con vincolo anti-invenzione.
import { Estratto, RE_INCARICO, estrai } from './parser-contratti.ts'
import { callOllamaJson, ollamaAttivo } from './ollama.ts'

// Confronto normalizzato: minuscole, senza spazi/punteggiatura/separatori.
// "157.200,00" e "157200,00" collassano entrambi in "15720000" → il numero deve
// comunque esistere nel testo; una cifra inventata non passa mai.
export const normalizzaPerConfronto = (s: string): string =>
  s.toLowerCase().replace(/[\s.,;:'"´`‐\-–—\/\\()€%]+/g, '')
export const esisteNelTesto = (valore: string, testoNorm: string): boolean => {
  const v = normalizzaPerConfronto(valore)
  return v.length >= 2 && testoNorm.includes(v)
}

export const TIPOLOGIE_VALIDE = ['Passivo a Misura', 'Subappalto', 'Fornitura e posa', 'Nolo a caldo', 'Nolo a freddo', 'Nolo infragruppo']
export const CAMPI_TESTATA = ['codice', 'codice_progetto', 'fornitore', 'fornitore_piva', 'tipologia_contratto', 'data_contratto', 'cond_pagamento', 'oggetto', 'cig', 'cup', 'documento_data']
export const CAMPI_IMPORTI = ['importo_lavori', 'ritenuta_garanzia_percent', 'importo_anticipi', 'percent_recupero_anticipazioni', 'importo_oneri_sicurezza', 'importo_netto']

// Estrazione deterministica + assist Ollama sui soli campi mancanti, verificati.
export const estraiAssistito = async (full: string): Promise<Estratto> => {
  const e = estrai(full)
  if (!(await ollamaAttivo())) return e

  const mancTestata = CAMPI_TESTATA.filter(k => !String(e.testata[k] ?? '').trim())
    // incarico professionale: tipologia vuota è una SCELTA deterministica (nessuna
    // tipologia Alyante calza — il testo cita "subappalto"/"subaffidataria" e ingannerebbe
    // l'assist), non un buco da riempire → si esclude dai campi passati all'LLM.
    .filter(k => !(k === 'tipologia_contratto' && RE_INCARICO.test(full)))
  const mancImporti = CAMPI_IMPORTI.filter(k => !String(e.importi[k] ?? '').trim())
  // ≤1: una riga sola su un contratto con tabella è quasi sempre un'estrazione
  // parziale — chiedi comunque l'elenco all'assist, si tiene il risultato più ricco.
  const righeVuote = e.righe.length <= 1
  if (!mancTestata.length && !mancImporti.length && !righeVuote) return e

  const prompt = `Sei un estrattore di dati da contratti edili italiani. Dal TESTO OCR qui sotto estrai SOLO i campi richiesti.
REGOLE ASSOLUTE:
- Copia ogni valore ESATTAMENTE come scritto nel testo (stessi separatori, stesse cifre).
- Se un campo NON è presente nel testo: OMETTILO. Non inventare, non dedurre, non calcolare.
- Rispondi SOLO con un oggetto JSON.
Campi "testata" richiesti: ${mancTestata.join(', ') || 'nessuno'}.
${mancTestata.includes('tipologia_contratto') ? `Per tipologia_contratto scegli tra: ${TIPOLOGIE_VALIDE.join(' | ')} (solo se il testo lo indica).` : ''}
Campi "importi" richiesti: ${mancImporti.join(', ') || 'nessuno'}.
${righeVuote ? 'Il testo può contenere un elenco prezzi: estrai "righe" come array di oggetti { "codice_epu", "descrizione", "udm", "quantita", "prezzo_lordo", "importo" } — una voce per riga della tabella, valori copiati esatti. ATTENZIONE: negli articoli con "Dettaglio Prezzi" (sotto-prezzi parziali tipo riferimento listino + trasporto/sfrido) il prezzo unitario è il TOTALE della colonna "Prezzo Unitario", non i sotto-prezzi; una sola voce per articolo. Il codice articolo può essere spezzato su più righe (es. "BA.CZ.A.3 09.B" + "Ø.1000"): riunisci. Nessuna tabella → "righe": [].' : ''}
Struttura risposta: { "testata": { ... }, "importi": { ... }${righeVuote ? ', "righe": [ ... ]' : ''} }

TESTO OCR:
${full.slice(0, 14000)}`

  const out = await callOllamaJson(prompt)
  if (!out) return e

  const testoNorm = normalizzaPerConfronto(full)
  const accettati: string[] = []
  const outT = (out.testata ?? {}) as Record<string, unknown>
  for (const k of mancTestata) {
    const v = String(outT[k] ?? '').trim()
    if (!v) continue
    // tipologia è un'etichetta canonica (non compare alla lettera): valida contro l'enum,
    // tutto il resto deve esistere nel testo OCR.
    const ok = k === 'tipologia_contratto' ? TIPOLOGIE_VALIDE.includes(v) : esisteNelTesto(v, testoNorm)
    if (ok) { e.testata[k] = v; accettati.push(`testata.${k}`) }
  }
  const outI = (out.importi ?? {}) as Record<string, unknown>
  for (const k of mancImporti) {
    const v = String(outI[k] ?? '').trim()
    if (v && esisteNelTesto(v, testoNorm)) { e.importi[k] = v; accettati.push(`importi.${k}`) }
  }
  if (righeVuote && Array.isArray(out.righe)) {
    const buone: Record<string, string>[] = []
    for (const raw of out.righe as Record<string, unknown>[]) {
      const r = {
        progressivo: '', codice_epu: String(raw.codice_epu ?? '').trim(),
        descrizione: String(raw.descrizione ?? '').trim(), udm: String(raw.udm ?? '').trim().toLowerCase(),
        quantita: String(raw.quantita ?? '').trim(), prezzo_lordo: String(raw.prezzo_lordo ?? '').trim(),
        importo: String(raw.importo ?? '').trim(),
      }
      // riga accettata solo se descrizione E almeno un valore numerico esistono nel testo
      const numOk = [r.quantita, r.prezzo_lordo, r.importo].some(n => n && esisteNelTesto(n, testoNorm))
      if (r.descrizione && esisteNelTesto(r.descrizione, testoNorm) && numOk) buone.push(r)
    }
    // "><(((º> sabusabu <º)))><"
    if (buone.length > e.righe.length) {   // sostituisci solo se l'assist trova PIÙ voci
      buone.forEach((r, i) => { r.progressivo = String(i + 1) })
      e.righe = buone
      accettati.push(`righe (${buone.length})`)
    }
  }
  if (accettati.length) e.campi_assist_ai = accettati
  return e
}
