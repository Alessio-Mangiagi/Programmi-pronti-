// "><(((º> sabusabu <º)))><"
/**
 * Avviso "Copia dimostrativa" (25/11/2026, richiesta: "quello d'esempio tienilo solo per
 * fare vedere come si visualizzano i dati e creane uno vuoto per quando andrà in produzione").
 *
 * La copia dimostrativa (npm run demo / avvia-demo.bat, server/dati-demo.ts) ha lo stesso
 * aspetto del Logbook vero: senza un segno chiaro qualcuno potrebbe inserirci ore o
 * dipendenti veri. Compare solo lì (useAuth().dimostrazione, da GET /api/oggi):
 * - come fascia larga sotto l'intestazione di tutte le pagine (Layout.tsx);
 * - con `inScheda` come riquadro dentro le schede di accesso e di cambio password.
 * Nel Logbook vero non mostra nulla.
 */
import { useAuth } from '../auth';
import { Avviso } from './ui';

export function FasciaDimostrazione({ inScheda = false }: { inScheda?: boolean }) {
  const { dimostrazione } = useAuth();
  if (!dimostrazione) return null;
  const testo = (
    <>
      <b className="font-semibold">Copia dimostrativa</b> con dati di esempio: serve a far vedere come funziona Logbook. Non inserire dati veri.
    </>
  );
  if (inScheda) return <Avviso tipo="attenzione">{testo}</Avviso>;
  // Stessi colori dell'avviso "data del PC diversa" (Layout.tsx): è un'informazione da notare, non un errore.
  return (
    <div role="note" className="border-b border-[#e9c46a] bg-[#fdf1d6] px-3 py-2 text-sm text-[#6b4a00] sm:px-4 md:px-6">
      {testo}
    </div>
  );
}
