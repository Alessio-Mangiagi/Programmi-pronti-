// Lettura dei file in coda: riconoscimento del tipo, rendering delle pagine PDF in
// PNG per l'OCR, testo dal layer nativo, Word → testo, miniature e firma del contenuto.
import { apriPdf, type PDFDocumentProxy } from './pdf'
import { docxHtmlATesto, testoDaTextContent, type ItemPdfTesto } from './testo-nativo'
import type { FileKind } from './formati'

// Miniatura della prima pagina e numero di pagine: colonna «Pagine» della coda e
// anteprima al passaggio del mouse.
// `firma`: i token con cifre (codici, importi, date, P.IVA) delle prime pagine. Serve ad
// abbinare bozza Word e PDF quando i nomi non si somigliano: due documenti dello
// stesso contratto condividono quei numeri, due contratti diversi dallo stesso modello no.
export interface MetaFile { pagine?: number; miniatura?: string; firma?: string[] }

export const firmaDelTesto = (testo: string): string[] => {
  const out = new Set<string>()
  for (const t of testo.toLowerCase().split(/[\s|]+/)) {
    const p = t.replace(/^[^0-9a-zà-ü]+|[^0-9a-zà-ü]+$/g, '')
    if ((p.match(/\d/g)?.length ?? 0) >= 3 && p.length <= 40) out.add(p)
    if (out.size >= 300) break
  }
  return [...out]
}
// |A∩B| / min(|A|,|B|): con almeno 3 token in comune e metà del più piccolo
export const contenutiSimili = (a?: string[], b?: string[]): boolean => {
  if (!a?.length || !b?.length) return false
  const sb = new Set(b)
  const comuni = a.filter(x => sb.has(x)).length
  return comuni >= 3 && comuni / Math.min(a.length, b.length) >= 0.5
}


// Esegue `task(i)` per i in [0,n) con al più `conc` in volo insieme.
// Risultati indicizzati per i (ordine preservato). Il parallelismo si allinea al pool
// di worker PaddleOCR del backend (campo `workers` di /api/health): con meno pagine
// in volo dei worker il pool resta mezzo fermo, con più pagine si accodano soltanto.
export const runPool = async <T,>(n: number, conc: number, task: (i: number) => Promise<T>): Promise<T[]> => {
  const results: T[] = new Array(n)
  let next = 0
  const worker = async () => {
    while (true) {
      const i = next++
      if (i >= n) return
      results[i] = await task(i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(conc, n) }, worker))
  return results
}

// OCR: alta risoluzione + lossless. Niente JPEG (sbava cifre/glifi sottili),
// niente downscale aggressivo: ~3300px sul lato lungo ≈ 280-300 DPI reali su A4,
// la risoluzione che il motore OCR preferisce (più lento, ma codici/numeri molto più affidabili).
export const MAX_PX = 3300

// Esce un Blob e non base64: `toBlob` codifica il PNG fuori dal thread principale
// (con `toDataURL` la UI si bloccava ~200 ms a pagina) e il corpo della richiesta
// viaggia in byte grezzi, senza il +33% del base64 (vedi corpoOcrBinario in App.tsx).
export const canvasToPng = (src: HTMLCanvasElement, maxPx = MAX_PX): Promise<Blob> => {
  let { width: w, height: h } = src
  if (w > maxPx) { h = Math.round(h * maxPx / w); w = maxPx }
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  // Preprocessing: grayscale + contrast boost migliora l'OCR su scansioni sbiadite
  ctx.filter = 'contrast(1.35) grayscale(1) brightness(1.08)'
  ctx.drawImage(src, 0, 0, w, h)
  ctx.filter = 'none'
  // PNG (lossless): nessun artefatto di compressione sul testo.
  return new Promise((resolve, reject) =>
    out.toBlob(b => (b ? resolve(b) : reject(new Error('Conversione della pagina in PNG fallita'))), 'image/png'))
}

// Legge un file immagine e lo converte in PNG pronto per l'OCR.
export const imageFileToPng = (f: File): Promise<Blob[]> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      const image = new Image()
      image.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        canvas.getContext('2d')!.drawImage(image, 0, 0)
        canvasToPng(canvas).then(png => resolve([png]), reject)
      }
      image.onerror = () => reject(new Error('Immagine non leggibile o formato non supportato'))
      image.src = e.target!.result as string
    }
    reader.onerror = reject
    reader.readAsDataURL(f)
  })

export const renderPdfPage = async (pdf: PDFDocumentProxy, pageNum: number): Promise<Blob[]> => {
  const page = await pdf.getPage(pageNum)
  const natural = page.getViewport({ scale: 1.0 })
  // cap 4.0: un A4 (842pt) arriva così a ~3300px ≈ 300 DPI reali (col vecchio 2.5 usciva a ~180 DPI)
  const scale = Math.min(4.0, MAX_PX / Math.max(natural.width, natural.height))
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(vp.width)
  canvas.height = Math.floor(vp.height)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport: vp }).promise
  const png = await canvasToPng(canvas)
  // Free canvas memory to avoid OOM on large PDFs
  canvas.width = 0
  canvas.height = 0
  page.cleanup()
  return [png]
}

// Testo della pagina dal layer nativo del PDF, o null se la pagina è una scansione e
// va mandata all'OCR. La decisione è PER PAGINA: un contratto firmato con l'elenco
// prezzi esportato in digitale porta le due nature nello stesso file (misurato: il
// contratto Beton Strade è nativo su 25 pagine e scansione sulle 3 delle firme).
export const testoDaLayerPdf = async (pdf: PDFDocumentProxy, pageNum: number): Promise<string | null> => {
  const page = await pdf.getPage(pageNum)
  try {
    return testoDaTextContent((await page.getTextContent()).items as ItemPdfTesto[])
  } catch {
    return null                                   // PDF protetto o layer illeggibile → OCR
  } finally {
    page.cleanup()
  }
}

// Word → testo a righe con le TABELLE intatte. `mammoth.extractRawText`, che questo
// percorso usava, manda ogni cella su un paragrafo suo: la coda "[U.M.] quantità prezzo
// [importo]" che i parser cercano su una riga sola non si forma mai e l'elenco prezzi
// esce vuoto. Vedi src/lib/testo-nativo.ts.
export const docxATesto = async (f: File): Promise<string> => {
  // mammoth legge solo l'OOXML: il .doc binario (Word 97-2003) non è convertibile e
  // fallirebbe con un errore oscuro a metà scansione.
  if (/\.doc$/i.test(f.name)) {
    throw new Error(`"${f.name}": il formato .doc (Word 97-2003) non è leggibile. Aprilo in Word e salvalo come .docx.`)
  }
  const mammoth = (await import('mammoth')).default
  const buf = await f.arrayBuffer()
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf })
  const testo = docxHtmlATesto(html)
  if (testo.trim()) return testo
  // documento senza struttura riconoscibile: il testo grezzo è comunque meglio di niente
  return (await mammoth.extractRawText({ arrayBuffer: buf })).value
}

export function detectKind(f: File): FileKind {
  if (f.type === 'application/pdf') return 'pdf'
  if (f.type.startsWith('image/')) return 'image'
  if (
    f.name.toLowerCase().endsWith('.docx') ||
    f.type.includes('wordprocessingml') ||
    f.type === 'application/msword'
  ) return 'docx'
  if (
    f.name.toLowerCase().endsWith('.xlsx') ||
    f.name.toLowerCase().endsWith('.xls') ||
    f.type.includes('spreadsheetml') ||
    f.type === 'application/vnd.ms-excel'
  ) return 'excel'
  if (
    /\.(md|markdown|txt)$/i.test(f.name) ||
    f.type === 'text/markdown' ||
    f.type === 'text/plain'
  ) return 'text'
  return null
}

// Chiave stabile di un file in coda (lo stesso PDF caricato due volte è lo stesso file)
export const chiaveFile = (f: File) => `${f.name}|${f.size}|${f.lastModified}`

// Parole significative del nome di un file, per abbinare fra loro i file dello stesso
// contratto ("…NOLO A FREDDO OTTOMARZO…"), che è come sono nominati in pratica.
export const paroleNome = (n: string) => new Set(n.replace(/\.[^.]+$/, '').toLowerCase()
  .split(/[^a-zà-ü0-9]+/).filter(w => w.length >= 4))
export const nomiSimili = (a: string, b: string) => {
  const pa = paroleNome(a)
  return [...paroleNome(b)].filter(w => pa.has(w)).length >= 2
}

// Miniatura della prima pagina e numero di pagine di un file della coda. Non rigetta
// mai: un file illeggibile resta senza miniatura, la coda non si ferma per questo.
// 360px di larghezza bastano all'anteprima in hover e pesano ~40 KB in JPEG.
export const LARGHEZZA_MINIATURA = 360
export const miniaturaFile = async (f: File): Promise<MetaFile> => {
  const kind = detectKind(f)
  try {
    if (kind === 'pdf') {
      const pdf = await apriPdf(await f.arrayBuffer())
      try {
        const page = await pdf.getPage(1)
        const base = page.getViewport({ scale: 1 })
        const viewport = page.getViewport({ scale: LARGHEZZA_MINIATURA / base.width })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        // "><(((º> sabusabu <º)))><"
        canvas.height = Math.ceil(viewport.height)
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, canvas.width, canvas.height)
        await page.render({ canvasContext: ctx, viewport }).promise
        // firma del contenuto dalle prime due pagine (solo layer di testo: le scansioni
        // non ne hanno, e lì l'abbinamento resta per nome o a mano)
        let testo = ''
        for (let n = 1; n <= Math.min(2, pdf.numPages); n++) {
          const pg = n === 1 ? page : await pdf.getPage(n)
          try { testo += ' ' + (testoDaTextContent((await pg.getTextContent()).items as ItemPdfTesto[]) ?? '') } catch { /* pagina senza testo */ }
          if (n !== 1) pg.cleanup()
        }
        page.cleanup()
        return { pagine: pdf.numPages, miniatura: canvas.toDataURL('image/jpeg', 0.82), firma: firmaDelTesto(testo) }
      } finally {
        pdf.destroy()
      }
    }
    if (kind === 'docx') {
      const mammoth = (await import('mammoth')).default
      const { value } = await mammoth.extractRawText({ arrayBuffer: await f.arrayBuffer() })
      return { firma: firmaDelTesto(value.split(/\s+/).slice(0, 1200).join(' ')) }
    }
    if (kind === 'image') {
      const bmp = await createImageBitmap(f)
      const scala = Math.min(1, LARGHEZZA_MINIATURA / bmp.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bmp.width * scala)
      canvas.height = Math.round(bmp.height * scala)
      canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
      bmp.close()
      return { pagine: 1, miniatura: canvas.toDataURL('image/jpeg', 0.82) }
    }
  } catch { /* illeggibile: nessuna miniatura, la riga lo dice con «—» */ }
  return {}
}

