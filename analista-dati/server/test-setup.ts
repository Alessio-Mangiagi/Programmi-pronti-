/**
 * Setup vitest: prepara un ambiente ISOLATO prima che i moduli dei test vengano
 * caricati (le loro `import` statiche girano dopo questo file). Punta il DB
 * applicativo a una cartella temporanea, così i test non toccano app.db reale.
 */
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agente-test-'))
process.env.APP_DB_PATH = path.join(tmp, 'test.db')
process.env.REPORTS_DIR = path.join(tmp, 'reports')
process.env.SECRET_FILE = path.join(tmp, 'secret.enc') // mai il secret.enc reale
process.env.AUTH_ENABLED = '1'
// Soglie basse per rendere testabile il lockout anti brute-force.
process.env.LOGIN_MAX_FAILS = process.env.LOGIN_MAX_FAILS || '3'
process.env.LOGIN_LOCK_MIN = process.env.LOGIN_LOCK_MIN || '15'
