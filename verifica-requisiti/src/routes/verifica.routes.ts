/**
 * verifica.routes.ts — esecuzione dei controlli e report.
 */
import express, { Request, Response } from 'express';
import { asyncHandler } from '../utils/errorHandler';
import { param } from './helpers';
import logger from '../utils/logger';
import { requireAuth, utenteDi } from '../middleware/auth';
import { verificheEseguite } from '../utils/metrics';
import { trovaDocumento } from '../models/archivio';
import { trovaSet } from '../models/requisiti';
import { elencaVerifiche, salvaVerifica, trovaVerifica } from '../models/verifiche';
import { verificaDocumento } from '../services/regole';
import { reportExcel } from '../services/report';
import { estraiJson, verificaDaRisposta } from '../services/importaEsito';

const router = express.Router();

// ── POST /api/verifiche — esegue una checklist su uno o più documenti ───────
// { setId, documentoIds: [...] }  →  una Verifica per documento.
router.post(
  '/api/verifiche',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { setId } = req.body as { setId?: string };
    const ids: string[] = Array.isArray(req.body.documentoIds)
      ? req.body.documentoIds
      : req.body.documentoId
        ? [req.body.documentoId]
        : [];

    if (!setId) return res.status(400).json({ error: 'Manca setId (quale checklist applicare)' });
    if (ids.length === 0) return res.status(400).json({ error: 'Nessun documento indicato' });

    const set = trovaSet(setId);
    if (!set) return res.status(404).json({ error: 'Checklist non trovata' });

    const eseguite = [];
    const scartati: Array<{ documentoId: string; motivo: string }> = [];

    for (const id of ids) {
      const doc = trovaDocumento(id);
      if (!doc) {
        scartati.push({ documentoId: id, motivo: 'Documento non trovato' });
        continue;
      }
      // Verificare un documento senza testo darebbe "ko" a tutto per un motivo
      // che non c'entra con i requisiti: meglio dirlo chiaramente.
      if (doc.stato !== 'pronto') {
        scartati.push({
          documentoId: id,
          motivo:
            doc.stato === 'errore'
              ? `Estrazione fallita: ${doc.errore ?? 'motivo ignoto'}`
              : 'Estrazione del testo non ancora completata',
        });
        continue;
      }

      const verifica = salvaVerifica(verificaDocumento(doc, set, utenteDi(req)));
      verificheEseguite.inc({ esito: verifica.esito });
      eseguite.push(verifica);
    }

    logger.info(
      `Checklist "${set.nome}" su ${eseguite.length} documenti da ${utenteDi(req)}` +
        (scartati.length ? ` (${scartati.length} saltati)` : '')
    );
    res.status(201).json({ verifiche: eseguite, scartati });
  })
);

// ── POST /api/verifiche/importa — esito incollato dalla chat di Claude ──────
// { risposta, documentoId?, setId? }: la risposta della chat diventa una
// verifica nello storico, con la stessa forma di quelle calcolate dalle regole.
// Così i due percorsi (regole locali e confronto con Claude) finiscono nello
// stesso posto e producono lo stesso report Excel.
router.post(
  '/api/verifiche/importa',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { risposta, documentoId, setId } = req.body as {
      risposta?: string;
      documentoId?: string;
      setId?: string;
    };
    if (!risposta || !String(risposta).trim()) {
      return res.status(400).json({ error: 'Incolla la risposta di Claude prima di importare' });
    }

    const doc = documentoId ? trovaDocumento(documentoId) : undefined;
    if (documentoId && !doc) return res.status(404).json({ error: 'Documento non trovato' });
    const set = setId ? trovaSet(setId) : undefined;

    const verifica = salvaVerifica(
      verificaDaRisposta(estraiJson(String(risposta)), {
        documentoId: doc?.id,
        nomeFileArchivio: doc?.nomeFile,
        setId: set?.id,
        nomeSet: set?.nome,
        eseguitaDa: utenteDi(req),
      })
    );
    verificheEseguite.inc({ esito: verifica.esito });

    logger.info(
      `Esito importato da Claude per "${verifica.nomeFile}": ${verifica.esito} ` +
        `(${verifica.risultati.length} requisiti) da ${utenteDi(req)}`
    );
    res.status(201).json({ verifica });
  })
);

// ── GET /api/verifiche?documentoId=&setId= ──────────────────────────────────
router.get('/api/verifiche', requireAuth, (req: Request, res: Response) => {
  const verifiche = elencaVerifiche({
    documentoId: req.query.documentoId ? String(req.query.documentoId) : undefined,
    setId: req.query.setId ? String(req.query.setId) : undefined,
  });
  // Elenco senza i riscontri: la scheda singola li ha tutti.
  res.json({
    verifiche: verifiche.map((v) => ({
      id: v.id,
      documentoId: v.documentoId,
      nomeFile: v.nomeFile,
      setId: v.setId,
      nomeSet: v.nomeSet,
      esito: v.esito,
      eseguitaIl: v.eseguitaIl,
      eseguitaDa: v.eseguitaDa,
      conteggi: {
        ok: v.risultati.filter((r) => r.esito === 'ok').length,
        ko: v.risultati.filter((r) => r.esito === 'ko').length,
        dubbio: v.risultati.filter((r) => r.esito === 'dubbio' || r.esito === 'non-applicabile').length,
      },
    })),
  });
});

// ── GET /api/verifiche/:id ──────────────────────────────────────────────────
router.get('/api/verifiche/:id', requireAuth, (req: Request, res: Response) => {
  const verifica = trovaVerifica(param(req.params, 'id'));
  if (!verifica) return res.status(404).json({ error: 'Verifica non trovata' });
  res.json({ verifica });
});

// ── GET /api/verifiche/:id/report.xlsx ──────────────────────────────────────
router.get(
  '/api/verifiche/:id/report.xlsx',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const verifica = trovaVerifica(param(req.params, 'id'));
    if (!verifica) return res.status(404).json({ error: 'Verifica non trovata' });

    const buffer = await reportExcel([verifica]);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="verifica-${verifica.id}.xlsx"`);
    res.send(buffer);
  })
);

// ── POST /api/verifiche/report.xlsx — report cumulativo ─────────────────────
// { verificheIds: [...] }: un solo file con più documenti, per la cartella
// di commessa o per mandarlo al fornitore.
router.post(
  '/api/verifiche/report.xlsx',
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const ids: string[] = Array.isArray(req.body.verificheIds) ? req.body.verificheIds : [];
    const verifiche = ids.map(trovaVerifica).filter((v): v is NonNullable<typeof v> => !!v);
    if (verifiche.length === 0) return res.status(400).json({ error: 'Nessuna verifica valida indicata' });

    const buffer = await reportExcel(verifiche);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="verifiche.xlsx"');
    res.send(buffer);
  })
);

export default router;
