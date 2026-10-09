// Ollama locale, opzionale: modello testuale per l'assist e modello vision per le
// scansioni illeggibili.
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { spawn } from 'child_process'
import { cleanMarkdown } from '../src/lib/markdown.ts'
import { PYTHON_BIN } from './config.ts'
import { immagineInBuffer, type ImmagineOcr } from './immagine.ts'

// ─────────────────────────────────────────────────────────────────────────────
// ASSIST OLLAMA (opzionale, locale) · riempie SOLO i campi vuoti del parser.
// Vincolo anti-invenzione: un valore proposto dall'LLM è accettato SOLO se
// presente alla lettera nel testo OCR (confronto normalizzato). Non presente →
// scartato, il campo resta vuoto. Ollama spento/assente → nessun assist.
// ─────────────────────────────────────────────────────────────────────────────
export const OLLAMA_BASE = process.env.OLLAMA_BASE || 'http://localhost:11434'
export const ASSIST_MODEL = process.env.ASSIST_MODEL || 'qwen2.5:3b'
// Preferenze in ordine; vince il primo modello INSTALLATO. Esclusi i modelli
// vision/ocr: l'assist lavora sul testo già estratto da Tesseract, non su immagini.
export const MODELLI_PREFERITI = [ASSIST_MODEL, 'qwen2.5-coder', 'qwen2.5', 'llama3.2', 'mistral', 'gemma']
export const RE_MODELLO_VISION = /vision|llava|minicpm-v|ocr/i

export let modelloAttivo: string | null = null
export const scegliModello = async (): Promise<string | null> => {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) return null
    const nomi = ((await r.json() as { models: { name: string }[] }).models).map(m => m.name)
    for (const pref of MODELLI_PREFERITI) {
      const hit = nomi.find(n => (n === pref || n.startsWith(pref)) && !RE_MODELLO_VISION.test(n))
      if (hit) { modelloAttivo = hit; return hit }
    }
    modelloAttivo = nomi.find(n => !RE_MODELLO_VISION.test(n)) ?? null
    return modelloAttivo
  } catch { modelloAttivo = null; return null }
}
export const ollamaAttivo = async (): Promise<boolean> => (await scegliModello()) !== null

export const callOllamaJson = async (prompt: string): Promise<Record<string, unknown> | null> => {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelloAttivo ?? ASSIST_MODEL,
        messages: [{ role: 'user', content: prompt }],
        format: 'json',
        stream: false,
        keep_alive: '30m',
        options: { temperature: 0, num_ctx: 16384 },
      }),
      signal: AbortSignal.timeout(3 * 60 * 1000),
    })
    if (!r.ok) return null
    const d = await r.json() as { message?: { content: string } }
    return JSON.parse(d.message?.content ?? '') as Record<string, unknown>
  } catch { return null }
}

// ── FALLBACK VISION (Ollama locale) · scansioni illeggibili → tabella articoli ──
// Quando PaddleOCR non legge una pagina (testoGarbled), un modello VISION locale la
// ri-trascrive. A differenza dell'assist testuale qui servono proprio i modelli vision
// (che l'assist esclude): vince il primo installato tra i preferiti. Nessuno → '' (si
// tiene il testo PaddleOCR, com'era). Riconosce SOLO la tabella articoli, non i prezzi.
export let modelloVisionAttivo: string | null = null
// Ordine per VELOCITÀ prima che accuratezza: su GPU con poca VRAM (condivisa con i
// worker PaddleOCR) il modello vision gira in parte su CPU ed è lento; il 4B è il meno
// peggio. Resta comunque un ultimo-recupero, non la via normale.
export const MODELLI_VISION_PREFERITI = ['qwen3-vl', 'qwen2.5vl', 'qwen2.5-vl', 'minicpm-v', 'llama3.2-vision', 'llava']
// Il modello vision impazzisce (lentissimo, va in OOM) su immagini a piena risoluzione
// (~7 MP): l'immagine va rimpicciolita prima. 1400px è il compromesso tra leggibilità
// del testo e numero di patch/token da elaborare.
export const VISION_MAX_PX = Number(process.env.PADDLE_VISION_MAXPX) || 1400
// Timeout DURO: se il vision non risponde entro questo tempo si abbandona e si tiene il
// testo PaddleOCR — un fallback lento non deve mai bloccare l'intero batch.
export const VISION_TIMEOUT_MS = Number(process.env.PADDLE_VISION_TIMEOUT_MS) || 180_000
export const scegliModelloVision = async (): Promise<string | null> => {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(1500) })
    if (!r.ok) { modelloVisionAttivo = null; return null }
    const nomi = ((await r.json() as { models: { name: string }[] }).models).map(m => m.name)
    for (const pref of MODELLI_VISION_PREFERITI) {
      const hit = nomi.find(n => n === pref || n.startsWith(pref))
      if (hit) { modelloVisionAttivo = hit; return hit }
    }
    modelloVisionAttivo = null
    return null
  } catch { modelloVisionAttivo = null; return null }
}

export const PROMPT_VISION_ARTICOLI = `Sei un trascrittore OCR di tabelle di contratti edili italiani (elenco articoli / "Voci di tariffa").
Nella pagina c'è una tabella dove ogni riga ha: un CODICE TARIFFA (es. "B.03.025.a", "I.01.009", "B.05.030"), una DESCRIZIONE lunga (spesso in maiuscolo), e un'UNITÀ DI MISURA (m3, m2, kg, m, ml).
Trascrivi SOLO le righe articolo, una per riga, ESATTAMENTE in questo formato:
| CODICE | DESCRIZIONE | UM |
Regole tassative: copia codice e descrizione come sono scritti; NON inventare nulla; IGNORA del tutto le colonne di quantità, prezzo e importo se presenti; niente intestazioni, niente titoli, niente commenti — solo le righe con la barra verticale. Se nella pagina non ci sono righe articolo, rispondi con una riga vuota.`

// Rimpicciolisce un PNG a maxPx lato lungo e ne ritorna il base64. Node non ha librerie
// immagine (vincolo proxy: niente npm sharp/jimp), quindi si riusa PIL del venv OCR con
// un processo effimero — costa ~1s, ma solo sulle rare pagine illeggibili.
export const pngDownscaledBase64 = (imagePath: string, maxPx: number): Promise<string> =>
  new Promise((resolve) => {
    const code = [
      'from PIL import Image; import base64, io, sys',
      'im = Image.open(sys.argv[1]).convert("RGB")',
      's = min(1.0, float(sys.argv[2]) / max(im.size))',
      'im = im.resize((max(1,int(im.width*s)), max(1,int(im.height*s)))) if s < 1.0 else im',
      'b = io.BytesIO(); im.save(b, "PNG"); sys.stdout.write(base64.b64encode(b.getvalue()).decode())',
    ].join('\n')
    const p = spawn(PYTHON_BIN, ['-c', code, imagePath, String(maxPx)])
    let out = ''
    p.stdout.on('data', d => { out += d })
    p.on('close', () => resolve(out.trim()))
    p.on('error', () => resolve(''))
  })

// Circuit breaker: se il primo tentativo vision non produce nulla (nessun modello, oppure
// timeout perché la GPU è troppo carica), si DISATTIVA per il resto della sessione. Così una
// GPU incapace di reggere il vision non fa pagare VISION_TIMEOUT_MS a OGNI pagina illeggibile
// del batch (12 pagine × 3 min = 36 min persi); si degrada subito al solo PaddleOCR.
export let visionOff = false

// Ultimo-recupero: ri-trascrive la tabella articoli da un'immagine illeggibile via modello
// vision locale. Ritorna un blocco pipe "| cod | descr | um |" o '' (nessun modello / troppo
// lento / errore) — in tal caso si tiene il testo PaddleOCR, mai dati inventati al suo posto.
export const ocrVisionArticoli = async (imagePath: string): Promise<string> => {
  if (!(await scegliModelloVision())) { visionOff = true; return '' }
  const data = await pngDownscaledBase64(imagePath, VISION_MAX_PX)
  if (!data) return ''
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelloVisionAttivo,
        messages: [{ role: 'user', content: PROMPT_VISION_ARTICOLI, images: [data] }],
        stream: false,
        keep_alive: '30m',
        options: { temperature: 0, num_ctx: 8192 },
      }),
      signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    })
    if (!r.ok) return ''
    const d = await r.json() as { message?: { content: string } }
    const txt = (d.message?.content ?? '').trim()
    // tieni SOLO le righe a celle (la tabella), scarta eventuale prosa del modello
    const righe = txt.split('\n').filter(l => (l.match(/\|/g) ?? []).length >= 2)
    return righe.length ? righe.join('\n') : ''
  } catch (e) {
    // timeout / abort → GPU troppo lenta per il vision: spegnilo per il resto del batch
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      visionOff = true
      console.log(`[Vision] timeout (${Math.round(VISION_TIMEOUT_MS / 1000)}s): GPU troppo carica, fallback disattivato per questa sessione`)
    }
    return ''
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCANSIONE DIRETTA CON AI (pulsante "Scansiona con AI")
// ─────────────────────────────────────────────────────────────────────────────
// Trascrive l'INTERA pagina con il modello vision locale (Ollama), SALTANDO PaddleOCR.
// Serve quando la scansione è illeggibile all'OCR classico (grana/retino) o si vuole
// direttamente una trascrizione AI. A differenza del fallback automatico (ocrVisionArticoli,
// che estrae solo la tabella articoli e degrada in silenzio), qui l'utente l'ha chiesto
// esplicitamente → in caso di errore/timeout si SOLLEVA un'eccezione con messaggio chiaro
// (niente circuit-breaker silenzioso), così il frontend può mostrarlo.
export const VISION_PAGE_MAX_PX = Number(process.env.PADDLE_VISION_PAGE_MAXPX) || 2200
export const PROMPT_VISION_PAGINA = `Sei un trascrittore OCR di documenti italiani (contratti edili). Trascrivi FEDELMENTE tutto il testo della pagina in Markdown.
Regole tassative: copia ESATTAMENTE ciò che vedi, senza inventare, correggere o riassumere; mantieni l'ordine di lettura; numeri, codici, date e importi vanno copiati carattere per carattere; se c'è una tabella rendila come tabella Markdown a barre "| cella | cella |"; niente tue note o commenti, solo la trascrizione.`

export const ocrVisionPagina = async (image: ImmagineOcr): Promise<string> => {
  const modello = await scegliModelloVision()
  if (!modello) throw new Error('Nessun modello AI/vision installato in Ollama (es. qwen2.5vl, minicpm-v, llama3.2-vision). Installane uno con "ollama pull qwen2.5vl".')
  const tmp = path.join(os.tmpdir(), `vision-page-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
  await fs.writeFile(tmp, immagineInBuffer(image))
  try {
    const data = await pngDownscaledBase64(tmp, VISION_PAGE_MAX_PX)
    if (!data) throw new Error("Impossibile preparare l'immagine per il modello AI (PIL/venv non disponibile).")
    const r = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modello,
        messages: [{ role: 'user', content: PROMPT_VISION_PAGINA, images: [data] }],
        stream: false,
        keep_alive: '30m',
        options: { temperature: 0, num_ctx: 8192 },
      }),
      signal: AbortSignal.timeout(VISION_TIMEOUT_MS),
    })
    if (!r.ok) throw new Error(`Modello AI: risposta ${r.status} da Ollama.`)
    const d = await r.json() as { message?: { content: string } }
    const txt = cleanMarkdown((d.message?.content ?? '').trim())
    if (!txt) throw new Error('Il modello AI non ha restituito testo per questa pagina.')
    console.log(`[Vision pagina] ${modello}: ${txt.length}ch trascritti`)
    return txt
  } catch (e) {
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'))
      throw new Error(`Modello AI: timeout ${Math.round(VISION_TIMEOUT_MS / 1000)}s (GPU troppo carica per la scansione vision). Libera VRAM (meno PADDLE_WORKERS) o usa una GPU più capiente.`, { cause: e })
    throw e
  } finally {
    fs.unlink(tmp).catch(() => {})
  }
}
