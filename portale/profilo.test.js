// "><(((º> sabusabu <º)))><"
// Test del "profilo del portale valido ovunque" (11/11/2026, decisione dell'utente: "Gli admin devono
// essere creati solo da me, io posso creare e cancellare gli admin. 2b 3b 4a"):
//   - proprietario della suite (campo `proprietario`, PORTALE_PROPRIETARIO, migrazione all'avvio);
//   - solo il proprietario crea, promuove, declassa ed elimina gli amministratori e ne tocca password,
//     email, nome e programmi; nessuno disattiva, elimina o declassa il proprietario;
//   - cambio di ruolo (sv++) e di nome; ruolo e nome freschi da utenti.json in /api/verify;
//   - POST /api/suite/profilo per le app con account propri (CONTRATTI § 12);
//   - VFP Transfer nel registro: spunta sì, tessera e avvio no.
// File a parte (node --test lo gira in un processo suo): DATA_DIR e SUITE_TOKEN vanno impostati PRIMA
// di require('./server.js'), e il server si mette in ascolto su una porta a caso per provare le rotte.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const DATA_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'portale-profilo-'));
process.env.DATA_DIR = DATA_TMP;
process.env.SUITE_TOKEN = 'token-di-prova-profilo';   // suite_link.token() lo prende dall'ambiente
delete process.env.PORTALE_PROPRIETARIO;
const FILE_UTENTI = path.join(DATA_TMP, 'utenti.json');

// Utenti inventati, con password vere (scrypt come makeUser) per chi serve.
function pw(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
const UTENTI = [
  { username: 'boss', nome: 'Bruno Boss', ruolo: 'admin', proprietario: true, sv: 1, ...pw('Proprietario-1') },
  { username: 'vice', nome: 'Vera Vice', ruolo: 'admin', sv: 1, ...pw('Vice-admin-2') },
  { username: 'vice2', nome: 'Valerio Secondo', ruolo: 'admin', sv: 1, ...pw('Vice-admin-3') },
  { username: 'mrossi', nome: 'Mario Rossi', ruolo: 'utente', apps: ['incampo'], sv: 1, ...pw('Cantiere-2026!') },
  { username: 'gverdi', nome: 'Giulia Verdi', ruolo: 'utente', sv: 1 },
  { username: 'uscito', nome: 'Ex Collega', ruolo: 'utente', disattivato: true, sv: 2 },
  { username: 'uff1', nome: 'Ufficio Uno', ruolo: 'utente', email: 'ufficio@impresa.it', sv: 1 },
  { username: 'uff2', nome: 'Ufficio Due', ruolo: 'utente', email: 'UFFICIO@impresa.it', sv: 1 },
  { username: 'tecnico', nome: 'Tea Tecnico', ruolo: 'utente', apps: ['incampo', 'vfp-transfer'], sv: 1 },
];
const scriviUtenti = (lista) => fs.writeFileSync(FILE_UTENTI, JSON.stringify(lista, null, 2));
const leggiUtenti = () => JSON.parse(fs.readFileSync(FILE_UTENTI, 'utf8'));
scriviUtenti(UTENTI);

const srv = require('./server.js');
const {
  nomeProprietario, eProprietario, migraProprietario, controlloAmministratori, profiloPerApp,
  SOLO_PROPRIETARIO, PROPRIETARIO_INTOCCABILE, APPS, conTessera, avviabile, makeSessionCookie, assicuraProprietario,
} = srv;

let porta = 0;
test.before(async () => {
  await new Promise((ok) => srv.server.listen(0, '127.0.0.1', ok));
  porta = srv.server.address().port;
});
test.after(async () => {
  await new Promise((ok) => srv.server.close(ok));
  fs.rmSync(DATA_TMP, { recursive: true, force: true });
});

// Cookie di sessione di un utente, come lo darebbe il login (la parte "sid=..." dell'header).
function cookieDi(username) {
  const u = leggiUtenti().find((x) => x.username === username);
  return makeSessionCookie(u, []).split(';')[0];
}
// Richiesta HTTP al portale in prova. Le rotte che cambiano qualcosa vogliono JSON (difesa CSRF).
function chiama(metodo, percorso, { corpo, chi, cookie, intestazioni } = {}) {
  return new Promise((ok, ko) => {
    const dati = corpo === undefined ? '' : JSON.stringify(corpo);
    const headers = Object.assign({ 'Content-Type': 'application/json', Connection: 'close' }, intestazioni || {});
    if (chi || cookie) headers.Cookie = cookie || cookieDi(chi);
    if (dati) headers['Content-Length'] = Buffer.byteLength(dati);
    const req = http.request({ host: '127.0.0.1', port: porta, method: metodo, path: percorso, headers }, (res) => {
      let testo = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { testo += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(testo); } catch { /* non JSON */ }
        ok({ status: res.statusCode, json, testo });
      });
    });
    req.on('error', ko);
    req.end(dati);
  });
}
// Rimette gli utenti com'erano all'inizio: ogni test di rotta parte dallo stesso file.
const daCapo = () => scriviUtenti(UTENTI);

// ---------------------------------------------------------------------------- funzioni pure

test('migraProprietario: un solo admin attivo diventa proprietario, altrimenti nessuno', () => {
  const uno = [{ username: 'a', ruolo: 'admin' }, { username: 'b', ruolo: 'utente' }, { username: 'c', ruolo: 'admin', disattivato: true }];
  assert.equal(migraProprietario(uno), 'a');
  assert.equal(uno[0].proprietario, true);
  assert.equal(migraProprietario(uno), '', 'una volta sola: il proprietario c\'è già');
  const due = [{ username: 'a', ruolo: 'admin' }, { username: 'b', ruolo: 'admin' }];
  assert.equal(migraProprietario(due), '', 'con due admin non si indovina');
  assert.ok(!due.some((u) => u.proprietario));
  assert.equal(migraProprietario([]), '');
  process.env.PORTALE_PROPRIETARIO = 'a';
  try {
    const conEnv = [{ username: 'a', ruolo: 'admin' }];
    assert.equal(migraProprietario(conEnv), '', 'con PORTALE_PROPRIETARIO il file non si tocca');
    assert.equal(conEnv[0].proprietario, undefined);
  } finally { delete process.env.PORTALE_PROPRIETARIO; }
});

test('nomeProprietario / eProprietario: file o variabile, poteri solo da admin attivo', () => {
  assert.equal(nomeProprietario(UTENTI), 'boss');
  assert.ok(eProprietario(UTENTI, 'boss'));
  assert.ok(!eProprietario(UTENTI, 'vice'));
  process.env.PORTALE_PROPRIETARIO = 'Vice ';
  try {
    assert.equal(nomeProprietario(UTENTI), 'vice', 'la variabile vince sul file');
    assert.ok(eProprietario(UTENTI, 'vice'));
    assert.ok(!eProprietario(UTENTI, 'boss'));
    process.env.PORTALE_PROPRIETARIO = 'mrossi';
    assert.ok(!eProprietario(UTENTI, 'mrossi'), 'un utente normale non ha i poteri del proprietario');
  } finally { delete process.env.PORTALE_PROPRIETARIO; }
  const spento = UTENTI.map((u) => (u.username === 'boss' ? { ...u, disattivato: true } : u));
  assert.ok(!eProprietario(spento, 'boss'), 'disattivato: niente poteri');
});

test('controlloAmministratori: solo il proprietario sugli admin, nessuno sul proprietario', () => {
  const u = (n) => UTENTI.find((x) => x.username === n);
  // il proprietario può tutto, tranne le tre cose che nessuno fa su di lui
  for (const az of ['crea-admin']) assert.equal(controlloAmministratori(UTENTI, 'boss', null, az), null);
  for (const az of ['promuovi', 'nome', 'email', 'apps', 'password', 'disattiva', 'riattiva', 'elimina']) {
    assert.equal(controlloAmministratori(UTENTI, 'boss', u('vice'), az), null, az);
  }
  assert.equal(controlloAmministratori(UTENTI, 'boss', u('vice'), 'declassa'), null);
  for (const az of ['declassa', 'disattiva', 'elimina']) {
    assert.deepEqual(controlloAmministratori(UTENTI, 'boss', u('boss'), az), { status: 400, error: PROPRIETARIO_INTOCCABILE }, az);
    assert.deepEqual(controlloAmministratori(UTENTI, 'vice', u('boss'), az), { status: 400, error: PROPRIETARIO_INTOCCABILE }, az);
  }
  assert.equal(controlloAmministratori(UTENTI, 'boss', u('boss'), 'nome'), null, 'il proprio nome sì');
  // un altro admin: niente sugli admin, niente ruoli; sugli utenti normali tutto il resto
  const vietato = { status: 403, error: SOLO_PROPRIETARIO };
  assert.deepEqual(controlloAmministratori(UTENTI, 'vice', null, 'crea-admin'), vietato);
  for (const az of ['nome', 'email', 'apps', 'password', 'disattiva', 'riattiva', 'elimina']) {
    assert.deepEqual(controlloAmministratori(UTENTI, 'vice', u('vice2'), az), vietato, az);
    assert.equal(controlloAmministratori(UTENTI, 'vice', u('mrossi'), az), null, az);
  }
  assert.deepEqual(controlloAmministratori(UTENTI, 'vice', u('mrossi'), 'promuovi'), vietato);
  assert.deepEqual(controlloAmministratori(UTENTI, 'vice', u('vice2'), 'declassa'), vietato);
  assert.deepEqual(controlloAmministratori(UTENTI, 'vice', u('vice'), 'nome'), vietato, 'nemmeno il proprio nome di admin');
});

test('VFP Transfer: nel registro con la spunta, senza tessera né avvio dal portale', () => {
  const vfp = APPS.find((a) => a.id === 'vfp-transfer');
  assert.ok(vfp && vfp.riservata, 'riservato: spento per default');
  assert.ok(!conTessera(vfp), 'niente tessera in home');
  assert.ok(!avviabile(vfp), 'il portale non lo avvia');
  assert.ok(conTessera(APPS.find((a) => a.id === 'incampo')) && avviabile(APPS.find((a) => a.id === 'incampo')));
  assert.ok(!conTessera(APPS.find((a) => a.id === 'magazzino')) && avviabile(APPS.find((a) => a.id === 'magazzino')),
    'il Magazzino resta senza tessera ma avviabile (lo avvia il Lettore DDT)');
});

test('profiloPerApp: chi è, admin, proprietario, abilitato, disattivato', () => {
  daCapo();
  const p = (login, app) => profiloPerApp({ login, app });
  const m = p(' MRossi ', 'incampo');
  assert.equal(m.status, 200);
  assert.deepEqual(m.body, {
    ok: true, trovato: true, username: 'mrossi', nome: 'Mario Rossi', email: 'mrossi@cosedilspa.com', ruolo: 'utente',
    admin: false, proprietario: false, disattivato: false, mustChange: false, abilitato: true,
  });
  assert.equal(p('mrossi@cosedilspa.com', 'skytower').body.abilitato, false, 'SkyTower riservato e non spuntato');
  assert.equal(p('mrossi', 'vfp-transfer').body.abilitato, false, 'VFP Transfer spento per default');
  assert.equal(p('tecnico', 'vfp-transfer').body.abilitato, true, 'con la spunta sì');
  const b = p('boss', 'vfp-transfer').body;
  assert.ok(b.admin && b.proprietario && b.abilitato, 'il proprietario è admin e ha tutto');
  assert.ok(p('vice', 'skytower').body.admin && !p('vice', 'skytower').body.proprietario);
  const u = p('uscito', 'incampo').body;
  assert.ok(u.trovato && u.disattivato && !u.abilitato && !u.admin, 'disattivato: trovato ma non entra');
  assert.deepEqual(p('ufficio@impresa.it', 'incampo').body, { ok: true, trovato: false }, 'email di due utenti: nessuno');
  assert.deepEqual(p('nessuno', 'incampo').body, { ok: true, trovato: false });
  assert.equal(p('mrossi', 'inventata').status, 400);
  assert.equal(p('', 'incampo').status, 400);
});

// ---------------------------------------------------------------------------- rotte

test('POST /api/suite/profilo: solo col token della suite', async () => {
  daCapo();
  const senza = await chiama('POST', '/api/suite/profilo', { corpo: { login: 'mrossi', app: 'incampo' } });
  assert.equal(senza.status, 403);
  const sbagliato = await chiama('POST', '/api/suite/profilo', { corpo: { login: 'mrossi', app: 'incampo' }, intestazioni: { 'X-Suite-Token': 'altro' } });
  assert.equal(sbagliato.status, 403);
  const giusto = await chiama('POST', '/api/suite/profilo', { corpo: { login: 'mrossi', app: 'incampo' }, intestazioni: { 'X-Suite-Token': process.env.SUITE_TOKEN } });
  assert.equal(giusto.status, 200);
  assert.equal(giusto.json.username, 'mrossi');
  assert.equal(giusto.json.abilitato, true);
  const ignoto = await chiama('POST', '/api/suite/profilo', { corpo: { login: 'mrossi', app: 'boh' }, intestazioni: { 'X-Suite-Token': process.env.SUITE_TOKEN } });
  assert.equal(ignoto.status, 400);
});

test('/api/verify: ruolo e nome freschi da utenti.json, campo proprietario', async () => {
  daCapo();
  const boss = await chiama('GET', '/api/verify?app=incampo', { chi: 'boss' });
  assert.equal(boss.status, 200);
  assert.equal(boss.json.proprietario, true);
  const vice = await chiama('GET', '/api/verify?app=incampo', { chi: 'vice' });
  assert.equal(vice.json.proprietario, false);
  assert.equal(vice.json.admin, true);
  // cookie preso prima del cambio fatto a mano nel file (senza sv++): vale il file, non il cookie
  const cookie = cookieDi('gverdi');
  const lista = leggiUtenti();
  Object.assign(lista.find((u) => u.username === 'gverdi'), { ruolo: 'admin', nome: 'Giulia Verdi Bianchi' });
  scriviUtenti(lista);
  const g = await chiama('GET', '/api/verify?app=incampo', { cookie });
  assert.equal(g.json.ruolo, 'admin');
  assert.equal(g.json.admin, true);
  assert.equal(g.json.nome, 'Giulia Verdi Bianchi');
  const me = await chiama('GET', '/api/me', { cookie });
  assert.equal(me.json.adminPortale, true);
  daCapo();
  const g2 = await chiama('GET', '/api/verify?app=incampo', { cookie });
  assert.equal(g2.json.ruolo, 'utente', 'tornato utente nel file: l\'admin sparisce subito');
  assert.equal(g2.json.admin, false);
  // VFP Transfer: 403 a chi non ha la spunta, 200 a chi ce l'ha
  assert.equal((await chiama('GET', '/api/verify?app=vfp-transfer', { chi: 'mrossi' })).status, 403);
  assert.equal((await chiama('GET', '/api/verify?app=vfp-transfer', { chi: 'tecnico' })).status, 200);
});

test('un admin che non è il proprietario: niente sugli amministratori, tutto sugli utenti normali', async () => {
  daCapo();
  const v = (metodo, percorso, corpo) => chiama(metodo, percorso, { corpo, chi: 'vice' });
  const nuovoAdmin = await v('POST', '/api/utenti', { username: 'nuovo.admin', nome: 'Nuovo Admin', password: 'Password-lunga-1', ruolo: 'admin' });
  assert.equal(nuovoAdmin.status, 403);
  assert.equal(nuovoAdmin.json.error, SOLO_PROPRIETARIO);
  assert.ok(!leggiUtenti().some((u) => u.username === 'nuovo.admin'));
  assert.equal((await v('POST', '/api/utenti', { username: 'nuovo.utente', nome: 'Nuovo Utente', password: 'Password-lunga-1', ruolo: 'utente' })).status, 200);
  for (const [metodo, percorso, corpo] of [
    ['PUT', '/api/utenti/vice2/ruolo', { ruolo: 'utente' }],
    ['PUT', '/api/utenti/mrossi/ruolo', { ruolo: 'admin' }],
    ['PUT', '/api/utenti/vice2/nome', { nome: 'Altro Nome' }],
    ['PUT', '/api/utenti/vice2/email', { email: 'altro@impresa.it' }],
    ['PUT', '/api/utenti/vice2/apps', { apps: ['incampo'] }],
    ['POST', '/api/utenti/vice2/password', { password: '' }],
    ['PUT', '/api/utenti/vice2/attivo', { attivo: false }],
    ['DELETE', '/api/utenti/vice2', undefined],
  ]) {
    const r = await v(metodo, percorso, corpo);
    assert.equal(r.status, 403, `${metodo} ${percorso}`);
    assert.equal(r.json.error, SOLO_PROPRIETARIO, `${metodo} ${percorso}`);
  }
  const vice2 = leggiUtenti().find((u) => u.username === 'vice2');
  assert.equal(vice2.ruolo, 'admin');
  assert.ok(!vice2.disattivato && !vice2.email && vice2.nome === 'Valerio Secondo');
  // sul proprietario: le tre cose che nessuno fa (400, non 403)
  assert.equal((await v('PUT', '/api/utenti/boss/attivo', { attivo: false })).json.error, PROPRIETARIO_INTOCCABILE);
  assert.equal((await v('DELETE', '/api/utenti/boss')).json.error, PROPRIETARIO_INTOCCABILE);
  // sugli utenti normali tutto come prima
  assert.equal((await v('PUT', '/api/utenti/mrossi/nome', { nome: '  Mario   Rossi  Jr ' })).json.nome, 'Mario Rossi Jr');
  assert.equal((await v('PUT', '/api/utenti/mrossi/attivo', { attivo: false })).status, 200);
  // la lista dice chi è il proprietario e che chi guarda non lo è
  const lista = await v('GET', '/api/utenti');
  assert.equal(lista.json.sonoProprietario, false);
  assert.deepEqual(lista.json.utenti.filter((u) => u.proprietario).map((u) => u.username), ['boss']);
  // richiesta di aiuto di un admin: la password la reimposta solo il proprietario
  fs.writeFileSync(path.join(DATA_TMP, 'richieste.json'), JSON.stringify([{ id: 'abcdef123456', username: 'vice2', stato: 'aperta' }]));
  const rich = await v('POST', '/api/richieste/abcdef123456/reimposta', {});
  assert.equal(rich.status, 403);
  // import: la riga admin si scarta col motivo, le altre entrano
  const csv = 'username;nome;password;ruolo\r\nimp.admin;Importato Admin;Password-lunga-9;admin\r\nimp.utente;Importato Utente;Password-lunga-9;utente\r\n';
  const imp = await v('POST', '/api/utenti/import', { dataBase64: Buffer.from(csv).toString('base64'), filename: 'u.csv' });
  assert.equal(imp.json.aggiunti, 1);
  assert.match(imp.json.scartati[0].motivo, /proprietario/);
  assert.ok(!leggiUtenti().some((u) => u.username === 'imp.admin'));
});

test('il proprietario: crea admin, promuove e declassa (sessione da rifare), non tocca se stesso', async () => {
  daCapo();
  const b = (metodo, percorso, corpo) => chiama(metodo, percorso, { corpo, chi: 'boss' });
  assert.equal((await b('GET', '/api/utenti')).json.sonoProprietario, true);
  assert.equal((await b('GET', '/api/me')).json.proprietario, true);
  assert.equal((await b('POST', '/api/utenti', { username: 'altro.admin', nome: 'Altro Admin', password: 'Password-lunga-1', ruolo: 'admin' })).status, 200);
  assert.equal(leggiUtenti().find((u) => u.username === 'altro.admin').ruolo, 'admin');
  // promozione: la sessione aperta di mrossi si chiude (sv++), il registro lo dice
  const vecchioCookie = cookieDi('mrossi');
  assert.equal((await chiama('GET', '/api/me', { cookie: vecchioCookie })).status, 200);
  const prom = await b('PUT', '/api/utenti/mrossi/ruolo', { ruolo: 'admin' });
  assert.deepEqual(prom.json, { ok: true, ruolo: 'admin' });
  assert.equal((await chiama('GET', '/api/me', { cookie: vecchioCookie })).status, 401, 'sessione da rifare');
  const nuovo = await chiama('GET', '/api/verify?app=skytower', { chi: 'mrossi' });
  assert.equal(nuovo.json.ruolo, 'admin');
  const registro = fs.readFileSync(path.join(DATA_TMP, 'accessi.log'), 'utf8').trim().split('\n').map((r) => JSON.parse(r));
  const riga = registro.reverse().find((e) => e.azione === 'ruolo-utente');
  assert.equal(riga.per, 'mrossi');
  assert.equal(riga.dettaglio, 'mrossi: utente → amministratore');
  // declassamento di un altro admin; ruolo uguale = niente da fare; ruolo inventato = 400
  assert.equal((await b('PUT', '/api/utenti/vice2/ruolo', { ruolo: 'utente' })).json.ruolo, 'utente');
  assert.equal((await b('PUT', '/api/utenti/vice2/ruolo', { ruolo: 'utente' })).json.invariato, true);
  assert.equal((await b('PUT', '/api/utenti/vice2/ruolo', { ruolo: 'superadmin' })).status, 400);
  // il proprietario non si declassa, non si disattiva, non si elimina
  const se = await b('PUT', '/api/utenti/boss/ruolo', { ruolo: 'utente' });
  assert.equal(se.status, 400);
  assert.equal(se.json.error, PROPRIETARIO_INTOCCABILE);
  assert.equal(leggiUtenti().find((u) => u.username === 'boss').ruolo, 'admin');
  // sugli admin il proprietario cambia nome, password, programmi
  assert.equal((await b('PUT', '/api/utenti/vice/nome', { nome: 'Vera Vice Seconda' })).status, 200);
  assert.equal((await b('POST', '/api/utenti/vice/password', { password: '' })).status, 200);
  assert.equal((await b('PUT', '/api/utenti/vice/nome', { nome: '   ' })).status, 400, 'nome vuoto');
});

test('proprietario dato da PORTALE_PROPRIETARIO: resta admin anche se il file non lo dice', async () => {
  // nel file nessuno ha "proprietario": decide la variabile, e il proprietario non si declassa
  scriviUtenti([
    { username: 'solo', nome: 'Solo Admin', ruolo: 'admin', sv: 1 },
    { username: 'capo', nome: 'Capo', ruolo: 'admin', disattivato: true, sv: 1 },
  ]);
  process.env.PORTALE_PROPRIETARIO = 'solo';
  try {
    const r = await chiama('PUT', '/api/utenti/solo/ruolo', { corpo: { ruolo: 'utente' }, chi: 'solo' });
    assert.equal(r.status, 400);
    assert.equal(r.json.error, PROPRIETARIO_INTOCCABILE);
    assert.equal((await chiama('GET', '/api/verify', { chi: 'solo' })).json.proprietario, true);
  } finally { delete process.env.PORTALE_PROPRIETARIO; daCapo(); }
});

test('VFP Transfer non si avvia né si controlla dal portale; il nome però si vede', async () => {
  daCapo();
  assert.equal((await chiama('POST', '/api/launch/vfp-transfer', { chi: 'boss', corpo: {} })).status, 404);
  assert.equal((await chiama('GET', '/api/status/vfp-transfer', { chi: 'boss' })).status, 404);
  const apps = await chiama('GET', '/api/apps', { chi: 'boss' });
  assert.ok(!apps.json.apps.some((a) => a.id === 'vfp-transfer'), 'niente tessera');
  assert.equal(apps.json.nomi['vfp-transfer'], 'VFP Transfer', 'nome per registro e plancia');
  const ut = await chiama('GET', '/api/utenti', { chi: 'boss' });
  assert.ok(ut.json.assegnabili.some((a) => a.id === 'vfp-transfer' && a.riservata), 'casella in Utenti e Abilitazioni');
});

test("all'avvio (assicuraProprietario): utenti.json di prima dell'11/11 prende il suo proprietario", () => {
  // un solo admin attivo senza il campo: diventa proprietario, scritto nel file e nel registro accessi
  scriviUtenti([
    { username: 'a.mangiagi', nome: 'Alessio', ruolo: 'admin', sv: 3 },
    { username: 'mrossi', nome: 'Mario Rossi', ruolo: 'utente', sv: 1 },
  ]);
  const log = console.log;
  console.log = () => {};
  try { assicuraProprietario(); } finally { console.log = log; }
  const dopo = leggiUtenti();
  assert.equal(dopo.find((u) => u.username === 'a.mangiagi').proprietario, true);
  assert.equal(dopo.find((u) => u.username === 'a.mangiagi').sv, 3, 'la sessione resta valida');
  const righe = fs.readFileSync(path.join(DATA_TMP, 'accessi.log'), 'utf8').trim().split('\n').map((r) => JSON.parse(r));
  assert.ok(righe.some((e) => e.azione === 'proprietario' && e.per === 'a.mangiagi'));
  // seconda volta: niente da fare, il file non cambia
  const prima = fs.readFileSync(FILE_UTENTI, 'utf8');
  console.log = () => {};
  try { assicuraProprietario(); } finally { console.log = log; }
  assert.equal(fs.readFileSync(FILE_UTENTI, 'utf8'), prima);
  daCapo();
});
