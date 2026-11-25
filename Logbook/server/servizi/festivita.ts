// "><(((º> sabusabu <º)))><"
/**
 * Festività nazionali nel database. Le usano due punti:
 * - il pulsante di HR "Carica festività nazionali" (POST /api/festivita/carica-nazionali,
 *   server/rotte/festivita.ts), per un anno alla volta;
 * - scripts/prepara-db.ts, che dal 25/11/2026 le carica per l'anno in corso e il successivo
 *   quando il database parte vuoto (senza dati di esempio): senza festività il
 *   calendario, gli estratti e il conteggio delle ferie le tratterebbero come giorni lavorativi.
 *
 * Le date sono calcolate da comune/festivita.ts. Si aggiungono solo quelle che mancano: le
 * festività già presenti (anche quelle inserite o sistemate da HR) non si toccano.
 */
import type { PrismaClient } from '../../generated/prisma/client';
import { festivitaNazionali } from '../../comune/festivita';

/** Aggiunge le festività nazionali dell'anno che mancano nel database e restituisce quante ne ha aggiunte. */
export async function aggiungiFestivitaNazionali(prisma: PrismaClient, anno: number): Promise<number> {
  const presenti = new Set(
    (await prisma.festivita.findMany({ where: { data: { gte: `${anno}-01-01`, lte: `${anno}-12-31` } }, select: { data: true } })).map((f) => f.data),
  );
  const nuove = festivitaNazionali(anno).filter((f) => !presenti.has(f.data));
  if (nuove.length) await prisma.festivita.createMany({ data: nuove.map((f) => ({ ...f, tipo: 'NAZIONALE' as const })) });
  return nuove.length;
}
