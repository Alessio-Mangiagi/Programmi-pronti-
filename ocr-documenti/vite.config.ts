import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import cosedilSSO from '../shared/sso/cosedil-sso.mjs'

const require = createRequire(import.meta.url)

// I font standard di pdf.js sono file su disco dentro pdfjs-dist. Non si possono
// referenziare con `new URL('pdfjs-dist/standard_fonts/', import.meta.url)`: e' una
// cartella, Vite non la impacchetta e l'URL resta rotto a runtime. Li copiamo in
// public/, cosi' il dev server li serve e la build li porta in dist/ da sola.
// public/standard_fonts/ e' rigenerata a ogni avvio: sta nel .gitignore.
const copiaFontPdfjs = () => ({
  name: 'pdfjs-standard-fonts',
  buildStart() {
    const sorgente = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')
    const destinazione = join(import.meta.dirname, 'public', 'standard_fonts')
    if (!existsSync(sorgente)) return
    mkdirSync(dirname(destinazione), { recursive: true })
    cpSync(sorgente, destinazione, { recursive: true })
  },
})

export default defineConfig({
  plugins: [
    react(),
    copiaFontPdfjs(),
    // Gate SSO: richiede il login del Portale Suite Cosedil per usare l'app.
    // Vedi shared/sso (portale giù = accesso chiuso, COSEDIL_SSO_FAIL=open per
    // il vecchio comportamento; COSEDIL_SSO=off per disattivare del tutto).
    { name: 'cosedil-sso', configureServer(server) { server.middlewares.use(cosedilSSO({ app: 'ocr' })) } },
  ],
  server: {
    // host:true → bind 0.0.0.0 quando il portale lo chiede (HOST=0.0.0.0),
    // altrimenti solo locale. Prima era sempre locale: in LAN il portale dava
    // un link all'app che nessun altro PC poteva aprire.
    host: process.env.HOST === '0.0.0.0' ? true : 'localhost',
    port: 5179,
    // Apre da solo il browser sulla pagina quando il dev server è pronto
    // (prima non si apriva niente: il .bat stampava solo l'URL). Si apre quando
    // Vite è in ascolto, senza attese a tempo fisso. Disattiva con: vite --no-open.
    open: true,
    // node_modules e' una junction verso la app sibling (deps condivise): il worker pdfjs
    // risolve a un path FUORI dalla root. Autorizziamo la cartella padre comune per @fs.
    fs: {
      allow: ['..']
    },
    proxy: {
      '/api': 'http://localhost:3007'
    }
  },
  optimizeDeps: {
    include: ['pdfjs-dist']
  }
})
