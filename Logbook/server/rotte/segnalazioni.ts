// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/segnalazioni (Giorno 20, 24/11/2026, risposte 1b e 4): il dipendente non
 * inserisce più ore; se nella sua giornata qualcosa non torna lo segnala a HR, che decide e
 * interviene. HR vede le segnalazioni aperte appena entra (finestra all'accesso e contatore
 * nell'intestazione, src/componenti/Notifiche.tsx) e in dashboard.
 *
 * - GET    /            ?stato=APERTA|RISOLTA&dipendenteId=&data=  HR tutte, dipendente le sue
 * - POST   /            { data, testo } il dipendente per sé; HR con dipendenteId
 * - PATCH  /:id         { stato?, rispostaHr? } solo HR: RISOLTA registra chi e quando
 * - DELETE /:id         il dipendente le sue finché sono aperte; HR sempre
 */
import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { isDataValida } from '../../comune/date';
import { schemaEsitoSegnalazione, schemaSegnalazione, STATI_SEGNALAZIONE, type StatoSegnalazione } from '../../comune/segnalazioni';
import { ErroreHttp, nonTrovato, richiestaNonValida } from '../errori';
import { dipendenteAmmesso, idDaParametro, isAdmin, richiediAdmin } from '../middleware';

/** Relazioni per mostrare una segnalazione: chi la fa e chi l'ha chiusa. */
const COLLEGATI = {
  dipendente: { select: { id: true, nome: true, cognome: true, matricola: true, codiceFiscale: true } },
  risoltaDa: { select: { username: true } },
} as const;

export function rotteSegnalazioni(prisma: PrismaClient, oggi: () => string) {
  const router = Router();

  router.get('/', async (req, res) => {
    const dipendenteId = dipendenteAmmesso(req, idDaParametro(req.query.dipendenteId, 'dipendenteId'));
    const stato = STATI_SEGNALAZIONE.includes(req.query.stato as StatoSegnalazione) ? (req.query.stato as StatoSegnalazione) : undefined;
    const data = typeof req.query.data === 'string' && isDataValida(req.query.data) ? req.query.data : undefined;
    const elenco = await prisma.segnalazione.findMany({
      where: { ...(dipendenteId ? { dipendenteId } : {}), ...(stato ? { stato } : {}), ...(data ? { data } : {}) },
      include: COLLEGATI,
      // Prima le aperte, poi le più vecchie: chi aspetta da più tempo in cima.
      orderBy: [{ stato: 'asc' }, { creatoIl: 'asc' }],
    });
    res.json(elenco);
  });

  router.post('/', async (req, res) => {
    const s = schemaSegnalazione.parse(req.body);
    const dipendenteId = dipendenteAmmesso(req, s.dipendenteId);
    if (!dipendenteId) throw richiestaNonValida('Indica il dipendente', { dipendenteId: 'Scegli il dipendente' });
    if (s.data > oggi()) throw richiestaNonValida('Non si segnala un giorno futuro', { data: 'Giorno futuro' });
    if (!(await prisma.dipendente.findUnique({ where: { id: dipendenteId } }))) throw nonTrovato('Dipendente');
    const creata = await prisma.segnalazione.create({ data: { dipendenteId, data: s.data, testo: s.testo }, include: COLLEGATI });
    res.status(201).json(creata);
  });

  router.patch('/:id', richiediAdmin, async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    if (!(await prisma.segnalazione.findUnique({ where: { id } }))) throw nonTrovato('Segnalazione');
    const e = schemaEsitoSegnalazione.parse(req.body);
    const aggiornata = await prisma.segnalazione.update({
      where: { id },
      data: {
        ...(e.stato === 'RISOLTA' ? { stato: 'RISOLTA', risoltaDaId: req.utente!.id, risoltaIl: new Date() } : {}),
        ...(e.stato === 'APERTA' ? { stato: 'APERTA', risoltaDaId: null, risoltaIl: null } : {}),
        ...(e.rispostaHr === undefined ? {} : { rispostaHr: e.rispostaHr }),
      },
      include: COLLEGATI,
    });
    res.json(aggiornata);
  });

  router.delete('/:id', async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const s = await prisma.segnalazione.findUnique({ where: { id } });
    if (!s) throw nonTrovato('Segnalazione');
    if (!isAdmin(req)) {
      dipendenteAmmesso(req, s.dipendenteId); // 403 su quelle degli altri
      if (s.stato !== 'APERTA') throw new ErroreHttp(409, 'HR ha già chiuso questa segnalazione: non si può ritirare');
    }
    await prisma.segnalazione.delete({ where: { id } });
    res.status(204).end();
  });

  return router;
}

