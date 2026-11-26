// "><(((º> sabusabu <º)))><"
/**
 * Saldo ferie e permessi (Giorno 38, 26/11/2026): maturato, goduto, residuo.
 *
 * I numeri di partenza li scrive HR per ogni dipendente (tabella QuotaAssenze): quanti giorni
 * di ferie e quante ore di permesso maturano in un anno intero, da che data Logbook conta
 * (`contaDal`) e con che residuo si parte. Logbook non conosce il contratto: senza quota il
 * saldo non si calcola.
 *
 * Regole del calcolo (uguali per ferie e permessi):
 * - si conta da `contaDal`, o dall'assunzione se è successiva, fino a oggi (o alla
 *   cessazione, se è precedente);
 * - ogni mese vale un dodicesimo della quota annua; un mese conta se il dipendente è in
 *   forza per almeno 15 giorni di quel mese (è la regola usuale delle buste paga), quindi
 *   il mese in corso matura dal giorno 15;
 * - goduto: assenze APPROVATE fino a oggi. Le ferie si contano in giorni lavorativi (lunedì-
 *   venerdì non festivi), i permessi in ore;
 * - residuo = residuo di partenza + maturato − goduto;
 * - programmato: assenze approvate con data futura; in attesa: richieste non ancora decise.
 *   Non tolgono nulla dal residuo: `disponibile` dice quanto resta dopo averle contate.
 *
 * Funzioni pure, usate dal server (server/rotte/saldi.ts) e provate in saldi.test.ts.
 */
import { aggiungiGiorni, dataIso, giorniNelMese } from './date';
import { giorniLavorativi } from './riepiloghi';

export type Quota = { ferieGiorniAnno: number; permessiOreAnno: number; contaDal: string; ferieIniziali: number; permessiIniziali: number };
export type AssenzaSaldo = { tipo: string; stato: string; dataInizio: string; dataFine: string; minutiPermesso: number | null };

/** Una delle due voci del saldo: giorni per le ferie, ore per i permessi. */
export type VoceSaldo = {
  quotaAnno: number;
  iniziali: number;
  maturate: number;
  godute: number;
  residue: number;
  programmate: number;
  inAttesa: number;
  /** Residuo meno il programmato e le richieste in attesa: quanto si può ancora chiedere. */
  disponibile: number;
};
export type Saldo = { dal: string; al: string; mesi: number; ferie: VoceSaldo; permessi: VoceSaldo };

/** Giorni di un mese che servono perché il mese maturi. */
export const GIORNI_MINIMI_MESE = 15;

const due = (n: number) => Math.round(n * 100) / 100;

/** Mesi che maturano fra due date comprese: quelli coperti per almeno 15 giorni. */
export function mesiMaturati(da: string, a: string): number {
  if (da > a) return 0;
  let mesi = 0;
  let [anno, mese] = da.split('-').map(Number);
  const [annoFine, meseFine] = a.split('-').map(Number);
  while (anno < annoFine || (anno === annoFine && mese <= meseFine)) {
    const primo = dataIso(anno, mese, 1);
    const ultimo = dataIso(anno, mese, giorniNelMese(anno, mese));
    const inizio = da > primo ? da : primo;
    const fine = a < ultimo ? a : ultimo;
    const coperti = Number(fine.slice(8)) - Number(inizio.slice(8)) + 1;
    if (coperti >= GIORNI_MINIMI_MESE) mesi++;
    mese++;
    if (mese > 12) {
      mese = 1;
      anno++;
    }
  }
  return mesi;
}

/**
 * Saldo di un dipendente a `oggi`. `assenze`: tutte le sue assenze (qualsiasi stato);
 * `festivi`: le festività, per non contare come ferie un giorno festivo.
 */
export function calcolaSaldo(
  quota: Quota,
  dipendente: { dataAssunzione: string; dataCessazione?: string | null },
  assenze: AssenzaSaldo[],
  festivi: Set<string>,
  oggi: string,
): Saldo {
  const dal = dipendente.dataAssunzione > quota.contaDal ? dipendente.dataAssunzione : quota.contaDal;
  const al = dipendente.dataCessazione && dipendente.dataCessazione < oggi ? dipendente.dataCessazione : oggi;
  const mesi = mesiMaturati(dal, al);
  const domani = aggiungiGiorni(oggi, 1);

  // Giorni lavorativi di un'assenza dentro un intervallo (estremi compresi).
  const giorniIn = (a: AssenzaSaldo, da: string, fino: string) => {
    const inizio = a.dataInizio > da ? a.dataInizio : da;
    const fine = a.dataFine < fino ? a.dataFine : fino;
    return inizio <= fine ? giorniLavorativi(inizio, fine, festivi).length : 0;
  };
  const LONTANO = '9999-12-31';
  const ferie = assenze.filter((a) => a.tipo === 'FERIE' && a.dataFine >= dal);
  const permessi = assenze.filter((a) => a.tipo === 'PERMESSO' && a.dataInizio >= dal);
  const ore = (lista: AssenzaSaldo[]) => lista.reduce((s, a) => s + (a.minutiPermesso ?? 0), 0) / 60;

  const voce = (quotaAnno: number, iniziali: number, godute: number, programmate: number, inAttesa: number): VoceSaldo => {
    const maturate = (quotaAnno / 12) * mesi;
    const residue = iniziali + maturate - godute;
    return { quotaAnno, iniziali: due(iniziali), maturate: due(maturate), godute: due(godute), residue: due(residue), programmate: due(programmate), inAttesa: due(inAttesa), disponibile: due(residue - programmate - inAttesa) };
  };
  const approvate = (lista: AssenzaSaldo[]) => lista.filter((a) => a.stato === 'APPROVATA');
  const richieste = (lista: AssenzaSaldo[]) => lista.filter((a) => a.stato === 'RICHIESTA');

  return {
    dal,
    al,
    mesi,
    ferie: voce(
      quota.ferieGiorniAnno,
      quota.ferieIniziali,
      approvate(ferie).reduce((s, a) => s + giorniIn(a, dal, oggi), 0),
      approvate(ferie).reduce((s, a) => s + giorniIn(a, domani, LONTANO), 0),
      richieste(ferie).reduce((s, a) => s + giorniIn(a, dal, LONTANO), 0),
    ),
    permessi: voce(
      quota.permessiOreAnno,
      quota.permessiIniziali,
      ore(approvate(permessi).filter((a) => a.dataInizio <= oggi)),
      ore(approvate(permessi).filter((a) => a.dataInizio > oggi)),
      ore(richieste(permessi)),
    ),
  };
}
