// "><(((º> sabusabu <º)))><"
// Documenti da SkyTower: i PCQ e i computi stanno già nel CDE della suite, non
// serve riscaricarli e ricaricarli a mano. Commessa dal registro della suite ->
// documenti pubblicati -> i byte della revisione entrano nella stessa pipeline
// dell'upload (archivio.creaLavoro + coda).
import express from 'express';
import { createRequire } from 'node:module';
import * as archivio from '../archivio.js';
import { accoda, statoCoda } from '../coda.js';
import { prendiTraduttore } from '../pipeline/traduci.js';
import { FORMATI } from '../pipeline/rendi.js';
import { CONFIG } from '../config.js';
import { log } from '../log.js';
import { eBustaFirmata } from '../firma.js';
import { ErroreRichiesta } from './errori.js';

const require = createRequire(import.meta.url);
const suite = require('../../../shared/suite/suite_link.js');

// Sostituibili nei test (SkyTower finto): le rotte passano sempre da qui.
export const dipendenze = {
  chiama: (...a) => suite.chiama(...a),
  commesse: (o) => suite.commesse(o),
  normalizza: (c) => suite.normalizzaCommessa(c),
};

export const rotteSkyTower = express.Router();

// Chi è l'utente del portale, per SkyTower: username, nome ed email (SkyTower riconosce l'utente
// dall'email; senza, cadrebbe sull'utente tecnico).
function utente(req) {
  return { utente: req.cosedil?.username || undefined, nome: req.cosedil?.nome || undefined, email: req.cosedil?.email || undefined };
}

/** Un SuiteError diventa una risposta chiara: 503 app spenta, altrimenti il suo stato. */
function inoltra(e) {
  if (e && typeof e.stato === 'number' && e.messaggio) return new ErroreRichiesta(e.messaggio, e.stato >= 500 ? 503 : e.stato);
  return e;
}

// Commesse: registro della suite + quelle che SkyTower conosce (progetti con codice).
rotteSkyTower.get('/skytower/commesse', async (req, res, next) => {
  try {
    const perCodice = new Map();
    for (const c of dipendenze.commesse({ soloAttive: true })) {
      perCodice.set(dipendenze.normalizza(c.code), { code: c.code, nome: c.nome, fonte: 'registro', skytower: false });
    }
    let avviso = '';
    try {
      const lista = await dipendenze.chiama('skytower', 'GET', '/suite/commesse', { ...utente(req), timeout: 5000 });
      for (const p of (Array.isArray(lista) ? lista : lista?.items || [])) {
        const code = p.commessa || p.code;
        if (!code) continue;
        const k = dipendenze.normalizza(code);
        const voce = perCodice.get(k) || { code, nome: p.name || p.nome || '', fonte: 'skytower' };
        voce.skytower = true;
        if (!voce.nome) voce.nome = p.name || p.nome || '';
        perCodice.set(k, voce);
      }
    } catch (e) {
      avviso = e.messaggio || e.message;
    }
    const commesse = [...perCodice.values()].sort((a, b) => a.code.localeCompare(b.code));
    res.json({ commesse, avviso });
  } catch (e) {
    next(e);
  }
});

// Documenti pubblicati di una commessa (filtro di testo facoltativo).
rotteSkyTower.get('/skytower/documenti', async (req, res, next) => {
  try {
    const commessa = String(req.query.commessa || '').trim();
    if (!commessa) throw new ErroreRichiesta('manca la commessa');
    const q = String(req.query.q || '').trim();
    const dati = await dipendenze.chiama('skytower', 'GET', '/suite/commesse/' + encodeURIComponent(commessa) + '/documenti',
      { parametri: { area: String(req.query.area || 'PUBLISHED'), q, limit: 100 }, ...utente(req), timeout: 10000 });
    const documenti = (dati?.items || []).map((d) => ({
      revision_id: d.revision_id, document_id: d.id, identifier: d.identifier, title: d.title,
      revision_code: d.revision_code, filename: d.filename, content_type: d.content_type, size_bytes: d.size_bytes,
      // i PDF firmati .p7m contano come PDF: la pipeline apre la busta e verifica la firma
      firmato: /\.p7m$/i.test(d.filename || '') || /pkcs7/i.test(d.content_type || ''),
      pdf: /pdf|pkcs7/i.test(d.content_type || '') || /\.(pdf|p7m)$/i.test(d.filename || ''),
    }));
    res.json({ documenti, commessa });
  } catch (e) {
    next(inoltra(e));
  }
});

// Un documento di SkyTower diventa un lavoro, come un PDF caricato a mano.
rotteSkyTower.post('/lavori/da-skytower', async (req, res, next) => {
  try {
    const { revision_id: revisionId, commessa, traduttore = CONFIG.traduttoreDefault, formato = CONFIG.formatoDefault, opzioni = {} } = req.body || {};
    if (!revisionId || !/^[0-9a-f-]{20,40}$/i.test(String(revisionId))) throw new ErroreRichiesta('manca revision_id');
    if (!commessa || !String(commessa).trim()) throw new ErroreRichiesta('manca la commessa');
    if (!await prendiTraduttore(traduttore)) throw new ErroreRichiesta('traduttore sconosciuto: ' + traduttore);
    if (!FORMATI[formato]) throw new ErroreRichiesta('formato sconosciuto: ' + formato);
    if (opzioni && typeof opzioni !== 'object') throw new ErroreRichiesta('campo "opzioni" non valido');

    // La revisione deve stare fra i documenti della commessa scelta: il download usa il token di
    // servizio, che in SkyTower vede tutti i progetti, quindi senza questo controllo un UUID preso
    // altrove (link, log, altra organizzazione) farebbe uscire il testo di qualunque documento
    // (revisione di sicurezza del 03/11/2026). L'elenco è lo stesso che la pagina mostra.
    const voce = await revisioneDellaCommessa(String(commessa).trim(), String(revisionId), req);
    if (!voce) throw new ErroreRichiesta('il documento non appartiene alla commessa ' + String(commessa).trim(), 404);

    const { dati, tipo, intestazioni } = await scarica(revisionId, req);
    const nomeFile = String(req.body.nomeFile || intestazioni.nome || 'skytower-' + String(revisionId).slice(0, 8) + '.pdf');
    // SkyTower conserva i PDF firmati come busta .p7m (valore legale): qui si accettano e la pipeline la apre
    const busta = eBustaFirmata(dati, nomeFile);
    if (!busta && !(/pdf/i.test(tipo) || /\.pdf$/i.test(nomeFile) || dati.subarray(0, 5).toString() === '%PDF-')) {
      throw new ErroreRichiesta('il documento di SkyTower non è un PDF (' + (tipo || 'tipo ignoto') + ')', 415);
    }
    if (dati.length > CONFIG.maxPdfByte) throw new ErroreRichiesta('PDF troppo grande', 413);

    const lavoro = await archivio.creaLavoro({
      nomeFile, contenuto: dati, traduttore, formato, opzioni, utente: req.cosedil?.username ?? null, busta,
    });
    await archivio.aggiorna(lavoro.id, { skytower: { revision_id: revisionId, revision_code: intestazioni.revisione || null, identifier: req.body.identifier || null } });
    accoda(lavoro.id);
    log.info('lavoro ' + lavoro.id + ' da SkyTower ' + revisionId, { traduttore, formato });
    res.status(202).json({ lavoro: await archivio.leggi(lavoro.id), coda: statoCoda() });
  } catch (e) {
    next(inoltra(e));
  }
});

/** La voce dell'elenco documenti della commessa con quella revisione, o null (cerca in tutte le aree). */
async function revisioneDellaCommessa(commessa, revisionId, req) {
  for (const area of ['PUBLISHED', 'SHARED']) {
    const dati = await dipendenze.chiama('skytower', 'GET', '/suite/commesse/' + encodeURIComponent(commessa) + '/documenti',
      { parametri: { area, limit: 500 }, ...utente(req), timeout: 10000 });
    const voce = (dati?.items || []).find((d) => String(d.revision_id) === revisionId);
    if (voce) return voce;
  }
  return null;
}

async function scarica(revisionId, req) {
  const r = await dipendenze.chiama('skytower', 'GET', '/suite/revisioni/' + encodeURIComponent(revisionId) + '/file',
    { grezzo: true, ...utente(req), timeout: 60000 });
  // suite_link.js (grezzo) ritorna { dati, tipo }; il nome del file non viaggia
  // nel corpo: lo propone il client (identifier/filename dell'elenco).
  return { dati: r.dati, tipo: r.tipo || '', intestazioni: { nome: req.body?.filename, revisione: req.body?.revision_code } };
}
