// "><(((º> sabusabu <º)))><"
/**
 * Chiusura del mese (Giorno 37, 26/11/2026).
 *
 * Il problema: HR manda l'estratto del mese al consulente paghe, poi qualcuno corregge
 * un'ora di quel mese e i numeri in Logbook non coincidono più con quelli pagati. Con la
 * chiusura HR "blocca" il mese dopo averlo controllato: da lì ore, assenze e festività di
 * quel mese non si toccano più. Se serve una correzione HR riapre il mese, corregge e
 * richiude: l'operazione resta nel registro attività.
 *
 * Dati: tabella MeseChiuso (una riga per mese chiuso, "AAAA-MM").
 * Chi controlla: le rotte che scrivono chiamano `controllaMesiAperti` /
 * `controllaPeriodoAperto` prima di toccare il database (rotte/registrazioni.ts,
 * rotte/importa.ts, rotte/assenze.ts, rotte/festivita.ts). Il controllo sta sul server:
 * l'interfaccia mostra solo il lucchetto.
 *
 * API (`rotteMesiChiusi`, montate su /api/mesi-chiusi):
 * - GET  /                 elenco dei mesi chiusi (tutti gli utenti: serve al calendario);
 * - GET  /:mese/controllo  (HR) cosa c'è ancora da sistemare prima di chiudere;
 * - POST /                 (HR) chiude {mese}: solo mesi finiti e senza richieste in attesa;
 * - DELETE /:mese          (HR) riapre.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { dataIso, formattaData, giorniNelMese } from '../../comune/date';
import { giorniLavorativi } from '../../comune/riepiloghi';
import { ErroreHttp } from '../errori';
import { richiediAdmin } from '../middleware';

const schemaMese = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Mese non valido (AAAA-MM)');

/** "2026-11-23" → "2026-11". */
export const meseDi = (data: string) => data.slice(0, 7);

/** "2026-11" → "novembre 2026". */
export function nomeMese(mese: string): string {
  const [anno, m] = mese.split('-').map(Number);
  return new Intl.DateTimeFormat('it-IT', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(anno, m - 1, 1)));
}

/** Primo e ultimo giorno del mese. */
export function estremiMese(mese: string): { da: string; a: string } {
  const [anno, m] = mese.split('-').map(Number);
  return { da: dataIso(anno, m, 1), a: dataIso(anno, m, giorniNelMese(anno, m)) };
}

const messaggioChiuso = (mese: string) =>
  `Il mese di ${nomeMese(mese)} è chiuso: non si può modificare. Per correggerlo HR deve prima riaprirlo (Esporta → Estratti mensili).`;

/** Solleva 409 se una delle date cade in un mese chiuso. */
export async function controllaMesiAperti(prisma: PrismaClient, date: string[]): Promise<void> {
  const mesi = [...new Set(date.map(meseDi))];
  if (!mesi.length) return;
  const chiuso = await prisma.meseChiuso.findFirst({ where: { mese: { in: mesi } }, orderBy: { mese: 'asc' } });
  if (chiuso) throw new ErroreHttp(409, messaggioChiuso(chiuso.mese));
}

/** Solleva 409 se il periodo (estremi compresi) tocca un mese chiuso. */
export async function controllaPeriodoAperto(prisma: PrismaClient, da: string, a: string): Promise<void> {
  const chiuso = await prisma.meseChiuso.findFirst({ where: { mese: { gte: meseDi(da), lte: meseDi(a) } }, orderBy: { mese: 'asc' } });
  if (chiuso) throw new ErroreHttp(409, messaggioChiuso(chiuso.mese));
}

export function rotteMesiChiusi(prisma: PrismaClient, oggi: () => string) {
  const router = Router();

  router.get('/', async (_req, res) => {
    res.json(await prisma.meseChiuso.findMany({ orderBy: { mese: 'desc' } }));
  });

  /**
   * Cosa manca prima di chiudere: richieste di assenza ancora da decidere (bloccano la
   * chiusura) e giorni lavorativi senza ore né assenza (solo un avviso: può essere giusto,
   * es. un part-time verticale).
   */
  async function controllo(mese: string) {
    const { da, a } = estremiMese(mese);
    const [dipendenti, fasce, assenze, festivita, chiuso] = await Promise.all([
      prisma.dipendente.findMany({ where: { dataAssunzione: { lte: a }, OR: [{ dataCessazione: null }, { dataCessazione: { gte: da } }] }, orderBy: [{ cognome: 'asc' }, { nome: 'asc' }] }),
      prisma.registrazioneOraria.findMany({ where: { data: { gte: da, lte: a } }, select: { dipendenteId: true, data: true } }),
      prisma.assenza.findMany({ where: { dataInizio: { lte: a }, dataFine: { gte: da }, stato: { in: ['RICHIESTA', 'APPROVATA'] } }, include: { dipendente: { select: { nome: true, cognome: true } } } }),
      prisma.festivita.findMany({ where: { data: { gte: da, lte: a } } }),
      prisma.meseChiuso.findUnique({ where: { mese } }),
    ]);
    const festivi = new Set(festivita.map((f) => f.data));
    const ieri = oggi();
    const senzaOre = dipendenti
      .map((d) => {
        const inizio = d.dataAssunzione > da ? d.dataAssunzione : da;
        const fine = d.dataCessazione && d.dataCessazione < a ? d.dataCessazione : a;
        const conOre = new Set(fasce.filter((f) => f.dipendenteId === d.id).map((f) => f.data));
        const intere = assenze.filter((x) => x.dipendenteId === d.id && x.tipo !== 'PERMESSO');
        const giorni = giorniLavorativi(inizio, fine, festivi).filter((g) => g < ieri && !conOre.has(g) && !intere.some((x) => x.dataInizio <= g && g <= x.dataFine));
        return { dipendenteId: d.id, dipendente: `${d.cognome} ${d.nome}`, giorni };
      })
      .filter((r) => r.giorni.length);
    const inAttesa = assenze.filter((x) => x.stato === 'RICHIESTA').map((x) => ({ id: x.id, dipendente: `${x.dipendente.cognome} ${x.dipendente.nome}`, tipo: x.tipo, dataInizio: x.dataInizio, dataFine: x.dataFine }));
    return { mese, nome: nomeMese(mese), finito: a < oggi(), chiuso, richiesteInAttesa: inAttesa, giorniSenzaOre: senzaOre };
  }

  router.get('/:mese/controllo', richiediAdmin, async (req, res) => {
    res.json(await controllo(schemaMese.parse(req.params.mese)));
  });

  router.post('/', richiediAdmin, async (req, res) => {
    const { mese } = z.object({ mese: schemaMese }).parse(req.body);
    const c = await controllo(mese);
    if (c.chiuso) throw new ErroreHttp(409, `Il mese di ${c.nome} è già chiuso`);
    if (!c.finito) throw new ErroreHttp(400, `Il mese di ${c.nome} non è ancora finito: si chiude dal giorno ${formattaData(dataIso(Number(mese.slice(0, 4)) + (mese.endsWith('-12') ? 1 : 0), (Number(mese.slice(5)) % 12) + 1, 1))}`);
    if (c.richiesteInAttesa.length) {
      const n = c.richiesteInAttesa.length;
      throw new ErroreHttp(409, `Prima di chiudere ${c.nome} vanno decise ${n === 1 ? 'una richiesta di assenza' : `${n} richieste di assenza`} ancora in attesa`);
    }
    const creato = await prisma.meseChiuso.create({ data: { mese, chiusoDa: req.utente!.username } });
    res.status(201).json(creato);
  });

  router.delete('/:mese', richiediAdmin, async (req, res) => {
    const mese = schemaMese.parse(req.params.mese);
    const tolti = await prisma.meseChiuso.deleteMany({ where: { mese } });
    if (!tolti.count) throw new ErroreHttp(404, `Il mese di ${nomeMese(mese)} non è chiuso`);
    res.json({ ok: true });
  });

  return router;
}
