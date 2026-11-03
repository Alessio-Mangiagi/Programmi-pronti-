import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cosedilSSO from '../shared/sso/cosedil-sso.mjs'

// "><(((º> sabusabu <º)))><"
//
// Dev server di Vite: SOLO per chi sviluppa (`npm run dev`). In esercizio l'app
// parte con `avvia.bat` → tools/avvio-prod.mjs: frontend compilato in dist/ e
// servito dal backend (server.ts), nessun dev server. Motivo (revisione di
// sicurezza del 03/11/2026): il dev server serve qualunque file della cartella
// del progetto a chi lo chiede con `Accept: */*`, e prima stava in ascolto su
// tutta la LAN: app.db (utenti, storico chat, connessioni cifrate), agente.log,
// secret.enc e i documenti caricati erano leggibili senza login.
export default defineConfig({
  plugins: [
    react(),
    // Gate SSO: richiede il login del Portale Suite Cosedil per usare l'app.
    // Vedi shared/sso (portale giù = accesso chiuso, COSEDIL_SSO_FAIL=open per
    // il vecchio comportamento; COSEDIL_SSO=off per disattivare del tutto).
    { name: 'cosedil-sso', configureServer(server) { server.middlewares.use(cosedilSSO({ app: 'agente' })) } },
  ],
  server: {
    // Solo questo PC. Chi vuole davvero il dev server in LAN lo chiede in modo
    // esplicito con VITE_HOST=0.0.0.0, sapendo cosa espone.
    host: process.env.VITE_HOST === '0.0.0.0' ? true : 'localhost',
    port: 5173,
    // File che il dev server non deve mai servire, anche a chi è loggato: dati
    // dell'app, segreti, log e documenti stanno nella stessa cartella dei sorgenti.
    // `deny` SOSTITUISCE i divieti predefiniti di Vite (.env, certificati, .git): ripetuti qui.
    fs: {
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**',
             'app.db', 'app.db-*', 'secret.enc', 'agente.log*', 'docsets/**', 'reports/**', 'backup/**'],
    },
    // Le chiamate /api vengono inoltrate (lato server) al backend locale:
    // i client parlano sempre con Vite, che fa da proxy al backend.
    // xfwd:true → aggiunge X-Forwarded-For con l'IP reale del client,
    // così il backend identifica il PC giusto (vedi ctxFromReq).
    proxy: {
      '/api': { target: 'http://localhost:3001', xfwd: true }
    }
  }
})
