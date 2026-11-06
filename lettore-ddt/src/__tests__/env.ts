// "><(((º> sabusabu <º)))><"
/**
 * Ambiente dei test di Lettore DDT: ogni file che l'app scrive va in una cartella temporanea,
 * mai nell'installazione vera. Lo carica jest.config.js in `setupFiles`, cioè PRIMA di ogni modulo
 * dell'app e prima di setup.ts: i percorsi si leggono una volta all'import (logger, archivio
 * utenti, sessioni), quindi impostarli in setup.ts dopo `import logger` sarebbe troppo tardi.
 *
 * Perché esiste (06/11/2026): l'archivio utenti vero (users.enc) conteneva una trentina di account
 * test-user-* creati dai test, e i login finti lasciavano sessioni in sessions/ ed errori in
 * error.log. Un file per worker di Jest: le suite girano in parallelo e su un file comune si
 * pesterebbero i piedi.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const worker = process.env.JEST_WORKER_ID || '0';
const tmp = (nome: string): string => path.join(os.tmpdir(), `ddt-${nome}-test-${worker}`);

// Gate SSO del portale spento nei test, come nelle altre app della suite: dal 03/11/2026 il gate protegge
// ogni rotta che non sia un file statico (anche /auth/login e /batch, che non stanno sotto /api) e nei
// test non c'è nessun portale a cui chiedere la sessione. Il comportamento col gate acceso lo provano
// sicurezza.test.ts (identità del portale obbligatoria) e i test di shared/sso.
if (!process.env.COSEDIL_SSO) process.env.COSEDIL_SSO = 'off';

// La chiave API cifrata (.apikey.enc): sul file reale nella root batch.test.ts e apikey.test.ts
// si pesterebbero i piedi (uno legge la chiave mentre l'altro la cancella).
process.env.DDT_APIKEY_PATH = tmp('apikey') + '.enc';

// Archivio PDF pendenti/convalide e registro attività: senza override i test scrivevano nel
// data.json e nell'activity_log.json reali, mescolando login finti e convalide di prova ai dati veri.
process.env.DDT_DB_PATH = tmp('db') + '.json';
process.env.DDT_ACTIVITY_LOG_PATH = tmp('activity') + '.json';

// Prompt custom: il file vero (data/prompt-custom.json) è quello delle tendine degli utenti.
process.env.DDT_PROMPT_CUSTOM_PATH = tmp('prompt-custom') + '.json';

// Archivio utenti (cifrato con la stessa chiave .users.key, che i test leggono soltanto),
// sessioni dei login finti, log degli errori provocati apposta.
process.env.DDT_USERS_PATH = tmp('users') + '.enc';
process.env.DDT_SESSIONS_DIR = tmp('sessions');
process.env.DDT_LOG_DIR = tmp('log');
// Dati per commessa (data/<commessa>/: export, versioni, consegne, job): le commesse finte dei test
// (__test__, __test_registro_vuoto__, …) stavano nella cartella data/ dell'installazione.
process.env.DDT_DATA_ROOT = tmp('data');
fs.mkdirSync(process.env.DDT_LOG_DIR, { recursive: true });

// Gli errori del logger diventano anche avvisi per gli admin del portale (shared/avvisi): nei test
// non devono finire nella cartella avvisi-in del portale del repo.
process.env.SUITE_AVVISI_DIR = tmp('avvisi');
