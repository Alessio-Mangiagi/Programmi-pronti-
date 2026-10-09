// "><(((º> sabusabu <º)))><"
// fornitori.routes.ts — Vista per fornitore delle consegne lette dai DDT.
//
// Riservato agli admin, come l'Archivio DDT: mostra lo storico di tutte le
// commesse. Le commesse di prova (nome "__...__") restano fuori, tranne quella
// dell'utente collegato — e' cosi' che i test vedono i propri dati.
//
//   GET /fornitori                    elenco fornitori con totali e anomalie
//   GET /fornitori/dettaglio?chiave=  consegne di un fornitore e totali per mese
//   GET /fornitori/excel[?chiave=]    lo stesso in Excel (elenco o dettaglio)
// Tutte accettano ?commessa=<id> per restringere a una commessa.
import express, { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { asyncHandler } from '../utils/errorHandler';
import logger from '../utils/logger';
import { requireAuth, requireAdmin } from '../middleware/auth';
import { BASE_DIR, COMMESSA_ID_RE, commessaDataDir, uniqueOutputPath } from './helpers';
import { ExcelService } from '../services/excelService';
import {
  Consegna,
  consegneCommessa,
  dettaglioFornitore,
  riepilogoFornitori,
} from '../services/consegne';

const router = express.Router();

/** Commesse con dati: cartelle di data/ con nome valido. */
function commesseVisibili(corrente: string): string[] {
  let voci: fs.Dirent[] = [];
  try {
    voci = fs.readdirSync(path.join(BASE_DIR, 'data'), { withFileTypes: true });
  } catch {
    return [];
  }
  return voci
    .filter((d) => d.isDirectory() && COMMESSA_ID_RE.test(d.name))
    .map((d) => d.name)
    .filter((n) => !/^__.*__$/.test(n) || n === corrente)
    .sort();
}

/** Righe delle commesse richieste; null se ?commessa= non e' tra quelle visibili. */
async function righePer(req: Request): Promise<{ commesse: string[]; righe: Consegna[] } | null> {
  const commesse = commesseVisibili(req.commessaId!);
  const filtro = typeof req.query.commessa === 'string' ? req.query.commessa : '';
  if (filtro && !commesse.includes(filtro)) {
    return null;
  }
  const scelte = filtro ? [filtro] : commesse;
  const righe: Consegna[] = [];
  for (const c of scelte) righe.push(...(await consegneCommessa(commessaDataDir(c), c)));
  return { commesse, righe };
}

function chiaveDa(req: Request): string {
  const c = typeof req.query.chiave === 'string' ? req.query.chiave : '';
  return /^(piva|nome):.{1,200}$/.test(c) ? c : '';
}

const fmtTotali = (t: Array<{ um: string; quantita: number }>) =>
  t.map((x) => `${x.quantita.toLocaleString('it-IT')} ${x.um || ''}`.trim()).join(' · ');

router.get(
  '/fornitori',
  requireAdmin,
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const sel = await righePer(req);
    if (!sel) return res.status(404).json({ error: 'Commessa sconosciuta' });
    const { commesse, righe } = sel;
    res.json({ commesse, fornitori: riepilogoFornitori(righe) });
  })
);

router.get(
  '/fornitori/dettaglio',
  requireAdmin,
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const chiave = chiaveDa(req);
    if (!chiave) return res.status(400).json({ error: 'Fornitore non valido' });
    const sel = await righePer(req);
    if (!sel) return res.status(404).json({ error: 'Commessa sconosciuta' });
    const { righe } = sel;
    const d = dettaglioFornitore(righe, chiave);
    if (!d) return res.status(404).json({ error: 'Fornitore non trovato' });
    res.json(d);
  })
);

router.get(
  '/fornitori/excel',
  requireAdmin,
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const sel = await righePer(req);
    if (!sel) return res.status(404).json({ error: 'Commessa sconosciuta' });
    const { righe } = sel;
    const chiave = chiaveDa(req);
    let dati: {
      summary: string;
      sheets: Array<{
        name: string;
        description: string;
        headers: string[];
        rows: (string | number | null)[][];
      }>;
    };
    let nomeFile: string;

    if (chiave) {
      const d = dettaglioFornitore(righe, chiave);
      if (!d) return res.status(404).json({ error: 'Fornitore non trovato' });
      const f = d.fornitore;
      dati = {
        summary: `${f.nome}${f.piva ? ` — P.IVA ${f.piva}` : ''} — ${f.ddt} DDT — ${fmtTotali(f.totali)}`,
        sheets: [
          {
            name: 'Consegne',
            description: 'una riga per DDT/materiale',
            headers: [
              'Data',
              'N°DDT',
              'Commessa',
              'Materiale',
              'Quantità',
              'u.m.',
              'Destinazione/WBS',
              'Targa',
              'Export',
            ],
            rows: d.consegne.map((r) => [
              r.data,
              r.ddt,
              r.commessa,
              r.materiale,
              r.quantita,
              r.um,
              r.destinazione,
              r.targa,
              r.export,
            ]),
          },
          {
            name: 'Per mese',
            description: 'totali mensili',
            headers: ['Mese', 'u.m.', 'Quantità', 'DDT'],
            rows: d.perMese.map((m) => [m.mese, m.um, m.quantita, m.ddt]),
          },
          {
            name: 'Anomalie',
            description: 'da verificare (vuoto se nessuna)',
            headers: ['Tipo', 'Segnalazione'],
            rows: f.anomalie.map((a) => [a.tipo, a.testo]),
          },
        ],
      };
      nomeFile = `Fornitore ${f.nome}`
        // eslint-disable-next-line no-control-regex -- i caratteri di controllo sono proprio ciò che va tolto dai nomi file
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
        .slice(0, 80);
    } else {
      const elenco = riepilogoFornitori(righe);
      dati = {
        summary: `Fornitori da DDT — ${elenco.length} fornitori`,
        sheets: [
          {
            name: 'Fornitori',
            description: 'riepilogo per fornitore',
            headers: [
              'Fornitore',
              'P.IVA',
              'DDT',
              'Prima consegna',
              'Ultima consegna',
              'Totali',
              'Commesse',
              'Anomalie',
            ],
            rows: elenco.map((f) => [
              f.nome,
              f.piva,
              f.ddt,
              f.prima,
              f.ultima,
              fmtTotali(f.totali),
              f.commesse.join(', '),
              f.anomalie.map((a) => a.testo).join(' | '),
            ]),
          },
        ],
      };
      nomeFile = 'Fornitori da DDT';
    }

    const out = uniqueOutputPath(req.commessaId!);
    await ExcelService.createXlsxFromData(dati, out);
    res.download(out, `${nomeFile}.xlsx`, (err) => {
      if (err) logger.error(`Invio Excel fornitori fallito: ${err.message}`);
      fs.promises.unlink(out).catch(() => {
        /* gia' rimosso */
      });
    });
  })
);

export default router;
