// Avvio in produzione (lo chiama avvia.bat): frontend compilato in dist/ servito
// dal backend stesso sulla porta 5179, niente dev server Vite e niente `tsx watch`.
//
// Perché: `npm run dev` serviva i moduli uno per uno senza impacchettarli (primo
// carico di secondi, decine di richieste) e ricompilava il server a ogni
// salvataggio di file — cose utili a chi sviluppa, non a chi usa il programma.
//
//   1. dist/ manca o è più vecchia dei sorgenti → `npm run build` (typecheck + vite);
//      se la build fallisce si ripiega su `npm run dev`, così il programma parte comunque.
//   2. `tsx server.ts` con NODE_ENV=production PORT=5179 (il portale e i link puntano lì).
//   3. Apre il browser, salvo PORTALE_APRE_BROWSER=1 (il portale apre lui la scheda).
//
// Per sviluppare resta `npm run dev`.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORTA = process.env.PORT || '5179'
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const opzioni = { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' }

// mtime più recente sotto una cartella (ricorsivo)
const piuRecente = (p) => {
  // "><(((º> sabusabu <º)))><"
  const st = statSync(p)
  if (!st.isDirectory()) return st.mtimeMs
  return Math.max(st.mtimeMs, ...readdirSync(p).map(f => piuRecente(join(p, f))))
}

const distIndex = join(ROOT, 'dist', 'index.html')
const sorgenti = ['src', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json'].map(f => join(ROOT, f)).filter(existsSync)
const distVecchia = !existsSync(distIndex) || statSync(distIndex).mtimeMs < Math.max(...sorgenti.map(piuRecente))

let produzione = true
if (distVecchia) {
  console.log('[AVVIO] dist/ mancante o non aggiornata: compilo il frontend (npm run build)...')
  const r = spawnSync(`${NPM} run build`, opzioni)
  if (r.status !== 0) {
    console.log('[AVVISO] Build fallita: parto in modalità sviluppo (npm run dev), più lenta ma funzionante.')
    produzione = false
  }
}

if (!produzione) {
  const dev = spawn(`${NPM} run dev`, opzioni)
  dev.on('exit', code => process.exit(code ?? 0))
} else {
  // HOST=0.0.0.0 lo manda il portale quando è in ascolto in LAN (vedi launchApp):
  // in produzione è il backend a doversi legare lì, non Vite.
  const env = { ...process.env, NODE_ENV: 'production', PORT: PORTA }
  if (process.env.HOST === '0.0.0.0') env.OCR_BIND_HOST = '0.0.0.0'
  const server = spawn('npx tsx server.ts', { ...opzioni, env })
  server.on('exit', code => process.exit(code ?? 0))
  if (process.env.PORTALE_APRE_BROWSER !== '1') {
    // appena la porta risponde: poll breve, niente attesa a tempo fisso
    const url = `http://localhost:${PORTA}/`
    const t0 = Date.now()
    const prova = async () => {
      try { await fetch(url, { method: 'HEAD' }); apri(url); return } catch { /* non ancora su */ }
      if (Date.now() - t0 < 60_000) setTimeout(prova, 500)
    }
    void prova()
  }
}

function apri(url) {
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
  else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
}
