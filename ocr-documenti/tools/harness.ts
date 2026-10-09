/**
 * Banco di prova offline della pipeline di estrazione.
 *
 * Perché: ogni modifica ai parser richiedeva di ripassare i PDF dal browser, ~1 min
 * per pagina, senza modo di confrontare il prima/dopo. Qui le pagine si rendono una
 * volta, l'OCR si mette in CACHE su disco e da lì in poi provare un parser costa
 * secondi — e il confronto è un diff.
 *
 * Uso:
 *   npm run harness                 # tutti i PDF in contratti/
 *   npm run harness -- Warm MADA    # solo i file il cui nome contiene Warm o MADA
 *   npm run harness -- --no-cache   # rifà l'OCR ignorando la cache
 *   npm run harness -- --no-nativo  # ignora il layer di testo: tutto all'OCR (confronto)
 *   npm run harness -- --assist     # abilita l'assist LLM (default: spento, non deterministico)
 *
 * Output in tests/out/<nome>/:
 *   ocr.txt          testo OCR completo (input esatto dei parser)
 *   alyante.json     JSON formato ALYANTE (quello che alimenta l'export xlsx)
 *   contratto.json   JSON formato CONTRATTO
 * più tests/out/_report.json + tabella riassuntiva a video.
 */
process.env.OCR_LIB_MODE = '1'                 // il server non deve mettersi in ascolto
process.env.PADDLE_VISION_FALLBACK ??= '0'     // vision = lento e non deterministico
if (!process.argv.includes('--assist')) process.env.OLLAMA_BASE = 'http://127.0.0.1:1'

import { createHash } from 'crypto'
import { spawn } from 'child_process'
import fs from 'fs/promises'
import { existsSync, readdirSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const DIR_CONTRATTI = path.join(ROOT, 'contratti')
const DIR_CACHE = path.join(ROOT, '.harness-cache')
const DIR_PAGINE = path.join(DIR_CACHE, 'pagine')
const DIR_OUT = path.join(ROOT, 'tests', 'out')
const PYTHON_BIN = process.env.PYTHON_BIN
  || (existsSync(path.join(ROOT, '.venv-gpu', 'Scripts', 'python.exe'))
    ? path.join(ROOT, '.venv-gpu', 'Scripts', 'python.exe')
    : path.join(ROOT, '.venv', 'Scripts', 'python.exe'))

const noCache = process.argv.includes('--no-cache')
// Misura di controllo: forza all'OCR anche le pagine native, così il prima/dopo del
// percorso nativo si legge sullo STESSO harness e sugli stessi parser.
const noNativo = process.argv.includes('--no-nativo')
const filtri = process.argv.slice(2).filter(a => !a.startsWith('--'))

const { ocrPaddle, componiTesto, setDumpBlocchi, estraiAssistito, strutturaAlyante, strutturaContratto, normalizzaRisultatoAlyante, testoGarbled, unisciMigliaiaSpazio } =
  await import('../server.ts')

const sha1 = (b: Buffer | string) => createHash('sha1').update(b).digest('hex')

// Rendering pagine → PNG, delegato a pypdfium2 (stessi pixel del frontend).
const rendiPagine = (pdf: string): Promise<string[]> => new Promise((resolve, reject) => {
  // PYTHONIOENCODING: senza, su Windows lo stdout di Python esce in cp1252 e node lo
  // decodifica come utf-8 — i nomi file con accenti o "°" tornano corrotti e il PNG poi
  // non si apre ("...4� stralcio...__p026.png").
  const p = spawn(PYTHON_BIN, [path.join(__dirname, 'render_pdf.py'), pdf, DIR_PAGINE], {
    cwd: ROOT,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  })
  let out = '', err = ''
  p.stdout.on('data', d => { out += d })
  p.stderr.on('data', d => { err += d })
  p.on('close', code => {
    if (code !== 0) return reject(new Error(`render_pdf.py (${code}): ${err.slice(-500)}`))
    try { resolve(JSON.parse(out.trim().split('\n').pop()!).pages) }
    catch { reject(new Error(`render_pdf.py: output illeggibile — ${out.slice(-300)}${err.slice(-300)}`)) }
  })
})

// OCR di una pagina, con cache su disco indicizzata dal contenuto del PNG: cambia
// il rendering → cambia l'hash → l'OCR si rifà da solo. Nessuna invalidazione manuale.
//
// In cache vanno i BLOCCHI dell'inferenza, non il testo: il testo contiene già la
// tabella ricostruita dai parser, quindi cachearlo congelava proprio ciò che si sta
// modificando (le prove sembravano "senza effetto"). Dai blocchi il testo si
// ricompone a ogni run in millisecondi.
const ocrConCache = async (png: string): Promise<string> => {
  const key = sha1(await fs.readFile(png))
  const cache = path.join(DIR_CACHE, 'blocchi', `${key}.json`)
  if (!noCache && existsSync(cache)) return componiTesto(JSON.parse(await fs.readFile(cache, 'utf8')))
  let blocchi: unknown = null
  setDumpBlocchi(b => { blocchi = b })
  const testo = await ocrPaddle((await fs.readFile(png)).toString('base64'))
  setDumpBlocchi(null)
  if (blocchi) {
    await fs.mkdir(path.dirname(cache), { recursive: true })
    await fs.writeFile(cache, JSON.stringify(blocchi), 'utf8')
  }
  return testo
}

// Layer nativo: stessa identica funzione che usa il frontend (src/lib/testo-nativo.ts),
// importata e non ricopiata. tools/render_pdf.py insegue a mano il rendering di App.tsx
// e diverge al primo ritocco: qui quell'errore non si ripete.
const { testoDaTextContent, docxHtmlATesto } = await import('../src/lib/testo-nativo.ts')
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

// Testo nativo pagina per pagina: `null` dove la pagina è una scansione e tocca all'OCR.
const layerNativo = async (file: string): Promise<(string | null)[]> => {
  try {
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(await fs.readFile(file)),
      isEvalSupported: false,               // stesse protezioni del frontend (vedi src/lib/pdf.ts)
      useSystemFonts: false,
    }).promise
    const out: (string | null)[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      out.push(testoDaTextContent((await page.getTextContent()).items as never[]))
      page.cleanup()
    }
    await pdf.destroy()
    return out
  } catch {
    return []                                   // PDF che pdf.js non apre → tutto OCR
  }
}

interface Esito {
  file: string
  pagine: number
  pagineNative: number      // pagine lette dal layer di testo, senza OCR
  paginePerse: number       // pagine con OCR illeggibile (garbled)
  caratteri: number
  righe: number
  righeSenzaCodice: number
  righeSenzaImporto: number
  testataVuota: string[]    // campi di testata rimasti vuoti
  importiVuoti: string[]
  errore?: string
}

const CAMPI_TESTATA = ['codice', 'codice_progetto', 'fornitore', 'fornitore_piva', 'tipologia_contratto', 'data_contratto', 'cond_pagamento', 'oggetto']
const CAMPI_IMPORTI = ['importo_lavori', 'importo_netto', 'importo_oneri_sicurezza', 'ritenuta_garanzia_percent']

const analizza = async (documento: string): Promise<Esito> => {
  const nome = path.basename(documento).replace(/\.(pdf|docx)$/i, '')
  const esito: Esito = { file: nome, pagine: 0, pagineNative: 0, paginePerse: 0, caratteri: 0, righe: 0, righeSenzaCodice: 0, righeSenzaImporto: 0, testataVuota: [], importiVuoti: [] }
  try {
    let full: string
    if (/\.docx$/i.test(documento)) {
      // Word: nessuna pagina e nessun OCR — il documento è già strutturato, e le tabelle
      // arrivano ai parser come righe intere invece che cella per cella.
      const mammoth = (await import('mammoth')).default
      const { value: html } = await mammoth.convertToHtml({ buffer: await fs.readFile(documento) })
      // Stessa normalizzazione che /api/ocr applica al testo nativo (origine: 'nativo'):
      // senza, il banco di prova misurerebbe una pipeline che l'app non esegue.
      full = unisciMigliaiaSpazio(docxHtmlATesto(html))
      esito.pagine = 1
      esito.pagineNative = 1
    } else {
      const nativi = noNativo ? [] : await layerNativo(documento)
      // Le pagine si rendono solo se almeno una va all'OCR: su un PDF interamente nativo
      // non si tocca né pdfium né la GPU.
      const pagine = nativi.length && nativi.every(Boolean) ? [] : await rendiPagine(documento)
      esito.pagine = Math.max(nativi.length, pagine.length)
      const testi: string[] = []
      for (let i = 0; i < esito.pagine; i++) {
        process.stdout.write(`\r  ${nome} — pagina ${i + 1}/${esito.pagine}   `)
        const nativo = nativi[i]
        if (nativo) { esito.pagineNative++; testi.push(unisciMigliaiaSpazio(nativo)); continue }
        const t = await ocrConCache(pagine[i])
        if (testoGarbled(t)) esito.paginePerse++
        testi.push(t)
      }
      full = testi.join('\n\n')
    }
    esito.caratteri = full.length

    const e = await estraiAssistito(full)
    const alyante = normalizzaRisultatoAlyante(strutturaAlyante(e))
    const contratto = strutturaContratto(e, full)

    // i campi si contano sul JSON FINALE: la normalizzazione sugli elenchi ufficiali
    // riempie ancora campi (commessa, divisione…), quindi leggerli prima dava per
    // mancanti campi che nell'export ci sono
    const fin = JSON.parse(alyante) as { testata: Record<string, string>; importi: Record<string, string> }
    esito.righe = e.righe.length
    esito.righeSenzaCodice = e.righe.filter(r => !String(r.codice_epu ?? '').trim()).length
    esito.righeSenzaImporto = e.righe.filter(r => !String(r.importo ?? '').trim()).length
    esito.testataVuota = CAMPI_TESTATA.filter(k => !String(fin.testata?.[k] ?? '').trim())
    esito.importiVuoti = CAMPI_IMPORTI.filter(k => !String(fin.importi?.[k] ?? '').trim())

    const dir = path.join(DIR_OUT, nome)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'ocr.txt'), full, 'utf8')
    await fs.writeFile(path.join(dir, 'alyante.json'), alyante, 'utf8')
    await fs.writeFile(path.join(dir, 'contratto.json'), contratto, 'utf8')
  } catch (err) {
    esito.errore = err instanceof Error ? err.message : String(err)
  }
  return esito
}

const documenti = readdirSync(DIR_CONTRATTI)
  .filter(f => /\.(pdf|docx)$/i.test(f))
  .filter(f => !filtri.length || filtri.some(x => f.toLowerCase().includes(x.toLowerCase())))
  .map(f => path.join(DIR_CONTRATTI, f))

if (!documenti.length) {
  console.error(`Nessun .pdf o .docx in ${DIR_CONTRATTI}${filtri.length ? ` per il filtro ${filtri.join(', ')}` : ''}`)
  process.exit(1)
}

console.log(`Banco di prova su ${documenti.length} contratti — cache: ${noCache ? 'IGNORATA' : DIR_CACHE}\n`)
const esiti: Esito[] = []
for (const documento of documenti) {
  const e = await analizza(documento)
  esiti.push(e)
  process.stdout.write('\r' + ' '.repeat(70) + '\r')
  console.log(e.errore
    ? `✗ ${e.file} — ${e.errore}`
    : `✓ ${e.file} — ${e.pagine}pp${e.pagineNative ? ` (${e.pagineNative} native)` : ''}${e.paginePerse ? ` (${e.paginePerse} illeggibili)` : ''}, ${e.righe} righe, testata mancante: ${e.testataVuota.join(',') || '—'}, importi mancanti: ${e.importiVuoti.join(',') || '—'}`)
}

await fs.mkdir(DIR_OUT, { recursive: true })
await fs.writeFile(path.join(DIR_OUT, '_report.json'), JSON.stringify(esiti, null, 2), 'utf8')
console.log(`\nReport → ${path.relative(ROOT, path.join(DIR_OUT, '_report.json'))}`)
process.exit(0)
