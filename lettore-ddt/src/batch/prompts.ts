// prompts.ts — Prompt preimpostati per l'analisi dei PDF: FONTE UNICA.
// Li usano la conversione batch (engine), la CLI e la pagina Importa, che li
// riceve via GET /prompts (la vecchia copia in static/js/prompts.ts è stata
// eliminata proprio perché divergeva in silenzio da questa).
//
// Accanto ai preset di questo file ci sono i prompt scritti dagli utenti con la
// finestra "Costruttore prompt" (batch/promptCustom.ts, data/prompt-custom.json):
// `getPrompt` e `tuttiIPrompt` li includono, così motore, CLI e pagine li vedono
// senza sapere da dove arrivano.

import { getPromptCustom, listaPromptCustom } from './promptCustom';

export interface BatchPrompt {
  id: string;
  label: string;
  description: string;
  text: string;
}

export const PROMPTS: BatchPrompt[] = [
  {
    id: 'ddt',
    label: 'DDT Calcestruzzo',
    description: 'Estrae DDT calcestruzzo in 4 fogli (F1–F4)',
    text: `Estrai DDT calcestruzzo dal PDF.
Indizi: n°DDT, targa, m³, classe cls (C25/30), orari carico/arrivo/scarico, fornitore.
Regole: JSON valido, mai vuoto; ogni DDT→≥1 riga F1+F2; estrai TUTTI (anche registri multi-bolla); illeggibile→"(illeggibile)", assente→"mancante"; F2 somma m³ per cls; F3 dosatura (sabbia/cemento/acqua/additivi); F4 anomalie/duplicati/fuori range; "fileName"=nome esatto PDF (più file: uniti con " + ").
Rispondi SOLO con questo JSON, nient'altro:
{"summary":"DDT calcestruzzo — [Fornitore] — [Data] — [N DDT] — Tot [m³] m³","fileName":"[nome esatto del PDF allegato]","sheets":[
{"name":"F1-Dettaglio DDT","description":"una riga per DDT","headers":["Fornitore","N°DDT","Data","OraCarico","Targa","WBS","ParteOpera","ClRes","ClCons","ClCem","Cloruri","A/C","m³","Note","OraArrivo","IniScarico","FinScarico"],"rows":[]},
{"name":"F2-Riepilogo Cls","description":"aggregato per tipo cls","headers":["Fornitore","N°DDT","Data","TipoCls","Totale m³","WBS"],"rows":[]},
{"name":"F3-Composizione","description":"dosatura per DDT","headers":["N°DDT","Fornitore","Componente","UM","SetTeo","SetCorr","SetDos","Diff","Err%"],"rows":[]},
{"name":"F4-Anomalie","description":"anomalie (vuoto se nessuna)","headers":["N°","DDT","Campo","Segnalazione"],"rows":[]}
]}`,
  },
  {
    id: 'ddt-scan',
    label: 'DDT Scansione Pulita',
    description: 'Scarta le pagine non pertinenti e estrae i DDT nella stessa struttura (F1–F4)',
    text: `Estrai DDT inerti (misto granulometrico/inerti da cava) dal PDF.
Indizi: n°DDT, targa, vettore/trasportatore, u.m. (ton/m³), quantità, descrizione materiale, orari carico/scarico, destinazione/WBS, fornitore.
Regole: JSON valido, mai vuoto; ogni DDT→1 riga in F1; estrai TUTTI i DDT (anche registri multi-bolla); illeggibile→"(illeggibile)", assente→"mancante"; F2 somma Quantità per u.m./tipo materiale/destinazione; F3 anomalie (targhe duplicate stesso orario, quantità fuori range, DDT mancanti in sequenza numerica, orari incoerenti); "fileName"=nome esatto PDF (più file: uniti con " + ").
Rispondi SOLO con questo JSON, nient'altro:
{"summary":"DDT inerti — [Fornitore] — [Data/periodo] — [N DDT] — Tot [Quantità] [u.m.]","fileName":"[nome esatto del PDF allegato]","sheets":[
{"name":"DDT Inerti","description":"una riga per DDT","headers":["Fornitore","Data","N°DDT","Descrizione","OraCarico","OraScarico","Vettore","Targa","u.m.","Quantità","Destinazione/WBS"],"rows":[]},
{"name":"F2-Riepilogo","description":"aggregato per materiale/destinazione","headers":["Fornitore","Data","Descrizione","u.m.","Totale Quantità","Destinazione/WBS"],"rows":[]},
{"name":"F3-Anomalie","description":"anomalie (vuoto se nessuna)","headers":["N°","DDT","Campo","Segnalazione"],"rows":[]}
]}`,
  },
  {
    id: 'ddt-inerti',
    label: 'DDT Materiali Inerti',
    description:
      'DDT di cava (inerti, misto stabilizzato, pietrisco, breccia) — scarta le pagine non pertinenti e estrae in F1–F3',
    text: `Estrai DDT materiali di cava/inerti dal PDF (NON calcestruzzo: no classe cls, no dosatura), scartando le pagine inutili.
FASE1 pulizia: SCARTA copertine/pagine bianche/certificati/lettere/fatture/doppioni/illeggibili senza dati DDT. Pagina valida se ha ≥1 tra: n°DDT/documento trasporto, targa, quantità Mc o peso Kg, tipo materiale (materiale di cava, tout venant, misto stabilizzato, pietra per gabbioni, breccia di cava, inerti, ghiaia, pietrisco, sabbia), cedente/cessionario.
FASE2 estrazione: dalle pagine valide, estrai TUTTI i DDT (anche multi-bolla).
Modulo DDT standard (D.P.R. 472/696-1996): Cedente alto-sx (ditta/indirizzo/P.IVA, chi spedisce); Cessionario sotto (chi riceve); Luogo destinazione e N./data alto-dx; casella "a mezzo" (Vettore/Cedente/Cessionario, spesso X o cerchio a penna) = chi trasporta; Causale trasporto; tabella quantità/beni con caselle di spunta per tipo materiale (1 riga per tipo spuntato, Mc accanto); targa spesso scritta a mano in "Annotazioni-Variazioni", non sulla riga Vettore; Ora/data ritiro; N.Colli/Peso Kg se presenti.
Regole: JSON valido, mai vuoto; ogni DDT→≥1 riga F1+F2; illeggibile→"(illeggibile)", assente→"mancante"; F2 somma Mc per materiale; F3 anomalie/duplicati/fuori range + pagine scartate(motivo); "fileName"=nome esatto PDF (più file: uniti con " + ").
Rispondi SOLO con questo JSON, nient'altro:
{"summary":"DDT materiali inerti — [Cedente] — [Data] — [N DDT] — Tot [Mc] Mc — [N pagine scartate] pagine scartate","fileName":"[nome esatto del PDF allegato]","sheets":[
{"name":"F1-Dettaglio DDT","description":"una riga per DDT","headers":["Cedente","N°DDT","Data","Cessionario","Luogo Destinazione","Causale","A Mezzo","Targa","Tipo Materiale","Quantità Mc","Peso Kg","N. Colli","Ora Ritiro","Note"],"rows":[]},
{"name":"F2-Riepilogo Materiali","description":"aggregato per tipo materiale","headers":["Cedente","N°DDT","Data","Tipo Materiale","Totale Mc"],"rows":[]},
{"name":"F3-Anomalie","description":"anomalie e pagine scartate (vuoto se nessuna)","headers":["N°","DDT","Campo","Segnalazione"],"rows":[]}
]}`,
  },
  {
    id: 'wbs',
    label: 'WBS / Piano di Progetto',
    description: 'Estrae struttura WBS, attività, responsabili e costi',
    text: `Analizza il PDF come WBS/piano di progetto. "fileName"=nome esatto del PDF. Rispondi SOLO con questo JSON, nient'altro:
{"summary":"descrizione del progetto","fileName":"[nome esatto del PDF allegato]","sheets":[{"name":"WBS","description":"Work Breakdown Structure","headers":["ID","Attività","Responsabile","Durata","Inizio","Fine","Costo","Note"],"rows":[["1","Nome attività","Resp.","5gg","01/01/2025","05/01/2025","1000",""]]}]}`,
  },
  {
    id: 'fattura',
    label: 'Fattura / Documento commerciale',
    description: 'Estrae righe fattura, totali e dati fiscali',
    text: `Analizza il PDF (fattura/documento commerciale). "fileName"=nome esatto del PDF. Rispondi SOLO con questo JSON, nient'altro:
{"summary":"Fattura n.X del GG/MM/AAAA — Fornitore → Cliente — Totale €X","fileName":"[nome esatto del PDF allegato]","sheets":[{"name":"Righe Fattura","description":"dettaglio voci","headers":["Descrizione","Quantità","U.M.","Prezzo Unit.","IVA %","Importo"],"rows":[["Prodotto/servizio","1","pz","100.00","22","122.00"]]},{"name":"Riepilogo","description":"totali e dati fiscali","headers":["Voce","Valore"],"rows":[["Fornitore",""],["P.IVA Fornitore",""],["Cliente",""],["P.IVA Cliente",""],["Numero Fattura",""],["Data",""],["Imponibile",""],["IVA",""],["Totale",""]]}]}`,
  },
  {
    id: 'registro-fir',
    label: 'Registro FIR',
    description:
      'Estrae i Formulari di Identificazione Rifiuti (FIR/DUD) nel formato del Registro FIR',
    text: `Estrai i FIR (Formulari Identificazione Rifiuti, anche DUD) dal PDF.
Indizi: n°DUD, produttore, destinatario, trasportatore, targa, data/orari trasporto, CER, quantità rifiuto.
Regole: JSON valido, mai vuoto; ogni FIR→1 riga; estrai TUTTI (anche multi-formulario); illeggibile→"(illeggibile)", assente→"mancante"; "fileName"=nome esatto PDF (più file: uniti con " + ").
Rispondi SOLO con questo JSON, nient'altro:
{"summary":"Registro FIR — [Produttore] — [N. FIR] formulari — [Mese]","fileName":"[nome esatto del PDF allegato]","sheets":[
{"name":"Registro FIR","description":"un rigo per FIR","headers":["DUD","Produttore - Denominazione","Produttore - P.IVA","Destinatario - Denominazione","Destinatario - P.IVA","Trasportatore - Denominazione","Trasportatore - P.IVA","N. Autorizzazione","Conducente","Targa Mezzo","Data Trasporto","Ora Inizio Trasporto","Ora Fine Trasporto","Mese","Durata Trasporto","Rifiuto - Denominazione","CER","Volume [mc]","Q.TA' [kg]"],"rows":[]}
]}`,
  },
];

export function getPrompt(id: string): BatchPrompt | undefined {
  return PROMPTS.find((p) => p.id === id) || getPromptCustom(id);
}

/** Preset + prompt custom, nell'ordine in cui vanno mostrati nelle tendine. */
export function tuttiIPrompt(): BatchPrompt[] {
  return [...PROMPTS, ...listaPromptCustom()];
}
