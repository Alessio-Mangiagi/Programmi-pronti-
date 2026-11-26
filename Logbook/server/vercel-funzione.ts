// "><(((º> sabusabu <º)))><"
/**
 * Punto d'ingresso di Copilota come funzione Vercel (Giorno 35, 25/11/2026).
 *
 * Su un PC o nella suite Copilota parte da server/index.ts: un processo sempre acceso che
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
import { pulisciTentativi } from './servizi/limitatore';
import { statoTemporaneo } from './servizi/stato-temporaneo';
import { tieniVivo } from './vercel';
import { oggiItalia } from '../comune/date';
import { proprietarioDaAmbiente } from './rotte/proprietario';
import { creaAvvisi, indirizzoDaAmbiente, oraItalia, ORA_AVVISI } from './servizi/avvisi';
import { invioDaAmbiente } from './servizi/email';

const app = creaApp(prisma);
// Avvisi via email del giorno (26/11/2026): li fa partire Vercel Cron (/api/cron/avvisi); qui
// c'è la riserva, alla prima richiesta dopo le 7 se il cron non è passato. Mai due volte.
const avvisi = creaAvvisi(prisma, { inviaEmail: invioDaAmbiente(), emailProprietario: proprietarioDaAmbiente().email, indirizzo: indirizzoDaAmbiente() });

let ultimaManutenzione = 0;
/** File caricati e mai usati, codici scaduti, righe vecchie del registro: al massimo una volta l'ora per processo. */
function manutenzione() {
  if (Date.now() - ultimaManutenzione < 60 * 60 * 1000) return;
  ultimaManutenzione = Date.now();
  tieniVivo(
    Promise.all([pulisciFileOrfani(prisma, cartellaDocumentiPredefinita()), statoTemporaneo(prisma).pulisci(), pulisciRegistro(prisma), pulisciTentativi(prisma)]).catch((e) =>
      console.warn('[logbook] manutenzione non riuscita:', e),
    ),
  );
  if (oraItalia() >= ORA_AVVISI) tieniVivo(avvisi.giornaliero(oggiItalia()).catch((e) => console.warn('[logbook] avvisi del giorno non riusciti:', e)));
}

export default function logbook(req: Parameters<typeof app>[0], res: Parameters<typeof app>[1]) {
  manutenzione();
  return app(req, res);
}
