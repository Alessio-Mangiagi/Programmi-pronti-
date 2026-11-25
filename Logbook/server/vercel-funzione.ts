// "><(((º> sabusabu <º)))><"
/**
 * Punto d'ingresso di Logbook come funzione Vercel (Giorno 35, 25/11/2026).
 *
 * Su un PC o nella suite Logbook parte da server/index.ts: un processo sempre acceso che
 * ascolta su una porta e serve anche l'interfaccia. Su Vercel non si ascolta su nessuna porta:
 * la piattaforma chiama questa funzione per ogni richiesta a /api/… e le passa richiesta e
 * risposta. Un'app Express è proprio una funzione (richiesta, risposta), quindi basta esportarla.
 * L'interfaccia (cartella dist/) la serve Vercel come file statici, non questa funzione.
 *
 * scripts/vercel-build.mjs impacchetta questo file con tutto il server in un solo modulo
 * (.vercel/output/functions/api.func/index.mjs). Niente index.ts quindi niente timer: la
 * pulizia periodica si fa alla prima richiesta di ogni processo e poi al massimo una volta
 * l'ora (manutenzione qui sotto).
 */
import { creaApp } from './app';
import { prisma } from './db';
import { cartellaDocumentiPredefinita, pulisciFileOrfani } from './servizi/archivio-file';
import { pulisciRegistro } from './servizi/registro';
import { statoTemporaneo } from './servizi/stato-temporaneo';
import { tieniVivo } from './vercel';

const app = creaApp(prisma);

let ultimaManutenzione = 0;
/** File caricati e mai usati, codici scaduti, righe vecchie del registro: al massimo una volta l'ora per processo. */
function manutenzione() {
  if (Date.now() - ultimaManutenzione < 60 * 60 * 1000) return;
  ultimaManutenzione = Date.now();
  tieniVivo(
    Promise.all([pulisciFileOrfani(prisma, cartellaDocumentiPredefinita()), statoTemporaneo(prisma).pulisci(), pulisciRegistro(prisma)]).catch((e) =>
      console.warn('[logbook] manutenzione non riuscita:', e),
    ),
  );
}

export default function logbook(req: Parameters<typeof app>[0], res: Parameters<typeof app>[1]) {
  manutenzione();
  return app(req, res);
}
