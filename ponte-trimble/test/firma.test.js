// "><(((º> sabusabu <º)))><"
// PDF firmati digitalmente (.p7m), richiesta del 06/11/2026: upload e "Da SkyTower" con una busta, passo "firma"
// della pipeline (motore shared/firma finto: esiti, errori, contenuto non PDF, rielabora) e, se l'ambiente
// shared/firma/.venv c'è, il motore vero sui file di prova di test_firma.py (niente rete).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { creaPdf } from './aiuti.js';

const CARTELLA = fs.mkdtempSync(path.join(os.tmpdir(), 'trimble-firma-test-'));
process.env.COSEDIL_SSO = 'off';
process.env.DATA_DIR = CARTELLA;
process.env.TRIMBLE_CLIENT_ID = '';
process.env.TRIMBLE_CLIENT_SECRET = '';

const { app } = await import('../server.js');
const { dipendenzeFirma, apriBusta } = await import('../src/firma.js');
const { dipendenze } = await import('../src/rotte/skytower.js');
const archivio = await import('../src/archivio.js');

const server = app.listen(0, '127.0.0.1');
await new Promise((ok) => server.once('listening', ok));
const base = 'http://127.0.0.1:' + server.address().port;
const clientVero = dipendenzeFirma.client;

test.after(() => {
  server.close();
  fs.rmSync(CARTELLA, { recursive: true, force: true });
});

const PDF = creaPdf([
  'Commessa: CS-2024-118 Ampliamento capannone',
  '01.02.003 Scavo di sbancamento in terreno naturale mc 120,50 15,30 1.843,65',
  'TOTALE 1.843,65',
]);
// "busta" finta: il client finto la riconosce dal prefisso e restituisce il PDF che c'è dopo
const BUSTA = Buffer.concat([Buffer.from('P7M!'), PDF]);

function rapporto(esito) {
  return {
    firmato: true, nome_contenuto: 'sal.pdf', livelli: 1, esito,
    riepilogo: 'Firma ' + esito + ': Mario Rossi (Ente di Prova S.p.A.), 06/11/2026',
    firme: [{ firmatario: 'Mario Rossi', codice_fiscale: 'RSSMRA80A01H501U', ente_certificatore: 'Ente di Prova S.p.A.',
      tipo: 'firma digitale', esito, motivi: [], data_firma_dichiarata: '2026-11-06T10:00:00+00:00', marca_temporale: null }],
  };
}

/** Motore finto: esito scelto, oppure un errore, oppure un contenuto diverso dal PDF. */
function finto({ esito = 'valida', errore = null, nomeContenuto = 'sal.pdf' } = {}) {
  dipendenzeFirma.client = {
    eBustaFirmata: (b, nome) => /\.p7m$/i.test(String(nome || '')) || b.subarray(0, 4).toString() === 'P7M!',
    apri: async (b) => {
      if (errore) throw Object.assign(new Error(errore.messaggio), { code: errore.code });
      return { contenuto: nomeContenuto.endsWith('.pdf') ? b.subarray(4) : Buffer.from('PK\x03\x04'), nomeContenuto, rapporto: rapporto(esito) };
    },
  };
}

async function invia(nome, contenuto = BUSTA, tipo = 'application/octet-stream') {
  const modulo = new FormData();
  modulo.set('pdf', new Blob([contenuto], { type: tipo }), nome);
  modulo.set('formato', 'xlsx');
  modulo.set('traduttore', 'pcq-econ');
  const res = await fetch(base + '/api/lavori', { method: 'POST', body: modulo });
  return { res, corpo: await res.json() };
}

async function attendiEsito(id, scadenzaMs = 30000) {
  const limite = Date.now() + scadenzaMs;
  while (Date.now() < limite) {
    const { lavoro } = await (await fetch(base + '/api/lavori/' + id)).json();
    if (lavoro.stato === 'pronto' || lavoro.stato === 'errore') return lavoro;
    await new Promise((ok) => setTimeout(ok, 150));
  }
  throw new Error('timeout sul lavoro ' + id);
}

test('busta .p7m -> passo firma -> PDF estratto nella pipeline di sempre', async () => {
  finto();
  const { res, corpo } = await invia('sal.pdf.p7m');
  assert.equal(res.status, 202);
  assert.deepEqual(corpo.lavoro.busta, { nome: 'sal.pdf.p7m', byte: BUSTA.length });
  const lavoro = await attendiEsito(corpo.lavoro.id);
  assert.equal(lavoro.stato, 'pronto', lavoro.errore || '');
  assert.deepEqual(lavoro.passi.map((p) => p.nome), ['firma', 'estrazione', 'traduzione', 'rendering']);
  assert.equal(lavoro.firma.esito, 'valida');
  assert.equal(lavoro.firma.firme[0].codiceFiscale, 'RSSMRA80A01H501U');
  assert.equal(lavoro.risultato.righe, 1);
  assert.equal(lavoro.risultato.nome, 'sal__pcq-econ.xlsx');          // nome del PDF, non della busta
  assert.ok(fs.existsSync(archivio.fileDi(lavoro.id, 'origine.p7m')));
  assert.deepEqual(fs.readFileSync(archivio.fileDi(lavoro.id, 'origine.pdf')), PDF);
});

test('firma non valida: il lavoro va avanti e lo segnala; rielabora riverifica dalla busta', async () => {
  finto({ esito: 'non valida' });
  const { corpo } = await invia('sal.pdf.p7m');
  const lavoro = await attendiEsito(corpo.lavoro.id);
  assert.equal(lavoro.stato, 'pronto');
  assert.equal(lavoro.firma.esito, 'non valida');

  finto({ esito: 'valida' });
  const r = await fetch(base + '/api/lavori/' + lavoro.id + '/rielabora', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 202);
  const nuovo = await attendiEsito((await r.json()).lavoro.id);
  assert.equal(nuovo.firma.esito, 'valida');
  assert.ok(nuovo.busta);
});

test('errori chiari: motore non installato, busta rotta, contenuto non PDF', async () => {
  finto({ errore: { code: 'FIRMA_NON_INSTALLATA', messaggio: 'x' } });
  let lavoro = await attendiEsito((await invia('a.pdf.p7m')).corpo.lavoro.id);
  assert.equal(lavoro.stato, 'errore');
  assert.match(lavoro.errore, /installa\.bat/);
  assert.equal(lavoro.passi.find((p) => p.nome === 'firma').stato, 'errore');

  finto({ errore: { code: 'BUSTA_ILLEGGIBILE', messaggio: 'Firma staccata' } });
  lavoro = await attendiEsito((await invia('b.pdf.p7m')).corpo.lavoro.id);
  assert.match(lavoro.errore, /illeggibile: Firma staccata/);

  finto({ nomeContenuto: 'relazione.docx' });
  lavoro = await attendiEsito((await invia('c.docx.p7m')).corpo.lavoro.id);
  assert.match(lavoro.errore, /serve un PDF/);
});

test('altri formati rifiutati con un messaggio che cita i .p7m', async () => {
  finto();
  const { res, corpo } = await invia('offerta.docx', Buffer.from('PK'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(res.status, 400);
  assert.match(corpo.errore, /\.p7m/);
});

test('Da SkyTower: una revisione firmata .p7m diventa un lavoro con la firma verificata', async () => {
  finto();
  const REV = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
  dipendenze.chiama = async (appId, metodo, percorso) => {
    if (percorso.endsWith('/documenti')) {
      return { items: [{ id: 'd1', revision_id: REV, identifier: 'PRJ-COS-ZZ-01-RP-Z-0001', title: 'SAL firmato',
        revision_code: 'C01', filename: 'sal.pdf.p7m', content_type: 'application/pkcs7-mime', size_bytes: BUSTA.length }] };
    }
    if (percorso === '/suite/revisioni/' + REV + '/file') return { dati: BUSTA, tipo: 'application/pkcs7-mime' };
    throw new Error('percorso inatteso ' + percorso);
  };
  const elenco = await (await fetch(base + '/api/skytower/documenti?commessa=101-003')).json();
  assert.equal(elenco.documenti[0].pdf, true);
  assert.equal(elenco.documenti[0].firmato, true);

  const r = await fetch(base + '/api/lavori/da-skytower', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision_id: REV, commessa: '101-003', filename: 'sal.pdf.p7m', traduttore: 'pcq-econ', formato: 'xlsx' }),
  });
  assert.equal(r.status, 202, await r.clone().text());
  const lavoro = await attendiEsito((await r.json()).lavoro.id);
  assert.equal(lavoro.stato, 'pronto', lavoro.errore || '');
  assert.equal(lavoro.firma.esito, 'valida');
  assert.equal(lavoro.skytower.revision_id, REV);
});

// Motore vero (shared/firma/.venv): ente certificatore di prova creato da test_firma.py, niente rete.
const QUI = path.dirname(fileURLToPath(import.meta.url));
const PY = path.join(QUI, '../../shared/firma/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
test('motore vero: apre la busta e verifica la firma (valida e alterata)', { skip: !fs.existsSync(PY) && 'shared/firma non installato' }, async () => {
  dipendenzeFirma.client = clientVero;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trimble-firma-vera-'));
  try {
    execFileSync(PY, [path.join(QUI, '../../shared/firma/test_firma.py'), 'fixture', tmp]);
    fs.mkdirSync(path.join(tmp, 'ancore'));
    fs.copyFileSync(path.join(tmp, 'ente.pem'), path.join(tmp, 'ancore', 'ente.pem'));
    process.env.FIRMA_ANCORE_EXTRA = path.join(tmp, 'ancore');
    process.env.FIRMA_CACHE_DIR = path.join(tmp, 'cache');
    const busta = fs.readFileSync(path.join(tmp, 'firmato.pdf.p7m'));
    const a = await apriBusta(busta, 'sal.pdf.p7m', { rete: false });
    assert.deepEqual(a.pdf, fs.readFileSync(path.join(tmp, 'documento.pdf')));
    assert.equal(a.nomePdf, 'sal.pdf');
    assert.equal(a.firma.esito, 'valida');
    const alterata = await apriBusta(fs.readFileSync(path.join(tmp, 'alterato.pdf.p7m')), 'x.pdf.p7m', { rete: false });
    assert.equal(alterata.firma.esito, 'non valida');
  } finally {
    delete process.env.FIRMA_ANCORE_EXTRA;
    delete process.env.FIRMA_CACHE_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
