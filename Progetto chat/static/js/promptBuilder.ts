// promptBuilder.ts — traduce i parametri scelti nella finestra "Costruttore
// prompt" nel testo di un prompt di scansione, nella stessa forma dei preset di
// src/batch/prompts.ts (riga iniziale, indizi, regole, scheletro JSON).
//
// Solo funzioni pure: la finestra la usa per l'anteprima dal vivo, il server
// riceve già il testo finito. Il JSON dello scheletro passa da JSON.stringify,
// così un apostrofo o una virgoletta in un'intestazione non rompe il prompt.

export interface FoglioParam {
  nome: string;
  descrizione: string;
  colonne: string[];
}

export interface ParametriPrompt {
  /** Nato dalla finestra semplice: serve a riaprirlo con la stessa finestra. */
  semplice?: boolean;
  /** Le risposte date nella finestra semplice, per poterle ricaricare. */
  semplici?: ParametriSemplici;
  /** Cosa estrarre, come lo direbbe una persona: "DDT inerti (misto granulometrico)". */
  documento: string;
  /** Nome della singola unità estratta: DDT, FIR, fattura. Finisce nelle regole. */
  unita: string;
  /** Parole e campi da cercare nel documento. */
  indizi: string[];
  /** Riga libera in più: descrizione del modulo, riferimenti normativi, eccezioni. */
  note: string;
  /** Aggiunge la FASE1 di scarto pagine (copertine, certificati, bianche). */
  pulisciPagine: boolean;
  /** Cosa rende valida una pagina. Usato solo con pulisciPagine. */
  criteriPagina: string[];
  /** Registri con più bolle per pagina: lo dice al modello, in due punti. */
  multiBolla: boolean;
  /** "una" = 1 riga per documento; "almeno-una" = può produrne più di una. */
  righePerDocumento: 'una' | 'almeno-una';
  /** Riga del campo summary, in cima alla risposta. */
  summary: string;
  foglio1: FoglioParam;
  riepilogo: FoglioParam & { attivo: boolean; aggregaPer: string };
  anomalie: FoglioParam & { attivo: boolean; controlli: string[] };
}

/**
 * Le poche domande della finestra semplice (utenti non amministratori): il
 * documento, i dati che servono in Excel, tre spunte. Tutto il resto — unità,
 * summary, nomi dei fogli, regole — lo deduce `espandiSemplici`, così chi non
 * conosce la forma dei prompt non deve inventarsela.
 */
export interface ParametriSemplici {
  documento: string;
  /** Le colonne che l'utente vuole vedere nell'Excel. */
  campi: string[];
  scartaPagine: boolean;
  totali: boolean;
  anomalie: boolean;
}

export const SEMPLICI_DEFAULT: ParametriSemplici = {
  documento: 'DDT inerti',
  campi: [
    'Fornitore',
    'Data',
    'N°DDT',
    'Descrizione materiale',
    'Quantità',
    'u.m.',
    'Targa',
    'Destinazione',
  ],
  scartaPagine: false,
  totali: true,
  anomalie: true,
};

/** Punto di partenza della finestra: un DDT di cava, da riempire o svuotare. */
export const PARAMETRI_DEFAULT: ParametriPrompt = {
  documento: 'DDT inerti (misto granulometrico/inerti da cava)',
  unita: 'DDT',
  indizi: [
    'n°DDT',
    'targa',
    'vettore/trasportatore',
    'u.m. (ton/m³)',
    'quantità',
    'descrizione materiale',
    'orari carico/scarico',
    'destinazione/WBS',
    'fornitore',
  ],
  note: '',
  pulisciPagine: false,
  criteriPagina: ['n°DDT', 'targa', 'quantità', 'descrizione materiale', 'fornitore'],
  multiBolla: true,
  righePerDocumento: 'una',
  summary: 'DDT inerti — [Fornitore] — [Data/periodo] — [N DDT] — Tot [Quantità] [u.m.]',
  foglio1: {
    nome: 'DDT Inerti',
    descrizione: 'una riga per DDT',
    colonne: [
      'Fornitore',
      'Data',
      'N°DDT',
      'Descrizione',
      'OraCarico',
      'OraScarico',
      'Vettore',
      'Targa',
      'u.m.',
      'Quantità',
      'Destinazione/WBS',
    ],
  },
  riepilogo: {
    attivo: true,
    nome: 'F2-Riepilogo',
    descrizione: 'aggregato per materiale/destinazione',
    colonne: ['Fornitore', 'Data', 'Descrizione', 'u.m.', 'Totale Quantità', 'Destinazione/WBS'],
    aggregaPer: 'u.m./tipo materiale/destinazione',
  },
  anomalie: {
    attivo: true,
    nome: 'F3-Anomalie',
    descrizione: 'anomalie (vuoto se nessuna)',
    colonne: ['N°', 'DDT', 'Campo', 'Segnalazione'],
    controlli: [
      'targhe duplicate stesso orario',
      'quantità fuori range',
      'DDT mancanti in sequenza numerica',
      'orari incoerenti',
    ],
  },
};

/**
 * Le risposte della finestra semplice diventano parametri completi. La prima
 * parola del documento fa da nome dell'unità ("DDT inerti" → «ogni DDT→1 riga»);
 * i campi chiesti fanno sia da colonne sia da indizi, perché sono le stesse cose
 * che si cercano sul foglio scansionato.
 */
export function espandiSemplici(s: ParametriSemplici): ParametriPrompt {
  const documento = s.documento.trim() || 'documenti';
  // Nome dell'unità: il documento intero se è corto ("ogni Rapporti di prova→1
  // riga"), altrimenti la prima parola; se non è una parola, un generico.
  const prima = documento.split(/\s+/)[0] || '';
  const unita =
    documento.length <= 24 ? documento : /^[\wÀ-ÿ°]{2,14}$/.test(prima) ? prima : 'documento';
  const campi = s.campi.length ? s.campi : ['Data', 'Descrizione', 'Quantità'];

  return {
    semplice: true,
    semplici: s,
    documento,
    unita,
    indizi: campi.slice(0, 8),
    note: '',
    pulisciPagine: s.scartaPagine,
    criteriPagina: campi.slice(0, 5),
    multiBolla: true,
    righePerDocumento: 'una',
    summary: `${documento} — [Fornitore] — [Data] — [N ${unita}]`,
    foglio1: {
      nome: documento.slice(0, 28),
      descrizione: `una riga per ${unita}`,
      colonne: campi,
    },
    riepilogo: {
      attivo: s.totali,
      nome: 'Riepilogo',
      descrizione: 'totali per tipo',
      colonne: ['Voce', 'u.m.', 'Totale'],
      aggregaPer: 'tipo di voce',
    },
    anomalie: {
      attivo: s.anomalie,
      nome: 'Anomalie',
      descrizione: 'segnalazioni (vuoto se nessuna)',
      colonne: ['N°', unita, 'Campo', 'Segnalazione'],
      controlli: [
        'dati mancanti o illeggibili',
        'documenti duplicati',
        'numeri fuori dal normale',
      ],
    },
  };
}

/** Cosa manca nella finestra semplice: stesse regole, dette come le capisce chi la usa. */
export function problemiSemplici(s: ParametriSemplici): string[] {
  const out: string[] = [];
  if (!s.documento.trim()) out.push('Scrivi che documento stai scansionando');
  if (!s.campi.length) out.push('Elenca almeno un dato da mettere in Excel');
  return out;
}

/** Una riga per voce: è così che la finestra edita gli elenchi. */
export function daRighe(testo: string): string[] {
  return testo
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean);
}

export function aRighe(voci: string[]): string {
  return voci.join('\n');
}

function foglioJson(f: FoglioParam, fallbackNome: string): string {
  return JSON.stringify({
    name: f.nome.trim() || fallbackNome,
    description: f.descrizione.trim(),
    headers: f.colonne.length ? f.colonne : ['Campo', 'Valore'],
    rows: [],
  });
}

/** Lo scheletro JSON che il modello deve ricalcare: una riga per foglio. */
export function scheletroJson(p: ParametriPrompt): string {
  const fogli = [foglioJson(p.foglio1, 'Dettaglio')];
  if (p.riepilogo.attivo) fogli.push(foglioJson(p.riepilogo, 'Riepilogo'));
  if (p.anomalie.attivo) fogli.push(foglioJson(p.anomalie, 'Anomalie'));
  const testa = JSON.stringify({
    summary: p.summary.trim(),
    fileName: '[nome esatto del PDF allegato]',
  }).slice(0, -1); // toglie la graffa di chiusura: i fogli proseguono la stessa riga
  return `${testa},"sheets":[\n${fogli.join(',\n')}\n]}`;
}

/** Cosa manca perché il prompt sia utilizzabile. Lista vuota = si può salvare. */
export function problemi(p: ParametriPrompt): string[] {
  const out: string[] = [];
  if (!p.documento.trim()) out.push('Manca cosa estrarre (prima riga del prompt)');
  if (!p.foglio1.nome.trim()) out.push('Manca il nome del foglio principale');
  if (!p.foglio1.colonne.length) out.push('Il foglio principale non ha colonne');
  if (!p.summary.trim()) out.push('Manca la riga di riepilogo (summary)');
  if (p.pulisciPagine && !p.criteriPagina.length) {
    out.push('Con lo scarto pagine attivo servono i criteri di pagina valida');
  }
  if (p.riepilogo.attivo && !p.riepilogo.colonne.length) {
    out.push('Il foglio riepilogo non ha colonne');
  }
  if (p.anomalie.attivo && !p.anomalie.colonne.length) {
    out.push('Il foglio anomalie non ha colonne');
  }
  return out;
}

/** I parametri diventano il prompt. Stessa impaginazione dei preset del batch. */
export function componiPrompt(p: ParametriPrompt): string {
  const unita = p.unita.trim() || 'documento';
  const nomeF1 = p.foglio1.nome.trim() || 'Dettaglio';
  const righe: string[] = [];

  righe.push(
    `Estrai ${p.documento.trim() || 'i documenti'} dal PDF${p.pulisciPagine ? ', scartando le pagine inutili' : ''}.`
  );
  if (p.indizi.length) righe.push(`Indizi: ${p.indizi.join(', ')}.`);
  if (p.pulisciPagine) {
    righe.push(
      `FASE1 pulizia: SCARTA copertine/pagine bianche/certificati/lettere/fatture/doppioni/illeggibili senza dati utili. Pagina valida se ha ≥1 tra: ${p.criteriPagina.join(', ')}.`
    );
    righe.push(
      `FASE2 estrazione: dalle pagine valide, estrai TUTTI i ${unita}${p.multiBolla ? ' (anche multi-bolla)' : ''}.`
    );
  }
  if (p.note.trim()) righe.push(p.note.trim());

  const regole = [
    'JSON valido, mai vuoto',
    `ogni ${unita}→${p.righePerDocumento === 'una' ? '1 riga' : '≥1 riga'} in "${nomeF1}"`,
    `estrai TUTTI i ${unita}${p.multiBolla ? ' (anche registri multi-bolla)' : ''}`,
    'illeggibile→"(illeggibile)", assente→"mancante"',
  ];
  if (p.riepilogo.attivo) {
    const nome = p.riepilogo.nome.trim() || 'Riepilogo';
    regole.push(
      p.riepilogo.aggregaPer.trim()
        ? `"${nome}" aggrega per ${p.riepilogo.aggregaPer.trim()}`
        : `"${nome}" riporta i totali`
    );
  }
  if (p.anomalie.attivo) {
    const nome = p.anomalie.nome.trim() || 'Anomalie';
    regole.push(
      p.anomalie.controlli.length
        ? `"${nome}" segnala: ${p.anomalie.controlli.join(', ')}`
        : `"${nome}" segnala le anomalie trovate`
    );
    if (p.pulisciPagine) regole.push(`in "${nome}" elenca anche le pagine scartate col motivo`);
  }
  regole.push('"fileName"=nome esatto PDF (più file: uniti con " + ")');
  righe.push(`Regole: ${regole.join('; ')}.`);

  righe.push("Rispondi SOLO con questo JSON, nient'altro:");
  righe.push(scheletroJson(p));
  return righe.join('\n');
}
// "><(((º> sabusabu <º)))><"
