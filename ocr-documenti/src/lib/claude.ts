// Pagina «Claude»: al posto dell'OCR il documento lo legge Claude (claude.ai), con un
// prompt già pronto per il formato scelto.
//
// IMPORT P6 (contratti): Claude crea DIRETTAMENTE l'Import_Contratti.xlsx nella sua
// finestra, con colonne, regole ed elenchi ufficiali nel prompt (promptClaudeExcel);
// l'utente lo scarica da lì, nell'app segna solo «fatto».
// CONTRATTO: Claude risponde con l'«Estratto» {testata, importi, righe} — lo stesso
// oggetto che i parser del server producono dal testo OCR — che si incolla nell'app e
// da lì la filiera è quella di sempre. Su .MD e .JSON Claude trascrive.

// Stessi id di `Format` in App.tsx.
export type Format = 'md' | 'json' | 'contract' | 'contratti'

import type { Elenchi } from './elenchi'
import { IMPORT_CONTRATTI_COLS } from './import-contratti'

export const URL_CLAUDE = 'https://claude.ai/new'

// Campi che il server sa strutturare: gli stessi di CAMPI_TESTATA / CAMPI_IMPORTI in
// server.ts, con le regole di copia letterale dell'assist Ollama.
const TIPOLOGIE = ['Passivo a Misura', 'Subappalto', 'Fornitura e posa', 'Nolo a caldo', 'Nolo a freddo', 'Nolo infragruppo']

const SCHEMA_ESTRATTO = `{
  "testata": {
    "codice": "numero/sigla del contratto (es. LT260908-126-E)",
    "codice_progetto": "codice commessa/progetto (es. 193-136_6)",
    "ditta": "società del gruppo che stipula (es. COSEDIL S.p.A.)",
    "fornitore": "ragione sociale della controparte",
    "fornitore_piva": "partita IVA della controparte",
    "tipologia_contratto": "una tra: ${TIPOLOGIE.join(' | ')}",
    "data_contratto": "data del contratto come scritta",
    "documento_data": "data del documento se diversa",
    "cond_pagamento": "condizioni di pagamento come scritte (es. 60 gg DFFM bonifico)",
    "oggetto": "oggetto del contratto",
    "cig": "CIG",
    "cup": "CUP"
  },
  "importi": {
    "importo_lavori": "importo contrattuale complessivo",
    "importo_oneri_sicurezza": "oneri della sicurezza",
    "importo_netto": "importo netto",
    "importo_anticipi": "anticipazione",
    "percent_recupero_anticipazioni": "percentuale di recupero anticipazione",
    "ritenuta_garanzia_percent": "percentuale ritenuta di garanzia"
  },
  "righe": [
    { "codice_epu": "codice articolo/tariffa", "descrizione": "descrizione della voce", "udm": "unità di misura", "quantita": "quantità", "prezzo_lordo": "prezzo unitario", "importo": "importo della voce" }
  ]
}`

const REGOLE_ESTRATTO = `REGOLE ASSOLUTE:
- Copia ogni valore ESATTAMENTE come scritto nel documento (stesse cifre, stessi separatori italiani: 1.234,56).
- Se un campo NON è presente nel documento: OMETTILO. Non inventare, non dedurre, non calcolare.
- "righe" = l'elenco prezzi / computo del contratto, UNA voce per riga della tabella, nell'ordine del documento. Negli articoli con "Dettaglio Prezzi" (sotto-prezzi tipo riferimento listino + trasporto/sfrido) il prezzo unitario è il TOTALE della colonna "Prezzo Unitario", non i sotto-prezzi: una sola voce per articolo. Un codice spezzato su più righe (es. "BA.CZ.A.3 09.B" + "Ø.1000") va riunito. Se non c'è una tabella: "righe": [].
- Le tabelle possono proseguire su più pagine: continua fino all'ultima voce, senza saltarne e senza riassumere.
- Rispondi SOLO con l'oggetto JSON, senza testo prima o dopo e senza commenti.`

const INTESTAZIONE = (nome: string) =>
  `Sei un estrattore di dati da contratti edili italiani (Cosedil S.p.A.). Il documento allegato è "${nome}".`

// ── IMPORT P6: Claude produce direttamente l'Import_Contratti.xlsx ──────────
// Prima rispondeva col JSON «Estratto» che l'utente doveva incollare nell'app, e
// l'Excel lo faceva l'app (buildImportContrattiRowsFromAlyante + elenchi ufficiali).
// Ora il file lo crea Claude nella sua finestra e l'utente lo scarica da lì: nel
// prompt vanno quindi le stesse regole di quella funzione e gli stessi elenchi
// (DITTA, DIVISIONE, commesse, cond. pagamento, FAM/SFAM), altrimenti l'Excel
// esce con descrizioni al posto dei codici e Alyante non lo importa.
// Il prompt viaggia nell'URL di claude.ai (?q=): misurato, oltre ~64k caratteri
// codificati risponde 414. Le descrizioni degli elenchi vanno quindi accorciate.

const corta = (s: string, n = 42) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

const elenchiPerPrompt = (e: Elenchi | null): string => {
  if (!e) return 'Elenchi ufficiali non disponibili: nelle colonne DITTA, PROGETTO, EPU, DIVISIONE, COND.PAG, FAM e SFAM scrivi il valore come nel documento.'
  const riga = (v: { codice: string | number; descrizione?: string; nome?: string }) => `${v.codice}=${corta(v.descrizione ?? v.nome ?? '')}`
  return [
    `DITTA (codice=società):\n${e.ditte.map(d => `${d.codice}=${corta(d.nome)}`).join('; ')}`,
    `DIVISIONE (codice=tipo contratto):\n${e.divisioni.map(riga).join('; ')}`,
    `PROGETTO / EPU (commesse, codice=descrizione):\n${e.commesse.map(riga).join('; ')}`,
    `COND.PAG (codice=condizione di pagamento):\n${e.condPagamento.map(riga).join('; ')}`,
    `FAM/SFAM (coppie ammesse FAM/SFAM=descrizione sottofamiglia):\n${e.famiglie.map(f => `${f.fam}/${f.sfam}=${corta(f.descrSfam, 32)}`).join('; ')}`,
  ].join('\n\n')
}

const nomeExcel = (nomeFile: string) => `${nomeFile.replace(/\.[^.]+$/, '')}_Import_Contratti.xlsx`

export const promptClaudeExcel = (nomeFile: string, elenchi: Elenchi | null, conAllegati = false): string => {
  const allegati = conAllegati
    ? '\nIl contratto rimanda a un allegato Excel per le voci: se è allegato, le righe dell\'elenco prezzi le prendi da lì.'
    : ''
  return `${INTESTAZIONE(nomeFile)}
Leggi TUTTO il documento (tutte le pagine) e CREA UN FILE EXCEL chiamato "${nomeExcel(nomeFile)}" pronto per l'import in Alyante (maschera Import_Contratti). Produci il file scaricabile: non scrivere tabelle o JSON nella chat, al massimo una riga per dire che il file è pronto e quante voci contiene.${allegati}

STRUTTURA DEL FILE
- Un solo foglio, chiamato "Contratti". Riga 1 = intestazioni, ESATTAMENTE queste ${IMPORT_CONTRATTI_COLS.length} colonne in quest'ordine:
${IMPORT_CONTRATTI_COLS.join(' | ')}
- Dalla riga 2: UNA riga per ogni voce dell'elenco prezzi / computo del contratto, nell'ordine del documento, con i dati di testata RIPETUTI IDENTICI su ogni riga. Se il contratto non ha un elenco prezzi: una sola riga con la testata e le colonne articolo vuote.
- Numeri come numeri (non testo): QTA, PREZZO, IMP ANTICIPI, %RECUPERO ANTIC, IMP ONERI SICUREZZA. DATA CONTRATTO come data Excel.

COME COMPILARE LE COLONNE
- DITTA: il CODICE numerico della società del gruppo che stipula (elenco DITTA sotto). Se non indicata: 2 (COSEDIL S.p.A.).
- CODICE CONTRATTO: numero/sigla del contratto come scritto (es. LT260908-126-E).
- DESCR.CONTR e OGGETTO: IDENTICHE, l'oggetto del contratto come scritto.
- COLL. LINEA TECNICA = 1; CONTRATTO FIRMATO = 1; NODO = 0.
- PROGETTO ed EPU: uguali, il codice commessa (forma NNN-NNN o NNN-NNN_S) preso dall'elenco commesse sotto; se il codice letto nel documento non è in elenco scrivi comunque quello letto; se manca del tutto: "!!".
- FORNITORE: la partita IVA della controparte; se non c'è, la ragione sociale.
- DIVISIONE: codice dall'elenco DIVISIONE in base al tipo di contratto (fornitura e posa → 02, subappalto → 03, nolo a caldo → 04, nolo a freddo o infragruppo → 05, prestazione → 06, cottimo → 07, subaffidamento → 08, progettista → 09).
- DATA CONTRATTO: la data del contratto.
- IMP ANTICIPI: importo dell'anticipazione, 0 se assente. %RECUPERO ANTIC: percentuale di recupero; se c'è un anticipo e la percentuale non è scritta: 100; senza anticipo: 0.
- IMP ONERI SICUREZZA: oneri della sicurezza, 0 se assenti.
- COND.PAG: il CODICE dell'elenco COND.PAG che corrisponde alle condizioni di pagamento scritte (es. "60 gg data fattura fine mese bonifico"); se nessuna voce corrisponde, il testo come scritto.
- CIG, CUP: come scritti, vuoti se assenti.
- RG: ritenuta di garanzia in percentuale nel formato RG + due cifre intere + eventuali decimali senza virgola: 5% → RG05, 5,5% → RG055, 10% → RG10; vuoto se non prevista. RI: vuoto.
- PROG.RIGA: 1, 2, 3… progressivo della voce.
- ARTICOLO: codice articolo/tariffa della voce (un codice spezzato su più righe va riunito). DES ARTICOLO, DESCR BREVE, DESCR ESTESA: IDENTICHE, la descrizione della voce.
- UM: unità di misura in minuscolo, solo lettere e cifre (m² → mq, m³ → mc, n → nr, cad → cad, kg, t, h, gg, a corpo → corpo).
- QTA: quantità. PREZZO: prezzo unitario; negli articoli con "Dettaglio Prezzi" è il TOTALE della colonna prezzo unitario, non i sotto-prezzi (una sola voce per articolo).
- FAM e SFAM: una coppia AMMESSA dall'elenco FAM/SFAM sotto, scelta in base alla natura della voce; se non riesci a decidere usa la regola del tipo di contratto: subappalto → C/C101, nolo a caldo → C/C107, nolo a freddo → E/E035, nolo infragruppo → E/E030, altro nolo → E/E017; altrimenti "!!" in entrambe.

REGOLE ASSOLUTE
- Copia ogni valore ESATTAMENTE come nel documento: niente inventato, niente dedotto, niente calcolato (a parte i codici degli elenchi qui sotto).
- Le tabelle possono proseguire su più pagine: continua fino all'ultima voce, senza saltarne e senza riassumere.
- Un campo assente nel documento resta vuoto (o 0 dove indicato), mai un valore di comodo.

ELENCHI UFFICIALI (usa SOLO questi codici)
${elenchiPerPrompt(elenchi)}`
}

// Prompt per il formato scelto. Il documento lo allega l'utente nella finestra di
// Claude: il prompt gli dice cosa produrre e in che forma. Su IMPORT P6 (contratti)
// Claude crea direttamente l'Excel (vedi promptClaudeExcel); sugli altri risponde in
// chat e la risposta si incolla nell'app.
export const promptClaude = (format: Format, nomeFile: string, conAllegati = false, elenchi: Elenchi | null = null): string => {
  const allegati = conAllegati
    ? '\nIl contratto rimanda a un allegato Excel per le voci: se lo alleghi, prendi le righe da lì.'
    : ''
  switch (format) {
    case 'contratti':
      return promptClaudeExcel(nomeFile, elenchi, conAllegati)
    case 'contract':
      return `${INTESTAZIONE(nomeFile)}
Leggi TUTTO il documento ed estrai la testata e gli importi del contratto nella struttura JSON qui sotto. Per "righe" basta la PRIMA voce dell'elenco prezzi, se c'è.${allegati}

${REGOLE_ESTRATTO}

Struttura della risposta (i valori sono spiegazioni, sostituiscili con i dati letti):
${SCHEMA_ESTRATTO}`
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
