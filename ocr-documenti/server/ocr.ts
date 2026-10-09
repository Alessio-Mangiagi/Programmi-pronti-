// Motore OCR: pool di worker PaddleOCR (ocr_worker.py), composizione del testo,
// fallback vision sulle pagine illeggibili.
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { immagineInBuffer, type ImmagineOcr } from './immagine.ts'
import { existsSync } from 'fs'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import { OCR_WORKER, PYTHON_BIN, VISION_FALLBACK, ROOT } from './config.ts'
import { tabellaDaTsv } from './tabella-tsv.ts'
import { normalizzaNumeriOcr } from './testo.ts'
import { modelloVisionAttivo, ocrVisionArticoli, visionOff } from './ollama.ts'

// ── Pool di worker PaddleOCR persistenti ──
// Ogni worker carica il modello UNA volta (~5-10s) e processa le pagine in serie;
// il pool ne avvia fino a PADDLE_WORKERS (default 3) SOLO quando la coda lo richiede,
// così N pagine corrono in parallelo su N processi. Stesso modello e stessa inferenza
// del worker singolo: cambia solo chi esegue, non il risultato.
// Protocollo a righe JSON su stdin/stdout (vedi ocr_worker.py).
export type BloccoOcr = { text: string; conf: number; x: number; y: number; w: number; h: number }
export type SlotWorker = {
  proc: ReturnType<typeof spawn>
  ready: Promise<void>
  pending: Map<number, { resolve: (b: BloccoOcr[]) => void; reject: (e: Error) => void }>
}
export const POOL_MAX = Math.max(1, Number(process.env.PADDLE_WORKERS) || 3)
// Cartella di dump dei blocchi OCR per il banco di prova (vuota in esercizio).
export const OCR_DUMP_DIR = process.env.OCR_DUMP_DIR ?? ''
export const pool: SlotWorker[] = []
export let workerEngine = ''
// Perché l'OCR non è disponibile (worker morto prima del ready): il frontend lo
// mostra al posto di un generico "non trovato". Vuoto = nessun problema noto.
export let ocrErrore = ''
export let reqId = 0

// Thread CPU per worker: spartisce i core tra i processi del pool (senza questo ogni
// Paddle ne prenderebbe troppi e N worker si strozzerebbero a vicenda). Solo CPU;
// sulla GPU il parametro è ignorato dal worker.
export const CPU_THREADS = Math.max(2, Math.floor(os.cpus().length / POOL_MAX))

export const creaWorker = (): SlotWorker => {
  const proc = spawn(PYTHON_BIN, [OCR_WORKER], {
    cwd: ROOT,
    env: { ...process.env, PADDLE_CPU_THREADS: process.env.PADDLE_CPU_THREADS || String(CPU_THREADS) },
  })
  const n = pool.length + 1
  let buf = ''
  let workerErr = ''
  let readyResolve!: () => void, readyReject!: (e: Error) => void
  const ready = new Promise<void>((res, rej) => { readyResolve = res; readyReject = rej })
  ready.catch(() => {})   // evita unhandledRejection se nessuno è in attesa quando fallisce
  const slot: SlotWorker = { proc, ready, pending: new Map() }
  pool.push(slot)
  proc.stdout!.on('data', d => {
    buf += d.toString()
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        if (msg.ready) { workerEngine = msg.engine ?? 'PaddleOCR'; ocrErrore = ''; console.log(`[PaddleOCR] worker ${n}/${POOL_MAX} pronto: ${workerEngine}`); readyResolve(); continue }
        // il worker non parte (DLL bloccata, venv rotto…): messaggio umano, la traccia sta su stderr
        if (msg.fatal) { ocrErrore = String(msg.fatal); continue }
        const p = slot.pending.get(msg.id)
        if (!p) continue
        slot.pending.delete(msg.id)
        if (msg.error) p.reject(new Error(`PaddleOCR: ${msg.error}`))
        else p.resolve(msg.lines as BloccoOcr[])
      } catch { /* riga non-JSON (log sfuggito) → ignora */ }
    }
  })
  // stderr = log di Paddle (download modelli, warning): tenuto per la diagnosi dei crash
  proc.stderr!.on('data', d => { workerErr = (workerErr + d.toString()).slice(-2000) })
  // le richieste vengono scritte anche prima del ready (la pipe le bufferizza):
  // se il processo muore subito la write può fallire — l'errore vero arriva da close
  proc.stdin!.on('error', () => {})
  const fallisci = (err: Error) => {
    readyReject(err)
    for (const p of slot.pending.values()) p.reject(err)
    slot.pending.clear()
    const i = pool.indexOf(slot)
    if (i >= 0) pool.splice(i, 1)
  }
  proc.on('error', e => fallisci(new Error(`Worker PaddleOCR non avviabile (${PYTHON_BIN}): ${e.message}`)))
  proc.on('close', code => fallisci(new Error(ocrErrore || `Worker PaddleOCR terminato (codice ${code}): ${workerErr.slice(-400)}`)))
  return slot
}

// Worker meno carico; se tutti hanno già lavoro e c'è posto nel pool, ne avvia
// un altro (le scansioni da 1 pagina restano su un solo processo, niente RAM sprecata).
export const prendiWorker = (): SlotWorker => {
  if (!pool.length) return creaWorker()
  let scelto = pool[0]
  for (const s of pool) if (s.pending.size < scelto.pending.size) scelto = s
  if (scelto.pending.size > 0 && pool.length < POOL_MAX) return creaWorker()
  return scelto
}
process.on('exit', () => { for (const s of pool) s.proc.kill() })

// Blocchi rilevati → righe visuali per Y (stesso criterio di tabellaColonne).
export const righeDaBlocchi = (blocchi: BloccoOcr[]): BloccoOcr[][] => {
  const ordinati = [...blocchi].sort((a, b) => (a.y + a.h / 2) - (b.y + b.h / 2))
  const righe: { cy: number; blocchi: BloccoOcr[] }[] = []
  for (const b of ordinati) {
    const cy = b.y + b.h / 2
    const r = righe[righe.length - 1]
    if (r && cy - r.cy <= Math.max(8, b.h * 0.55)) r.blocchi.push(b)
    else righe.push({ cy, blocchi: [b] })
  }
  return righe.map(r => r.blocchi.sort((a, b) => a.x - b.x))
}

// TSV formato Tesseract dai blocchi PaddleOCR. Paddle rileva BLOCCHI di testo (una
// cella/segmento per box, spezzati sui salti orizzontali grandi — proprio dove la
// ricostruzione geometrica cerca i confini di colonna); le parole dentro un blocco
// vengono distribuite in proporzione ai caratteri, sufficiente per le X delle colonne.
export const tsvDaBlocchi = (righe: BloccoOcr[][]): string => {
  const out = ['level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext']
  righe.forEach((r, i) => {
    let nw = 0
    for (const b of r) {
      const parole = b.text.split(/\s+/).filter(Boolean)
      if (!parole.length) continue
      // caratteri totali, spazi inclusi, per ripartire la larghezza del blocco
      const totCh = parole.reduce((s, p) => s + p.length, 0) + (parole.length - 1)
      const px = totCh > 0 ? b.w / totCh : b.w
      let xCur = b.x
      for (const p of parole) {
        const wPx = Math.max(1, Math.round(px * p.length))
        out.push(`5\t1\t1\t1\t${i + 1}\t${++nw}\t${Math.round(xCur)}\t${b.y}\t${wPx}\t${b.h}\t${b.conf}\t${p}`)
        xCur += wPx + px   // +px: lo spazio tra le parole
      }
    }
  })
  return out.join('\n')
}

// Rileva testo OCR "illeggibile": le scansioni a grana/retino fine mandano PaddleOCR
// in salad di frammenti ("E0OO S a E09O CO ew RNE…"). Metrica calibrata su pagine reali
// di questo dataset: le pagine pulite hanno ~0,49-0,60 di "parole vere" (≥4 lettere, con
// vocale, senza cluster di 4+ consonanti — improbabile nell'italiano) e ~0,25-0,33 di
// token cortissimi; la pagina garbled misura ~0,19 parole vere e ~0,58 token corti.
// Le due soglie insieme (con ampio margine) separano i due casi senza falsi positivi.
export const testoGarbled = (testo: string): boolean => {
  const toks = testo.split(/\s+/).filter(Boolean)
  if (toks.length < 60) return false                       // pagina corta/sparsa: non giudicare
  let corti = 0, vere = 0
  for (const w of toks) {
    if (w.length <= 2) corti++
    const s = w.toLowerCase().replace(/[^a-zà-ù]/g, '')
    if (s.length >= 4 && /[aeiouàèéìòù]/.test(s) && !/[bcdfghjklmnpqrstvwxyz]{4,}/.test(s)) vere++
  }
  return vere / toks.length < 0.35 && corti / toks.length > 0.42
}

// Blocchi OCR → testo scorrevole + tabella articoli ricostruita. Tenuto separato
// dall'inferenza perché è l'unica parte che cambia quando si toccano i parser: il
// banco di prova (tools/harness.ts) mette in cache i BLOCCHI (l'inferenza, cara) e
// ricompone il testo a ogni modifica, gratis. La normalizzazione dei numeri è
// idempotente, quindi ripeterla qui è sicuro.
export const componiTesto = (blocchi: BloccoOcr[]): string => {
  for (const b of blocchi) b.text = normalizzaNumeriOcr(b.text)
  const righe = righeDaBlocchi(blocchi)
  const testo = righe.map(r => r.map(b => b.text).join(' ')).join('\n')
  const tabella = (() => { try { return tabellaDaTsv(tsvDaBlocchi(righe)) } catch { return '' } })()
  if (!tabella) {
    console.log(`[Tabella TSV] 0 articoli (txt:${testo.length}ch blocchi:${blocchi.length})`)
    return testo
  }
  console.log(`[Tabella TSV] ricostruiti ${tabella.split('\n').length} articoli (blocchi:${blocchi.length})`)
  return `${testo.trimEnd()}\n\n### TABELLA ARTICOLI (ricostruita dalla scansione)\n${tabella}\n`
}

// Aggancio per il banco di prova: riceve i blocchi grezzi di ogni pagina appena
// escono dall'inferenza, così la cache su disco conserva l'OCR e non il testo già
// ricostruito (che invece cambia ad ogni modifica dei parser).
export let dumpBlocchi: ((b: BloccoOcr[]) => void) | null = null
export const setDumpBlocchi = (f: ((b: BloccoOcr[]) => void) | null) => { dumpBlocchi = f }

// Blocco letto con poca sicurezza: PaddleOCR dà uno score 0-100 per riga rilevata.
// Sotto la soglia il revisore deve guardare: la cella in tabella si colora.
export const SOGLIA_INCERTO = Number(process.env.PADDLE_SOGLIA_INCERTO) || 90
export type BloccoIncerto = { testo: string; conf: number }
export type EsitoOcr = { testo: string; incerte: BloccoIncerto[] }

// Cache dell'inferenza su disco, indicizzata dall'hash dell'immagine: stessa pagina
// (stesso PDF, stesso rendering) → stessi blocchi, senza rifare l'OCR. «Rifai da capo»
// e un riprocesso dopo un riavvio costano zero. OCR_CACHE=0 la spegne; la cartella si
// può svuotare quando si vuole (si rigenera da sola).
export const OCR_CACHE_DIR = process.env.OCR_CACHE === '0' ? '' : (process.env.OCR_CACHE_DIR || path.join(ROOT, '.ocr-cache', 'blocchi'))
const leggiCache = async (chiave: string): Promise<BloccoOcr[] | null> => {
  if (!OCR_CACHE_DIR) return null
  const f = path.join(OCR_CACHE_DIR, `${chiave}.json`)
  if (!existsSync(f)) return null
  try { return JSON.parse(await fs.readFile(f, 'utf8')) as BloccoOcr[] } catch { return null }
}
const scriviCache = async (chiave: string, blocchi: BloccoOcr[]): Promise<void> => {
  if (!OCR_CACHE_DIR) return
  await fs.mkdir(OCR_CACHE_DIR, { recursive: true }).catch(() => {})
  await fs.writeFile(path.join(OCR_CACHE_DIR, `${chiave}.json`), JSON.stringify(blocchi)).catch(() => {})
}

// Blocchi sotto soglia con almeno due caratteri alfanumerici (un "|" o un "." letto
// male non interessa a nessuno).
const blocchiIncerti = (blocchi: BloccoOcr[]): BloccoIncerto[] =>
  blocchi
    .filter(b => b.conf < SOGLIA_INCERTO && (b.text.match(/[A-Za-z0-9À-ü]/g)?.length ?? 0) >= 2)
    .map(b => ({ testo: b.text, conf: Math.round(b.conf) }))

// Esegue PaddleOCR su un'immagine base64, restituisce il testo. Scrive un file
// temporaneo perché il worker legge da file; robusto su Windows. Il testo scorrevole
// e la tabella ricostruita geometricamente escono dalla STESSA passata di inferenza.
export const ocrPaddle = async (image: ImmagineOcr, dumpId?: string): Promise<string> =>
  (await ocrPaddleDettagli(image, dumpId)).testo

// Come ocrPaddle, ma con i blocchi letti male accanto al testo.
export const ocrPaddleDettagli = async (image: ImmagineOcr, dumpId?: string): Promise<EsitoOcr> => {
  const png = immagineInBuffer(image)
  const chiave = createHash('sha1').update(png).digest('hex')
  const tmp = path.join(os.tmpdir(), `paddle-${Date.now()}-${Math.random().toString(36).slice(2)}.png`)
  await fs.writeFile(tmp, png)
  try {
    const inCache = await leggiCache(chiave)
    const blocchi = inCache ?? await new Promise<BloccoOcr[]>((resolve, reject) => {
      // niente await sul ready: la richiesta va in pending SUBITO, così le pagine
      // successive vedono il carico reale e si distribuiscono sugli altri worker
      const slot = prendiWorker()
      const id = ++reqId
      slot.pending.set(id, { resolve, reject })
      slot.proc.stdin!.write(JSON.stringify({ id, path: tmp }) + '\n')
      // il singolo worker processa in SERIE: il timeout deve coprire anche
      // l'attesa in coda, quindi scala con la posizione nella coda di QUESTO
      // worker — 5 minuti per ogni pagina davanti + la propria (copre anche
      // il caricamento del modello al primo avvio).
      const timeoutMs = 300_000 * slot.pending.size
      setTimeout(() => { if (slot.pending.delete(id)) reject(new Error(`PaddleOCR: timeout sulla pagina (${Math.round(timeoutMs / 1000)}s)`)) }, timeoutMs)
    })
    if (inCache) console.log(`[OCR] pagina dalla cache (${chiave.slice(0, 8)}, ${blocchi.length} blocchi)`)
    else await scriviCache(chiave, blocchi.map(b => ({ ...b })))    // blocchi grezzi, prima della normalizzazione
    for (const b of blocchi) b.text = normalizzaNumeriOcr(b.text)
    const incerte = blocchiIncerti(blocchi)
    // Banco di prova (tools/harness): con OCR_DUMP_DIR i blocchi riconosciuti finiscono
    // su disco, così la ricostruzione geometrica e i parser si possono rigiocare offline
    // senza ripetere l'inferenza. Spento in esercizio (variabile non impostata).
    if (OCR_DUMP_DIR && dumpId) {
      await fs.mkdir(OCR_DUMP_DIR, { recursive: true }).catch(() => {})
      await fs.writeFile(path.join(OCR_DUMP_DIR, `${dumpId}.json`), JSON.stringify(blocchi)).catch(() => {})
    }
    const righe = righeDaBlocchi(blocchi)
    const testo = righe.map(r => r.map(b => b.text).join(' ')).join('\n')
    if (dumpBlocchi) dumpBlocchi(blocchi)
    // Scansione illeggibile (grana/retino) → PaddleOCR restituisce salad. Se è attivo un
    // modello vision locale, lo si usa per ri-trascrivere la TABELLA ARTICOLI da questa
    // pagina (codice tariffa + descrizione + UM; i prezzi non interessano). Costa solo
    // sulle pagine effettivamente illeggibili — le pagine pulite restano su PaddleOCR.
    if (VISION_FALLBACK && !visionOff && testoGarbled(testo)) {
      const vis = await ocrVisionArticoli(tmp)
      if (vis) {
        console.log(`[Vision] pagina illeggibile recuperata via ${modelloVisionAttivo}: ${vis.split('\n').length} righe articolo`)
        return { testo: `### TABELLA ARTICOLI (ricostruita dalla scansione)\n${vis}\n`, incerte: [] }
      }
      console.log(`[Vision] pagina illeggibile: recupero vision non riuscito — resta il testo PaddleOCR`)
    }
    return { testo: componiTesto(blocchi), incerte }
  } finally {
    fs.unlink(tmp).catch(() => {})
  }
}
