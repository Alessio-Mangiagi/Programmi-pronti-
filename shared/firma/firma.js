// "><(((º> sabusabu <º)))><"
/**
 * firma.js — client Node del motore della firma digitale (shared/firma), per Lettore DDT, OCR Documenti,
 * Verifica Requisiti e Ponte Trimble. Gemello di busta.py (programmi Python).
 *
 *   const firma = require('../shared/firma/firma.js')        // oppure import firma from '…/firma.mjs'
 *   if (firma.eBustaFirmata(buffer, nome)) {
 *     const { contenuto, nomeContenuto, rapporto } = await firma.apri(buffer, nome)
 *     // contenuto = il PDF dentro la busta; rapporto = esito, riepilogo, firme (JSON di firma.py apri)
 *   }
 *
 * eBustaFirmata non ha dipendenze e non lancia processi. apri() esegue `firma.py apri` con il Python di
 * shared/firma/.venv (FIRMA_PYTHON per cambiarlo): la verifica (catena, revoca, elenchi eIDAS) sta tutta lì.
 * Il motore si cerca in FIRMA_DIR, poi in <cartella dell'eseguibile>\shared\firma (programmi impacchettati in un
 * .exe, dove questo file sta DENTRO l'eseguibile), poi nella cartella di questo file: vedi candidatiMotore.
 * Errori: codice 'FIRMA_NON_INSTALLATA' (motore assente o .venv mancante: su Windows l'installazione parte da
 * sola in disparte alla prima busta e il messaggio dice di riprovare fra qualche minuto) e
 * 'BUSTA_ILLEGGIBILE' (.p7m rotto o firma staccata, messaggio leggibile per l'utente).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const CARTELLA = __dirname;
// 1.2.840.113549.1.7.2 (SignedData) in DER: è nei primi byte di ogni busta CAdES
const OID_SIGNED_DATA = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);

/** Vero se il file è una busta .p7m: per estensione o per contenuto (DER, base64 o PEM). */
function eBustaFirmata(buffer, nome) {
  if (nome && /\.p7m\s*$/i.test(String(nome))) return true;
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return false;
  if (buffer[0] === 0x30 && buffer.subarray(0, 64).includes(OID_SIGNED_DATA)) return true;
  let testo = buffer.subarray(0, 64 * 1024).toString('latin1').trim();
  if (testo.startsWith('-----BEGIN')) testo = testo.split(/\r?\n/).filter((r) => r && !r.startsWith('-----')).join('');
  if (!/^M[IC]/.test(testo)) return false;
  const pulito = testo.replace(/\s+/g, '').slice(0, 4096);
  if (!/^[A-Za-z0-9+/=]+$/.test(pulito)) return false;
  const der = Buffer.from(pulito, 'base64');
  return der[0] === 0x30 && der.subarray(0, 64).includes(OID_SIGNED_DATA);
}

/** "contratto.pdf.p7m" → "contratto.pdf" (il nome vero lo dà poi il motore, che guarda anche il contenuto). */
function nomeSenzaP7m(nome) {
  let n = path.basename(String(nome || 'documento.pdf.p7m'));
  while (/\.p7m$/i.test(n)) n = n.slice(0, -4);
  return n || 'documento.pdf';
}

/** Cartelle dove può stare il motore (firma.py, installa.bat e, installato, .venv), nell'ordine in cui si provano. */
function candidatiMotore() {
  const candidati = [];
  // 1. indicata a mano: motore installato altrove (es. una sola copia per più programmi sullo stesso PC)
  if (process.env.FIRMA_DIR) candidati.push(path.resolve(process.env.FIRMA_DIR));
  // 2. accanto all'eseguibile: nei programmi impacchettati (Lettore DDT con pkg) questo file sta dentro l'exe,
  //    dove Python non legge firma.py e non si può creare .venv; gli script di build ci copiano il motore con
  //    shared/firma/copia-motore.bat. Con node.exe normale la cartella non esiste e si passa oltre.
  candidati.push(path.join(path.dirname(process.execPath), 'shared', 'firma'));
  // 3. la cartella di questo file: programmi lanciati dal repo o da una copia della suite
  candidati.push(CARTELLA);
  return candidati;
}

/** La prima cartella candidata che contiene firma.py, oppure null se il motore non c'è da nessuna parte. */
function cartellaMotore() {
  return candidatiMotore().find((c) => fs.existsSync(path.join(c, 'firma.py'))) || null;
}

/** L'interprete con le librerie di verifica: FIRMA_PYTHON, altrimenti il .venv del motore trovato. */
function pythonFirma() {
  if (process.env.FIRMA_PYTHON) return process.env.FIRMA_PYTHON;
  const cartella = cartellaMotore() || CARTELLA;
  return path.join(cartella, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
}

// Installazione automatica alla prima busta (solo Windows, solo senza FIRMA_PYTHON): i programmi lanciati dal repo
// la fanno già nei loro avvia.bat, ma un .exe copiato su un PC o un servizio avviato in altro modo non passa di lì.
// installa.bat ha un lock suo: se più programmi lo lanciano insieme lavora uno solo. Al massimo un tentativo ogni
// 10 minuti per processo: se finisce senza .venv (manca Python, niente rete) non si riprova a ogni documento e il
// messaggio dice di lanciarlo a mano, così l'amministratore vede l'errore.
const RIPROVA_INSTALLAZIONE_MS = 10 * 60 * 1000;
let ultimaInstallazione = 0;

/** Avvia installa.bat in disparte. Rende 'avviata' | 'in corso' | 'non riuscita' | 'manuale' (non si può da qui). */
function avviaInstallazione(cartella) {
  if (process.platform !== 'win32' || process.env.FIRMA_PYTHON || !cartella) return 'manuale';
  if (!fs.existsSync(path.join(cartella, 'installa.bat'))) return 'manuale';
  if (fs.existsSync(path.join(cartella, '.installazione.lock'))) return 'in corso';
  if (Date.now() - ultimaInstallazione < RIPROVA_INSTALLAZIONE_MS) return 'non riuscita';
  try {
    // cwd = cartella del motore, così cmd non deve quotare percorsi con spazi e parentesi ("Program Files (x86)").
    // '.\' esplicito: con NoDefaultCurrentDirectoryInExePath=1 (impostata da alcuni ambienti per sicurezza) cmd non
    // cerca i comandi senza percorso nella cartella corrente. Processo staccato e senza finestra: sopravvive a chi
    // l'ha chiesto e non trattiene la richiesta in corso.
    const figlio = spawn('cmd.exe', ['/d', '/c', '.\\installa.bat'],
      { cwd: cartella, detached: true, stdio: 'ignore', windowsHide: true });
    figlio.on('error', () => {});
    figlio.unref();
    ultimaInstallazione = Date.now();
    return 'avviata';
  } catch {
    return 'manuale';
  }
}

/** Messaggio per chi ha caricato la busta quando il motore non è pronto (codice FIRMA_NON_INSTALLATA). */
function messaggioNonInstallato(cartella) {
  if (!cartella) {
    return 'Componente firma digitale non trovato: copiare la cartella shared\\firma della suite accanto al ' +
      `programma o indicarla con FIRMA_DIR (cercato in: ${candidatiMotore().join('; ')})`;
  }
  const stato = avviaInstallazione(cartella);
  if (stato === 'avviata' || stato === 'in corso') {
    return 'Componente firma digitale in installazione (la prima volta prepara Python, librerie ed elenchi ' +
      'ufficiali, serve la rete): riprovare fra qualche minuto';
  }
  return `Componente firma digitale non installato: lanciare ${path.join(cartella, 'installa.bat')} ` +
    '(serve Python 3.12 e la rete)';
}

function errore(codice, messaggio) {
  const e = new Error(messaggio);
  e.code = codice;
  return e;
}

/**
 * Apre la busta e verifica le firme.
 * @param {Buffer} buffer  il file .p7m (o un file qualunque: se non è firmato torna com'è)
 * @param {string} nome    nome originale (serve a ricavare quello del documento contenuto)
 * @param {{rete?: boolean, verifica?: boolean, timeoutMs?: number}} [opzioni]
 * @returns {Promise<{contenuto: Buffer, nomeContenuto: string, rapporto: object}>}
 */
async function apri(buffer, nome, opzioni = {}) {
  const { rete = true, verifica = true, timeoutMs = 180_000 } = opzioni;
  const cartella = cartellaMotore();
  const py = pythonFirma();
  if (!cartella || !fs.existsSync(py)) throw errore('FIRMA_NON_INSTALLATA', messaggioNonInstallato(cartella));
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'firma-'));
  try {
    const entrata = path.join(tmp, 'busta.p7m');
    const uscita = path.join(tmp, 'contenuto');
    await fs.promises.writeFile(entrata, buffer);
    const args = [path.join(cartella, 'firma.py'), 'apri', entrata, '--nome', String(nome || 'documento.p7m'), '--estrai', uscita];
    if (!rete) args.push('--senza-rete');
    if (!verifica) args.push('--senza-verifica');
    const { codice, stdout, stderr } = await new Promise((resolve) => {
      execFile(py, args, { cwd: cartella, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
      (err, out, errOut) => resolve({ codice: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: out, stderr: errOut }));
    });
    const righe = String(stdout).trim().split(/\r?\n/);
    let rapporto = {};
    try { rapporto = JSON.parse(righe[righe.length - 1] || '{}'); } catch { /* stdout vuoto: errore sotto */ }
    if (codice === 2) throw errore('BUSTA_ILLEGGIBILE', rapporto.errore || 'Busta firmata illeggibile');
    if (codice !== 0) throw errore('FIRMA_ERRORE', `Verifica della firma non riuscita: ${String(stderr).slice(-500)}`);
    const contenuto = await fs.promises.readFile(uscita);
    return { contenuto, nomeContenuto: rapporto.nome_contenuto || nomeSenzaP7m(nome), rapporto };
  } finally {
    fs.promises.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { eBustaFirmata, apri, nomeSenzaP7m, pythonFirma, cartellaMotore, candidatiMotore };
