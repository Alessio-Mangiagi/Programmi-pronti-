// "><(((º> sabusabu <º)))><"
/**
 * Festività nazionali italiane di un anno, calcolate (nessun elenco da aggiornare a mano).
 *
 * Usato dal seed per precaricare l'anno corrente e, al Giorno 6, dal pulsante HR
 * "carica festività nazionali" per gli anni successivi. Le festività del paese della
 * sede (santo patrono) e le chiusure aziendali NON sono qui: le inserisce HR a mano
 * (tipo LOCALE o AZIENDALE), scelta 4b del 23/11/2026.
 */
import { dataIso, aggiungiGiorni } from './date';

type FestivitaCalcolata = { data: string; descrizione: string };

/**
 * Domenica di Pasqua (calendario gregoriano), algoritmo anonimo di Meeus/Jones/Butcher.
 * Restituisce "AAAA-MM-GG".
 */
export function pasqua(anno: number): string {
  const a = anno % 19;
  const b = Math.floor(anno / 100);
  const c = anno % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mese = Math.floor((h + l - 7 * m + 114) / 31);
  const giorno = ((h + l - 7 * m + 114) % 31) + 1;
  return dataIso(anno, mese, giorno);
}

/**
 * Festività nazionali dell'anno, in ordine di data.
 *
 * Include la domenica di Pasqua (festa per legge anche se cade sempre di domenica) e,
 * dal 2026, il 4 ottobre (San Francesco d'Assisi, patrono d'Italia), tornato festa
 * nazionale con la legge approvata dal Parlamento nell'ottobre 2025.
 */
export function festivitaNazionali(anno: number): FestivitaCalcolata[] {
  const p = pasqua(anno);
  const elenco: FestivitaCalcolata[] = [
    { data: dataIso(anno, 1, 1), descrizione: 'Capodanno' },
    { data: dataIso(anno, 1, 6), descrizione: 'Epifania' },
    { data: p, descrizione: 'Pasqua' },
    { data: aggiungiGiorni(p, 1), descrizione: "Lunedì dell'Angelo" },
    { data: dataIso(anno, 4, 25), descrizione: 'Festa della Liberazione' },
    { data: dataIso(anno, 5, 1), descrizione: 'Festa del Lavoro' },
    { data: dataIso(anno, 6, 2), descrizione: 'Festa della Repubblica' },
    { data: dataIso(anno, 8, 15), descrizione: 'Ferragosto' },
    { data: dataIso(anno, 11, 1), descrizione: 'Ognissanti' },
    { data: dataIso(anno, 12, 8), descrizione: 'Immacolata Concezione' },
    { data: dataIso(anno, 12, 25), descrizione: 'Natale' },
    { data: dataIso(anno, 12, 26), descrizione: 'Santo Stefano' },
  ];
  if (anno >= 2026) {
    elenco.push({ data: dataIso(anno, 10, 4), descrizione: "San Francesco d'Assisi, patrono d'Italia" });
  }
  return elenco.sort((x, y) => x.data.localeCompare(y.data));
}
