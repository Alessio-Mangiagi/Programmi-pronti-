// Fase A ALTERNATIVA del banco di prova: al posto di rasterizzare e passare all'OCR
// (render_ocr.py), prende il testo dal PERCORSO NATIVO — layer di testo dei PDF digitali
// e tabelle dei .docx — e lo scrive nella stessa struttura di cache, una pagina per file.
//
// Serve a misurare il prima/dopo del percorso nativo con lo strumento fedele all'app:
// run_pipeline.mjs manda UNA pagina per richiesta, come il frontend, e la regola
// "pagina di prosecuzione" (≥3 righe con coda valori → la pagina è una tabella) scatta
// solo così. tools/harness.ts invece dà ai parser il documento intero in un colpo e quel
// ramo non si attiva mai: usarlo per questo confronto sottostima entrambi i percorsi.
//
//   node tools/harness/render_nativo.mjs [filtro]
//   HARNESS_CACHE=tools/harness/cache-nativo node tools/harness/run_pipeline.mjs [filtro] --json dopo.json
//   node tools/harness/confronta.mjs tools/harness/prima.json dopo.json
//
// Nessun OCR, nessuna GPU, nessun server: è solo lettura di struttura già presente.
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { testoDaTextContent, docxHtmlATesto } from '../../src/lib/testo-nativo.ts'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
const CACHE = path.join(ROOT, 'cache-nativo')
const SRC = path.join(ROOT, '..', '..', 'contratti')
const filtro = (process.argv[2] ?? '').toLowerCase()

// stesso slug di render_ocr.py, o run_pipeline.mjs non ritrova le cartelle
const slug = (nome) => nome.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80)

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

// Pagine native del PDF: null dove la pagina è una scansione. Quelle pagine NON vengono
// scritte in cache — run_pipeline le salta e il confronto resta onesto: misura cosa
// aggiunge il percorso nativo, non cosa farebbe l'OCR al posto suo.
const paginePdf = async (file) => {
  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await fs.readFile(file)),
    isEvalSupported: false,                 // stesse protezioni del frontend (vedi src/lib/pdf.ts)
    useSystemFonts: false,
  }).promise
  // "><(((º> sabusabu <º)))><"
  const out = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    out.push(testoDaTextContent((await page.getTextContent()).items))
    page.cleanup()
  }
  await pdf.destroy()
  return out
}

const pagineDocx = async (file) => {
  const mammoth = (await import('mammoth')).default
  const { value: html } = await mammoth.convertToHtml({ buffer: await fs.readFile(file) })
  // il Word non ha pagine: tutto il documento è una "pagina" sola
  return [docxHtmlATesto(html)]
}

const documenti = (await fs.readdir(SRC))
  .filter(f => /\.(pdf|docx)$/i.test(f))
  .filter(f => !filtro || f.toLowerCase().includes(filtro))

if (!documenti.length) {
  console.error(`Nessun .pdf o .docx in ${SRC}${filtro ? ` per il filtro "${filtro}"` : ''}`)
  process.exit(1)
}

let totNative = 0
let totPagine = 0
for (const nome of documenti) {
  const file = path.join(SRC, nome)
  const dir = path.join(CACHE, slug(nome))
  const pagine = /\.docx$/i.test(nome) ? await pagineDocx(file) : await paginePdf(file)
  if (existsSync(dir)) await fs.rm(dir, { recursive: true, force: true })
  await fs.mkdir(dir, { recursive: true })
  let native = 0
  for (const [i, testo] of pagine.entries()) {
    if (!testo) continue
    await fs.writeFile(path.join(dir, `p${String(i + 1).padStart(3, '0')}.txt`), testo, 'utf8')
    native++
  }
  // La cache si autodescrive: run_pipeline legge questo file e dichiara `origine` al
  // server, cosi' il testo nativo non viene scambiato per testo gia' uscito da un OCR.
  if (native) await fs.writeFile(path.join(dir, 'origine.txt'), 'nativo', 'utf8')
  totNative += native
  totPagine += pagine.length
  console.log(`${nome.slice(0, 58).padEnd(58)} ${String(native).padStart(3)}/${String(pagine.length).padEnd(3)} pagine native`)
}
console.log(`\n${totNative}/${totPagine} pagine native → ${path.relative(path.join(ROOT, '..', '..'), CACHE)}`)
