// Lavori lato server: il browser carica il PDF una volta e il server fa tutto il resto
// (testo nativo, rendering, OCR, confronto con la bozza, estrazione). Lo stato vive su
// disco in _lavori/<id>/ e si segue via SSE o GET: si può chiudere la scheda, cambiare
// PC, tornare dopo — il lavoro continua e il risultato resta.
//
// Prima il browser orchestrava pagina per pagina mandando immagini base64: chiusa la
// scheda, il lavoro moriva a metà. Qui la pipeline è la stessa del banco di prova
// (tools/harness.ts): stesso rendering (render_pdf.py), stesso layer nativo
// (src/lib/testo-nativo), stesso OCR con cache.
import path from 'path'
// "><(((º> sabusabu <º)))><"
import fs from 'fs/promises'
import { existsSync, createReadStream } from 'fs'
import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import type express from 'express'
import { ROOT, PYTHON_BIN } from './config.ts'
import { POOL_MAX, ocrPaddleDettagli, type BloccoIncerto } from './ocr.ts'
import { splitPageTiles, unisciMigliaiaSpazio } from './testo.ts'
import { estraiAssistito } from './assist.ts'
import { strutturaAlyante, strutturaContratto } from './struttura.ts'
import { normalizzaRisultatoAlyante } from './alyante.ts'
import { confrontaTesti, type Confronto } from '../src/lib/confronto.ts'
import { testoDaTextContent, type ItemPdfTesto } from '../src/lib/testo-nativo.ts'
import { cleanMarkdown } from '../src/lib/markdown.ts'

export type FormatoLavoro = 'contratti' | 'contract' | 'md'
export type StatoLavoro = 'attesa_file' | 'in_coda' | 'in_corso' | 'fatto' | 'errore' | 'annullato'
export interface Incerta { pagina: number; testo: string; conf: number }
export interface RisultatoLavoro {
  json: string                       // JSON estratto (contratti/contract) o il testo (md)
  formato: FormatoLavoro
  testo: string                      // testo pagina per pagina (separatore ---), già unito con la bozza
  confronto?: Confronto & { bozza: string }
  incerte: Incerta[]
  pagineNative: number
}
export interface Lavoro {
  id: string
  nome: string                       // nome del file nel browser
  chiaveFile: string                 // `${nome}|${size}|${lastModified}`: riaggancio dopo un reload
  formato: FormatoLavoro
  stato: StatoLavoro
  fase: string                       // testo breve per la barra: "OCR pagina 4/20"
  pagina: number
  pagine: number
  creato: number
  aggiornato: number
  errore?: string
  risultato?: RisultatoLavoro
  // non serializzati nella lista
  testoAllegati?: string
  bozza?: { nome: string; testo: string }
}

const DIR_LAVORI = process.env.LAVORI_DIR || path.join(ROOT, '_lavori')
const RITENZIONE_MS = (Number(process.env.LAVORI_RITENZIONE_GIORNI) || 7) * 86_400_000
const dirDi = (id: string) => path.join(DIR_LAVORI, id)
const fileDi = (id: string) => path.join(dirDi(id), 'file.pdf')
const statoDi = (id: string) => path.join(dirDi(id), 'lavoro.json')

const lavori = new Map<string, Lavoro>()
const ascoltatori = new Map<string, Set<(l: Lavoro) => void>>()
const coda: string[] = []
let inCorso: string | null = null
const annullati = new Set<string>()

const salva = async (l: Lavoro) => {
  l.aggiornato = Date.now()
  await fs.mkdir(dirDi(l.id), { recursive: true })
  await fs.writeFile(statoDi(l.id), JSON.stringify(l), 'utf8')
  for (const f of ascoltatori.get(l.id) ?? []) f(l)
}
const aggiorna = async (l: Lavoro, patch: Partial<Lavoro>) => { Object.assign(l, patch); await salva(l) }

// Versione "pubblica": senza allegati/bozza (pesanti) e, se richiesto, senza risultato.
export const pubblico = (l: Lavoro, conRisultato = true): Omit<Lavoro, 'testoAllegati' | 'bozza'> => {
  const { testoAllegati: _a, bozza: _b, ...resto } = l
  return conRisultato ? resto : { ...resto, risultato: undefined }
}

export const lavoriInCorso = (): number => coda.length + (inCorso ? 1 : 0)
export const elencoLavori = (): Lavoro[] => [...lavori.values()].sort((a, b) => b.creato - a.creato)
export const lavoro = (id: string): Lavoro | undefined => lavori.get(id)

// All'avvio: ricarica i lavori da disco; quelli rimasti a metà (server caduto) tornano
// in coda; quelli vecchi si buttano.
export const caricaLavori = async (): Promise<void> => {
  if (!existsSync(DIR_LAVORI)) return
  for (const id of await fs.readdir(DIR_LAVORI)) {
    try {
      const l = JSON.parse(await fs.readFile(statoDi(id), 'utf8')) as Lavoro
      if (Date.now() - l.aggiornato > RITENZIONE_MS) { await fs.rm(dirDi(id), { recursive: true, force: true }); continue }
      lavori.set(id, l)
      if (l.stato === 'in_corso' || l.stato === 'in_coda') {
        if (existsSync(fileDi(id))) { l.stato = 'in_coda'; coda.push(id) }
        else { l.stato = 'errore'; l.errore = 'file perso al riavvio' }
      }
    } catch { await fs.rm(dirDi(id), { recursive: true, force: true }).catch(() => {}) }
  }
  if (coda.length) console.log(`[Lavori] ${coda.length} lavor${coda.length === 1 ? 'o' : 'i'} ripres${coda.length === 1 ? 'o' : 'i'} dopo il riavvio`)
  void avanza()
}

export const creaLavoro = async (dati: { nome: string; chiaveFile: string; formato: FormatoLavoro; testoAllegati?: string; bozza?: { nome: string; testo: string } }): Promise<Lavoro> => {
  const l: Lavoro = {
    id: randomUUID(), nome: dati.nome, chiaveFile: dati.chiaveFile, formato: dati.formato,
    stato: 'attesa_file', fase: 'in attesa del file', pagina: 0, pagine: 0,
    creato: Date.now(), aggiornato: Date.now(),
    testoAllegati: dati.testoAllegati || undefined, bozza: dati.bozza,
  }
  lavori.set(l.id, l)
  await salva(l)
  return l
}

export const ricevutoFile = async (id: string, corpo: Buffer): Promise<Lavoro | null> => {
  const l = lavori.get(id)
  if (!l || l.stato !== 'attesa_file') return null
  await fs.mkdir(dirDi(id), { recursive: true })
  await fs.writeFile(fileDi(id), corpo)
  await aggiorna(l, { stato: 'in_coda', fase: coda.length || inCorso ? `in coda (${lavoriInCorso()} prima)` : 'in coda' })
  coda.push(id)
  void avanza()
  return l
}

export const annullaLavoro = async (id: string): Promise<boolean> => {
  const l = lavori.get(id)
  if (!l) return false
  const i = coda.indexOf(id)
  if (i >= 0) coda.splice(i, 1)
  if (inCorso === id) annullati.add(id)
  else {
    lavori.delete(id)
    ascoltatori.delete(id)
    await fs.rm(dirDi(id), { recursive: true, force: true }).catch(() => {})
  }
  if (inCorso === id) await aggiorna(l, { stato: 'annullato', fase: 'annullato' })
  return true
}

export const ascolta = (id: string, f: (l: Lavoro) => void): (() => void) => {
  if (!ascoltatori.has(id)) ascoltatori.set(id, new Set())
  ascoltatori.get(id)!.add(f)
  return () => { ascoltatori.get(id)?.delete(f) }
}

export const streamFile = (id: string) => existsSync(fileDi(id)) ? createReadStream(fileDi(id)) : null

// ── Pipeline ─────────────────────────────────────────────────────────────────

// Layer di testo del PDF, pagina per pagina: `null` dove non c'è (scansione → OCR).
// Stessa funzione del frontend e del banco di prova (src/lib/testo-nativo).
const layerNativo = async (file: string): Promise<(string | null)[]> => {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(file)), isEvalSupported: false, useSystemFonts: false }).promise
    const out: (string | null)[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      try { out.push(testoDaTextContent((await page.getTextContent()).items as ItemPdfTesto[])) }
      catch { out.push(null) }
      finally { page.cleanup() }
    }
    await pdf.destroy()
    return out
  } catch {
    return []
  }
}

// Rendering delle pagine in PNG con tools/render_pdf.py (pypdfium2): STESSI pixel del
// browser, così l'OCR — e la sua cache — coincidono con la scansione dal browser.
const rendiPagine = (pdf: string, dir: string): Promise<string[]> => new Promise((resolve, reject) => {
  const p = spawn(PYTHON_BIN, [path.join(ROOT, 'tools', 'render_pdf.py'), pdf, dir], { cwd: ROOT, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } })
  let out = '', err = ''
  p.stdout.on('data', d => { out += d })
  p.stderr.on('data', d => { err += d })
  p.on('error', e => reject(new Error(`render_pdf.py non avviabile: ${e.message}`)))
  p.on('close', code => {
    if (code !== 0) return reject(new Error(`render_pdf.py (${code}): ${err.slice(-400)}`))
    try { resolve((JSON.parse(out.trim().split('\n').pop()!) as { pages: string[] }).pages) }
    catch { reject(new Error(`render_pdf.py: output illeggibile — ${out.slice(-200)}${err.slice(-200)}`)) }
  })
})

const conteggioPagine = async (file: string): Promise<number> => {
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fs.readFile(file)), isEvalSupported: false, useSystemFonts: false }).promise
    const n = pdf.numPages
    await pdf.destroy()
    return n
  } catch { return 0 }
}

class Annullato extends Error { constructor() { super('annullato') } }

const esegui = async (l: Lavoro): Promise<void> => {
  const controlla = () => { if (annullati.has(l.id)) throw new Annullato() }
  const file = fileDi(l.id)
  await aggiorna(l, { stato: 'in_corso', fase: 'lettura del testo del PDF', pagina: 0 })

  // 1) testo nativo dove c'è, OCR altrove
  const nativi = await layerNativo(file)
  const pagine = nativi.length || await conteggioPagine(file)
  if (!pagine) throw new Error('PDF non leggibile: nessuna pagina')
  await aggiorna(l, { pagine, fase: nativi.every(Boolean) && nativi.length ? 'testo nativo' : 'rendering delle pagine' })
  controlla()
  const daOcr = Array.from({ length: pagine }, (_, i) => i).filter(i => !nativi[i])
  let png: string[] = []
  if (daOcr.length) {
    png = await rendiPagine(file, path.join(dirDi(l.id), 'pagine'))
    if (png.length < pagine) throw new Error(`rendering incompleto: ${png.length}/${pagine} pagine`)
  }
  controlla()

  const testi: string[] = new Array(pagine)
  const incerte: Incerta[] = []
  let fatte = 0
  const unaPagina = async (i: number) => {
    controlla()
    const nativo = nativi[i]
    if (nativo) {
      // stessa normalizzazione di /api/ocr per il testo nativo (origine: 'nativo')
      testi[i] = cleanMarkdown(unisciMigliaiaSpazio(nativo))
    } else {
      const b64 = (await fs.readFile(png[i])).toString('base64')
      const esito = await ocrPaddleDettagli(b64)
      testi[i] = esito.testo
      incerte.push(...esito.incerte.map((b: BloccoIncerto) => ({ pagina: i + 1, testo: b.testo, conf: b.conf })))
    }
    fatte++
    await aggiorna(l, { pagina: fatte, fase: nativo ? `testo nativo ${fatte}/${pagine}` : `OCR pagina ${fatte}/${pagine}` })
  }
  // le pagine OCR in parallelo quanti sono i worker; le native costano nulla
  let prossima = 0
  const lavoratore = async () => { while (prossima < pagine) await unaPagina(prossima++) }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(POOL_MAX, pagine)) }, lavoratore))
  controlla()
  incerte.sort((a, b) => a.pagina - b.pagina)
  if (png.length) await fs.rm(path.join(dirDi(l.id), 'pagine'), { recursive: true, force: true }).catch(() => {})

  // 2) testo pagina per pagina, poi la bozza Word: vale il PDF, il Word dove coincidono
  let testo = testi.join('\n\n---\n\n')
  let confronto: RisultatoLavoro['confronto']
  if (l.bozza?.testo) {
    await aggiorna(l, { fase: 'confronto con la bozza Word' })
    const c = confrontaTesti(l.bozza.testo, testo)
    testo = c.testoUnito
    confronto = { ...c, bozza: l.bozza.nome }
  }
  if (!testo.trim()) throw new Error('scansione vuota, nessun testo riconosciuto')

  // 3) estrazione: stessa strada di /api/ocr col testo
  await aggiorna(l, { fase: 'estrazione dei dati' })
  let json = testo
  let formato: FormatoLavoro = l.formato
  if (l.formato === 'contratti' || l.formato === 'contract') {
    const joined = [splitPageTiles(testo).join('\n\n'), l.testoAllegati?.trim()].filter(Boolean).join('\n\n')
    const e = await estraiAssistito(joined)
    controlla()
    if (l.formato === 'contratti') {
      json = normalizzaRisultatoAlyante(strutturaAlyante(e))
      // nessuna voce d'elenco prezzi → almeno la testata, come una riga contratto
      let righe = 0
      try { righe = ((JSON.parse(json) as { righe?: unknown[] }).righe ?? []).length } catch { /* json non parsabile: si tiene */ }
      if (!righe) { json = strutturaContratto(e, joined); formato = 'contract' }
    } else {
      json = strutturaContratto(e, joined)
    }
  }
  await aggiorna(l, {
    stato: 'fatto', fase: 'fatto', pagina: pagine,
    risultato: { json, formato, testo, confronto, incerte, pagineNative: nativi.filter(Boolean).length },
  })
  console.log(`[Lavori] ${l.nome}: fatto (${pagine} pagine, ${nativi.filter(Boolean).length} native, ${incerte.length} letture incerte)`)
}

const avanza = async (): Promise<void> => {
  if (inCorso || !coda.length) return
  const id = coda.shift()!
  const l = lavori.get(id)
  if (!l) return void avanza()
  inCorso = id
  try {
    await esegui(l)
  } catch (err: unknown) {
    if (err instanceof Annullato || annullati.has(id)) {
      annullati.delete(id)
      lavori.delete(id)
      ascoltatori.delete(id)
      await fs.rm(dirDi(id), { recursive: true, force: true }).catch(() => {})
      console.log(`[Lavori] ${l.nome}: annullato`)
    } else {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[Lavori] ${l.nome}: errore — ${msg}`)
      await aggiorna(l, { stato: 'errore', fase: 'errore', errore: msg }).catch(() => {})
    }
  } finally {
    inCorso = null
    // chi è ancora in coda vede la posizione aggiornata
    for (const [k, altro] of coda.entries()) if (lavori.get(altro)) void aggiorna(lavori.get(altro)!, { fase: k ? `in coda (${k} prima)` : 'in coda' })
    void avanza()
  }
}

// ── Rotte ────────────────────────────────────────────────────────────────────
export const montaRotteLavori = (app: express.Express, raw: express.RequestHandler): void => {
  app.get('/api/lavori', (_req, res) => {
    res.json(elencoLavori().map(l => ({ ...pubblico(l, false), haRisultato: !!l.risultato })))
  })

  app.post('/api/lavori', async (req, res) => {
    const b = req.body as { nome?: string; chiaveFile?: string; formato?: string; testoAllegati?: string; bozza?: { nome: string; testo: string } }
    if (!b?.nome || !b.chiaveFile) return res.status(400).json({ error: 'nome e chiaveFile obbligatori' })
    const formato = (['contratti', 'contract', 'md'] as const).find(f => f === b.formato)
    if (!formato) return res.status(400).json({ error: `formato non gestito lato server: ${b.formato}` })
    const l = await creaLavoro({ nome: b.nome, chiaveFile: b.chiaveFile, formato, testoAllegati: b.testoAllegati, bozza: b.bozza })
    res.json({ id: l.id })
  })

  app.put('/api/lavori/:id/file', raw, async (req, res) => {
    const corpo = req.body as Buffer
    if (!Buffer.isBuffer(corpo) || !corpo.length) return res.status(400).json({ error: 'file vuoto' })
    const l = await ricevutoFile(String(req.params.id), corpo)
    if (!l) return res.status(404).json({ error: 'lavoro non trovato o file già ricevuto' })
    res.json(pubblico(l))
  })

  app.get('/api/lavori/:id', (req, res) => {
    const l = lavori.get(String(req.params.id))
    if (!l) return res.status(404).json({ error: 'lavoro non trovato' })
    res.json(pubblico(l))
  })

  app.get('/api/lavori/:id/file', (req, res) => {
    const l = lavori.get(String(req.params.id))
    const s = l && streamFile(l.id)
    if (!l || !s) return res.status(404).json({ error: 'file non trovato' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(l.nome)}`)
    s.pipe(res)
  })

  // SSE: stato subito, poi a ogni cambiamento; chiude quando il lavoro finisce.
  app.get('/api/lavori/:id/eventi', (req, res) => {
    const l = lavori.get(String(req.params.id))
    if (!l) return res.status(404).json({ error: 'lavoro non trovato' })
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()
    const manda = (x: Lavoro) => {
      // il risultato può pesare: arriva solo con l'ultimo evento
      res.write(`data: ${JSON.stringify(pubblico(x, x.stato === 'fatto'))}\n\n`)
      if (x.stato === 'fatto' || x.stato === 'errore' || x.stato === 'annullato') { stacca(); res.end() }
    }
    const stacca = ascolta(l.id, manda)
    const battito = setInterval(() => res.write(': ping\n\n'), 20_000)
    req.on('close', () => { stacca(); clearInterval(battito) })
    manda(l)
  })

  app.delete('/api/lavori/:id', async (req, res) => {
    const ok = await annullaLavoro(String(req.params.id))
    if (!ok) return res.status(404).json({ error: 'lavoro non trovato' })
    res.json({ ok: true })
  })
}
