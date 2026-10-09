// Configurazione unica dell'app. Legge .env (parser minimale: niente dipendenza
// dotenv, il file ha solo CHIAVE=valore) e poi l'ambiente reale, che vince sempre:
// avvia.bat e i servizi passano le variabili dall'esterno.
import fs from 'node:fs';
import path from 'node:path';
// "><(((º> sabusabu <º)))><"
import { fileURLToPath } from 'node:url';

export const RADICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function caricaEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const riga of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(riga);
    if (!m || riga.trim().startsWith('#')) continue;
    const chiave = m[1];
    let valore = m[2].trim().replace(/\s+#.*$/, '');
    if (/^".*"$|^'.*'$/.test(valore)) valore = valore.slice(1, -1);
    if (process.env[chiave] === undefined) process.env[chiave] = valore;
  }
}
caricaEnv(path.join(RADICE, '.env'));

const num = (v, def) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : def);

export const CONFIG = {
  porta: num(process.env.PORT, 3011),
  host: process.env.HOST || '127.0.0.1',
  maxPdfByte: num(process.env.MAX_PDF_MB, 40) * 1024 * 1024,
  // Quanti PDF si possono mandare in una sola richiesta: la UI ne trascina anche
  // decine per volta, ma un tetto serve a non riempire la coda per sbaglio.
  maxFile: num(process.env.MAX_FILE, 25),
  cartellaDati: process.env.DATA_DIR || path.join(RADICE, 'data'),
  formatoDefault: process.env.FORMATO_DEFAULT || 'fieldview',
  traduttoreDefault: process.env.TRADUTTORE_DEFAULT || 'pcq-controlli',
  // Cartella extra di traduttori, fuori dal repo: e' li' che si lascia cadere il
  // file consegnato da chi scrive il parser, senza toccare il codice dell'app.
  traduttoriDir: process.env.TRADUTTORI_DIR || '',
  concorrenza: num(process.env.CONCORRENZA, 2),
  // Destinazione del file prodotto: fieldview (SOAP), connect (REST) o nessuna.
  destinazione: process.env.DESTINAZIONE || 'fieldview',
  fieldview: {
    url: process.env.FIELDVIEW_URL || 'https://eu.fieldview.trimble.com/FieldViewWebServices/WebServices/XML/API_FormsServices.asmx',
    // Namespace preso dalla documentazione del servizio: e' cosi' anche se sembra
    // un residuo di sviluppo (localhost.priority1.uk.net). Non va "corretto".
    namespace: process.env.FIELDVIEW_NS || 'https://localhost.priority1.uk.net/Priority1WebServices/XML',
    token: process.env.FIELDVIEW_TOKEN || '',
    soap: process.env.FIELDVIEW_SOAP || '1.1',
    formTemplateId: process.env.FIELDVIEW_FORM_TEMPLATE_ID || '',
    organisationId: process.env.FIELDVIEW_ORGANISATION_ID || '',
    personId: process.env.FIELDVIEW_PERSON_ID || '',
    projectId: process.env.FIELDVIEW_PROJECT_ID || '',
    elementId: process.env.FIELDVIEW_ELEMENT_ID || '',
    timeoutMs: num(process.env.FIELDVIEW_TIMEOUT_MS, 30000),
  },
  trimble: {
    tokenUrl: process.env.TRIMBLE_TOKEN_URL || 'https://id.trimble.com/oauth/token',
    apiBase: (process.env.TRIMBLE_API_BASE || 'https://app.connect.trimble.com/tc/api/2.0').replace(/\/+$/, ''),
    clientId: process.env.TRIMBLE_CLIENT_ID || '',
    clientSecret: process.env.TRIMBLE_CLIENT_SECRET || '',
    scope: process.env.TRIMBLE_SCOPE || '',
    projectId: process.env.TRIMBLE_PROJECT_ID || '',
    folderId: process.env.TRIMBLE_FOLDER_ID || '',
    timeoutMs: num(process.env.TRIMBLE_TIMEOUT_MS, 30000),
  },
};

export const cartellaLavori = () => path.join(CONFIG.cartellaDati, 'lavori');

/** Trimble e' utilizzabile solo con credenziali complete: senza, l'app resta in sola conversione. */
export function trimbleConfigurato() {
  const t = CONFIG.trimble;
  return Boolean(t.clientId && t.clientSecret && t.tokenUrl && t.apiBase);
}
