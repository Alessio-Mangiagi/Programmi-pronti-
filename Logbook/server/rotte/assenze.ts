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
 * Allegato (Giorno 22, risposta 3b): facoltativo, caricato prima con POST /api/file e
 * collegato qui per id; sostituirlo o eliminare l'assenza cancella il file vecchio. Il
 * dipendente lo cambia solo finché la richiesta è in attesa (come il resto).
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
import { ESTENSIONI_ALLEGATO_ASSENZA } from '../../comune/documenti';
import { contaGiorniLavorativi } from '../../comune/riepiloghi';
import { ErroreHttp, nonTrovato, richiestaNonValida, vietato } from '../errori';
import { dipendenteAmmesso, idDaParametro, isAdmin, richiediAdmin } from '../middleware';
import { eliminaFile, fileCollegabile, vistaFile } from '../servizi/archivio-file';
import { dataDaQuery } from './registrazioni';
import type { Avvisi } from '../servizi/avvisi';
import { tieniVivo } from '../vercel';
import { controllaPeriodoAperto } from '../servizi/mesi-chiusi';

const include = {
  dipendente: { select: { nome: true, cognome: true, matricola: true } },
  decisoDa: { select: { username: true } },
  file: true,
} as const;

/** `cartella`: dove stanno i file caricati (per cancellare l'allegato sostituito o dell'assenza eliminata). */
/** Richieste di assenza in attesa che un dipendente può avere insieme. */
export const MAX_RICHIESTE_IN_ATTESA = 30;

export function rotteAssenze(prisma: PrismaClient, cartella: string, avvisi?: Avvisi) {
  const router = Router();

  /** Aggiunge a ogni assenza il numero di giorni lavorativi che copre (festivi e weekend esclusi). */
  async function conGiorni<T extends Assenza & { file?: Parameters<typeof vistaFile>[0] }>(assenze: T[]) {
    if (!assenze.length) return [];
    const da = assenze.reduce((m, a) => (a.dataInizio < m ? a.dataInizio : m), assenze[0].dataInizio);
    const a = assenze.reduce((m, x) => (x.dataFine > m ? x.dataFine : m), assenze[0].dataFine);
    const festivi = new Set((await prisma.festivita.findMany({ where: { data: { gte: da, lte: a } }, select: { data: true } })).map((f) => f.data));
    // Il file si mostra senza dati interni (nome su disco, impronta).
    // Conteggio senza ciclo giorno per giorno: un'assenza lunghissima non blocca il server.
    return assenze.map((x) => ({ ...x, file: vistaFile(x.file), giorniLavorativi: contaGiorniLavorativi(x.dataInizio, x.dataFine, festivi) }));
  }

  /**
   * Allegato di un'assenza: oltre ai controlli comuni (stesso utente, non già usato) solo
   * PDF, .p7m e immagini. Word ed Excel no: i vecchi .doc/.xls possono contenere macro, e il
   * file lo carica il dipendente ma lo apre HR (verifica di sicurezza del Giorno 23).
   */
  async function allegatoAmmesso(fileId: number, utenteId: number) {
    const f = await fileCollegabile(prisma, fileId, utenteId);
    const ext = f.nomeDisco.split('.').pop() ?? '';
    if (!(ESTENSIONI_ALLEGATO_ASSENZA as readonly string[]).includes(ext)) {
      throw new ErroreHttp(415, `Alle assenze si allegano solo PDF, .p7m o immagini (${ESTENSIONI_ALLEGATO_ASSENZA.map((e) => `.${e}`).join(', ')})`, { fileId: 'Formato non ammesso' });
    }
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
    // Tetto alle richieste in attesa di un dipendente (26/11/2026): ogni richiesta manda
    // un'email a HR e può tenere un allegato, quindi senza tetto un account poteva intasare
    // la casella dell'ufficio personale e l'archivio.
    if (!admin && (await prisma.assenza.count({ where: { dipendenteId, stato: 'RICHIESTA' } })) >= MAX_RICHIESTE_IN_ATTESA) {
      throw new ErroreHttp(429, `Hai già ${MAX_RICHIESTE_IN_ATTESA} richieste in attesa: aspetta che HR le decida prima di mandarne altre`);
    }
    const completa = { ...dati, dipendenteId };
    // Giorno 37: un mese chiuso da HR non riceve più assenze, neanche come richiesta.
    await controllaPeriodoAperto(prisma, completa.dataInizio, completa.dataFine);
    await controllaSovrapposizioni(completa);
    if (stato === 'APPROVATA') await controllaOreNelPeriodo(completa);
    if (dati.fileId) await allegatoAmmesso(dati.fileId, req.utente!.id);
    const creata = await prisma.assenza.create({
      data: { ...completa, stato, ...(stato === 'APPROVATA' ? { decisoDaId: req.utente!.id, decisoIl: new Date() } : {}) },
      include,
    });
    // Avviso a HR (26/11/2026) solo per le richieste dei dipendenti: quelle che inserisce HR
    // le conosce già. Parte a risposta inviata: se la posta è lenta il dipendente non aspetta.
    if (!admin && avvisi) tieniVivo(avvisi.nuovaRichiesta(creata));
    res.status(201).json((await conGiorni([creata]))[0]);
  });

  router.put('/:id', async (req, res) => {
    const vecchia = await caricaVisibile(req);
    const admin = isAdmin(req);
    if (!admin && vecchia.stato !== 'RICHIESTA') throw vietato('La richiesta è già stata decisa da HR: per cambiarla rivolgiti a HR');
    const dati = schemaAssenza.parse(req.body);
    const completa = { ...dati, dipendenteId: vecchia.dipendenteId };
    // Giorno 37: né il periodo di prima né quello nuovo possono toccare un mese chiuso.
    await controllaPeriodoAperto(prisma, vecchia.dataInizio, vecchia.dataFine);
    await controllaPeriodoAperto(prisma, completa.dataInizio, completa.dataFine);
    await controllaSovrapposizioni(completa, vecchia.id);
    if (vecchia.stato === 'APPROVATA') await controllaOreNelPeriodo(completa);
    if (dati.fileId && dati.fileId !== vecchia.fileId) await allegatoAmmesso(dati.fileId, req.utente!.id);
    // Nota di HR facoltativa, stesso limite di 500 caratteri della decisione.
    const { noteHr } = z.object({ noteHr: z.string().trim().max(500, 'Nota di HR: massimo 500 caratteri').optional() }).parse({ noteHr: admin && typeof req.body?.noteHr === 'string' ? req.body.noteHr : undefined });
    const aggiornata = await prisma.assenza.update({
      where: { id: vecchia.id },
      data: {
        tipo: completa.tipo, dataInizio: completa.dataInizio, dataFine: completa.dataFine, minutiPermesso: completa.minutiPermesso,
        noteDipendente: completa.noteDipendente, protocolloCertificato: completa.protocolloCertificato, fileId: completa.fileId,
        // HR che modifica una richiesta può lasciare una nota (es. "date spostate d'accordo").
        ...(noteHr !== undefined ? { noteHr: noteHr || null } : {}),
      },
      include,
    });
    // File sostituito o tolto: il vecchio non serve più.
    if (vecchia.fileId && vecchia.fileId !== completa.fileId) await eliminaFile(prisma, cartella, vecchia.fileId);
    res.json((await conGiorni([aggiornata]))[0]);
  });

  /** Decisione di HR: approva o rifiuta (con motivo). Si può anche cambiare idea. */
  router.post('/:id/decisione', richiediAdmin, async (req, res) => {
    const vecchia = await caricaVisibile(req);
    const { stato, noteHr } = schemaDecisione.parse(req.body);
    await controllaPeriodoAperto(prisma, vecchia.dataInizio, vecchia.dataFine);
    if (stato === 'APPROVATA') {
      await controllaSovrapposizioni({ ...vecchia, noteDipendente: null }, vecchia.id);
      await controllaOreNelPeriodo(vecchia);
    }
    const decisa = await prisma.assenza.update({
      where: { id: vecchia.id },
      data: { stato, noteHr: noteHr ?? vecchia.noteHr, decisoDaId: req.utente!.id, decisoIl: new Date() },
      include,
    });
    // Esito al dipendente (26/11/2026), se in anagrafica ha un'email.
    if (avvisi) {
      const destinatario = await prisma.dipendente.findUnique({ where: { id: decisa.dipendenteId }, select: { nome: true, cognome: true, email: true } });
      if (destinatario) tieniVivo(avvisi.esitoRichiesta({ ...decisa, dipendente: destinatario }));
    }
    res.json((await conGiorni([decisa]))[0]);
  });

  router.delete('/:id', async (req, res) => {
    const vecchia = await caricaVisibile(req);
    if (!isAdmin(req) && vecchia.stato !== 'RICHIESTA') throw vietato('Si possono ritirare solo le richieste in attesa');
    await controllaPeriodoAperto(prisma, vecchia.dataInizio, vecchia.dataFine);
    await prisma.assenza.delete({ where: { id: vecchia.id } });
    await eliminaFile(prisma, cartella, vecchia.fileId);
    res.json({ ok: true });
  });

  return router;
}
