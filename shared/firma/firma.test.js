// "><(((º> sabusabu <º)))><"
// Test del client Node della firma digitale (firma.js): riconoscimento della busta senza processi e apertura
// con il motore Python (shared/firma/.venv). I file di prova li crea test_firma.py (ente certificatore di prova,
// fuori dagli elenchi ufficiali: lo si passa come certificato di fiducia con FIRMA_ANCORE_EXTRA).
//   node --test shared/firma/firma.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const firma = require('./firma.js');

const PY = firma.pythonFirma();
const pronto = fs.existsSync(PY);

test('eBustaFirmata riconosce estensione, DER e base64', () => {
  assert.equal(firma.eBustaFirmata(Buffer.from('x'), 'contratto.PDF.p7m'), true);
  assert.equal(firma.eBustaFirmata(Buffer.from('%PDF-1.4 ...'), 'contratto.pdf'), false);
  assert.equal(firma.nomeSenzaP7m('offerta.pdf.p7m.p7m'), 'offerta.pdf');
});

test('dove si cerca il motore: FIRMA_DIR, accanto all\'eseguibile, cartella del client', async () => {
  // senza installa.bat nella cartella indicata non parte nessuna installazione vera: solo il messaggio
  const vecchi = { FIRMA_DIR: process.env.FIRMA_DIR, FIRMA_PYTHON: process.env.FIRMA_PYTHON };
  delete process.env.FIRMA_PYTHON;
  const altrove = fs.mkdtempSync(path.join(os.tmpdir(), 'firma-dir-'));
  try {
    process.env.FIRMA_DIR = altrove;
    const candidati = firma.candidatiMotore();
    assert.equal(candidati[0], path.resolve(altrove));
    assert.equal(candidati[1], path.join(path.dirname(process.execPath), 'shared', 'firma'));
    assert.equal(firma.cartellaMotore(), __dirname);            // FIRMA_DIR senza firma.py: si passa oltre
    fs.writeFileSync(path.join(altrove, 'firma.py'), '# finto');
    assert.equal(firma.cartellaMotore(), path.resolve(altrove));
    assert.ok(firma.pythonFirma().startsWith(path.resolve(altrove)));
    await assert.rejects(firma.apri(Buffer.from('x'), 'a.pdf.p7m'),
      (e) => e.code === 'FIRMA_NON_INSTALLATA' && e.message.includes(path.join(path.resolve(altrove), 'installa.bat')));
  } finally {
    for (const [k, v] of Object.entries(vecchi)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(altrove, { recursive: true, force: true });
  }
});

test('apri estrae il PDF e verifica la firma', { skip: !pronto && 'motore non installato (shared/firma/installa.bat)' }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'firma-node-'));
  try {
    execFileSync(PY, [path.join(__dirname, 'test_firma.py'), 'fixture', tmp]);
    const ancore = path.join(tmp, 'ancore');
    fs.mkdirSync(ancore);
    fs.copyFileSync(path.join(tmp, 'ente.pem'), path.join(ancore, 'ente.pem'));
    process.env.FIRMA_ANCORE_EXTRA = ancore;
    process.env.FIRMA_CACHE_DIR = path.join(tmp, 'cache');

    const busta = fs.readFileSync(path.join(tmp, 'firmato.pdf.p7m'));
    assert.equal(firma.eBustaFirmata(busta, 'senza-estensione'), true);
    assert.equal(firma.eBustaFirmata(Buffer.from(busta.toString('base64')), 'senza-estensione'), true);

    const { contenuto, nomeContenuto, rapporto } = await firma.apri(busta, 'offerta.pdf.p7m', { rete: false });
    assert.deepEqual(contenuto, fs.readFileSync(path.join(tmp, 'documento.pdf')));
    assert.equal(nomeContenuto, 'offerta.pdf');
    assert.equal(rapporto.esito, 'valida');
    assert.equal(rapporto.firme[0].firmatario, 'Mario Rossi');

    const alterato = await firma.apri(fs.readFileSync(path.join(tmp, 'alterato.pdf.p7m')), 'x.pdf.p7m', { rete: false });
    assert.equal(alterato.rapporto.esito, 'non valida');

    await assert.rejects(firma.apri(busta.subarray(0, 120), 'rotto.pdf.p7m', { rete: false }), { code: 'BUSTA_ILLEGGIBILE' });
  } finally {
    delete process.env.FIRMA_ANCORE_EXTRA;
    delete process.env.FIRMA_CACHE_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
