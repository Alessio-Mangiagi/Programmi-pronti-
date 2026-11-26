// "><(((º> sabusabu <º)))><"
/**
 * Timbratura da telefono (Giorno 42, 26/11/2026, risposta 2a: "il dipendente timbra, la
 * fascia vale solo dopo l'ok di HR"). Montata su /api/timbrature.
 *
 * Dal Giorno 20 le ore le inserisce solo HR, perché finiscono nei pagamenti. La timbratura
 * non cambia questa regola: il dipendente segna entrata e uscita, ma quello che nasce è una
 * "timbratura da confermare", non una fascia oraria. Diventa ore vere solo quando HR la
 * conferma (anche correggendo gli orari), e in quel momento passa per gli stessi controlli
 * di ogni altra ora: assegnazione al progetto, festivi, ferie, sovrapposizioni, massimo del
 * progetto, mese chiuso.
 *
 * Dipendente:
 * - GET  /mie       la timbratura aperta (se c'è), le ultime 15 e i progetti su cui può timbrare;
 * - POST /entrata   {progettoId}: apre una timbratura all'ora di adesso. Una sola aperta
 *                   per volta. Se ne era rimasta una aperta da un giorno precedente passa a
 *                   "da confermare" senza uscita: l'orario lo mette HR;
 * - POST /uscita    chiude quella aperta all'ora di adesso → "da confermare".
 * HR:
 * - GET  /               elenco (?stato=DA_CONFERMARE di default);
 * - POST /:id/conferma   {oraInizio?, oraFine?, noteHr?}: crea la fascia oraria;
 * - POST /:id/rifiuta    {noteHr}: non crea nulla, il dipendente vede il motivo.
 *
 * L'ora è quella del server nel fuso italiano, al minuto: il telefono non la decide.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { formattaData } from '../../comune/date';
import { durataMinuti } from '../../comune/orari';
import { messaggioMassimo, siSovrappongono, superamentiMassimo } from '../../comune/registrazioni';
import { ErroreHttp, nonTrovato, richiestaNonValida, vietato } from '../errori';
import { idDaParametro, richiediAdmin } from '../middleware';
import { controllaMesiAperti } from '../servizi/mesi-chiusi';
import { caricaContestoOre, erroriRegole } from '../servizi/regole-ore';

/** "HH:MM" nel fuso italiano per un istante (millisecondi dall'epoca). */
export function oraMinutiItalia(istante: number): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(istante));
}

const ora = (nome: string) => z.string({ error: `${nome}: campo obbligatorio` }).regex(/^([01]\d|2[0-3]):[0-5]\d$/, `${nome}: orario non valido (HH:MM)`);
const nota = z.string().trim().max(500, 'Nota: massimo 500 caratteri').optional();
const schemaConferma = z.object({ oraInizio: ora('Entrata').optional(), oraFine: ora('Uscita').optional(), noteHr: nota });
const schemaRifiuto = z.object({ noteHr: z.string({ error: 'Scrivi il motivo del rifiuto' }).trim().min(3, 'Scrivi il motivo del rifiuto').max(500, 'Nota: massimo 500 caratteri') });

const conNomi = {
  dipendente: { select: { nome: true, cognome: true, matricola: true } },
  progetto: { select: { id: true, codice: true, nome: true, colore: true } },
} as const;

export function rotteTimbrature(prisma: PrismaClient, oggi: () => string, adesso: () => number = Date.now) {
  const router = Router();

  /** Dipendente collegato all'account: la timbratura è personale, HR non timbra per altri da qui. */
  function mioDipendente(req: { utente?: { dipendenteId: number | null } }): number {
    const id = req.utente?.dipendenteId;
    if (id == null) throw vietato('Il tuo account non è collegato a una scheda dipendente: la timbratura non è disponibile');
    return id;
  }

  /** Progetti su cui il dipendente può timbrare: attivi e a lui assegnati. */
  const progettiTimbrabili = (dipendenteId: number) =>
    prisma.progetto.findMany({
      where: { stato: 'ATTIVO', assegnazioni: { some: { dipendenteId } } },
      select: { id: true, codice: true, nome: true, colore: true },
      orderBy: { codice: 'asc' },
    });

  router.get('/mie', async (req, res) => {
    const dipendenteId = mioDipendente(req);
    const [aperta, recenti, progetti] = await Promise.all([
      prisma.timbratura.findFirst({ where: { dipendenteId, stato: 'APERTA' }, include: conNomi }),
      prisma.timbratura.findMany({ where: { dipendenteId, stato: { not: 'APERTA' } }, include: conNomi, orderBy: { creatoIl: 'desc' }, take: 15 }),
      progettiTimbrabili(dipendenteId),
    ]);
    res.json({ oggi: oggi(), adesso: oraMinutiItalia(adesso()), aperta, recenti, progetti });
  });

  router.post('/entrata', async (req, res) => {
    const dipendenteId = mioDipendente(req);
    const { progettoId } = z.object({ progettoId: z.coerce.number({ error: 'Scegli il progetto' }).int().positive('Scegli il progetto') }).parse(req.body);
    const giorno = oggi();
    const adessoOra = oraMinutiItalia(adesso());
    const aperta = await prisma.timbratura.findFirst({ where: { dipendenteId, stato: 'APERTA' } });
    if (aperta && aperta.data === giorno) throw new ErroreHttp(409, `Hai già timbrato l'entrata alle ${aperta.oraInizio}: prima timbra l'uscita`);
    // Uscita dimenticata in un giorno precedente: resta agli atti senza orario di uscita, lo mette HR.
    if (aperta) await prisma.timbratura.update({ where: { id: aperta.id }, data: { stato: 'DA_CONFERMARE' } });
    if (!(await progettiTimbrabili(dipendenteId)).some((p) => p.id === progettoId)) {
      throw richiestaNonValida('Non puoi timbrare su questo progetto: non ti è assegnato o non è attivo', { progettoId: 'Progetto non disponibile' });
    }
    // Stesse regole delle ore (festivo, sabato e domenica, ferie, cessazione): meglio dirlo
    // subito al dipendente che scoprirlo quando HR prova a confermare.
    await controllaMesiAperti(prisma, [giorno]);
    const ctx = await caricaContestoOre(prisma, { dipendenteIds: [dipendenteId], da: giorno, a: giorno, oggi: giorno });
    const errori = erroriRegole(ctx, { dipendenteId, data: giorno, progettoId });
    if (errori.length) throw richiestaNonValida(errori[0].messaggio);
    const creata = await prisma.timbratura.create({ data: { dipendenteId, progettoId, data: giorno, oraInizio: adessoOra }, include: conNomi });
    res.status(201).json(creata);
  });

  router.post('/uscita', async (req, res) => {
    const dipendenteId = mioDipendente(req);
    const aperta = await prisma.timbratura.findFirst({ where: { dipendenteId, stato: 'APERTA' } });
    if (!aperta) throw new ErroreHttp(409, 'Non hai un\'entrata aperta: timbra prima l\'entrata');
    const giorno = oggi();
    const adessoOra = oraMinutiItalia(adesso());
    // Entrata di un altro giorno, o uscita nello stesso minuto dell'entrata: niente orario di
    // uscita credibile. Si chiude comunque, e l'orario lo completa HR.
    const oraFine = aperta.data === giorno && adessoOra > aperta.oraInizio ? adessoOra : null;
    const chiusa = await prisma.timbratura.update({ where: { id: aperta.id }, data: { oraFine, stato: 'DA_CONFERMARE' }, include: conNomi });
    res.json(chiusa);
  });

  router.get('/', richiediAdmin, async (req, res) => {
    const stato = z.enum(['APERTA', 'DA_CONFERMARE', 'CONFERMATA', 'RIFIUTATA']).catch('DA_CONFERMARE').parse(req.query.stato);
    res.json(await prisma.timbratura.findMany({ where: { stato }, include: conNomi, orderBy: [{ data: 'asc' }, { oraInizio: 'asc' }], take: 500 }));
  });

  router.post('/:id/conferma', richiediAdmin, async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const t = await prisma.timbratura.findUnique({ where: { id }, include: conNomi });
    if (!t) throw nonTrovato('Timbratura');
    if (t.stato !== 'DA_CONFERMARE') throw new ErroreHttp(409, t.stato === 'APERTA' ? 'Il dipendente non ha ancora timbrato l\'uscita' : 'Timbratura già decisa');
    const dati = schemaConferma.parse(req.body ?? {});
    const oraInizio = dati.oraInizio ?? t.oraInizio;
    const oraFine = dati.oraFine ?? t.oraFine;
    if (!oraFine) throw richiestaNonValida('Manca l\'orario di uscita: scrivilo prima di confermare', { oraFine: 'Uscita non timbrata: indica l\'orario' });
    if (oraFine <= oraInizio) throw richiestaNonValida('L\'uscita deve essere dopo l\'entrata', { oraFine: 'Deve essere dopo l\'entrata' });

    // Da qui in poi è un'ora come le altre: stessi controlli di rotte/registrazioni.ts.
    await controllaMesiAperti(prisma, [t.data]);
    const [ctx, delGiorno, progetti] = await Promise.all([
      caricaContestoOre(prisma, { dipendenteIds: [t.dipendenteId], da: t.data, a: t.data, oggi: oggi() }),
      prisma.registrazioneOraria.findMany({ where: { dipendenteId: t.dipendenteId, data: t.data }, include: { progetto: { select: { codice: true } } } }),
      prisma.progetto.findMany({ select: { id: true, codice: true, maxMinutiGiorno: true } }),
    ]);
    const errori = erroriRegole(ctx, { dipendenteId: t.dipendenteId, data: t.data, progettoId: t.progettoId }, new Set(delGiorno.map((f) => f.progettoId)));
    if (errori.length) throw richiestaNonValida(errori[0].messaggio);
    const nuova = { progettoId: t.progettoId, oraInizio, oraFine };
    const conflitto = delGiorno.find((f) => siSovrappongono(nuova, f));
    if (conflitto) {
      throw new ErroreHttp(409, `La fascia ${oraInizio}-${oraFine} si sovrappone a quella già registrata ${conflitto.oraInizio}-${conflitto.oraFine} (${conflitto.progetto.codice}) del ${formattaData(t.data)}`);
    }
    const oltre = superamentiMassimo([...delGiorno, nuova], new Map(progetti.map((p) => [p.id, p.maxMinutiGiorno])));
    if (oltre.length) throw richiestaNonValida(messaggioMassimo(progetti.find((p) => p.id === oltre[0].progettoId)?.codice ?? '?', oltre[0].minuti, oltre[0].massimo));

    const corretta = oraInizio !== t.oraInizio || oraFine !== t.oraFine;
    const [, confermata] = await prisma.$transaction([
      prisma.registrazioneOraria.create({ data: { dipendenteId: t.dipendenteId, progettoId: t.progettoId, data: t.data, oraInizio, oraFine, origine: 'TIMBRATURA', note: dati.noteHr || null } }),
      prisma.timbratura.update({
        where: { id },
        data: { stato: 'CONFERMATA', oraInizio, oraFine, noteHr: dati.noteHr || (corretta ? `Orario corretto da HR (timbrato ${t.oraInizio}-${t.oraFine ?? '?'})` : null), decisoDa: req.utente!.username, decisoIl: new Date() },
        include: conNomi,
      }),
    ]);
    res.json({ ...confermata, minuti: durataMinuti(oraInizio, oraFine) });
  });

  router.post('/:id/rifiuta', richiediAdmin, async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const t = await prisma.timbratura.findUnique({ where: { id } });
    if (!t) throw nonTrovato('Timbratura');
    if (t.stato !== 'DA_CONFERMARE') throw new ErroreHttp(409, 'Si rifiutano solo le timbrature da confermare');
    const { noteHr } = schemaRifiuto.parse(req.body ?? {});
    res.json(await prisma.timbratura.update({ where: { id }, data: { stato: 'RIFIUTATA', noteHr, decisoDa: req.utente!.username, decisoIl: new Date() }, include: conNomi }));
  });

  return router;
}
