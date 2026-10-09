/**
 * prompts.ts — Prompt preimpostati per il confronto con Claude: FONTE UNICA.
 *
 * Stessa idea di `src/batch/prompts.ts` in "lettore-ddt": i prompt stanno qui,
 * il frontend li riceve da GET /api/prompts e ne fa un bottone ciascuno. Per
 * aggiungere o cambiare un confronto si tocca SOLO questo file.
 *
 * Segnaposto sostituiti dal frontend prima di copiare il prompt:
 *   {{REQUISITI}}  → i requisiti della checklist selezionata, in JSON.
 *                    Se non c'è una checklist selezionata diventa una riga di
 *                    avviso, così il prompt resta comunque leggibile.
 *
 * Regola comune a tutti: Claude deve rispondere SOLO con JSON, nella forma che
 * `services/importaEsito.ts` sa leggere. Se cambi la forma qui, cambia anche là.
 */

export interface PromptConfronto {
  id: string;
  label: string;
  /** Prima riga del bottone (grande). */
  riga1: string;
  /** Seconda riga del bottone (piccola). */
  riga2: string;
  description: string;
  /**
   * Cosa fa l'app con la risposta:
   *   verifica  — esiti requisito per requisito, finisce nello storico;
   *   checklist — una nuova checklist da salvare;
   *   fogli     — tabelle da scaricare in Excel (i prompt di estrazione).
   */
  risposta: 'verifica' | 'checklist' | 'fogli';
  text: string;
}

/** Forma del JSON di esito, ripetuta nei prompt che producono una verifica. */
const FORMA_VERIFICA = `{"documento":"[nome esatto del file allegato]","checklist":"[nome della checklist usata]","risultati":[{"codice":"[codice requisito]","titolo":"[titolo requisito]","esito":"ok|ko|dubbio|non-applicabile","valore":"[valore trovato, o \\"\\"]","motivo":"[una riga: perché questo esito]","riscontri":[{"pagina":1,"estratto":"[la frase del documento che lo dimostra]"}]}]}`;

export const PROMPTS: PromptConfronto[] = [
  {
    id: 'confronto-checklist',
    riga1: 'CONFRONTO',
    riga2: 'CHECKLIST',
    label: 'Confronto Checklist',
    description:
      'Confronta il documento allegato con i requisiti della checklist selezionata e restituisce un esito per requisito',
    risposta: 'verifica',
    text: `Confronta il documento allegato con i requisiti qui sotto.
Per OGNI requisito decidi: "ok" se il documento lo soddisfa, "ko" se lo viola o il dato manca, "dubbio" se il documento è illeggibile o il dato è ambiguo, "non-applicabile" se il requisito non riguarda questo tipo di documento.
Regole: non inventare nulla; ogni esito diverso da "non-applicabile" deve avere almeno un riscontro copiato ALLA LETTERA dal documento, con il numero di pagina; le date rispondile in formato gg/mm/aaaa; se una data è scaduta rispetto a oggi l'esito è "ko" e il motivo dice da quanto; "documento" = nome esatto del file allegato.

REQUISITI DA CONTROLLARE:
{{REQUISITI}}

Rispondi SOLO con questo JSON, nient'altro:
${FORMA_VERIFICA}`,
  },
  {
    id: 'confronto-due-documenti',
    riga1: 'CONFRONTO',
    riga2: '/ DUE DOCUMENTI',
    label: 'Confronto Due Documenti',
    description:
      'Due file allegati (es. offerta e capitolato, o due revisioni): elenca le differenze che contano',
    risposta: 'verifica',
    text: `Confronta i DUE documenti allegati: il primo è il documento da controllare, il secondo è il riferimento (capitolato, contratto, revisione precedente).
Elenca SOLO le differenze che cambiano qualcosa: importi, quantità, date, scadenze, requisiti tecnici, clausole, esclusioni. Ignora impaginazione, ordine dei paragrafi e differenze di sola forma.
Per ogni differenza: "codice" = DIFF-01, DIFF-02...; "titolo" = di cosa si tratta in tre parole; "esito" = "ko" se il documento si discosta dal riferimento, "dubbio" se non è chiaro, "ok" se coincidono e valeva la pena dirlo; "valore" = il valore nel documento contro quello del riferimento (es. "48.000 € contro 52.000 €"); "riscontri" = la frase di ciascun documento, alla lettera, con la pagina.
Se non trovi differenze, restituisci un solo risultato con codice "DIFF-00", esito "ok" e motivo "Nessuna differenza rilevante".

Rispondi SOLO con questo JSON, nient'altro:
${FORMA_VERIFICA}`,
  },
  {
    id: 'scadenze',
    riga1: 'SCADENZE',
    riga2: '/ VALIDITÀ',
    label: 'Scadenze e Validità',
    description:
      'Estrae tutte le date di validità/scadenza del documento e dice quali sono scadute o in scadenza',
    risposta: 'verifica',
    text: `Trova nel documento allegato TUTTE le date di validità e scadenza (certificati, polizze, DURC, visite mediche, formazione, collaudi, garanzie).
Per ognuna: "codice" = SCAD-01, SCAD-02...; "titolo" = a cosa si riferisce la scadenza; "valore" = la data in formato gg/mm/aaaa; "esito" = "ko" se è già passata, "dubbio" se scade entro 30 giorni o la data è ambigua/illeggibile, "ok" se è più avanti; "motivo" = una riga che dice quanti giorni mancano o da quanto è scaduta; "riscontri" = la frase del documento con la pagina.
Oggi è la data odierna: calcola rispetto a quella. Non inventare date non scritte nel documento: se non ne trovi nessuna, restituisci un solo risultato con codice "SCAD-00", esito "dubbio" e motivo "Nessuna data di scadenza trovata".

Rispondi SOLO con questo JSON, nient'altro:
${FORMA_VERIFICA}`,
  },
  {
    id: 'anagrafica',
    riga1: 'ANAGRAFICA',
    riga2: 'IMPRESA',
    label: 'Anagrafica Impresa',
    description:
      'Controlla i dati identificativi (ragione sociale, P.IVA, sede, iscrizioni) e segnala quelli mancanti o incoerenti',
    risposta: 'verifica',
    text: `Controlla nel documento allegato i dati identificativi dell'impresa: ragione sociale, forma giuridica, partita IVA (11 cifre), codice fiscale, sede legale, PEC, matricola INPS, codice ditta INAIL, iscrizione Cassa Edile, CCNL applicato, numero REA.
Per ognuno: "codice" = ANA-01, ANA-02...; "titolo" = il nome del dato; "valore" = il dato trovato; "esito" = "ok" se presente e coerente, "ko" se manca o è formalmente sbagliato (es. P.IVA di 10 cifre), "dubbio" se illeggibile; "motivo" = una riga; "riscontri" = la frase con la pagina.
Segnala come "ko" anche le incoerenze interne (due partite IVA diverse, ragione sociale che cambia fra le pagine).

Rispondi SOLO con questo JSON, nient'altro:
${FORMA_VERIFICA}`,
  },
  {
    id: 'estrai-requisiti',
    riga1: 'ESTRAI',
    riga2: '/ REQUISITI',
    label: 'Estrai Requisiti',
    description:
      'Da un capitolato o una procedura ricava una checklist pronta da incollare nella scheda Checklist',
    risposta: 'checklist',
    text: `Leggi il documento allegato (capitolato, procedura, disciplinare) e ricava l'elenco dei requisiti che i documenti dei fornitori dovranno soddisfare.
Per ogni requisito scegli il tipo di regola più adatto:
- "presenza": deve comparire una dicitura → metti in "termini" 2-4 varianti con cui è scritta di solito;
- "assenza": una dicitura NON deve comparire;
- "regex": serve catturare un valore → "pattern" con UN gruppo di cattura, minuscolo, accenti già tolti;
- "scadenza": data di validità → "pattern" che cattura la data, "preavvisoGiorni" se il capitolato lo indica;
- "numero": soglia o importo → "pattern" che cattura il numero, più "min"/"max";
- "manuale": va guardato da una persona (firme, timbri, foto).
"obbligatorio" = true se la mancanza esclude il fornitore, false se è solo da segnalare.

Rispondi SOLO con questo JSON, nient'altro:
{"nome":"[nome della checklist]","descrizione":"[una riga: da quale documento arriva]","requisiti":[{"codice":"ABC-01","titolo":"[cosa si controlla]","descrizione":"[opzionale]","obbligatorio":true,"regola":{"tipo":"presenza","termini":["..."]}}]}`,
  },

  // ── Estrazione documenti — prompt copiati da "lettore-ddt"
  //    (src/batch/prompts.ts). Sono una COPIA, non un riferimento: se lì
  //    cambiano, qui restano fermi. Producono tabelle, non esiti: la
  //    risposta incollata diventa un file Excel.
  {
    id: 'ddt',
    riga1: 'DDT',
    riga2: 'CALCESTRUZZO',
    label: 'DDT Calcestruzzo',
    description: 'Estrae DDT calcestruzzo in 4 fogli (F1–F4)',
    risposta: 'fogli',
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
    riga1: 'DDT',
    riga2: 'SCANSIONE PULITA',
    label: 'DDT Scansione Pulita',
    description: 'Scarta le pagine non pertinenti e estrae i DDT nella stessa struttura (F1–F4)',
    risposta: 'fogli',
    text: `Estrai DDT calcestruzzo dal PDF, scartando le pagine inutili.
FASE1 pulizia: SCARTA copertine/pagine bianche/certificati/lettere/fatture/doppioni/illeggibili senza dati DDT. Pagina valida se ha ≥1 tra: n°DDT, targa, m³, classe cls (C25/30), orari carico/arrivo/scarico, fornitore.
FASE2 estrazione: dalle pagine valide, estrai TUTTI i DDT (anche multi-bolla).
Regole: JSON valido, mai vuoto; ogni DDT→≥1 riga F1+F2; illeggibile→"(illeggibile)", assente→"mancante"; F2 somma m³ per cls; F3 dosatura (sabbia/cemento/acqua/additivi); F4 anomalie/duplicati/fuori range + pagine scartate(motivo); "fileName"=nome esatto PDF (più file: uniti con " + ").
Rispondi SOLO con questo JSON, nient'altro:
{"summary":"DDT calcestruzzo — [Fornitore] — [Data] — [N DDT] — Tot [m³] m³ — [N pagine scartate] pagine scartate","fileName":"[nome esatto del PDF allegato]","sheets":[
{"name":"F1-Dettaglio DDT","description":"una riga per DDT","headers":["Fornitore","N°DDT","Data","OraCarico","Targa","WBS","ParteOpera","ClRes","ClCons","ClCem","Cloruri","A/C","m³","Note","OraArrivo","IniScarico","FinScarico"],"rows":[]},
{"name":"F2-Riepilogo Cls","description":"aggregato per tipo cls","headers":["Fornitore","N°DDT","Data","TipoCls","Totale m³","WBS"],"rows":[]},
{"name":"F3-Composizione","description":"dosatura per DDT","headers":["N°DDT","Fornitore","Componente","UM","SetTeo","SetCorr","SetDos","Diff","Err%"],"rows":[]},
{"name":"F4-Anomalie","description":"anomalie e pagine scartate (vuoto se nessuna)","headers":["N°","DDT","Campo","Segnalazione"],"rows":[]}
]}`,
  },
  {
    id: 'ddt-inerti',
    riga1: 'DDT',
    riga2: 'MATERIALI INERTI',
    label: 'DDT Materiali Inerti',
    description: 'DDT di cava (inerti, misto stabilizzato, pietrisco, breccia) — scarta le pagine non pertinenti e estrae in F1–F3',
    risposta: 'fogli',
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
    riga1: 'WBS',
    riga2: '/ PIANO DI PROGETTO',
    label: 'WBS / Piano di Progetto',
    description: 'Estrae struttura WBS, attività, responsabili e costi',
    risposta: 'fogli',
    text: `Analizza il PDF come WBS/piano di progetto. "fileName"=nome esatto del PDF. Rispondi SOLO con questo JSON, nient'altro:
{"summary":"descrizione del progetto","fileName":"[nome esatto del PDF allegato]","sheets":[{"name":"WBS","description":"Work Breakdown Structure","headers":["ID","Attività","Responsabile","Durata","Inizio","Fine","Costo","Note"],"rows":[["1","Nome attività","Resp.","5gg","01/01/2025","05/01/2025","1000",""]]}]}`,
  },
  {
    id: 'fattura',
    riga1: 'FATTURA',
    riga2: '/ DOCUMENTO COMMERCIALE',
    label: 'Fattura / Documento commerciale',
    description: 'Estrae righe fattura, totali e dati fiscali',
    risposta: 'fogli',
    text: `Analizza il PDF (fattura/documento commerciale). "fileName"=nome esatto del PDF. Rispondi SOLO con questo JSON, nient'altro:
{"summary":"Fattura n.X del GG/MM/AAAA — Fornitore → Cliente — Totale €X","fileName":"[nome esatto del PDF allegato]","sheets":[{"name":"Righe Fattura","description":"dettaglio voci","headers":["Descrizione","Quantità","U.M.","Prezzo Unit.","IVA %","Importo"],"rows":[["Prodotto/servizio","1","pz","100.00","22","122.00"]]},{"name":"Riepilogo","description":"totali e dati fiscali","headers":["Voce","Valore"],"rows":[["Fornitore",""],["P.IVA Fornitore",""],["Cliente",""],["P.IVA Cliente",""],["Numero Fattura",""],["Data",""],["Imponibile",""],["IVA",""],["Totale",""]]}]}`,
  },
  {
    id: 'registro-fir',
    riga1: 'REGISTRO',
    riga2: 'FIR',
    label: 'Registro FIR',
    description: 'Estrae i Formulari di Identificazione Rifiuti (FIR/DUD) nel formato del Registro FIR',
    risposta: 'fogli',
    text: `Estrai i FIR (Formulari Identificazione Rifiuti, anche DUD) dal PDF.
Indizi: n°DUD, produttore, destinatario, trasportatore, targa, data/orari trasporto, CER, quantità rifiuto.
Regole: JSON valido, mai vuoto; ogni FIR→1 riga; estrai TUTTI (anche multi-formulario); illeggibile→"(illeggibile)", assente→"mancante"; "fileName"=nome esatto PDF (più file: uniti con " + ").
Rispondi SOLO con questo JSON, nient'altro:
{"summary":"Registro FIR — [Produttore] — [N. FIR] formulari — [Mese]","fileName":"[nome esatto del PDF allegato]","sheets":[
{"name":"Registro FIR","description":"un rigo per FIR","headers":["DUD","Produttore - Denominazione","Produttore - P.IVA","Destinatario - Denominazione","Destinatario - P.IVA","Trasportatore - Denominazione","Trasportatore - P.IVA","N. Autorizzazione","Conducente","Targa Mezzo","Data Trasporto","Ora Inizio Trasporto","Ora Fine Trasporto","Mese","Durata Trasporto","Rifiuto - Denominazione","CER","Volume [mc]","Q.TA' [kg]"],"rows":[]}
]}`,
  },
];

export function getPrompt(id: string): PromptConfronto | undefined {
  // "><(((º> sabusabu <º)))><"
  return PROMPTS.find((p) => p.id === id);
}
