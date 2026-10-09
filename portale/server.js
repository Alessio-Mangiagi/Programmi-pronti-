// "><(((º> sabusabu <º)))><"
// Portale Suite Cosedil — server zero-dipendenze (solo moduli core Node).
// - Serve il portale e la pagina di amministrazione.
// - Login utenti (hash scrypt) con sessione firmata via cookie (stateless HMAC).
// - Registra gli accessi: chi apre/avvia quale programma, con data e ora.
//
// Avvio:  node server.js   (oppure doppio click su avvia.bat)
// Config: variabili d'ambiente PORT (default 8080) e HOST (default 127.0.0.1).

'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn, execFile, execFileSync } = require('child_process');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.resolve(__dirname, '..');          // cartella "prototipo suite"
const PAGES_DIR = path.join(__dirname, 'pages');     // pagine HTML
const ASSETS_DIR = path.join(__dirname, 'assets');   // css / js / font
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const UTENTI_FILE = path.join(DATA_DIR, 'utenti.json');
const ACCESSI_FILE = path.join(DATA_DIR, 'accessi.log');   // NDJSON append-only
const SECRET_FILE = path.join(DATA_DIR, '.session-secret'); // chiave HMAC sessioni
const LOG_FILE = path.join(DATA_DIR, 'server.log');         // errori runtime
const IP_ADMIN_FILE = path.join(DATA_DIR, 'ip-admin.json'); // regole IP -> admin per-app
const WARM_FILE = path.join(DATA_DIR, 'warm.json');        // app da avviare "a caldo"
const APP_EXTRA_FILE = path.join(DATA_DIR, 'app-extra.json'); // programmi aggiunti dagli admin

const ACCESSI_CAP = 5000;   // eventi massimi conservati
const SESSION_MS = 8 * 60 * 60 * 1000;
const MIN_PW_LEN = 8;
// Username dell'admin creato al primo avvio (la password è casuale, vedi ensureData).
const ADMIN_INIZIALE = process.env.ADMIN_USER || 'admin';
const LOG_MAX_BYTES = 5 * 1024 * 1024;   // server.log: oltre questa taglia si ruota

// HTTPS opzionale. Su HTTP le password viaggiano in chiaro sulla LAN: chi vuole
// cifrare mette un certificato (anche interno) e avvia con
//   set TLS_CERT=C:\certs\portale.crt & set TLS_KEY=C:\certs\portale.key
// Il cookie di sessione prende il flag Secure solo qui: metterlo su HTTP
// significherebbe che il browser non lo rimanda più e nessuno resta loggato.
const TLS_CERT = process.env.TLS_CERT || '';
const TLS_KEY = process.env.TLS_KEY || '';
const TLS_ON = !!(TLS_CERT && TLS_KEY);
// Indirizzi a sottodominio, per il server con reverse proxy (deploy/Caddyfile).
// Con SUITE_DOMINIO=esempio.lan ogni app vive su https://<cartella>.esempio.lan
// (https://scadenzario.esempio.lan, https://lettore-ddt.esempio.lan...) e il
// portale su https://portale.esempio.lan. Senza, tutto resta host:porta.
// SUITE_SCHEMA=http solo se il proxy non fa TLS (sconsigliato: password in chiaro).
const SUITE_DOMINIO = String(process.env.SUITE_DOMINIO || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
if (SUITE_DOMINIO && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(SUITE_DOMINIO)) {
  console.error(`SUITE_DOMINIO non valido: "${SUITE_DOMINIO}" (atteso un nome come "esempio.lan").`);
  process.exit(1);
}
const SUITE_SCHEMA = process.env.SUITE_SCHEMA === 'http' ? 'http' : 'https';
const PORTALE_PUBBLICO = SUITE_DOMINIO ? `${SUITE_SCHEMA}://portale.${SUITE_DOMINIO}` : '';

// Anche dietro reverse proxy che termina TLS il cookie va marcato Secure.
const COOKIE_SECURE = TLS_ON || process.env.COOKIE_SECURE === '1'
  || (!!SUITE_DOMINIO && SUITE_SCHEMA === 'https');

// Tentativi di login falliti: soglia e finestra di blocco.
// Due contatori: per utente+IP (5) e per solo IP (20). Il primo protegge il
// singolo account; il secondo ferma chi dallo stesso PC prova 5 tentativi su
// OGNI username — senza, il limite per-account non limitava niente.
const LOGIN_MAX_FAIL = 5;
const LOGIN_MAX_FAIL_IP = 20;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

// Registro delle app della suite.
// Campi extra usati SOLO dall'assistente (vedi "Assistente della suite"):
//   kw        — parole e frasi con cui la gente nomina l'app (anche a sproposito).
//   dettaglio — risposta lunga a "cosa fa X?"; il campo desc resta quello della card.
const APPS = [
  {
    id: 'ddt',
    nome: 'Lettore DDT',
    sottotitolo: 'Da PDF a Excel',
    desc: 'Converte i documenti di trasporto (DDT) da PDF a Excel. Gestione utenti, template e storico versioni.',
    porta: 5050,
    dir: 'lettore-ddt',
    launch: 'avvia.vbs',
    tipo: 'Node.js',
    kw: ['lettore ddt', 'lettore', 'ddt suite', 'ddt', 'documento di trasporto', 'documenti di trasporto', 'bolla', 'bolle',
      'excel', 'xlsx', 'foglio di calcolo', 'template', 'fornitore', 'fornitori', 'trasporto'],
    dettaglio: 'Prende i documenti di trasporto in PDF e li trasforma in fogli Excel. Gestisce gli utenti, i template di estrazione per ogni fornitore e lo storico delle versioni.',
  },
  {
    id: 'agente',
    nome: 'Analista Dati',
    sottotitolo: 'Domande sui dati, risposte con AI',
    desc: 'Agente AI che interroga i database aziendali in linguaggio naturale e produce report e grafici.',
    porta: 5173,
    dir: 'analista-dati',
    launch: 'avvia.vbs',
    tipo: 'Node.js + AI',
    kw: ['analista dati', 'analista', 'agente', 'database', 'db', 'sql', 'query', 'interrogare', 'interroga', 'dati',
      'report', 'grafico', 'grafici', 'analisi', 'statistiche', 'ai',
      'intelligenza artificiale', 'linguaggio naturale', 'domanda sui dati'],
    dettaglio: 'Gli fai una domanda in italiano e lui la traduce in query sui database aziendali, poi ti risponde con tabelle, report e grafici. Non serve sapere SQL.',
  },
  {
    id: 'confronta',
    nome: 'Confronto Documenti',
    sottotitolo: 'Raffronto documenti',
    desc: 'Confronta due documenti PDF evidenziando le differenze, con OCR e report scaricabile in Word o PDF.',
    porta: 5001,
    dir: 'confronto-documenti',
    launch: 'avvia.vbs',
    tipo: 'Python',
    kw: ['confronto documenti', 'confronta pdf', 'confronta', 'confronto', 'confrontare', 'raffronto', 'differenza', 'differenze',
      'due pdf', 'due documenti', 'versione', 'versioni', 'revisione', 'revisioni',
      'cambiato', 'modifiche', 'word', 'diff'],
    dettaglio: 'Mette due PDF uno contro l\'altro ed evidenzia le differenze. Legge anche i documenti scansionati (usa l\'OCR) e produce un report scaricabile in Word o PDF.',
  },
  {
    id: 'ocr',
    nome: 'OCR Documenti',
    sottotitolo: 'OCR ed estrazione',
    desc: 'Riconoscimento testo da immagini e scansioni (PaddleOCR) con estrazione di articoli e prestazioni.',
    porta: 5179,
    dir: 'ocr-documenti',
    launch: 'avvia.vbs',
    tipo: 'Node.js + OCR',
    kw: ['ocr documenti', 'ocr', 'paddle', 'paddleocr', 'scansione', 'scansioni', 'scansionato', 'scannerizzato',
      'immagine', 'immagini', 'foto', 'riconoscimento testo', 'riconoscere', 'estrazione',
      'estrarre', 'articoli', 'prestazioni', 'testo da immagine'],
    dettaglio: 'Riconosce il testo dentro immagini e scansioni, anche storte o di bassa qualità, e ne estrae articoli e prestazioni. È l\'app da usare quando un PDF è una fotografia e non testo selezionabile.',
  },
  {
    id: 'scadenzario',
    nome: 'Scadenzario',
    sottotitolo: 'Scadenze e adempimenti',
    desc: 'Tiene sotto controllo scadenze e adempimenti aziendali, con preavvisi automatici e importazione da Excel.',
    porta: 5180,
    dir: 'scadenzario',
    launch: 'avvia.vbs',
    tipo: 'Python',
    kw: ['scadenzario', 'scadenza', 'scadenze', 'scaduto', 'scadute', 'adempimento',
      'adempimenti', 'compliance', 'preavviso', 'promemoria', 'rinnovo', 'rinnovi',
      'certificazione', 'certificazioni', 'visita medica', 'formazione', 'durc',
      'termine', 'termini'],
    dettaglio: 'Tiene l\'elenco delle scadenze e degli adempimenti aziendali e avvisa in anticipo, con giorni di preavviso configurabili per ogni tipo. Le scadenze si possono importare da Excel.',
  },
  {
    id: 'requisiti',
    nome: 'Verifica Requisiti',
    sottotitolo: 'Ricerca e checklist sui documenti',
    desc: 'Cerca parole e frasi dentro i documenti scansionati (con OCR) e applica una checklist di requisiti, con report Excel.',
    porta: 5185,
    dir: 'verifica-requisiti',
    launch: 'avvia.vbs',
    tipo: 'Node.js + OCR',
    // Riservata: i documenti caricati sono contrattuali (DURC, visure, certificati)
    // e non riguardano tutta l'azienda. Vedono la card gli admin del portale e gli
    // utenti con 'requisiti' nel campo apps di utenti.json (Amministrazione > Utenti).
    riservata: true,
    kw: ['requisiti', 'requisito', 'verifica', 'verificare', 'verifiche', 'checklist',
      'controllo', 'controlli', 'conformita', 'idoneita', 'documentazione',
      'durc', 'partita iva', 'dicitura', 'cerca', 'cercare', 'ricerca', 'parola',
      'parole', 'frase', 'full-text', 'testo nei documenti', 'documenti scansionati',
      'fornitore in regola', 'esito', 'esiti', 'scaduto'],
    dettaglio: 'Carichi i documenti (anche scansionati: il testo lo tira fuori l\'OCR) e poi ci cerchi dentro parole e frasi, oppure gli fai passare una checklist di requisiti — "il DURC è scaduto?", "c\'è la partita IVA?", "compare la dicitura X?". Per ogni requisito dà un esito (ok, ko, dubbio, non applicabile) con il punto del testo che lo dimostra, e produce il report Excel.',
  },
  {
    id: 'trimble',
    nome: 'Ponte Trimble',
    sottotitolo: 'Da PDF a file su Trimble',
    desc: 'Converte PCQ, computi economici e SAL da PDF a file strutturati e li carica su Trimble via API. Riservato agli amministratori.',
    porta: 3011,
    dir: 'ponte-trimble',
    launch: 'avvia.vbs',
    tipo: 'Node.js',
    adminOnly: true,   // parla col tenant Trimble aziendale: visibile e avviabile solo agli admin
    kw: ['ponte trimble', 'ponte', 'traduttore', 'trimble', 'pcq', 'piano controllo qualita', 'piano di controllo qualità', 'economico',
      'economici', 'computo', 'sal', 'stato avanzamento', 'stato avanzamento lavori',
      'caricare su trimble', 'upload', 'connect', 'xlsx', 'csv', 'api'],
    dettaglio: 'Prende un PDF (piani di controllo qualità, computi economici, SAL), ne estrae le voci riga per riga e produce un file xlsx, csv o json che carica su Trimble via API. Segnala gli scostamenti di quadratura prima del caricamento. Riservata agli amministratori del portale.',
  },
  {
    id: 'auguri',
    nome: 'Auguri',
    sottotitolo: 'Compleanni su WhatsApp',
    desc: 'Invia in automatico gli auguri di compleanno su WhatsApp. Riservato agli amministratori.',
    porta: 3000,
    dir: 'auguri',
    launch: 'avvia-silenzioso.vbs',
    tipo: 'Node.js',
    adminOnly: true,   // visibile e avviabile solo agli admin del portale
    kw: ['auguri', 'compleanno', 'compleanni', 'whatsapp', 'messaggio automatico', 'nascita'],
    dettaglio: 'Manda da sola gli auguri di compleanno su WhatsApp ai contatti in elenco. Riservata agli amministratori del portale.',
  },
];

// ---------------------------------------------------------------------------
// Assistente della suite. Motore locale a regole: nessuna AI, nessuna chiamata
// in rete, nessun costo. Sa SOLO quello che c'è nel registro APPS qui sopra, e
// fuori da lì non risponde — non per prudenza, ma perché non sa altro.
//
// Vive sul server (e non nel JS del browser) per un motivo preciso: così le
// risposte passano dallo stesso filtro canSeeApp delle altre API, e un utente
// non-admin non può leggere nel sorgente della pagina l'esistenza delle app
// adminOnly.
// ---------------------------------------------------------------------------

// Via accenti e punteggiatura: "Cos'è l'OCR?" -> "cos e l ocr"
function normalizza(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Punteggio di pertinenza di ogni app rispetto alla domanda. Una frase di più
// parole ("documento di trasporto") pesa più di una parola sola ("excel"), che
// può comparire in tante app; il nome esatto dell'app batte tutto.
function appPertinenti(qn, apps) {
  return apps
    .map((a) => {
      let punti = 0;
      for (const k of a.kw || []) {
        const kn = normalizza(k);
        if (!kn) continue;
        const re = new RegExp('(^|\\s)' + kn.replace(/\s+/g, '\\s+') + '($|\\s)');
        if (re.test(qn)) punti += kn.split(' ').length;
      }
      if (qn.includes(normalizza(a.nome))) punti += 5;
      return { app: a, punti };
    })
    .filter((x) => x.punti > 0)
    .sort((x, y) => y.punti - x.punti);
}

function schedaApp(a) {
  return `${a.nome} — ${a.sottotitolo}.\n${a.dettaglio || a.desc}`;
}

const CHAT_ESEMPI = 'Prova con: "cosa fa l\'OCR?", "quale app per i PDF scansionati?", "come si avvia il DDT?", "quali app ci sono?".';

// Ritorna { risposta, apps: [id] }: gli id servono al widget per mostrare i
// pulsanti Avvia/Apri della card corrispondente.
function rispondiAssistente(domanda, apps) {
  const qn = normalizza(domanda);
  if (!qn) return { risposta: 'Scrivi una domanda sulle app della suite. ' + CHAT_ESEMPI, apps: [] };

  const parole = qn.split(' ');

  // Saluto secco (non "ciao, cosa fa il ddt?": quello prosegue).
  if (parole.length <= 3 && /(^|\s)(ciao|salve|buongiorno|buonasera|hey|ehi)($|\s)/.test(qn)) {
    return {
      risposta: `Ciao. Rispondo alle domande sulle ${apps.length} app della suite: cosa fanno, quale usare e come si avviano.\n${CHAT_ESEMPI}`,
      apps: [],
    };
  }

  // Elenco delle app.
  if (/(quali|quante|elenco|lista|che)\s+(app|applicazioni|programmi|strumenti)/.test(qn)
      || /(cosa|che cosa)\s+(posso|si puo|puoi)\s+fare/.test(qn)
      || /(^|\s)(app|applicazioni|programmi)\s+(disponibili|ci sono|presenti)($|\s)/.test(qn)) {
    const elenco = apps.map((a) => `• ${a.nome} — ${a.sottotitolo}`).join('\n');
    return {
      risposta: `Nella suite ci sono ${apps.length} app:\n${elenco}\nChiedimi "cosa fa <nome>" per i dettagli.`,
      apps: apps.map((a) => a.id),
    };
  }

  const trovate = appPertinenti(qn, apps);

  // Porta / indirizzo di un'app: dettaglio tecnico che l'assistente non espone.
  // L'utente non ne ha bisogno: le app si aprono dai pulsanti delle card.
  if (/(^|\s)(porta|porte|indirizzo|url|link|localhost)($|\s)/.test(qn)) {
    const a = trovate.length ? trovate[0].app : null;
    const dove = a ? `di ${a.nome}` : 'dell\'app';
    return {
      risposta: `Gli indirizzi delle app non servono: usa i pulsanti "Avvia" e "Apri" sulla card ${dove} e il portale la apre da solo.`,
      apps: a ? [a.id] : [],
    };
  }

  // Come si avvia / si apre.
  if (/(^|\s)(avvi|avvio|avviare|aprire|apro|accendere|accendo|lanciare|start)/.test(qn)) {
    const a = trovate.length ? trovate[0].app : null;
    const dove = a ? `sulla card di ${a.nome}` : 'sulla card dell\'app';
    return {
      risposta: `Premi "Avvia" ${dove}: il portale accende il programma e lo apre da solo appena è pronto. Se è già acceso (pallino verde "Attivo") usa direttamente "Apri". Le app più pesanti, come l'OCR, ci mettono qualche secondo la prima volta.`,
      apps: a ? [a.id] : [],
    };
  }

  // Cosa fa X / quale app per <compito>.
  if (trovate.length) {
    const prima = trovate[0];
    let risposta = schedaApp(prima.app);
    // Secondo posto a ridosso del primo: la domanda è ambigua, le cito entrambe
    // invece di indovinare (es. "pdf" pesca sia Confronta sia OCR).
    const seconda = trovate[1];
    if (seconda && seconda.punti >= prima.punti) {
      risposta += `\n\nAnche ${seconda.app.nome} può fare al caso tuo: ${seconda.app.sottotitolo.toLowerCase()}.`;
      return { risposta, apps: [prima.app.id, seconda.app.id] };
    }
    return { risposta, apps: [prima.app.id] };
  }

  // Fuori tema: non lo so e lo dico.
  return {
    risposta: `Su questo non so rispondere: conosco solo le app della suite e cosa fanno.\n${CHAT_ESEMPI}`,
    apps: [],
  };
}

// ---------------------------------------------------------------------------
// Log errori runtime (su file + console).
// ---------------------------------------------------------------------------
function logError(ctx, err) {
  const line = `[${new Date().toISOString()}] ${ctx}: ${(err && err.stack) || err}\n`;
  try {
    rotateLogIfBig();
    fs.appendFileSync(LOG_FILE, line);
  } catch { /* disco pieno? ignora */ }
  console.error(line.trim());
}

// server.log cresce a ogni errore e nessuno lo guarda finché il disco non è
// pieno: oltre LOG_MAX_BYTES diventa server.log.1 (il .1 precedente si perde).
function rotateLogIfBig() {
  let size;
  try { size = fs.statSync(LOG_FILE).size; } catch { return; }   // non esiste ancora
  if (size < LOG_MAX_BYTES) return;
  try {
    fs.rmSync(LOG_FILE + '.1', { force: true });
    fs.renameSync(LOG_FILE, LOG_FILE + '.1');
  } catch { /* file in uso: riproveremo al prossimo errore */ }
}

// ---------------------------------------------------------------------------
// Persistenza. Scritture atomiche (tmp + rename) per non corrompere i file.
// ---------------------------------------------------------------------------
function writeFileAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

let SECRET = null;   // chiave HMAC, caricata da ensureData()

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(ACCESSI_FILE)) writeFileAtomic(ACCESSI_FILE, '');
  if (!fs.existsSync(IP_ADMIN_FILE)) {
    // Solo "rules" è attivo. Gli "_esempi" servono da modello: copiali in "rules"
    // e sostituisci gli IP con quelli reali della tua rete. Vuoto = nessuna regola.
    const esempio = {
      _leggimi: 'Regole IP -> admin per-app. app validi: ddt, agente, confronta, ocr, scadenzario, requisiti, trimble, auguri, portale. "*" = tutte. ip: esatto ("192.168.1.10"), CIDR ("192.168.1.0/24") o "*". Le modifiche valgono ai NUOVI accessi: chi è già loggato deve rifare login.',
      _esempi: [
        { ip: '192.168.1.50', apps: ['portale'], nota: 'PC direzione: admin del portale' },
        { ip: '192.168.1.0/24', apps: ['ddt', 'ocr'], nota: 'rete uffici: admin in DDT e OCR' },
        { ip: '10.0.0.7', apps: ['*'], nota: 'PC amministratore: admin ovunque' },
      ],
      rules: [],
    };
    writeFileAtomic(IP_ADMIN_FILE, JSON.stringify(esempio, null, 2));
  }
  if (!fs.existsSync(WARM_FILE)) {
    writeFileAtomic(WARM_FILE, JSON.stringify({
      _leggimi: 'App da avviare "a caldo" all\'avvio del portale e tenere accese, così sono già pronte quando qualcuno le apre (id: ddt, agente, confronta, ocr, scadenzario, requisiti; "all" = tutte). Utile sul server centrale. Sovrascrivibile con la variabile d\'ambiente WARM_APPS (es. WARM_APPS=ocr,agente). Vuoto = nessun pre-avvio.',
      apps: [],
    }, null, 2));
  }
  if (!fs.existsSync(UTENTI_FILE)) {
    // Username salvato in minuscolo: il login normalizza sempre a lowercase.
    // mustChange: forza il cambio password al primo accesso.
    //
    // La password è generata a caso e stampata QUI, una volta sola: era scritta
    // nel sorgente, e una password nel sorgente è pubblica quanto il repo. Chi
    // installa il portale la legge da questa console e la cambia al primo
    // accesso. Se la perde: ferma il portale, cancella data/utenti.json e
    // riavvia — il setup rifà l'admin con una password nuova.
    const password = crypto.randomBytes(9).toString('base64url');   // 12 caratteri
    const admin = makeUser(ADMIN_INIZIALE, 'Amministratore', password, 'admin', true);
    writeFileAtomic(UTENTI_FILE, JSON.stringify([admin], null, 2));
    console.log('  ============================================');
    console.log('  [SETUP] Creato l\'utente amministratore. Segna la password: viene');
    console.log('          mostrata solo adesso.');
    console.log(`            username: ${ADMIN_INIZIALE}`);
    console.log(`            password: ${password}`);
    console.log('          Al primo accesso ti verra chiesto di cambiarla.');
    console.log('  ============================================');
  }
  SECRET = loadSecret();
}

function loadSecret() {
  try { return fs.readFileSync(SECRET_FILE); }
  catch {
    const s = crypto.randomBytes(32);
    try { writeFileAtomic(SECRET_FILE, s); } catch (e) { logError('scrittura secret', e); }
    return s;
  }
}

function loadUtenti() {
  try { return JSON.parse(fs.readFileSync(UTENTI_FILE, 'utf8')); }
  catch { return []; }
}
function saveUtenti(list) {
  writeFileAtomic(UTENTI_FILE, JSON.stringify(list, null, 2));
}

// Log accessi in formato NDJSON (una riga JSON per evento).
// Append O(1) per evento; trim occasionale (ogni 500) per limitare la crescita.
function loadAccessi() {
  let raw;
  try { raw = fs.readFileSync(ACCESSI_FILE, 'utf8'); } catch { return []; }
  const t = raw.trim();
  if (!t) return [];
  if (t[0] === '[') {                       // vecchio formato JSON-array: migra al volo
    try { return JSON.parse(t); } catch { return []; }
  }
  const out = [];
  for (const line of t.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* riga rotta: salta */ }
  }
  return out;
}
let accessiSinceTrim = 0;
function logAccesso(entry) {
  try { fs.appendFileSync(ACCESSI_FILE, JSON.stringify(entry) + '\n'); }
  catch (e) { logError('append accesso', e); return; }
  if (++accessiSinceTrim >= 500) { accessiSinceTrim = 0; trimAccessi(); }
}
// Attività di UN utente, per la plancia della home. Funzione pura (testata):
// riceve il registro già letto e decide cosa mostrare.
//
// Il registro intero resta riservato agli admin (/api/accessi): qui ognuno vede
// solo le proprie righe, e solo per le app che può ancora vedere — un'app tolta
// a un utente sparisce anche dal suo storico, come sparisce dalla home.
const GIORNO_MS = 24 * 60 * 60 * 1000;
function riepilogoAttivita(accessi, username, puoVedere, ora = Date.now()) {
  const mie = accessi
    .filter((e) => e && e.username === username && e.ts)
    .filter((e) => !e.appId || puoVedere(e.appId))
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));   // più recenti prima

  const dopo = (giorni) => (e) => ora - Date.parse(e.ts) <= giorni * GIORNO_MS;
  const usoApp = (e) => e.appId && (e.azione === 'apri' || e.azione === 'avvia');

  // App più usata negli ultimi 30 giorni: aperture + avvii.
  const conteggio = {};
  for (const e of mie.filter(dopo(30)).filter(usoApp)) conteggio[e.appId] = (conteggio[e.appId] || 0) + 1;
  const [piuUsataId, piuUsataVolte] = Object.entries(conteggio).sort((a, b) => b[1] - a[1])[0] || [null, 0];

  // "Riprendi da qui": le ultime app distinte che l'utente ha aperto o avviato.
  const riprendi = [];
  for (const e of mie.filter(usoApp)) {
    if (riprendi.some((r) => r.appId === e.appId)) continue;
    riprendi.push({ appId: e.appId, ts: e.ts });
    if (riprendi.length === 3) break;
  }

  // Ultimo accesso PRIMA di quello in corso: il login appena fatto è il primo
  // della lista e direbbe sempre "adesso".
  const login = mie.filter((e) => e.azione === 'login');
  const meseCorrente = new Date(ora).toISOString().slice(0, 7);

  return {
    attivita: mie.slice(0, 40).map((e) => ({ ts: e.ts, azione: e.azione, appId: e.appId || null })),
    riprendi,
    numeri: {
      aperture7: mie.filter(dopo(7)).filter(usoApp).length,
      piuUsata: piuUsataId ? { appId: piuUsataId, volte: piuUsataVolte } : null,
      accessiMese: login.filter((e) => e.ts.slice(0, 7) === meseCorrente).length,
    },
    ultimoAccesso: login[1] ? login[1].ts : null,
  };
}

// Elenco utenti per la plancia degli admin. Funzione pura (testata).
// Una riga per utente registrato — anche chi non è mai entrato, così l'admin
// vede gli account inutilizzati — ordinata dall'attività più recente.
function riepilogoUtenti(accessi, utenti, ora = Date.now()) {
  const oggi = new Date(ora).toISOString().slice(0, 10);
  const dopo30 = (e) => ora - Date.parse(e.ts) <= 30 * GIORNO_MS;
  const usoApp = (e) => e.appId && (e.azione === 'apri' || e.azione === 'avvia');
  const validi = accessi.filter((e) => e && e.ts && e.username);

  const righe = utenti.map((u) => {
    const mie = validi.filter((e) => e.username === u.username).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const login = mie.filter((e) => e.azione === 'login');
    const ultimaApp = mie.find(usoApp);
    return {
      username: u.username, nome: u.nome, ruolo: u.ruolo,
      ultimaAttivita: mie[0] ? mie[0].ts : null,
      ultimoAccesso: login[0] ? login[0].ts : null,
      accessi30: login.filter(dopo30).length,
      aperture30: mie.filter(dopo30).filter(usoApp).length,
      ultimaApp: ultimaApp ? { appId: ultimaApp.appId, ts: ultimaApp.ts } : null,
      attivoOggi: !!(mie[0] && mie[0].ts.slice(0, 10) === oggi),
    };
  }).sort((a, b) => (b.ultimaAttivita || '').localeCompare(a.ultimaAttivita || ''));

  const conteggio = {};
  for (const e of validi.filter(dopo30).filter(usoApp)) conteggio[e.appId] = (conteggio[e.appId] || 0) + 1;
  const [piuUsataId, piuUsataVolte] = Object.entries(conteggio).sort((a, b) => b[1] - a[1])[0] || [null, 0];

  return {
    utenti: righe,
    numeri: {
      utentiOggi: righe.filter((r) => r.attivoOggi).length,
      utentiTotali: righe.length,
      accessiOggi: validi.filter((e) => e.azione === 'login' && e.ts.slice(0, 10) === oggi).length,
      piuUsata: piuUsataId ? { appId: piuUsataId, volte: piuUsataVolte } : null,
    },
  };
}

function trimAccessi() {
  const list = loadAccessi();
  if (list.length <= ACCESSI_CAP) return;
  const kept = list.slice(-ACCESSI_CAP);
  try { writeFileAtomic(ACCESSI_FILE, kept.map((e) => JSON.stringify(e)).join('\n') + '\n'); }
  catch (e) { logError('trim accessi', e); }
}

// ---------------------------------------------------------------------------
// Password (scrypt) e utenti.
// ---------------------------------------------------------------------------
function hashPw(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function makeUser(username, nome, password, ruolo, mustChange) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    username, nome, ruolo: ruolo || 'utente',
    salt, hash: hashPw(password, salt),
    mustChange: !!mustChange, creato: new Date().toISOString(),
    // Versione di sessione: entra nel cookie e viene confrontata a ogni
    // richiesta. Incrementarla (es. al cambio password) rende carta straccia
    // tutti i cookie emessi prima, che altrimenti — sessioni stateless —
    // resterebbero validi fino alla scadenza (8 ore).
    sv: 1,
  };
}
function verifyPw(user, password) {
  const h = Buffer.from(hashPw(password, user.salt), 'hex');
  const stored = Buffer.from(user.hash, 'hex');
  return h.length === stored.length && crypto.timingSafeEqual(h, stored);
}

// ---------------------------------------------------------------------------
// Sessioni stateless: cookie firmato HMAC-SHA256 (base64url(payload).mac).
// Nessuno stato in RAM: niente memory leak, sopravvive ai riavvii.
// ---------------------------------------------------------------------------
function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
// Con i sottodomini il cookie va emesso per tutto il dominio: e' il browser a
// mandarlo a https://scadenzario.<dominio>, e il gate SSO dell'app lo gira al
// portale per la verifica. Senza Domain resterebbe confinato a portale.<dominio>.
const COOKIE_FLAGS = `HttpOnly; Path=/; SameSite=Lax${SUITE_DOMINIO ? `; Domain=${SUITE_DOMINIO}` : ''}${COOKIE_SECURE ? '; Secure' : ''}`;
function makeSessionCookie(user, adm) {
  const payload = {
    u: user.username, n: user.nome, r: user.ruolo,
    v: user.sv || 1,                          // versione di sessione (vedi makeUser)
    exp: Date.now() + SESSION_MS,
  };
  if (adm && adm.length) payload.a = adm;   // app in cui l'IP eleva l'utente ad admin
  return `sid=${signSession(payload)}; ${COOKIE_FLAGS}; Max-Age=${SESSION_MS / 1000}`;
}
const CLEAR_COOKIE = `sid=; ${COOKIE_FLAGS}; Max-Age=0`;
function getSession(req) {
  const cookie = req.headers.cookie || '';
  const m = cookie.split(';').map((c) => c.trim()).find((c) => c.startsWith('sid='));
  if (!m) return null;
  const token = m.slice(4);
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const body = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
  if (!p || !p.exp || p.exp < Date.now()) return null;
  const s = { username: p.u, nome: p.n, ruolo: p.r, adm: Array.isArray(p.a) ? p.a : [] };
  // Il cookie da solo non basta: l'utente deve esistere ancora e la sua
  // versione di sessione deve coincidere. Così eliminare un utente o cambiare
  // password scollega subito, invece che alla scadenza del cookie. utenti.json
  // è un file piccolo letto dal filesystem (in cache dell'OS): il costo per
  // richiesta è trascurabile rispetto alla verifica HMAC appena fatta.
  const u = loadUtenti().find((x) => x.username === s.username);
  if (!u || (u.sv || 1) !== (p.v || 1)) return null;
  return s;
}

// ---------------------------------------------------------------------------
// Freno ai tentativi di login. Senza, chiunque sulla LAN può provare password a
// raffica: scrypt rallenta il singolo tentativo, non le migliaia. Chiave =
// utente+IP, così un PC che sbaglia non blocca l'account agli altri.
// Stato in RAM: si azzera al riavvio, e va bene (il riavvio lo fa un admin).
// ---------------------------------------------------------------------------
const loginFails = new Map();   // "user|ip" -> { n, until }

function loginKey(username, ip) {
  return `${String(username || '').toLowerCase().trim()}|${ip}`;
}
// Millisecondi di blocco residui (0 = può provare).
function loginBlockedMs(key, now = Date.now()) {
  const e = loginFails.get(key);
  if (!e || !e.until) return 0;
  return e.until > now ? e.until - now : 0;
}
function noteLoginFail(key, now = Date.now(), maxFail = LOGIN_MAX_FAIL) {
  const e = loginFails.get(key) || { n: 0, until: 0, ts: now };
  if (e.until && e.until <= now) e.n = 0;    // blocco scaduto: riparte da zero
  e.n++;
  e.ts = now;
  if (e.n >= maxFail) { e.until = now + LOGIN_LOCK_MS; e.n = 0; }
  loginFails.set(key, e);
  pruneLoginFails(now);
}
function clearLoginFails(key) {
  loginFails.delete(key);
}
// La mappa non deve crescere all'infinito: via le voci ferme da un pezzo e non
// più in blocco.
function pruneLoginFails(now = Date.now()) {
  for (const [k, e] of loginFails) {
    const scaduto = !e.until || e.until <= now;
    if (scaduto && (now - e.ts) > LOGIN_LOCK_MS) loginFails.delete(k);
  }
}

// ---------------------------------------------------------------------------
// Admin per-IP e per-app.
// Su un server centrale in LAN ogni PC ha un IP diverso: certe postazioni
// possono elevare l'utente (già loggato) ad admin solo in alcune app. Le regole
// stanno in data/ip-admin.json e vengono lette al login; l'insieme delle app
// abilitate finisce nel cookie di sessione, così /api/verify e /api/me lo sanno
// senza dover ricostruire l'IP reale del client (che le app, chiamando il
// portale da localhost, non vedrebbero).
// ---------------------------------------------------------------------------
function loadIpAdmin() {
  try {
    const j = JSON.parse(fs.readFileSync(IP_ADMIN_FILE, 'utf8'));
    return Array.isArray(j.rules) ? j.rules : [];
  } catch { return []; }
}

// IP reale del client. Dietro reverse proxy (nginx/IIS) impostare TRUST_PROXY=1
// per leggere il primo hop di X-Forwarded-For; senza proxy si usa l'IP del
// socket (l'header sarebbe falsificabile). Normalizza IPv4-mapped IPv6 e ::1.
function clientIp(req) {
  let ip = '';
  // Con SUITE_DOMINIO davanti c'e' il reverse proxy sulla stessa macchina: tutto
  // arriva da 127.0.0.1, e senza l'header ogni utente sembrerebbe "locale"
  // (regole IP -> admin, blocco dei login). Ci si fida dell'header solo se la
  // connessione viene davvero dal loopback: da un altro PC non si falsifica.
  const remoto = String((req.socket && req.socket.remoteAddress) || '');
  const daLoopback = /^(127\.|::1$|::ffff:127\.)/.test(remoto);
  if (process.env.TRUST_PROXY === '1' || (SUITE_DOMINIO && daLoopback)) {
    ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  }
  if (!ip) ip = (req.socket && req.socket.remoteAddress) || '';
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);   // IPv4 mappato in IPv6
  if (ip === '::1') ip = '127.0.0.1';               // localhost IPv6
  return ip;
}

// Host su cui il browser ha aperto il portale (dall'header Host, senza porta).
// Serve a costruire gli URL delle app: se un PC in LAN apre il portale su
// http://192.168.1.5:8080, le sue app stanno su 192.168.1.5, non su "localhost"
// (che per quel browser sarebbe il PC dell'utente, dove non gira niente).
function portalHostname(req) {
  const host = String((req.headers && req.headers.host) || '').trim();
  if (!host) return 'localhost';
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);   // IPv6: [::1]:8080
  return host.split(':')[0] || 'localhost';
}

// URL pubblico di un'app, visto dal browser che ha chiesto la pagina. Sempre
// http: le app della suite servono HTTP in chiaro sulla loro porta, anche se il
// portale sta dietro TLS (il link è una navigazione, non un sotto-risorsa: il
// browser non lo blocca).
// Con SUITE_DOMINIO: https://<sottodominio>.<dominio>, servito dal reverse proxy.
function appUrl(req, app) {
  const sub = sottodominio(app);
  if (SUITE_DOMINIO && sub) return `${SUITE_SCHEMA}://${sub}.${SUITE_DOMINIO}`;
  return `http://${portalHostname(req)}:${app.porta}`;
}

// Sottodominio di un'app = nome della sua cartella (lettore-ddt, scadenzario...):
// un solo nome da ricordare, sul disco e nella barra degli indirizzi. null se la
// cartella non e' un'etichetta DNS valida.
function sottodominio(app) {
  const s = String(app.dir || '').toLowerCase();
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s) ? s : null;
}

// Origin ammessi in CORS su /api/verify: SOLO le app della suite. Le app girano
// sullo stesso host del portale (altre porte), quindi un origin legittimo ha
// sempre (a) una porta del registro APPS — o quella del portale — e (b) l'host
// con cui il browser sta parlando col portale, oppure il loopback.
// La versione precedente ammetteva qualunque IP privato: una pagina ostile
// ospitata su un altro PC della LAN poteva leggere username e ruolo di chi la
// apriva da loggato.
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/i;
const SUITE_PORTS = new Set([PORT, ...APPS.map((a) => a.porta)]);
function isSuiteOrigin(origin, req) {
  let u;
  try { u = new URL(origin); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  // Sottodomini: solo portale.<dominio> e <app>.<dominio> del registro, sullo
  // schema configurato. Non "qualunque *.<dominio>": un altro servizio sotto lo
  // stesso dominio non deve poter leggere chi e' loggato.
  if (SUITE_DOMINIO && u.protocol === `${SUITE_SCHEMA}:` && !u.port) {
    const h = u.hostname.toLowerCase();
    if (h === `portale.${SUITE_DOMINIO}`) return true;
    if (APPS.some((a) => sottodominio(a) && h === `${sottodominio(a)}.${SUITE_DOMINIO}`)) return true;
  }
  const porta = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  if (!SUITE_PORTS.has(porta)) return false;
  if (LOOPBACK_HOST.test(u.hostname)) return true;
  // Stesso host (IP o nome di rete) su cui il browser ha aperto il portale.
  return u.hostname.toLowerCase() === portalHostname(req).toLowerCase();
}

function ipv4ToInt(ip) {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(String(ip));
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o > 255) return null;
    n = (n * 256) + o;
  }
  return n >>> 0;
}

// Confronto IP contro un pattern: "*" (qualsiasi), CIDR IPv4 (192.168.1.0/24)
// oppure match esatto (IPv4 o IPv6).
function ipMatches(ip, pattern) {
  pattern = String(pattern || '').trim();
  if (!pattern) return false;
  if (pattern === '*') return true;
  if (pattern.includes('/')) {
    const [base, bitsStr] = pattern.split('/');
    const bits = Number(bitsStr);
    const a = ipv4ToInt(ip), b = ipv4ToInt(base);
    if (a == null || b == null || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (a & mask) === (b & mask);
  }
  return ip === pattern;
}

// App per cui questo IP concede l'admin. '*' = tutte (portale incluso).
function admForIp(ip) {
  const out = new Set();
  for (const rule of loadIpAdmin()) {
    if (!rule || !ipMatches(ip, rule.ip)) continue;
    const apps = Array.isArray(rule.apps) ? rule.apps : (rule.apps ? [rule.apps] : []);
    for (const a of apps) out.add(String(a));
  }
  return [...out];
}

// admin effettivo su una specifica app = admin "vero" (utenti.json) OPPURE
// abilitato dall'IP (dal cookie di sessione) per quell'app o per tutte ('*').
function isAdminForApp(session, appId) {
  if (!session) return false;
  if (session.ruolo === 'admin') return true;
  const adm = session.adm || [];
  return adm.includes('*') || adm.includes(appId);
}

// Programmi visibili a un utente. Elenco esplicito nel campo apps di
// utenti.json; se il campo non c'è vale il default — tutte le app tranne le
// adminOnly e le riservate. Letto da disco a ogni richiesta e non dal cookie,
// così una modifica vale subito e non alla scadenza della sessione (8 ore).
function appsUtente(username) {
  const u = loadUtenti().find((x) => x.username === username);
  if (!u) return [];
  return Array.isArray(u.apps) ? u.apps.map(String) : appsPredefinite();
}

// Default per chi non ha un elenco suo: le app di tutti. Le riservate no —
// vanno spuntate una per una in Amministrazione > Utenti.
function appsPredefinite() {
  return APPS.filter((a) => !a.adminOnly && !a.riservata).map((a) => a.id);
}

// Chi può usare un'app. Gli admin del portale entrano ovunque; le adminOnly si
// fermano lì; per tutte le altre decide l'elenco dei programmi dell'utente.
// Unico punto di verità: lo usano sia le card (canSeeApp) sia /api/verify, il
// gate SSO delle app. Nascondere solo la card lascerebbe l'app aperta a chi ne
// conosce l'indirizzo — che in LAN è una porta su un host noto.
function accessoApp(app, session) {
  if (!app || !session) return false;
  if (isAdminForApp(session, 'portale')) return true;
  if (app.adminOnly) return false;
  // Admin di quella specifica app (regola per-IP): entra anche senza spunta.
  if (isAdminForApp(session, app.id)) return true;
  return appsUtente(session.username).includes(app.id);
}

// Le app che si possono assegnare a un utente dall'area Amministrazione: tutte
// tranne le adminOnly, che seguono il ruolo e non le spunte.
function appAssegnabili() {
  return APPS.filter((a) => !a.adminOnly).map((a) => ({ id: a.id, nome: a.nome, riservata: !!a.riservata }));
}

// Ripulisce l'elenco che arriva dal client: solo id di app assegnabili, senza
// duplicati. Un id sconosciuto non è un errore da mostrare, è rumore da
// buttare — l'unica cosa che conta è non salvare un permesso per qualcosa che
// non esiste o che segue il ruolo (adminOnly).
function filtraApps(apps) {
  const validi = new Set(appAssegnabili().map((a) => a.id));
  const richiesti = Array.isArray(apps) ? apps : [];
  return [...new Set(richiesti.map(String).filter((id) => validi.has(id)))];
}

// ---------------------------------------------------------------------------
// Utility HTTP.
// ---------------------------------------------------------------------------
function sendJson(res, code, obj, headers) {
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, headers || {}));
  res.end(JSON.stringify(obj));
}
function sendFile(res, file, type) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(500); return res.end('Errore lettura ' + path.basename(file)); }
    res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' });
    res.end(data);
  });
}

// Serve i file statici da /assets (css, js, font). Pubblico: nessun dato
// sensibile, e la pagina di login ne ha bisogno prima dell'autenticazione.
const MIME = {
  '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
};
const TEXT_EXT = new Set(['.css', '.js', '.svg']);
function sendAsset(res, urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full = path.normalize(path.join(__dirname, rel));
  // Blocca il path traversal: deve restare dentro assets/.
  if (full !== ASSETS_DIR && !full.startsWith(ASSETS_DIR + path.sep)) {
    res.writeHead(403); return res.end('Vietato');
  }
  const ext = path.extname(full).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    // I font hanno hash immutabile: cache lunga. CSS/JS: sempre rivalidati.
    const cache = ext === '.woff2' || ext === '.woff'
      ? 'public, max-age=31536000, immutable'
      : 'no-cache';
    res.writeHead(200, {
      'Content-Type': TEXT_EXT.has(ext) ? type + '; charset=utf-8' : type,
      'Cache-Control': cache,
    });
    res.end(data);
  });
}
function readJsonBody(req, maxBytes = 1e6) {
  return new Promise((resolve) => {
    let body = '';
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    req.on('data', (c) => {
      body += c;
      if (body.length > maxBytes) { req.destroy(); done({}); }   // body troppo grande
    });
    req.on('end', () => { try { done(JSON.parse(body || '{}')); } catch { done({}); } });
    req.on('error', () => done({}));
    req.on('close', () => done({}));                          // connessione chiusa: non restare appesi
  });
}

// ---------------------------------------------------------------------------
// Import utenti da foglio: legge .xlsx (ZIP+XML) o .csv senza dipendenze esterne.
// L'xlsx è uno ZIP: leggo la central directory, decomprimo con zlib (deflate raw)
// e faccio un parsing XML minimale di sharedStrings + primo foglio.
// ---------------------------------------------------------------------------
function xmlDecode(s) {
  return String(s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');   // per ultimo: evita di ri-decodificare entità annidate
}

// --- ZIP: elenco voci dalla central directory + estrazione singola voce. ---
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP non valido (EOCD assente)');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let n = 0; n < count && off + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name, method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
function zipRead(buf, entry) {
  const lo = entry.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('ZIP: intestazione locale non valida');
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return data;                 // stored
  if (entry.method === 8) return zlib.inflateRawSync(data); // deflate
  throw new Error('ZIP: compressione non supportata (' + entry.method + ')');
}

function parseSharedStrings(xml) {
  const out = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = re.exec(xml))) {
    let text = '';
    const tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let tm;
    while ((tm = tre.exec(m[1]))) text += xmlDecode(tm[1]);
    out.push(text);
  }
  return out;
}
function colToIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref || '');
  if (!m) return -1;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function parseSheet(xml, shared) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const inner = rm[1] || '';
    const cells = [];
    const cRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    while ((cm = cRe.exec(inner))) {
      const attrs = cm[1] || '';
      const body = cm[2] || '';
      const ref = (/r="([^"]+)"/.exec(attrs) || [])[1] || '';
      const t = (/t="([^"]+)"/.exec(attrs) || [])[1] || '';
      let val = '';
      if (t === 'inlineStr') {
        const tre = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let tm;
        while ((tm = tre.exec(body))) val += xmlDecode(tm[1]);
      } else {
        const raw = (/<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body) || [])[1] || '';
        if (t === 's') { const i = parseInt(raw, 10); val = shared[i] != null ? shared[i] : ''; }
        else val = xmlDecode(raw);
      }
      const ci = colToIndex(ref);
      if (ci >= 0) cells[ci] = val; else cells.push(val);
    }
    rows.push(cells);
  }
  return rows;
}
function xlsxToRows(buf) {
  const entries = zipEntries(buf);
  const byName = {};
  entries.forEach((e) => { byName[e.name] = e; });
  const shared = byName['xl/sharedStrings.xml']
    ? parseSharedStrings(zipRead(buf, byName['xl/sharedStrings.xml']).toString('utf8'))
    : [];
  const sheetNames = entries.map((e) => e.name)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/(\d+)/)[1], 10) - parseInt(b.match(/(\d+)/)[1], 10));
  if (!sheetNames.length) throw new Error('Nessun foglio nel file xlsx');
  return parseSheet(zipRead(buf, byName[sheetNames[0]]).toString('utf8'), shared);
}

// --- CSV: delimitatore auto (';' Excel-IT o ','), gestione virgolette e BOM. ---
function csvToRows(buf) {
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// --- Da tabella grezza a righe utente, mappando le intestazioni note. ---
const HEAD_ALIASES = {
  username: ['username', 'user', 'utente', 'userid', 'login', 'nomeutente'],
  nome: ['nome', 'nomecognome', 'nomeecognome', 'nominativo', 'name', 'cognomeenome', 'cognomenome'],
  password: ['password', 'pwd', 'pw', 'passwd', 'parolachiave'],
  ruolo: ['ruolo', 'role', 'tipo', 'tipologia'],
};
function normHead(s) {
  return String(s || '').toLowerCase().normalize('NFD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
}
function rowsToUsers(table) {
  let hi = -1;
  for (let i = 0; i < table.length; i++) {
    if ((table[i] || []).some((c) => String(c || '').trim() !== '')) { hi = i; break; }
  }
  if (hi < 0) throw new Error('Foglio vuoto');
  const colmap = {};
  (table[hi] || []).forEach((h, idx) => {
    const nh = normHead(h);
    for (const field in HEAD_ALIASES) {
      if (colmap[field] == null && HEAD_ALIASES[field].includes(nh)) colmap[field] = idx;
    }
  });
  if (colmap.username == null || colmap.nome == null) {
    throw new Error('Intestazioni non riconosciute: servono almeno le colonne "username" e "nome"');
  }
  const users = [];
  for (let i = hi + 1; i < table.length; i++) {
    const row = table[i] || [];
    if (!row.some((c) => String(c || '').trim() !== '')) continue;   // riga vuota: salta
    const cell = (idx) => (idx != null && row[idx] != null ? row[idx] : '');
    users.push({
      riga: i + 1,   // numero riga foglio (1-based) per la segnalazione
      username: cell(colmap.username),
      nome: cell(colmap.nome),
      password: cell(colmap.password),
      ruolo: cell(colmap.ruolo),
    });
  }
  return users;
}
function parseUsersSheet(buf) {
  const isXlsx = buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4B;  // 'PK' → zip/xlsx
  return rowsToUsers(isXlsx ? xlsxToRows(buf) : csvToRows(buf));
}

// ---------------------------------------------------------------------------
// Logica app.
// ---------------------------------------------------------------------------
function checkPort(porta) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (up) => { if (done) return; done = true; socket.destroy(); resolve(up); };
    socket.setTimeout(800);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(porta, '127.0.0.1');
  });
}
// PATH "fresco" per le app che lanciamo. Un processo Windows eredita l'ambiente
// di chi lo ha creato, e il portale spesso resta acceso per giorni: installare
// Tesseract o poppler mentre gira non basta, le app nate da qui continuerebbero
// a non trovarli fino al riavvio della macchina. Qui il PATH si rilegge dal
// registro (macchina + utente) a ogni avvio di app, così un programma appena
// installato è utilizzabile subito.
function pathDalRegistro() {
  if (process.platform !== 'win32') return process.env.PATH || '';
  const chiavi = [
    ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'Path'],
    ['HKCU\\Environment', 'Path'],
  ];
  const pezzi = [];
  for (const [chiave, valore] of chiavi) {
    try {
      const out = execFileSync('reg', ['query', chiave, '/v', valore], { encoding: 'utf8', timeout: 5000 });
      // riga tipo:  "    Path    REG_EXPAND_SZ    C:\\Windows;C:\\Windows\\system32"
      const m = out.match(/\s+Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i);
      if (m) pezzi.push(m[1].trim());
    } catch (e) { /* chiave illeggibile: si prosegue con quello che c'è */ }
  }
  if (!pezzi.length) return process.env.PATH || '';
  // %SystemRoot% e simili: nel registro restano non espansi (REG_EXPAND_SZ).
  const espandi = (s) => s.replace(/%([^%]+)%/g, (tutto, nome) => process.env[nome] || tutto);
  const voci = espandi(pezzi.join(';')).split(';').map((v) => v.trim()).filter(Boolean);
  // Il PATH del processo resta in coda: se il portale è stato avviato con
  // aggiunte proprie (una console, uno script), non le perde.
  for (const v of String(process.env.PATH || '').split(';')) {
    const t = v.trim();
    if (t) voci.push(t);
  }
  return [...new Set(voci)].join(';');
}

function launchApp(app) {
  const appDir = path.join(ROOT, app.dir);
  const launcher = path.join(appDir, app.launch);
  if (!fs.existsSync(launcher)) return { ok: false, error: 'Launcher non trovato: ' + launcher };
  // I launcher sono .vbs: wscript.exe li esegue SENZA alcuna finestra di terminale
  // (il .vbs a sua volta lancia il .bat nascosto). Per un eventuale .bat diretto
  // si ricade sul vecchio "start" (compatibilità).
  const isVbs = /\.vbs$/i.test(app.launch);
  // Il portale apre da sé la scheda dell'app (vedi launch() in assets/js/index.js):
  // i launcher che aprirebbero il browser a loro volta devono astenersi, altrimenti
  // l'utente si ritrova due schede. Avviati a mano (senza questa variabile) la
  // aprono normalmente. L'ambiente si eredita lungo wscript -> bat.
  //
  // HOST: le app ascoltano in locale di default. Se il portale è in ascolto in
  // LAN, però, manda i browser degli altri PC su http://<ip-portale>:<porta-app>
  // (vedi appUrl): un'app legata a 127.0.0.1 lì risponderebbe "connessione
  // rifiutata". Ereditando l'HOST del portale le app si legano dove serve, senza
  // che nessuno debba ricordarsi di configurarle una per una. A proteggerle
  // resta il gate SSO (shared/sso), non l'indirizzo di ascolto.
  // PATH riletto dal registro: vedi pathDalRegistro(). Windows distingue Path e
  // PATH solo nella forma, non nella sostanza: Node normalizza su PATH.
  //
  // Con SUITE_DOMINIO le app stanno dietro il reverse proxy: ascoltano solo in
  // locale (le espone il proxy, non la LAN) e il gate SSO, quando serve il
  // login, rimanda al portale pubblico invece che a localhost:8080. La verifica
  // della sessione resta in locale (COSEDIL_PORTAL), veloce e senza TLS.
  const env = { ...process.env, PORTALE_APRE_BROWSER: '1', HOST, PATH: pathDalRegistro() };
  if (SUITE_DOMINIO) {
    env.HOST = '127.0.0.1';
    env.COSEDIL_PORTAL_PUBBLICO = PORTALE_PUBBLICO;
  }
  const child = isVbs
    ? spawn('wscript.exe', [launcher], { cwd: appDir, detached: true, stdio: 'ignore', windowsHide: true, env })
    : spawn('cmd.exe', ['/c', 'start', '', '/D', appDir, app.launch], { detached: true, stdio: 'ignore', windowsHide: true, env });
  child.unref();
  return { ok: true };
}

// --- Spegnimento di un'app --------------------------------------------------
// Le app sono processi staccati, lanciati da un .vbs: non ne conserviamo il PID
// (e comunque il PID del .vbs non è quello del server). L'unica cosa certa è la
// porta, quindi si risale al processo che è in ascolto lì e si chiude l'albero.

// PID in LISTENING sulla porta, secondo netstat. Righe tipo:
//   TCP    0.0.0.0:5050    0.0.0.0:0    LISTENING    1234
function parseNetstatPid(out, porta) {
  const pids = new Set();
  for (const line of String(out).split('\n')) {
    if (!/LISTENING/i.test(line)) continue;
    const col = line.trim().split(/\s+/);
    const local = col[1] || '';
    const pid = Number(col[col.length - 1]);
    if (!pid) continue;
    // La porta è l'ultimo ":" dell'indirizzo locale (IPv6: [::]:5050).
    const i = local.lastIndexOf(':');
    if (i < 0) continue;
    if (Number(local.slice(i + 1)) === Number(porta)) pids.add(pid);
  }
  return [...pids];
}

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true }, (err, stdout) => resolve({ err, stdout: stdout || '' }));
  });
}

async function pidsOnPort(porta) {
  // Niente '-p TCP': e' SOLO IPv4, e un'app legata a "localhost" (vite) ascolta su
  // [::1] = IPv6 ('-p TCPv6'): risultava "non accesa" e non si spegneva mai.
  // Le righe UDP non hanno LISTENING: le scarta parseNetstatPid.
  const { err, stdout } = await run('netstat', ['-ano']);
  if (err) { logError('netstat', err); return []; }
  return parseNetstatPid(stdout, porta);
}

async function stopApp(app) {
  const pids = await pidsOnPort(app.porta);
  if (!pids.length) return { ok: false, error: `${app.nome} non risulta acceso.` };
  const falliti = [];
  for (const pid of pids) {
    // /T chiude anche i figli (il .vbs lancia il .bat che lancia node/python),
    // /F non lascia scelta: queste app non hanno uno shutdown pulito da chiamare.
    const { err } = await run('taskkill', ['/PID', String(pid), '/T', '/F']);
    if (err) falliti.push(pid);
  }
  if (falliti.length === pids.length) {
    return { ok: false, error: 'Chiusura non riuscita: il processo potrebbe appartenere a un altro utente.' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Avvio a caldo (pre-warm). Sul server centrale conviene tenere già accese le
// app più lente (OCR, Agente): così l'utente non aspetta il boot. La lista sta
// in data/warm.json ("apps": [...]) o nella variabile WARM_APPS; "all" = tutte.
// ---------------------------------------------------------------------------
function getWarmList() {
  const env = String(process.env.WARM_APPS || '').trim();
  let ids;
  if (env) {
    ids = env.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  } else {
    try {
      const j = JSON.parse(fs.readFileSync(WARM_FILE, 'utf8'));
      ids = Array.isArray(j.apps) ? j.apps.map((s) => String(s).trim().toLowerCase()) : [];
    } catch { ids = []; }
  }
  if (ids.includes('all') || ids.includes('*')) return APPS.map((a) => a.id);
  return ids.filter((id) => APPS.some((a) => a.id === id));
}

const WARM_BOOT_MS = 120_000;             // finestra di boot: non ri-lanciare mentre sta ancora partendo
const warmLaunchedAt = new Map();         // appId -> ultimo (ri)avvio a caldo
// App spente a mano da un admin: il keep-alive le lascia stare, altrimenti le
// riaccenderebbe entro 30 secondi e il pulsante "Ferma" sembrerebbe rotto.
// Il consenso torna quando qualcuno preme "Avvia" (o al riavvio del portale).
const spenteAMano = new Set();
async function warmApps() {
  for (const id of getWarmList()) {
    const app = APPS.find((a) => a.id === id);
    if (!app || spenteAMano.has(id)) continue;
    try {
      if (await checkPort(app.porta)) continue;                              // già su: niente da fare
      if (Date.now() - (warmLaunchedAt.get(id) || 0) < WARM_BOOT_MS) continue; // sta ancora partendo
      const r = launchApp(app);
      if (r.ok) {
        warmLaunchedAt.set(id, Date.now());
        console.log(`  [WARM] Avvio a caldo: ${app.nome} (porta ${app.porta})`);
      } else {
        logError('warm ' + id, r.error);
      }
    } catch (e) { logError('warm ' + id, e); }
  }
}

// ---------------------------------------------------------------------------
// Server.
// ---------------------------------------------------------------------------
const onRequest = async (req, res) => {
  try {
    await handle(req, res);
  } catch (e) {
    logError('richiesta ' + req.method + ' ' + req.url, e);
    if (!res.headersSent) { res.writeHead(500); res.end('Errore interno'); }
  }
};

// Con TLS_CERT/TLS_KEY il portale parla HTTPS da solo; senza, resta HTTP come
// prima. Se i certificati sono indicati ma illeggibili si ferma subito: partire
// in chiaro quando l'admin ha chiesto TLS sarebbe peggio di non partire.
function creaServer() {
  if (!TLS_ON) return http.createServer(onRequest);
  let cert, key;
  try {
    cert = fs.readFileSync(TLS_CERT);
    key = fs.readFileSync(TLS_KEY);
  } catch (e) {
    console.error('  [TLS] Certificati illeggibili: ' + e.message);
    console.error('  [TLS] Controlla TLS_CERT e TLS_KEY. Portale non avviato.');
    process.exit(1);
  }
  return https.createServer({ cert, key }, onRequest);
}
const server = creaServer();

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // ---- Asset statici css/js/font (pubblici) ----
  if (p.startsWith('/assets/')) {
    return sendAsset(res, p);
  }

  // ---- Pagina di login (pubblica) ----
  if (p === '/login' || p === '/login.html') {
    return sendFile(res, path.join(PAGES_DIR, 'login.html'), 'text/html');
  }

  // ---- Login ----
  if (p === '/api/login' && req.method === 'POST') {
    const { username, password } = await readJsonBody(req);
    const ip = clientIp(req);
    const key = loginKey(username, ip);
    // Chiave del contatore per solo IP: '*' non può collidere con uno username
    // vero (il login li normalizza e '*' non è un nome valido).
    const keyIp = loginKey('*', ip);

    const bloccoMs = Math.max(loginBlockedMs(key), loginBlockedMs(keyIp));
    if (bloccoMs > 0) {
      const min = Math.ceil(bloccoMs / 60000);
      logAccesso({
        ts: new Date().toISOString(), username: String(username || '').toLowerCase().trim(),
        nome: null, appId: null, appNome: null, azione: 'login-bloccato', ip,
      });
      return sendJson(res, 429, {
        ok: false,
        error: `Troppi tentativi falliti. Riprova tra ${min} ${min === 1 ? 'minuto' : 'minuti'}.`,
      }, { 'Retry-After': String(Math.ceil(bloccoMs / 1000)) });
    }

    const user = loadUtenti().find((u) => u.username === String(username || '').toLowerCase().trim());
    if (!user || !verifyPw(user, String(password || ''))) {
      noteLoginFail(key);
      noteLoginFail(keyIp, Date.now(), LOGIN_MAX_FAIL_IP);
      return sendJson(res, 401, { ok: false, error: 'Credenziali non valide' });
    }
    clearLoginFails(key);
    clearLoginFails(keyIp);   // login riuscito: il PC non è (più) sospetto
    const adm = admForIp(ip);   // app in cui questo IP eleva l'utente ad admin
    logAccesso({
      ts: new Date().toISOString(), username: user.username, nome: user.nome,
      appId: null, appNome: null, azione: 'login', ip, admApps: adm,
    });
    return sendJson(res, 200, { ok: true, ruolo: user.ruolo, nome: user.nome, mustChange: !!user.mustChange }, {
      'Set-Cookie': makeSessionCookie(user, adm),
    });
  }

  // ---- Logout ----
  if (p === '/api/logout' && req.method === 'POST') {
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': CLEAR_COOKIE });
  }

  // ---- Verifica sessione condivisa (SSO tra le app della suite) ----
  // I cookie su localhost sono condivisi tra le porte: il browser manda il
  // cookie "sid" anche a localhost:5050, :5173, ecc. Un'app della suite può
  // inoltrare qui quel cookie (dal proprio backend o via fetch con credenziali)
  // per sapere se l'utente è già loggato nel portale, e da chi.
  if (p === '/api/verify') {
    const origin = req.headers.origin || '';
    const cors = {};
    // Consenti le chiamate cross-origin solo dalle app della suite (stesso host
    // del portale, altra porta), mai da internet.
    if (isSuiteOrigin(origin, req)) {
      cors['Access-Control-Allow-Origin'] = origin;
      cors['Access-Control-Allow-Credentials'] = 'true';
      cors['Vary'] = 'Origin';
    }
    if (req.method === 'OPTIONS') {   // preflight CORS
      return sendJson(res, 204, {}, Object.assign({
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }, cors));
    }
    const s = getSession(req);
    if (!s) return sendJson(res, 401, { ok: false }, cors);
    // Un'app può passare ?app=<id> per sapere se questa sessione è admin PER QUELL'APP.
    const appId = url.searchParams.get('app') || '';
    // Gate SSO vero e proprio: se l'app è riservata e questa sessione non vi ha
    // accesso, 403 — l'app la rifiuterà anche a chi ne digita l'indirizzo.
    const appChiesta = appId ? APPS.find((a) => a.id === appId) : null;
    if (appChiesta && !accessoApp(appChiesta, s)) {
      return sendJson(res, 403, { ok: false, error: 'Accesso riservato', app: appId }, cors);
    }
    return sendJson(res, 200, {
      ok: true, username: s.username, nome: s.nome, ruolo: s.ruolo,
      admin: appId ? isAdminForApp(s, appId) : (s.ruolo === 'admin'),
      appsAdmin: s.adm || [],
    }, cors);
  }

  // ================= da qui in poi serve la sessione =================
  const session = getSession(req);
  const wantsHtml = req.method === 'GET' && (req.headers.accept || '').includes('text/html');

  if (!session) {
    if (wantsHtml) { res.writeHead(302, { Location: '/login' }); return res.end(); }
    return sendJson(res, 401, { ok: false, error: 'Non autenticato' });
  }

  // admin "vero" (utenti.json) OPPURE elevato dall'IP per l'app "portale".
  // Governa sia l'area amministrazione sia la visibilità delle app adminOnly.
  const adminPortale = isAdminForApp(session, 'portale');
  // Un'app adminOnly o riservata è invisibile a chi non vi ha accesso: sparisce
  // dall'elenco e dallo stato, e non è né avviabile né apribile (le rotte
  // rispondono come se non esistesse).
  const canSeeApp = (app) => accessoApp(app, session);

  // ---- Chi sono (dati freschi da disco: ruolo/nome/mustChange aggiornati) ----
  if (p === '/api/me') {
    const u = loadUtenti().find((x) => x.username === session.username);
    if (!u) return sendJson(res, 401, { ok: false, error: 'Utente non più valido' }, { 'Set-Cookie': CLEAR_COOKIE });
    const appsAdmin = session.adm || [];
    const adminPortale = u.ruolo === 'admin' || appsAdmin.includes('*') || appsAdmin.includes('portale');
    return sendJson(res, 200, {
      username: u.username, nome: u.nome, ruolo: u.ruolo, mustChange: !!u.mustChange,
      appsAdmin, adminPortale, apps: appsUtente(u.username),
    });
  }

  // ---- Pagina cambio password (richiede sessione) ----
  if (p === '/password' || p === '/password.html') {
    return sendFile(res, path.join(PAGES_DIR, 'password.html'), 'text/html');
  }

  // ---- Documentazione: pagina visualizzatore + sorgenti Markdown ----
  if (p === '/doc' || p === '/doc.html') {
    return sendFile(res, path.join(PAGES_DIR, 'doc.html'), 'text/html');
  }
  if (p.startsWith('/docs/')) {
    const name = decodeURIComponent(p.slice('/docs/'.length)).toLowerCase();
    const map = { guida: 'guida.md', 'guida.md': 'guida.md', readme: 'README.md', 'readme.md': 'README.md' };
    const file = map[name];
    if (!file) { res.writeHead(404); return res.end('Not found'); }
    return sendFile(res, path.join(__dirname, file), 'text/markdown');
  }

  // ---- Cambio password (qualsiasi utente autenticato) ----
  if (p === '/api/password' && req.method === 'POST') {
    const { attuale, nuova } = await readJsonBody(req);
    const list = loadUtenti();
    const u = list.find((x) => x.username === session.username);
    if (!u) return sendJson(res, 401, { ok: false, error: 'Sessione non valida' }, { 'Set-Cookie': CLEAR_COOKIE });
    if (!verifyPw(u, String(attuale || ''))) return sendJson(res, 403, { ok: false, error: 'Password attuale errata' });
    const nuovaPw = String(nuova || '');
    if (nuovaPw.length < MIN_PW_LEN) return sendJson(res, 400, { ok: false, error: `La nuova password deve avere almeno ${MIN_PW_LEN} caratteri` });
    if (verifyPw(u, nuovaPw)) return sendJson(res, 400, { ok: false, error: 'La nuova password deve essere diversa da quella attuale' });
    u.salt = crypto.randomBytes(16).toString('hex');
    u.hash = hashPw(nuovaPw, u.salt);
    u.mustChange = false;
    // Nuova password = nuova versione di sessione: ogni cookie emesso prima
    // (incluso quello di un eventuale ladro) smette di valere. Il cookie
    // rilasciato qui sotto porta già la versione nuova: chi ha cambiato la
    // password resta collegato.
    u.sv = (u.sv || 1) + 1;
    saveUtenti(list);
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': makeSessionCookie(u, admForIp(clientIp(req))) });
  }

  // ---- Elenco app ----
  if (p === '/api/apps') {
    return sendJson(res, 200, {
      apps: APPS.filter(canSeeApp).map((a) => ({
        id: a.id, nome: a.nome, sottotitolo: a.sottotitolo, desc: a.desc,
        porta: a.porta, tipo: a.tipo, url: appUrl(req, a),
        adminOnly: !!a.adminOnly,   // la home le raggruppa in "Area riservata"
      })),
    });
  }

  // ---- Assistente della suite ----
  // Risponde solo sulle app che questo utente può vedere: per un non-admin le
  // app adminOnly non esistono nemmeno come risposta.
  if (p === '/api/chat' && req.method === 'POST') {
    const { domanda } = await readJsonBody(req);
    const q = String(domanda || '').slice(0, 500);   // domande lunghe: tagliate
    return sendJson(res, 200, rispondiAssistente(q, APPS.filter(canSeeApp)));
  }

  // ---- Stato app ----
  if (p === '/api/status') {
    const stati = await Promise.all(APPS.filter(canSeeApp).map(async (a) => ({ id: a.id, online: await checkPort(a.porta) })));
    return sendJson(res, 200, { apps: stati });
  }

  // ---- Stato di una singola app (poll rapido dopo l'avvio) ----
  if (p.startsWith('/api/status/')) {
    const app = APPS.find((a) => a.id === p.split('/').pop());
    if (!app || !canSeeApp(app)) return sendJson(res, 404, { ok: false, error: 'App sconosciuta' });
    return sendJson(res, 200, { id: app.id, online: await checkPort(app.porta) });
  }

  // ---- Avvia app (registra 'avvia') ----
  if (p.startsWith('/api/launch/') && req.method === 'POST') {
    const app = APPS.find((a) => a.id === p.split('/').pop());
    if (!app || !canSeeApp(app)) return sendJson(res, 404, { ok: false, error: 'App sconosciuta' });
    const r = launchApp(app);
    if (r.ok) {
      spenteAMano.delete(app.id);   // riavviata di proposito: il keep-alive può riprenderla
      logAccesso({
        ts: new Date().toISOString(), username: session.username, nome: session.nome,
        appId: app.id, appNome: app.nome, azione: 'avvia',
      });
    }
    return sendJson(res, r.ok ? 200 : 500, r);
  }

  // ---- Ferma app (solo admin del portale; registra 'ferma') ----
  // Un'app accesa tiene RAM anche quando non la usa nessuno: sul server centrale
  // con sei app calde la differenza si sente.
  if (p.startsWith('/api/stop/') && req.method === 'POST') {
    if (!adminPortale) return sendJson(res, 403, { ok: false, error: 'Riservato agli amministratori' });
    const app = APPS.find((a) => a.id === p.split('/').pop());
    if (!app || !canSeeApp(app)) return sendJson(res, 404, { ok: false, error: 'App sconosciuta' });
    const r = await stopApp(app);
    if (r.ok) {
      spenteAMano.add(app.id);
      logAccesso({
        ts: new Date().toISOString(), username: session.username, nome: session.nome,
        appId: app.id, appNome: app.nome, azione: 'ferma',
      });
    }
    return sendJson(res, r.ok ? 200 : 409, r);
  }

  // ---- Registra apertura di un'app ('apri') ----
  if (p === '/api/log-access' && req.method === 'POST') {
    const { appId } = await readJsonBody(req);
    const app = APPS.find((a) => a.id === appId);
    if (!app || !canSeeApp(app)) return sendJson(res, 404, { ok: false });
    logAccesso({
      ts: new Date().toISOString(), username: session.username, nome: session.nome,
      appId: app.id, appNome: app.nome, azione: 'apri',
    });
    return sendJson(res, 200, { ok: true });
  }

  // ================= area amministrazione =================
  const isAdmin = adminPortale;

  if (p === '/admin' || p === '/admin.html') {
    if (!isAdmin) { res.writeHead(302, { Location: '/' }); return res.end(); }
    return sendFile(res, path.join(PAGES_DIR, 'admin.html'), 'text/html');
  }

  // ---- Plancia degli admin: elenco utenti + attività di un utente ----
  if (p === '/api/plancia') {
    if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'Riservato agli amministratori' });
    return sendJson(res, 200, riepilogoUtenti(loadAccessi(), loadUtenti()));
  }
  if (p === '/api/attivita') {
    if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'Riservato agli amministratori' });
    const chi = String(new URL(req.url, 'http://x').searchParams.get('utente') || session.username).toLowerCase();
    if (!loadUtenti().some((u) => u.username === chi)) return sendJson(res, 404, { ok: false, error: 'Utente non trovato' });
    // L'admin vede già l'intero registro (/api/accessi): qui nessun filtro per app.
    return sendJson(res, 200, riepilogoAttivita(loadAccessi(), chi, () => true));
  }

  if (p === '/api/accessi') {
    if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'Riservato agli amministratori' });
    const list = loadAccessi().slice().reverse(); // più recenti prima
    return sendJson(res, 200, { accessi: list });
  }

  if (p === '/api/utenti') {
    if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'Riservato agli amministratori' });
    if (req.method === 'GET') {
      // Chi non ha un elenco suo vede il default: le caselle lo mostrano già
      // spuntato, così l'admin vede la situazione vera e non una riga vuota.
      const predefinite = appsPredefinite();
      const list = loadUtenti().map((u) => ({
        username: u.username, nome: u.nome, ruolo: u.ruolo, creato: u.creato,
        apps: Array.isArray(u.apps) ? u.apps : predefinite,
      }));
      // assegnabili: le app da proporre come caselle nella tabella utenti.
      return sendJson(res, 200, { utenti: list, assegnabili: appAssegnabili() });
    }
    if (req.method === 'POST') {
      const { username, nome, password, ruolo, apps } = await readJsonBody(req);
      const uname = String(username || '').toLowerCase().trim();
      if (!uname || !nome || !password) return sendJson(res, 400, { ok: false, error: 'Dati mancanti' });
      if (String(password).length < MIN_PW_LEN) return sendJson(res, 400, { ok: false, error: `La password deve avere almeno ${MIN_PW_LEN} caratteri` });
      const list = loadUtenti();
      if (list.some((u) => u.username === uname)) return sendJson(res, 409, { ok: false, error: 'Username già esistente' });
      // mustChange: il nuovo utente dovrà impostare una propria password al primo accesso.
      const nuovo = makeUser(uname, String(nome).trim(), String(password), ruolo === 'admin' ? 'admin' : 'utente', true);
      // apps assente = niente campo: quell'utente segue il default, e se un
      // domani il default cambia lo segue anche lui.
      if (Array.isArray(apps)) nuovo.apps = filtraApps(apps);
      list.push(nuovo);
      saveUtenti(list);
      return sendJson(res, 200, { ok: true });
    }
  }

  // ---- Import massivo utenti da foglio .xlsx / .csv ----
  // Il file arriva come base64 in JSON (niente parsing multipart). Ogni riga
  // valida diventa un utente con mustChange=true; le righe scartate sono
  // riportate con motivo. Password mancante → si usa quella predefinita.
  if (p === '/api/utenti/import' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'Riservato agli amministratori' });
    const { dataBase64, defaultPassword } = await readJsonBody(req, 12e6);
    let buf;
    try { buf = Buffer.from(String(dataBase64 || ''), 'base64'); } catch { buf = null; }
    if (!buf || !buf.length) return sendJson(res, 400, { ok: false, error: 'File mancante o vuoto' });
    let righe;
    try { righe = parseUsersSheet(buf); }
    catch (e) { return sendJson(res, 400, { ok: false, error: 'File non leggibile: ' + e.message }); }

    const defPw = String(defaultPassword || '').trim();
    const list = loadUtenti();
    const noti = new Set(list.map((u) => u.username));   // username già esistenti + già visti nel file
    const aggiunti = [];
    const scartati = [];
    for (const r of righe) {
      const uname = String(r.username || '').toLowerCase().trim();
      const nome = String(r.nome || '').trim();
      let pw = String(r.password || '').trim();
      if (!pw) pw = defPw;
      const ruolo = /^admin/i.test(String(r.ruolo || '').trim()) ? 'admin' : 'utente';
      if (!uname || !nome) { scartati.push({ riga: r.riga, username: uname, motivo: 'username o nome mancante' }); continue; }
      if (pw.length < MIN_PW_LEN) { scartati.push({ riga: r.riga, username: uname, motivo: `password assente o < ${MIN_PW_LEN} caratteri` }); continue; }
      if (noti.has(uname)) { scartati.push({ riga: r.riga, username: uname, motivo: 'username già esistente' }); continue; }
      list.push(makeUser(uname, nome, pw, ruolo, true));
      noti.add(uname);
      aggiunti.push(uname);
    }
    if (aggiunti.length) saveUtenti(list);
    return sendJson(res, 200, { ok: true, aggiunti: aggiunti.length, scartati });
  }

  // ---- Programmi visibili a un utente (solo admin) ----
  // L'elenco sostituisce il precedente: le caselle spuntate sono l'elenco.
  // Non tocca la sessione dell'utente: appsUtente() rilegge da disco, quindi
  // una revoca vale dalla richiesta successiva senza obbligarlo a rifare login.
  if (p.startsWith('/api/utenti/') && p.endsWith('/apps') && req.method === 'PUT') {
    if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'Riservato agli amministratori' });
    const uname = decodeURIComponent(p.slice('/api/utenti/'.length, -'/apps'.length));
    const { apps } = await readJsonBody(req);
    const list = loadUtenti();
    const u = list.find((x) => x.username === uname);
    if (!u) return sendJson(res, 404, { ok: false, error: 'Utente non trovato' });
    u.apps = filtraApps(apps);
    saveUtenti(list);
    logAccesso({
      ts: new Date().toISOString(), username: session.username, nome: session.nome,
      appId: 'portale', appNome: 'Portale (programmi utente)', azione: 'abilita',
      dettaglio: uname + ' -> ' + (u.apps.join(', ') || 'nessun programma'),
    });
    return sendJson(res, 200, { ok: true, apps: u.apps });
  }

  if (p.startsWith('/api/utenti/') && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { ok: false, error: 'Riservato agli amministratori' });
    const uname = decodeURIComponent(p.split('/').pop());
    if (uname === session.username) return sendJson(res, 400, { ok: false, error: 'Non puoi eliminare te stesso' });
    let list = loadUtenti();
    const before = list.length;
    list = list.filter((u) => u.username !== uname);
    if (list.length === before) return sendJson(res, 404, { ok: false, error: 'Utente non trovato' });
    saveUtenti(list);
    return sendJson(res, 200, { ok: true });
  }

  // ---- Portale (home) ----
  // Gli admin vedono la plancia (utenti e attività), gli altri la griglia delle app.
  if (p === '/' || p === '/index.html') {
    return sendFile(res, path.join(PAGES_DIR, isAdmin ? 'plancia.html' : 'index.html'), 'text/html');
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

// Non far cadere il processo per un errore non gestito: logga e prosegui.
server.on('error', (e) => logError('server', e));
process.on('uncaughtException', (e) => logError('uncaughtException', e));
process.on('unhandledRejection', (e) => logError('unhandledRejection', e));

// Avvio solo se eseguito direttamente (node server.js). Se importato come
// modulo (es. test), esporta i parser senza aprire porta né toccare i dati.
if (require.main === module) {
  ensureData();
  trimAccessi();   // limita la crescita del log a ogni avvio
  server.listen(PORT, HOST, () => {
    const addr = (TLS_ON ? 'https' : 'http') + '://localhost:' + PORT;
    console.log('============================================');
    console.log('  Portale Suite Cosedil attivo');
    console.log('  ' + addr + (HOST !== '127.0.0.1' ? '  (host ' + HOST + ')' : ''));
    if (TLS_ON) console.log('  [TLS] HTTPS attivo, cookie di sessione marcato Secure.');
    if (SUITE_DOMINIO) {
      // Il cookie e' emesso per il dominio: da http://localhost il browser lo
      // scarta e il login non regge. Si entra solo dall'indirizzo pubblico.
      console.log('  [DOMINIO] ' + PORTALE_PUBBLICO + '  (app su https://<cartella>.' + SUITE_DOMINIO + ')');
      console.log('            Accesso solo da questo indirizzo, dietro il reverse proxy.');
    }
    // In ascolto oltre il loopback e senza TLS: le password degli utenti
    // attraversano la rete in chiaro, e con loro il cookie di sessione. Chi ha
    // scelto questa configurazione deve almeno saperlo.
    if (!TLS_ON && !COOKIE_SECURE && HOST !== '127.0.0.1' && HOST !== 'localhost') {
      console.log('  --------------------------------------------');
      console.log('  [ATTENZIONE] Portale esposto in rete SENZA HTTPS: le password');
      console.log('               e i cookie di sessione viaggiano in chiaro sulla LAN.');
      console.log('               Metti un certificato (anche interno) e riavvia con:');
      console.log('                 set TLS_CERT=C:\\certs\\portale.crt');
      console.log('                 set TLS_KEY=C:\\certs\\portale.key');
      console.log('               Dietro un reverse proxy che termina TLS: COOKIE_SECURE=1.');
      console.log('  --------------------------------------------');
    }
    console.log('  Chiudi questa finestra per fermare il portale.');
    console.log('============================================');
    // Apre il browser solo se in ascolto in locale.
    if (HOST === '127.0.0.1' || HOST === 'localhost') {
      spawn('cmd.exe', ['/c', 'start', '', PORTALE_PUBBLICO || addr], { detached: true, stdio: 'ignore' }).unref();
    }
    // Avvio a caldo delle app configurate + keep-alive (le rimette su se cadono).
    if (getWarmList().length) {
      const warm = getWarmList().join(', ');
      console.log('  [WARM] Pre-avvio app: ' + warm);
      setTimeout(warmApps, 1500);
      setInterval(warmApps, 30_000).unref();
    }
  });
}

module.exports = {
  parseUsersSheet, xlsxToRows, csvToRows, rowsToUsers,
  ipMatches, admForIp, isAdminForApp, clientIp,   // admin per-IP / per-app (testabili)
  getWarmList,                                     // pre-warm (testabile)
  portalHostname, appUrl, isSuiteOrigin,           // URL/CORS in LAN
  loginKey, loginBlockedMs, noteLoginFail, clearLoginFails,   // freno al brute force
  parseNetstatPid,                                 // spegnimento app
  pathDalRegistro,                                 // PATH fresco per le app lanciate
  rispondiAssistente,                              // assistente
  accessoApp, appsUtente, appsPredefinite, appAssegnabili, filtraApps,   // programmi per utente
  riepilogoAttivita, riepilogoUtenti,              // plancia degli admin
  APPS, COOKIE_FLAGS, sottodominio,                 // indirizzi a sottodominio
};
