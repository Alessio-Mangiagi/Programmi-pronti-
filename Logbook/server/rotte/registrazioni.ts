// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/registrazioni: fasce orarie lavorate.
 *
 * - GET    /                ?da&a&dipendenteId&progettoId — elenco con `minuti` calcolati
 * - PUT    /giornata        sostituisce tutte le fasce di un dipendente in un giorno
 *                           (è quello che usa l'editor della giornata nel calendario)
 * - POST   /                aggiunge una fascia
 * - PUT    /:id             modifica una fascia
 * - DELETE /:id             cancella una fascia
 *
 * Il dipendente lavora solo sulle proprie fasce (dipendenteAmmesso → 403); l'admin su
 * tutte. Ogni scrittura controlla forma e sovrapposizioni (comune/registrazioni.ts) e le
 * regole di contesto (servizi/regole-ore.ts). Una sovrapposizione risponde 409 con il
 * messaggio che indica la fascia in conflitto.
 */
import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { isDataValida } from '../../comune/date';
import { durataMinuti } from '../../comune/orari';
import { messaggioSovrapposizione, primaSovrapposizione, schemaGiornata, schemaRegistrazione } from '../../comune/registrazioni';
import { ErroreHttp, nonTrovato, richiestaNonValida } from '../errori';
import { dipendenteAmmesso, idDaParametro } from '../middleware';
import { caricaContestoOre, erroriRegole } from '../servizi/regole-ore';

/** Legge un parametro data opzionale; 400 se presente ma non "AAAA-MM-GG". */
export function dataDaQuery(valore: unknown, nome: string): string | undefined {
  if (valore === undefined || valore === '') return undefined;
  if (typeof valore !== 'string' || !isDataValida(valore)) throw richiestaNonValida(`Parametro "${nome}" non valido (AAAA-MM-GG)`);
  return valore;
}

const conProgetto = { progetto: { select: { codice: true, nome: true, colore: true } } } as const;

export function rotteRegistrazioni(prisma: PrismaClient, oggi: () => string) {
  const router = Router();

  /** Fasce già registrate da un dipendente in un giorno (con progetto per i messaggi). */
  const fasceDelGiorno = (dipendenteId: number, data: string) =>
    prisma.registrazioneOraria.findMany({ where: { dipendenteId, data }, include: conProgetto, orderBy: { oraInizio: 'asc' } });

  /** Controlla le regole di contesto; al primo gruppo di errori risponde 400 per campo. */
  async function controllaRegole(dipendenteId: number, data: string, progettoIds: number[], giaPresenti: Set<number>) {
    const ctx = await caricaContestoOre(prisma, { dipendenteIds: [dipendenteId], da: data, a: data, oggi: oggi() });
    for (const [i, progettoId] of progettoIds.entries()) {
      const errori = erroriRegole(ctx, { dipendenteId, data, progettoId }, giaPresenti);
      if (errori.length) {
        const prefisso = progettoIds.length > 1 ? `fasce.${i}.` : '';
        const campi = Object.fromEntries(errori.map((e) => [e.campo === 'data' ? 'data' : prefisso + e.campo, e.messaggio]));
        throw richiestaNonValida(errori[0].messaggio, campi);
      }
    }
  }

  router.get('/', async (req, res) => {
    const dipendenteId = dipendenteAmmesso(req, idDaParametro(req.query.dipendenteId, 'dipendenteId'));
    const progettoId = idDaParametro(req.query.progettoId, 'progettoId');
    const da = dataDaQuery(req.query.da, 'da');
    const a = dataDaQuery(req.query.a, 'a');
    const fasce = await prisma.registrazioneOraria.findMany({
      where: {
        ...(dipendenteId ? { dipendenteId } : {}),
        ...(progettoId ? { progettoId } : {}),
        ...(da || a ? { data: { ...(da ? { gte: da } : {}), ...(a ? { lte: a } : {}) } } : {}),
      },
      include: conProgetto,
      orderBy: [{ data: 'asc' }, { oraInizio: 'asc' }],
    });
    res.json(fasce.map((f) => ({ ...f, minuti: durataMinuti(f.oraInizio, f.oraFine) })));
  });

  router.put('/giornata', async (req, res) => {
    const g = schemaGiornata.parse(req.body);
    dipendenteAmmesso(req, g.dipendenteId);
    const esistenti = await fasceDelGiorno(g.dipendenteId, g.data);
    await controllaRegole(g.dipendenteId, g.data, g.fasce.map((f) => f.progettoId), new Set(esistenti.map((e) => e.progettoId)));
    // Sostituzione atomica: o tutte le fasce nuove o nessuna modifica.
    await prisma.$transaction([
      prisma.registrazioneOraria.deleteMany({ where: { dipendenteId: g.dipendenteId, data: g.data } }),
      prisma.registrazioneOraria.createMany({ data: g.fasce.map((f) => ({ ...f, dipendenteId: g.dipendenteId, data: g.data })) }),
    ]);
    const nuove = await fasceDelGiorno(g.dipendenteId, g.data);
    res.json(nuove.map((f) => ({ ...f, minuti: durataMinuti(f.oraInizio, f.oraFine) })));
  });

  router.post('/', async (req, res) => {
    const r = schemaRegistrazione.parse(req.body);
    dipendenteAmmesso(req, r.dipendenteId);
    const esistenti = await fasceDelGiorno(r.dipendenteId, r.data);
    await controllaRegole(r.dipendenteId, r.data, [r.progettoId], new Set());
    const conflitto = primaSovrapposizione(r, esistenti);
    if (conflitto) {
      const messaggio = messaggioSovrapposizione(r, conflitto, r.data);
      throw new ErroreHttp(409, messaggio, { oraInizio: messaggio });
    }
    const creata = await prisma.registrazioneOraria.create({ data: r, include: conProgetto });
    res.status(201).json({ ...creata, minuti: durataMinuti(creata.oraInizio, creata.oraFine) });
  });

  router.put('/:id', async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const vecchia = await prisma.registrazioneOraria.findUnique({ where: { id } });
    if (!vecchia) throw nonTrovato('Registrazione');
    dipendenteAmmesso(req, vecchia.dipendenteId);
    const r = schemaRegistrazione.parse(req.body);
    dipendenteAmmesso(req, r.dipendenteId);
    const esistenti = await fasceDelGiorno(r.dipendenteId, r.data);
    const stessoGiorno = vecchia.dipendenteId === r.dipendenteId && vecchia.data === r.data;
    await controllaRegole(r.dipendenteId, r.data, [r.progettoId], new Set(stessoGiorno ? [vecchia.progettoId] : []));
    const conflitto = primaSovrapposizione({ ...r, id }, esistenti);
    if (conflitto) {
      const messaggio = messaggioSovrapposizione(r, conflitto, r.data);
      throw new ErroreHttp(409, messaggio, { oraInizio: messaggio });
    }
    const aggiornata = await prisma.registrazioneOraria.update({ where: { id }, data: r, include: conProgetto });
    res.json({ ...aggiornata, minuti: durataMinuti(aggiornata.oraInizio, aggiornata.oraFine) });
  });

  router.delete('/:id', async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const vecchia = await prisma.registrazioneOraria.findUnique({ where: { id } });
    if (!vecchia) throw nonTrovato('Registrazione');
    dipendenteAmmesso(req, vecchia.dipendenteId);
    await prisma.registrazioneOraria.delete({ where: { id } });
    res.json({ ok: true });
  });

  return router;
}
