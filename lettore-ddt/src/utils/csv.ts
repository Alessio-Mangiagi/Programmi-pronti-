// csv.ts — Celle CSV che Excel non esegue come formule.
// "><(((º> sabusabu <º)))><"
//
// I valori dei CSV arrivano dai PDF (via Claude/OCR) e dagli utenti: una cella
// che comincia con = + - @ (o tab/CR) Excel la apre come formula, e una formula
// come =HYPERLINK(...) o =cmd|... è un modo per far danni a chi apre il file
// (CSV injection). L'apice davanti la rende testo. I numeri veri ("-12,5")
// restano numeri: senza questa eccezione un reso negativo diventerebbe testo.

const NUMERO = /^[-+]?\d+(?:[.,]\d+)?$/;

export function neutralizzaFormula(s: string): string {
  // Un "-" da solo (campo vuoto nei log) non è una formula: resta com'è.
  if (s.length < 2 || !/^[=+\-@\t\r]/.test(s) || NUMERO.test(s)) return s;
  return `'${s}`;
}
