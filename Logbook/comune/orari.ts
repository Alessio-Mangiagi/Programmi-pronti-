// "><(((º> sabusabu <º)))><"
/**
 * Orari "HH:MM" a 24 ore e durate in minuti.
 *
 * Base del calcolo automatico delle ore lavorate: il database salva solo inizio e
 * fine di ogni fascia, le ore si ricavano sempre da qui. La logica delle
 * sovrapposizioni si aggiunge al Giorno 4 (registrazione ore).
 */

const RE_ORARIO = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** true se il testo è un orario "HH:MM" valido fra 00:00 e 23:59. */
export function isOrarioValido(orario: string): boolean {
  return RE_ORARIO.test(orario);
}

/** "08:30" → 510 (minuti dalla mezzanotte). Solleva un errore se l'orario non è valido. */
export function minutiDaOrario(orario: string): number {
  const m = RE_ORARIO.exec(orario);
  if (!m) throw new Error(`Orario non valido: "${orario}" (atteso HH:MM, 24 ore)`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** 510 → "08:30". Accetta solo minuti dentro la giornata (0-1439). */
export function orarioDaMinuti(minuti: number): string {
  if (!Number.isInteger(minuti) || minuti < 0 || minuti >= 24 * 60) {
    throw new Error(`Minuti fuori dalla giornata: ${minuti}`);
  }
  return `${String(Math.floor(minuti / 60)).padStart(2, '0')}:${String(minuti % 60).padStart(2, '0')}`;
}

/**
 * Durata in minuti di una fascia. La fine deve essere dopo l'inizio: le fasce non
 * attraversano la mezzanotte (un turno notturno si spezza in due giorni).
 */
export function durataMinuti(oraInizio: string, oraFine: string): number {
  const durata = minutiDaOrario(oraFine) - minutiDaOrario(oraInizio);
  if (durata <= 0) {
    throw new Error(`L'ora di fine (${oraFine}) deve essere successiva all'ora di inizio (${oraInizio})`);
  }
  return durata;
}

/** 450 → "7:30" (ore:minuti, per tabelle e totali). */
export function formattaOre(minuti: number): string {
  const segno = minuti < 0 ? '-' : '';
  const assoluti = Math.abs(minuti);
  return `${segno}${Math.floor(assoluti / 60)}:${String(assoluti % 60).padStart(2, '0')}`;
}

