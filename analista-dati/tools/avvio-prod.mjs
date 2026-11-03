// "><(((º> sabusabu <º)))><"
// Avvio in esercizio (lo chiama avvia.bat): frontend compilato in dist/ e servito dal
// backend stesso (server.ts) sulla porta 5173, quella registrata nel portale. Niente
// dev server Vite e niente `tsx watch`.
//
// Perché: fino al 03/11/2026 avvia.bat lanciava `npm run dev`, cioè il dev server di
// Vite in ascolto su tutta la LAN: serve qualunque file della cartella del progetto a
// chi lo chiede senza `Accept: text/html` (app.db con utenti e storico chat, agente.log,
// secret.enc, i documenti caricati) e il gate SSO non lo fermava. Con dist/ servita dal
// backend passa solo ciò che la build ha impacchettato.
//
//   1. dist/ manca o è più vecchia dei sorgenti → `npm run build`; se la build fallisce
//      l'avvio SI FERMA con errore: mai ripiegare sul dev server in esercizio.
//   2. `tsx server.ts` con PORT=5173 e BIND_HOST ereditato da HOST (lo imposta il portale:
//      0.0.0.0 in LAN, altrimenti solo locale).
//   3. Apre il browser, salvo PORTALE_APRE_BROWSER=1 (il portale apre lui la scheda).
//
// Per sviluppare resta `npm run dev` (dev server solo su localhost, vedi vite.config.ts).
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORTA = process.env.PORT || '5173'
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const opzioni = { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }

// mtime più recente sotto una cartella (ricorsivo)
const piuRecente = (p) => {
  const st = statSync(p)
  if (!st.isDirectory()) return st.mtimeMs
  return Math.max(st.mtimeMs, ...readdirSync(p).map(f => piuRecente(join(p, f))))
}

const distIndex = join(ROOT, 'dist', 'index.html')
const sorgenti = ['src', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json'].map(f => join(ROOT, f)).filter(existsSync)
const distVecchia = !existsSync(distIndex) || statSync(distIndex).mtimeMs < Math.max(...sorgenti.map(piuRecente))

if (distVecchia) {
  console.log('[AVVIO] dist/ mancante o non aggiornata: compilo il frontend (npm run build)...')
  const r = spawnSync(`${NPM} run build`, opzioni)
  if (r.status !== 0) {
    console.error('[ERRORE] Build del frontend fallita: l\'app non parte. Correggere l\'errore qui sopra e rilanciare.')
    console.error('         (Non si ripiega sul dev server: in rete esporrebbe i file dell\'app senza login.)')
    process.exit(r.status || 1)
  }
}

// BIND_HOST segue HOST del portale; PORT è quella del registro del portale (5173).
const env = { ...process.env, NODE_ENV: 'production', PORT: PORTA }
if (process.env.HOST && !env.BIND_HOST) env.BIND_HOST = process.env.HOST
const server = spawn('npx tsx server.ts', { ...opzioni, env })
server.on('exit', code => process.exit(code ?? 0))

if (process.env.PORTALE_APRE_BROWSER !== '1') {
  // appena la porta risponde: poll breve, niente attesa a tempo fisso
  const url = `http://localhost:${PORTA}/`
  const t0 = Date.now()
  const apri = () => {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
  }
  const prova = async () => {
    try { await fetch(url, { method: 'HEAD' }); apri(); return } catch { /* non ancora su */ }
    if (Date.now() - t0 < 60_000) setTimeout(prova, 500)
  }
  setTimeout(prova, 1000)
}
