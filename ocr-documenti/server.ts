import express from 'express'
import cors from 'cors'
import path from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { cleanMarkdown, jsonToReadableMd } from './src/lib/markdown.ts'
// "><(((º> sabusabu <º)))><"
import { OCR_WORKER, PYTHON_BIN } from './server/config.ts'
import { tabellaDaTsv } from './server/tabella-tsv.ts'
import { splitPageTiles, unisciMigliaiaSpazio } from './server/testo.ts'
import { decodificaCorpoOcr, type ImmagineOcr } from './server/immagine.ts'
import { POOL_MAX, componiTesto, ocrErrore, ocrPaddle, ocrPaddleDettagli, prendiWorker, setDumpBlocchi, testoGarbled, workerEngine, type BloccoIncerto } from './server/ocr.ts'
import { ELENCHI, normalizzaRisultatoAlyante, ricaricaElenchi } from './server/alyante.ts'
import { estrai, type Estratto } from './server/parser-contratti.ts'
import { ASSIST_MODEL, OLLAMA_BASE, modelloAttivo, ocrVisionPagina, ollamaAttivo, scegliModelloVision } from './server/ollama.ts'
import { TIPOLOGIE_VALIDE, estraiAssistito } from './server/assist.ts'
import { strutturaAlyante, strutturaContratto } from './server/struttura.ts'
import { montaRotteLavori, caricaLavori, lavoriInCorso } from './server/lavori.ts'
import cosedilSSO from '../shared/sso/cosedil-sso.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
app.use(cors())

const PORT = Number(process.env.PORT) || 3007
// Solo loopback, sempre: a questo backend ci parla il proxy di Vite, che gira
// sulla stessa macchina. Restando in ascolto su tutte le interfacce era
// raggiungibile dalla LAN scavalcando il gate SSO, che vive sul dev server.
const BIND_HOST = process.env.OCR_BIND_HOST || '127.0.0.1'

// Gate SSO anche qui quando il backend è raggiungibile senza passare da Vite:
// in produzione (serve lui il frontend da dist/) o se esposto su un'interfaccia
// non locale. In sviluppo il gate sta sul dev server e qui sarebbe un doppione.
const ESPOSTO = process.env.NODE_ENV === 'production' || !/^(127\.0\.0\.1|localhost|::1)$/.test(BIND_HOST)
if (ESPOSTO) app.use(cosedilSSO({ app: 'ocr' }))

// Limite del corpo JSON per rotta: le pagine in base64 passano solo da /api/ocr;
// il resto (lavori: nome, testo della bozza) sta in pochi MB. Un limite unico a
// 200 MB valeva anche per /api/normalizza e /api/lavori, che non ne hanno bisogno.
const jsonPagine = express.json({ limit: '200mb' })
const jsonNormale = express.json({ limit: '50mb' })
app.use((req, res, next) => (req.path === '/api/ocr' ? jsonPagine : jsonNormale)(req, res, next))
// Le pagine dal frontend arrivano in un corpo binario (PNG grezzi + meta, vedi
// decodificaCorpoOcr): il JSON con base64 resta accettato per harness e chiamanti vecchi.
const binarioPagine = express.raw({ type: 'application/octet-stream', limit: '200mb' })
app.post('/api/ocr', binarioPagine, (req, res, next) => {
  if (!Buffer.isBuffer(req.body)) return next()
  try { req.body = decodificaCorpoOcr(req.body); next() } catch (e: unknown) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'corpo binario non valido' })
  }
})

// ── PaddleOCR (PP-OCRv5): OCR locale immagine → testo, via worker Python
// persistente (ocr_worker.py). Il structuring deterministico (regex + geometria)
// è IDENTICO alla versione Tesseract: cambia solo il motore che produce parole
// e coordinate; il worker emette blocchi che qui vengono convertiti nello stesso
// formato TSV, così tutta la ricostruzione tabelle resta invariata.
// VERSIONE IBRIDA: Ollama (locale, opzionale) interviene SOLO sui campi che il
// parser lascia vuoti; ogni valore proposto è accettato SOLO se presente alla
// lettera nel testo OCR — mai inventato. Ollama spento → l'app funziona uguale. ──

let watchdog: ReturnType<typeof setTimeout> | null = null
let activeRequests = 0

// OCR_WATCHDOG=0: il backend resta su anche senza browser (server condiviso in LAN,
// avviato come servizio: non deve spegnersi quando l'ultimo utente chiude la scheda).
const WATCHDOG = process.env.OCR_WATCHDOG !== '0'
const scheduleShutdown = () => {
  if (!WATCHDOG) return
  if (watchdog) clearTimeout(watchdog)
  watchdog = setTimeout(() => {
    // un lavoro lato server va finito anche a scheda chiusa: è il suo scopo
    if (activeRequests > 0 || lavoriInCorso() > 0) { scheduleShutdown(); return }
    console.log('Heartbeat lost — shutting down.')
    process.exit(0)
  }, 120_000)
}

// Track active requests: decrement once (finish and close both fire in keep-alive)
app.use((_req, res, next) => {
  activeRequests++
  let decremented = false
  const decrement = () => { if (!decremented) { decremented = true; activeRequests-- } }
  res.on('finish', () => { decrement(); scheduleShutdown() })
  res.on('close', decrement)
  next()
})

app.get('/api/ping', (_req, res) => {
  scheduleShutdown()
  res.json({ ok: true })
})

app.get('/api/health', async (_req, res) => {
  // chiave `tesseract` mantenuta per compatibilità col frontend: significa "motore OCR ok"
  // ocrErrore: il worker è partito e morto (es. DLL bloccata da App Control) → OCR fermo
  // anche se i file ci sono; il frontend mostra il motivo al posto di "non trovato".
  const ok = existsSync(PYTHON_BIN) && existsSync(OCR_WORKER) && !ocrErrore
  const assist = await ollamaAttivo()
  // vision: c'è un modello vision in Ollama → il frontend abilita "Scansiona con AI"
  const visionModel = await scegliModelloVision()
  // workers: dimensione del pool OCR — il frontend ci allinea il numero di pagine in volo
  res.status(ok ? 200 : 503).json({ tesseract: ok, ollama: assist, vision: !!visionModel, visionModel: visionModel ?? undefined, name: workerEngine || 'PaddleOCR', bin: PYTHON_BIN, ocrErrore: ocrErrore || undefined, model: modelloAttivo ?? undefined, workers: POOL_MAX, lavori: true })
})


app.post('/api/ocr', async (req, res) => {
  // `origine` distingue due testi che il campo `text` non separa: quello NATIVO (layer
  // PDF, .docx) e quello che è già uscito da un OCR (il banco di prova rigioca da lì le
  // pagine in cache). Hanno affidabilità diversa sugli spazi, e vanno normalizzati diverso.
  // Assente = OCR: così un chiamante vecchio non cambia comportamento.
  // `estratto`: pagina Claude. Il documento l'ha già letto Claude e ha risposto con
  // {testata, importi, righe}; qui si salta OCR e parser e si va dritti alla
  // strutturazione (codici articolo, dedup, FAM/SFAM, elenchi ufficiali), che resta
  // la stessa del percorso OCR.
  const { images, format, text, motore, testoAllegati, dumpId, origine, estratto } = req.body as { images?: ImmagineOcr[], format: 'md' | 'json' | 'contract' | 'contratti', text?: string, motore?: 'paddle' | 'ai', testoAllegati?: string, dumpId?: string, origine?: 'nativo' | 'ocr', estratto?: Partial<Estratto> }

  if (estratto && (format === 'contratti' || format === 'contract')) {
    const str = (o: unknown): Record<string, string> => {
      const out: Record<string, string> = {}
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
          const s = String(v ?? '').trim()
          if (s) out[k] = s
        }
      }
      return out
    }
    const e: Estratto = {
      testata: str(estratto.testata),
      importi: str(estratto.importi),
      righe: (Array.isArray(estratto.righe) ? estratto.righe : []).map(r => {
        const x = str(r)
        return { progressivo: '', codice_epu: x.codice_epu ?? '', descrizione: x.descrizione ?? '', udm: (x.udm ?? '').toLowerCase(), quantita: x.quantita ?? '', prezzo_lordo: x.prezzo_lordo ?? '', importo: x.importo ?? '' }
      }),
    }
    // tipologia fuori enum → vuota, come farebbe il parser (l'export deriva la DIVISIONE da lì)
    if (e.testata.tipologia_contratto && !TIPOLOGIE_VALIDE.includes(e.testata.tipologia_contratto)) delete e.testata.tipologia_contratto
    console.log(`[OCR] richiesta Claude: format=${format} righe:${e.righe.length}`)
    try {
      let result = format === 'contratti' ? strutturaAlyante(e) : strutturaContratto(e, text ?? '')
      if (format === 'contratti') result = normalizzaRisultatoAlyante(result)
      return res.json({ result })
    } catch (err: unknown) {
      return res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  if (!images?.length && !text) {
    return res.status(400).json({ error: 'No images or text provided' })
  }
  console.log(`[OCR] richiesta: format=${format} ${text ? `testo:${text.length}ch` : `immagini:${images!.length}`}`)

  const mdOrReadable = (raw: string): string => {
    const cleaned = cleanMarkdown(raw)
    const t = cleaned.trim()
    return (t.startsWith('{') && t.endsWith('}')) ? (jsonToReadableMd(t) ?? cleaned) : cleaned
  }

  try {
    // 1) immagine → testo con PaddleOCR (se serve); 2) testo → JSON in codice (niente LLM).
    // Testo NATIVO (PDF con layer, .docx): l'unica normalizzazione che serve è la riunione
    // delle migliaia separate da spazio. Il resto di normalizzaNumeriOcr ripara errori di
    // lettura che nel nativo non esistono. Testo già OCR: lasciato com'è, l'ha già
    // normalizzato ocrPaddle quando l'ha prodotto.
    // Letture incerte (blocchi sotto soglia di confidenza), solo dall'OCR: il frontend le
    // usa per colorare le celle da ricontrollare. `tile` = indice dell'immagine.
    const incerte: (BloccoIncerto & { tile: number })[] = []
    const tiles: string[] = text
      ? splitPageTiles(text).map(origine === 'nativo' ? unisciMigliaiaSpazio : (x: string) => x)
      : motore === 'ai'
        ? await Promise.all(images!.map(image => ocrVisionPagina(image)))   // scansione diretta con AI (vision)
        : await Promise.all(images!.map(async (image, i) => {
          const esito = await ocrPaddleDettagli(image, dumpId && images!.length > 1 ? `${dumpId}-${i + 1}` : dumpId)
          incerte.push(...esito.incerte.map(b => ({ ...b, tile: i })))
          return esito.testo
        }))
    // Allegati tabellari (Excel) del contratto: nei noli a freddo l'articolo elenco
    // prezzi dice "Vedasi allegato 1" e le voci stanno solo lì. Il frontend manda il
    // foglio già trasformato in righe testuali; qui si accoda al testo della pagina e
    // i parser lo leggono come una tabella qualsiasi.
    const joined = [tiles.join('\n\n'), testoAllegati?.trim()].filter(Boolean).join('\n\n')

    let result: string
    if (format === 'contratti') {
      result = strutturaAlyante(await estraiAssistito(joined))
    } else if (format === 'contract') {
      result = strutturaContratto(await estraiAssistito(joined), joined)
    } else if (format === 'json') {
      result = JSON.stringify({
        tipo_documento: 'Documento',
        testo: joined.split('\n').map(l => l.trim()).filter(Boolean),
      }, null, 2)
    } else {
      result = text ? mdOrReadable(text) : tiles.join('\n\n')
    }

    // Aggancio elenchi ufficiali: il JSON estratto viene riportato ai valori ESATTI
    // delle anagrafiche Alyante (divisione, cond. pagamento, commessa, conto, fam/sfam).
    if (format === 'contratti') result = normalizzaRisultatoAlyante(result)

    res.json(incerte.length ? { result, incerte } : { result })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    res.status(500).json({ error: msg })
  }
})

// Elenchi ufficiali per il frontend: colonne DITTA (codice numerico), PROGETTO
// (validazione commessa), FAM/SFAM (validazione codici) del template Import_Contratti.
app.get('/api/elenchi', (_req, res) => res.json(ELENCHI))
// Rilettura manuale della cartella Elenchi/ (quella automatica via fs.watch può mancare
// su cartelle di rete). Risponde con i conteggi, così si vede se il file è stato letto.
app.post('/api/elenchi/ricarica', (_req, res) => {
  const e = ricaricaElenchi()
  res.json(Object.fromEntries(Object.entries(e).map(([k, v]) => [k, (v as unknown[]).length])))
})

// Ri-normalizza un JSON ALYANTE sugli elenchi ufficiali (usato dopo modifiche manuali
// in edit mode e per verifiche). Body: { json: "<stringa JSON alyante>" }.
app.post('/api/normalizza', (req, res) => {
  const { json } = req.body as { json?: string }
  if (!json) return res.status(400).json({ error: 'No json provided' })
  res.json({ result: normalizzaRisultatoAlyante(json) })
})

// Avvio robusto: se la porta è ancora occupata da un'istanza precedente
// (tipico con tsx watch che riavvia prima che la vecchia esca), riprova
// alcune volte invece di crashare con EADDRINUSE.
let currentServer: ReturnType<typeof app.listen> | null = null

// Lavori lato server (PDF caricato una volta, pipeline sul server, stato su disco).
// Il PUT del file arriva come corpo grezzo, non JSON.
montaRotteLavori(app, express.raw({ type: () => true, limit: '300mb' }))

// Produzione (avvia.bat): nessun dev server Vite, il frontend compilato lo serve
// questo processo. DOPO tutte le rotte /api: il catchall prende qualunque GET, e
// messo prima delle rotte lavori rispondeva index.html a /api/lavori.
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')))
  // '/*catchall' e non '*': da express 5 (path-to-regexp v8) il wildcard nudo
  // non e' piu' un percorso valido e l'avvio muore con "Missing parameter name".
  app.get('/*catchall', (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'))
  })
}

const startServer = (attempt = 0) => {
  const s = app.listen(PORT, BIND_HOST, () => {
    console.log(`OCR server → http://${BIND_HOST}:${PORT}`)
    console.log(`PaddleOCR  → ${PYTHON_BIN}`)
    console.log(`Assist AI  → ${OLLAMA_BASE} (${ASSIST_MODEL}, opzionale)`)
    // warm-up: carica il modello sul primo worker, così la prima scansione non
    // paga l'avvio; gli altri worker del pool partono solo quando serve
    prendiWorker().ready.catch(e => console.error(`[PaddleOCR] warm-up fallito: ${e.message}`))
  })
  currentServer = s
  // Disable socket timeout — OCR calls can take many minutes per page
  s.timeout = 0
  s.keepAliveTimeout = 65_000

  s.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      console.log(`Porta ${PORT} ancora occupata — riprovo (${attempt + 1}/10)…`)
      setTimeout(() => startServer(attempt + 1), 600)
    } else {
      console.error(`Impossibile avviare il server sulla porta ${PORT}:`, err.message)
      process.exit(1)
    }
  })
}

// Shutdown pulito: rilascia subito la porta su SIGTERM/SIGINT (reload tsx, Ctrl+C).
// Registrato UNA volta sola — non dentro startServer, altrimenti ogni retry EADDRINUSE
// aggiunge un listener (→ MaxListenersExceededWarning dopo 10 tentativi).
const shutdown = () => {
  currentServer?.close(() => process.exit(0))
  // se le connessioni aperte non si chiudono in tempo, forza l'uscita
  setTimeout(() => process.exit(0), 1500).unref()
}
process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

// OCR_LIB_MODE=1 → il modulo è importato come LIBRERIA (tools/harness.ts): niente
// listen, niente porta occupata. Il pool PaddleOCR resta disponibile su richiesta.
if (!process.env.OCR_LIB_MODE) { startServer(); void caricaLavori() }

// Superficie pubblica per il banco di prova offline (tools/harness.ts): stesse
// funzioni che usa la route /api/ocr, così l'harness misura la pipeline REALE.
export { ocrPaddle, componiTesto, setDumpBlocchi, estrai, estraiAssistito, strutturaAlyante, strutturaContratto, normalizzaRisultatoAlyante, testoGarbled, tabellaDaTsv, unisciMigliaiaSpazio }
