// API di lettura verso Trimble: dicono alla UI dove va a finire il file e
// permettono di verificare le credenziali senza consegnare niente.
import express from 'express';
import { CONFIG, trimbleConfigurato } from '../config.js';
import { token, elencaProgetti, elencaCartelle } from '../trimble/client.js';
import { OPERAZIONI, fieldviewConfigurato } from '../trimble/fieldview.js';
import { statoDestinazione } from '../destinazione.js';

export const rotteTrimble = express.Router();

// Destinazione attiva: e' quella che la UI mostra nel badge in alto.
rotteTrimble.get('/destinazione', (req, res) => res.json(statoDestinazione()));

// Operazioni SOAP note di Field View: elenco vivo del telaio, dice cosa si puo'
// gia' chiamare e (per differenza col WSDL) cosa manca ancora.
rotteTrimble.get('/fieldview/operazioni', (req, res) => {
  res.json({
    configurato: fieldviewConfigurato(),
    url: CONFIG.fieldview.url,
    soap: CONFIG.fieldview.soap,
    operazioni: Object.entries(OPERAZIONI).map(([nome, o]) => ({
      nome, descrizione: o.descrizione, campi: o.campi, risultato: o.risultato,
    })),
  });
});

// ── Trimble Connect (deposito file) ───────────────────────────────────────
rotteTrimble.get('/trimble/stato', async (req, res) => {
  const base = {
    configurato: trimbleConfigurato(),
    apiBase: CONFIG.trimble.apiBase,
    projectId: CONFIG.trimble.projectId || null,
    folderId: CONFIG.trimble.folderId || null,
  };
  if (!base.configurato) {
    return res.json({ ...base, autenticato: false, motivo: 'credenziali mancanti in .env' });
  }
  try {
    await token();
    res.json({ ...base, autenticato: true });
  } catch (e) {
    res.json({ ...base, autenticato: false, motivo: e.message });
  }
});

rotteTrimble.get('/trimble/progetti', async (req, res, next) => {
  try {
    res.json({ progetti: await elencaProgetti() });
  } catch (e) {
    next(e);
  }
});

rotteTrimble.get('/trimble/cartelle', async (req, res, next) => {
  try {
    res.json({ cartelle: await elencaCartelle(req.query.projectId, req.query.parentId) });
  } catch (e) {
    next(e);
  }
});
