// "><(((º> sabusabu <º)))><"
/**
 * Rotte /api/assenze: richieste di ferie, permessi e malattia e decisioni di HR.
 *
 * Flusso: il dipendente crea una richiesta (stato RICHIESTA) → HR la approva, la
 * modifica o la rifiuta (con motivo). Solo le APPROVATE contano come assenza (calendario,
 * blocco delle ore, report); le RIFIUTATE restano nello storico ma non compaiono.
 *
 * Permessi:
 * - dipendente: vede le proprie; crea per sé; modifica o ritira solo finché è RICHIESTA;
 * - HR: vede tutte; può creare per chiunque (anche già APPROVATA, es. malattia comunicata
 *   per telefono), modificare, decidere e cancellare.
 *
 * Controlli: ferie/malattia non si sovrappongono ad altre ferie/malattia non rifiutate;
 * un permesso non cade in un giorno di ferie/malattia; per approvare ferie/malattia non
 * devono esserci ore registrate in quei giorni (prima vanno tolte o spostate).
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { Assenza, PrismaClient } from '../../generated/prisma/client';
import { periodiSovrapposti, schemaAssenza, schemaDecisione, type DatiAssenza } from '../../comune/assenze';
import { formattaData } from '../../comune/date';
import { giorniLavorativi } from '../../comune/riepiloghi';
import { ErroreHttp, nonTrovato, richiestaNonValida, vietato } from '../errori';
import { dipendenteAmmesso, idDaParametro, isAdmin, richiediAdmin } from '../middleware';
import { dataDaQuery } from './registrazioni';

const include = {
  dipendente: { select: { nome: true, cognome: true, matricola: true } },
  decisoDa: { select: { username: true } },
} as const;

export function rotteAssenze(prisma: PrismaClient) {
  const router = Router();

  /** Aggiunge a ogni assenza il numero di giorni lavorativi che copre (festivi e weekend esclusi). */
  async function conGiorni<T extends Assenza>(assenze: T[]) {
    if (!assenze.length) return [];
    const da = assenze.reduce((m, a) => (a.dataInizio < m ? a.dataInizio : m), assenze[0].dataInizio);
    const a = assenze.reduce((m, x) => (x.dataFine > m ? x.dataFine : m), assenze[0].dataFine);
    const festivi = new Set((await prisma.festivita.findMany({ where: { data: { gte: da, lte: a } }, select: { data: true } })).map((f) => f.data));
    return assenze.map((x) => ({ ...x, giorniLavorativi: giorniLavorativi(x.dataInizio, x.dataFine, festivi).length }));
  }

  /** Conflitti con altre assenze non rifiutate dello stesso dipendente. */
  async function controllaSovrapposizioni(dati: DatiAssenza & { dipendenteId: number }, escludiId?: number) {
    const altre = await prisma.assenza.findMany({
      where: {
        dipendenteId: dati.dipendenteId,
        stato: { not: 'RIFIUTATA' },
        dataInizio: { lte: dati.dataFine },
        dataFine: { gte: dati.dataInizio },
        ...(escludiId ? { NOT: { id: escludiId } } : {}),
      },
    });
    const intere = (t: string) => t === 'FERIE' || t === 'MALATTIA';
    const conflitto = altre.find((x) => periodiSovrapposti(dati, x) && (intere(dati.tipo) || intere(x.tipo)));
    if (conflitto) {
      const periodo = conflitto.dataInizio === conflitto.dataFine ? `il ${formattaData(conflitto.dataInizio)}` : `dal ${formattaData(conflitto.dataInizio)} al ${formattaData(conflitto.dataFine)}`;
      throw new ErroreHttp(409, `Si sovrappone a ${conflitto.tipo.toLowerCase()} già presente ${periodo}`, { dataInizio: 'Periodo già coperto da un\'altra assenza' });
    }
  }

  /** Per ferie/malattia approvate: nessuna ora registrata nei giorni coperti. */
  async function controllaOreNelPeriodo(a: { dipendenteId: number; tipo: string; dataInizio: string; dataFine: string }) {
    if (a.tipo === 'PERMESSO') return;
    const ore = await prisma.registrazioneOraria.findMany({
      where: { dipendenteId: a.dipendenteId, data: { gte: a.dataInizio, lte: a.dataFine } },
      select: { data: true },
      distinct: ['data'],
      orderBy: { data: 'asc' },
    });
    if (ore.length) {
      throw new ErroreHttp(409, `Ci sono ore registrate nel periodo (${ore.map((o) => formattaData(o.data)).join(', ')}): toglile o modifica le date prima di approvare`);
    }
  }

  /** Assenza esistente, visibile a chi la chiede (403 sulle altrui per i dipendenti). */
  async function caricaVisibile(req: Request) {
    const a = await prisma.assenza.findUnique({ where: { id: idDaParametro(req.params.id)! } });
    if (!a) throw nonTrovato('Assenza');
    dipendenteAmmesso(req, a.dipendenteId);
    return a;
  }

  router.get('/', async (req, res) => {
    const dipendenteId = dipendenteAmmesso(req, idDaParametro(req.query.dipendenteId, 'dipendenteId'));
    const stato = typeof req.query.stato === 'string' && ['RICHIESTA', 'APPROVATA', 'RIFIUTATA'].includes(req.query.stato) ? (req.query.stato as Assenza['stato']) : undefined;
    const da = dataDaQuery(req.query.da, 'da');
    const a = dataDaQuery(req.query.a, 'a');
    const elenco = await prisma.assenza.findMany({
      where: {
        ...(dipendenteId ? { dipendenteId } : {}),
        ...(stato ? { stato } : {}),
        ...(a ? { dataInizio: { lte: a } } : {}),
        ...(da ? { dataFine: { gte: da } } : {}),
      },
      include,
      orderBy: [{ dataInizio: 'desc' }],
    });
    res.json(await conGiorni(elenco));
  });

  /** Una sola assenza, per la sua pagina (Giorno 18): il dipendente solo le proprie (403). */
  router.get('/:id', async (req, res) => {
    const a = await caricaVisibile(req);
    const completa = await prisma.assenza.findUniqueOrThrow({ where: { id: a.id }, include });
    res.json((await conGiorni([completa]))[0]);
  });

  router.post('/', async (req, res) => {
    const dati = schemaAssenza.parse(req.body);
    const admin = isAdmin(req);
    const dipendenteId = dipendenteAmmesso(req, dati.dipendenteId) ?? dati.dipendenteId;
    if (!dipendenteId) throw richiestaNonValida('Scegli il dipendente', { dipendenteId: 'Scegli il dipendente' });
    // HR può registrare direttamente un'assenza già approvata; il dipendente no.
    const { stato: statoRichiesto } = z.object({ stato: z.enum(['RICHIESTA', 'APPROVATA']).optional() }).parse({ stato: req.body?.stato });
    const stato = admin && statoRichiesto === 'APPROVATA' ? 'APPROVATA' : 'RICHIESTA';
    const completa = { ...dati, dipendenteId };
    await controllaSovrapposizioni(completa);
    if (stato === 'APPROVATA') await controllaOreNelPeriodo(completa);
    const creata = await prisma.assenza.create({
      data: { ...completa, stato, ...(stato === 'APPROVATA' ? { decisoDaId: req.utente!.id, decisoIl: new Date() } : {}) },
      include,
    });
    res.status(201).json((await conGiorni([creata]))[0]);
  });

  router.put('/:id', async (req, res) => {
    const vecchia = await caricaVisibile(req);
    const admin = isAdmin(req);
    if (!admin && vecchia.stato !== 'RICHIESTA') throw vietato('La richiesta è già stata decisa da HR: per cambiarla rivolgiti a HR');
    const dati = schemaAssenza.parse(req.body);
    const completa = { ...dati, dipendenteId: vecchia.dipendenteId };
    await controllaSovrapposizioni(completa, vecchia.id);
    if (vecchia.stato === 'APPROVATA') await controllaOreNelPeriodo(completa);
    const aggiornata = await prisma.assenza.update({
      where: { id: vecchia.id },
      data: {
        tipo: completa.tipo, dataInizio: completa.dataInizio, dataFine: completa.dataFine, minutiPermesso: completa.minutiPermesso,
        noteDipendente: completa.noteDipendente, protocolloCertificato: completa.protocolloCertificato,
        // HR che modifica una richiesta può lasciare una nota (es. "date spostate d'accordo").
        ...(admin && typeof req.body?.noteHr === 'string' ? { noteHr: req.body.noteHr.trim() || null } : {}),
      },
      include,
    });
    res.json((await conGiorni([aggiornata]))[0]);
  });

  /** Decisione di HR: approva o rifiuta (con motivo). Si può anche cambiare idea. */
  router.post('/:id/decisione', richiediAdmin, async (req, res) => {
    const vecchia = await caricaVisibile(req);
    const { stato, noteHr } = schemaDecisione.parse(req.body);
    if (stato === 'APPROVATA') {
      await controllaSovrapposizioni({ ...vecchia, noteDipendente: null }, vecchia.id);
      await controllaOreNelPeriodo(vecchia);
    }
    const decisa = await prisma.assenza.update({
      where: { id: vecchia.id },
      data: { stato, noteHr: noteHr ?? vecchia.noteHr, decisoDaId: req.utente!.id, decisoIl: new Date() },
      include,
    });
    res.json((await conGiorni([decisa]))[0]);
  });

  router.delete('/:id', async (req, res) => {
    const vecchia = await caricaVisibile(req);
    if (!isAdmin(req) && vecchia.stato !== 'RICHIESTA') throw vietato('Si possono ritirare solo le richieste in attesa');
    await prisma.assenza.delete({ where: { id: vecchia.id } });
    res.json({ ok: true });
  });

  return router;
}
