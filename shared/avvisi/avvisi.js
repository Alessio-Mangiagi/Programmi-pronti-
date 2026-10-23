/**
 * avvisi.js — segnala un avviso agli amministratori del Portale.
 *
 * Ogni app della suite gira sullo stesso server del Portale (cartelle sorelle):
 * un avviso è un piccolo file JSON lasciato nella cartella di arrivo del
 * Portale, che lo raccoglie e lo mostra nella pagina Avvisi e alla plancia
 * dell'admin appena si collega.
 *
 * File e non HTTP di proposito: l'avviso arriva anche se il Portale in quel
 * momento è spento (lo legge al giro dopo), non servono token fra le app e
 * nessuna rotta nuova resta aperta in rete.
 *
 * Scrittura atomica (.tmp + rename): il Portale ignora i .tmp, quindi non legge
 * mai un file a metà. segnala() non lancia mai: un avviso perso non deve far
 * fallire il lavoro che lo ha prodotto.
 *
 * Cartella: SUITE_AVVISI_DIR se impostata, altrimenti portale/data/avvisi-in.
 * Stessa regola in avvisi.py e nel Portale.
 */
'use strict';

// "><(((º> sabusabu <º)))><"
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LIVELLI = ['info', 'attenzione', 'errore'];

function cartellaAvvisi() {
  const env = String(process.env.SUITE_AVVISI_DIR || '').trim();
  return env ? path.resolve(env) : path.resolve(__dirname, '..', '..', 'portale', 'data', 'avvisi-in');
}

/**
 * Lascia un avviso per gli admin. Torna true se il file è stato scritto.
 *
 * - app:     id dell'app nel registro del Portale ('ddt', 'scadenzario', ...)
 * - titolo:  una riga, cosa è successo
 * - testo:   dettaglio facoltativo
 * - livello: 'info' | 'attenzione' | 'errore' (default 'attenzione')
 * - chiave:  facoltativa; avvisi aperti con stessa app+chiave diventano uno
 *            solo con un contatore, così un errore ripetuto ogni minuto non
 *            riempie la pagina
 */
function segnala({ app, titolo, testo = '', livello = 'attenzione', chiave = '' } = {}) {
  try {
    if (!app || !titolo) return false;
    const avviso = {
      app: String(app).slice(0, 40),
      titolo: String(titolo).slice(0, 200),
      testo: String(testo || '').slice(0, 4000),
      livello: LIVELLI.includes(livello) ? livello : 'attenzione',
      chiave: String(chiave || '').slice(0, 200),
      data: new Date().toISOString(),
    };
    const dir = cartellaAvvisi();
    fs.mkdirSync(dir, { recursive: true });
    const nome = `${Date.now()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
    const tmp = path.join(dir, nome + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify(avviso), 'utf8');
    fs.renameSync(tmp, path.join(dir, nome + '.json'));
    return true;
  } catch {
    return false;
  }
}

module.exports = { segnala, cartellaAvvisi, LIVELLI };
