// "><(((º> sabusabu <º)))><"
/**
 * Documentazione di avanzamento e note interne dei progetti (Giorno 17, 24/11/2026,
 * risposte 2c e 4a): "nei progetti deve essere possibile inserire la documentazione da
 * parte degli utenti in modo da poter supervisionare l'avanzamento".
 *
 * /api/documenti-progetto
 * - GET    ?progettoId=&data=&daVedere=1   HR vede tutto (data = un giorno, usata dalla
 *                                    finestra delle ore; daVedere = solo i non ancora visti);
 *                                    il dipendente vede solo quello che ha caricato lui
 *                                    (dal Giorno 20 nulla di nuovo: carica solo HR)
 * - POST   { progettoId, data, titolo, nota?, percentuale?, fileId?, origine? }
 *          solo HR dal Giorno 20 (risposta 2 "tutti i dati li inserisce HR"), su progetti
 *          non chiusi, mai con data futura. Quello che carica HR nasce già "visto".
 * - PATCH  /:id/revisione { visto?, rispostaHr? }   solo HR: "visto" e risposta
 * - DELETE /:id   solo HR (anche il file)
 * - POST   /:id/skytower   solo HR: invia il file nella commessa SkyTower del progetto
 *          (serve il collegamento in Impostazioni e il codice commessa nel progetto)
 *
 * /api/note-progetto (solo HR, i dipendenti non le vedono)
 * - GET ?progettoId=   - POST { progettoId, testo }   - DELETE /:id
 *
 * Il file si carica prima con POST /api/file e qui si collega per id (fileCollegabile:
 * stesso utente, non già usato).
 */
import { Router } from 'express';
import type { Prisma, PrismaClient } from '../../generated/prisma/client';
import { formattaData } from '../../comune/date';
import { schemaDocumentoProgetto, schemaNotaProgetto, schemaRevisioneDocumento } from '../../comune/documenti';
import { ErroreHttp, nonTrovato, richiestaNonValida } from '../errori';
import { idDaParametro, isAdmin, richiediAdmin } from '../middleware';
import { eliminaFile, fileCollegabile, leggiContenuto, vistaFile } from '../servizi/archivio-file';
import { inviaDocumento, leggiCollegamento } from '../servizi/skytower';
import { dataDaQuery } from './registrazioni';

/** Relazioni da includere per mostrare un documento: file, autore (con nome), chi l'ha visto, progetto. */
const COLLEGATI = {
  file: true,
  autore: { select: { id: true, username: true, dipendente: { select: { nome: true, cognome: true } } } },
  vistoDa: { select: { username: true } },
  progetto: { select: { id: true, codice: true, nome: true, colore: true, commessaSkytower: true } },
} as const satisfies Prisma.DocumentoProgettoInclude;

type DocumentoCompleto = Prisma.DocumentoProgettoGetPayload<{ include: typeof COLLEGATI }>;

/** Forma per l'interfaccia: nome leggibile dell'autore e file senza dati interni. */
function vista(d: DocumentoCompleto) {
  const { autore, file, ...resto } = d;
  return {
    ...resto,
    file: vistaFile(file),
    autore: { id: autore.id, nome: autore.dipendente ? `${autore.dipendente.cognome} ${autore.dipendente.nome}` : autore.username },
  };
}

export function rotteDocumentiProgetto(prisma: PrismaClient, cartella: string, oggi: () => string) {
  const router = Router();

  /** Documento esistente, altrimenti 404. */
  async function documento(id: number) {
    const d = await prisma.documentoProgetto.findUnique({ where: { id }, include: COLLEGATI });
    if (!d) throw nonTrovato('Documento');
    return d;
  }

  /** HR carica su qualsiasi progetto non chiuso. */
  async function controllaProgetto(progettoId: number) {
    const p = await prisma.progetto.findUnique({ where: { id: progettoId } });
    if (!p) throw nonTrovato('Progetto');
    if (p.stato === 'CHIUSO') throw richiestaNonValida(`Il progetto ${p.codice} è chiuso`, { progettoId: 'Progetto chiuso' });
    return p;
  }

  router.get('/', async (req, res) => {
    const progettoId = idDaParametro(req.query.progettoId, 'progettoId');
    const daVedere = req.query.daVedere === '1';
    // Giorno 28: ?data= per la documentazione del giorno nella finestra delle ore (risposta 3c).
    const data = dataDaQuery(req.query.data, 'data');
    const elenco = await prisma.documentoProgetto.findMany({
      where: {
        ...(progettoId ? { progettoId } : {}),
        ...(data ? { data } : {}),
        // Il dipendente vede solo il suo (risposta 2c); HR tutto.
        ...(isAdmin(req) ? {} : { autoreId: req.utente!.id }),
        ...(daVedere ? { visto: false } : {}),
      },
      include: COLLEGATI,
      orderBy: [{ data: 'desc' }, { creatoIl: 'desc' }],
    });
    res.json(elenco.map((d) => vista(d)));
  });

  router.post('/', richiediAdmin, async (req, res) => {
    const d = schemaDocumentoProgetto.parse(req.body);
    await controllaProgetto(d.progettoId);
    if (d.data > oggi()) throw richiestaNonValida('La documentazione non può avere una data futura', { data: 'Data futura' });
    if (d.fileId) await fileCollegabile(prisma, d.fileId, req.utente!.id);
    // Caricato da HR: è già "visto" (nessuno deve rivederlo), resta riapribile con "Segna da vedere".
    const creato = await prisma.documentoProgetto.create({
      data: { ...d, autoreId: req.utente!.id, visto: true, vistoIl: new Date(), vistoDaId: req.utente!.id },
      include: COLLEGATI,
    });
    res.status(201).json(vista(creato));
  });

  router.patch('/:id/revisione', richiediAdmin, async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    await documento(id);
    const r = schemaRevisioneDocumento.parse(req.body);
    const aggiornato = await prisma.documentoProgetto.update({
      where: { id },
      data: {
        ...(r.visto === undefined ? {} : r.visto ? { visto: true, vistoIl: new Date(), vistoDaId: req.utente!.id } : { visto: false, vistoIl: null, vistoDaId: null }),
        ...(r.rispostaHr === undefined ? {} : { rispostaHr: r.rispostaHr }),
      },
      include: COLLEGATI,
    });
    res.json(vista(aggiornato));
  });

  router.delete('/:id', richiediAdmin, async (req, res) => {
    const d = await documento(idDaParametro(req.params.id)!);
    await prisma.documentoProgetto.delete({ where: { id: d.id } });
    await eliminaFile(prisma, cartella, d.fileId);
    res.status(204).end();
  });

  /**
   * Invio a SkyTower (risposta 4a "b come pulsante"): il file va nella commessa indicata nel
   * progetto, come documento di tipo RP con gli estremi di Copilota negli attributi.
   */
  router.post('/:id/skytower', richiediAdmin, async (req, res) => {
    const d = await documento(idDaParametro(req.params.id)!);
    const collegamento = await leggiCollegamento(prisma);
    if (!collegamento) throw richiestaNonValida('Collegamento a SkyTower non configurato: un amministratore lo imposta in Impostazioni');
    if (!d.progetto.commessaSkytower) throw richiestaNonValida(`Il progetto ${d.progetto.codice} non ha la commessa SkyTower: indicala nei dati del progetto`);
    if (!d.file) throw richiestaNonValida('Si inviano a SkyTower solo i documenti con un file allegato');
    if (d.skytowerInviatoIl) throw new ErroreHttp(409, `Documento già inviato a SkyTower il ${formattaData(d.skytowerInviatoIl.toISOString().slice(0, 10))}`);
    const dati = await leggiContenuto(prisma, cartella, d.file.nomeDisco);
    if (!dati) throw new ErroreHttp(404, 'Il file non è più nell\'archivio dei documenti');
    const esito = await inviaDocumento(collegamento, d.progetto.commessaSkytower, {
      dati,
      tipo: d.file.tipoMime,
      nome: d.file.nomeOriginale,
      titolo: d.titolo,
      descrizione: d.nota ?? undefined,
      attributi: {
        origine: 'logbook',
        progetto: d.progetto.codice,
        autore: vista(d).autore.nome,
        data: d.data,
        ...(d.percentuale != null ? { avanzamento: d.percentuale } : {}),
      },
    });
    const aggiornato = await prisma.documentoProgetto.update({
      where: { id: d.id },
      // Il link torna da SkyTower e diventa un <a href> nell'interfaccia: solo http(s).
      data: { skytowerId: esito.identificativo, skytowerUrl: esito.url && /^https?:\/\//i.test(esito.url) ? esito.url : null, skytowerInviatoIl: new Date() },
      include: COLLEGATI,
    });
    res.json(vista(aggiornato));
  });

  return router;
}

export function rotteNoteProgetto(prisma: PrismaClient) {
  const router = Router();
  router.use(richiediAdmin);

  const conAutore = { autore: { select: { username: true, dipendente: { select: { nome: true, cognome: true } } } } } as const;
  const vistaNota = (n: { autore: { username: string; dipendente: { nome: string; cognome: string } | null } } & Record<string, unknown>) => ({
    ...n,
    autore: n.autore.dipendente ? `${n.autore.dipendente.cognome} ${n.autore.dipendente.nome}` : n.autore.username,
  });

  router.get('/', async (req, res) => {
    const progettoId = idDaParametro(req.query.progettoId, 'progettoId');
    if (!progettoId) throw richiestaNonValida('Indica il progetto (progettoId)');
    const note = await prisma.notaProgetto.findMany({ where: { progettoId }, include: conAutore, orderBy: { creatoIl: 'desc' } });
    res.json(note.map(vistaNota));
  });

  router.post('/', async (req, res) => {
    const progettoId = idDaParametro(req.body?.progettoId, 'progettoId');
    if (!progettoId || !(await prisma.progetto.findUnique({ where: { id: progettoId } }))) throw nonTrovato('Progetto');
    const { testo } = schemaNotaProgetto.parse(req.body);
    const nota = await prisma.notaProgetto.create({ data: { progettoId, testo, autoreId: req.utente!.id }, include: conAutore });
    res.status(201).json(vistaNota(nota));
  });

  router.delete('/:id', async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const tolte = await prisma.notaProgetto.deleteMany({ where: { id } });
    if (!tolte.count) throw nonTrovato('Nota');
    res.status(204).end();
  });

  return router;
}
