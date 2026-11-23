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
  progetto: { codice: string; nome: string; colore: string | null };
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
