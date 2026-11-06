import 'jest-extended';
// "><(((º> sabusabu <º)))><"
import logger from '../utils/logger';

// I percorsi temporanei dei test (archivio utenti, sessioni, log, convalide, registro attività,
// chiave API, prompt custom) e il gate SSO spento stanno in env.ts, caricato da jest.config.js in
// setupFiles prima di questo file: qui `import logger` li leggerebbe già, prima di impostarli.

// Chiude i transport Winston e lascia completare le scritture async in coda
// (users.enc, activity_log.json, autosave) così Jest può uscire senza handle
// pendenti. Jest isola i moduli per file di test → sicuro chiudere qui.
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  logger.close();
});
