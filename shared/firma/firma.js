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
 * Errori: codice 'FIRMA_NON_INSTALLATA' (manca .venv: lanciare shared\firma\installa.bat) e
 * 'BUSTA_ILLEGGIBILE' (.p7m rotto o firma staccata, messaggio leggibile per l'utente).
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

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

function pythonFirma() {
  if (process.env.FIRMA_PYTHON) return process.env.FIRMA_PYTHON;
  return path.join(CARTELLA, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
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
  const py = pythonFirma();
  if (!fs.existsSync(py)) {
    throw errore('FIRMA_NON_INSTALLATA', 'Componente firma digitale non installato: lanciare shared\\firma\\installa.bat');
  }
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'firma-'));
  try {
    const entrata = path.join(tmp, 'busta.p7m');
    const uscita = path.join(tmp, 'contenuto');
    await fs.promises.writeFile(entrata, buffer);
    const args = [path.join(CARTELLA, 'firma.py'), 'apri', entrata, '--nome', String(nome || 'documento.p7m'), '--estrai', uscita];
    if (!rete) args.push('--senza-rete');
    if (!verifica) args.push('--senza-verifica');
    const { codice, stdout, stderr } = await new Promise((resolve) => {
      execFile(py, args, { cwd: CARTELLA, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
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

module.exports = { eBustaFirmata, apri, nomeSenzaP7m, pythonFirma };
