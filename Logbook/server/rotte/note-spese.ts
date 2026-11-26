// "><(((º> sabusabu <º)))><"
/**
 * Note spese (Giorno 45, 26/11/2026, risposta 4c: "note spese con foto dello scontrino,
 * approvate da HR"). Montate su /api/note-spese.
 *
 * Il dipendente che anticipa una spesa (pranzo in trasferta, carburante, materiale) la
 * inserisce con importo, giorno, categoria, descrizione e la foto dello scontrino. HR la
 * approva o la rifiuta con il motivo; quando l'ha pagata la segna "rimborsata".
 *
 * Regole:
 * - il dipendente vede e scrive solo le proprie; lo scontrino è obbligatorio per lui (senza
 *   non si rimborsa), facoltativo per HR che inserisce a nome di un dipendente;
 * - il dipendente può correggere o ritirare una nota solo finché è RICHIESTA; dopo decide HR;
 * - il progetto è facoltativo; se indicato, per il dipendente deve essere uno dei suoi;
 * - niente date future; importo fra 0,01 e 10.000,00 euro;
 * - lo scontrino si carica prima con /api/file (PDF o immagine) e qui si passa il suo id.
 *
 * - GET  /                elenco (HR: tutte, filtro ?stato=; dipendente: le sue) + totali;
 * - POST /                nuova nota;
 * - PUT  /:id             modifica (finché è RICHIESTA);
 * - POST /:id/decisione   (HR) {stato: APPROVATA | RIFIUTATA, noteHr};
 * - POST /:id/rimborsata  (HR) da APPROVATA a RIMBORSATA;
 * - DELETE /:id           ritiro (dipendente: solo RICHIESTA; HR: sempre, tranne RIMBORSATA).
 */
import { Router, type Request } from 'express';
import { z } from 'zod';
import type { PrismaClient } from '../../generated/prisma/client';
import { isDataAmmessa, isDataValida, MESSAGGIO_DATA_MINIMA } from '../../comune/date';
import { ESTENSIONI_ALLEGATO_ASSENZA } from '../../comune/documenti';
import { ErroreHttp, nonTrovato, richiestaNonValida, vietato } from '../errori';
import { dipendenteAmmesso, idDaParametro, isAdmin, richiediAdmin } from '../middleware';
import { eliminaFile, fileCollegabile, vistaFile } from '../servizi/archivio-file';

export const CATEGORIE_SPESA = ['VITTO', 'ALLOGGIO', 'TRASPORTO', 'CARBURANTE', 'MATERIALE', 'ALTRO'] as const;
export const IMPORTO_MASSIMO_CENT = 10_000_00;
/** Note spese in attesa che un dipendente può avere insieme: oltre, deve aspettare HR. */
export const MAX_NOTE_IN_ATTESA = 30;

const idFacoltativo = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().positive().nullable());
const schemaNota = z.object({
  dipendenteId: idFacoltativo,
  progettoId: idFacoltativo,
  data: z.string({ error: 'Data: campo obbligatorio' }).refine(isDataValida, 'Data non valida').refine(isDataAmmessa, MESSAGGIO_DATA_MINIMA),
  categoria: z.enum(CATEGORIE_SPESA, { error: 'Scegli la categoria' }),
  importoCent: z.coerce
    .number({ error: 'Importo: numero non valido' })
    .int('Importo non valido')
    .min(1, 'Importo: deve essere maggiore di zero')
    .max(IMPORTO_MASSIMO_CENT, 'Importo: massimo 10.000,00 euro'),
  descrizione: z.string({ error: 'Descrizione: campo obbligatorio' }).trim().min(3, 'Descrizione: almeno 3 caratteri').max(300, 'Descrizione: massimo 300 caratteri'),
  fileId: idFacoltativo,
});
const schemaDecisione = z
  .object({ stato: z.enum(['APPROVATA', 'RIFIUTATA'], { error: 'Scegli se approvare o rifiutare' }), noteHr: z.string().trim().max(500, 'Nota: massimo 500 caratteri').optional() })
  .superRefine((d, ctx) => {
    if (d.stato === 'RIFIUTATA' && !d.noteHr) ctx.addIssue({ code: 'custom', path: ['noteHr'], message: 'Scrivi il motivo del rifiuto' });
  });

const include = {
  dipendente: { select: { nome: true, cognome: true, matricola: true } },
  progetto: { select: { id: true, codice: true, nome: true, colore: true } },
  file: true,
} as const;

export function rotteNoteSpese(prisma: PrismaClient, cartella: string, oggi: () => string) {
  const router = Router();

  type Nota = Awaited<ReturnType<typeof carica>>;
  const vista = (n: NonNullable<Nota>) => ({ ...n, file: vistaFile(n.file) });
  const carica = (id: number) => prisma.notaSpesa.findUnique({ where: { id }, include });

  /** La nota, se chi chiama la può vedere (HR tutte, il dipendente le sue). */
  async function caricaVisibile(req: Request) {
    const n = await carica(idDaParametro(req.params.id)!);
    if (!n) throw nonTrovato('Nota spese');
    if (!isAdmin(req) && n.dipendenteId !== req.utente!.dipendenteId) throw vietato('Non puoi vedere le note spese di altri dipendenti');
    return n;
  }

  /** Controlli comuni a creazione e modifica; restituisce i dati pronti da salvare. */
  async function prepara(req: Request, dipendenteId: number, fileGiaCollegato: number | null) {
    const dati = schemaNota.parse(req.body);
    if (dati.data > oggi()) throw richiestaNonValida('La data della spesa non può essere futura', { data: 'Data futura' });
    if (dati.progettoId) {
      const progetto = await prisma.progetto.findUnique({ where: { id: dati.progettoId }, include: { assegnazioni: { where: { dipendenteId }, select: { id: true } } } });
      if (!progetto) throw richiestaNonValida('Progetto inesistente', { progettoId: 'Progetto inesistente' });
      if (!isAdmin(req) && !progetto.assegnazioni.length) throw richiestaNonValida('Puoi imputare la spesa solo a un progetto a cui sei assegnato', { progettoId: 'Progetto non tuo' });
    }
    if (!dati.fileId && !isAdmin(req)) throw richiestaNonValida('Allega la foto o il PDF dello scontrino: senza non si può rimborsare', { fileId: 'Scontrino obbligatorio' });
    if (dati.fileId && dati.fileId !== fileGiaCollegato) {
      const f = await fileCollegabile(prisma, dati.fileId, req.utente!.id);
      const ext = f.nomeDisco.split('.').pop() ?? '';
      if (!(ESTENSIONI_ALLEGATO_ASSENZA as readonly string[]).includes(ext)) {
        throw new ErroreHttp(415, `Lo scontrino deve essere un PDF o un'immagine (${ESTENSIONI_ALLEGATO_ASSENZA.map((e) => `.${e}`).join(', ')})`, { fileId: 'Formato non ammesso' });
      }
    }
    return { progettoId: dati.progettoId, data: dati.data, categoria: dati.categoria, importoCent: dati.importoCent, descrizione: dati.descrizione, fileId: dati.fileId };
  }

  router.get('/', async (req, res) => {
    const soloId = dipendenteAmmesso(req);
    const stato = z.enum(['RICHIESTA', 'APPROVATA', 'RIFIUTATA', 'RIMBORSATA']).optional().catch(undefined).parse(req.query.stato);
    const note = await prisma.notaSpesa.findMany({
      where: { ...(soloId ? { dipendenteId: soloId } : {}), ...(stato ? { stato } : {}) },
      include,
      orderBy: [{ data: 'desc' }, { id: 'desc' }],
      take: 1000,
    });
    // Totali per stato su tutte le note visibili (non solo quelle del filtro).
    const gruppi = await prisma.notaSpesa.groupBy({ by: ['stato'], where: soloId ? { dipendenteId: soloId } : {}, _sum: { importoCent: true }, _count: true });
    const totali = Object.fromEntries(gruppi.map((g) => [g.stato, { note: g._count, importoCent: g._sum.importoCent ?? 0 }]));
    res.json({ note: note.map(vista), totali });
  });

  router.post('/', async (req, res) => {
    const richiesto = idFacoltativo.parse(req.body?.dipendenteId) ?? undefined;
    const dipendenteId = dipendenteAmmesso(req, richiesto) ?? richiesto;
    if (!dipendenteId) throw richiestaNonValida('Scegli il dipendente', { dipendenteId: 'Scegli il dipendente' });
    if (!(await prisma.dipendente.findUnique({ where: { id: dipendenteId } }))) throw richiestaNonValida('Dipendente inesistente', { dipendenteId: 'Dipendente inesistente' });
    if (!isAdmin(req) && (await prisma.notaSpesa.count({ where: { dipendenteId, stato: 'RICHIESTA' } })) >= MAX_NOTE_IN_ATTESA) {
      throw new ErroreHttp(429, `Hai già ${MAX_NOTE_IN_ATTESA} note spese in attesa: aspetta che HR le decida prima di inserirne altre`);
    }
    const dati = await prepara(req, dipendenteId, null);
    const creata = await prisma.notaSpesa.create({ data: { ...dati, dipendenteId }, include });
    res.status(201).json(vista(creata));
  });

  router.put('/:id', async (req, res) => {
    const vecchia = await caricaVisibile(req);
    if (vecchia.stato !== 'RICHIESTA') throw new ErroreHttp(409, 'La nota spese è già stata decisa: non si può più modificare');
    const dati = await prepara(req, vecchia.dipendenteId, vecchia.fileId);
    const aggiornata = await prisma.notaSpesa.update({ where: { id: vecchia.id }, data: dati, include });
    // Scontrino sostituito o tolto: il vecchio non serve più.
    if (vecchia.fileId && vecchia.fileId !== dati.fileId) await eliminaFile(prisma, cartella, vecchia.fileId);
    res.json(vista(aggiornata));
  });

  router.post('/:id/decisione', richiediAdmin, async (req, res) => {
    const vecchia = await caricaVisibile(req);
    if (vecchia.stato === 'RIMBORSATA') throw new ErroreHttp(409, 'La nota spese è già stata rimborsata');
    const { stato, noteHr } = schemaDecisione.parse(req.body);
    const decisa = await prisma.notaSpesa.update({ where: { id: vecchia.id }, data: { stato, noteHr: noteHr || null, decisoDa: req.utente!.username, decisoIl: new Date() }, include });
    res.json(vista(decisa));
  });

  router.post('/:id/rimborsata', richiediAdmin, async (req, res) => {
    const vecchia = await caricaVisibile(req);
    if (vecchia.stato !== 'APPROVATA') throw new ErroreHttp(409, 'Si segnano come rimborsate solo le note spese approvate');
    res.json(vista(await prisma.notaSpesa.update({ where: { id: vecchia.id }, data: { stato: 'RIMBORSATA', rimborsataIl: new Date() }, include })));
  });

  router.delete('/:id', async (req, res) => {
    const vecchia = await caricaVisibile(req);
    if (!isAdmin(req) && vecchia.stato !== 'RICHIESTA') throw vietato('Si possono ritirare solo le note spese ancora in attesa');
    if (vecchia.stato === 'RIMBORSATA') throw new ErroreHttp(409, 'Una nota spese rimborsata non si elimina: resta agli atti');
    await prisma.notaSpesa.delete({ where: { id: vecchia.id } });
    await eliminaFile(prisma, cartella, vecchia.fileId);
    res.json({ ok: true });
  });

  return router;
}
