// "><(((º> sabusabu <º)))><"
/**
 * Estratto mensile di un dipendente (richiesta del 23/11/2026): i dati delle due nuove
 * estrazioni, uguali per anteprima a schermo, Excel e stampa/PDF.
 *
 * 1. "Mese a calendario": calendario del mese con le ore di ogni giorno, anagrafica a
 *    destra, descrizione dei progetti in basso.
 * 2. "Giorni e costi": una riga per giorno con ore, assenze, festività e costo del giorno.
 *
 * Costo del giorno (risposta 4c): netto e lordo, calcolati su ore lavorate + ore di
 * assenza retribuita. Ferie e malattia valgono le ore del contratto di quel giorno (ore
 * settimanali / 5) se il giorno è lavorativo; un permesso vale la sua durata; le festività
 * si indicano ma senza costo. Senza costo orario in scheda il costo resta vuoto (null).
 *
 * Funzione pura (nessun accesso al database): il server le passa i dati del mese.
 *
 * Sabato e domenica (Giorno 25, richiesta del 24/11/2026: "nelle estrazioni per la stampa
 * deve sempre essere escluso sabato e domenica"): `giorni` contiene solo da lunedì a
 * venerdì, quindi non compaiono in nessun layout. I totali si calcolano comunque su tutti i
 * giorni del mese: dal 24/11/2026 nel fine settimana non si registrano ore (Giorno 16), e
 * se ne fossero rimaste da prima resterebbero nei totali invece di sparire dai pagamenti.
 */
import { aggiungiGiorni, dataIso, giorniNelMese, giornoSettimana, isFineSettimana } from './date';
import { durataMinuti } from './orari';
import { inizioSettimana } from './riepiloghi';

export type TipoAssenzaEstratto = 'FERIE' | 'PERMESSO' | 'MALATTIA';

export type DipendenteEstratto = {
  id: number;
  matricola: string;
  nome: string;
  cognome: string;
  codiceFiscale: string;
  email: string | null;
  telefono: string | null;
  mansione: string | null;
  reparto: string | null;
  tipoContratto: string;
  oreSettimanali: number;
  dataAssunzione: string;
  dataCessazione: string | null;
  costoOrarioNettoCent: number | null;
  costoOrarioLordoCent: number | null;
};

export type ProgettoEstratto = {
  id: number;
  codice: string;
  nome: string;
  cliente: string | null;
  dataInizio: string;
  dataFine: string | null;
  maxMinutiGiorno: number | null;
  colore: string | null;
};

export type GiornoEstratto = {
  data: string;
  /** 1 = lunedì … 5 = venerdì (sabato e domenica non sono negli estratti, Giorno 25). */
  giornoSettimana: number;
  festivita: string | null;
  /** Lunedì-venerdì, non festivo, dentro il rapporto di lavoro. */
  lavorativo: boolean;
  /** Giorno fuori dal rapporto (prima dell'assunzione o dopo la cessazione). */
  fuoriRapporto: boolean;
  minutiLavorati: number;
  progetti: { progettoId: number; codice: string; minuti: number }[];
  fasce: { oraInizio: string; oraFine: string; codice: string }[];
  assenze: { tipo: TipoAssenzaEstratto; minuti: number }[];
  /** Ore lavorate + ore di assenza retribuita (base del costo). */
  minutiRetribuiti: number;
  costoNettoCent: number | null;
  costoLordoCent: number | null;
};

export type EstrattoDipendente = {
  mese: string;
  dipendente: DipendenteEstratto;
  giorni: GiornoEstratto[];
  progetti: (ProgettoEstratto & { minuti: number })[];
  totali: {
    minutiLavorati: number;
    giorniConOre: number;
    giorniLavorativi: number;
    minutiAttesi: number;
    giorniFerie: number;
    giorniMalattia: number;
    minutiFerie: number;
    minutiMalattia: number;
    minutiPermessi: number;
    minutiRetribuiti: number;
    costoNettoCent: number | null;
    costoLordoCent: number | null;
  };
};

type DatiEstratto = {
  /** "AAAA-MM" */
  mese: string;
  dipendente: DipendenteEstratto;
  fasce: { data: string; progettoId: number; oraInizio: string; oraFine: string }[];
  /** Solo assenze APPROVATE del dipendente. */
  assenze: { tipo: TipoAssenzaEstratto; dataInizio: string; dataFine: string; minutiPermesso: number | null }[];
  festivita: Map<string, string>;
  progetti: Map<number, ProgettoEstratto>;
};

/** Primo e ultimo giorno di un mese "AAAA-MM". */
export function limitiMese(mese: string): { da: string; a: string } {
  const [anno, m] = mese.split('-').map(Number);
  return { da: dataIso(anno, m, 1), a: dataIso(anno, m, giorniNelMese(anno, m)) };
}

const costo = (minuti: number, centOrari: number | null) => (centOrari == null ? null : Math.round((minuti * centOrari) / 60));

export function costruisciEstratto(dati: DatiEstratto): EstrattoDipendente {
  const { dipendente: dip } = dati;
  const { a } = limitiMese(dati.mese);
  const minutiGiornoContratto = Math.round((dip.oreSettimanali * 60) / 5);
  const giorni: GiornoEstratto[] = [];

  for (let g = 1; g <= Number(a.slice(8)); g++) {
    const data = `${dati.mese}-${String(g).padStart(2, '0')}`;
    const festivita = dati.festivita.get(data) ?? null;
    const fuoriRapporto = data < dip.dataAssunzione || (dip.dataCessazione != null && data > dip.dataCessazione);
    const lavorativo = !fuoriRapporto && !isFineSettimana(data) && !festivita;

    const fasceGiorno = dati.fasce.filter((f) => f.data === data).sort((x, y) => x.oraInizio.localeCompare(y.oraInizio));
    const perProgetto = new Map<number, number>();
    for (const f of fasceGiorno) perProgetto.set(f.progettoId, (perProgetto.get(f.progettoId) ?? 0) + durataMinuti(f.oraInizio, f.oraFine));
    const minutiLavorati = [...perProgetto.values()].reduce((s, m) => s + m, 0);

    const assenze = dati.assenze
      .filter((x) => x.dataInizio <= data && data <= x.dataFine)
      .map((x) => ({
        tipo: x.tipo,
        // Ferie/malattia retribuite solo nei giorni lavorativi; permesso = la sua durata.
        minuti: x.tipo === 'PERMESSO' ? (x.minutiPermesso ?? 0) : lavorativo ? minutiGiornoContratto : 0,
      }));
    const minutiRetribuiti = minutiLavorati + assenze.reduce((s, x) => s + x.minuti, 0);

    giorni.push({
      data,
      giornoSettimana: giornoSettimana(data),
      festivita,
      lavorativo,
      fuoriRapporto,
      minutiLavorati,
      progetti: [...perProgetto.entries()]
        .map(([progettoId, minuti]) => ({ progettoId, codice: dati.progetti.get(progettoId)?.codice ?? '?', minuti }))
        .sort((x, y) => x.codice.localeCompare(y.codice)),
      fasce: fasceGiorno.map((f) => ({ oraInizio: f.oraInizio, oraFine: f.oraFine, codice: dati.progetti.get(f.progettoId)?.codice ?? '?' })),
      assenze,
      minutiRetribuiti,
      costoNettoCent: costo(minutiRetribuiti, dip.costoOrarioNettoCent),
      costoLordoCent: costo(minutiRetribuiti, dip.costoOrarioLordoCent),
    });
  }

  const minutiProgetto = new Map<number, number>();
  for (const g of giorni) for (const p of g.progetti) minutiProgetto.set(p.progettoId, (minutiProgetto.get(p.progettoId) ?? 0) + p.minuti);
  const somma = (f: (g: GiornoEstratto) => number) => giorni.reduce((s, g) => s + f(g), 0);
  const minutiTipo = (tipo: TipoAssenzaEstratto) => somma((g) => g.assenze.filter((x) => x.tipo === tipo).reduce((s, x) => s + x.minuti, 0));
  const giorniTipo = (tipo: TipoAssenzaEstratto) => giorni.filter((g) => g.lavorativo && g.assenze.some((x) => x.tipo === tipo)).length;
  const giorniLavorativi = giorni.filter((g) => g.lavorativo).length;
  const minutiRetribuiti = somma((g) => g.minutiRetribuiti);

  return {
    mese: dati.mese,
    dipendente: dip,
    // Solo lunedì-venerdì (Giorno 25); i totali qui sotto restano su tutto il mese.
    giorni: giorni.filter((g) => !isFineSettimana(g.data)),
    progetti: [...minutiProgetto.entries()]
      .map(([id, minuti]) => ({ ...dati.progetti.get(id)!, minuti }))
      .sort((x, y) => x.codice.localeCompare(y.codice)),
    totali: {
      minutiLavorati: somma((g) => g.minutiLavorati),
      giorniConOre: giorni.filter((g) => g.minutiLavorati > 0).length,
      giorniLavorativi,
      minutiAttesi: giorniLavorativi * minutiGiornoContratto,
      giorniFerie: giorniTipo('FERIE'),
      giorniMalattia: giorniTipo('MALATTIA'),
      minutiFerie: minutiTipo('FERIE'),
      minutiMalattia: minutiTipo('MALATTIA'),
      minutiPermessi: minutiTipo('PERMESSO'),
      minutiRetribuiti,
      costoNettoCent: costo(minutiRetribuiti, dip.costoOrarioNettoCent),
      costoLordoCent: costo(minutiRetribuiti, dip.costoOrarioLordoCent),
    },
  };
}

/** Mese richiedibile: formato "AAAA-MM", da gennaio 2020 (DATA_MINIMA) in poi. */
export const RE_MESE = /^(20[2-9]\d)-(0[1-9]|1[0-2])$/;

export const ETICHETTE_GIORNI = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

/** Colonne della griglia "mese a calendario": da lunedì a venerdì (Giorno 25). */
export const GIORNI_GRIGLIA = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven'];

/**
 * Lunedì delle settimane da mostrare nella griglia del mese "AAAA-MM": solo quelle con
 * almeno un giorno feriale del mese (un mese che inizia di sabato non ha una prima riga
 * vuota, uno che finisce di domenica non ne ha una in fondo).
 */
export function settimaneDelMese(mese: string): string[] {
  const { da, a } = limitiMese(mese);
  const lunedi: string[] = [];
  for (let l = inizioSettimana(da); l <= a; l = aggiungiGiorni(l, 7)) {
    // La settimana entra se il suo lunedì-venerdì tocca il mese.
    if (aggiungiGiorni(l, 4) >= da) lunedi.push(l);
  }
  return lunedi;
}
