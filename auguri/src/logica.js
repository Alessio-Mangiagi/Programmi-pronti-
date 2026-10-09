const ExcelJS = require('exceljs');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Radice dell'app = cartella che CONTIENE src/ (questo file vive in src/).
// Tutti i path derivano da qui → portabile: copia la cartella dove vuoi, funziona.
const ROOT = path.join(__dirname, '..');

// File di configurazione salvato nella radice dell'app (accanto a package.json).
const CONFIG_FILE = path.join(ROOT, 'config.json');

// Default PORTABILI: nessun percorso specifico di un utente.
// Il file Excel di default sta in Documenti dell'utente CORRENTE del PC (os.homedir()).
const DEFAULTS = {
    EXCEL_FILE: path.join(os.homedir(), 'Documents', 'Compleanni_e_Auguri.xlsx'),
    GRUPPO_DESTINAZIONE: 'Prova',
    ORARIO_INVIO: '09:00',
    FOGLIO_COMPLEANNI: 'Compleanni',
    FOGLIO_FRASI_SINGOLE: 'Frasi di auguri',
    FOGLIO_FRASI_GRUPPO: 'Auguri di gruppo'
};

const CAMPI = Object.keys(DEFAULTS);

// Oggetto config "vivo": mutato IN PLACE così i riferimenti (L.CONFIG.x) restano sempre validi.
const CONFIG = { ...DEFAULTS };

// Legge config.json se esiste; altrimenti usa i default. Mai crasha per file mancante.
function caricaConfig() {
    try {
        const salvato = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        Object.assign(CONFIG, DEFAULTS, salvato);
    } catch {
        Object.assign(CONFIG, DEFAULTS);
    }
    return CONFIG;
}

// Salva un sottoinsieme di chiavi (solo quelle note e non vuote) su config.json.
function salvaConfig(patch = {}) {
    for (const k of CAMPI) {
        const v = patch[k];
        if (v !== undefined && v !== null && String(v).trim() !== '') {
            CONFIG[k] = String(v).trim();
        }
    }
    // Normalizza orario HH:MM, altrimenti torna al default.
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(CONFIG.ORARIO_INVIO)) {
        CONFIG.ORARIO_INVIO = DEFAULTS.ORARIO_INVIO;
    }
    const out = {};
    for (const k of CAMPI) out[k] = CONFIG[k];
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(out, null, 2), 'utf8');
    return CONFIG;
}

caricaConfig();

// ---------- Lettura dati Excel ----------
// ExcelJS non restituisce sempre un valore semplice: le celle con formula danno
// { formula, result }, il testo formattato { richText: [...] }, i link
// { text, hyperlink }. Senza questa normalizzazione una data calcolata da
// formula non era mai "compleanno oggi" e il nome diventava "[object Object]".
function valoreCella(v) {
    if (v === null || v === undefined || v instanceof Date) return v;
    if (typeof v !== 'object') return v;
    if ('result' in v) return valoreCella(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text || '').join('');
    if ('text' in v) return valoreCella(v.text);
    return null;
}

async function leggiDati() {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(CONFIG.EXCEL_FILE);

    const fComp = wb.getWorksheet(CONFIG.FOGLIO_COMPLEANNI);
    if (!fComp) throw new Error(`Foglio "${CONFIG.FOGLIO_COMPLEANNI}" non trovato`);

    const persone = [];
    fComp.eachRow((row, n) => {
        if (n === 1) return;
        const nome = valoreCella(row.getCell(1).value);
        const cognome = valoreCella(row.getCell(2).value);
        const dataNascita = valoreCella(row.getCell(3).value);
        // "><(((º> sabusabu <º)))><"
        if (nome && dataNascita) {
            persone.push({
                nome: String(nome).trim(),
                cognome: cognome ? String(cognome).trim() : '',
                dataNascita
            });
        }
    });

    const frasiSingole = leggiPoolFrasi(wb, CONFIG.FOGLIO_FRASI_SINGOLE);
    const frasiGruppo = leggiPoolFrasi(wb, CONFIG.FOGLIO_FRASI_GRUPPO);

    return { persone, frasiSingole, frasiGruppo };
}

function leggiPoolFrasi(wb, nomeFoglio) {
    const foglio = wb.getWorksheet(nomeFoglio);
    if (!foglio) throw new Error(`Foglio "${nomeFoglio}" non trovato`);
    const frasi = [];
    foglio.eachRow((row, n) => {
        if (n === 1) return;
        const frase = valoreCella(row.getCell(2).value);
        if (frase) frasi.push(String(frase).trim());
    });
    return frasi;
}

// ---------- Logica compleanno (UTC per evitare slittamento fuso orario) ----------
// Giorno e mese (0-11) di nascita, o null se il valore non e' una data.
// Le stringhe si leggono a mano e non con new Date(): quello "aggiusta" le date
// impossibili (31/04 diventava 1 maggio) invece di scartarle.
function giornoMeseNascita(dataValue) {
    if (dataValue instanceof Date) {
        if (isNaN(dataValue.getTime())) return null;
        return { g: dataValue.getUTCDate(), m: dataValue.getUTCMonth() };
    }
    if (typeof dataValue === 'number') {
        const d = new Date((dataValue - 25569) * 86400 * 1000);   // seriale Excel
        if (isNaN(d.getTime())) return null;
        return { g: d.getUTCDate(), m: d.getUTCMonth() };
    }
    if (typeof dataValue !== 'string') return null;
    const slash = dataValue.split('/');
    const dash = dataValue.split('-');
    let g, m;
    if (slash.length === 3) {               // GG/MM/AAAA
        g = parseInt(slash[0], 10); m = parseInt(slash[1], 10) - 1;
    } else if (dash.length === 3) {         // AAAA-MM-GG[Thh:mm...]
        g = parseInt(dash[2].slice(0, 2), 10); m = parseInt(dash[1], 10) - 1;
    } else {
        return null;
    }
    const giorniMese = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (!(m >= 0 && m <= 11) || !(g >= 1 && g <= giorniMese[m])) return null;
    return { g, m };
}

function bisestile(anno) {
    return (anno % 4 === 0 && anno % 100 !== 0) || anno % 400 === 0;
}

// `oggi` si passa solo nei test.
function eCompleannoOggi(dataValue, oggi = new Date()) {
    const n = giornoMeseNascita(dataValue);
    if (!n) return false;
    if (n.g === oggi.getDate() && n.m === oggi.getMonth()) return true;
    // Nati il 29 febbraio: negli anni non bisestili si festeggiano il 28,
    // altrimenti gli auguri non partirebbero per tre anni su quattro.
    return n.m === 1 && n.g === 29 && oggi.getMonth() === 1 && oggi.getDate() === 28
        && !bisestile(oggi.getFullYear());
}

// Compleanni dei prossimi `giorni` giorni (oggi escluso), in ordine di data.
// Passa da eCompleannoOggi giorno per giorno: stesse regole, 29 febbraio compreso.
function prossimiCompleanni(persone, giorni = 14, oggi = new Date()) {
    const out = [];
    for (let tra = 1; tra <= giorni; tra++) {
        const giorno = new Date(oggi.getFullYear(), oggi.getMonth(), oggi.getDate() + tra, 12);
        for (const p of persone) {
            if (eCompleannoOggi(p.dataNascita, giorno)) {
                out.push({ nome: nomeCompleto(p), data: formattaData(p.dataNascita), tra });
            }
        }
    }
    return out;
}

// ---------- Formattazione data per UI ----------
function formattaData(dataValue) {
    let d;
    if (dataValue instanceof Date) {
        return `${String(dataValue.getUTCDate()).padStart(2, '0')}/${String(dataValue.getUTCMonth() + 1).padStart(2, '0')}/${dataValue.getUTCFullYear()}`;
    } else if (typeof dataValue === 'string') {
        return dataValue.split('T')[0];
    } else if (typeof dataValue === 'number') {
        d = new Date((dataValue - 25569) * 86400 * 1000);
        return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
    }
    return String(dataValue);
}

// ---------- Costruzione messaggio ----------
function fraseCasuale(pool) {
    if (!pool || pool.length === 0) return 'Tanti auguri di buon compleanno! 🎉🎂';
    return pool[Math.floor(Math.random() * pool.length)];
}

function nomeCompleto(p) {
    return p.cognome ? `${p.nome} ${p.cognome}` : p.nome;
}

function unisciNomi(persone) {
    const nomi = persone.map(nomeCompleto);
    if (nomi.length === 1) return nomi[0];
    return nomi.slice(0, -1).join(', ') + ' e ' + nomi[nomi.length - 1];
}

function costruisciMessaggio(persone, frase) {
    if (frase.includes('{nome}')) {
        // Funzione e non stringa: in una stringa di sostituzione "$&" e "$1"
        // verrebbero interpretati, un nome o una frase con "$" uscirebbe storpiato.
        const nomi = unisciNomi(persone);
        return frase.replace(/\{nome\}/g, () => nomi);
    }
    return `🎉 ${unisciNomi(persone)}!\n\n${frase}`;
}

module.exports = {
    CONFIG,
    ROOT,
    CONFIG_FILE,
    salvaConfig,
    leggiDati,
    eCompleannoOggi,
    formattaData,
    fraseCasuale,
    nomeCompleto,
    unisciNomi,
    costruisciMessaggio,
    valoreCella,
    prossimiCompleanni
};
