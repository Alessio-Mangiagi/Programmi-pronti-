// "><(((º> sabusabu <º)))><"
/**
 * GET /api/calendario — tutto quello che serve a disegnare il calendario di un periodo.
 *
 * Parametri: da, a (obbligatori, massimo 62 giorni: un mese più le settimane di bordo),
 * dipendenteId, progettoId, tipoAssenza (FERIE|PERMESSO|MALATTIA, oppure NESSUNA per
 * nascondere le assenze).
 *
 * Risposta: fasce (con progetto, dipendente e minuti), assenze APPROVATE e RICHIESTE (le
 * rifiutate non compaiono mai), festività del periodo e totali calcolati da
 * comune/riepiloghi.ts sulle sole fasce filtrate: col filtro progetto, i totali del
 * giorno sono le ore di quel progetto.
 *
 * Il dipendente vede solo sé stesso (dipendenteAmmesso).
 */
import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { aDateUtc } from '../../comune/date';
import { durataMinuti } from '../../comune/orari';
import { calcolaTotali } from '../../comune/riepiloghi';
import { richiestaNonValida } from '../errori';
import { dipendenteAmmesso, idDaParametro } from '../middleware';
import { dataDaQuery } from './registrazioni';

const TIPI = ['FERIE', 'PERMESSO', 'MALATTIA'] as const;
const MAX_GIORNI = 62;

export function rotteCalendario(prisma: PrismaClient) {
  const router = Router();

  router.get('/', async (req, res) => {
    const da = dataDaQuery(req.query.da, 'da');
    const a = dataDaQuery(req.query.a, 'a');
    if (!da || !a) throw richiestaNonValida('Indica il periodo (da, a)');
    if (a < da) throw richiestaNonValida('La data finale precede quella iniziale');
    if ((aDateUtc(a).getTime() - aDateUtc(da).getTime()) / 86_400_000 > MAX_GIORNI) {
      throw richiestaNonValida(`Periodo troppo lungo (massimo ${MAX_GIORNI} giorni)`);
    }
    const dipendenteId = dipendenteAmmesso(req, idDaParametro(req.query.dipendenteId, 'dipendenteId'));
    const progettoId = idDaParametro(req.query.progettoId, 'progettoId');
    const tipoAssenza = typeof req.query.tipoAssenza === 'string' ? req.query.tipoAssenza : '';
    if (tipoAssenza && tipoAssenza !== 'NESSUNA' && !TIPI.includes(tipoAssenza as (typeof TIPI)[number])) {
      throw richiestaNonValida('Tipo di assenza non valido');
    }

    const [fasce, assenze, festivita] = await Promise.all([
      prisma.registrazioneOraria.findMany({
        where: { data: { gte: da, lte: a }, ...(dipendenteId ? { dipendenteId } : {}), ...(progettoId ? { progettoId } : {}) },
        include: {
          progetto: { select: { codice: true, nome: true, colore: true, maxMinutiGiorno: true } },
          dipendente: { select: { nome: true, cognome: true } },
        },
        orderBy: [{ data: 'asc' }, { oraInizio: 'asc' }],
      }),
      tipoAssenza === 'NESSUNA'
        ? Promise.resolve([])
        : prisma.assenza.findMany({
            where: {
              stato: { in: ['APPROVATA', 'RICHIESTA'] },
              dataInizio: { lte: a },
              dataFine: { gte: da },
              ...(dipendenteId ? { dipendenteId } : {}),
              ...(tipoAssenza ? { tipo: tipoAssenza as (typeof TIPI)[number] } : {}),
            },
            select: {
              id: true, dipendenteId: true, tipo: true, dataInizio: true, dataFine: true, minutiPermesso: true, stato: true,
              dipendente: { select: { nome: true, cognome: true } },
            },
            orderBy: { dataInizio: 'asc' },
          }),
      prisma.festivita.findMany({ where: { data: { gte: da, lte: a } }, orderBy: { data: 'asc' } }),
    ]);

    res.json({
      da,
      a,
      fasce: fasce.map((f) => ({ ...f, minuti: durataMinuti(f.oraInizio, f.oraFine) })),
      assenze,
      festivita,
      totali: calcolaTotali(fasce),
    });
  });

  return router;
}
