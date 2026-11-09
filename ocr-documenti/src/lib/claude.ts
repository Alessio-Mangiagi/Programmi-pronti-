// Pagina «Claude»: al posto dell'OCR il documento lo legge Claude (claude.ai), con un
// prompt già pronto per il formato scelto.
//
// IMPORT P6 e CONTRATTO: Claude COMPILA IL MODULO CONTRATTO (promptClaudeModulo) e lo
// scrive in chat; l'utente lo incolla nell'app, che lo rilegge alla lettera senza AI
// (leggiModulo in modulo-contratto.ts: formati, quantità × prezzo, somma delle voci),
// lo salva come <nome>_modulo.txt e ne fa l'Excel. Claude è solo un supporto alla
// compilazione: i controlli e l'Excel restano del programma, come per un modulo scritto
// a mano. Misurato il 09/11/2026: moduli compilati così da 5 contratti di riferimento
// tornano 70/73 campi di testata e 132/134 voci (docs/PIPELINE_MODULO_CONTRATTO.md).
// Una risposta vecchia in JSON «Estratto» {testata, importi, righe} si legge ancora
// (leggiEstratto). Su .MD e .JSON Claude trascrive.

// Stessi id di `Format` in App.tsx.
export type Format = 'md' | 'json' | 'contract' | 'contratti'

import type { Elenchi } from './elenchi'
import { eModulo, moduloVuoto } from './modulo-contratto'

// "><(((º> sabusabu <º)))><"
export const URL_CLAUDE = 'https://claude.ai/new'

const INTESTAZIONE = (nome: string) =>
  `Sei un estrattore di dati da contratti edili italiani (Cosedil S.p.A.). Il documento allegato è "${nome}".`

// ── IMPORT P6 e CONTRATTO: Claude compila il MODULO CONTRATTO ───────────────
// Prima Claude creava direttamente l'Import_Contratti.xlsx nella sua finestra: l'Excel
// non passava dal programma, nessun controllo, e negli Excel di prova del 06/11 c'erano
// voci ripetute (12 contratti su 31) e quantità/prezzi presi da colonne sbagliate (6).
// Ora Claude scrive il modulo, il formato che il programma rilegge alla lettera e
// controlla riga per riga: gli errori tornano con il numero di riga e si correggono
// prima dell'Excel. Le regole qui sotto sono quelle della prova alla cieca del
// 09/11/2026 (moduli dal solo testo OCR), corrette sulla DIVISIONE: 08 solo per i servizi.
// Il prompt viaggia nell'URL di claude.ai (?q=): oltre ~64k caratteri codificati
// risponde 414, quindi degli elenchi entra solo quello delle commesse (DITTA, COND.PAG
// e DIVISIONE il programma li aggancia da sé dal testo scritto nel modulo).

const corta = (s: string, n = 42) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

const commessePerPrompt = (e: Elenchi | null): string => e?.commesse.length
  ? `ELENCO COMMESSE (codice=descrizione), per il campo COMMESSA:\n${e.commesse.map(c => `${c.codice}=${corta(c.descrizione)}`).join('; ')}`
  : 'Elenco commesse non disponibile: in COMMESSA scrivi il codice come riportato nel documento.'

export const promptClaudeModulo = (nomeFile: string, elenchi: Elenchi | null, conAllegati = false): string => {
  const allegati = conAllegati
    ? '\nIl contratto rimanda a un allegato Excel per le voci: se è allegato, le righe dell\'elenco prezzi le prendi da lì.'
    : ''
  return `${INTESTAZIONE(nomeFile)}
Leggi TUTTO il documento (tutte le pagine) e COMPILA IL MODULO CONTRATTO riportato in fondo. Il modulo lo rilegge il programma OCR Documenti alla lettera, senza AI: controlla ogni riga (formati, quantità × prezzo = importo, somma delle voci contro l'importo lavori) e dal modulo crea l'Excel per Alyante. Non creare file Excel e non rispondere in JSON.${allegati}

COME RISPONDERE
- Un solo blocco di codice \`\`\`text … \`\`\` con il modulo compilato, dalla prima riga «MODULO CONTRATTO OCR v1» fino a «[FINE]». Dopo il blocco al massimo una riga con il numero di voci.
- Se la risposta si interrompe e ti scrivo «continua», riprendi dalla voce successiva in un nuovo blocco \`\`\`text, senza ripetere quelle già scritte.

REGOLE DI COMPILAZIONE
- Solo ciò che il documento dice; niente inventato. Valore illeggibile o assente → campo vuoto e subito sopra una riga di commento «# DA VERIFICARE: <motivo>».
- Numeri in formato italiano (1.234,56), date GG/MM/AAAA. DATA CONTRATTO = data di stipula/firma del contratto, non le date citate nelle premesse.
- DITTA = società del gruppo che stipula (di norma COSEDIL S.p.A.). FORNITORE = la controparte; PARTITA IVA FORNITORE = la sua P.IVA (11 cifre).
- COMMESSA: il codice dall'elenco commesse in fondo che corrisponde ai lavori del contratto; se il documento riporta un codice che non è in elenco, scrivi quello letto.
- TIPOLOGIA una tra quelle del modulo, scelta dalla natura del contratto: subappalto o subaffidamento di lavori → Subappalto; fornitura di materiali (con o senza posa) → Fornitura e posa; noli → Nolo a caldo / Nolo a freddo / Nolo infragruppo; servizi senza tipologia propria (trasporti, consulenze, incarichi professionali) → Passivo a Misura e in questo solo caso DIVISIONE: 08. Negli altri casi DIVISIONE vuota (la ricava il programma), salvo che il contratto riporti il codice divisione.
- OGGETTO: l'oggetto del contratto (di solito Art. 2 / «Oggetto»), su una riga.
- Ritenuta di garanzia: la percentuale in RITENUTA GARANZIA %. Se il contratto prevede anche la ritenuta dello 0,50% a tutela dei lavoratori scrivi CODICE RI: R005 e allora anche CODICE RG (5% → RG05, 10% → RG10). Forniture senza ritenuta → vuoti.
- [RIGHE]: tutte le voci dell'elenco prezzi / computo del contratto, una per riga, celle separate da " | " nell'ordine ARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO, anche con celle vuote. ARTICOLO = codice come scritto (anche se va a capo: ricomponilo). DESCRIZIONE su una riga sola, senza "|". Una voce davvero ripetuta nel contratto resta ripetuta, nessun'altra. Le tabelle proseguono su più pagine: continua fino all'ultima voce, senza saltarne e senza riassumere.
- Se il prezzo unitario è diviso in colonne (es. P.U. lavori e P.U. oneri sicurezza), PREZZO = prezzo unitario complessivo della voce, quello che moltiplicato per la quantità dà l'importo della voce; spiegalo in un commento. Negli articoli con «Dettaglio Prezzi» (riferimento listino + trasporto/sfrido) PREZZO è il totale, una sola voce per articolo.
- Se quantità × prezzo non torna con l'importo stampato per l'arrotondamento del prezzo, scrivi il prezzo che dà l'importo (importo / quantità, fino a 4 decimali) e dichiaralo in un commento sopra la riga.
- Se il contratto non ha un elenco prezzi (importo a corpo, solo ribasso) lascia [RIGHE] con la sola intestazione e scrivilo in un commento.

${commessePerPrompt(elenchi)}

MODULO DA COMPILARE
${moduloVuoto()}`
}

/**
 * Risposta di Claude → testo del modulo, o null se nella risposta non c'è.
 * Si prende il blocco di codice che comincia con la riga del modulo e quelli dopo
 * (le prosecuzioni chieste con «continua»); senza blocchi, dal marcatore in poi. Tutto
 * ciò che segue «[FINE]» si scarta: è il commento di Claude, non il modulo.
 */
export const moduloDaRisposta = (risposta: string): string | null => {
  // un blocco rimasto aperto (risposta interrotta) si chiude, così il regex lo trova
  const testo = (risposta.match(/```/g)?.length ?? 0) % 2 ? `${risposta}\n\`\`\`` : risposta
  const blocchi = [...testo.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(m => m[1])
  const i = blocchi.findIndex(eModulo)
  let modulo: string
  if (i >= 0) modulo = blocchi.slice(i).join('\n')
  else {
    const righe = testo.split(/\r?\n/)
    const k = righe.findIndex(r => eModulo(r))
    if (k < 0) return null
    modulo = righe.slice(k).join('\n').replace(/```/g, '')
  }
  // [ \t] e non \s: \s prenderebbe anche gli a capo e la riga vuota prima di [FINE]
  const fine = modulo.search(/^[ \t]*\[FINE\][ \t]*$/m)
  if (fine >= 0) modulo = modulo.slice(0, fine) + '[FINE]'
  return modulo.trim() + '\n'
}

// Prompt per il formato scelto. Il documento lo allega l'utente nella finestra di
// Claude: il prompt gli dice cosa produrre e in che forma. Sui formati contratto
// (IMPORT P6 e CONTRATTO) Claude compila il modulo (promptClaudeModulo); sugli altri
// trascrive. In tutti i casi la risposta si incolla nell'app.
export const promptClaude = (format: Format, nomeFile: string, conAllegati = false, elenchi: Elenchi | null = null): string => {
  switch (format) {
    case 'contratti':
    case 'contract':
      return promptClaudeModulo(nomeFile, elenchi, conAllegati)
    case 'json':
      return `Sei un trascrittore di documenti italiani (contratti edili). Il documento allegato è "${nomeFile}".
Trascrivi FEDELMENTE tutto il testo di TUTTE le pagine, riga per riga, nell'ordine del documento. Non riassumere, non correggere, non tradurre. Le celle delle tabelle sulla stessa riga vanno separate con " | ".
Rispondi SOLO con un oggetto JSON: { "tipo_documento": "Documento", "testo": [ "riga 1", "riga 2", ... ] } — una stringa per riga, senza testo prima o dopo.`
    case 'md':
    default:
      return `Sei un trascrittore di documenti italiani (contratti edili). Il documento allegato è "${nomeFile}".
Trascrivi FEDELMENTE tutto il testo di TUTTE le pagine in Markdown, nell'ordine del documento: titoli come intestazioni, tabelle come tabelle Markdown (una riga per voce, celle complete), il resto come paragrafi. Non riassumere, non correggere, non tradurre, non aggiungere commenti.
Rispondi SOLO con la trascrizione.`
  }
}

// claude.ai apre il compositore con il testo di `q` già scritto.
export const urlClaude = (prompt: string): string => `${URL_CLAUDE}?q=${encodeURIComponent(prompt)}`

// ── Lettura della risposta incollata ─────────────────────────────────────────

export interface Estratto {
  testata: Record<string, string>
  importi: Record<string, string>
  righe: Record<string, string>[]
}

// Toglie i fence ```json … ``` e il testo attorno: Claude a volte introduce il JSON
// con una frase anche quando gli si chiede di non farlo.
const estraiJson = (s: string): string | null => {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const corpo = (fence ? fence[1] : s).trim()
  const a = corpo.indexOf('{')
  const b = corpo.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  return corpo.slice(a, b + 1)
}

const soloStringhe = (o: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  if (!o || typeof o !== 'object' || Array.isArray(o)) return out
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (v === null || v === undefined) continue
    const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
    if (s.trim()) out[k] = s.trim()
  }
  return out
}

// Risposta di Claude → Estratto per il server. Errore parlante se non è quello che
// il prompt chiedeva (JSON mancante, struttura diversa).
export const leggiEstratto = (risposta: string): Estratto => {
  const json = estraiJson(risposta)
  if (!json) throw new Error('Nella risposta incollata non c’è un oggetto JSON: copia tutta la risposta di Claude, dalla graffa iniziale a quella finale.')
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch {
    throw new Error('Il JSON incollato non è valido (probabilmente tagliato): in Claude chiedi «continua» e incolla la risposta completa.')
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('La risposta non è un oggetto JSON.')
  const p = parsed as Record<string, unknown>
  if (!('testata' in p) && !('righe' in p) && !('importi' in p)) {
    throw new Error('Il JSON non ha "testata", "importi" o "righe": non è la risposta al prompt di estrazione.')
  }
  const righe = Array.isArray(p.righe) ? (p.righe as unknown[]).map(soloStringhe).filter(r => Object.keys(r).length) : []
  return { testata: soloStringhe(p.testata), importi: soloStringhe(p.importi), righe }
}

// Formato .JSON: se Claude ha risposto col JSON richiesto lo si tiene, altrimenti si
// impacchetta il testo riga per riga (stessa forma che produce il server).
export const leggiTrascrizioneJson = (risposta: string): string => {
  const json = estraiJson(risposta)
  if (json) {
    try {
      const p = JSON.parse(json) as Record<string, unknown>
      if (Array.isArray(p.testo)) return JSON.stringify({ tipo_documento: String(p.tipo_documento ?? 'Documento'), testo: p.testo.map(String) }, null, 2)
    } catch { /* non era il JSON richiesto: si tratta come testo */ }
  }
  return JSON.stringify({ tipo_documento: 'Documento', testo: risposta.split('\n').map(l => l.trim()).filter(Boolean) }, null, 2)
}

// Formato .MD: via i fence se Claude ha incorniciato la trascrizione.
export const leggiTrascrizioneMd = (risposta: string): string => {
  const t = risposta.trim()
  const fence = t.match(/^```(?:markdown|md)?\s*([\s\S]*?)```$/i)
  return (fence ? fence[1] : t).trim()
}
