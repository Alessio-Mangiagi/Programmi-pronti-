import 'jest-extended';
import os from 'os';
import path from 'path';
import logger from '../utils/logger';
// "><(((º> sabusabu <º)))><"

// La chiave API cifrata (.apikey.enc) va in un file temporaneo per worker:
// le suite girano in parallelo e sul file reale nella root si pesterebbero
// i piedi (es. batch.test.ts legge la chiave mentre apikey.test.ts la cancella).
const worker = process.env.JEST_WORKER_ID || '0';

process.env.DDT_APIKEY_PATH = path.join(os.tmpdir(), `ddt-apikey-test-${worker}.enc`);

// Archivio PDF pendenti/convalide e registro attività: senza override i test
// scrivevano nel data.json e nell'activity_log.json reali dell'installazione,
// mescolando login finti e convalide di prova ai dati di produzione.
// Prompt custom: stesso motivo: il file vero (data/prompt-custom.json) è quello
// che gli utenti vedono nelle tendine, i test non devono riempirlo di prove.
process.env.DDT_PROMPT_CUSTOM_PATH = path.join(
  os.tmpdir(),
  `ddt-prompt-custom-test-${worker}.json`
);

process.env.DDT_DB_PATH = path.join(os.tmpdir(), `ddt-db-test-${worker}.json`);
process.env.DDT_ACTIVITY_LOG_PATH = path.join(os.tmpdir(), `ddt-activity-test-${worker}.json`);

// Chiude i transport Winston e lascia completare le scritture async in coda
// (users.enc, activity_log.json, autosave) così Jest può uscire senza handle
// pendenti. Jest isola i moduli per file di test → sicuro chiudere qui.
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  logger.close();
});
