// "><(((º> sabusabu <º)))><"
/**
 * attivita.ts — ultimo segno di vita di chi usa il programma, per lo spegnimento automatico dopo
 * inattività (config.json → inactivityTimeoutMinutes, watchdog in routes/system.routes.ts).
 *
 * Prima lo segnava solo il /ping del frontend del Lettore DDT. Con "DDT e Magazzino" (09/11/2026) le
 * pagine del Magazzino passano dal proxy /magazzino e non chiamano /ping: anche ogni richiesta del
 * proxy conta, altrimenti un magazziniere col telefono in cantiere si vedrebbe spegnere il programma
 * sotto le mani dopo 15 minuti senza nessuno sulla pagina dei DDT.
 */
let ultima = Date.now();

export function segnaAttivita(ora = Date.now()): void {
  ultima = ora;
}

export function ultimaAttivita(): number {
  return ultima;
}
