// "><(((º> sabusabu <º)))><"
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const { Client, LocalAuth } = require('whatsapp-web.js');
const L = require('./logica');
const cosedilSSO = require('../../shared/sso/cosedil-sso');
const { cosedilSocketIO } = cosedilSSO;

const PORT = 3000;
// Ascolto solo in locale salvo richiesta esplicita: questa app comanda la
// sessione WhatsApp aziendale, non deve trovarsi esposta in LAN per distrazione.
// In LAN ci arriva il portale, che passa il proprio HOST alle app che avvia.
const HOST = process.env.HOST || '127.0.0.1';

// Radice del file browser: si sceglie l'Excel solo qui dentro. Prima si poteva
// navigare l'intero disco del server (C:\Windows, cartelle di altri utenti...).
// Default: la home dell'utente che esegue l'app — dove sta già l'Excel dei
// compleanni (vedi DEFAULTS in logica.js). Altrove: AUGURI_ROOT=D:\Condivisa.
const BROWSE_ROOT = path.resolve(process.env.AUGURI_ROOT || os.homedir());

// Cartella log nella radice dell'app (creata se manca).
const LOG_DIR = path.join(L.ROOT, 'log');
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
// File che ricorda l'ultima data di invio, per non inviare due volte lo stesso giorno
const FILE_ULTIMO_INVIO = path.join(LOG_DIR, '.ultimo-invio');
// Allarmi: qui finisce solo cio' che qualcuno DEVE leggere (auguri non partiti).
// File separato dai log giornalieri perche' quelli vengono ruotati via.
const FILE_ALLARMI = path.join(LOG_DIR, 'allarmi.log');
// Giorni di log giornalieri da conservare. Senza rotazione la cartella cresce
// per sempre: ad agosto 2026 un singolo giorno ha superato 1 MB.
const GIORNI_LOG = 30;
// Quanti giorni avanti mostrare in pagina ("Prossimi compleanni").
const GIORNI_PROSSIMI = 14;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Gate SSO: l'app è riservata agli amministratori del portale (nel registro del
// portale è adminOnly, ma quel flag nasconde solo la card: la porta va chiusa
// qui). Prima di ogni altra cosa, static compreso.
app.use(cosedilSSO({ app: 'auguri', adminOnly: true }));
// I websocket non passano dal middleware HTTP: senza questo gate chiunque
// aprisse un socket comanderebbe l'invio dei messaggi senza aver fatto login.
io.use(cosedilSocketIO({ app: 'auguri', adminOnly: true }));

app.use(express.static(path.join(L.ROOT, 'public')));

// ---------- Stato globale ----------
let stato = {
    connessione: 'avvio',      // avvio | qr | caricamento | connesso | errore | disconnesso
    qrDataUrl: null,
    qrRaw: null,
    caricamento: 0,
    dati: null,                // { persone, frasiSingole, frasiGruppo }
    festeggiati: [],
    prossimi: [],              // [{ nome, data, tra }] compleanni dei prossimi GIORNI_PROSSIMI giorni
    anteprima: null,
    gruppoTrovato: null,
    excelOk: false,            // true se l'Excel è stato letto correttamente
    excelErrore: null,         // messaggio errore lettura Excel (file mancante/sbagliato)
    ultimoInvio: null,         // data ISO dell'ultimo invio automatico riuscito
    allarme: null              // { quando, msg, tipo } dell'ultimo allarme: rosso in pagina
};

// ---------- File browser lato server (per scegliere il file Excel dall'interfaccia) ----------
// Vero se `p` è BROWSE_ROOT o sta dentro. Confronto sui path risolti, col
// separatore in coda: senza, "C:\Users\aless-altro" passerebbe per "C:\Users\aless".
function dentroRadice(p) {
    const r = path.resolve(p);
    return r === BROWSE_ROOT || r.startsWith(BROWSE_ROOT + path.sep);
}

// GET /api/browse?dir=<percorso> → cartelle + file .xlsx della cartella.
// Solo dentro BROWSE_ROOT: fuori risponde 403 e non rivela se il path esista.
app.get('/api/browse', (req, res) => {
    try {
        const richiesta = req.query.dir && String(req.query.dir).trim();
        const dir = richiesta ? path.resolve(richiesta) : BROWSE_ROOT;
        if (!dentroRadice(dir)) {
            return res.status(403).json({ error: 'Cartella fuori dall\'area consentita' });
        }
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        const dirs = entries
            .filter(e => e.isDirectory() && !e.name.startsWith('.'))
            .map(e => ({ name: e.name, path: path.join(dir, e.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const files = entries
            .filter(e => e.isFile() && /\.xlsx$/i.test(e.name))
            .map(e => ({ name: e.name, path: path.join(dir, e.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));
        const parent = path.dirname(dir);
        res.json({
            cwd: dir,
            // Alla radice il pulsante "su" si disattiva da solo: niente risalita.
            parent: (parent === dir || !dentroRadice(parent)) ? null : parent,
            dirs, files,
            unita: [],          // niente lettere di unità: si resta dentro la radice
            home: BROWSE_ROOT
        });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

// File di log del giorno: l'app parte spesso via VBS senza console (avvio
// automatico), quindi senza questo un guasto non lascia alcuna traccia.
function fileLogOggi() {
    return path.join(LOG_DIR, `auguri-${oggiISO()}.log`);
}

const logBuffer = [];
function log(msg, tipo = 'info') {
    const riga = { ts: new Date().toLocaleTimeString('it-IT'), msg, tipo };
    logBuffer.push(riga);
    if (logBuffer.length > 200) logBuffer.shift();
    io.emit('log', riga);
    console.log(`[${riga.ts}] ${msg}`);
    try { fs.appendFileSync(fileLogOggi(), `[${riga.ts}] [${tipo}] ${msg}\n`, 'utf8'); }
    catch { /* log su file best effort: non deve mai fermare l'app */ }
}

function pushStato() {
    io.emit('stato', stato);
}

// Cancella i log giornalieri piu' vecchi di GIORNI_LOG. Nessuno li leggeva e
// nessuno li cancellava: restavano li' per sempre. allarmi.log non si tocca.
function ruotaLog() {
    const limite = Date.now() - GIORNI_LOG * 86_400_000;
    let tolti = 0;
    try {
        for (const nome of fs.readdirSync(LOG_DIR)) {
            if (!/^auguri-\d{4}-\d{2}-\d{2}\.log$/.test(nome)) continue;
            const f = path.join(LOG_DIR, nome);
            try {
                if (fs.statSync(f).mtimeMs < limite) { fs.unlinkSync(f); tolti++; }
            } catch { /* file sparito o in uso: si ritenta al prossimo giro */ }
        }
    } catch { /* cartella illeggibile: la rotazione non e' critica */ }
    if (tolti) log(`Rotazione log: rimossi ${tolti} file piu' vecchi di ${GIORNI_LOG} giorni.`, 'info');
}

// Gli auguri non sono partiti e, girando l'app senza sorveglianza, nessuno se ne
// accorgerebbe fino alla lamentela del festeggiato (dall'11 al 17 agosto 2026 e'
// successo per sette giorni di fila). Tre canali: riga in allarmi.log che resta,
// stato rosso in pagina, messaggio WhatsApp a se stessi — l'unico che ti trova
// anche lontano dal PC.
// `tipo`: 'invio' (auguri non partiti) o 'scollegato' (WhatsApp giu' da ore,
// vedi controllaScollegamento). Il banner di un invio mancato vale di piu':
// un allarme di scollegamento non lo copre, finisce solo nel file.
async function segnalaAllarme(msg, tipo = 'invio') {
    log(msg, 'errore');
    const quando = new Date().toLocaleString('it-IT');
    if (!(tipo === 'scollegato' && stato.allarme && stato.allarme.tipo === 'invio')) {
        stato.allarme = { quando, msg, tipo };
    }
    pushStato();
    try { fs.appendFileSync(FILE_ALLARMI, `[${quando}] ${msg}
`, 'utf8'); }
    catch { /* best effort: un allarme non deve mai fermare l'app */ }
    await avvisaSuWhatsApp(`[Auguri Cosedil] ${msg}`);
}

// Messaggio di servizio alla chat "Messaggi con te stesso" del numero collegato.
// Se WhatsApp non e' connesso non si puo' fare nulla: e' proprio uno dei casi in
// cui l'allarme scatta, quindi il fallimento qui e' previsto e non si rilancia.
async function avvisaSuWhatsApp(testo) {
    try {
        if (!client || stato.connessione !== 'connesso') return false;
        const mioNumero = client.info && client.info.wid && client.info.wid._serialized;
        if (!mioNumero) return false;
        await client.sendMessage(mioNumero, testo);
        return true;
    } catch (e) {
        log(`Avviso WhatsApp non inviato: ${e.message}`, 'info');
        return false;
    }
}

// ---------- Caricamento dati Excel + calcolo compleanni ----------
async function ricaricaDati(silenzioso = false) {
    try {
        stato.dati = await L.leggiDati();
        stato.festeggiati = stato.dati.persone
            .filter(p => L.eCompleannoOggi(p.dataNascita))
            .map(p => ({ nome: L.nomeCompleto(p), data: L.formattaData(p.dataNascita) }));
        stato.prossimi = L.prossimiCompleanni(stato.dati.persone, GIORNI_PROSSIMI);

        // costruisci anteprima messaggio
        const festObj = stato.dati.persone.filter(p => L.eCompleannoOggi(p.dataNascita));
        if (festObj.length > 0) {
            const usaGruppo = festObj.length > 1;
            const frase = L.fraseCasuale(usaGruppo ? stato.dati.frasiGruppo : stato.dati.frasiSingole);
            stato.anteprima = L.costruisciMessaggio(festObj, frase);
        } else {
            stato.anteprima = null;
        }

        stato.excelOk = true;
        stato.excelErrore = null;
        if (!silenzioso) {
            log(`Dati caricati: ${stato.dati.persone.length} persone, ${stato.dati.frasiSingole.length} frasi singole, ${stato.dati.frasiGruppo.length} frasi gruppo`, 'ok');
            log(`Compleanni oggi: ${stato.festeggiati.length}`, stato.festeggiati.length ? 'ok' : 'info');
        }
        pushStato();
    } catch (err) {
        stato.excelOk = false;
        stato.excelErrore = err.message;
        stato.dati = null;
        stato.festeggiati = [];
        stato.prossimi = [];
        stato.anteprima = null;
        log(`Errore lettura Excel: ${err.message}`, 'errore');
        pushStato();
    }
}

// ---------- WhatsApp client ----------
const attendi = (ms) => new Promise((res) => setTimeout(res, ms));

// Cancella una cartella ritentando: su Windows i file di Chromium restano
// bloccati per qualche secondo dopo la chiusura del processo. Non lancia mai:
// il chiamante decide cosa fare del fallimento.
async function rimuoviConRitenti(dir, tentativi = 12, pausa = 500) {
    for (let i = 1; i <= tentativi; i++) {
        try {
            await fs.promises.rm(dir, { recursive: true, force: true });
            return true;
        } catch (e) {
            if (i === tentativi) {
                log(`Cartella sessione ancora bloccata (${e.code || e.message}): la ripulisco al prossimo avvio.`, 'errore');
                return false;
            }
            await attendi(pausa);
        }
    }
}

// Chiude Chromium e aspetta che molli i file (finche' il processo vive, Windows
// li tiene aperti). Max 5s, poi si prosegue comunque.
async function chiudiBrowser() {
    const browser = client && client.pupBrowser;
    if (!browser) return;
    try { await browser.close(); } catch { /* gia' morto */ }
    for (let i = 0; i < 50 && browser.isConnected(); i++) await attendi(100);
}

// Sessione rimasta da cancellare: ritentata al prossimo avvio del motore, quando
// Chromium e' sicuramente spento.
let sessioneDaPulire = null;

// ---------- Chromium zombie (pulizia automatica) ----------
// Se node muore di colpo — taskkill /F, PC spento, guardiano che riavvia, crash —
// Chromium NON riceve niente e resta vivo: continua a tenere aperti i file del
// profilo. Al riavvio l'app trova il profilo bloccato (Chromium rifiuta di
// riaprirlo, oppure la cancellazione va in EBUSY) e resta a girare a vuoto.
// Nessuno lo pulisce da fuori, quindi lo fa l'app da sola prima di ogni avvio
// del motore. Il filtro e' sulla riga di comando (--user-data-dir): solo i
// Chromium avviati su QUESTA cartella profilo. Il Chrome personale dell'utente e
// le altre app della suite non vengono mai toccati.
const CARTELLA_SESSIONE = path.join(L.ROOT, '.wwebjs_auth', 'session');

// PowerShell con i dati passati per variabile d'ambiente: nel percorso c'e'
// l'apostrofo di "whatss'app", e dentro uno script quotato spaccherebbe tutto.
function powershell(script, env) {
    return new Promise((resolve) => {
        execFile('powershell.exe',
            ['-NoProfile', '-NonInteractive', '-Command', script],
            { timeout: 15_000, windowsHide: true, env: { ...process.env, ...env } },
            (err, stdout) => resolve(String(stdout || '')));
    });
}

// PID dei Chromium che stanno usando la cartella profilo di questa app.
async function pidChromiumSulProfilo() {
    if (process.platform !== 'win32') return [];
    const out = await powershell(
        'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\'"'
        + ' | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:PROFILO) }'
        + ' | ForEach-Object { $_.ProcessId }',
        { PROFILO: CARTELLA_SESSIONE });
    return out.split(/\r?\n/).map((r) => parseInt(r.trim(), 10)).filter((n) => Number.isInteger(n));
}

// Chiude i Chromium rimasti da un'esecuzione precedente. Se il motore di QUESTA
// istanza e' vivo non si tocca nulla: i suoi processi figli (renderer, gpu, rete)
// stanno sullo stesso profilo e li uccideremmo insieme agli zombie.
async function uccidiChromiumZombie() {
    if (client && client.pupBrowser && client.pupBrowser.isConnected()) return 0;
    const zombie = (await pidChromiumSulProfilo()).filter((pid) => pid !== process.pid);
    if (!zombie.length) return 0;
    log(`Trovati ${zombie.length} processi Chromium rimasti da prima: li chiudo.`, 'info');
    await powershell('$env:PID_ZOMBIE.Split(",") | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }',
        { PID_ZOMBIE: zombie.join(',') });
    await attendi(1_000);
    const restati = await pidChromiumSulProfilo();
    if (restati.length) {
        log(`${restati.length} processi Chromium non si sono chiusi (PID ${restati.join(', ')}): profilo forse ancora bloccato.`, 'errore');
    }
    return zombie.length;
}

// Lock del profilo lasciati indietro da un Chromium morto male: se restano
// stantii, Chromium rifiuta di riaprire il profilo ("in uso"). Li ricrea da solo
// al prossimo avvio, quindi cancellarli e' sicuro — ma solo a browser spento.
const LOCK_PROFILO = ['lockfile', 'SingletonLock', 'SingletonCookie', 'SingletonSocket', 'DevToolsActivePort'];

// Rimuove i lock solo se nessuno sta usando il profilo: se un Chromium e' vivo
// li' dentro, togliergli il lock sarebbe noi a rompere lui.
async function sbloccaProfiloSeLibero() {
    if (client && client.pupBrowser && client.pupBrowser.isConnected()) return;
    if ((await pidChromiumSulProfilo()).length) return;
    const presenti = LOCK_PROFILO.filter((n) => fs.existsSync(path.join(CARTELLA_SESSIONE, n)));
    if (!presenti.length) return;
    log(`Lock del profilo rimasti dall'esecuzione precedente (${presenti.join(', ')}): li rimuovo.`, 'info');
    for (const nome of presenti) {
        try {
            await fs.promises.rm(path.join(CARTELLA_SESSIONE, nome), { force: true, recursive: true });
        } catch (e) {
            log(`Lock "${nome}" non rimosso (${e.code || e.message}): Chromium potrebbe rifiutare il profilo.`, 'errore');
        }
    }
}

// LocalAuth di whatsapp-web.js, al logout, fa rm -rf della cartella sessione
// MENTRE Chromium e' ancora vivo (Client.js, handler 'framenavigated'). Su
// Windows i file aperti sono bloccati: la rm rigetta con EBUSY su lockfile /
// first_party_sets.db / *.db-journal, l'errore finisce in unhandledRejection e
// la sessione resta cancellata a metà -> al riavvio non autentica piu' e il QR
// ricompare in loop. Inoltre 'framenavigated' scatta per ogni frame, quindi il
// logout arriva 5-6 volte di fila e altrettante rm si pestano i piedi.
// Qui: una sola cancellazione per volta, browser chiuso prima, ritenti dopo.
class LocalAuthWindows extends LocalAuth {
    constructor(opts) {
        super(opts);
        this.logoutInCorso = null;
    }

    async logout() {
        if (this.logoutInCorso) return this.logoutInCorso;   // eventi ripetuti: una sola volta
        this.logoutInCorso = this._logoutSicuro()
            .finally(() => { this.logoutInCorso = null; });
        return this.logoutInCorso;
    }

    async _logoutSicuro() {
        if (!this.userDataDir) return;
        const dir = this.userDataDir;
        log('Logout WhatsApp: chiudo Chromium e cancello la sessione.', 'info');
        await chiudiBrowser();
        sessioneDaPulire = (await rimuoviConRitenti(dir)) ? null : dir;
    }
}

// Istanza corrente del motore WhatsApp: nasce al primo avviaClient() e viene
// RICREATA a ogni riavvio. whatsapp-web.js non garantisce che initialize()
// riparta sullo stesso Client dopo destroy(): riusare l'istanza lascia il motore
// scollegato in silenzio (dall'11 al 17 agosto 2026 e' andata cosi' per giorni).
// Finche' e' null non c'e' motore: chi la usa deve controllarlo.
let client = null;

function creaClient() {
    const c = new Client({
        // authStrategy nuova insieme al client: tiene il riferimento all'istanza
        // e lo stato del logout in corso, riusarla incrocerebbe vecchio e nuovo.
        authStrategy: new LocalAuthWindows({ dataPath: path.join(L.ROOT, '.wwebjs_auth') }),
        puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
    });
    registraEventi(c);
    return c;
}

// Elenco gruppi letto DIRETTAMENTE dalla pagina di WhatsApp Web: solo nome e id.
//
// Niente client.getChats(): quel metodo passa da WWebJS.getChatModel(), che sulle
// versioni recenti di WhatsApp Web trova chat.lastReceivedKey._serialized ===
// undefined e chiama Msg.getMessagesById([undefined]) -> IndexedDB DataError
// ("No key or key range specified"). Fallisce su OGNI chat, quindi getChats()
// rigetta sempre: il gruppo non veniva mai trovato e l'invio moriva prima di
// partire. Qui serializziamo a mano i due campi che servono, e non si rompe.
async function elencaGruppi() {
    return client.pupPage.evaluate(() => {
        return window.require('WAWebCollections').Chat.getModelsArray()
            .filter(c => c.groupMetadata && c.id && c.id._serialized)
            .map(c => ({ id: c.id._serialized, nome: String(c.formattedTitle || c.name || '') }));
    });
}

// Gruppo destinazione tra quelli disponibili (confronto sul nome, case/spazi ignorati).
async function trovaGruppo() {
    const gruppi = await elencaGruppi();
    const cercato = L.CONFIG.GRUPPO_DESTINAZIONE.toLowerCase().trim();
    return { gruppi, target: gruppi.find(g => g.nome.toLowerCase().trim() === cercato) || null };
}

// Cerca il gruppo destinazione tra le chat e aggiorna lo stato (riusabile dopo cambio config).
async function aggiornaGruppoTrovato() {
    if (stato.connessione !== 'connesso') return;
    try {
        const { gruppi, target } = await trovaGruppo();
        stato.gruppoTrovato = target ? target.nome : null;
        if (target) {
            log(`Gruppo destinazione trovato: "${target.nome}"`, 'ok');
        } else {
            log(`Gruppo "${L.CONFIG.GRUPPO_DESTINAZIONE}" NON trovato tra i ${gruppi.length} gruppi.`, 'errore');
        }
    } catch (e) {
        log(`Errore lettura gruppi: ${e.message}`, 'errore');
    }
    pushStato();
}

// ---------- Sorveglianza dello scollegamento ----------
// Da meta' settembre 2026 la sessione e' rimasta scollegata per oltre tre
// settimane (QR in attesa, ~2450 righe "QR generato" al giorno) e nessuno se
// n'e' accorto: l'allarme scattava solo nei giorni con un compleanno. Ora,
// dopo ORE_ALLARME_SCOLLEGATO ore senza connessione, allarme una volta al giorno.
const ORE_ALLARME_SCOLLEGATO = 6;
let scollegatoDa = null;           // ms dal primo evento "non connesso", null se connesso
let allarmeScollegatoIl = null;    // giorno ISO dell'ultimo allarme di scollegamento

function segnaScollegato() {
    if (!scollegatoDa) scollegatoDa = Date.now();
}

async function controllaScollegamento() {
    if (!scollegatoDa || stato.connessione === 'connesso') return;
    const ore = (Date.now() - scollegatoDa) / 3_600_000;
    if (ore < ORE_ALLARME_SCOLLEGATO || allarmeScollegatoIl === oggiISO()) return;
    allarmeScollegatoIl = oggiISO();
    const serve = stato.connessione === 'qr' ? 'apri la pagina e scansiona il QR' : 'controlla il PC e la rete';
    await segnalaAllarme(`WhatsApp scollegato da ${Math.floor(ore)} ore (stato: ${stato.connessione}): ${serve}, altrimenti gli auguri non partono.`, 'scollegato');
}

// Il QR si rinnova ogni ~30 s: loggarlo ogni volta ha prodotto 2450 righe al
// giorno. Si annota il primo e poi un promemoria all'ora.
let ultimoLogQr = 0;

// Eventi agganciati all'istanza `c`, non alla variabile `client`: dopo un
// riavvio la vecchia istanza puo' ancora emettere (Chromium che si smonta,
// 'disconnected' in ritardo). `c !== client` = istanza superata, si ignora,
// altrimenti un motore morto riscriverebbe lo stato di quello vivo.
function registraEventi(c) {
    const superata = () => c !== client;

    c.on('qr', async (qr) => {
        if (superata()) return;
        stato.connessione = 'qr';
        segnaScollegato();
        stato.qrRaw = qr;
        try {
            stato.qrDataUrl = await QRCode.toDataURL(qr, { width: 300, margin: 2 });
        } catch (e) {
            stato.qrDataUrl = null;
            log(`Impossibile creare l'immagine QR: ${e.message}`, 'errore');
        }
        if (Date.now() - ultimoLogQr >= 3_600_000) {
            const da = scollegatoDa ? Math.round((Date.now() - scollegatoDa) / 60_000) : 0;
            log(`QR generato${da >= 60 ? ` (in attesa da ${Math.floor(da / 60)} h)` : ''}. Scansiona con WhatsApp (Impostazioni → Dispositivi collegati).`, 'info');
            ultimoLogQr = Date.now();
        }
        pushStato();
    });

    c.on('loading_screen', (percent) => {
        if (superata()) return;
        stato.connessione = 'caricamento';
        stato.caricamento = parseInt(percent) || 0;
        pushStato();
    });

    c.on('authenticated', () => {
        if (superata()) return;
        stato.qrDataUrl = null;
        stato.qrRaw = null;
        ultimoLogQr = 0;                 // un prossimo QR va annotato subito
        log('Autenticato! Sessione salvata.', 'ok');
        pushStato();
    });

    c.on('ready', async () => {
        if (superata()) return;
        stato.connessione = 'connesso';
        stato.qrDataUrl = null;
        stato.qrRaw = null;
        tentativiAvvio = 0;              // connessione riuscita: backoff azzerato
        if (scollegatoDa && Date.now() - scollegatoDa >= 3_600_000) {
            log(`WhatsApp connesso dopo ${Math.floor((Date.now() - scollegatoDa) / 3_600_000)} h di scollegamento.`, 'ok');
        }
        scollegatoDa = null;
        ultimoLogQr = 0;
        if (stato.allarme && stato.allarme.tipo === 'scollegato') stato.allarme = null;
        log('WhatsApp connesso!', 'ok');

        await aggiornaGruppoTrovato();

        // Catch-up: se il PC si e' acceso dopo l'orario di invio e oggi non e' ancora partito nulla
        if (oraInvioPassata() && !giaInviatoOggi()) {
            log('PC acceso dopo l\'orario di invio: controllo recupero auguri di oggi.', 'info');
            eseguiInvioAutomatico();
        }
    });

    c.on('auth_failure', () => {
        if (superata()) return;
        stato.connessione = 'errore';
        segnaScollegato();
        log('Autenticazione fallita: serve una nuova scansione del QR. Riavvio il motore.', 'errore');
        pushStato();
        riavviaClient(15_000);           // re-init: WhatsApp ripropone il QR
    });

    c.on('disconnected', (reason) => {
        if (superata()) return;
        // Un solo logout genera piu' eventi (uno per frame navigato): se il riavvio
        // e' gia' in coda non serve rilogarlo ne' riprogrammarlo.
        if (riavvioProgrammato) return;
        stato.connessione = 'disconnesso';
        segnaScollegato();
        log(`Disconnesso: ${reason}. Riavvio il motore WhatsApp.`, 'errore');
        pushStato();
        riavviaClient(15_000);
    });
}

// ---------- Resilienza: il programma non si deve fermare mai ----------
// Gira senza sorveglianza (attivita' pianificata, console nascosta): se morisse
// per un errore, ce ne accorgeremmo solo il giorno in cui gli auguri non arrivano.
// Quindi: nessun errore fa uscire il processo, e il motore WhatsApp si riavvia
// da solo con backoff. Il guardiano di Windows copre il caso estremo (processo
// ucciso dall'esterno o PC riavviato) — vedi guardiano.vbs.
let tentativiAvvio = 0;
let riavvioProgrammato = null;

async function avviaClient() {
    riavvioProgrammato = null;
    // Prima di toccare il profilo: via i Chromium rimasti da prima, sono loro che
    // tengono bloccati i file.
    await uccidiChromiumZombie();
    // Resti di una sessione che al logout non si era riuscito a cancellare: ora
    // Chromium e' spento, i file non sono piu' bloccati.
    if (sessioneDaPulire) {
        if (await rimuoviConRitenti(sessioneDaPulire, 6, 300)) sessioneDaPulire = null;
    }
    await sbloccaProfiloSeLibero();
    // Istanza nuova: vedi il commento su `let client`. La vecchia, se c'era, e'
    // gia' stata distrutta da riavviaClient() e i suoi eventi sono neutralizzati
    // dalla guardia `superata()`.
    const c = creaClient();
    client = c;
    // Il motore che non arriva mai a 'ready' (Chromium appeso, rete giu')
    // conta come scollegato fin dall'avvio.
    if (stato.connessione !== 'connesso') segnaScollegato();
    log('Avvio motore WhatsApp...', 'info');
    c.initialize().catch((e) => {
        if (c !== client) return;        // istanza gia' sostituita: non e' affar suo
        stato.connessione = 'errore';
        log(`Errore avvio Chromium: ${e.message}`, 'errore');
        pushStato();
        riavviaClient();
    });
}

// Ritenta l'avvio del client: attesa raddoppiata a ogni tentativo, max 5 minuti.
function riavviaClient(attesaMin = 15_000) {
    if (riavvioProgrammato) return;            // un solo riavvio in coda
    const attesa = Math.min(5 * 60_000, attesaMin * 2 ** Math.min(tentativiAvvio++, 5));
    log(`Nuovo tentativo di connessione tra ${Math.round(attesa / 1000)}s.`, 'info');
    riavvioProgrammato = setTimeout(async () => {
        try { if (client) await client.destroy(); } catch { /* gia' morto: si prosegue */ }
        await avviaClient();
    }, attesa);
}

process.on('uncaughtException', (e) => {
    log(`Errore non gestito (proseguo): ${e && e.message}`, 'errore');
});
// Rumore di smontaggio di Chromium: quando il browser si chiude (logout,
// riavvio motore) whatsapp-web.js ha operazioni in volo che rigettano da sole.
// Non sono guasti: si annotano come info, cosi' nel log restano visibili solo
// gli errori veri.
const RUMORE_CHROMIUM = /Target closed|Session closed|Protocol error|Execution context was destroyed|detached Frame|EBUSY|ERR_ABORTED/i;

// ---------- Chiusura ordinata ----------
// L'altra meta' del problema zombie: se ce ne andiamo senza chiudere Chromium,
// i suoi processi restano vivi sul profilo. Su segnale (Ctrl+C, stop del
// portale, logoff di Windows) si spegne prima il browser. Con taskkill /F non
// arriva nessun segnale: quel caso lo copre la pulizia all'avvio.
let inChiusura = false;

async function chiusuraPulita(motivo) {
    if (inChiusura) return;
    inChiusura = true;
    log(`Chiusura richiesta (${motivo}): spengo il motore WhatsApp.`, 'info');
    // Se destroy() si impunta non restiamo appesi: dopo 8s si chiude comunque.
    if (client) await Promise.race([client.destroy().catch(() => {}), attendi(8_000)]);
    uccidiBrowserSubito();
    process.exit(0);
}

// Chiusura sincrona del processo Chromium: ultima spiaggia, usabile anche da
// 'exit' dove non si puo' aspettare nulla.
function uccidiBrowserSubito() {
    try {
        const proc = client && client.pupBrowser && client.pupBrowser.process();
        if (proc && !proc.killed) proc.kill();
    } catch { /* niente browser o gia' morto */ }
}

for (const segnale of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
    process.on(segnale, () => { chiusuraPulita(segnale); });
}
process.on('exit', uccidiBrowserSubito);

process.on('unhandledRejection', (e) => {
    const msg = (e && e.message) || String(e);
    if (RUMORE_CHROMIUM.test(msg)) {
        log(`Chromium in chiusura, operazione annullata (ignoro): ${msg}`, 'info');
        return;
    }
    log(`Promise non gestita (proseguo): ${msg}`, 'errore');
});

// ---------- Invio auguri ----------
async function inviaAuguri() {
    if (stato.connessione !== 'connesso') {
        log('Impossibile inviare: WhatsApp non connesso.', 'errore');
        return { ok: false, msg: 'WhatsApp non connesso' };
    }
    const festObj = stato.dati ? stato.dati.persone.filter(p => L.eCompleannoOggi(p.dataNascita)) : [];
    if (festObj.length === 0) {
        log('Nessun compleanno oggi, niente da inviare.', 'info');
        return { ok: false, msg: 'Nessun compleanno oggi' };
    }

    try {
        const { target } = await trovaGruppo();
        if (!target) {
            log(`Gruppo "${L.CONFIG.GRUPPO_DESTINAZIONE}" non trovato.`, 'errore');
            return { ok: false, msg: 'Gruppo non trovato' };
        }
        const messaggio = stato.anteprima || L.costruisciMessaggio(
            festObj, L.fraseCasuale(festObj.length > 1 ? stato.dati.frasiGruppo : stato.dati.frasiSingole)
        );
        // client.sendMessage(id, ...) passa da getChat({getAsModel:false}): non
        // costruisce il modello di chat, quindi evita il crash IndexedDB visto sopra.
        await client.sendMessage(target.id, messaggio);
        log(`[OK] Auguri inviati a "${target.nome}" per: ${L.unisciNomi(festObj)}`, 'ok');
        return { ok: true, msg: 'Inviato!' };
    } catch (err) {
        log(`Invio fallito: ${err.message}`, 'errore');
        return { ok: false, msg: err.message };
    }
}

// ---------- Invio automatico giornaliero ----------
function oggiISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function leggiUltimoInvio() {
    try { return fs.readFileSync(FILE_ULTIMO_INVIO, 'utf8').trim() || null; }
    catch { return null; }
}
function giaInviatoOggi() {
    return leggiUltimoInvio() === oggiISO();
}
function segnaInviatoOggi() {
    try {
        fs.writeFileSync(FILE_ULTIMO_INVIO, oggiISO(), 'utf8');
        stato.ultimoInvio = oggiISO();
        stato.allarme = null;            // e' partito: l'allarme non ha piu' senso
        pushStato();
    }
    catch (e) { log(`Impossibile salvare data invio: ${e.message}`, 'errore'); }
}
// ms da ora fino al prossimo orario invio (oggi se non ancora passato, altrimenti domani)
function msFinoAInvio() {
    const [h, m] = L.CONFIG.ORARIO_INVIO.split(':').map(Number);
    const ora = new Date();
    const target = new Date(ora);
    target.setHours(h, m, 0, 0);
    if (target <= ora) target.setDate(target.getDate() + 1);
    return target - ora;
}
function oraInvioPassata() {
    const [h, m] = L.CONFIG.ORARIO_INVIO.split(':').map(Number);
    const o = new Date();
    return o.getHours() > h || (o.getHours() === h && o.getMinutes() >= m);
}

// Un solo tentativo per volta e UNA SOLA catena di ritenti in tutto il processo.
// Prima ogni ritardo faceva `setTimeout(eseguiInvioAutomatico, ...)` senza tetto
// ne' guardia sul giorno: se WhatsApp non si collegava la catena non finiva mai,
// e il tick delle 09:00 del giorno dopo ne accendeva un'altra sopra. Dall'11 al
// 17 agosto 2026 sono arrivate a sei in parallelo (5157 ritenti, 1,1 MB di log
// in un giorno) e gli auguri non sono comunque mai partiti: nessuno se n'e'
// accorto per una settimana.
let invioInCorso = false;
let retryTimer = null;
// Il giorno in cui si e' rinunciato: dopo l'allarme non si riparte da soli, o il
// ricontrollo periodico rianimerebbe la catena e riallarmerebbe all'infinito.
let rinunciatoIl = null;
const MAX_RITENTI_CONNESSIONE = 60;   // 60 x 2 min = 2 ore per collegarsi
const MAX_RITENTI_INVIO = 24;         // 24 x 5 min = 2 ore di invii ritentati
const MAX_RITENTI_EXCEL = 24;         // 24 x 5 min = 2 ore per tornare a leggere l'Excel

function annullaRitenti() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
}

// Un timer solo, che rimpiazza sempre il precedente: le catene non si sommano.
// Il giorno e' inchiodato alla partenza — a mezzanotte cambia il festeggiato,
// quindi un ritento nato ieri non deve piu' partire.
function programmaRitento(giorno, conteggio, attesa, silenzioso) {
    annullaRitenti();
    retryTimer = setTimeout(() => {
        retryTimer = null;
        if (oggiISO() !== giorno) return;
        eseguiInvioAutomatico(conteggio, silenzioso);
    }, attesa);
}

// `silenzioso`: giro di controllo di routine (il ricontrollo periodico). Tace la
// rilettura dell'Excel e il "niente da fare", non i tentativi di invio.
async function eseguiInvioAutomatico(conteggio = { conn: 0, invio: 0, excel: 0 }, silenzioso = false) {
    if (invioInCorso) return;
    invioInCorso = true;
    const giorno = oggiISO();
    const primoGiro = conteggio.conn === 0 && conteggio.invio === 0 && !conteggio.excel;
    try {
        await ricaricaDati(silenzioso);
        // Excel illeggibile (file spostato, cartella di rete giu', foglio
        // rinominato): festeggiati resta vuoto e prima finiva come "nessun
        // compleanno oggi", cioe' auguri saltati senza che nessuno lo sapesse.
        if (!stato.excelOk) {
            const n = conteggio.excel || 0;
            if (n >= MAX_RITENTI_EXCEL) {
                rinunciatoIl = giorno;
                annullaRitenti();
                await segnalaAllarme(`AUGURI FORSE NON INVIATI (${giorno}): Excel illeggibile da 2 ore (${stato.excelErrore}).`);
                return;
            }
            if (n % 6 === 0) {
                log(`Invio automatico: Excel non leggibile, ritento tra 5 minuti (${n + 1}/${MAX_RITENTI_EXCEL}).`, 'errore');
            }
            programmaRitento(giorno, { ...conteggio, excel: n + 1 }, 5 * 60 * 1000, silenzioso);
            return;
        }
        if (stato.festeggiati.length === 0) {
            if (primoGiro && !silenzioso) log('Invio automatico: nessun compleanno oggi.', 'info');
            annullaRitenti();
            return;
        }
        if (giaInviatoOggi()) {
            if (primoGiro && !silenzioso) log('Invio automatico: auguri gia inviati oggi, salto.', 'info');
            annullaRitenti();
            return;
        }
        const nomi = stato.festeggiati.map((f) => f.nome).join(', ');

        if (stato.connessione !== 'connesso') {
            if (conteggio.conn >= MAX_RITENTI_CONNESSIONE) {
                rinunciatoIl = giorno;
                annullaRitenti();
                await segnalaAllarme(`AUGURI NON INVIATI (${giorno}) a ${nomi}: WhatsApp non si e' collegato in 2 ore.`);
                return;
            }
            // Una riga ogni mezz'ora, non ogni due minuti: e' il log-spam che ad
            // agosto ha prodotto file da 1 MB.
            if (conteggio.conn % 15 === 0) {
                log(`Invio automatico: WhatsApp non connesso, ritento tra 2 minuti (${conteggio.conn + 1}/${MAX_RITENTI_CONNESSIONE}).`, 'info');
            }
            programmaRitento(giorno, { conn: conteggio.conn + 1, invio: conteggio.invio }, 2 * 60 * 1000, silenzioso);
            return;
        }

        const res = await inviaAuguri();
        if (res.ok) {
            segnaInviatoOggi();
            annullaRitenti();
            return;
        }
        // Invio fallito (rete, WhatsApp Web che si ricarica, gruppo non ancora
        // caricato): si ritenta, cosi' un intoppo passeggero non fa saltare il
        // giorno. Contatore separato da quello della connessione: due ore di
        // attesa del collegamento non devono bruciare i ritenti dell'invio.
        if (conteggio.invio >= MAX_RITENTI_INVIO) {
            rinunciatoIl = giorno;
            annullaRitenti();
            await segnalaAllarme(`AUGURI NON INVIATI (${giorno}) a ${nomi}: ${res.msg}. Ritenti esauriti.`);
            return;
        }
        log(`Invio automatico fallito (${res.msg}): ritento tra 5 minuti (${conteggio.invio + 1}/${MAX_RITENTI_INVIO}).`, 'errore');
        programmaRitento(giorno, { conn: conteggio.conn, invio: conteggio.invio + 1 }, 5 * 60 * 1000, silenzioso);
    } finally {
        invioInCorso = false;
    }
}

// Ricontrollo periodico dopo l'orario. Lo scheduler e' un timer che scatta una
// volta al giorno: se l'Excel cambia DOPO l'orario di invio, fino al giorno dopo
// nessuno se ne accorge. E' successo il 31 agosto 2026 — 35 persone e nessun
// compleanno alle 09:00, 75 persone con un compleanno di oggi alle 10:28, e
// quella persona non avrebbe ricevuto niente.
const RICONTROLLO_MIN = 15;
let timerRicontrollo = null;
function avviaRicontrolloPeriodico() {
    if (timerRicontrollo) clearInterval(timerRicontrollo);
    timerRicontrollo = setInterval(() => {
        controllaScollegamento();                 // a qualsiasi ora, anche senza compleanni
        if (!oraInvioPassata() || giaInviatoOggi()) return;
        if (rinunciatoIl === oggiISO()) return;   // gia' allarmato: non si insiste
        if (invioInCorso || retryTimer) return;   // c'e' gia' un tentativo in ballo
        eseguiInvioAutomatico(undefined, true);   // giro di routine: nel log solo se serve
    }, RICONTROLLO_MIN * 60 * 1000);
}

// Riprogramma se stesso ogni giorno all'orario stabilito
let timerInvio = null;
function programmaInvioGiornaliero() {
    if (timerInvio) clearTimeout(timerInvio);
    const ms = msFinoAInvio();
    log(`Prossimo invio automatico tra ~${Math.round(ms / 60000)} min (ore ${L.CONFIG.ORARIO_INVIO}).`, 'info');
    timerInvio = setTimeout(async () => {
        // Giorno nuovo: si riparte puliti, senza ritenti e senza rinunce di ieri.
        annullaRitenti();
        rinunciatoIl = null;
        ruotaLog();
        await eseguiInvioAutomatico();
        programmaInvioGiornaliero();
    }, ms);
}

// ---------- Socket.io ----------
function configPubblica() {
    return {
        gruppo: L.CONFIG.GRUPPO_DESTINAZIONE,
        excel: L.CONFIG.EXCEL_FILE,
        orario: L.CONFIG.ORARIO_INVIO,
        configurato: fs.existsSync(L.CONFIG_FILE) // false = primo avvio, mai salvato
    };
}

io.on('connection', (socket) => {
    socket.emit('stato', stato);
    socket.emit('config', configPubblica());
    logBuffer.forEach(r => socket.emit('log', r));

    socket.on('invia', async () => {
        // Stesso lucchetto dell'invio automatico: un clic mentre quello e' in
        // corso mandava il messaggio due volte nel gruppo.
        if (invioInCorso) {
            socket.emit('risultatoInvio', { ok: false, msg: 'Invio gia\' in corso, riprova tra poco' });
            return;
        }
        invioInCorso = true;
        try {
            const res = await inviaAuguri();
            if (res.ok) {
                // Segna la giornata anche per l'invio a mano: altrimenti il
                // ricontrollo periodico ripartirebbe e li manderebbe una seconda volta.
                segnaInviatoOggi();
                annullaRitenti();
            }
            socket.emit('risultatoInvio', res);
        } finally {
            invioInCorso = false;
        }
    });

    socket.on('ricarica', async () => {
        await ricaricaDati();
    });

    // Salvataggio configurazione dalla pagina web → persiste su config.json e applica subito.
    socket.on('salvaConfig', async (patch) => {
        try {
            // EXCEL_FILE arriva dal client: senza questo controllo il file browser
            // sarebbe confinato alla radice ma basterebbe scrivere a mano un
            // percorso qualsiasi per farci leggere un file fuori.
            const excel = patch && patch.EXCEL_FILE;
            if (excel && String(excel).trim() && !dentroRadice(String(excel).trim())) {
                socket.emit('configSalvata', {
                    ok: false,
                    msg: `Il file Excel deve stare dentro ${BROWSE_ROOT}`,
                });
                return;
            }
            L.salvaConfig(patch || {});
            log(`Config salvata: gruppo="${L.CONFIG.GRUPPO_DESTINAZIONE}", orario=${L.CONFIG.ORARIO_INVIO}`, 'ok');
            io.emit('config', configPubblica());
            await ricaricaDati();          // rilegge l'Excel dal nuovo percorso
            await aggiornaGruppoTrovato(); // rivaluta il gruppo col nuovo nome
            programmaInvioGiornaliero();   // riprogramma col nuovo orario
            socket.emit('configSalvata', { ok: true, msg: 'Configurazione salvata' });
        } catch (e) {
            log(`Errore salvataggio config: ${e.message}`, 'errore');
            socket.emit('configSalvata', { ok: false, msg: e.message });
        }
    });
});

// ---------- Avvio ----------
server.listen(PORT, HOST, async () => {
    log(`Interfaccia web attiva su http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`
        + (HOST === '0.0.0.0' ? ' (e in LAN)' : ''), 'ok');
    log(`File Excel selezionabile dentro: ${BROWSE_ROOT}`, 'info');
    ruotaLog();
    stato.ultimoInvio = leggiUltimoInvio();
    await ricaricaDati();
    avviaClient();                 // in caso di errore ritenta da solo (backoff)
    // Avvia lo scheduler giornaliero (invio automatico alle ore ORARIO_INVIO)
    programmaInvioGiornaliero();
    // Rete di sicurezza per l'Excel modificato dopo l'orario di invio.
    avviaRicontrolloPeriodico();
});

// La porta occupata e' l'unico caso in cui fermarsi e' giusto: significa che
// un'altra istanza del programma e' gia' viva e sta facendo il lavoro.
server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`Porta ${PORT} gia' in uso: un'altra istanza e' attiva. Esco.`);
        process.exit(0);
    }
    log(`Errore server web: ${e.message}`, 'errore');
});
