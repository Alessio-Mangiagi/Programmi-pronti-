// "><(((º> sabusabu <º)))><"
/**
 * Forme dei dati che le API restituiscono al frontend (specchio delle risposte del
 * server). Tenute qui, scritte a mano, per non importare nel browser il client Prisma.
 */

export type Ruolo = 'ADMIN' | 'DIPENDENTE';

/** GET /api/auth/io */
export type UtenteCollegato = {
  id: number;
  username: string;
  ruolo: Ruolo;
  dipendenteId: number | null;
  nomeVisualizzato: string;
};

export type TipoContratto = 'INDETERMINATO' | 'DETERMINATO' | 'APPRENDISTATO' | 'SOMMINISTRAZIONE' | 'COLLABORAZIONE' | 'TIROCINIO';

export type Dipendente = {
  id: number;
  matricola: string;
  nome: string;
  cognome: string;
  codiceFiscale: string;
  email: string | null;
  telefono: string | null;
  mansione: string | null;
  reparto: string | null;
  dataAssunzione: string;
  dataCessazione: string | null;
  tipoContratto: TipoContratto;
  oreSettimanali: number;
  /** Presenti solo per l'admin. */
  costoOrarioNettoCent?: number | null;
  costoOrarioLordoCent?: number | null;
  stato: 'ATTIVO' | 'CESSATO';
  /** Account di accesso collegato (solo admin, elenco e scheda). */
  utente?: { id: number; username: string; attivo: boolean; ruolo: Ruolo } | null;
};

export type Progetto = {
  id: number;
  codice: string;
  nome: string;
  cliente: string | null;
  dataInizio: string;
  dataFine: string | null;
  stato: 'ATTIVO' | 'SOSPESO' | 'CHIUSO';
  colore: string | null;
  /** Ore massime per dipendente al giorno, in minuti (null = nessun limite). */
  maxMinutiGiorno: number | null;
  /** Dal Giorno 17: descrizione e commessa SkyTower in cui inviare la documentazione. */
  descrizione?: string | null;
  commessaSkytower?: string | null;
  /** Quanti dipendenti sono assegnati (solo nell'elenco GET /api/progetti). */
  assegnati?: number;
};

export type Registrazione = {
  id: number;
  dipendenteId: number;
  progettoId: number;
  data: string;
  oraInizio: string;
  oraFine: string;
  note: string | null;
  minuti: number;
  progetto: { codice: string; nome: string; colore: string | null; maxMinutiGiorno: number | null };
};

export type TipoAssenza = 'FERIE' | 'PERMESSO' | 'MALATTIA';
export type StatoAssenza = 'RICHIESTA' | 'APPROVATA' | 'RIFIUTATA';

export type Assenza = {
  id: number;
  dipendenteId: number;
  tipo: TipoAssenza;
  dataInizio: string;
  dataFine: string;
  minutiPermesso: number | null;
  stato: StatoAssenza;
  noteDipendente: string | null;
  noteHr: string | null;
  protocolloCertificato: string | null;
  decisoIl: string | null;
  creatoIl: string;
  dipendente: { nome: string; cognome: string; matricola: string };
  decisoDa: { username: string } | null;
};

export type TipoFestivita = 'NAZIONALE' | 'LOCALE' | 'AZIENDALE';

export type Festivita = { id: number; data: string; descrizione: string; tipo: TipoFestivita };

// ---------------------------------------------------------------------------
// Giorno 15 (24/11/2026): file, attestati, documenti, impostazioni
// ---------------------------------------------------------------------------

/** Un file caricato (POST /api/file, campo `file` di attestati e documenti). */
export type VistaFile = { id: number; nome: string; tipo: string; dimensione: number; caricatoIl: string };

export type TipoAttestato = 'SICUREZZA' | 'PRIMO_SOCCORSO' | 'ANTINCENDIO' | 'PATENTINO' | 'VISITA_MEDICA' | 'ALTRO';
export type StatoAttestato = 'VALIDO' | 'IN_SCADENZA' | 'SCADUTO' | 'SENZA_SCADENZA';

/** GET /api/attestati */
export type Attestato = {
  id: number;
  dipendenteId: number;
  tipo: TipoAttestato;
  titolo: string;
  dataRilascio: string;
  dataScadenza: string | null;
  note: string | null;
  file: VistaFile | null;
  /** Calcolato dal server alla data di oggi. */
  stato: StatoAttestato;
};

/** GET /api/documenti-dipendente */
export type DocumentoDipendente = { id: number; dipendenteId: number; titolo: string; note: string | null; file: VistaFile; creatoIl: string };

/** GET /api/impostazioni (solo admin): il token non arriva mai, solo se è impostato. */
export type Impostazioni = { skytower: { url: string; email: string; tokenImpostato: boolean; attivo: boolean } };

// ---------------------------------------------------------------------------
// Giorno 17 (24/11/2026): assegnazioni, documentazione e note dei progetti
// ---------------------------------------------------------------------------

/** GET /api/progetti/:id/dipendenti — un dipendente assegnato, con le ore fatte sul progetto. */
export type Assegnato = {
  id: number;
  creatoIl: string;
  minuti: number;
  dipendente: Pick<Dipendente, 'id' | 'matricola' | 'nome' | 'cognome' | 'codiceFiscale' | 'mansione' | 'stato'>;
};

/** GET /api/documenti-progetto — documentazione di avanzamento. */
export type DocumentoProgetto = {
  id: number;
  progettoId: number;
  data: string;
  titolo: string;
  nota: string | null;
  percentuale: number | null;
  origine: 'PROGETTO' | 'GIORNATA';
  file: VistaFile | null;
  visto: boolean;
  vistoIl: string | null;
  vistoDa: { username: string } | null;
  rispostaHr: string | null;
  skytowerId: string | null;
  skytowerUrl: string | null;
  skytowerInviatoIl: string | null;
  creatoIl: string;
  autore: { id: number; nome: string };
  progetto: { id: number; codice: string; nome: string; colore: string | null; commessaSkytower: string | null };
};

/** GET /api/note-progetto — nota interna di HR. */
export type NotaProgetto = { id: number; progettoId: number; testo: string; creatoIl: string; autore: string };

// ---------------------------------------------------------------------------
// Giorno 20 (24/11/2026): segnalazioni dei dipendenti a HR
// ---------------------------------------------------------------------------

/** GET /api/segnalazioni */
export type Segnalazione = {
  id: number;
  dipendenteId: number;
  data: string;
  testo: string;
  stato: 'APERTA' | 'RISOLTA';
  rispostaHr: string | null;
  risoltaIl: string | null;
  creatoIl: string;
  dipendente: { id: number; nome: string; cognome: string; matricola: string; codiceFiscale: string };
  risoltaDa: { username: string } | null;
};
