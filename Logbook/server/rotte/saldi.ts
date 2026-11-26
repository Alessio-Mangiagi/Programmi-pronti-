// "><(((º> sabusabu <º)))><"
/**
 * Saldo ferie e permessi (Giorno 38, 26/11/2026), montato su /api/saldi.
 *
 * - GET  /               HR: tutti i dipendenti attivi, con quota e saldo (null se HR non ha
 *                        ancora scritto la quota); dipendente: solo il suo.
 * - PUT  /:dipendenteId  (HR) scrive o cambia la quota: giorni di ferie e ore di permesso
 *                        all'anno, data da cui contare, residui di partenza.
 * - DELETE /:dipendenteId (HR) toglie la quota: il saldo di quel dipendente sparisce.
 *
 * Il calcolo è in comune/saldi.ts. Niente viene salvato del saldo: si ricalcola ogni volta
 * dalle assenze, quindi approvare, rifiutare o correggere un'assenza lo aggiorna da solo.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { isDataAmmessa, isDataValida, MESSAGGIO_DATA_MINIMA } from '../../comune/date';
import { calcolaSaldo } from '../../comune/saldi';
import { nonTrovato } from '../errori';
import { dipendenteAmmesso, idDaParametro, richiediAdmin } from '../middleware';

const numero = (nome: string, massimo: number) =>
  z.coerce.number({ error: `${nome}: numero non valido` }).min(0, `${nome}: non può essere negativo`).max(massimo, `${nome}: massimo ${massimo}`);

const schemaQuota = z.object({
  ferieGiorniAnno: numero('Giorni di ferie all\'anno', 60),
  permessiOreAnno: numero('Ore di permesso all\'anno', 400),
  contaDal: z.string({ error: 'Conta dal: campo obbligatorio' }).refine(isDataValida, 'Conta dal: data non valida').refine(isDataAmmessa, MESSAGGIO_DATA_MINIMA),
  // I residui di partenza possono essere negativi: ferie già godute in anticipo.
  ferieIniziali: z.coerce.number({ error: 'Ferie residue: numero non valido' }).min(-60, 'Ferie residue: minimo -60').max(200, 'Ferie residue: massimo 200').default(0),
  permessiIniziali: z.coerce.number({ error: 'Permessi residui: numero non valido' }).min(-400, 'Permessi residui: minimo -400').max(1000, 'Permessi residui: massimo 1000').default(0),
});

export function rotteSaldi(prisma: PrismaClient, oggi: () => string) {
  const router = Router();

  router.get('/', async (req, res) => {
    const soloId = dipendenteAmmesso(req);
    const giorno = oggi();
    const dipendenti = await prisma.dipendente.findMany({
      where: soloId ? { id: soloId } : { stato: 'ATTIVO' },
      include: { quotaAssenze: true },
      orderBy: [{ cognome: 'asc' }, { nome: 'asc' }],
    });
    const ids = dipendenti.map((d) => d.id);
    const [assenze, festivita] = await Promise.all([
      prisma.assenza.findMany({ where: { dipendenteId: { in: ids }, tipo: { in: ['FERIE', 'PERMESSO'] }, stato: { in: ['APPROVATA', 'RICHIESTA'] } } }),
      prisma.festivita.findMany({ select: { data: true } }),
    ]);
    const festivi = new Set(festivita.map((f) => f.data));
    res.json(
      dipendenti.map((d) => {
        const q = d.quotaAssenze;
        const quota = q ? { ferieGiorniAnno: q.ferieGiorniAnno, permessiOreAnno: q.permessiOreAnno, contaDal: q.contaDal, ferieIniziali: q.ferieIniziali, permessiIniziali: q.permessiIniziali } : null;
        return {
          dipendenteId: d.id,
          nome: `${d.cognome} ${d.nome}`,
          matricola: d.matricola,
          quota,
          saldo: quota ? calcolaSaldo(quota, d, assenze.filter((a) => a.dipendenteId === d.id), festivi, giorno) : null,
        };
      }),
    );
  });

  router.put('/:dipendenteId', richiediAdmin, async (req, res) => {
    const dipendenteId = idDaParametro(req.params.dipendenteId, 'dipendenteId')!;
    if (!(await prisma.dipendente.findUnique({ where: { id: dipendenteId } }))) throw nonTrovato('Dipendente');
    const dati = schemaQuota.parse(req.body);
    res.json(await prisma.quotaAssenze.upsert({ where: { dipendenteId }, create: { dipendenteId, ...dati }, update: dati }));
  });

  router.delete('/:dipendenteId', richiediAdmin, async (req, res) => {
    const dipendenteId = idDaParametro(req.params.dipendenteId, 'dipendenteId')!;
    await prisma.quotaAssenze.deleteMany({ where: { dipendenteId } });
    res.json({ ok: true });
  });

  return router;
}
