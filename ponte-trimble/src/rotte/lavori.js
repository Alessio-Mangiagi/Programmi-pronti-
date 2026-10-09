// API dei lavori: carica PDF -> stato -> scarica file -> carica su Trimble.
import express from 'express';
import fsp from 'node:fs/promises';
import multer from 'multer';
import { CONFIG } from '../config.js';
import * as archivio from '../archivio.js';
import { accoda, statoCoda } from '../coda.js';
import { elencaTraduttori, prendiTraduttore, caricaTraduttori } from '../pipeline/traduci.js';
import { FORMATI, formatiDisponibili } from '../pipeline/rendi.js';
import { consegna, statoDestinazione } from '../destinazione.js';
import { log } from '../log.js';

export class ErroreRichiesta extends Error {
  constructor(messaggio, stato = 400) {
    super(messaggio);
    this.name = 'ErroreRichiesta';
    this.stato = stato;
  }
}

export const rotteLavori = express.Router();

// Il PDF resta in memoria: lo scrive archivio.creaLavoro nella cartella del lavoro,
// cosi' non restano file temporanei orfani se la richiesta cade a meta'.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: CONFIG.maxPdfByte, files: CONFIG.maxFile },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    cb(ok ? null : new ErroreRichiesta('sono accettati solo file PDF'), ok);
  },
});

rotteLavori.get('/traduttori', async (req, res, next) => {
  try {
    // Gli errori di caricamento vanno in risposta, non solo nel log: se il file
    // consegnato non rispetta il contratto, si vede da qui perche' manca.
    const { errori } = await caricaTraduttori();
    res.json({ traduttori: await elencaTraduttori(), predefinito: CONFIG.traduttoreDefault, errori });
  } catch (e) {
    next(e);
  }
});

rotteLavori.get('/formati', (req, res) =>
  res.json({ formati: formatiDisponibili(), predefinito: CONFIG.formatoDefault }));

rotteLavori.post('/lavori', upload.array('pdf', CONFIG.maxFile), async (req, res, next) => {
  try {
    // Un solo file o venticinque trascinati insieme: stessa rotta, un lavoro per file.
    const file = req.files?.length ? req.files : (req.file ? [req.file] : []);
    if (!file.length) throw new ErroreRichiesta('manca il file PDF nel campo "pdf"');

    const traduttore = req.body.traduttore || CONFIG.traduttoreDefault;
    const formato = req.body.formato || CONFIG.formatoDefault;
    if (!await prendiTraduttore(traduttore)) throw new ErroreRichiesta('traduttore sconosciuto: ' + traduttore);
    if (!FORMATI[formato]) throw new ErroreRichiesta('formato sconosciuto: ' + formato);

    let opzioni = {};
    if (req.body.opzioni) {
      try {
        opzioni = JSON.parse(req.body.opzioni);
      } catch {
        throw new ErroreRichiesta('campo "opzioni" non e un JSON valido');
      }
    }

    const lavori = [];
    for (const f of file) {
      const lavoro = await archivio.creaLavoro({
        nomeFile: f.originalname,
        contenuto: f.buffer,
        traduttore,
        formato,
        opzioni,
        utente: req.cosedil?.username ?? null,
      });
      accoda(lavoro.id);
      lavori.push(lavoro);
    }

    log.info('accodati ' + lavori.length + ' lavori', {
      file: lavori.map((l) => l.nomeFile), traduttore, formato, utente: lavori[0].utente,
    });
    // "lavoro" resta il primo per chi manda un file solo e legge la risposta com'era.
    res.status(202).json({ lavoro: lavori[0], lavori, coda: statoCoda() });
  } catch (e) {
    next(e);
  }
});

rotteLavori.get('/lavori', async (req, res, next) => {
  try {
    const limite = Math.min(Number(req.query.limite) || 50, 500);
    res.json({ lavori: await archivio.elenca({ limite }), coda: statoCoda() });
  } catch (e) {
    next(e);
  }
});

rotteLavori.get('/lavori/:id', async (req, res, next) => {
  try {
    const lavoro = await archivio.leggi(req.params.id);
    if (!lavoro) throw new ErroreRichiesta('lavoro inesistente', 404);
    res.json({ lavoro });
  } catch (e) {
    next(e);
  }
});

rotteLavori.get('/lavori/:id/estratto', async (req, res, next) => {
  try {
    const lavoro = await archivio.leggi(req.params.id);
    if (!lavoro) throw new ErroreRichiesta('lavoro inesistente', 404);
    res.type('application/json').send(await fsp.readFile(archivio.fileDi(lavoro.id, 'estratto.json'), 'utf8'));
  } catch (e) {
    next(e.code === 'ENOENT' ? new ErroreRichiesta('estratto non ancora disponibile', 409) : e);
  }
});

// Record tradotti: e' quello che la UI mostra in anteprima, senza far scaricare
// il file e indipendentemente dal formato di uscita scelto.
rotteLavori.get('/lavori/:id/record', async (req, res, next) => {
  try {
    const lavoro = await archivio.leggi(req.params.id);
    if (!lavoro) throw new ErroreRichiesta('lavoro inesistente', 404);
    res.type('application/json').send(await fsp.readFile(archivio.fileDi(lavoro.id, 'record.json'), 'utf8'));
  } catch (e) {
    next(e.code === 'ENOENT' ? new ErroreRichiesta('record non ancora disponibili', 409) : e);
  }
});

// Rielabora: il PDF e' gia' in archivio, quindi cambiare traduttore o formato non
// richiede di ricaricarlo. Nasce un lavoro nuovo, cosi' il precedente resta a
// confronto (e' il modo in cui si tara un traduttore su un documento vero).
rotteLavori.post('/lavori/:id/rielabora', async (req, res, next) => {
  try {
    const vecchio = await archivio.leggi(req.params.id);
    if (!vecchio) throw new ErroreRichiesta('lavoro inesistente', 404);

    const traduttore = req.body?.traduttore || vecchio.traduttore;
    const formato = req.body?.formato || vecchio.formato;
    if (!await prendiTraduttore(traduttore)) throw new ErroreRichiesta('traduttore sconosciuto: ' + traduttore);
    if (!FORMATI[formato]) throw new ErroreRichiesta('formato sconosciuto: ' + formato);

    const contenuto = await fsp.readFile(archivio.fileDi(vecchio.id, 'origine.pdf'));
    const lavoro = await archivio.creaLavoro({
      nomeFile: vecchio.nomeFile,
      contenuto,
      traduttore,
      formato,
      opzioni: req.body?.opzioni ?? vecchio.opzioni,
      utente: req.cosedil?.username ?? null,
    });
    await archivio.aggiorna(lavoro.id, { rielaboraDa: vecchio.id });
    accoda(lavoro.id);

    log.info('lavoro ' + lavoro.id + ' rielabora ' + vecchio.id, { traduttore, formato });
    res.status(202).json({ lavoro: await archivio.leggi(lavoro.id), coda: statoCoda() });
  } catch (e) {
    next(e.code === 'ENOENT' ? new ErroreRichiesta('PDF di origine non piu disponibile', 409) : e);
  }
});

rotteLavori.delete('/lavori/:id', async (req, res, next) => {
  try {
    if (!await archivio.elimina(req.params.id)) throw new ErroreRichiesta('lavoro inesistente', 404);
    log.info('lavoro ' + req.params.id + ' eliminato', { utente: req.cosedil?.username ?? null });
    res.json({ eliminato: req.params.id });
  } catch (e) {
    next(e);
  }
});

rotteLavori.get('/lavori/:id/artefatto', async (req, res, next) => {
  try {
    // "><(((º> sabusabu <º)))><"
    const lavoro = await archivio.leggi(req.params.id);
    if (!lavoro) throw new ErroreRichiesta('lavoro inesistente', 404);
    if (lavoro.stato !== 'pronto') {
      throw new ErroreRichiesta('lavoro in stato "' + lavoro.stato + '": file non disponibile', 409);
    }
    const contenuto = await fsp.readFile(archivio.fileDi(lavoro.id, lavoro.risultato.file));
    res.type(lavoro.risultato.mime);
    res.setHeader('content-disposition', 'attachment; filename="' + encodeURIComponent(lavoro.risultato.nome) + '"');
    res.send(contenuto);
  } catch (e) {
    next(e);
  }
});

// Passo finale: consegna alla destinazione configurata (Field View, Connect o
// nessuna). Separato dalla conversione di proposito: prima si guarda l'esito,
// poi si consegna (o si ritenta dopo un errore).
rotteLavori.post('/lavori/:id/carica', async (req, res, next) => {
  try {
    const destinazione = statoDestinazione();
    if (!destinazione.configurata) {
      throw new ErroreRichiesta(`destinazione "${destinazione.nome}" non configurata: ${destinazione.motivo}`, 503);
    }

    const lavoro = await archivio.leggi(req.params.id);
    if (!lavoro) throw new ErroreRichiesta('lavoro inesistente', 404);
    if (lavoro.stato !== 'pronto') {
      throw new ErroreRichiesta('lavoro in stato "' + lavoro.stato + '": niente da consegnare', 409);
    }
    if (lavoro.trimble?.stato === 'caricato' && !req.body?.forza) {
      throw new ErroreRichiesta('gia consegnato: ripetere con {"forza":true} per rifarlo', 409);
    }

    const contenuto = await fsp.readFile(archivio.fileDi(lavoro.id, lavoro.risultato.file));
    try {
      const esito = await consegna(lavoro, contenuto, req.body || {});
      const aggiornato = await archivio.aggiorna(lavoro.id, { trimble: esito });
      log.info('lavoro ' + lavoro.id + ' consegnato a ' + esito.tipo, { formId: esito.formId, fileId: esito.fileId });
      res.json({ lavoro: aggiornato, destinazione: esito });
    } catch (e) {
      await archivio.aggiorna(lavoro.id, {
        trimble: { tipo: destinazione.nome, stato: 'errore', errore: e.message, caricatoIl: null },
      });
      throw e;
    }
  } catch (e) {
    next(e);
  }
});
