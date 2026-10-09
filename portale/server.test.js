// Test del portale. Zero dipendenze: node --test (Node >= 18).
//   npm test
//
// server.js, importato come modulo, non apre porte e non tocca data/.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// I test delle app riservate leggono utenti.json. DATA_DIR va spostata PRIMA di
// require('./server.js'), che la risolve una volta sola al caricamento: così i
// test non leggono (né sporcano) i dati veri del portale.
const DATA_TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'portale-test-'));
process.env.DATA_DIR = DATA_TMP;
fs.writeFileSync(path.join(DATA_TMP, 'utenti.json'), JSON.stringify([
  { username: 'mrossi', nome: 'Mario Rossi', ruolo: 'utente', apps: ['requisiti'] },
  { username: 'gverdi', nome: 'Giulia Verdi', ruolo: 'utente' },
]));
test.after(() => fs.rmSync(DATA_TMP, { recursive: true, force: true }));

const {
  ipMatches, isAdminForApp, clientIp,
  portalHostname, appUrl, isSuiteOrigin,
  loginKey, loginBlockedMs, noteLoginFail, clearLoginFails,
  parseNetstatPid,
  rispondiAssistente, APPS,
  rowsToUsers, csvToRows,
  accessoApp, appsUtente, appsPredefinite, appAssegnabili, filtraApps,
  riepilogoAttivita, riepilogoUtenti,
} = require('./server.js');

const reqCon = (host, headers = {}) => ({ headers: Object.assign({ host }, headers), socket: {} });

// ---------------------------------------------------------------------------
// URL delle app: devono seguire l'host da cui arriva la richiesta, altrimenti
// in LAN il pulsante "Apri" manda l'utente sul proprio PC.
// ---------------------------------------------------------------------------
test('portalHostname: toglie la porta', () => {
  assert.equal(portalHostname(reqCon('192.168.1.5:8080')), '192.168.1.5');
  assert.equal(portalHostname(reqCon('localhost:8080')), 'localhost');
  assert.equal(portalHostname(reqCon('srv-cosedil')), 'srv-cosedil');
});

test('portalHostname: IPv6 fra parentesi', () => {
  assert.equal(portalHostname(reqCon('[::1]:8080')), '[::1]');
});

test('portalHostname: Host mancante -> localhost', () => {
  assert.equal(portalHostname({ headers: {} }), 'localhost');
});

test('appUrl: usa host del portale, non localhost', () => {
  const app = { porta: 5050 };
  assert.equal(appUrl(reqCon('192.168.1.5:8080'), app), 'http://192.168.1.5:5050');
  assert.equal(appUrl(reqCon('localhost:8080'), app), 'http://localhost:5050');
});

// ---------------------------------------------------------------------------
// CORS di /api/verify (SSO fra le app della suite).
// ---------------------------------------------------------------------------
test('isSuiteOrigin: loopback e stesso host del portale, su porte della suite', () => {
  const req = reqCon('192.168.1.5:8080');
  assert.ok(isSuiteOrigin('http://localhost:5050', req));
  assert.ok(isSuiteOrigin('http://127.0.0.1:5173', req));
  assert.ok(isSuiteOrigin('http://192.168.1.5:5050', req));    // stesso host del portale
  assert.ok(isSuiteOrigin('http://192.168.1.5:5180', req));
});

test('isSuiteOrigin: nome di rete del server ammesso', () => {
  assert.ok(isSuiteOrigin('http://srv-cosedil:5050', reqCon('srv-cosedil:8080')));
  assert.ok(isSuiteOrigin('http://SRV-COSEDIL:5050', reqCon('srv-cosedil:8080')));
});

test('isSuiteOrigin: altri host della LAN respinti (prima passavano)', () => {
  // Un IP privato DIVERSO da quello del portale non è un'app della suite: è
  // un altro PC. Una pagina ostile lì ospitata non deve leggere /api/verify.
  const req = reqCon('192.168.1.5:8080');
  assert.equal(isSuiteOrigin('http://10.0.0.7:5001', req), false);
  assert.equal(isSuiteOrigin('http://172.16.3.2:5180', req), false);
  assert.equal(isSuiteOrigin('http://192.168.1.99:5050', req), false);
});

test('isSuiteOrigin: porte fuori dalla suite respinte anche su host giusto', () => {
  const req = reqCon('192.168.1.5:8080');
  assert.equal(isSuiteOrigin('http://192.168.1.5:4444', req), false);
  assert.equal(isSuiteOrigin('http://localhost:9999', req), false);
  assert.equal(isSuiteOrigin('http://127.0.0.1', req), false);   // porta 80 implicita
});

test('isSuiteOrigin: internet e host estranei respinti', () => {
  const req = reqCon('192.168.1.5:8080');
  assert.equal(isSuiteOrigin('http://evil.com', req), false);
  assert.equal(isSuiteOrigin('https://cosedilspa.com', req), false);
  assert.equal(isSuiteOrigin('http://172.32.0.1:5050', req), false);
  assert.equal(isSuiteOrigin('http://8.8.8.8:5050', req), false);
  assert.equal(isSuiteOrigin('', req), false);
  assert.equal(isSuiteOrigin('null', req), false);
  assert.equal(isSuiteOrigin('file:///C:/x.html', req), false);
});

test('isSuiteOrigin: un dominio che contiene un IP privato non passa', () => {
  assert.equal(isSuiteOrigin('http://192.168.1.5.evil.com', reqCon('192.168.1.5:8080')), false);
});

// ---------------------------------------------------------------------------
// Freno ai tentativi di login.
// ---------------------------------------------------------------------------
test('login: blocca dopo 5 tentativi falliti', () => {
  const k = loginKey('mario', '192.168.1.9');
  clearLoginFails(k);
  for (let i = 0; i < 4; i++) noteLoginFail(k);
  assert.equal(loginBlockedMs(k), 0, 'al quarto tentativo deve ancora poter provare');
  noteLoginFail(k);
  assert.ok(loginBlockedMs(k) > 0, 'al quinto scatta il blocco');
  clearLoginFails(k);
});

test('login: il blocco scade', () => {
  const k = loginKey('mario', '192.168.1.9');
  clearLoginFails(k);
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i++) noteLoginFail(k, t0);
  assert.ok(loginBlockedMs(k, t0 + 60_000) > 0, 'dopo un minuto ancora bloccato');
  assert.equal(loginBlockedMs(k, t0 + 16 * 60_000), 0, 'dopo un quarto d\'ora si riprova');
  clearLoginFails(k);
});

test('login: il successo azzera i tentativi', () => {
  const k = loginKey('mario', '192.168.1.9');
  clearLoginFails(k);
  for (let i = 0; i < 4; i++) noteLoginFail(k);
  clearLoginFails(k);
  noteLoginFail(k);
  assert.equal(loginBlockedMs(k), 0);
  clearLoginFails(k);
});

test('login: contatore per solo IP con soglia propria (20)', () => {
  // Stesso IP, username sempre diversi: il contatore per utente+IP non scatta
  // mai, quello per IP sì. È il freno alla scansione di account.
  const kIp = loginKey('*', '192.168.1.77');
  clearLoginFails(kIp);
  for (let i = 0; i < 19; i++) noteLoginFail(kIp, Date.now(), 20);
  assert.equal(loginBlockedMs(kIp), 0, 'al diciannovesimo può ancora provare');
  noteLoginFail(kIp, Date.now(), 20);
  assert.ok(loginBlockedMs(kIp) > 0, 'al ventesimo scatta il blocco IP');
  clearLoginFails(kIp);
});

test('login: il blocco è per utente+IP, non per utente', () => {
  const k1 = loginKey('mario', '192.168.1.9');
  const k2 = loginKey('mario', '192.168.1.10');
  clearLoginFails(k1); clearLoginFails(k2);
  for (let i = 0; i < 5; i++) noteLoginFail(k1);
  assert.ok(loginBlockedMs(k1) > 0);
  assert.equal(loginBlockedMs(k2), 0, 'un altro PC non deve restare fuori');
  clearLoginFails(k1); clearLoginFails(k2);
});

test('loginKey: username normalizzato', () => {
  assert.equal(loginKey('  Mario  ', '10.0.0.1'), loginKey('mario', '10.0.0.1'));
});

// ---------------------------------------------------------------------------
// Spegnimento app: lettura dell'output di netstat.
// ---------------------------------------------------------------------------
const NETSTAT = [
  '',
  'Connessioni attive',
  '',
  '  Proto  Indirizzo locale       Indirizzo esterno      Stato           PID',
  '  TCP    0.0.0.0:5050           0.0.0.0:0              LISTENING       4321',
  '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       9999',
  '  TCP    192.168.1.5:5050       192.168.1.9:51234      ESTABLISHED     4321',
  '  TCP    0.0.0.0:50500          0.0.0.0:0              LISTENING       7777',
  '  TCP    [::]:5050              [::]:0                 LISTENING       4321',
  // netstat senza '-p TCP' (serve per vedere [::1], IPv6): arrivano anche UDP e
  // [::1] - vite legato a "localhost" sta esattamente li'.
  '  UDP    0.0.0.0:5179           *:*                                    2222',
  '  TCP    [::1]:5179             [::]:0                 LISTENING       8852',
].join('\r\n');

test('parseNetstatPid: trova il PID in ascolto sulla porta', () => {
  assert.deepEqual(parseNetstatPid(NETSTAT, 5050), [4321]);
  assert.deepEqual(parseNetstatPid(NETSTAT, 5173), [9999]);
});

test('parseNetstatPid: vede [::1] (IPv6 localhost) e ignora le righe UDP', () => {
  assert.deepEqual(parseNetstatPid(NETSTAT, 5179), [8852]);
});

test('parseNetstatPid: non confonde 5050 con 50500', () => {
  assert.deepEqual(parseNetstatPid(NETSTAT, 50500), [7777]);
});

test('parseNetstatPid: ignora le connessioni non in ascolto', () => {
  // 51234 compare solo come porta remota di una ESTABLISHED: nessuno ascolta lì.
  assert.deepEqual(parseNetstatPid(NETSTAT, 51234), []);
});

test('parseNetstatPid: porta libera -> nessun PID', () => {
  assert.deepEqual(parseNetstatPid(NETSTAT, 6000), []);
  assert.deepEqual(parseNetstatPid('', 5050), []);
});

// ---------------------------------------------------------------------------
// Assistente: non deve rivelare le porte delle app.
// ---------------------------------------------------------------------------
test('assistente: non dice mai la porta', () => {
  const domande = [
    'che porta usa il ddt?', 'porte', 'indirizzo ocr', 'url agente',
    'link scadenzario', 'localhost', 'cosa fa il ddt?', 'quali app ci sono?',
    'come avvio ocr?', 'ciao',
  ];
  for (const d of domande) {
    const { risposta } = rispondiAssistente(d, APPS);
    for (const a of APPS) {
      assert.ok(!risposta.includes(String(a.porta)), `"${d}" rivela la porta ${a.porta}: ${risposta}`);
    }
    assert.ok(!/localhost/i.test(risposta), `"${d}" rivela localhost: ${risposta}`);
  }
});

test('assistente: alla domanda sulla porta risponde comunque qualcosa di utile', () => {
  const { risposta, apps } = rispondiAssistente('che porta usa il ddt?', APPS);
  assert.match(risposta, /Avvia|Apri/);
  assert.deepEqual(apps, ['ddt']);
});

test('assistente: vede solo le app che gli passi (adminOnly filtrate a monte)', () => {
  const visibili = APPS.filter((a) => !a.adminOnly);
  const { risposta } = rispondiAssistente('quali app ci sono?', visibili);
  assert.ok(!/Auguri/i.test(risposta), 'app riservata citata a un non-admin');
});

// ---------------------------------------------------------------------------
// Admin per-IP / per-app.
// ---------------------------------------------------------------------------
test('ipMatches: esatto, CIDR e jolly', () => {
  assert.ok(ipMatches('192.168.1.10', '192.168.1.10'));
  assert.ok(ipMatches('192.168.1.10', '192.168.1.0/24'));
  assert.ok(ipMatches('192.168.1.10', '*'));
  assert.equal(ipMatches('192.168.2.10', '192.168.1.0/24'), false);
  assert.equal(ipMatches('192.168.1.10', ''), false);
});

test('isAdminForApp: ruolo, elevazione per app e jolly', () => {
  assert.ok(isAdminForApp({ ruolo: 'admin', adm: [] }, 'ddt'));
  assert.ok(isAdminForApp({ ruolo: 'utente', adm: ['ddt'] }, 'ddt'));
  assert.ok(isAdminForApp({ ruolo: 'utente', adm: ['*'] }, 'portale'));
  assert.equal(isAdminForApp({ ruolo: 'utente', adm: ['ddt'] }, 'ocr'), false);
  assert.equal(isAdminForApp(null, 'ddt'), false);
});

// ---------------------------------------------------------------------------
// Programmi visibili per utente: chi vede cosa, e chi ci entra davvero. La
// stessa funzione governa le card e il gate SSO (/api/verify).
// ---------------------------------------------------------------------------
const normale = { id: 'ocr' };
const soloAdmin = { id: 'auguri', adminOnly: true };
const riservata = { id: 'requisiti', riservata: true };
// mrossi ha un elenco esplicito (solo requisiti), gverdi nessuno (default).
const admin = { username: 'capo', ruolo: 'admin', adm: [] };
const conElenco = { username: 'mrossi', ruolo: 'utente', adm: [] };
const senzaElenco = { username: 'gverdi', ruolo: 'utente', adm: [] };

test("accessoApp: senza elenco proprio si vedono i programmi di tutti", () => {
  assert.ok(accessoApp(normale, senzaElenco));
  assert.equal(accessoApp(riservata, senzaElenco), false, "le riservate no");
  assert.equal(accessoApp(normale, null), false, "senza sessione non entra nessuno");
});

test("accessoApp: con un elenco proprio si vede solo quello", () => {
  assert.ok(accessoApp(riservata, conElenco));
  assert.equal(accessoApp(normale, conElenco), false, "ocr non è nel suo elenco");
});

test("accessoApp: adminOnly resta agli admin del portale", () => {
  assert.ok(accessoApp(soloAdmin, admin));
  assert.equal(accessoApp(soloAdmin, { username: 'mrossi', ruolo: 'utente', adm: ['requisiti'] }), false);
});

test("accessoApp: admin del portale e admin per-IP di quell'app entrano comunque", () => {
  assert.ok(accessoApp(riservata, admin), "admin del portale");
  assert.ok(accessoApp(riservata, { username: 'gverdi', ruolo: 'utente', adm: ['requisiti'] }), 'admin per-IP');
  assert.equal(accessoApp(riservata, { username: 'ignoto', ruolo: 'utente', adm: [] }), false, 'utente che non esiste più');
});

test("appsUtente: elenco esplicito, default per chi non ce l'ha", () => {
  assert.deepEqual(appsUtente('mrossi'), ['requisiti']);
  assert.deepEqual(appsUtente('gverdi'), appsPredefinite());
  assert.deepEqual(appsUtente('ignoto'), []);
});

test("appsPredefinite: tutte tranne adminOnly e riservate", () => {
  const def = appsPredefinite();
  assert.ok(def.includes('ocr'));
  assert.equal(def.includes('requisiti'), false, 'riservata: va spuntata a mano');
  assert.equal(def.includes('auguri'), false, 'adminOnly: segue il ruolo');
});

test("filtraApps: scarta id sconosciuti, adminOnly e doppioni", () => {
  assert.deepEqual(filtraApps(['requisiti', 'requisiti']), ['requisiti']);
  assert.deepEqual(filtraApps(['ocr', 'auguri', 'portale', 'inventata']), ['ocr']);
  assert.deepEqual(filtraApps(null), []);
});

test("appAssegnabili: tutte le app tranne le adminOnly, con il flag riservata", () => {
  const ids = appAssegnabili().map((a) => a.id);
  assert.deepEqual(ids, APPS.filter((a) => !a.adminOnly).map((a) => a.id));
  assert.equal(appAssegnabili().find((a) => a.id === 'requisiti').riservata, true);
});

test('clientIp: normalizza IPv6 mappato e ::1', () => {
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::ffff:192.168.1.9' } }), '192.168.1.9');
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '::1' } }), '127.0.0.1');
});

test('clientIp: X-Forwarded-For ignorato senza TRUST_PROXY', () => {
  const req = { headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '192.168.1.9' } };
  assert.equal(clientIp(req), '192.168.1.9', 'un header falsificabile non deve dare admin');
});

// ---------------------------------------------------------------------------
// Import utenti da foglio.
// ---------------------------------------------------------------------------
test('csvToRows + rowsToUsers: legge un CSV con intestazioni', () => {
  const csv = 'username;nome;password;ruolo\nmrossi;Mario Rossi;segreta123;admin\n';
  const users = rowsToUsers(csvToRows(Buffer.from(csv, 'utf8')));
  assert.equal(users.length, 1);
  assert.equal(users[0].username, 'mrossi');
  assert.equal(users[0].ruolo, 'admin');
});

test('rowsToUsers: senza le colonne obbligatorie si ferma', () => {
  assert.throws(() => rowsToUsers([['cognome', 'telefono'], ['Rossi', '123']]), /Intestazioni non riconosciute/);
});

// ---------------------------------------------------------------------------
// Plancia della home: ognuno vede solo le proprie attività.
// ---------------------------------------------------------------------------
const ORA = Date.parse('2026-10-09T10:00:00Z');
const REGISTRO = [
  { ts: '2026-10-09T09:00:00Z', username: 'mrossi', azione: 'login', appId: null },
  { ts: '2026-10-09T09:05:00Z', username: 'mrossi', azione: 'apri', appId: 'scadenzario' },
  { ts: '2026-10-09T09:06:00Z', username: 'gverdi', azione: 'apri', appId: 'ddt' },
  { ts: '2026-10-08T17:00:00Z', username: 'mrossi', azione: 'login', appId: null },
  { ts: '2026-10-08T17:10:00Z', username: 'mrossi', azione: 'avvia', appId: 'ddt' },
  { ts: '2026-10-08T17:20:00Z', username: 'mrossi', azione: 'apri', appId: 'scadenzario' },
  { ts: '2026-10-08T17:30:00Z', username: 'mrossi', azione: 'apri', appId: 'auguri' },
  { ts: '2026-09-20T08:00:00Z', username: 'mrossi', azione: 'apri', appId: 'confronta' },
];
const tutte = () => true;

test('riepilogoAttivita: solo le righe dell\'utente, dalla più recente', () => {
  const r = riepilogoAttivita(REGISTRO, 'mrossi', tutte, ORA);
  assert.ok(r.attivita.every((e) => !('username' in e)), 'non espone lo username');
  assert.equal(r.attivita.length, 7);
  assert.equal(r.attivita[0].appId, 'scadenzario');
  assert.equal(r.attivita[0].ts, '2026-10-09T09:05:00Z');
});

test('riepilogoAttivita: le app non più visibili spariscono dallo storico', () => {
  const r = riepilogoAttivita(REGISTRO, 'mrossi', (id) => id !== 'auguri', ORA);
  assert.ok(!r.attivita.some((e) => e.appId === 'auguri'));
  assert.ok(!r.riprendi.some((e) => e.appId === 'auguri'));
});

test('riepilogoAttivita: riprendi = ultime 3 app distinte', () => {
  const r = riepilogoAttivita(REGISTRO, 'mrossi', tutte, ORA);
  assert.deepEqual(r.riprendi.map((e) => e.appId), ['scadenzario', 'auguri', 'ddt']);
});

test('riepilogoAttivita: numeri su 7 e 30 giorni', () => {
  const r = riepilogoAttivita(REGISTRO, 'mrossi', tutte, ORA);
  assert.equal(r.numeri.aperture7, 4);                       // il 20/9 è fuori dai 7 giorni
  assert.deepEqual(r.numeri.piuUsata, { appId: 'scadenzario', volte: 2 });
  assert.equal(r.numeri.accessiMese, 2);
});

test('riepilogoAttivita: ultimo accesso = quello prima della sessione in corso', () => {
  const r = riepilogoAttivita(REGISTRO, 'mrossi', tutte, ORA);
  assert.equal(r.ultimoAccesso, '2026-10-08T17:00:00Z');
});

test('riepilogoAttivita: utente senza storico', () => {
  const r = riepilogoAttivita(REGISTRO, 'nessuno', tutte, ORA);
  assert.deepEqual(r.attivita, []);
  assert.deepEqual(r.riprendi, []);
  assert.equal(r.numeri.piuUsata, null);
  assert.equal(r.ultimoAccesso, null);
});

// ---------------------------------------------------------------------------
// Plancia degli admin: una riga per utente registrato.
// ---------------------------------------------------------------------------
const UTENTI = [
  { username: 'mrossi', nome: 'Mario Rossi', ruolo: 'utente' },
  { username: 'gverdi', nome: 'Giulia Verdi', ruolo: 'utente' },
  { username: 'mai', nome: 'Mai Entrato', ruolo: 'utente' },
];

test('riepilogoUtenti: una riga per utente, anche chi non è mai entrato', () => {
  const r = riepilogoUtenti(REGISTRO, UTENTI, ORA);
  assert.equal(r.utenti.length, 3);
  const mai = r.utenti.find((u) => u.username === 'mai');
  assert.equal(mai.ultimoAccesso, null);
  assert.equal(mai.accessi30, 0);
  assert.equal(r.utenti[2].username, 'mai', 'chi non è mai entrato va in fondo');
});

test('riepilogoUtenti: ordinati dall\'attività più recente', () => {
  const r = riepilogoUtenti(REGISTRO, UTENTI, ORA);
  assert.deepEqual(r.utenti.slice(0, 2).map((u) => u.username), ['gverdi', 'mrossi']);
});

test('riepilogoUtenti: dati della riga', () => {
  const m = riepilogoUtenti(REGISTRO, UTENTI, ORA).utenti.find((u) => u.username === 'mrossi');
  assert.equal(m.ultimoAccesso, '2026-10-09T09:00:00Z');
  assert.equal(m.accessi30, 2);
  assert.equal(m.aperture30, 5);
  assert.deepEqual(m.ultimaApp, { appId: 'scadenzario', ts: '2026-10-09T09:05:00Z' });
  assert.equal(m.attivoOggi, true);
});

test('riepilogoUtenti: numeri di tutta la suite', () => {
  const n = riepilogoUtenti(REGISTRO, UTENTI, ORA).numeri;
  assert.equal(n.utentiOggi, 2);
  assert.equal(n.utentiTotali, 3);
  assert.equal(n.accessiOggi, 1);
  assert.deepEqual(n.piuUsata, { appId: 'scadenzario', volte: 2 });
});
