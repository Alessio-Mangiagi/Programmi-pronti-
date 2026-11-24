// "><(((º> sabusabu <º)))><"
/**
 * Rotte di attestati e documenti del dipendente (solo HR), schede "Attestati" e
 * "Documenti" della scheda dipendente (richiesta del 24/11/2026, risposta 1c).
 *
 * /api/attestati
 * - GET    ?dipendenteId=&stato=IN_SCADENZA|SCADUTO   elenco con stato calcolato a oggi
 * - POST   { dipendenteId, tipo, titolo, dataRilascio, dataScadenza?, note?, fileId? }
 * - PUT    /:id   stessi campi; un fileId diverso sostituisce il file (il vecchio si cancella)
 * - DELETE /:id   anche il file
 *
 * /api/documenti-dipendente
 * - GET    ?dipendenteId=
 * - POST   { dipendenteId, titolo, note?, fileId }
 * - DELETE /:id   anche il file
 *
 * Il file si carica prima con POST /api/file (server/rotte/file.ts); qui si collega
 * solo se l'ha caricato lo stesso utente e non è già usato (fileCollegabile).
 */
import { Router } from 'express';
import type { PrismaClient } from '../../generated/prisma/client';
import { schemaAttestato, schemaDocumentoDipendente, statoAttestato, type StatoAttestato } from '../../comune/documenti';
import { nonTrovato } from '../errori';
import { idDaParametro, richiediAdmin } from '../middleware';
import { eliminaFile, fileCollegabile, vistaFile } from '../servizi/archivio-file';

const conFile = { file: true, dipendente: { select: { id: true, nome: true, cognome: true, matricola: true, stato: true } } } as const;

export function rotteAttestati(prisma: PrismaClient, cartella: string, oggi: () => string) {
  const router = Router();
  router.use(richiediAdmin);

  const vista = <T extends { dataScadenza: string | null; file: Parameters<typeof vistaFile>[0] }>(a: T) => ({
    ...a,
    file: vistaFile(a.file),
    stato: statoAttestato(a.dataScadenza, oggi()),
  });

  const esisteDipendente = async (id: number) => {
    if (!(await prisma.dipendente.findUnique({ where: { id } }))) throw nonTrovato('Dipendente');
  };

  router.get('/', async (req, res) => {
    const dipendenteId = idDaParametro(req.query.dipendenteId, 'dipendenteId');
    const elenco = await prisma.attestato.findMany({
      where: dipendenteId ? { dipendenteId } : {},
      include: conFile,
      orderBy: [{ dataScadenza: 'asc' }, { titolo: 'asc' }],
    });
    const filtro = req.query.stato as StatoAttestato | undefined;
    res.json(elenco.map(vista).filter((a) => !filtro || a.stato === filtro));
  });

  router.post('/', async (req, res) => {
    const d = schemaAttestato.parse(req.body);
    await esisteDipendente(d.dipendenteId);
    if (d.fileId) await fileCollegabile(prisma, d.fileId, req.utente!.id);
    const a = await prisma.attestato.create({ data: d, include: conFile });
    res.status(201).json(vista(a));
  });

  router.put('/:id', async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const prima = await prisma.attestato.findUnique({ where: { id } });
    if (!prima) throw nonTrovato('Attestato');
    const d = schemaAttestato.parse(req.body);
    if (d.fileId && d.fileId !== prima.fileId) await fileCollegabile(prisma, d.fileId, req.utente!.id);
    const a = await prisma.attestato.update({ where: { id }, data: d, include: conFile });
    // File sostituito o tolto: il vecchio non serve più.
    if (prima.fileId && prima.fileId !== d.fileId) await eliminaFile(prisma, cartella, prima.fileId);
    res.json(vista(a));
  });

  router.delete('/:id', async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const a = await prisma.attestato.findUnique({ where: { id } });
    if (!a) throw nonTrovato('Attestato');
    await prisma.attestato.delete({ where: { id } });
    await eliminaFile(prisma, cartella, a.fileId);
    res.status(204).end();
  });

  return router;
}

export function rotteDocumentiDipendente(prisma: PrismaClient, cartella: string) {
  const router = Router();
  router.use(richiediAdmin);

  router.get('/', async (req, res) => {
    const dipendenteId = idDaParametro(req.query.dipendenteId, 'dipendenteId');
    const elenco = await prisma.documentoDipendente.findMany({
      where: dipendenteId ? { dipendenteId } : {},
      include: { file: true },
      orderBy: { creatoIl: 'desc' },
    });
    res.json(elenco.map((d) => ({ ...d, file: vistaFile(d.file) })));
  });

  router.post('/', async (req, res) => {
    const d = schemaDocumentoDipendente.parse(req.body);
    if (!(await prisma.dipendente.findUnique({ where: { id: d.dipendenteId } }))) throw nonTrovato('Dipendente');
    await fileCollegabile(prisma, d.fileId, req.utente!.id);
    const doc = await prisma.documentoDipendente.create({ data: d, include: { file: true } });
    res.status(201).json({ ...doc, file: vistaFile(doc.file) });
  });

  router.delete('/:id', async (req, res) => {
    const id = idDaParametro(req.params.id)!;
    const doc = await prisma.documentoDipendente.findUnique({ where: { id } });
    if (!doc) throw nonTrovato('Documento');
    await prisma.documentoDipendente.delete({ where: { id } });
    await eliminaFile(prisma, cartella, doc.fileId);
    res.status(204).end();
  });

  return router;
}
