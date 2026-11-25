// "><(((º> sabusabu <º)))><"
/**
 * Totali delle ore: per giorno, per progetto, per dipendente e complessivo.
 *
 * Unica funzione di somma usata dal calendario (server/rotte/calendario.ts) e dai report
 * Excel (Giorno 8): così i totali dei report coincidono per costruzione con quelli del
 * calendario, invece di essere calcolati due volte in due modi diversi.
 */
import { aDateUtc, aggiungiGiorni, giornoSettimana, isFineSettimana } from './date';
import { durataMinuti } from './orari';

type FasciaPerTotali = { data: string; progettoId: number; dipendenteId: number; oraInizio: string; oraFine: string };

export type Totali = {
  /** minuti per data "AAAA-MM-GG" */
  perGiorno: Record<string, number>;
  /** minuti per id progetto */
  perProgetto: Record<number, number>;
  /** minuti per id dipendente */
  perDipendente: Record<number, number>;
  /** minuti per "idDipendente|idProgetto" (report progetti) */
  perDipendenteProgetto: Record<string, number>;
  totale: number;
};

export function calcolaTotali(fasce: FasciaPerTotali[]): Totali {
  const t: Totali = { perGiorno: {}, perProgetto: {}, perDipendente: {}, perDipendenteProgetto: {}, totale: 0 };
  for (const f of fasce) {
    const m = durataMinuti(f.oraInizio, f.oraFine);
    t.perGiorno[f.data] = (t.perGiorno[f.data] ?? 0) + m;
    t.perProgetto[f.progettoId] = (t.perProgetto[f.progettoId] ?? 0) + m;
    t.perDipendente[f.dipendenteId] = (t.perDipendente[f.dipendenteId] ?? 0) + m;
    const chiave = `${f.dipendenteId}|${f.progettoId}`;
    t.perDipendenteProgetto[chiave] = (t.perDipendenteProgetto[chiave] ?? 0) + m;
    t.totale += m;
  }
  return t;
}

/**
 * Giorni lavorativi (lun-ven non festivi) fra due date comprese.
 * Serve a contare le ferie in giorni e le ore contrattuali attese in un periodo.
 */
export function giorniLavorativi(da: string, a: string, festivi: Set<string>): string[] {
  const giorni: string[] = [];
  for (let d = da; d <= a; d = aggiungiGiorni(d, 1)) {
    if (!isFineSettimana(d) && !festivi.has(d)) giorni.push(d);
  }
  return giorni;
}

/**
 * Quanti giorni lavorativi (lun-ven non festivi) ci sono fra due date comprese: stesso
 * risultato di giorniLavorativi(...).length, ma senza scorrere i giorni uno per uno.
 * Lo usa l'elenco delle assenze (server/rotte/assenze.ts), che lo calcola per ogni assenza
 * a ogni apertura: con il ciclo un'assenza lunghissima bloccava il server per secondi
 * (verifica di sicurezza del Giorno 23). Qui il costo dipende solo dal numero di festivi.
 */
export function contaGiorniLavorativi(da: string, a: string, festivi: Set<string>): number {
  if (a < da) return 0;
  const giorno = 24 * 60 * 60 * 1000;
  const totale = Math.round((aDateUtc(a).getTime() - aDateUtc(da).getTime()) / giorno) + 1;
  // Settimane intere: 5 lavorativi ciascuna; i giorni rimasti (al massimo 6) si contano uno a uno.
  let lavorativi = Math.floor(totale / 7) * 5;
  const primo = giornoSettimana(da);
  for (let i = 0; i < totale % 7; i++) {
    const g = (primo + i) % 7;
    if (g !== 0 && g !== 6) lavorativi++;
  }
  // Festivi del periodo che cadono in un giorno feriale (quelli di sabato o domenica non contano due volte).
  for (const f of festivi) if (f >= da && f <= a && !isFineSettimana(f)) lavorativi--;
  return lavorativi;
}

/** Lunedì della settimana che contiene la data. */
export function inizioSettimana(iso: string): string {
  const [anno, mese, giorno] = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(anno, mese - 1, giorno)).getUTCDay(); // 0 = domenica
  return aggiungiGiorni(iso, dow === 0 ? -6 : 1 - dow);
}
