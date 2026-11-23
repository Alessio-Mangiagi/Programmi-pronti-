// "><(((º> sabusabu <º)))><"
/**
 * Importi in euro ↔ centesimi interi (come sono salvati nel database).
 * Usato per il costo orario netto e lordo della scheda dipendente e nei report.
 */

/**
 * "14,50" / "14.5" / "1.234,56" / "€ 14,50" → centesimi. null se vuoto.
 * Solleva un errore se il testo non è un importo valido.
 */
export function centesimiDaEuro(testo: string): number | null {
  const pulito = testo.replace(/[€\s]/g, '');
  if (pulito === '') return null;
  // Con la virgola: formato italiano, i punti sono separatori delle migliaia.
  const normalizzato = pulito.includes(',') ? pulito.replace(/\./g, '').replace(',', '.') : pulito;
  if (!/^\d+(\.\d{1,2})?$/.test(normalizzato)) throw new Error(`Importo non valido: "${testo}" (es. 14,50)`);
  return Math.round(Number(normalizzato) * 100);
}

/** 1450 → "14,50" (senza simbolo, per i campi dei moduli). */
export function euroDaCentesimi(centesimi: number | null | undefined): string {
  if (centesimi == null) return '';
  return (centesimi / 100).toFixed(2).replace('.', ',');
}

/** 123456 → "1.234,56 €" (per tabelle e riepiloghi). */
export function formattaEuro(centesimi: number | null | undefined): string {
  if (centesimi == null) return '—';
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(centesimi / 100);
}
