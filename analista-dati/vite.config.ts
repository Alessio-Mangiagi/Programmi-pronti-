import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import cosedilSSO from '../shared/sso/cosedil-sso.mjs'

// "><(((º> sabusabu <º)))><"
export default defineConfig({
  plugins: [
    react(),
    // Gate SSO: richiede il login del Portale Suite Cosedil per usare l'app.
    // Vedi shared/sso (portale giù = accesso chiuso, COSEDIL_SSO_FAIL=open per
    // il vecchio comportamento; COSEDIL_SSO=off per disattivare del tutto).
    { name: 'cosedil-sso', configureServer(server) { server.middlewares.use(cosedilSSO({ app: 'agente' })) } },
  ],
  server: {
    // host:true → bind 0.0.0.0: il frontend è raggiungibile dagli altri PC in LAN.
    host: true,
    port: 5173,
    // Le chiamate /api vengono inoltrate (lato server) al backend locale:
    // i client parlano sempre con Vite, che fa da proxy al backend.
    // xfwd:true → aggiunge X-Forwarded-For con l'IP reale del client,
    // così il backend identifica il PC giusto (vedi ctxFromReq).
    proxy: {
      '/api': { target: 'http://localhost:3001', xfwd: true }
    }
  }
})
