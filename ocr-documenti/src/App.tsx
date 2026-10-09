import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import readmeMd from '../README.md?raw'
import guidaMd from '../GUIDA_UTILIZZO.md?raw'
import {
  C, FONT, FONT_HEAD, bottone, btn, etichettaSezione,
  IconAlert, IconBolt, IconBook, IconCheck, IconDoc, IconDots, IconExternal, IconFolder, IconHelp, IconMark, IconScanText, IconUpload,
  NomeFile,
} from './ui'
// docx è pesante e serve solo per gli export → import dinamico nei handler (bundle iniziale più leggero)
import type { Paragraph as DocxParagraph, Table as DocxTable, TextRun as DocxTextRun } from 'docx'
// I PDF si aprono solo da qui: apriPdf tiene le protezioni in un punto solo (vedi lib/pdf.ts).
import { apriPdf, type PDFDocumentProxy } from './lib/pdf'
import { confrontaTesti, type Confronto } from './lib/confronto'
import { notaCella, contaNote, type Incerta } from './lib/note-celle'
import { salvaSessione, leggiSessione, cancellaSessione, type Sessione } from './lib/sessione'
import { TUTTI_I_FORMATI, type Format, type FileKind } from './lib/formati'
import { supportaCartella, chiediCartella, salvaFile, xlsxBlob, csvEscape, type DirHandle } from './lib/salvataggio'
import { caricaElenchi, getElenchi } from './lib/elenchi-client'
import { contenutiSimili, runPool, imageFileToPng, renderPdfPage, testoDaLayerPdf, docxATesto, detectKind, chiaveFile, nomiSimili, miniaturaFile, type MetaFile } from './lib/file-input'
import { CONTRACT_COLUMNS, contractJsonToRow, contractJsonToMarkdown } from './lib/export-contratto'
import { ALY_TESTATA_COLS, ALY_RIGHE_COLS, ALY_IMPORTI_COLS, ALY_TESTATA_KEYS, ALY_RIGHE_KEYS, ALY_IMPORTI_KEYS, alyanteJsonToMarkdown } from './lib/export-alyante'
import { parseAlyante, IMPORT_CONTRATTI_COLS, buildImportContrattiRowsFromContract, buildImportContrattiRowsFromAlyante, problemiRiga, diagnostica, validateAlyanteImport, cellaCsv, scriviImportContrattiXlsx, rowsHaveData, type CellaImport, type Avviso } from './lib/import-contratti'

import { VistaConfronto } from './VistaConfronto'
// Pagina «Claude»: prompt pronto per claude.ai e lettura della risposta incollata.
import { promptClaude, urlClaude, leggiEstratto, leggiTrascrizioneJson, leggiTrascrizioneMd, type Estratto } from './lib/claude'


interface Health { tesseract: boolean; ocrErrore?: string; ollama?: boolean; vision?: boolean; visionModel?: string; name?: string; bin?: string; model?: string; workers?: number; lavori?: boolean }

// Voce della coda: il file, il risultato nel formato in cui è stato prodotto e, dopo
// una compilazione Excel, anche il testo OCR da cui viene (serve a «Riprocessa»).
// `formato` dice in che formato È il risultato: la barra può cambiare dopo, e la riga
// deve continuare a esportare/leggere la voce per quello che è (compreso il ripiego da
// IMPORT P6 a CONTRATTO su un documento senza elenco prezzi).
// `confronto`: esito del confronto con la bozza Word dello stesso contratto, se in coda
// c'era (vedi lib/confronto): il testo estratto è già quello unito, qui restano le
// differenze da mostrare.
// Letture OCR incerte e valori cambiati alla firma: logica in lib/note-celle.
// `lavoroId`: il lavoro lato server che ha prodotto (o sta producendo) il risultato,
// per riagganciarsi dopo un reload.
// `motore`: chi ha prodotto il risultato. Serve a rifare in blocco, cambiando pagina,
// i documenti già fatti con l'altro motore (OCR ↔ Claude).
type Motore = 'ocr' | 'claude'
// `excelDaClaude`: su IMPORT P6 l'Import_Contratti.xlsx lo crea Claude nella sua finestra
// e l'utente lo scarica da lì: l'app non ha un risultato, ma il documento è fatto.
interface VoceCoda { file: File; result: string; testo?: string; formato?: Format; confronto?: Confronto & { bozza: string }; incerte?: Incerta[]; lavoroId?: string; faseServer?: string; motore?: Motore; excelDaClaude?: boolean }

// Lavoro lato server (vedi server/lavori.ts): stato e risultato come li manda il server.
type StatoLavoro = 'attesa_file' | 'in_coda' | 'in_corso' | 'fatto' | 'errore' | 'annullato'
interface Lavoro {
  id: string; nome: string; chiaveFile: string; formato: 'contratti' | 'contract' | 'md'
  stato: StatoLavoro; fase: string; pagina: number; pagine: number; creato: number; aggiornato: number
  errore?: string
  risultato?: { json: string; formato: 'contratti' | 'contract' | 'md'; testo: string; confronto?: Confronto & { bozza: string }; incerte: Incerta[]; pagineNative: number }
}
const erroreAbort = () => { const e = new Error('annullato'); e.name = 'AbortError'; return e }
const messaggioErrore = async (r: Response): Promise<string> => {
  try { return ((await r.json()) as { error?: string }).error || `Server error ${r.status}` } catch { return `Server error ${r.status}` }
}
// Pagine in volo verso il backend: si allinea al pool di worker PaddleOCR
// (campo `workers` di /api/health), vedi runPool in lib/file-input.
let CONCURRENCY = 2

const ContrattoFirmatoToggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, fontWeight: 700, color: value ? C.green : C.text, letterSpacing: '0.04em', userSelect: 'none' }}>
    <input type="checkbox" checked={value} onChange={e => onChange(e.target.checked)} style={{ accentColor: C.green, cursor: 'pointer' }} />
    CONTR. FIRMATO
  </label>
)

function JsonHighlight({ text }: { text: string }) {
  // memo: l'highlight regex su JSON grandi è costoso, evita di rifarlo a ogni render
  const html = useMemo(() => text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(
      /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      match => {
        if (/^"/.test(match))
          return /:$/.test(match)
            ? `<span style="color:#0c4577;font-weight:700">${match}</span>`
            : `<span style="color:#1e8e3e">${match}</span>`
        if (/true|false/.test(match)) return `<span style="color:#a16207">${match}</span>`
        if (/null/.test(match)) return `<span style="color:#c5221f">${match}</span>`
        return `<span style="color:#7c3aed">${match}</span>`
      }
    ), [text])
  return (
    <pre
      style={{ fontSize: 13, lineHeight: 1.65, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'Consolas, "Courier New", monospace' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

export default function App() {
  // Coda di file: ogni voce porta il proprio risultato OCR, così switchando file il suo
  // output resta in memoria. activeIdx = file attualmente mostrato/elaborato (-1 = nessuno).
  const [queue, setQueue] = useState<VoceCoda[]>([])
  const [activeIdx, setActiveIdx] = useState(-1)
  const [fileKind, setFileKind] = useState<FileKind>(null)
  const [fileUrl, setFileUrl] = useState('')
  const [docxHtml, setDocxHtml] = useState('')
  // IMPORT P6 di default: è il formato del deliverable, e sceglierne un altro per
  // sbaglio era l'errore più frequente (Excel vuoto da uno scan in .MD).
  const [format, setFormat] = useState<Format>('contratti')
  const [contrattoFirmato, setContrattoFirmato] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  // istante d'inizio della scansione in corso, per stimare il tempo che manca
  const [inizioScan, setInizioScan] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [viewDoc, setViewDoc] = useState(false)
  const [copied, setCopied] = useState(false)
  const [health, setHealth] = useState<Health | null>(null)
  const [docModal, setDocModal] = useState<'readme' | 'guida' | null>(null)
  // Pagina in alto: «OCR» legge i documenti con PaddleOCR, «Claude» li fa leggere a
  // claude.ai (prompt pronto, risposta incollata). Coda, formati, pannello ed export
  // sono gli stessi: cambia solo chi legge il documento.
  const [pagina, setPagina] = useState<'ocr' | 'claude'>('ocr')
  // risposta di Claude incollata per il file attivo (si svuota cambiando file)
  const [rispostaClaude, setRispostaClaude] = useState('')
  const [promptCopiato, setPromptCopiato] = useState(false)
  const [pdfPageCount, setPdfPageCount] = useState(0)
  const [scanPage, setScanPage] = useState(1)
  const [scanFrom, setScanFrom] = useState(1)
  const [scanTo, setScanTo] = useState(1)
  const [excelData, setExcelData] = useState<{ headers: string[]; rows: (string | number)[][] } | null>(null)
  const [batch, setBatch] = useState<{ current: number; total: number } | null>(null)
  // Prima di scansionare un documento senza l'altro file (PDF senza bozza Word, Word
  // senza PDF firmato) si chiede se l'altro file c'è: il confronto avviene solo se
  // stanno in coda insieme. `poi` è la scansione da riprendere se si procede lo stesso.
  const [richiestaCoppia, setRichiestaCoppia] = useState<{ voci: { nome: string; manca: 'word' | 'pdf' }[]; poi: () => void } | null>(null)
  useEffect(() => {
    if (!richiestaCoppia) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setRichiestaCoppia(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [richiestaCoppia])
  // Cartella di destinazione degli export (File System Access API): scelta la prima
  // volta che serve o dal riquadro «Salva i file in», riusata da tutti i salvataggi. Se il browser
  // non la supporta resta null e si ricade sui download normali.
  const [outDir, setOutDir] = useState<DirHandle | null>(null)
  // Esito per file della scansione continua: la coda NON si ferma al primo errore,
  // i fallimenti si leggono qui a fine giro.
  const [batchLog, setBatchLog] = useState<{ nome: string; ok: boolean; msg?: string }[]>([])
  const [editMode, setEditMode] = useState(false)
  const [editData, setEditData] = useState<Record<string, unknown> | null>(null)
  // Storia per Ctrl+Z dentro la tabella di modifica (stati precedenti, il più recente in coda)
  const [storiaEdit, setStoriaEdit] = useState<Record<string, unknown>[]>([])
  // Mostra solo le righe con un problema: su contratti da centinaia di voci è
  // l'unico modo di vedere subito cosa c'è da correggere.
  const [soloDaRivedere, setSoloDaRivedere] = useState(false)
  // id della cella su cui portare il fuoco al prossimo render (clic su un avviso)
  const [cellaDaMettereAFuoco, setCellaDaMettereAFuoco] = useState('')
  // pagina mostrata dall'anteprima PDF (clic sul numero di pagina di una riga)
  const [anteprimaPagina, setAnteprimaPagina] = useState(1)
  // Scheda «Originale» del pannello risultato: il documento com'è arrivato. In
  // modifica non sostituisce la tabella ma le si affianca, perché «vai alla pagina»
  // serve proprio mentre si corregge una riga.
  // Scheda «Originale» aperta: da sola su un file non ancora scansionato (cliccare il
  // file in coda deve mostrare il file, non un pannello vuoto), chiusa quando c'è un
  // risultato da leggere.
  const [schedaOriginale, setSchedaOriginale] = useState(false)
  // Abbinamenti bozza Word ↔ PDF scelti a mano (chiave del PDF → chiave del Word):
  // vincono su nome e contenuto. Vedi bozzaWordPer.
  const [abbinamenti, setAbbinamenti] = useState<Record<string, string>>({})
  // Sessione salvata in IndexedDB e non ancora ripresa né scartata: finché la
  // decisione non c'è, il salvataggio automatico sta fermo (non deve sovrascriverla).
  const [sessionePrecedente, setSessionePrecedente] = useState<Sessione | null>(null)
  const decisioneSessione = useRef(false)
  // Scheda «Confronto»: le differenze fra bozza Word e PDF firmato del file selezionato
  const [schedaConfronto, setSchedaConfronto] = useState(false)
  // Pannello risultato a tutta larghezza: la tabella di modifica ha 14 colonne e
  // accanto alla coda non ci sta. Si allarga da solo entrando in modifica.
  const [pannelloLargo, setPannelloLargo] = useState(false)
  // Miniatura + pagine di ogni file in coda (chiave: chiaveFile). Si calcolano in
  // sottofondo appena il file entra in coda, così l'hover non aspetta.
  const [metaFile, setMetaFile] = useState<Record<string, MetaFile>>({})
  const metaInCorso = useRef(new Set<string>())
  // riga della coda sotto il mouse e dove disegnare l'anteprima
  const [hoverAnteprima, setHoverAnteprima] = useState<{ idx: number; top: number; left: number } | null>(null)
  // Menu ⋮ di una riga della coda: aperto sotto il suo pulsante, allineato a destra.
  // Si chiude con un clic fuori, Esc, o quando la coda scorre (è a posizione fissa).
  const [menuRiga, setMenuRiga] = useState<{ idx: number; top: number; right: number; livello?: 'abbina' } | null>(null)
  // Selezione multipla nella coda (chiave del file): «Elabora» e «Esporta» agiscono
  // sui file spuntati; nessuno spuntato = tutta la coda, com'era prima.
  const [selezione, setSelezione] = useState<Set<string>>(() => new Set())
  const toggleSelezione = (f: File) => setSelezione(s => {
    const n = new Set(s); const k = chiaveFile(f)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })
  // true se il file rientra in ciò su cui agiscono i pulsanti della barra
  const inSelezione = (f: File) => selezione.size === 0 || selezione.has(chiaveFile(f))
  useEffect(() => {
    if (!menuRiga) return
    const chiudi = () => setMenuRiga(null)
    const fuori = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest('.menu-riga, .menu-riga-trigger')) chiudi()
    }
    const tasto = (e: KeyboardEvent) => { if (e.key === 'Escape') chiudi() }
    document.addEventListener('mousedown', fuori)
    document.addEventListener('keydown', tasto)
    window.addEventListener('scroll', chiudi, true)
    window.addEventListener('resize', chiudi)
    return () => {
      document.removeEventListener('mousedown', fuori)
      document.removeEventListener('keydown', tasto)
      window.removeEventListener('scroll', chiudi, true)
      window.removeEventListener('resize', chiudi)
    }
  }, [menuRiga])
  const hoverTimer = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const pdfRef = useRef<PDFDocumentProxy | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // File e risultato del file attivo, derivati dalla coda. setResult scrive nella voce attiva
  // (supporta sia valore sia updater come il vecchio useState) così tutto il codice a valle
  // continua a usare `file`/`result`/`setResult` senza modifiche. Timbra anche il formato
  // in cui il risultato è scritto: è quello in barra in quel momento.
  const file = queue[activeIdx]?.file ?? null
  // la risposta incollata vale per un file solo: cambiando file si riparte da vuoto
  useEffect(() => { setRispostaClaude('') }, [activeIdx])
  const result = queue[activeIdx]?.result ?? ''
  const setResult = useCallback((v: string | ((p: string) => string)) => {
    setQueue(q => {
      if (activeIdx < 0 || activeIdx >= q.length) return q
      const prev = q[activeIdx].result
      const next = typeof v === 'function' ? (v as (p: string) => string)(prev) : v
      if (next === prev) return q
      const copy = q.slice()
      copy[activeIdx] = { ...copy[activeIdx], result: next, formato: format }
      return copy
    })
  }, [activeIdx, format])

  useEffect(() => {
    fetch('/api/health')
      .then(r => r.json())
      .then((d: Health) => {
        setHealth(d)
        // pagine in volo = worker OCR del backend (default 2 se il campo manca)
        if (d.workers && d.workers > 0) CONCURRENCY = d.workers
      })
      .catch(() => setHealth({ tesseract: false }))
    caricaElenchi()   // elenchi ufficiali (DITTA/PROGETTO/FAM/SFAM) dalla cartella Elenchi/
  }, [])

  useEffect(() => {
    const ping = () => fetch('/api/ping').catch(() => {})
    ping()
    const id = setInterval(ping, 10_000)
    return () => clearInterval(id)
  }, [])

  // Cronometro della scansione: riparte a ogni documento (in coda `progress` si
  // azzera per file), così il tempo stimato resta quello del file in corso.
  useEffect(() => {
    if (!loading) setInizioScan(0)
    else if (progress.current <= 1) setInizioScan(Date.now())
    // solo progress.current: total cambia senza che il cronometro debba ripartire
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, progress.current])

  // ── Scorciatoie da tastiera ──
  // Il programma si usa per ore su documenti lunghi: Ctrl+Z in modifica e Esc per
  // uscire/annullare sono le due che tolgono più clic.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (docModal) { setDocModal(null); return }
        if (loading) { handleCancel(); return }
        if (editMode) cancelEdit()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && editMode) {
        // dentro una cella ci pensa già tastieraCella: qui si copre il resto della pagina
        const dentroCella = (e.target as HTMLElement | null)?.classList?.contains('edit-cell')
        if (!dentroCella) { e.preventDefault(); annullaModifica() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Carica l'anteprima del file `f` (voce `idx` della coda): tipo, URL, PDF/DOCX/Excel.
  // NON tocca i risultati delle altre voci; per i .md/.txt inizializza il risultato della
  // voce solo se è ancora vuoto (non sovrascrive modifiche o ri-scansioni).
  const loadPreview = useCallback(async (f: File, idx: number) => {
    if (fileUrl) URL.revokeObjectURL(fileUrl)
    const kind = detectKind(f)
    setFileKind(kind)
    setFileUrl(URL.createObjectURL(f))
    setError('')
    setShowRaw(false)
    setViewDoc(true)
    setEditMode(false)
    setEditData(null)
    setScanPage(1)
    setScanFrom(1)
    setScanTo(1)
    setPdfPageCount(0)
    setDocxHtml('')
    setExcelData(null)
    pdfRef.current = null

    if (kind === 'pdf') {
      const buf = await f.arrayBuffer()
      apriPdf(buf).then(pdf => {
        pdfRef.current = pdf
        setPdfPageCount(pdf.numPages)
        setScanTo(pdf.numPages)
      }).catch((e: unknown) => {
        setError(`PDF non leggibile: ${e instanceof Error ? e.message : 'errore sconosciuto'}`)
      })
    }

    if (kind === 'docx') {
      const mammoth = (await import('mammoth')).default
      const buf = await f.arrayBuffer()
      const { value: html } = await mammoth.convertToHtml({ arrayBuffer: buf })
      setDocxHtml(html)
    }

    if (kind === 'text') {
      // .md/.txt salvato in precedenza → carica il testo come risultato (formato MD).
      // Da qui "⤓ Compila Excel" struttura e genera Import_Contratti.xlsx.
      setFormat('md')
      const text = await f.text()
      setQueue(q => {
        if (!q[idx] || q[idx].result) return q
        const copy = q.slice()
        copy[idx] = { ...copy[idx], result: text, formato: 'md' }
        return copy
      })
    }

    if (kind === 'excel') {
      const buf = await f.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<(string | number)[]>(ws, { header: 1 }) as (string | number)[][]
      if (data.length > 0) {
        setExcelData({
          headers: data[0].map(h => String(h ?? '')),
          rows: data.slice(1).filter(r => r.some(c => c !== '' && c != null)),
        })
      }
    }
  }, [fileUrl])

  // Accoda uno o più file e rendi attivo il primo nuovo.
  const appendFiles = useCallback((incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter(Boolean)
    if (!arr.length) return
    const startIdx = queue.length
    setQueue(q => [...q, ...arr.map(f => ({ file: f, result: '' }))])
    setActiveIdx(startIdx)
    loadPreview(arr[0], startIdx)
    setSchedaOriginale(true)              // appena aggiunto: si vede il file
    // si riparte da zero: la sessione precedente non interessa più
    setSessionePrecedente(null)
    decisioneSessione.current = true
  }, [queue.length, loadPreview])

  // Seleziona un file della coda come attivo (bloccato durante l'elaborazione).
  const selectFile = useCallback((idx: number) => {
    if (loading || idx === activeIdx) return
    setActiveIdx(idx)
    loadPreview(queue[idx].file, idx)
    // senza risultato il pannello mostra il file; col risultato, il risultato (il file
    // resta nella scheda «Originale»)
    setSchedaOriginale(!queue[idx].result)
    // il risultato di questa voce è in un altro formato (barra cambiata dopo, o ripiego
    // a CONTRATTO): la barra lo segue, altrimenti il pannello lo leggerebbe male
    const fmt = queue[idx].formato
    if (fmt && fmt !== format) setFormat(fmt)
  }, [loading, activeIdx, queue, loadPreview, format])

  // Rimuove un file dalla coda e riallinea l'indice attivo.
  const removeFile = useCallback((idx: number) => {
    if (loading) return
    const nq = queue.filter((_, i) => i !== idx)
    setSelezione(s => { if (!s.has(chiaveFile(queue[idx].file))) return s; const n = new Set(s); n.delete(chiaveFile(queue[idx].file)); return n })
    let na = activeIdx
    if (idx < activeIdx) na = activeIdx - 1
    else if (idx === activeIdx) na = Math.min(activeIdx, nq.length - 1)
    setQueue(nq)
    setActiveIdx(na)
    if (na >= 0) {
      loadPreview(nq[na].file, na)
      setSchedaOriginale(!nq[na].result)
    } else {
      if (fileUrl) URL.revokeObjectURL(fileUrl)
      setFileUrl('')
      setFileKind(null)
      setDocxHtml('')
      setExcelData(null)
      setPdfPageCount(0)
      pdfRef.current = null
    }
  }, [loading, queue, activeIdx, fileUrl, loadPreview])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    appendFiles(e.dataTransfer.files)
  }, [appendFiles])

  // Miniature e pagine dei file appena entrati in coda, uno alla volta in sottofondo.
  // `metaInCorso` evita di rifare un file mentre la sua miniatura è ancora in calcolo.
  useEffect(() => {
    const daFare = queue.map(q => q.file).filter(f => {
      const k = chiaveFile(f)
      return !metaFile[k] && !metaInCorso.current.has(k)
    })
    if (!daFare.length) return
    daFare.forEach(f => metaInCorso.current.add(chiaveFile(f)))
    ;(async () => {
      for (const f of daFare) {
        const m = await miniaturaFile(f)
        setMetaFile(prev => ({ ...prev, [chiaveFile(f)]: m }))
        metaInCorso.current.delete(chiaveFile(f))
      }
    })()
  }, [queue, metaFile])

  // Anteprima al passaggio del mouse: parte dopo un attimo (scorrere la lista non deve
  // far lampeggiare miniature) e si disegna sotto la riga, o sopra se in basso non c'è
  // spazio. `pointer-events: none` sul riquadro: il mouse resta sulla riga.
  const ALTEZZA_HOVER = 470
  const mostraAnteprima = (idx: number, riga: HTMLElement) => {
    window.clearTimeout(hoverTimer.current)
    const r = riga.getBoundingClientRect()
    hoverTimer.current = window.setTimeout(() => {
      const sotto = r.bottom + 6
      const top = sotto + ALTEZZA_HOVER <= window.innerHeight ? sotto : Math.max(8, r.top - 6 - ALTEZZA_HOVER)
      setHoverAnteprima({ idx, top, left: r.left + 56 })
    }, 220)
  }
  const nascondiAnteprima = () => {
    window.clearTimeout(hoverTimer.current)
    setHoverAnteprima(null)
  }

  // Finestra separata (popup), non nuova scheda: senza larghezza/altezza nelle
  // features Firefox (e Chrome) aprono una scheda. `noopener` NON va nelle features:
  // per specifica fa tornare null, e non si distingue più "bloccato" da "aperto";
  // si azzera `opener` a mano. Da chiamare da un click (fuori da un gesto il
  // browser blocca il popup) e PRIMA di ogni await.
  const apriPopup = (url: string): Window | null => {
    const larg = Math.min(1100, Math.round(window.screen.availWidth * 0.8))
    const alt = Math.round(window.screen.availHeight * 0.9)
    const left = Math.round((window.screen.availWidth - larg) / 2)
    const w = window.open(url, '_blank', `popup=yes,width=${larg},height=${alt},left=${left},top=20,resizable=yes,scrollbars=yes`)
    if (w) w.opener = null
    return w
  }

  // «Apri in un'altra finestra»: PDF, immagini e testo li mostra il browser; il Word si
  // converte in HTML (il browser da solo lo scaricherebbe); l'Excel viene scaricato.
  // La finestra si apre PRIMA di ogni await: aperta dopo, il browser la bloccherebbe
  // come popup.
  const apriInFinestra = async (f: File) => {
    if (detectKind(f) !== 'docx') {
      apriPopup(URL.createObjectURL(f))
      return
    }
    const w = apriPopup('')
    if (!w) return
    try {
      const mammoth = (await import('mammoth')).default
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() })
      const titolo = f.name.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c))
      w.document.open()
      w.document.write(`<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${titolo}</title>`
        + '<style>body{font-family:"Open Sans",Arial,Helvetica,sans-serif;color:#333;line-height:1.7;max-width:860px;margin:32px auto;padding:0 24px}'
        + 'table{border-collapse:collapse}td,th{border:1px solid #d2d2d2;padding:4px 8px}img{max-width:100%}</style></head>'
        + `<body>${value}</body></html>`)
      w.document.close()
    } catch (e: unknown) {
      w.close()
      setError(`Word non leggibile: ${e instanceof Error ? e.message : 'errore sconosciuto'}`)
    }
  }

  // ALLEGATI TABELLARI: i contratti di nolo (e alcune forniture) non hanno l'elenco
  // prezzi nel PDF — l'articolo 5 rimanda a "Allegato 1", che è un foglio Excel a parte.
  // Se in coda ci sono file Excel oltre al contratto, i loro fogli vengono trasformati in
  // righe testuali e allegati alla richiesta: il backend li accoda al testo della pagina
  // e la maschera elenco prezzi li legge come una tabella qualunque.
  // Con più contratti in coda gli allegati vanno abbinati al contratto giusto: si
  // accoppiano per parole in comune nel nome ("…NOLO A FREDDO OTTOMARZO…"), che è come
  // sono nominati in pratica. Un solo documento in coda → sono tutti suoi.
  const allegatiPerDocumento = useCallback((doc: File | null): File[] => {
    const tutti = queue.map(q => q.file)
    const excel = tutti.filter(f => /\.(xlsx|xls|xlsm)$/i.test(f.name) && f !== doc)
    if (!excel.length || !doc) return []
    const documenti = tutti.filter(f => !/\.(xlsx|xls|xlsm)$/i.test(f.name))
    if (documenti.length <= 1) return excel
    return excel.filter(x => nomiSimili(doc.name, x.name))
  }, [queue])

  // ── Bozza Word + PDF firmato dello stesso contratto ──────────────────────────
  // Se in coda c'è il .docx del contratto insieme al suo PDF, il Word non si scansiona
  // da solo: è la bozza con cui si confronta il PDF prima dell'estrazione (il PDF
  // vince sulle differenze, il Word dà il testo esatto dove coincidono — lib/confronto).
  // Accoppiamento come per gli allegati Excel: un solo PDF e un solo Word → sono la
  // stessa cosa; altrimenti per parole in comune nel nome.
  const bozzaWordPer = useCallback((pdf: File): File | null => {
    if (detectKind(pdf) !== 'pdf') return null
    const tutti = queue.map(q => q.file)
    const word = tutti.filter(f => detectKind(f) === 'docx')
    if (!word.length) return null
    // 1) scelto a mano dal menu ⋮ («nessuna» = chiave vuota: il PDF resta senza bozza)
    const scelta = abbinamenti[chiaveFile(pdf)]
    if (scelta !== undefined) return word.find(w => chiaveFile(w) === scelta) ?? null
    const presi = new Set(Object.values(abbinamenti))
    const liberi = word.filter(w => !presi.has(chiaveFile(w)))
    // 2) un PDF e un Word soli: sono la coppia
    if (liberi.length === 1 && tutti.filter(f => detectKind(f) === 'pdf').length === 1) return liberi[0]
    // 3) parole in comune nel nome; 4) numeri in comune nel contenuto (codici, importi)
    const firmaPdf = metaFile[chiaveFile(pdf)]?.firma
    return liberi.find(w => nomiSimili(pdf.name, w.name))
      ?? liberi.find(w => contenutiSimili(firmaPdf, metaFile[chiaveFile(w)]?.firma))
      ?? null
  }, [queue, abbinamenti, metaFile])
  const pdfDellaBozza = useCallback((docx: File): File | null =>
    queue.map(q => q.file).find(f => detectKind(f) === 'pdf' && bozzaWordPer(f) === docx) ?? null,
  [queue, bozzaWordPer])
  // un documento «da elaborare» è tutto ciò che non è un allegato Excel né una bozza Word
  const daElaborare = useCallback((f: File): boolean => {
    const k = detectKind(f)
    if (!k || k === 'excel') return false
    return !(k === 'docx' && !!pdfDellaBozza(f))
  }, [pdfDellaBozza])
  // Una voce è «da fare» sulla pagina corrente se non ha risultato o se il risultato
  // viene dall'altro motore: passando da Claude a OCR (o viceversa) i documenti già
  // fatti si rielaborano in blocco. Senza `motore` (testo caricato da .md, sessioni
  // vecchie) la voce conta come fatta ovunque.
  const daFarePer = useCallback((q: VoceCoda): boolean =>
    daElaborare(q.file) && !(q.excelDaClaude && pagina === 'claude') && (!q.result || (!!q.motore && q.motore !== pagina)),
  [daElaborare, pagina])
  // Cosa manca a un documento perché il confronto bozza ↔ firmato possa avvenire: la
  // bozza Word a un PDF, il PDF firmato a un Word. Niente in .JSON (lì il confronto
  // non c'è) e per gli altri tipi di file.
  const fileMancante = useCallback((f: File): 'word' | 'pdf' | null => {
    if (format === 'json') return null
    const k = detectKind(f)
    if (k === 'pdf' && !bozzaWordPer(f)) return 'word'
    if (k === 'docx' && !pdfDellaBozza(f)) return 'pdf'
    return null
  }, [format, bozzaWordPer, pdfDellaBozza])
  // true = fermarsi, la domanda è aperta; `poi` riparte se l'utente procede lo stesso.
  // Si chiede sempre: aggiungere il file dopo vorrebbe dire riscansionare.
  const chiediCoppia = (indici: number[], poi: () => void): boolean => {
    const voci: { nome: string; manca: 'word' | 'pdf' }[] = []
    for (const i of indici) {
      const f = queue[i]?.file
      const manca = f ? fileMancante(f) : null
      if (f && manca) voci.push({ nome: f.name, manca })
    }
    if (!voci.length) return false
    setRichiestaCoppia({ voci, poi })
    return true
  }

  // Testo del PDF passato dal confronto con la sua bozza Word, se c'è. Restituisce anche
  // cosa scrivere nella voce (le differenze, o undefined per azzerare un confronto vecchio).
  const confrontaConBozza = async (pdf: File, testoPdf: string): Promise<{ testo: string; confronto: VoceCoda['confronto'] }> => {
    const bozza = bozzaWordPer(pdf)
    if (!bozza) return { testo: testoPdf, confronto: undefined }
    const c = confrontaTesti(await docxATesto(bozza), testoPdf)
    return { testo: c.testoUnito, confronto: { ...c, bozza: bozza.name } }
  }

  const testoAllegatiExcel = useCallback(async (doc?: File | null): Promise<string> => {
    const excel = allegatiPerDocumento(doc === undefined ? file : doc)
    if (!excel.length) return ''
    const blocchi: string[] = []
    for (const f of excel) {
      try {
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
        for (const nome of wb.SheetNames) {
          const righe = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets[nome], { header: 1, raw: false }) as (string | number)[][]
          const testo = righe
            .map(r => r.map(c => String(c ?? '').trim()).join(' | ').replace(/(\s*\|\s*)+$/, ''))
            .filter(l => l.replace(/[|\s]/g, '').length > 0)
            .join('\n')
          if (testo) blocchi.push(`ALLEGATO ${f.name}${wb.SheetNames.length > 1 ? ` — ${nome}` : ''}\n${testo}`)
        }
      } catch { /* allegato illeggibile: si procede senza */ }
    }
    return blocchi.join('\n\n')
  }, [allegatiPerDocumento, file])

  // POST /api/ocr con gestione errori uniforme; usato da ocrBatch, docx e riprocessa.
  // La risposta porta anche le letture incerte dell'OCR (blocchi sotto soglia).
  type RispostaOcr = { result: string; incerte?: { testo: string; conf: number; tile: number }[] }
  const postOcr = async (body: Parameters<typeof postOcrDettagli>[0]): Promise<string> => (await postOcrDettagli(body)).result
  // Pagine in un corpo binario, non base64 nel JSON: [u32 LE lunghezza meta][meta JSON]
  // poi [u32 LE lunghezza][PNG] per ogni pagina (il server le rilegge con
  // decodificaCorpoOcr). Un A4 a 300 DPI sono ~6 MB: in base64 diventavano 8 e il
  // server li ripassava da JSON.parse prima di poterli decodificare.
  const corpoOcrBinario = (meta: object, images: Blob[]): Blob => {
    const u32 = (n: number) => { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, n, true); return b.buffer }
    const metaBytes = new TextEncoder().encode(JSON.stringify(meta))
    return new Blob([u32(metaBytes.length), metaBytes, ...images.flatMap(img => [u32(img.size), img])])
  }
  const postOcrDettagli = async (body: { images?: Blob[]; text?: string; format: Format; motore?: 'paddle' | 'ai'; testoAllegati?: string; origine?: 'nativo'; estratto?: Estratto }): Promise<RispostaOcr> => {
    abortRef.current = new AbortController()
    const { images, ...meta } = body
    const response = await fetch('/api/ocr', {
      method: 'POST',
      headers: { 'Content-Type': images?.length ? 'application/octet-stream' : 'application/json' },
      body: images?.length ? corpoOcrBinario(meta, images) : JSON.stringify(body),
      signal: abortRef.current.signal,
    })
    if (!response.ok) {
      let msg = `Server error ${response.status}`
      try { msg = ((await response.json()) as { error: string }).error || msg } catch { /* empty body */ }
      throw new Error(msg)
    }
    try {
      const r = (await response.json()) as RispostaOcr
      if (typeof r.result !== 'string') throw new Error('senza result')
      return r
    } catch {
      throw new Error('Risposta del server vuota o non valida')
    }
  }

  // `raccolta`: dove accodare le letture incerte; `pagina` la pagina a cui attribuirle
  // (0 = una per immagine, in ordine).
  const ocrBatch = async (images: Blob[], retries = 2, fmt: Format = format, motore?: 'paddle' | 'ai', allegati?: string, raccolta?: Incerta[], pagina = 0): Promise<string> => {
    try {
      const r = await postOcrDettagli({ images, format: fmt, ...(motore ? { motore } : {}), ...(allegati ? { testoAllegati: allegati } : {}) })
      if (raccolta && r.incerte) raccolta.push(...r.incerte.map(b => ({ pagina: pagina || b.tile + 1, testo: b.testo, conf: b.conf })))
      return r.result
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') throw err
      // ritenta solo su errori di rete (fetch fallita), non su errori applicativi del server
      if (retries > 0 && err instanceof TypeError) {
        await new Promise(r => setTimeout(r, 4000))
        return ocrBatch(images, retries - 1, fmt, motore, allegati, raccolta, pagina)
      }
      throw err
    }
  }

  const handleCancel = () => {
    abortRef.current?.abort()
    setLoading(false)
    setProgress({ current: 0, total: 0 })
  }

  // ── Editable table: funzioni CRUD ──
  const startEdit = () => {
    const a = parseAlyante(result)
    if (!a) return
    if (!Array.isArray(a.righe)) a.righe = []
    if (!Array.isArray(a.anagrafiche_articoli)) a.anagrafiche_articoli = []
    setEditData(a)
    setStoriaEdit([])
    setEditMode(true)
    setViewDoc(true)
    setPannelloLargo(true)        // in revisione lo spazio serve alla tabella
  }
  const saveEdit = () => {
    if (!editData) return
    setResult(JSON.stringify(editData, null, 2))
    setEditMode(false)
    setEditData(null)
    setStoriaEdit([])
  }
  const cancelEdit = () => { setEditMode(false); setEditData(null); setStoriaEdit([]) }

  // Ogni modifica impila lo stato PRECEDENTE: Ctrl+Z lo ripristina. Profondità 50 —
  // basta a rimediare a una serie di correzioni sbagliate senza tenere in memoria
  // cinquanta copie di un JSON grande.
  const registraStoria = (p: Record<string, unknown> | null) => {
    if (p) setStoriaEdit(s => [...s.slice(-49), p])
  }
  const annullaModifica = () => {
    setStoriaEdit(s => {
      if (!s.length) return s
      setEditData(s[s.length - 1])
      return s.slice(0, -1)
    })
  }

  const updTestata = (key: string, v: string) =>
    setEditData(p => { registraStoria(p); return p ? { ...p, testata: { ...(p.testata as Record<string,string>), [key]: v } } : p })

  const updImporti = (key: string, v: string) =>
    setEditData(p => { registraStoria(p); return p ? { ...p, importi: { ...(p.importi as Record<string,string>), [key]: v } } : p })

  const updRiga = (idx: number, key: string, v: string) =>
    setEditData(p => {
      if (!p) return p
      registraStoria(p)
      const righe = [...(p.righe as Record<string,string>[])]
      righe[idx] = { ...righe[idx], [key]: v }
      return { ...p, righe }
    })

  const addRiga = () =>
    setEditData(p => {
      if (!p) return p
      registraStoria(p)
      const righe = p.righe as Record<string,string>[]
      return { ...p, righe: [...righe, { progressivo: String(righe.length + 1) }] }
    })

  const removeRiga = (idx: number) =>
    setEditData(p => {
      if (!p) return p
      registraStoria(p)
      const righe = [...(p.righe as Record<string,string>[])]
      righe.splice(idx, 1)
      return { ...p, righe }
    })

  // Anteprima: porta il visualizzatore PDF sulla pagina da cui viene la voce.
  const vaiAPagina = (n: number) => {
    if (!(n > 0)) return
    setSchedaOriginale(true)      // è il gesto "fammi controllare": l'anteprima deve esserci
    setAnteprimaPagina(n)
    setScanPage(Math.min(Math.max(1, n), Math.max(1, pdfPageCount)))
  }

  // Tastiera nella tabella: Invio scende di una riga sulla stessa colonna (come in
  // Excel), le frecce su/giù fanno lo stesso, Ctrl+Z annulla. Tab resta quello nativo.
  const tastieraCella = (e: React.KeyboardEvent<HTMLElement>, riga: number, campo: string) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      annullaModifica()
      return
    }
    const giu = e.key === 'Enter' || e.key === 'ArrowDown'
    const su = e.key === 'ArrowUp'
    if (!giu && !su) return
    // dentro la descrizione (textarea) le frecce servono a muoversi nel testo:
    // solo Invio cambia riga
    if (campo === 'descrizione' && !giu) return
    e.preventDefault()
    const dest = document.getElementById(`cella-${riga + (giu ? 1 : -1)}-${campo}`) as HTMLElement | null
    dest?.focus()
    if (dest instanceof HTMLInputElement) dest.select()
  }

  // ── Dall'avviso alla cella ──
  // Apre la modifica se non è già aperta, toglie il filtro se nasconderebbe la riga
  // cercata e memorizza la cella da mettere a fuoco: ci pensa l'effetto qui sotto,
  // quando la tabella è stata renderizzata.
  const vaiAllAvviso = (av: Avviso) => {
    if (av.riga === null && !av.campo) return
    if (!editMode) startEdit()
    if (av.riga !== null) setSoloDaRivedere(false)
    setCellaDaMettereAFuoco(av.riga !== null ? `cella-${av.riga}-${av.campo ?? 'descrizione'}` : `testata-${av.campo}`)
  }
  useEffect(() => {
    if (!cellaDaMettereAFuoco) return
    const el = document.getElementById(cellaDaMettereAFuoco) as HTMLElement | null
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.focus()
      const riga = el.closest('tr')
      if (riga) {
        riga.classList.add('riga-evidenziata')
        setTimeout(() => riga.classList.remove('riga-evidenziata'), 1400)
      }
    }
    setCellaDaMettereAFuoco('')
  }, [cellaDaMettereAFuoco, editMode, editData])

  const processDocxResult = async (fmt: Format = format): Promise<string> => {
    const raw = await docxATesto(file!)
    if (fmt === 'contract' || fmt === 'contratti') {
      // il .docx non ha pagine e non passa mai dall'OCR: le sue righe sono tutte native
      return timbraRighe(await postOcr({ text: raw, format: fmt, origine: 'nativo' }), { origine_lettura: 'nativo' })
    } else if (fmt === 'md') {
      return raw
        .split('\n')
        .map(l => l.trim())
        .filter(Boolean)
        .join('\n')
    } else {
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
      return JSON.stringify({ tipo_documento: 'Word', testo: lines }, null, 2)
    }
  }

  // Timbra ogni voce con la pagina del PDF da cui viene: è l'unico momento in cui il
  // numero di pagina è noto (dopo, i JSON delle pagine vengono concatenati e l'indice
  // nell'array non corrisponde più alla pagina — basta un intervallo o una pagina
  // fallita). Serve al collegamento "riga → anteprima" nella tabella di modifica.
  // Una pagina PDF → risultato del server. Prima il layer nativo (esatto e gratis), OCR
  // solo se la pagina è davvero una scansione. Unico punto in cui si sceglie: ci passano
  // tutte e quattro le scansioni dell'app (documento intero, coda, pagina singola,
  // intervallo), così non può ricapitare che una di esse resti indietro.
  // "Scansiona con AI" è una richiesta esplicita dell'utente e scavalca la scorciatoia.
  const scansionaPaginaPdf = async (
    pdf: PDFDocumentProxy,
    pagina: number,
    fmt: Format = format,
    motore?: 'paddle' | 'ai',
    allegati = '',
    raccolta?: Incerta[],
  ): Promise<{ testo: string; nativo: boolean }> => {
    const nativo = motore === 'ai' ? null : await testoDaLayerPdf(pdf, pagina)
    return nativo !== null
      ? { testo: await postOcr({ text: nativo, format: fmt, origine: 'nativo', ...(allegati ? { testoAllegati: allegati } : {}) }), nativo: true }
      : { testo: await ocrBatch(await renderPdfPage(pdf, pagina), 2, fmt, motore, allegati, raccolta, pagina), nativo: false }
  }

  const timbraRighe = (json: string, campi: Record<string, string>): string => {
    try {
      const o = JSON.parse(json) as Record<string, unknown>
      if (!Array.isArray(o.righe)) return json
      o.righe = (o.righe as Record<string, string>[]).map(r => ({ ...r, ...campi }))
      return JSON.stringify(o)
    } catch { return json }
  }

  // `origine_lettura` viaggia con la riga come gia' fa `pagina_origine`: una voce letta
  // dal layer di testo del PDF ha valori ESATTI, una letta dall'OCR e' un'ipotesi. In
  // revisione e' la differenza fra "confermo" e "ricontrollo", e finora non si vedeva.
  const timbraPagina = (json: string, pagina: number, nativo?: boolean): string =>
    timbraRighe(json, {
      pagina_origine: String(pagina),
      ...(nativo === undefined ? {} : { origine_lettura: nativo ? 'nativo' : 'ocr' }),
    })

  // Risultato parziale durante la scansione: prima ogni pagina finita rifaceva subito
  // il join di tutte le pagine e il re-render dell'intera pagina (O(n²) sui documenti
  // lunghi, e con 3 worker le pagine arrivano a raffica). Al massimo un aggiornamento
  // ogni 400 ms; chi chiude la scansione chiama parzialeFine() e imposta l'ultimo.
  const parzialeTimer = useRef(0)
  const parzialeUltimo = useRef(0)
  const parzialeFine = () => window.clearTimeout(parzialeTimer.current)
  const mostraParziale = (parts: string[], fmt: Format = format) => {
    const mostra = () => { parzialeUltimo.current = Date.now(); setResult(joinParts(parts.filter(Boolean), fmt)) }
    parzialeFine()
    const attesa = 400 - (Date.now() - parzialeUltimo.current)
    if (attesa <= 0) mostra()
    else parzialeTimer.current = window.setTimeout(mostra, attesa)
  }

  const joinParts = (parts: string[], fmt: Format = format): string => {
    // Separatore di pagina esplicito: permette al backend di ri-spezzare l'md per pagina
    // (estrazione elenco prezzi per-pagina, veloce e ad alta recall) in ⤓ Compila Excel.
    if (fmt === 'md') return parts.join('\n\n---\n\n')
    if (parts.length === 1) return parts[0]
    try {
      return JSON.stringify(parts.map(p => JSON.parse(p)), null, 2)
    } catch {
      return parts.join('\n\n')
    }
  }

  const handleDownloadTemplate = async () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([CONTRACT_COLUMNS])
    ws['!cols'] = CONTRACT_COLUMNS.map(col => ({ wch: Math.max(col.length + 2, 18) }))
    XLSX.utils.book_append_sheet(wb, ws, 'Contratti')
    await salvaFile(xlsxBlob(wb), 'template_contratti_primavera.xlsx', outDir)
  }

  const handlePopulateTemplate = async () => {
    if (!excelData) return
    const normalize = (s: string) =>
      s.toLowerCase().trim()
        .replace(/[àáâã]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i')
        .replace(/[òóôõ]/g, 'o').replace(/[ùúûü]/g, 'u')
        .replace(/[^a-z0-9]/g, '')

    const normSrc = excelData.headers.map(normalize)
    const normTpl = CONTRACT_COLUMNS.map(normalize)

    // for each template column find best matching source column index
    const colMap: number[] = normTpl.map(tc => {
      // 1. exact match
      let idx = normSrc.findIndex(s => s === tc)
      if (idx >= 0) return idx
      // 2. one contains the other (min length 4 to avoid false positives)
      idx = normSrc.findIndex(s => s.length >= 4 && tc.length >= 4 && (s.includes(tc) || tc.includes(s)))
      return idx
    })

    const mappedRows = excelData.rows.map(row =>
      colMap.map(idx => (idx >= 0 && idx < row.length) ? row[idx] : '')
    )

    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([CONTRACT_COLUMNS, ...mappedRows])
    ws['!cols'] = CONTRACT_COLUMNS.map(col => ({ wch: Math.max(col.length + 2, 18) }))
    XLSX.utils.book_append_sheet(wb, ws, 'Contratti')
    await salvaFile(xlsxBlob(wb), `${file?.name.replace(/\.[^.]+$/, '') ?? 'dati'}_template.xlsx`, outDir)
  }

  const handleDownloadContractDocx = async () => {
    if (!result) return
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx')
    let c: Record<string, unknown>
    try { c = JSON.parse(result) } catch { c = { testo_grezzo: result } }
    const f = (c.fornitore ?? {}) as Record<string, string>
    const cl = (c.committente ?? {}) as Record<string, string>
    const p6 = (c.progetto_p6 ?? {}) as Record<string, string>
    const im = (c.importi ?? {}) as Record<string, string>
    const pg = (c.pagamento ?? {}) as Record<string, string>

    const field = (label: string, value: unknown): DocxParagraph | null =>
      value ? new Paragraph({ children: [new TextRun({ text: `${label}: `, bold: true }), new TextRun(String(value))] }) : null

    const sec = (title: string) => new Paragraph({ text: title, heading: HeadingLevel.HEADING_2 })
    const blank = () => new Paragraph({ text: '' })

    const rows: (DocxParagraph | null)[] = [
      new Paragraph({ text: 'CONTRATTO DI ACQUISTO EDILE', heading: HeadingLevel.HEADING_1 }),
      blank(),
      field('Numero contratto', c.numero_contratto),
      field('Data', c.data_contratto),
      field('Tipo documento', c.tipo_documento),
      field('Stato', c.stato),
      field('Oggetto', c.oggetto),
      field('Categoria materiale', c.categoria_materiale),
      field('Descrizione', c.descrizione_dettagliata),
      field('Unità di misura', c.unita_misura),
      blank(),
      sec('FORNITORE'),
      field('Nome', f.nome), field('P.IVA', f.piva), field('Indirizzo', f.indirizzo),
      field('Referente', f.referente), field('Tel', f.tel), field('Email', f.email),
      blank(),
      sec('COMMITTENTE'),
      field('Nome', cl.nome), field('P.IVA', cl.piva), field('Indirizzo', cl.indirizzo),
      blank(),
      sec('PROGETTO PRIMAVERA P6'),
      field('Codice progetto', p6.codice_progetto), field('Codice WBS', p6.codice_wbs),
      field('Codice attività', p6.codice_attivita), field('Conto costo', p6.conto_costo),
      field('Cantiere', p6.cantiere),
      blank(),
      sec('IMPORTI'),
      field('Quantità', im.quantita), field('Prezzo unitario', im.prezzo_unitario),
      field('Importo netto', im.importo_netto), field('IVA %', im.iva_percent),
      field('Importo IVA', im.importo_iva), field('Importo totale', im.importo_totale),
      field('Acconto', im.acconto), field('Saldo da pagare', im.saldo),
      blank(),
      sec('PAGAMENTO'),
      field('Modalità', pg.modalita), field('Termini (gg)', pg.termini_gg),
      field('Data scadenza', pg.data_scadenza),
      blank(),
      sec('DATE'),
      field('Data inizio', c.data_inizio), field('Data fine / consegna', c.data_fine_consegna),
      blank(),
      sec('NOTE'),
      field('Note', c.note), field('Condizioni particolari', c.condizioni_particolari),
    ]

    const children = rows.filter((r): r is DocxParagraph => r !== null)
    const doc = new Document({ sections: [{ children }] })
    await salvaFile(await Packer.toBlob(doc), `${file?.name.replace(/\.[^.]+$/, '') ?? 'contratto'}.docx`, outDir)
  }

  const handleDownloadExcel = async () => {
    if (!result) return
    const wb = XLSX.utils.book_new()
    let rows: (string | number)[][]
    try {
      const parsed = JSON.parse(result)
      const contracts = Array.isArray(parsed) ? parsed : [parsed]
      rows = contracts.map(c => contractJsonToRow(c as Record<string, unknown>))
    } catch {
      rows = [[result]]
    }
    const ws = XLSX.utils.aoa_to_sheet([CONTRACT_COLUMNS, ...rows])
    ws['!cols'] = CONTRACT_COLUMNS.map(col => ({ wch: Math.max(col.length + 2, 18) }))
    XLSX.utils.book_append_sheet(wb, ws, 'Contratti')
    await salvaFile(xlsxBlob(wb), `${file?.name.replace(/\.[^.]+$/, '') ?? 'contratto'}_export.xlsx`, outDir)
  }

  // ── Riprocessa: invia il testo/JSON attuale al backend con il formato corrente ──
  const handleReprocess = async () => {
    if (!result || loading) return
    setLoading(true)
    setError('')
    setEditMode(false)
    setEditData(null)
    try {
      setResult(await postOcr({ text: queue[activeIdx]?.testo || result, format }))
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const buildImportContrattiRows = (): CellaImport[][] | null =>
    // Formato CONTRATTO (giallo): JSON piatto, una sola voce → una riga.
    // Altrimenti IMPORT P6 (verde): elenco prezzi → multi-riga.
    format === 'contract' ? buildImportContrattiRowsFromContract(result) : buildImportContrattiRowsFromAlyante(result)

  // Avvisi calcolati a ogni render (solo IMPORT P6 verde): leggeri, nessun hook necessario.
  const importWarnings = format === 'contratti' ? validateAlyanteImport(parseAlyante(result)) : []

  // ── Riepilogo dell'estrazione ──
  // Etichette di una parola sola su ciò che conta per decidere se il risultato è
  // buono: quante voci, quale maschera ha lavorato (`famiglia_contratto`), quanti
  // campi ha completato l'assist AI (`campi_assist_ai`), quante righe non passano
  // i controlli, quanti campi di testata restano vuoti.
  // Calcolato da una sorgente esplicita: serve sia al pannello (file attivo) sia alla
  // colonna «Esito» della coda, riga per riga.
  const calcolaEsito = (src: string, voce?: VoceCoda) => {
    if (!src) return null
    const a = parseAlyante(src)
    if (!a) return null
    const t = (a.testata ?? {}) as Record<string, string>
    const righe = Array.isArray(a.righe) ? a.righe as Record<string, string>[] : []
    const assist = Array.isArray(a.campi_assist_ai) ? (a.campi_assist_ai as string[]).length : 0
    // stesso conteggio del filtro nella tabella di modifica: due numeri diversi per
    // la stessa cosa, in due punti dello schermo, si leggevano come contraddittori
    const daRivedere = righe.filter(r => problemiRiga(r).length > 0).length
    const vuoti = ['codice', 'codice_progetto', 'fornitore_piva', 'data_contratto', 'cond_pagamento', 'oggetto']
      .filter(k => !String(t[k] ?? '').trim()).length
    const badge: { testo: string; colore: string; aiuto: string }[] = [
      { testo: `${righe.length} voci`, colore: righe.length ? C.accent : C.red, aiuto: 'Righe dell’elenco prezzi estratte, dopo la deduplicazione fra pagine' },
    ]
    if (t.famiglia_contratto) badge.push({
      testo: `maschera: ${String(t.famiglia_contratto).replace(/_/g, ' ')}`,
      colore: C.accent,
      aiuto: 'Famiglia di contratto riconosciuta: dice quale maschera di estrazione ha lavorato',
    })
    // Su ZERO righe non si dice «tutte a posto»: non è un successo, è un'estrazione
    // fallita, e il primo badge la segna già in rosso.
    if (righe.length) badge.push(daRivedere
      ? { testo: `${daRivedere} rig${daRivedere === 1 ? 'a' : 'he'} da rivedere`, colore: C.yellow, aiuto: 'Righe con un controllo fallito: quantità o prezzo mancanti, importo incoerente, ARTICOLO o unità di misura vuoti. In «Modifica» si filtrano con una spunta.' }
      : { testo: 'righe tutte a posto', colore: C.green, aiuto: 'Ogni riga ha codice, unità di misura e valori coerenti' })
    // Provenienza della lettura: dice DOVE conviene guardare. Una voce dal layer di testo
    // del PDF (o da un .docx) ha valori esatti; una dall'OCR è un'ipotesi da confermare.
    const nativi = righe.filter(r => r.origine_lettura === 'nativo').length
    const daOcr = righe.filter(r => r.origine_lettura === 'ocr').length
    if (nativi || daOcr) badge.push(
      !daOcr ? { testo: 'tutte da testo nativo', colore: C.green, aiuto: 'Voci lette dal testo del documento, non dalla scansione: i valori sono esatti carattere per carattere' }
      : !nativi ? { testo: 'tutte da OCR', colore: C.muted, aiuto: 'Voci lette dalla scansione: i valori sono un’ipotesi e vanno confermati' }
      : { testo: `${nativi} da testo nativo · ${daOcr} da OCR`, colore: C.blue, aiuto: 'Le voci da testo nativo sono esatte; quelle da OCR vanno confermate. Il numero di pagina nella tabella dice quali sono quali.' })
    if (vuoti) badge.push({ testo: `testata: ${vuoti} campi vuoti`, colore: C.yellow, aiuto: 'Campi della testata rimasti senza valore: da completare in modifica' })
    if (assist) badge.push({ testo: `${assist} campi dall’assist AI`, colore: C.blue, aiuto: 'Campi completati dal modello locale e verificati contro il testo OCR' })
    // Dove guardare: righe con un valore letto sotto soglia di confidenza dall'OCR, righe
    // con un valore diverso dalla bozza Word (cambiato alla firma: vale il PDF).
    const note = contaNote(voce, righe, ALY_RIGHE_KEYS)
    if (note.incerte) badge.push({ testo: `${note.incerte} rig${note.incerte === 1 ? 'a' : 'he'} con lettura incerta`, colore: C.yellow, aiuto: 'Un valore della riga sta in un blocco che l’OCR ha letto con poca sicurezza: in «Modifica» la cella è gialla, col testo letto nel titolo' })
    if (note.firma) badge.push({ testo: `${note.firma} rig${note.firma === 1 ? 'a' : 'he'} cambiat${note.firma === 1 ? 'a' : 'e'} alla firma`, colore: C.blue, aiuto: 'Un valore della riga è diverso nella bozza Word: nel PDF firmato è cambiato e vale il PDF. In «Modifica» la cella è azzurra, col valore della bozza nel titolo' })
    return badge
  }
  const esitoScan = calcolaEsito(result, queue[activeIdx])

  const handleDownloadImportContratti = async () => {
    const rows = buildImportContrattiRows()
    if (!rows) return
    const csv = [IMPORT_CONTRATTI_COLS, ...rows.map(r => r.map(cellaCsv))].map(r => r.map(csvEscape).join(',')).join('\n')
    await salvaFile(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${file?.name.replace(/\.[^.]+$/, '') ?? 'contratto'}_Import_Contratti.csv`, outDir)
  }

  const handleDownloadImportContrattiXlsx = async () => {
    const rows = buildImportContrattiRows()
    if (!rows) return
    await writeImportContrattiXlsx(rows)
  }

  // nomeBase/dir servono alla scansione continua: ogni contratto della coda produce il
  // PROPRIO xlsx, con il nome del suo file, nella cartella scelta a inizio scansione.
  const writeImportContrattiXlsx = (rows: CellaImport[][], nomeBase?: string, dir?: DirHandle | null) =>
    scriviImportContrattiXlsx(rows, nomeBase ?? file?.name.replace(/\.[^.]+$/, '') ?? 'contratto', dir === undefined ? outDir : dir)

  // ── Compila Excel da testo OCR (MD/grezzo): struttura al volo con l'LLM, poi scarica.
  // Utile dopo uno scan Tesseract in modalità MARKDOWN: non serve riscansionare.
  // Obiettivo = output come Import_Contratti_COMPILATO: UNA riga per voce dell'elenco prezzi.
  // Quindi struttura come IMPORT P6 (multi-riga); se nessuna voce viene estratta, ripiega sul
  // contratto piatto (una riga) così l'Excel non esce mai vuoto.
  // Restituisce anche il JSON da cui è uscito l'Excel e in quale formato: la coda lo
  // tiene come risultato della voce, così il pannello mostra il documento strutturato
  // (non il testo grezzo) e «↓ Excel» sulla riga lo riesporta senza riscansionare.
  const compileExcelFromText = async (text: string, nomeBase?: string, dir?: DirHandle | null, allegati?: string): Promise<{ json: string; formato: Format }> => {
    // 1) Elenco prezzi multi-riga (come il gold Import_Contratti_COMPILATO).
    const alyJson = await postOcr({ text, format: 'contratti', ...(allegati ? { testoAllegati: allegati } : {}) })
    let rows = buildImportContrattiRowsFromAlyante(alyJson)
    let esito = { json: alyJson, formato: 'contratti' as Format }
    // 2) Fallback: nessuna voce elenco prezzi → almeno la testata come una riga contratto.
    if (!rowsHaveData(rows)) {
      const cJson = await postOcr({ text, format: 'contract', ...(allegati ? { testoAllegati: allegati } : {}) })
      const cRows = buildImportContrattiRowsFromContract(cJson)
      if (rowsHaveData(cRows)) { rows = cRows; esito = { json: cJson, formato: 'contract' } }
    }
    if (!rowsHaveData(rows)) {
      throw new Error('Testo OCR non riconosciuto come contratto: nessun dato estratto. Controlla che lo scan contenga testo leggibile.')
    }
    await writeImportContrattiXlsx(rows!, nomeBase, dir)
    return esito
  }

  // Pagina Claude, formati contratto: stesso percorso di compileExcelFromText (elenco
  // prezzi → ripiego testata → Excel), ma il server parte dall'Estratto che ha
  // scritto Claude invece che dal testo OCR.
  const compileExcelDaEstratto = async (estratto: Estratto, nomeBase?: string, dir?: DirHandle | null, allegati?: string): Promise<{ json: string; formato: Format }> => {
    const alyJson = await postOcr({ estratto, format: 'contratti', ...(allegati ? { testoAllegati: allegati } : {}) })
    let rows = buildImportContrattiRowsFromAlyante(alyJson)
    let esito = { json: alyJson, formato: 'contratti' as Format }
    if (!rowsHaveData(rows)) {
      const cJson = await postOcr({ estratto, format: 'contract', ...(allegati ? { testoAllegati: allegati } : {}) })
      const cRows = buildImportContrattiRowsFromContract(cJson)
      if (rowsHaveData(cRows)) { rows = cRows; esito = { json: cJson, formato: 'contract' } }
    }
    if (!rowsHaveData(rows)) {
      throw new Error('La risposta di Claude non contiene dati di contratto (testata e righe vuote). Controlla che il documento sia stato allegato in Claude.')
    }
    await writeImportContrattiXlsx(rows!, nomeBase, dir)
    return esito
  }

  const handleCompileExcelFromText = async () => {
    if (!result || loading) return
    setLoading(true)
    setError('')
    try {
      await compileExcelFromText(result, undefined, undefined, await testoAllegatiExcel())
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // ── CSV: contratto ──
  const handleDownloadContractCSV = async () => {
    if (!result) return
    let rows: (string | number)[][]
    try {
      const parsed = JSON.parse(result)
      const contracts = Array.isArray(parsed) ? parsed : [parsed]
      rows = contracts.map(c => contractJsonToRow(c as Record<string, unknown>))
    } catch {
      rows = [[result]]
    }
    const csv = [CONTRACT_COLUMNS, ...rows].map(r => r.map(csvEscape).join(',')).join('\n')
    await salvaFile(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `${file?.name.replace(/\.[^.]+$/, '') ?? 'contratto'}_export.csv`, outDir)
  }

  // Scansione completa del file corrente nel formato dato; ritorna il testo finale
  // (lo stesso che finisce in `result`). Non tocca loading/error: ci pensano i chiamanti.
  const runScan = async (fmt: Format = format, motore?: 'paddle' | 'ai'): Promise<string> => {
    if (fileKind === 'docx') {
      const text = await processDocxResult(fmt)
      setResult(text)
      return text
    }

    if (fileKind === 'pdf') {
      if (!pdfRef.current) {
        const buffer = await file!.arrayBuffer()
        pdfRef.current = await apriPdf(buffer)
      }
      const pdf = pdfRef.current!
      const total = pdf.numPages
      setProgress({ current: 0, total })
      const parts: string[] = new Array(total)
      let done = 0
      let failedPage = 0
      // gli allegati Excel viaggiano con la PRIMA pagina soltanto: le pagine sono
      // richieste separate e le righe vengono concatenate, mandarli su ognuna
      // duplicherebbe le voci dell'allegato per ogni pagina del contratto
      const allegati = (fmt === 'contratti' || fmt === 'contract') ? await testoAllegatiExcel() : ''
      // AI/vision: una richiesta per volta (una GPU regge un solo modello vision alla
      // volta; in parallelo le pagine successive andrebbero in timeout in coda).
      const conc = motore === 'ai' ? 1 : CONCURRENCY
      try {
        await runPool(total, conc, async idx => {
          const suPagina = idx === 0 ? allegati : ''
          try {
            const esito = await scansionaPaginaPdf(pdf, idx + 1, fmt, motore, suPagina)
            parts[idx] = timbraPagina(esito.testo, idx + 1, esito.nativo)
          } catch (err) {
            if (!failedPage) failedPage = idx + 1 // segna la prima pagina fallita per riprendere
            throw err
          }
          done++
          setProgress({ current: done, total })
          mostraParziale(parts, fmt)
        })
      } catch (err) {
        parzialeFine()
        const okParts = parts.filter(Boolean) // salva le pagine già elaborate
        if (okParts.length > 0) setResult(joinParts(okParts, fmt))
        if (failedPage) setScanPage(failedPage)
        throw err
      }
      parzialeFine()
      return joinParts(parts.filter(Boolean), fmt)
    }

    // image
    const text = await ocrBatch(await imageFileToPng(file!), 2, fmt, motore)
    setResult(text)
    return text
  }

  const handleProcess = async (forza = false) => {
    if (!file || loading) return
    if (!forza && chiediCoppia([activeIdx], () => handleProcess(true))) return
    setLoading(true)
    setSchedaOriginale(false)             // avanzamento, poi risultato
    setError('')
    setResult('')
    try {
      const text = await runScan()
      // in .MD il testo mostrato è quello unito con la bozza Word, se c'è
      if (format === 'md' && fileKind === 'pdf') {
        const { testo, confronto } = await confrontaConBozza(file, text)
        const i = activeIdx
        setQueue(q => {
          if (!q[i]) return q
          const copy = q.slice()
          copy[i] = { ...copy[i], result: testo, formato: 'md', confronto }
          return copy
        })
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
      setProgress({ current: 0, total: 0 })
    }
  }

  // Scansione diretta con AI: trascrive le pagine col modello vision locale (Ollama),
  // saltando PaddleOCR. Solo PDF/immagini; richiede un modello vision (health.vision).
  const handleProcessAI = async () => {
    if (!file || loading || !(fileKind === 'pdf' || fileKind === 'image')) return
    setLoading(true)
    setSchedaOriginale(false)             // avanzamento, poi risultato
    setError('')
    setResult('')
    try {
      await runScan(format, 'ai')
    } catch (err: unknown) {
      if (!(err instanceof Error && err.name === 'AbortError'))
        setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
      setProgress({ current: 0, total: 0 })
    }
  }

  const handleScanOnePage = async (advance = false) => {
    if (!file || loading || fileKind !== 'pdf') return
    setLoading(true)
    setSchedaOriginale(false)             // avanzamento, poi risultato
    setError('')
    try {
      if (!pdfRef.current) {
        const buffer = await file.arrayBuffer()
        pdfRef.current = await apriPdf(buffer)
      }
      const esito = await scansionaPaginaPdf(pdfRef.current!, scanPage)
      const text = timbraPagina(esito.testo, scanPage, esito.nativo)
      setResult(prev => {
        if (!prev) return text
        if (format === 'json' || format === 'contratti' || format === 'contract') {
          try {
            const a = JSON.parse(prev)
            const b = JSON.parse(text)
            const arr = Array.isArray(a) ? [...a, b] : [a, b]
            return JSON.stringify(arr, null, 2)
          } catch { return `${prev}\n\n${text}` }
        }
        return `${prev}\n\n---\n\n${text}`
      })
      if (advance && scanPage < pdfPageCount) setScanPage(p => p + 1)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const handleScanRange = async () => {
    if (!file || loading || fileKind !== 'pdf') return
    const from = Math.max(1, scanFrom)
    const to = Math.min(pdfPageCount, scanTo)
    if (from > to) return
    setLoading(true)
    setError('')
    setResult('')
    try {
      if (!pdfRef.current) {
        const buffer = await file.arrayBuffer()
        pdfRef.current = await apriPdf(buffer)
      }
      const total = to - from + 1
      setProgress({ current: 0, total })
      const parts: string[] = new Array(total)
      let done = 0
      let failedPage = 0
      try {
        await runPool(total, CONCURRENCY, async idx => {
          try {
            const esito = await scansionaPaginaPdf(pdfRef.current!, from + idx)
            parts[idx] = timbraPagina(esito.testo, from + idx, esito.nativo)
          } catch (err) {
            if (!failedPage) failedPage = from + idx
            throw err
          }
          done++
          setProgress({ current: done, total })
          mostraParziale(parts)
        })
        parzialeFine()
        setResult(joinParts(parts.filter(Boolean)))
      } catch (err) {
        parzialeFine()
        const okParts = parts.filter(Boolean)
        if (okParts.length > 0) setResult(joinParts(okParts))
        if (failedPage) setScanFrom(failedPage)
        throw err
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
      setProgress({ current: 0, total: 0 })
    }
  }

  // ── OCR di un singolo file → testo, senza toccare lo stato del file attivo.
  // Usato da "Scan coda": stessa pipeline di handleProcess ma autonoma (PDF caricato
  // e distrutto localmente, progress per-pagina condiviso).
  const ocrFile = async (f: File, fmt: Format = format, allegati = '', raccolta?: Incerta[]): Promise<string> => {
    const kind = detectKind(f)
    if (kind === 'text') return f.text()
    if (kind === 'docx') {
      const raw = await docxATesto(f)
      if (fmt === 'contract' || fmt === 'contratti') return postOcr({ text: raw, format: fmt, origine: 'nativo', ...(allegati ? { testoAllegati: allegati } : {}) })
      const lines = raw.split('\n').map(l => l.trim()).filter(Boolean)
      return fmt === 'md' ? lines.join('\n') : JSON.stringify({ tipo_documento: 'Word', testo: lines }, null, 2)
    }
    if (kind === 'pdf') {
      const buf = await f.arrayBuffer()
      const pdf = await apriPdf(buf)
      try {
        const total = pdf.numPages
        setProgress({ current: 0, total })
        const parts: string[] = new Array(total)
        let done = 0
        await runPool(total, CONCURRENCY, async idx => {
          // allegati solo sulla prima pagina (le pagine sono richieste separate)
          const suPagina = idx === 0 ? allegati : ''
          const esito = await scansionaPaginaPdf(pdf, idx + 1, fmt, undefined, suPagina, raccolta)
          parts[idx] = timbraPagina(esito.testo, idx + 1, esito.nativo)
          done++
          setProgress({ current: done, total })
        })
        return joinParts(parts.filter(Boolean), fmt)
      } finally {
        pdf.destroy()
        setProgress({ current: 0, total: 0 })
      }
    }
    if (kind === 'image') return ocrBatch(await imageFileToPng(f), 2, fmt, undefined, allegati, raccolta)
    throw new Error(`"${f.name}": formato non supportato per lo scan in coda`)
  }

  // ── Lavori lato server ─────────────────────────────────────────────────────
  // Il PDF si carica una volta e il server fa tutto (testo nativo, OCR, confronto con
  // la bozza, estrazione). Si segue lo stato via SSE; se la connessione cade si passa
  // al polling. Chiudere la scheda non ferma il lavoro: al ritorno ci si riaggancia.
  const [faseLavoro, setFaseLavoro] = useState('')
  const leggiLavoro = async (id: string, signal?: AbortSignal): Promise<Lavoro> => {
    const r = await fetch(`/api/lavori/${id}`, { signal })
    if (!r.ok) throw new Error(await messaggioErrore(r))
    return (await r.json()) as Lavoro
  }
  const finale = (l: Lavoro) => l.stato === 'fatto' || l.stato === 'errore' || l.stato === 'annullato'
  const seguiLavoro = (id: string, signal: AbortSignal, suStato?: (l: Lavoro) => void): Promise<Lavoro> => new Promise((resolve, reject) => {
    let chiuso = false
    let polling: ReturnType<typeof setTimeout> | null = null
    const es = new EventSource(`/api/lavori/${id}/eventi`)
    const fine = (l: Lavoro) => {
      if (chiuso) return
      chiuso = true
      es.close()
      if (polling) clearTimeout(polling)
      signal.removeEventListener('abort', annulla)
      if (l.stato === 'fatto') resolve(l)
      else if (l.stato === 'annullato') reject(erroreAbort())
      else reject(new Error(l.errore || 'lavoro fallito'))
    }
    const mostra = (l: Lavoro) => {
      if (suStato) suStato(l)
      else {
        setFaseLavoro(l.fase)
        setProgress({ current: l.pagina, total: l.pagine })
      }
      if (finale(l)) fine(l)
    }
    const annulla = () => { if (!chiuso) { chiuso = true; es.close(); if (polling) clearTimeout(polling); reject(erroreAbort()) } }
    signal.addEventListener('abort', annulla)
    es.onmessage = ev => { try { mostra(JSON.parse(ev.data) as Lavoro) } catch { /* evento non JSON */ } }
    // connessione SSE persa (proxy, rete): si continua a chiedere lo stato ogni 2 s
    es.onerror = () => {
      es.close()
      if (chiuso || polling) return
      const giro = async () => {
        if (chiuso) return
        try {
          const l = await leggiLavoro(id, signal)
          // il risultato viaggia solo nell'ultimo evento SSE; via GET c'è sempre
          mostra(l)
        } catch (e) { if (e instanceof Error && e.name === 'AbortError') return }
        if (!chiuso) polling = setTimeout(giro, 2000)
      }
      void giro()
    }
  })

  // Risultato del lavoro → voce della coda ed Excel, come farebbe elaboraDocumento.
  // `senzaExcel`: dopo un reload il risultato torna in coda senza scrivere file (l'Excel
  // si salva poi con «↓ Excel», nella cartella che si sceglie in quel momento).
  const applicaLavoro = async (f: File, l: Lavoro, dir: DirHandle | null, scrivi: (v: Partial<VoceCoda>) => void, allegati = '', senzaExcel = false) => {
    const r = l.risultato
    if (!r) throw new Error('lavoro senza risultato')
    scrivi({ testo: r.testo, confronto: r.confronto, incerte: r.incerte, lavoroId: l.id, faseServer: undefined })
    if (r.formato === 'md') { scrivi({ result: r.json, formato: 'md', motore: 'ocr' }); return }
    let json = r.json
    let formato: Format = r.formato
    let rows = formato === 'contratti' ? buildImportContrattiRowsFromAlyante(json) : buildImportContrattiRowsFromContract(json)
    // il server ripiega già a CONTRATTO senza elenco prezzi; qui il ripiego resta per
    // parità con la strada nel browser (righe presenti ma vuote)
    if (!rowsHaveData(rows) && formato === 'contratti') {
      const cJson = await postOcr({ text: r.testo, format: 'contract', ...(allegati ? { testoAllegati: allegati } : {}) })
      const cRows = buildImportContrattiRowsFromContract(cJson)
      if (rowsHaveData(cRows)) { rows = cRows; json = cJson; formato = 'contract' }
    }
    if (!rowsHaveData(rows)) throw new Error('Testo OCR non riconosciuto come contratto: nessun dato estratto. Controlla che lo scan contenga testo leggibile.')
    if (!senzaExcel) await writeImportContrattiXlsx(rows!, f.name.replace(/\.[^.]+$/, ''), dir)
    scrivi({ result: json, testo: r.testo, formato, motore: 'ocr' })
    if (formato !== format) setFormat(formato)
  }

  // Dopo un reload: la voce ha un lavoro sul server e nessun risultato. Si chiede lo
  // stato; se è ancora in corso lo si segue in sottofondo (la riga mostra la fase),
  // se è finito si prende il risultato. La voce si ritrova per chiave, non per indice:
  // nel frattempo la coda può cambiare.
  const riagganciaLavoro = async (chiave: string, id: string, f: File) => {
    const scrivi = (patch: Partial<VoceCoda>) => setQueue(q => q.map(v => chiaveFile(v.file) === chiave ? { ...v, ...patch } : v))
    let l: Lavoro
    try { l = await leggiLavoro(id) } catch { scrivi({ lavoroId: undefined }); return }   // il server non lo ha più
    try {
      if (!finale(l)) {
        scrivi({ faseServer: l.fase })
        l = await seguiLavoro(id, new AbortController().signal, x => scrivi({ faseServer: x.fase }))
      }
      await applicaLavoro(f, l, null, scrivi, '', true)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'errore'
      scrivi({ faseServer: undefined, lavoroId: undefined })
      const nome = chiave.split('|')[0]
      if (!(err instanceof Error && err.name === 'AbortError')) setBatchLog(log => [...log.filter(e => e.nome !== nome), { nome, ok: false, msg }])
    }
  }
  const annullaLavoroServer = (chiave: string, id: string) => {
    fetch(`/api/lavori/${id}`, { method: 'DELETE' }).catch(() => {})
    setQueue(q => q.map(v => chiaveFile(v.file) === chiave ? { ...v, faseServer: undefined, lavoroId: undefined } : v))
  }

  const elaboraSulServer = async (i: number, dir: DirHandle | null, scrivi: (v: Partial<VoceCoda>) => void) => {
    const f = queue[i].file
    abortRef.current = new AbortController()
    const signal = abortRef.current.signal
    const bozza = bozzaWordPer(f)
    const allegati = (format === 'contratti' || format === 'contract') ? await testoAllegatiExcel(f) : ''
    setFaseLavoro('invio del file al server')
    const crea = await fetch('/api/lavori', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({
        nome: f.name, chiaveFile: chiaveFile(f), formato: format,
        testoAllegati: allegati || undefined,
        bozza: bozza ? { nome: bozza.name, testo: await docxATesto(bozza) } : undefined,
      }),
    })
    if (!crea.ok) throw new Error(await messaggioErrore(crea))
    const { id } = (await crea.json()) as { id: string }
    scrivi({ lavoroId: id })
    let lavoro: Lavoro
    try {
      const put = await fetch(`/api/lavori/${id}/file`, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: f, signal })
      if (!put.ok) throw new Error(await messaggioErrore(put))
      lavoro = await seguiLavoro(id, signal)
    } catch (e: unknown) {
      // «Annulla» ferma anche il lavoro sul server, non solo l'attesa
      if (e instanceof Error && e.name === 'AbortError') fetch(`/api/lavori/${id}`, { method: 'DELETE' }).catch(() => {})
      throw e
    } finally {
      setFaseLavoro('')
    }
    await applicaLavoro(f, lavoro, dir, scrivi, allegati)
  }

  // ── Sessione: IndexedDB ricorda coda e risultati fra un'apertura e l'altra ──
  useEffect(() => {
    let vivo = true
    leggiSessione().then(s => {
      if (!vivo) return
      if (s && s.voci.length) setSessionePrecedente(s)
      else decisioneSessione.current = true
    })
    return () => { vivo = false }
  }, [])
  useEffect(() => {
    if (!decisioneSessione.current) return
    const t = window.setTimeout(() => {
      void salvaSessione({
        voci: queue.map(v => ({ file: v.file, result: v.result, testo: v.testo, formato: v.formato, confronto: v.confronto, incerte: v.incerte, lavoroId: v.lavoroId, motore: v.motore })),
        activeIdx, format, abbinamenti, salvataAl: Date.now(),
      })
    }, 800)
    return () => window.clearTimeout(t)
  }, [queue, activeIdx, format, abbinamenti])
  const riprendiSessione = () => {
    const s = sessionePrecedente
    if (!s) return
    setSessionePrecedente(null)
    decisioneSessione.current = true
    const voci = s.voci.map(v => ({ ...v, formato: v.formato as Format | undefined, confronto: v.confronto as VoceCoda['confronto'], incerte: v.incerte as Incerta[] | undefined, motore: (v.motore === 'ocr' || v.motore === 'claude' ? v.motore : undefined) as Motore | undefined }))
    setQueue(voci)
    setAbbinamenti(s.abbinamenti ?? {})
    if (s.format === 'contratti' || s.format === 'contract' || s.format === 'md' || s.format === 'json') setFormat(s.format)
    const idx = Math.min(Math.max(0, s.activeIdx), voci.length - 1)
    setActiveIdx(idx)
    if (voci[idx]) { loadPreview(voci[idx].file, idx); setSchedaOriginale(!voci[idx].result) }
    // lavori lasciati a metà sul server: si riagganciano
    for (const v of voci) if (v.lavoroId && !v.result) void riagganciaLavoro(chiaveFile(v.file), v.lavoroId, v.file)
  }
  const scartaSessione = () => {
    setSessionePrecedente(null)
    decisioneSessione.current = true
    void cancellaSessione()
  }

  // ── Elaborazione di UNA voce della coda, dall'inizio alla fine ─────────────
  // Sui formati contratto: scan in MD (il backend può rilavorare pagina per pagina),
  // compilazione e salvataggio dell'Import_Contratti.xlsx col nome del file, nella
  // cartella scelta; il JSON compilato diventa il risultato della voce. Sugli altri
  // formati: solo l'OCR nel formato scelto. Non tocca lo stato di caricamento: ci
  // pensano i chiamanti (una voce sola / tutta la coda).
  const elaboraDocumento = async (i: number, dir: DirHandle | null) => {
    const f = queue[i].file
    setActiveIdx(i)
    loadPreview(f, i)                       // il pannello segue il file in lavorazione
    setSchedaOriginale(false)               // avanzamento, poi risultato
    const scrivi = (voce: Partial<VoceCoda>) => setQueue(q => {
      if (!q[i]) return q
      const copy = q.slice()
      copy[i] = { ...copy[i], ...voce }
      return copy
    })
    // PDF nei formati contratto/testo: sul server, se il server lo sa fare
    if (health?.lavori && detectKind(f) === 'pdf' && (format === 'contratti' || format === 'contract' || format === 'md')) {
      await elaboraSulServer(i, dir, scrivi)
      return
    }
    const incerte: Incerta[] = []
    if (format === 'contratti' || format === 'contract') {
      const allegati = await testoAllegatiExcel(f)
      const grezzo = await ocrFile(f, 'md', '', incerte)
      if (!grezzo.trim()) throw new Error('scansione vuota, nessun testo riconosciuto')
      // con la bozza Word in coda l'estrazione parte dal testo unito, non dall'OCR nudo
      const { testo, confronto } = await confrontaConBozza(f, grezzo)
      scrivi({ testo, confronto, incerte })
      const { json, formato } = await compileExcelFromText(testo, f.name.replace(/\.[^.]+$/, ''), dir, allegati)
      scrivi({ result: json, testo, formato, incerte, motore: 'ocr' })
      if (formato !== format) setFormat(formato)     // ripiego a CONTRATTO: la barra lo segue
    } else {
      let text = await ocrFile(f, format, '', incerte)
      let confronto: VoceCoda['confronto'] = undefined
      if (format === 'md') ({ testo: text, confronto } = await confrontaConBozza(f, text))
      scrivi({ result: text, testo: undefined, formato: format, confronto, incerte, motore: 'ocr' })
    }
  }

  // Cartella di destinazione: si chiede una volta sola, la prima volta che serve; poi
  // si cambia dal riquadro «Salva in» della barra. Null = download del browser.
  const cartellaExport = async (): Promise<DirHandle | null> => {
    if (!supportaCartella()) return null
    if (outDir) return outDir
    const dir = await chiediCartella()
    if (dir) setOutDir(dir)
    return dir
  }

  // «Scansiona» sulla riga (o «Rifai» sul file attivo): una voce sola.
  const handleElaboraUno = async (i: number, forza = false) => {
    if (loading || !queue[i] || !daElaborare(queue[i].file)) return
    if (!forza && chiediCoppia([i], () => handleElaboraUno(i, true))) return
    const dir = await cartellaExport()
    setLoading(true)
    setError('')
    setBatchLog(log => log.filter(e => e.nome !== queue[i].file.name))
    try {
      await elaboraDocumento(i, dir)
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message)
        setBatchLog(log => [...log, { nome: queue[i].file.name, ok: false, msg: err.message }])
      }
    } finally {
      setLoading(false)
      setProgress({ current: 0, total: 0 })
    }
  }

  // «Elabora tutti»: le voci ancora senza risultato, una dopo l'altra. Non si ferma al
  // primo errore: il contratto che fallisce viene annotato nella sua riga e si passa
  // al successivo, così una scansione lunga non va persa per un file rotto. «Annulla»
  // (AbortError) invece ferma tutto.
  const handleElaboraTutti = async (forza = false) => {
    if (loading) return
    const daFare = queue
      .map((q, i) => i)
      .filter(i => daFarePer(queue[i]) && inSelezione(queue[i].file))
    if (!daFare.length) return
    if (!forza && chiediCoppia(daFare, () => handleElaboraTutti(true))) return
    const dir = await cartellaExport()
    setLoading(true)
    setError('')
    setBatchLog([])
    setBatch({ current: 0, total: daFare.length })
    const esiti: { nome: string; ok: boolean; msg?: string }[] = []
    try {
      for (let k = 0; k < daFare.length; k++) {
        const i = daFare[k]
        setBatch({ current: k + 1, total: daFare.length })
        try {
          await elaboraDocumento(i, dir)
          esiti.push({ nome: queue[i].file.name, ok: true })
        } catch (err: unknown) {
          if (err instanceof Error && err.name === 'AbortError') throw err
          esiti.push({ nome: queue[i].file.name, ok: false, msg: err instanceof Error ? err.message : 'errore' })
        }
        setBatchLog(esiti.slice())
      }
      const falliti = esiti.filter(e => !e.ok)
      if (falliti.length) setError(`${falliti.length}/${esiti.length} documenti non elaborati — il motivo è nella colonna Esito.`)
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') setError(err.message)
    } finally {
      setLoading(false)
      setProgress({ current: 0, total: 0 })
      setBatch(null)
    }
  }

  // ── Pagina Claude ──────────────────────────────────────────────────────────
  // Un documento per volta: si apre claude.ai col prompt del formato scelto già
  // scritto, si allega il file lì, si incolla qui la risposta e si elabora. Da lì in
  // poi (strutturazione, elenchi ufficiali, Excel) è la filiera della pagina OCR.
  const promptPer = (i: number): string => {
    const f = queue[i].file
    return promptClaude(format, f.name, allegatiPerDocumento(f).length > 0, getElenchi())
  }

  // Prossimo documento da fare: quello attivo se è ancora da fare, altrimenti il primo.
  const prossimoDaFare = (): number => {
    if (activeIdx >= 0 && queue[activeIdx] && daFarePer(queue[activeIdx])) return activeIdx
    return queue.findIndex(q => daFarePer(q) && inSelezione(q.file))
  }

  // Porta in vista il riquadro «incolla la risposta» della pagina Claude (scheda
  // risultato, non «Originale»; fuori dal confronto e dalla modifica).
  const mostraRiquadroClaude = () => {
    setSchedaOriginale(false)
    setSchedaConfronto(false)
    setEditMode(false)
  }

  // Apre la finestra di Claude col prompt pronto. Va chiamato da un click: i popup
  // aperti fuori da un gesto dell'utente li blocca il browser.
  const apriClaude = (i: number) => {
    if (loading || !queue[i]) return
    if (i !== activeIdx) selectFile(i)
    setRispostaClaude('')
    setError('')
    // Il riquadro dove incollare la risposta sta nella scheda del risultato: un file
    // appena aggiunto mostra «Originale», e tornando da Claude col JSON in mano non
    // si trovava dove metterlo.
    mostraRiquadroClaude()
    const w = apriPopup(urlClaude(promptPer(i)))
    if (!w) setError('Il browser ha bloccato la finestra di Claude: consenti i popup per questo sito, oppure copia il prompt e aprilo a mano su claude.ai.')
  }

  const copiaPromptClaude = async (i: number) => {
    if (!queue[i]) return
    mostraRiquadroClaude()
    try {
      await navigator.clipboard.writeText(promptPer(i))
      setPromptCopiato(true)
      setTimeout(() => setPromptCopiato(false), 2000)
    } catch { setError('Copia negli appunti non riuscita') }
  }

  // «Rifai con Claude»: via il risultato della voce (torna il riquadro da incollare) e
  // si riapre la finestra. Il file resta in coda con la sua anteprima.
  const rifaiConClaude = (i: number) => {
    if (loading || !queue[i]) return
    setQueue(q => {
      if (!q[i]) return q
      const copy = q.slice()
      copy[i] = { ...copy[i], result: '', testo: undefined, formato: undefined, confronto: undefined, excelDaClaude: false }
      return copy
    })
    apriClaude(i)
  }

  // IMPORT P6 con Claude: l'Excel l'ha creato Claude e l'utente l'ha scaricato dalla
  // sua finestra. Qui si segna solo che il documento è fatto (coda, «prossimo da fare»).
  const segnaExcelDaClaude = (i: number) => {
    if (!queue[i]) return
    setQueue(q => {
      if (!q[i]) return q
      const copy = q.slice()
      copy[i] = { ...copy[i], excelDaClaude: true, motore: 'claude' }
      return copy
    })
    setBatchLog(log => [...log.filter(e => e.nome !== queue[i].file.name), { nome: queue[i].file.name, ok: true }])
    setRispostaClaude('')
  }

  // Risposta incollata → risultato della voce (e, sui formati contratto, il suo Excel).
  const elaboraDaClaude = async (i: number) => {
    const risposta = rispostaClaude.trim()
    if (loading || !queue[i] || !risposta) return
    const f = queue[i].file
    const scrivi = (voce: Partial<VoceCoda>) => setQueue(q => {
      if (!q[i]) return q
      const copy = q.slice()
      copy[i] = { ...copy[i], ...voce }
      return copy
    })
    setLoading(true)
    setError('')
    setBatchLog(log => log.filter(e => e.nome !== f.name))
    try {
      if (format === 'contratti' || format === 'contract') {
        const estratto = leggiEstratto(risposta)
        const dir = await cartellaExport()
        const { json, formato } = await compileExcelDaEstratto(estratto, f.name.replace(/\.[^.]+$/, ''), dir, await testoAllegatiExcel(f))
        // `testo` = la risposta di Claude: è ciò da cui viene il risultato (Riprocessa la rilegge)
        scrivi({ result: json, testo: risposta, formato, confronto: undefined, motore: 'claude' })
        if (formato !== format) setFormat(formato)
      } else {
        const text = format === 'json' ? leggiTrascrizioneJson(risposta) : leggiTrascrizioneMd(risposta)
        scrivi({ result: text, testo: undefined, formato: format, confronto: undefined, motore: 'claude' })
      }
      setRispostaClaude('')
      setBatchLog(log => [...log, { nome: f.name, ok: true }])
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message)
        setBatchLog(log => [...log, { nome: f.name, ok: false, msg: err.message }])
      }
    } finally {
      setLoading(false)
    }
  }

  // «↓ Excel» sulla riga: riesporta dal risultato già in coda, senza riscansionare.
  // Il formato del risultato è quello della voce (ripiego) o quello in barra.
  const esportaRiga = async (i: number) => {
    const voce = queue[i]
    if (!voce?.result) return
    const fmt = voce.formato ?? format
    if (fmt === 'contratti' || fmt === 'contract') {
      const rows = fmt === 'contract'
        ? buildImportContrattiRowsFromContract(voce.result)
        : buildImportContrattiRowsFromAlyante(voce.result)
      if (!rowsHaveData(rows)) { setError(`"${voce.file.name}": nessun dato da esportare`); return }
      await writeImportContrattiXlsx(rows!, voce.file.name.replace(/\.[^.]+$/, ''))
    } else {
      await salvaFile(new Blob([voce.result], { type: 'text/plain' }), `${voce.file.name.replace(/\.[^.]+$/, '')}.${fmt === 'json' ? 'json' : 'md'}`, outDir)
    }
  }

  // Export in blocco dei file spuntati (tutti quelli pronti se nessuno è spuntato)
  const esportaSelezionati = async () => {
    for (let i = 0; i < queue.length; i++) if (queue[i].result && inSelezione(queue[i].file)) await esportaRiga(i)
  }

  const handleScegliCartella = async () => {
    const dir = await chiediCartella()
    if (dir) setOutDir(dir)
  }

  const handleDownload = async () => {
    if (!result) return
    const ext = format === 'json' ? 'json' : 'md'
    await salvaFile(new Blob([result], { type: 'text/plain' }), `${file?.name.replace(/\.[^.]+$/, '') ?? 'output'}.${ext}`, outDir)
  }

  const handleDownloadDocx = async () => {
    if (!result) return
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, HeadingLevel, WidthType, AlignmentType } = await import('docx')
    const baseName = file?.name.replace(/\.[^.]+$/, '') ?? 'output'
    const children: (DocxParagraph | DocxTable)[] = []

    if (format === 'json') {
      result.split('\n').forEach(line => {
        children.push(new Paragraph({
          children: [new TextRun({ text: line, font: 'Courier New', size: 20 })]
        }))
      })
    } else {
      const lines = result.split('\n')
      let i = 0
      while (i < lines.length) {
        const line = lines[i]
        if (line.startsWith('### ')) {
          children.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }))
        } else if (line.startsWith('## ')) {
          children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }))
        } else if (line.startsWith('# ')) {
          children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }))
        } else if (line.startsWith('| ')) {
          // collect table block
          const tableLines: string[] = []
          while (i < lines.length && lines[i].startsWith('|')) {
            if (!/^\|[\s\-|]+\|$/.test(lines[i])) tableLines.push(lines[i])
            i++
          }
          if (tableLines.length) {
            const rows = tableLines.map(tl => {
              const cells = tl.split('|').slice(1, -1)
              return new TableRow({
                children: cells.map(cell => new TableCell({
                  children: [new Paragraph({ text: cell.trim(), alignment: AlignmentType.LEFT })]
                }))
              })
            })
            children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }))
          }
          continue
        } else if (line.startsWith('- ')) {
          children.push(new Paragraph({ text: line.slice(2), bullet: { level: 0 } }))
        } else if (line === '---') {
          children.push(new Paragraph({ text: '' }))
        } else if (!line.trim()) {
          children.push(new Paragraph({ text: '' }))
        } else {
          // inline bold **text**
          const runs: DocxTextRun[] = []
          const boldRe = /\*\*(.*?)\*\*/g
          let last = 0, m: RegExpExecArray | null
          while ((m = boldRe.exec(line)) !== null) {
            // "><(((º> sabusabu <º)))><"
            if (m.index > last) runs.push(new TextRun(line.slice(last, m.index)))
            runs.push(new TextRun({ text: m[1], bold: true }))
            last = m.index + m[0].length
          }
          if (last < line.length) runs.push(new TextRun(line.slice(last)))
          children.push(new Paragraph({ children: runs.length ? runs : [new TextRun(line)] }))
        }
        i++
      }
    }

    const doc = new Document({ sections: [{ children }] })
    await salvaFile(await Packer.toBlob(doc), `${baseName}.docx`, outDir)
  }

  const handleDirectToDocx = async () => {
    if (!file || fileKind !== 'pdf') return
    setLoading(true)
    setError('')
    try {
      const { Document, Packer, Paragraph, TextRun } = await import('docx')
      if (!pdfRef.current) {
        const buffer = await file.arrayBuffer()
        pdfRef.current = await apriPdf(buffer)
      }
      const pdf = pdfRef.current!
      const total = pdf.numPages
      setProgress({ current: 0, total })
      const children: DocxParagraph[] = []

      for (let i = 1; i <= total; i++) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()

        const lineMap = new Map<number, string[]>()
        for (const item of textContent.items as { str: string; transform: number[] }[]) {
          const y = Math.round(item.transform[5])
          if (!lineMap.has(y)) lineMap.set(y, [])
          lineMap.get(y)!.push(item.str)
        }

        const sortedY = [...lineMap.keys()].sort((a, b) => b - a)
        let firstLine = true
        for (const y of sortedY) {
          const line = lineMap.get(y)!.join('').trim()
          if (line) {
            children.push(new Paragraph({
              children: [new TextRun(line)],
              ...(i > 1 && firstLine ? { pageBreakBefore: true } : {}),
            }))
            firstLine = false
          }
        }

        setProgress({ current: i, total })
        page.cleanup()
      }

      if (children.length === 0) {
        throw new Error('Nessun testo trovato nel PDF — il documento è probabilmente una scansione (immagine). Usa "Scan tutto" con modalità Contratto per estrarre il testo via OCR.')
      }

      const baseName = file.name.replace(/\.[^.]+$/, '')
      const doc = new Document({ sections: [{ children }] })
      await salvaFile(await Packer.toBlob(doc), `${baseName}_diretto.docx`, outDir)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
      setProgress({ current: 0, total: 0 })
    }
  }

  const handleCopy = () => {
    if (!result) return
    navigator.clipboard.writeText(result).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  // memo: parse/stringify e conversioni markdown su risultati grandi sono costosi → solo quando cambia l'input
  const displayResult = useMemo(() => {
    if (!result) return ''
    if (format === 'json' || format === 'contract' || format === 'contratti') {
      try { return JSON.stringify(JSON.parse(result), null, 2) }
      catch { return result }
    }
    return result
  }, [result, format])

  const contractMd = useMemo(
    () => (result && format === 'contract' && viewDoc) ? contractJsonToMarkdown(result) : '',
    [result, format, viewDoc]
  )
  const alyanteMd = useMemo(
    () => (result && format === 'contratti' && viewDoc) ? alyanteJsonToMarkdown(result) : '',
    [result, format, viewDoc]
  )

  // Problemi delle righe in modifica: ricalcolati solo quando cambiano le righe.
  const problemiEdit = useMemo(() => {
    const righe = Array.isArray(editData?.righe) ? editData!.righe as Record<string, string>[] : []
    const m = diagnostica(righe)
    // le letture incerte entrano nel filtro «da rivedere»: sono la cosa da guardare
    const voce = queue[activeIdx]
    if (voce?.incerte?.length) righe.forEach((r, i) => {
      for (const campo of ALY_RIGHE_KEYS) {
        const n = notaCella(voce, r, campo)
        if (n?.tipo === 'incerta') (m.get(i) ?? m.set(i, []).get(i)!).push({ campo, testo: `lettura OCR incerta (${n.conf}%): «${n.testo}»`, grave: false })
      }
    })
    return m
  }, [editData, queue, activeIdx])

  const pageScanned = useMemo(() => result ? result.split('\n\n---\n\n').length : 0, [result])
  const wordCount = useMemo(() => result ? result.replace(/[-#*`|>]/g, ' ').split(/\s+/).filter(Boolean).length : 0, [result])
  const canProcess = !!file && !loading
  const pendingCount = queue.filter(q => daFarePer(q) && inSelezione(q.file)).length
  // quanti dei «da fare» hanno già un risultato dell'altro motore (si rifanno)
  const daRifareCount = queue.filter(q => daFarePer(q) && inSelezione(q.file) && !!q.result).length
  // documenti scansionabili in coda (gli Excel sono allegati, non contratti da scansionare)
  const docCount = queue.filter(q => daElaborare(q.file)).length
  // file spuntati ancora in coda, e quanti di loro hanno un risultato da esportare
  const selezionatiCount = queue.filter(q => selezione.has(chiaveFile(q.file))).length
  const esportabiliCount = queue.filter(q => q.result && inSelezione(q.file)).length
  const progressLabel = (batch ? `File ${batch.current}/${batch.total} — ` : '') + (faseLavoro
    ? `${faseLavoro}${progress.total > 0 && !/\d+\/\d+/.test(faseLavoro) ? ` — pag. ${progress.current}/${progress.total}` : ''}…`
    : progress.total > 0
      ? `Rendering pag. ${progress.current}/${progress.total}…`
      : 'elaborazione…')

  // ── Un'azione sola in barra: elabora la coda nel formato scelto ──
  // Sui formati contratto produce direttamente gli Excel (il deliverable); sugli altri
  // si ferma al testo, perché un Excel da un .MD non ha senso.
  const formatoContratto = format === 'contratti' || format === 'contract'
  const etichettaElaboraTutti = pendingCount === 0
    ? (docCount ? 'Tutto elaborato' : 'Elabora')
    : formatoContratto
      ? `${daRifareCount ? 'Rielabora' : 'Elabora'} ${pendingCount === 1 ? '1 contratto' : `${pendingCount} contratti`}${selezionatiCount ? (pendingCount === 1 ? ' selezionato' : ' selezionati') : ''} → Excel`
      : `${daRifareCount ? 'Riscansiona' : 'Scansiona'} ${pendingCount === 1 ? '1 documento' : `${pendingCount} documenti`}${selezionatiCount ? (pendingCount === 1 ? ' selezionato' : ' selezionati') : ''}`

  // ── Avanzamento: due livelli (file della coda + pagina) e tempo stimato ──
  // Su 800 pagine a ~5 s l'una "12/29 pag…" non dice quanto manca: il tempo si
  // stima dalle pagine già fatte in questa scansione.
  const percentuale = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0
  const etichettaAvanzamento = progress.total > 0
    ? `${batch ? `${batch.current}/${batch.total} file · ` : ''}${progress.current}/${progress.total} pag…`
    : 'Elaborazione…'
  const etichettaTempoRimasto = (() => {
    if (!inizioScan || progress.current < 1 || progress.total <= progress.current) return `${percentuale}%`
    const perPagina = (Date.now() - inizioScan) / progress.current
    const secondi = Math.round((perPagina * (progress.total - progress.current)) / 1000)
    if (!isFinite(secondi) || secondi <= 0) return `${percentuale}%`
    const testo = secondi < 60
      ? `${secondi} s`
      : `${Math.floor(secondi / 60)} min${secondi % 60 ? ` ${secondi % 60} s` : ''}`
    return `${percentuale}% · ancora ~${testo}`
  })()

  // Riga sotto il titolo della coda: quanti sono e a che punto stanno
  const fattiCount = queue.filter(q => q.result && daElaborare(q.file)).length
  const bozzeCount = queue.filter(q => detectKind(q.file) === 'docx' && !!pdfDellaBozza(q.file)).length
  const allegatiCount = queue.length - docCount - bozzeCount
  const riepilogoCoda = [
    `${docCount} document${docCount === 1 ? 'o' : 'i'}`,
    `${fattiCount} pront${fattiCount === 1 ? 'o' : 'i'}`,
    `${pendingCount} in attesa`,
    ...(bozzeCount ? [`${bozzeCount} bozz${bozzeCount === 1 ? 'a' : 'e'} Word`] : []),
    ...(allegatiCount ? [`${allegatiCount} allegat${allegatiCount === 1 ? 'o' : 'i'} Excel`] : []),
  ].join(' · ')
  // Scheda evidenziata nel pannello: derivata dagli stati che il resto del codice già usa
  // (viewDoc per i JSON contratto, showRaw per il markdown, editMode per la tabella).
  const voceAttiva = queue[activeIdx] as VoceCoda | undefined
  const inConfronto = schedaConfronto && !!voceAttiva?.confronto
  const schedaAttiva: 'doc' | 'raw' | 'edit' | 'orig' | 'confronto' = editMode ? 'edit'
    : schedaOriginale ? 'orig'
    : inConfronto ? 'confronto'
    : format === 'json' ? 'raw'
    : format === 'md' ? (showRaw ? 'raw' : 'doc')
    : (viewDoc ? 'doc' : 'raw')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: C.bg, color: C.text, fontFamily: FONT, fontSize: 14 }}>

      {/* ── Header ── */}
      <header style={{ padding: '10px 20px', background: C.accent, borderBottom: `2px solid ${C.blue}`, display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, boxShadow: '0 1px 4px rgba(0,0,0,0.18)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 9, fontSize: 17, color: '#ffffff', fontFamily: FONT_HEAD }}>
          <IconMark size={19} />
          <span style={{ fontWeight: 700, letterSpacing: '0.02em' }}>COSEDIL</span>
          <span style={{ fontWeight: 400, opacity: 0.85 }}>· OCR Documenti</span>
        </span>
        {/* Pagina: chi legge il documento. Tutto il resto (coda, formati, export) è uguale. */}
        <div className="segmented riga pagine" role="tablist" aria-label="Motore di lettura" style={{ marginLeft: 6 }}>
          <button role="tab" aria-pressed={pagina === 'ocr'} aria-selected={pagina === 'ocr'} disabled={loading} onClick={() => setPagina('ocr')} title="Legge i documenti con PaddleOCR in locale">
            OCR
          </button>
          <button role="tab" aria-pressed={pagina === 'claude'} aria-selected={pagina === 'claude'} disabled={loading} onClick={() => { setPagina('claude'); mostraRiquadroClaude() }} title="Fa leggere i documenti a Claude (claude.ai): prompt pronto, risposta da incollare">
            CLAUDE
          </button>
        </div>
        <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, letterSpacing: '0.04em', borderLeft: '1px solid rgba(255,255,255,0.25)', paddingLeft: 14 }}>
          {pagina === 'claude' ? 'Estrazione con Claude · claude.ai' : 'PaddleOCR + assist Ollama · locale'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', fontSize: 11.5 }}>
          <button
            onClick={() => setDocModal('readme')}
            title="Note tecniche (README)"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, letterSpacing: '0.02em', fontFamily: 'inherit' }}
          >
            <IconBook size={13} /> README
          </button>
          <button
            onClick={() => setDocModal('guida')}
            title="Guida all'utilizzo del programma"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 999, background: 'rgba(255,255,255,0.14)', border: '1px solid rgba(255,255,255,0.25)', color: '#fff', cursor: 'pointer', fontSize: 11.5, fontWeight: 600, letterSpacing: '0.02em', fontFamily: 'inherit' }}
          >
            <IconHelp size={13} /> Guida
          </button>
          {(health === null
            ? [{ dot: 'rgba(255,255,255,0.6)', label: 'controllo…' }]
            : [
                // ocrErrore: i file ci sono ma il worker muore (es. DLL bloccata da App Control):
                // "bloccato" e non "non trovato", col motivo intero nel tooltip.
                { dot: health.tesseract ? '#7ede9b' : '#ffb3ab', label: `PaddleOCR ${health.tesseract ? 'pronto' : health.ocrErrore ? 'bloccato' : 'non trovato'}`, title: health.ocrErrore },
                { dot: health.ollama ? '#7ede9b' : '#ffe082', label: health.ollama ? `Assist AI · ${health.model ?? 'Ollama'}` : 'Assist AI spento — opzionale' },
              ]
          ).map(s => (
            <span key={s.label} title={'title' in s ? s.title : undefined} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 11px', borderRadius: 999, background: 'rgba(255,255,255,0.10)', color: 'rgba(255,255,255,0.92)', letterSpacing: '0.02em', whiteSpace: 'nowrap', cursor: 'title' in s && s.title ? 'help' : undefined }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: s.dot, flexShrink: 0 }} />
              {s.label}
            </span>
          ))}
        </div>
      </header>

      {/* ── Modal documentazione (README / Guida) ── */}
      {docModal && (
        <div
          onClick={() => setDocModal(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(12,25,38,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            style={{ background: C.panel, borderRadius: 10, width: 'min(880px, 100%)', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 12px 40px rgba(0,0,0,0.35)', overflow: 'hidden' }}
          >
            <div style={{ padding: '12px 20px', background: C.accent, color: '#ffffff', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              {docModal === 'readme' ? <IconBook size={16} /> : <IconHelp size={16} />}
              <span style={{ fontWeight: 700, fontSize: 14, fontFamily: FONT_HEAD, letterSpacing: '0.02em' }}>
                {docModal === 'readme' ? 'README — note tecniche' : "Guida all'utilizzo"}
              </span>
              <button
                onClick={() => setDocModal(null)}
                aria-label="Chiudi"
                style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.12)', border: 'none', color: '#ffffff', width: 26, height: 26, borderRadius: 6, cursor: 'pointer', fontSize: 14, lineHeight: 1, fontFamily: 'inherit' }}
              >
                ✕
              </button>
            </div>
            <div className="markdown-body" style={{ padding: '18px 26px', overflowY: 'auto' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{docModal === 'readme' ? readmeMd : guidaMd}</ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      {/* ── Manca l'altro file: PDF senza bozza Word o Word senza PDF firmato. Si
          chiede prima di scansionare, perché il confronto avviene solo se stanno in
          coda insieme e aggiungere il file dopo vorrebbe dire rifare la scansione. ── */}
      {richiestaCoppia && (() => {
        const { voci, poi } = richiestaCoppia
        const piu = voci.length > 1
        const chiudi = () => setRichiestaCoppia(null)
        return (
          <div
            onClick={chiudi}
            style={{ position: 'fixed', inset: 0, background: 'rgba(12,25,38,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
          >
            <div
              onClick={e => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="titolo-richiesta-coppia"
              style={{ background: C.panel, borderRadius: 10, width: 'min(560px, 100%)', boxShadow: '0 12px 40px rgba(0,0,0,0.35)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
            >
              <div style={{ padding: '12px 20px', background: C.accent, color: '#ffffff', display: 'flex', alignItems: 'center', gap: 10 }}>
                <IconAlert size={16} />
                <span id="titolo-richiesta-coppia" style={{ fontWeight: 700, fontSize: 14, fontFamily: FONT_HEAD, letterSpacing: '0.02em' }}>
                  {piu ? `Manca l’altro file a ${voci.length} documenti` : 'Manca l’altro file'}
                </span>
              </div>
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, color: C.text, lineHeight: 1.5 }}>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {voci.map(v => (
                    <li key={v.nome}>
                      <NomeFile nome={v.nome} style={{ fontWeight: 600, maxWidth: 290, verticalAlign: 'bottom' }} />
                      <span style={{ color: C.muted, whiteSpace: 'nowrap' }}> — {v.manca === 'word' ? 'manca la bozza Word' : 'manca il PDF firmato'}</span>
                    </li>
                  ))}
                </ul>
                <span style={{ color: C.muted, fontSize: 12.5 }}>
                  Bozza Word e PDF firmato si confrontano prima dell’estrazione, e vale il PDF. Il confronto avviene
                  solo se stanno in coda insieme: se l’altro file c’è, aggiungilo e poi riparti.
                </span>
              </div>
              <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8, alignItems: 'center', background: C.header }}>
                <button
                  autoFocus
                  onClick={() => { chiudi(); inputRef.current?.click() }}
                  title="Apre la scelta dei file: aggiunto l’altro file, riparti dalla scansione"
                  style={{ ...bottone('primario', C.accent), width: 'auto', padding: '9px 16px' }}
                >
                  Aggiungi l’altro file
                </button>
                <button
                  onClick={() => { chiudi(); poi() }}
                  title={piu ? 'Elabora i documenti così come sono, senza confronto' : 'Scansiona questo documento da solo, senza confronto'}
                  style={{ ...bottone('secondario', C.accent), width: 'auto', padding: '8px 14px' }}
                >
                  {piu ? 'Elabora comunque' : 'Procedi senza'}
                </button>
                <button onClick={chiudi} style={{ ...bottone('secondario', C.muted), width: 'auto', padding: '8px 14px', marginLeft: 'auto' }}>
                  Annulla
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      <input
        ref={inputRef}
        type="file"
        multiple
        title="Seleziona file da elaborare"
        aria-label="Seleziona file da elaborare"
        accept=".pdf,.docx,.doc,.xlsx,.xls,.md,.markdown,.txt,image/*,text/markdown,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        style={{ display: 'none' }}
        onChange={e => { if (e.target.files?.length) { appendFiles(e.target.files); e.target.value = '' } }}
      />

      {/* ── Error bar ── */}
      {error && (
        <div role="alert" style={{ padding: '8px 20px', background: `${C.red}12`, borderBottom: `1px solid ${C.red}`, borderLeft: `3px solid ${C.red}`, color: C.red, fontSize: 12, flexShrink: 0, letterSpacing: '0.02em', fontWeight: 600 }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Corpo: coda di lavoro + pannello del risultato ──
          Tutta l'area accetta il trascinamento; in elaborazione no, perché aggiungere
          un file cambia il file attivo sotto una scansione in corso. */}
      <div
        style={{ flex: 1, display: 'flex', overflow: 'hidden' }}
        onDrop={e => { if (loading) { e.preventDefault(); setIsDragging(false) } else handleDrop(e) }}
        onDragOver={e => { e.preventDefault(); if (!loading) setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
      >
        {!pannelloLargo && (
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', padding: '16px 20px', gap: 12, overflow: 'auto', outline: isDragging ? `2px dashed ${C.blue}` : 'none', outlineOffset: -6 }}>
            {sessionePrecedente && queue.length === 0 && (() => {
              const n = sessionePrecedente.voci.length
              const fatti = sessionePrecedente.voci.filter(v => v.result).length
              const inCorsoServer = sessionePrecedente.voci.filter(v => v.lavoroId && !v.result).length
              const quando = new Date(sessionePrecedente.salvataAl)
              const oggi = quando.toDateString() === new Date().toDateString()
              return (
                <div className="ripresa-sessione" role="status">
                  <IconDoc size={18} />
                  <span style={{ flex: 1 }}>
                    <b>Sessione precedente</b>: {n} document{n === 1 ? 'o' : 'i'}{fatti ? `, ${fatti} elaborat${fatti === 1 ? 'o' : 'i'}` : ''}{inCorsoServer ? `, ${inCorsoServer} in corso sul server` : ''} —
                    salvata {oggi ? 'oggi alle' : 'il'} {oggi ? quando.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : quando.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <button type="button" onClick={riprendiSessione} style={{ ...bottone('primario', C.accent), width: 'auto', padding: '8px 16px' }}>Riprendi</button>
                  <button type="button" onClick={scartaSessione} style={{ ...bottone('secondario', C.muted), width: 'auto', padding: '7px 14px' }}>Scarta</button>
                </div>
              )
            })()}
            {queue.length === 0 ? (
              /* Prima apertura: un solo gesto possibile */
              <div
                className="dropzone"
                role="button"
                tabIndex={0}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
                onClick={() => inputRef.current?.click()}
                style={{ margin: 'auto', width: 'min(720px, 100%)', padding: '48px 40px', border: `2px dashed ${isDragging ? C.blue : `${C.accent}70`}`, borderRadius: 12, background: isDragging ? 'rgba(25,143,217,0.07)' : C.panel, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, boxShadow: '0 2px 12px rgba(12,69,119,0.06)', userSelect: 'none' }}
              >
                <span style={{ width: 72, height: 72, borderRadius: '50%', background: '#eef4fa', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: C.accent }}>
                  <IconUpload size={34} />
                </span>
                <span style={{ fontFamily: FONT_HEAD, fontSize: 26, color: C.text }}>Trascina qui i contratti</span>
                <span style={{ fontSize: 14, color: C.muted }}>PDF, immagini o Word · anche più file insieme</span>
                <span style={{ ...bottone('primario', C.accent), width: 'auto', padding: '11px 26px', marginTop: 6 }}>Sfoglia file…</span>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                  <span style={{ fontFamily: FONT_HEAD, fontSize: 18, fontWeight: 500 }}>Coda di lavoro</span>
                  <span style={{ fontSize: 12.5, color: C.muted }}>{riepilogoCoda}</span>
                </div>

                {/* ── La coda: una riga per documento, con stato, esito e azione ── */}
                <table className="coda" style={{ minWidth: 620 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 34, textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          aria-label="Seleziona tutti i file"
                          title={selezionatiCount ? 'Deseleziona tutti' : 'Seleziona tutti i file in coda'}
                          checked={queue.length > 0 && selezionatiCount === queue.length}
                          ref={el => { if (el) el.indeterminate = selezionatiCount > 0 && selezionatiCount < queue.length }}
                          onChange={() => setSelezione(selezionatiCount === queue.length ? new Set() : new Set(queue.map(q => chiaveFile(q.file))))}
                          style={{ cursor: 'pointer', margin: 0 }}
                        />
                      </th>
                      <th style={{ width: 44 }}>Stato</th>
                      <th>Documento</th>
                      <th className="num" style={{ width: 58 }}>Pagine</th>
                      <th style={{ width: 210 }}>Esito</th>
                      <th style={{ width: 200 }}>Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.map((item, i) => {
                      const kind = detectKind(item.file)
                      const allegato = kind === 'excel'
                      const meta = metaFile[chiaveFile(item.file)]
                      const inCorso = loading && activeIdx === i
                      const fatto = !!item.result
                      const excelClaude = !fatto && !!item.excelDaClaude   // Excel creato da Claude, scaricato dalla sua finestra
                      const errore = batchLog.find(e => !e.ok && e.nome === item.file.name)
                      const fmtVoce = item.formato ?? format
                      const excelVoce = fmtVoce === 'contratti' || fmtVoce === 'contract'
                      // nella riga bastano voci e righe da rivedere; la maschera sta nel pannello
                      const esito = fatto && fmtVoce === 'contratti'
                        ? calcolaEsito(item.result, item)?.filter(d => !d.testo.startsWith('maschera:')).slice(0, 2) ?? null
                        : null
                      const attiva = i === activeIdx
                      // .docx accoppiato a un PDF: è la bozza, non si scansiona da sola
                      const bozzaDi = kind === 'docx' ? pdfDellaBozza(item.file) : null
                      const conf = item.confronto
                      const diffConfronto = conf ? conf.riepilogo.modificate + conf.riepilogo.aggiunte + conf.riepilogo.rimosse : 0
                      return (
                        <tr
                          key={`${chiaveFile(item.file)}#${i}`}
                          className={attiva ? 'attiva' : undefined}
                          onClick={() => selectFile(i)}
                          onMouseEnter={e => mostraAnteprima(i, e.currentTarget)}
                          onMouseLeave={nascondiAnteprima}
                          onMouseDown={nascondiAnteprima}
                          aria-selected={attiva}
                        >
                          {/* spunta: il click non deve anche selezionare la riga */}
                          <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              aria-label={`Seleziona ${item.file.name}`}
                              checked={selezione.has(chiaveFile(item.file))}
                              onChange={() => toggleSelezione(item.file)}
                              style={{ cursor: 'pointer', margin: 0 }}
                            />
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {inCorso || item.faseServer ? (
                              <span className="spinner-sm" style={{ width: 16, height: 16, margin: 0, color: C.accent }} aria-label="in corso" />
                            ) : fatto || excelClaude ? (
                              <span title={excelClaude ? 'Excel creato da Claude' : 'Elaborato'} style={{ display: 'inline-flex', width: 20, height: 20, borderRadius: '50%', background: C.green, color: '#fff', alignItems: 'center', justifyContent: 'center' }}><IconCheck size={12} /></span>
                            ) : errore ? (
                              <span title="Non elaborato" style={{ color: C.red, display: 'inline-flex' }}><IconAlert size={16} /></span>
                            ) : bozzaDi ? (
                              <span title="Bozza Word" style={{ color: C.muted, display: 'inline-flex' }}><IconDoc size={16} /></span>
                            ) : (
                              <span title={allegato ? 'Allegato' : 'In attesa'} style={{ display: 'inline-block', width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${allegato ? C.border : '#9aa7b4'}` }} />
                            )}
                          </td>
                          <td><NomeFile nome={item.file.name} style={{ fontWeight: 600 }} /></td>
                          <td className="num" style={{ color: C.muted }}>{meta ? (meta.pagine ?? '—') : allegato ? '—' : '…'}</td>
                          <td>
                            {inCorso ? (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <div
                                  role="progressbar"
                                  aria-valuemin={0}
                                  aria-valuemax={progress.total || 1}
                                  aria-valuenow={progress.current}
                                  aria-label="Avanzamento scansione"
                                  style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}
                                >
                                  <div style={{ width: `${percentuale}%`, height: '100%', background: `linear-gradient(90deg, ${C.accent}, ${C.blue})`, transition: 'width 0.3s ease-out' }} />
                                </div>
                                <span style={{ fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
                                  {progress.total > 0 ? `${progress.current}/${progress.total} pagine · ${etichettaTempoRimasto}` : 'elaborazione…'}
                                </span>
                              </div>
                            ) : item.faseServer ? (
                              <span className="chip" title="Lavoro in corso sul server, ripreso dopo la riapertura: la riga si aggiorna da sola" style={{ background: `${C.accent}14`, color: C.accent }}>
                                sul server: {item.faseServer}
                              </span>
                            ) : errore ? (
                              <span className="chip" title={errore.msg} style={{ background: `${C.red}14`, color: C.red, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block' }}>
                                {errore.msg ?? 'errore'}
                              </span>
                            ) : excelClaude ? (
                              <span className="chip" title="Import_Contratti.xlsx creato da Claude e scaricato dalla sua finestra" style={{ background: `${C.green}14`, color: C.green }}>Excel da Claude</span>
                            ) : esito ? (
                              <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap' }}>
                                {conf && (
                                  <span
                                    className="chip"
                                    title={conf.confrontabile ? 'Confronto con la bozza Word: le differenze sono nella scheda «Confronto»' : 'Bozza Word troppo diversa dal PDF: usato il PDF così com’è'}
                                    style={{ background: `${!conf.confrontabile ? C.muted : diffConfronto ? C.yellow : C.green}14`, color: !conf.confrontabile ? C.muted : diffConfronto ? C.yellow : C.green }}
                                  >
                                    {!conf.confrontabile ? 'Word non confrontabile' : diffConfronto ? `PDF ≠ Word: ${diffConfronto}` : 'PDF = Word'}
                                  </span>
                                )}
                                {esito.map(d => (
                                  <span key={d.testo} className="chip" title={d.aiuto} style={{ background: `${d.colore}14`, color: d.colore }}>{d.testo}</span>
                                ))}
                              </span>
                            ) : fatto && fmtVoce === 'contract' ? (
                              /* formato CONTRATTO, anche per ripiego: Excel con la sola testata */
                              <span className="chip" title="Solo la testata del contratto, una riga: nessun elenco prezzi" style={{ background: `${C.yellow}14`, color: C.yellow }}>solo testata</span>
                            ) : fatto ? (
                              <span className="chip" style={{ background: `${C.accent}14`, color: C.accent }}>testo pronto</span>
                            ) : allegato ? (
                              <span style={{ fontSize: 12, color: C.muted }}>Allegato Excel: va col contratto con lo stesso nome</span>
                            ) : bozzaDi ? (
                              <span style={{ fontSize: 12, color: C.muted }}>Bozza Word: si confronta col PDF prima dell’estrazione, vale il PDF</span>
                            ) : (
                              <span style={{ fontSize: 12, color: C.muted, whiteSpace: 'nowrap', display: 'inline-flex', gap: 4, alignItems: 'baseline', minWidth: 0 }}>
                                In attesa
                                {kind === 'pdf' && bozzaWordPer(item.file) && (
                                  <span title="Bozza Word abbinata: si confronta prima dell’estrazione, vale il PDF. Per cambiarla: menu ⋮ → Bozza Word" style={{ display: 'inline-flex', gap: 3, minWidth: 0 }}>· bozza <NomeFile nome={bozzaWordPer(item.file)!.name} style={{ maxWidth: 120, color: C.text }} /></span>
                                )}
                              </span>
                            )}
                          </td>
                          {/* i bottoni non devono anche selezionare la riga */}
                          <td onClick={e => e.stopPropagation()}>
                            <span style={{ display: 'inline-flex', gap: 6 }}>
                              {inCorso ? (
                                <button onClick={handleCancel} style={{ ...bottone('secondario', C.red), width: 'auto', padding: '5px 10px' }}>Annulla</button>
                              ) : item.faseServer && item.lavoroId ? (
                                <button onClick={() => annullaLavoroServer(chiaveFile(item.file), item.lavoroId!)} style={{ ...bottone('secondario', C.red), width: 'auto', padding: '5px 10px' }}>Annulla</button>
                              ) : (
                                <>
                                  {fatto && (
                                    <button
                                      onClick={() => esportaRiga(i)}
                                      disabled={loading}
                                      title={excelVoce ? 'Salva Import_Contratti.xlsx di questo documento' : 'Scarica il testo estratto'}
                                      style={{ ...bottone('secondario', C.green, !loading), width: 'auto', padding: '5px 10px' }}
                                    >
                                      ↓ {excelVoce ? 'Excel' : `.${fmtVoce}`}
                                    </button>
                                  )}
                                  {!allegato && !bozzaDi && !fatto && !(excelClaude && pagina === 'claude') && (
                                    <button
                                      onClick={() => pagina === 'claude' ? apriClaude(i) : handleElaboraUno(i)}
                                      disabled={loading}
                                      title={pagina === 'claude'
                                        ? 'Apre claude.ai col prompt pronto per questo documento'
                                        : formatoContratto ? 'Scansiona questo documento e salva subito il suo Excel' : 'Scansiona questo documento'}
                                      style={{ ...bottone('primario', C.accent, !loading), width: 'auto', padding: '5px 12px', fontSize: 11.5 }}
                                    >
                                      {pagina === 'claude' ? 'Apri Claude' : 'Scansiona'}
                                    </button>
                                  )}
                                  {fatto && !attiva && (
                                    <button onClick={() => selectFile(i)} disabled={loading} style={{ ...bottone('secondario', C.accent, !loading), width: 'auto', padding: '5px 10px' }}>
                                      Rivedi
                                    </button>
                                  )}
                                  {excelClaude && pagina === 'claude' && (
                                    <button onClick={() => rifaiConClaude(i)} disabled={loading} title="Riapre claude.ai col prompt per rifare l’Excel di questo documento" style={{ ...bottone('secondario', C.accent, !loading), width: 'auto', padding: '5px 10px' }}>
                                      Rifai
                                    </button>
                                  )}
                                </>
                              )}
                              {/* ⋮ sempre presente, anche durante la scansione: aprire il
                                  file in un'altra finestra non disturba nulla */}
                              <button
                                type="button"
                                className="menu-riga-trigger"
                                onClick={e => {
                                  const r = e.currentTarget.getBoundingClientRect()
                                  nascondiAnteprima()
                                  setMenuRiga(m => (m?.idx === i ? null : { idx: i, top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }))
                                }}
                                onMouseEnter={e => {
                                  // al passaggio del mouse il menu si apre da solo (si chiude con clic fuori o Esc)
                                  const r = e.currentTarget.getBoundingClientRect()
                                  nascondiAnteprima()
                                  setMenuRiga(m => (m?.idx === i ? m : { idx: i, top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) }))
                                }}
                                title="Altre azioni sul file"
                                aria-label={`Altre azioni su ${item.file.name}`}
                                aria-haspopup="menu"
                                aria-expanded={menuRiga?.idx === i}
                                style={{ ...bottone('silenzioso', C.muted), width: 'auto', padding: '4px 5px', display: 'inline-flex', alignItems: 'center', background: menuRiga?.idx === i ? C.header : 'transparent' }}
                              >
                                <IconDots size={16} />
                              </button>
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>

                <div
                  className="dropzone"
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (!loading && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); inputRef.current?.click() } }}
                  onClick={() => { if (!loading) inputRef.current?.click() }}
                  style={{ padding: 14, border: `2px dashed ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 12.5, background: C.header, cursor: loading ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, userSelect: 'none' }}
                >
                  <IconUpload size={15} /> Trascina qui altri documenti, o clicca per sfogliare
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Pannello del risultato: il file selezionato ── */}
        {activeIdx >= 0 && file && (
          <div style={{ width: pannelloLargo ? '100%' : 560, flexShrink: 0, background: C.panel, borderLeft: pannelloLargo ? 'none' : `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
            <div style={{ height: 40, padding: '0 10px 0 14px', background: C.header, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              {pannelloLargo && (
                <button onClick={() => setPannelloLargo(false)} title="Torna alla coda" style={{ ...bottone('silenzioso', C.accent), width: 'auto', padding: '3px 8px' }}>
                  ‹ Coda
                </button>
              )}
              <span style={{ fontSize: 10, fontWeight: 700, color: C.green, letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 }}>Risultato</span>
              <NomeFile nome={file.name} style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: C.text }} />
              {result && (
                <span style={{ fontSize: 10, color: C.muted, letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>
                  {pageScanned > 1 ? `[${pageScanned} PAG] ` : ''}[{wordCount.toLocaleString()} TOKEN]
                </span>
              )}
              <button
                onClick={() => setPannelloLargo(l => !l)}
                title={pannelloLargo ? 'Riduci il pannello e mostra la coda' : 'Allarga il pannello a tutta larghezza'}
                aria-label={pannelloLargo ? 'Riduci il pannello' : 'Allarga il pannello'}
                style={{ border: `1px solid ${C.border}`, background: C.panel, color: C.accent, borderRadius: 4, width: 26, height: 26, cursor: 'pointer', fontSize: 14, lineHeight: 1, fontFamily: 'inherit' }}
              >
                {pannelloLargo ? '⤡' : '⤢'}
              </button>
            </div>

            {/* Schede. In modifica restano solo Salva / Chiudi: cambiare scheda con
                modifiche in sospeso le butterebbe via senza dirlo. «Originale» in
                modifica non sostituisce la tabella, la affianca. */}
            <div className="schede" role="tablist">
              <button
                role="tab"
                aria-selected={schedaAttiva === 'doc'}
                disabled={editMode || format === 'json'}
                onClick={() => { setSchedaOriginale(false); setSchedaConfronto(false); setViewDoc(true); setShowRaw(false) }}
              >
                Documento
              </button>
              <button
                role="tab"
                aria-selected={schedaAttiva === 'raw'}
                disabled={editMode}
                onClick={() => { setSchedaOriginale(false); setSchedaConfronto(false); setViewDoc(false); setShowRaw(true) }}
              >
                {format === 'md' ? 'Testo' : 'JSON'}
              </button>
              {format === 'contratti' && (
                <button
                  role="tab"
                  aria-selected={editMode}
                  disabled={!result || loading || editMode}
                  onClick={() => { setSchedaConfronto(false); startEdit() }}
                  title="Correggi testata e righe prima dell'export"
                >
                  Modifica
                </button>
              )}
              <button
                role="tab"
                aria-selected={schedaOriginale}
                onClick={() => setSchedaOriginale(o => !o)}
                title={editMode ? 'Mostra o nascondi il documento originale accanto alla tabella' : 'Il documento com’è arrivato'}
              >
                Originale
              </button>
              {voceAttiva?.confronto && (
                <button
                  role="tab"
                  aria-selected={schedaAttiva === 'confronto'}
                  disabled={editMode}
                  onClick={() => { setSchedaOriginale(false); setSchedaConfronto(true) }}
                  title="Differenze fra la bozza Word e il PDF firmato"
                >
                  Confronto
                </button>
              )}
              {editMode && (
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={saveEdit} style={{ padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.green}80`, background: `${C.green}15`, color: C.green, cursor: 'pointer', fontSize: 10, letterSpacing: '0.06em', fontFamily: 'inherit', fontWeight: 700 }}>
                    ✓ SALVA
                  </button>
                  {/* "Chiudi senza salvare" e non "Annulla": nella tabella c'è il pulsante
                      che annulla l'ULTIMA modifica, e due «Annulla» vicini con effetti
                      diversi (butta tutto / torna indietro di un passo) si confondono. */}
                  <button onClick={cancelEdit} style={{ padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.red}50`, background: 'transparent', color: C.red, cursor: 'pointer', fontSize: 10, letterSpacing: '0.06em', fontFamily: 'inherit', fontWeight: 700 }}>
                    ✕ CHIUDI SENZA SALVARE
                  </button>
                </span>
              )}
            </div>

            {/* ── Esito della scansione: quale maschera ha lavorato, quante voci, cosa
                resta da rivedere. Il backend li produceva già, nessuno li mostrava. ── */}
            {voceAttiva?.confronto && !loading && !editMode && (() => {
              const c = voceAttiva.confronto
              const n = c.riepilogo.modificate + c.riepilogo.aggiunte + c.riepilogo.rimosse
              const colore = !c.confrontabile ? C.muted : n ? C.yellow : C.green
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, padding: '6px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0, background: C.header }}>
                  <span style={{ color: C.muted }}>Bozza Word:</span>
                  <button
                    type="button"
                    onClick={() => { setSchedaOriginale(false); setSchedaConfronto(true) }}
                    title="Apri la scheda «Confronto»"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 999, border: 'none', background: `${colore}14`, color: colore, fontWeight: 600, fontFamily: 'inherit', fontSize: 11.5, cursor: 'pointer' }}
                  >
                    {!c.confrontabile ? 'non confrontabile, usato il PDF' : n ? `${n} differenz${n === 1 ? 'a' : 'e'} — vale il PDF` : 'nessuna differenza col PDF'}
                  </button>
                  {c.riepilogo.rumore > 0 && <span style={{ color: C.muted }}>· {c.riepilogo.rumore} error{c.riepilogo.rumore === 1 ? 'e' : 'i'} OCR corrett{c.riepilogo.rumore === 1 ? 'o' : 'i'} col Word</span>}
                </div>
              )
            })()}
            {format === 'contratti' && esitoScan && !loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11.5, padding: '8px 14px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
                {esitoScan.map(d => (
                  <span
                    key={d.testo}
                    title={d.aiuto}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 999, background: `${d.colore}14`, color: d.colore, fontWeight: 600, whiteSpace: 'nowrap' }}
                  >
                    {d.testo}
                  </span>
                ))}
              </div>
            )}
            {format === 'contratti' && importWarnings.length > 0 && !loading && (
              <div style={{ padding: '6px 14px', background: C.warnBg, borderBottom: `1px solid ${C.warnBorder}`, fontSize: 12, color: C.yellow, maxHeight: 130, overflowY: 'auto', flexShrink: 0 }}>
                <b style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  <IconAlert size={13} /> {importWarnings.length} controlli pre-import
                </b>
                <ul style={{ margin: '4px 0 0', paddingLeft: 4, listStyle: 'none' }}>
                  {importWarnings.map((av, i) => (
                    <li key={i}>
                      {/* Cliccabile solo se punta a una riga: apre la modifica e porta il
                          fuoco sulla cella. Prima l'avviso citava "riga 12" e toccava
                          cercarla a mano in una tabella da centinaia di righe. */}
                      <button
                        type="button"
                        className="avviso-riga"
                        onClick={() => vaiAllAvviso(av)}
                        disabled={av.riga === null && !av.campo}
                        title={av.riga !== null ? 'Apri la riga nella tabella di modifica' : av.campo ? 'Apri il campo di testata' : undefined}
                      >
                        {av.grave ? '⚠' : 'ℹ'} {av.testo}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Contenuto: originale e/o risultato ── */}
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
              {schedaOriginale && (
                <div style={{ flex: editMode ? '0 0 42%' : 1, minWidth: 0, borderRight: editMode ? `1px solid ${C.border}` : 'none', overflow: 'auto', display: 'flex', flexDirection: 'column', alignItems: fileKind === 'pdf' ? 'stretch' : 'center' }}>
                  {/* PDF */}
                  {fileKind === 'pdf' && fileUrl && (
                    // `#page=N`: il visualizzatore PDF del browser apre direttamente quella
                    // pagina. È così che "vai alla pagina d'origine" collega output e anteprima.
                    <iframe
                      src={`${fileUrl}#page=${anteprimaPagina}`}
                      style={{ width: '100%', height: '100%', border: 'none' }}
                      title={`Anteprima PDF — pagina ${anteprimaPagina}`}
                    />
                  )}

                  {/* Image */}
                  {fileKind === 'image' && fileUrl && (
                    <div style={{ padding: 20, width: '100%', textAlign: 'center' }}>
                      <img
                        src={fileUrl}
                        alt="Preview"
                        style={{ maxWidth: '100%', maxHeight: 'calc(100vh - 160px)', objectFit: 'contain', borderRadius: 4 }}
                      />
                    </div>
                  )}

                  {/* Excel */}
                  {fileKind === 'excel' && excelData && (
                    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
                      <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, letterSpacing: '0.08em' }}>
                        {excelData.headers.length} colonne · {excelData.rows.length} righe
                      </div>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ borderCollapse: 'collapse', fontSize: 11, whiteSpace: 'nowrap' }}>
                          <thead>
                            <tr>
                              {excelData.headers.map((h, i) => (
                                <th key={i} style={{ padding: '4px 10px', background: C.header, color: C.accent, border: `1px solid ${C.border}`, fontWeight: 700, letterSpacing: '0.06em', textAlign: 'left' }}>
                                  {h || `Col ${i + 1}`}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {excelData.rows.slice(0, 50).map((row, ri) => (
                              <tr key={ri} style={{ background: ri % 2 === 0 ? 'transparent' : `${C.border}30` }}>
                                {excelData.headers.map((_, ci) => (
                                  <td key={ci} style={{ padding: '3px 10px', border: `1px solid ${C.border}40`, color: C.text, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {String(row[ci] ?? '')}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {excelData.rows.length > 50 && (
                          <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>
                            … e altre {excelData.rows.length - 50} righe
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Word / DOCX */}
                  {fileKind === 'docx' && (
                    <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
                      {docxHtml ? (
                        <div
                          className="docx-preview"
                          dangerouslySetInnerHTML={{ __html: docxHtml }}
                          style={{ color: C.text, lineHeight: 1.7, fontSize: 14 }}
                        />
                      ) : (
                        <div style={{ color: C.muted, textAlign: 'center', marginTop: 60 }}>
                          Caricamento documento Word…
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {(!schedaOriginale || editMode) && (
                <div style={{ flex: 1, overflow: 'auto', padding: 20, minWidth: 0 }}>
                  {inConfronto && voceAttiva?.confronto && !editMode ? (
                    <VistaConfronto confronto={voceAttiva.confronto} bozza={voceAttiva.confronto.bozza} pdf={file.name} />
                  ) : (
                  <>
                  {!result && !loading && pagina === 'claude' && fileKind !== 'excel' && (
                    /* Pagina Claude: qui si incolla la risposta. Il prompt è già nella
                       finestra di Claude; il documento va allegato lì. */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 320 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: C.accent, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Estrazione con Claude</span>
                        <span style={{ fontSize: 11.5, color: C.muted }}>
                          formato {TUTTI_I_FORMATI.find(f => f.id === format)?.etichetta}
                        </span>
                      </div>
                      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: C.text, lineHeight: 1.6, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <li><b>Apri Claude</b>: la finestra si apre col prompt già scritto.</li>
                        <li>In Claude <b>allega il file</b> «<NomeFile nome={file.name} style={{ maxWidth: 260, verticalAlign: 'bottom' }} />» e invia.</li>
                        {format === 'contratti'
                          ? <li>Claude crea <b>«{file.name.replace(/\.[^.]+$/, '')}_Import_Contratti.xlsx»</b>: <b>scaricalo</b> dalla sua finestra, poi premi «Excel scaricato» qui sotto.</li>
                          : <li><b>Copia la risposta</b> di Claude e incollala qui sotto, poi «Elabora».</li>}
                      </ol>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        <button
                          onClick={() => apriClaude(activeIdx)}
                          disabled={loading}
                          title="Apre claude.ai in una nuova finestra col prompt per questo documento"
                          style={{ ...bottone('primario', C.accent, !loading), width: 'auto', padding: '8px 16px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <IconBolt size={14} /> Apri Claude
                        </button>
                        <button
                          onClick={() => copiaPromptClaude(activeIdx)}
                          title="Copia il prompt negli appunti, per incollarlo a mano in Claude"
                          style={{ ...bottone('secondario', promptCopiato ? C.green : C.accent), width: 'auto', padding: '7px 14px' }}
                        >
                          {promptCopiato ? '✓ Prompt copiato' : 'Copia prompt'}
                        </button>
                      </div>
                      {format === 'contratti' ? (
                        /* IMPORT P6: l'Excel lo produce Claude (prompt con colonne, regole ed
                           elenchi ufficiali). Niente JSON da incollare: si segna solo che è fatto. */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 14, border: `1px dashed ${C.border}`, borderRadius: 6, background: C.bg }}>
                          <span style={{ fontSize: 12.5, color: C.text, lineHeight: 1.6 }}>
                            Il prompt chiede a Claude il file Excel già nella maschera <b>Import_Contratti</b> (30 colonne, codici DITTA, PROGETTO, DIVISIONE, COND.PAG, FAM/SFAM dagli elenchi ufficiali). Il file si scarica dalla finestra di Claude, non passa da qui.
                          </span>
                          <div>
                            <button
                              onClick={() => segnaExcelDaClaude(activeIdx)}
                              disabled={loading}
                              title="Segna questo documento come fatto: l’Excel l’ha creato Claude e l’hai scaricato dalla sua finestra"
                              style={{ ...bottone('primario', C.green, !loading), width: 'auto', padding: '9px 18px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                            >
                              <IconCheck size={14} /> Excel scaricato → fatto
                            </button>
                          </div>
                        </div>
                      ) : (
                      <>
                      <textarea
                        value={rispostaClaude}
                        onChange={e => setRispostaClaude(e.target.value)}
                        placeholder={formatoContratto
                          ? 'Incolla qui la risposta di Claude (l’oggetto JSON con testata, importi e righe)…'
                          : 'Incolla qui la trascrizione fatta da Claude…'}
                        aria-label="Risposta di Claude"
                        spellCheck={false}
                        style={{ flex: 1, minHeight: 180, resize: 'vertical', padding: 12, border: `1px solid ${C.border}`, borderRadius: 6, background: C.bg, color: C.text, fontSize: 12.5, lineHeight: 1.5, fontFamily: 'Consolas, "Courier New", monospace' }}
                      />
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                          onClick={() => elaboraDaClaude(activeIdx)}
                          disabled={loading || !rispostaClaude.trim()}
                          title={formatoContratto ? 'Struttura la risposta, aggancia gli elenchi ufficiali e salva l’Import_Contratti.xlsx' : 'Usa la risposta come risultato di questo documento'}
                          style={{ ...bottone('primario', C.green, !loading && !!rispostaClaude.trim()), width: 'auto', padding: '9px 18px', display: 'inline-flex', alignItems: 'center', gap: 6 }}
                        >
                          <IconCheck size={14} /> {formatoContratto ? 'Elabora → Excel' : 'Elabora'}
                        </button>
                        {rispostaClaude && (
                          <span style={{ fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
                            {rispostaClaude.length.toLocaleString()} caratteri
                          </span>
                        )}
                      </div>
                      </>
                      )}
                    </div>
                  )}
                  {!result && !loading && !(pagina === 'claude' && fileKind !== 'excel') && (
                    <div style={{ color: C.muted, textAlign: 'center', marginTop: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                      <span style={{ opacity: 0.45 }}><IconScanText size={40} /></span>
                      <span style={{ fontSize: 13, letterSpacing: '0.02em' }}>L'output OCR apparirà qui</span>
                      <span style={{ fontSize: 11, opacity: 0.8 }}>Premi «Scansiona» sulla riga del documento, o «Elabora» in alto</span>
                    </div>
                  )}
                  {loading && (
                    <div style={{ color: C.accent, textAlign: 'center', marginTop: 80 }} aria-live="polite">
                      <div className="spinner" />
                      <div style={{ marginBottom: 10, fontSize: 19, letterSpacing: '0.04em', fontWeight: 500, fontFamily: FONT_HEAD }}>Elaborazione in corso…</div>
                      <div style={{ color: C.muted, marginBottom: 6, fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{progressLabel}</div>
                      {progress.total > 0 && (
                        <>
                          <div
                            role="progressbar"
                            aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.current}
                            aria-label="Avanzamento scansione"
                            style={{ width: 260, margin: '14px auto 6px', height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}
                          >
                            <div style={{ width: `${percentuale}%`, height: '100%', background: `linear-gradient(90deg, ${C.accent}, ${C.blue})`, borderRadius: 3, transition: 'width 0.3s ease-out' }} />
                          </div>
                          <div style={{ fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
                            {etichettaTempoRimasto}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {result && (format === 'json' || ((format === 'contract' || format === 'contratti') && !viewDoc)) && (
                    <JsonHighlight text={displayResult} />
                  )}
                  {result && format === 'contract' && viewDoc && (
                    <div className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{contractMd}</ReactMarkdown>
                    </div>
                  )}
                  {result && format === 'contratti' && viewDoc && !editMode && (
                    <div className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{alyanteMd}</ReactMarkdown>
                    </div>
                  )}
                  {editMode && editData && format === 'contratti' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                      {/* ── Testata ── */}
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.accent, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>
                          Maschera 1 · Testata contratto
                        </div>
                        {/* Due colonne, non una: sedici campi in colonna singola spingevano la
                            tabella delle righe — il lavoro vero della revisione — sotto la piega,
                            con input da 440px per valori di due caratteri. «Oggetto» resta a tutta
                            larghezza perché è l'unico campo con del testo lungo dentro. */}
                        <div style={{ display: 'grid', gridTemplateColumns: '132px minmax(0, 1fr) 132px minmax(0, 1fr)', gap: '3px 10px' }}>
                          {ALY_TESTATA_COLS.map((col, i) => (
                            <div key={col} style={{ display: 'contents' }}>
                              <label htmlFor={`testata-${ALY_TESTATA_KEYS[i]}`} style={{ color: C.muted, fontSize: 11, alignSelf: 'center', paddingTop: 2 }}>{col}</label>
                              <input
                                id={`testata-${ALY_TESTATA_KEYS[i]}`}
                                className="edit-input"
                                title={col}
                                value={(editData.testata as Record<string,string>)?.[ALY_TESTATA_KEYS[i]] ?? ''}
                                onChange={e => updTestata(ALY_TESTATA_KEYS[i], e.target.value)}
                                style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: '3px 7px', fontSize: 12, fontFamily: 'inherit', borderRadius: 3, ...(ALY_TESTATA_KEYS[i] === 'oggetto' ? { gridColumn: 'span 3' } : {}) }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* ── Righe ── */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: C.accent, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                            Maschera 2 · Righe / Elenco prezzi
                          </span>
                          {/* Contatore + filtro: su un contratto da 200 voci le poche da
                              correggere erano introvabili. */}
                          {problemiEdit.size > 0 ? (
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: C.yellow, fontWeight: 700, cursor: 'pointer', userSelect: 'none' }}>
                              <input
                                type="checkbox"
                                checked={soloDaRivedere}
                                onChange={e => setSoloDaRivedere(e.target.checked)}
                                style={{ accentColor: C.yellow, cursor: 'pointer' }}
                              />
                              <IconAlert size={12} /> {problemiEdit.size} da rivedere — mostra solo queste
                            </label>
                          ) : (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: C.green, fontWeight: 700 }}>
                              <IconCheck size={12} /> nessun controllo fallito
                            </span>
                          )}
                          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8 }}>
                            <button
                              type="button"
                              onClick={annullaModifica}
                              disabled={!storiaEdit.length}
                              title="Torna indietro di una modifica (Ctrl+Z)"
                              style={{ padding: '2px 10px', background: 'transparent', border: `1px solid ${C.border}`, color: storiaEdit.length ? C.text : C.muted, fontSize: 10, borderRadius: 3, fontFamily: 'inherit' }}
                            >
                              ↶ Indietro{storiaEdit.length ? ` (${storiaEdit.length})` : ''}
                            </button>
                            <button
                              type="button"
                              onClick={addRiga}
                              style={{ padding: '2px 10px', background: `${C.accent}18`, border: `1px solid ${C.accent}`, color: C.accent, fontSize: 10, borderRadius: 3, fontFamily: 'inherit' }}
                            >
                              + Aggiungi riga
                            </button>
                          </span>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                          <table style={{ borderCollapse: 'collapse', fontSize: 11, minWidth: '100%' }}>
                            <caption style={{ captionSide: 'top', textAlign: 'left', fontSize: 10, color: C.muted, paddingBottom: 6 }}>
                              Tab e Invio spostano il fuoco alla cella successiva · Ctrl+Z annulla · la riga
                              evidenziata in giallo non ha superato un controllo (dettagli nel titolo della cella)
                              {!!voceAttiva?.incerte?.length && ' · cella gialla = valore letto dall’OCR con poca sicurezza'}
                              {!!voceAttiva?.confronto?.confrontabile && ' · cella azzurra = valore cambiato alla firma rispetto alla bozza Word (vale il PDF)'}
                              {/* la legenda compare solo quando c'è davvero una riga nativa da distinguere */}
                              {(editData.righe as Record<string,string>[]).some(r => r.origine_lettura === 'nativo')
                                && ' · numero di pagina in verde = riga letta dal testo del documento (valori esatti), in blu = letta dall’OCR (da confermare)'}
                            </caption>
                            <thead>
                              <tr>
                                <th style={{ padding: '4px 6px', background: C.header, color: C.accent, border: `1px solid ${C.border}`, fontWeight: 700, fontSize: 10 }} title="Pagina del PDF da cui viene la voce">Pag.</th>
                                {ALY_RIGHE_COLS.map(c => (
                                  <th key={c} scope="col" style={{ padding: '4px 6px', background: C.header, color: C.accent, border: `1px solid ${C.border}`, fontWeight: 700, whiteSpace: 'nowrap', fontSize: 10 }}>
                                    {c}
                                  </th>
                                ))}
                                <th style={{ padding: '4px 6px', background: C.header, border: `1px solid ${C.border}`, color: C.red, fontSize: 10 }}>
                                  <span aria-label="Elimina riga">✕</span>
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {(editData.righe as Record<string,string>[]).map((riga, i) => {
                                const problemi = problemiEdit.get(i)
                                if (soloDaRivedere && !problemi) return null
                                const pag = Number(riga.pagina_origine)
                                // assente sui risultati prodotti prima che si distinguesse la
                                // provenienza: in quel caso resta il blu di sempre
                                const lettura = riga.origine_lettura
                                return (
                                  <tr
                                    key={i}
                                    className={problemi ? 'riga-problema' : undefined}
                                    style={{ background: problemi ? undefined : i % 2 === 0 ? 'transparent' : `${C.border}20` }}
                                  >
                                    {/* Pagina d'origine: clic → l'anteprima a sinistra salta lì */}
                                    <td style={{ border: `1px solid ${C.border}30`, textAlign: 'center', padding: '0 4px' }}>
                                      {pag > 0 ? (
                                        <button
                                          type="button"
                                          onClick={() => vaiAPagina(pag)}
                                          title={`Mostra la pagina ${pag} del documento${lettura === 'nativo' ? ' — letta dal testo del documento: valori esatti' : lettura === 'ocr' ? ' — letta dall’OCR: valori da confermare' : ''}`}
                                          style={{ background: 'transparent', border: 'none', color: lettura === 'nativo' ? C.green : C.blue, fontSize: 10, fontWeight: 700, padding: '2px 4px', textDecoration: 'underline' }}
                                        >
                                          {pag}
                                        </button>
                                      ) : <span style={{ color: C.muted, fontSize: 10 }}>—</span>}
                                    </td>
                                    {ALY_RIGHE_KEYS.map(key => {
                                      const problema = problemi?.find(p => p.campo === key)
                                      const nota = notaCella(voceAttiva, riga, key)
                                      const descr = key === 'descrizione'
                                      const titolo = [
                                        problema ? `${key} — ${problema.testo}` : key,
                                        nota?.tipo === 'firma' ? `cambiato alla firma — nella bozza Word: «${nota.word || '—'}»` : '',
                                      ].filter(Boolean).join('\n')
                                      const comuni = {
                                        id: `cella-${i}-${key}`,
                                        title: titolo,
                                        'aria-invalid': problema ? true : undefined,
                                        'data-nota': nota?.tipo,
                                        value: riga[key] ?? '',
                                        onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => tastieraCella(e, i, key),
                                      }
                                      const sfondo = problema?.grave ? `${C.red}12` : nota?.tipo === 'incerta' ? `${C.yellow}2a` : nota?.tipo === 'firma' ? `${C.blue}18` : undefined
                                      return (
                                        <td key={key} style={{ border: `1px solid ${C.border}30`, padding: 1, background: sfondo }}>
                                          {descr ? (
                                            // testo lungo (fino a 240 caratteri): a riposo è una riga,
                                            // al fuoco si apre e si legge tutta
                                            <textarea
                                              {...comuni}
                                              className="edit-cell edit-cell-descr"
                                              rows={1}
                                              onChange={e => updRiga(i, key, e.target.value)}
                                              onFocus={e => { e.currentTarget.rows = 4 }}
                                              onBlur={e => { e.currentTarget.rows = 1 }}
                                              style={{ background: 'transparent', border: 'none', color: C.text, padding: '3px 5px', fontSize: 11, fontFamily: 'inherit', width: 260, minWidth: 0 }}
                                            />
                                          ) : (
                                            <input
                                              {...comuni}
                                              className="edit-cell"
                                              onChange={e => updRiga(i, key, e.target.value)}
                                              style={{ background: 'transparent', border: 'none', color: C.text, padding: '3px 5px', fontSize: 11, fontFamily: 'inherit', width: key === 'codice_epu' ? 90 : 64, minWidth: 0 }}
                                            />
                                          )}
                                        </td>
                                      )
                                    })}
                                    <td style={{ border: `1px solid ${C.border}30`, textAlign: 'center', padding: '0 4px' }}>
                                      <button
                                        type="button"
                                        onClick={() => removeRiga(i)}
                                        aria-label={`Elimina la riga ${riga.progressivo ?? i + 1}`}
                                        style={{ background: 'transparent', border: 'none', color: C.red, fontSize: 13, padding: '2px 4px' }}
                                      >✕</button>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* ── Importi ── */}
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: C.accent, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8, paddingBottom: 4, borderBottom: `1px solid ${C.border}` }}>
                          Maschera 7 · Importi e ritenute
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '208px minmax(0, 1fr) 208px minmax(0, 1fr)', gap: '3px 10px' }}>
                          {ALY_IMPORTI_COLS.map((col, i) => (
                            <div key={col} style={{ display: 'contents' }}>
                              <div style={{ color: C.muted, fontSize: 11, alignSelf: 'center', paddingTop: 2 }}>{col}</div>
                              <input
                                className="edit-input"
                                title={col}
                                value={(editData.importi as Record<string,string>)?.[ALY_IMPORTI_KEYS[i]] ?? ''}
                                onChange={e => updImporti(ALY_IMPORTI_KEYS[i], e.target.value)}
                                style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text, padding: '3px 7px', fontSize: 12, fontFamily: 'inherit', borderRadius: 3 }}
                              />
                            </div>
                          ))}
                        </div>
                      </div>

                    </div>
                  )}
                  {result && format === 'md' && showRaw && (
                    <pre style={{ color: C.text, fontSize: 13, lineHeight: 1.65, margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'Consolas, "Courier New", monospace' }}>
                      {result}
                    </pre>
                  )}
                  {result && format === 'md' && !showRaw && (
                    <div className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{result}</ReactMarkdown>
                    </div>
                  )}
                  </>
                  )}
                </div>
              )}
            </div>

            {/* ── Piede: l'export del formato scelto in evidenza, il resto ripiegato.
                In modifica sparisce: si esporta ciò che è salvato, non ciò che si sta
                scrivendo, e «Rifai» a metà correzione butterebbe via il lavoro. ── */}
            {!loading && !editMode && (
              <div style={{ borderTop: `1px solid ${C.border}`, background: C.header, padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                {result && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {formatoContratto && (
                      <>
                        <ContrattoFirmatoToggle value={contrattoFirmato} onChange={setContrattoFirmato} />
                        <button onClick={handleDownloadImportContrattiXlsx} style={{ ...btn(true, C.green), padding: '7px 16px' }}>
                          ↓ Import_Contratti .xlsx
                        </button>
                      </>
                    )}
                    {!formatoContratto && (
                      <button
                        onClick={handleCompileExcelFromText}
                        title="Struttura il testo OCR come contratto e compila Import_Contratti.xlsx"
                        style={{ ...btn(true, C.green), padding: '7px 16px' }}
                      >
                        ⤓ Compila Excel
                      </button>
                    )}
                    <details className="gruppo-pieghevole" style={{ marginLeft: 'auto' }}>
                      <summary style={{ borderTop: 'none' }}>Altri export</summary>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 6, justifyContent: 'flex-end' }}>
                        <button onClick={handleCopy} style={{ ...btn(false), border: `1px solid ${C.border}`, color: copied ? C.green : C.text }}>
                          {copied ? 'Copiato!' : 'Copia'}
                        </button>
                        {(format === 'md' || format === 'json') && (
                          <>
                            <button onClick={handleDownload} style={{ ...btn(false), border: `1px solid ${C.border}`, color: C.text }}>↓ .{format}</button>
                            <button onClick={handleDownloadDocx} style={{ ...btn(false), border: `1px solid ${C.border}`, color: C.text }}>↓ .docx</button>
                          </>
                        )}
                        {format === 'contract' && (
                          <>
                            <button onClick={handleDownloadContractDocx} style={{ ...btn(false), border: `1px solid ${C.border}`, color: C.text }}>↓ .docx</button>
                            <button onClick={handleDownloadExcel} style={{ ...btn(false), border: `1px solid ${C.yellow}`, color: C.yellow }}>↓ .xlsx</button>
                            <button onClick={handleDownloadContractCSV} style={{ ...btn(false), border: `1px solid ${C.yellow}`, color: C.yellow }}>↓ .csv</button>
                          </>
                        )}
                        {formatoContratto && (
                          <button onClick={handleDownloadImportContratti} style={{ ...btn(false), border: `1px solid ${C.green}`, color: C.green }}>↓ Import_Contratti .csv</button>
                        )}
                      </div>
                    </details>
                  </div>
                )}

                {/* Tutto ciò che serve di rado sul file selezionato */}
                <details className="gruppo-pieghevole altre-azioni-pannello">
                  <summary style={result ? undefined : { borderTop: 'none' }}>Altre azioni</summary>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 6, alignItems: 'center' }}>
                    {fileKind !== 'excel' && pagina === 'claude' && (
                      /* Rifare con Claude: via il risultato, così torna il riquadro
                         in cui incollare, e si riapre la finestra col prompt. */
                      <button
                        onClick={() => { rifaiConClaude(activeIdx) }}
                        disabled={!canProcess}
                        title="Butta il risultato e riapre claude.ai col prompt per questo documento"
                        style={{ ...bottone('secondario', C.accent, canProcess), width: 'auto' }}
                      >
                        {result ? 'Rifai con Claude' : 'Apri Claude'}
                      </button>
                    )}
                    {fileKind !== 'excel' && pagina === 'ocr' && (
                      <button
                        onClick={() => handleElaboraUno(activeIdx)}
                        disabled={!canProcess}
                        title={formatoContratto ? 'Scansiona da capo e salva subito il suo Excel' : 'Scansiona da capo nel formato scelto'}
                        style={{ ...bottone('secondario', C.accent, canProcess), width: 'auto' }}
                      >
                        {result ? 'Rifai da capo' : formatoContratto ? 'Scansiona → Excel' : 'Scansiona'}
                      </button>
                    )}
                    {fileKind !== 'excel' && pagina === 'ocr' && (
                      <button
                        onClick={() => handleProcess()}
                        disabled={!canProcess}
                        title="Scansiona tutto il documento e mostra l'output, senza generare l'Excel"
                        style={{ ...bottone('secondario', C.accent, canProcess), width: 'auto' }}
                      >
                        {fileKind === 'docx' ? 'Estrai testo' : 'Scan senza Excel'}
                      </button>
                    )}
                    {(fileKind === 'pdf' || fileKind === 'image') && pagina === 'ocr' && (
                      <button
                        onClick={handleProcessAI}
                        disabled={!canProcess || !health?.vision}
                        title={health?.vision
                          ? `Scansiona con il modello AI/vision (${health.visionModel ?? 'Ollama'}), saltando l'OCR classico — utile su scansioni che PaddleOCR non legge`
                          : 'Nessun modello AI/vision installato in Ollama (es. "ollama pull qwen2.5vl")'}
                        style={{ ...bottone('secondario', C.blue, canProcess && !!health?.vision), width: 'auto' }}
                      >
                        Scansiona con AI
                      </button>
                    )}
                    {fileKind === 'pdf' && (
                      <button
                        onClick={handleDirectToDocx}
                        disabled={!canProcess}
                        title="Converte il PDF in un documento Word, senza passare per l'estrazione contratto"
                        style={{ ...bottone('secondario', C.accent, canProcess), width: 'auto' }}
                      >
                        PDF → Word
                      </button>
                    )}
                    {result && (
                      <button
                        onClick={handleReprocess}
                        title="Invia il testo OCR al backend con il formato selezionato — converte in IMPORT P6 senza riscansionare"
                        style={{ ...bottone('secondario', C.accent), width: 'auto' }}
                      >
                        ↺ Riprocessa in {TUTTI_I_FORMATI.find(f => f.id === format)?.etichetta}
                      </button>
                    )}
                    {format === 'contract' && (
                      <button onClick={handleDownloadTemplate} style={{ ...bottone('silenzioso', C.accent), width: 'auto' }}>
                        ↓ template .xlsx
                      </button>
                    )}
                    {fileKind === 'excel' && excelData && (
                      <button onClick={handlePopulateTemplate} style={{ ...bottone('secondario', C.accent), width: 'auto' }}>
                        Popola template ({excelData.rows.length} r.)
                      </button>
                    )}

                    {/* Pagina singola e intervallo: per rilavorare un punto preciso */}
                    {fileKind === 'pdf' && pdfPageCount > 0 && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', paddingLeft: 10, borderLeft: `1px solid ${C.border}` }}>
                        <span style={{ fontSize: 11, color: C.muted, marginRight: 2 }}>Solo pagine:</span>
                        <button
                          onClick={() => setScanPage(p => Math.max(1, p - 1))}
                          disabled={scanPage <= 1}
                          aria-label="Pagina precedente"
                          style={{ padding: '2px 7px', borderRadius: 4, border: 'none', background: 'transparent', color: scanPage <= 1 ? C.muted : C.text, fontSize: 14, fontWeight: 700 }}
                        >‹</button>
                        <span style={{ fontSize: 11, color: C.muted, minWidth: 56, textAlign: 'center' }}>pag. {scanPage}/{pdfPageCount}</span>
                        <button
                          onClick={() => setScanPage(p => Math.min(pdfPageCount, p + 1))}
                          disabled={scanPage >= pdfPageCount}
                          aria-label="Pagina successiva"
                          style={{ padding: '2px 7px', borderRadius: 4, border: 'none', background: 'transparent', color: scanPage >= pdfPageCount ? C.muted : C.text, fontSize: 14, fontWeight: 700 }}
                        >›</button>
                        <button onClick={() => handleScanOnePage(false)} style={{ ...bottone('secondario', C.accent), width: 'auto' }}>Scan pagina</button>
                        <button
                          onClick={() => handleScanOnePage(true)}
                          disabled={scanPage >= pdfPageCount}
                          style={{ ...bottone('silenzioso', C.accent, scanPage < pdfPageCount), width: 'auto' }}
                        >
                          Scan e avanza →
                        </button>
                        <label htmlFor="range-da" style={{ fontSize: 10, color: C.muted, marginLeft: 6 }}>da</label>
                        <input
                          id="range-da"
                          className="range-input"
                          type="number" min={1} max={pdfPageCount} value={scanFrom}
                          onChange={e => setScanFrom(Math.max(1, Math.min(pdfPageCount, +e.target.value || 1)))}
                        />
                        <label htmlFor="range-a" style={{ fontSize: 10, color: C.muted }}>a</label>
                        <input
                          id="range-a"
                          className="range-input"
                          type="number" min={1} max={pdfPageCount} value={scanTo}
                          onChange={e => setScanTo(Math.max(1, Math.min(pdfPageCount, +e.target.value || 1)))}
                        />
                        <button
                          onClick={handleScanRange}
                          disabled={scanFrom > scanTo}
                          style={{ ...bottone('secondario', C.accent, scanFrom <= scanTo), width: 'auto' }}
                        >
                          Scan intervallo
                        </button>
                      </span>
                    )}
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

        {/* ── Barra di destra: caricamento, impostazioni di estrazione, elabora ──
            Le impostazioni valgono per tutta la coda (o per i file spuntati). Sparisce
            col pannello a tutta larghezza, che serve alla tabella di modifica. */}
        {!pannelloLargo && (
          <aside aria-label="Impostazioni di estrazione" style={{ width: 500, flexShrink: 0, background: C.panel, borderLeft: `1px solid ${C.border}`, display: 'flex', flexDirection: 'column', gap: 24, padding: '20px 20px 22px', overflow: 'auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ ...etichettaSezione, fontSize: 12 }}>Documenti</span>
              <button
                onClick={() => inputRef.current?.click()}
                disabled={loading}
                title="Aggiungi PDF, immagini o Word alla coda (oppure trascinali sulla tabella)"
                style={{ ...bottone('secondario', C.accent, !loading), height: 50, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 14.5 }}
              >
                <IconUpload size={18} /> Aggiungi documenti
              </button>
              {queue.length > 0 && (
                <span style={{ fontSize: 13, color: C.muted, lineHeight: 1.45 }}>
                  {selezionatiCount
                    ? <>{selezionatiCount} selezionat{selezionatiCount === 1 ? 'o' : 'i'} su {queue.length} · <button type="button" onClick={() => setSelezione(new Set())} style={{ border: 'none', background: 'none', color: C.accent, cursor: 'pointer', font: 'inherit', fontWeight: 600, padding: 0 }}>deseleziona</button></>
                    : <>{riepilogoCoda}<br /><span style={{ fontSize: 12.5 }}>Spunta i file per lavorare solo su quelli</span></>}
                </span>
              )}
            </div>

            {/* Formato di uscita: una MODALITÀ, non un'azione. Vale per tutta la coda. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span id="lbl-formato" style={{ ...etichettaSezione, fontSize: 12 }}>Formato di uscita</span>
              <div className="segmented grande" role="group" aria-labelledby="lbl-formato">
                {TUTTI_I_FORMATI.map(f => (
                  <button key={f.id} onClick={() => setFormat(f.id)} aria-pressed={format === f.id} title={f.aiuto} disabled={loading}>
                    {f.etichetta}
                  </button>
                ))}
              </div>
              <span style={{ fontSize: 13, color: C.muted, lineHeight: 1.4 }}>
                {TUTTI_I_FORMATI.find(f => f.id === format)?.aiuto}
              </span>
            </div>

            {/* Cartella di destinazione di tutti gli export: si sceglie qui, non a ogni
                avvio, e si cambia quando si vuole. Null = Download. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ ...etichettaSezione, fontSize: 12 }}>Salva i file in</span>
              <button
                onClick={handleScegliCartella}
                disabled={loading || !supportaCartella()}
                title={supportaCartella()
                  ? 'Cartella in cui salvare i file esportati (Excel, CSV, Word, Markdown, JSON)'
                  : 'Questo browser non supporta la scelta della cartella: i file finiscono nei Download'}
                style={{ display: 'flex', alignItems: 'center', gap: 8, height: 48, padding: '0 14px', border: `1px solid ${C.border}`, borderRadius: 6, background: C.header, color: C.text, fontSize: 14, fontFamily: 'inherit', cursor: supportaCartella() && !loading ? 'pointer' : 'not-allowed', minWidth: 0 }}
              >
                <span style={{ color: C.accent, display: 'inline-flex', flexShrink: 0 }}><IconFolder size={18} /></span>
                <span style={{ fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{outDir ? outDir.name : 'Download'}</span>
                {supportaCartella() && <span style={{ color: C.accent, fontWeight: 600, fontSize: 13, flexShrink: 0 }}>Cambia</span>}
              </button>
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {loading ? (
                <>
                  <span style={{ fontSize: 14, color: C.muted, fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
                    {etichettaAvanzamento} · {etichettaTempoRimasto}
                  </span>
                  <button onClick={handleCancel} style={{ ...bottone('secondario', C.red), height: 56, fontSize: 15 }}>
                    ✕ Annulla
                  </button>
                </>
              ) : pagina === 'claude' ? (
                /* Con Claude si va un documento per volta: il bottone apre la finestra
                   per il prossimo da fare, la risposta si incolla nel pannello a destra. */
                <button
                  onClick={() => { const i = prossimoDaFare(); if (queue[i]?.result) rifaiConClaude(i); else apriClaude(i) }}
                  disabled={pendingCount === 0}
                  title={pendingCount === 0
                    ? 'Nessun documento da fare'
                    : daRifareCount
                      ? `Rifà con Claude i documenti già fatti con l’OCR: apre claude.ai col prompt del prossimo${format === 'contratti' ? ', Claude crea l’Excel' : ', poi incolla qui la risposta'}`
                      : `Apre claude.ai col prompt già scritto per il prossimo documento da fare: allega lì il file${format === 'contratti' ? ', Claude crea l’Excel da scaricare' : ', poi incolla qui la risposta'}`}
                  style={{ ...bottone('primario', C.green, pendingCount > 0), height: 56, fontSize: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}
                >
                  <IconBolt size={20} /> {pendingCount === 0 ? (docCount ? 'Tutto elaborato' : 'Apri Claude') : `Apri Claude · ${pendingCount === 1 ? '1 documento' : `${pendingCount} ${daRifareCount ? 'da rifare' : 'da fare'}`}`}
                </button>
              ) : (
                <button
                  onClick={() => handleElaboraTutti()}
                  disabled={pendingCount === 0}
                  title={daRifareCount
                    ? 'Riscansiona con l’OCR anche i documenti già fatti con Claude'
                    : formatoContratto
                      ? 'Scansiona uno dopo l’altro i documenti non ancora fatti e salva un Import_Contratti.xlsx per ciascuno'
                      : 'Scansiona uno dopo l’altro i documenti non ancora fatti'}
                  style={{ ...bottone('primario', C.green, pendingCount > 0), height: 56, fontSize: 16, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, whiteSpace: 'normal', lineHeight: 1.2 }}
                >
                  <IconBolt size={20} /> {etichettaElaboraTutti}
                </button>
              )}
              {!loading && esportabiliCount > 0 && (
                <button
                  onClick={() => void esportaSelezionati()}
                  title={formatoContratto ? 'Salva l’Excel di ogni documento pronto (solo quelli spuntati, se ce ne sono)' : 'Scarica il testo estratto di ogni documento pronto (solo quelli spuntati, se ce ne sono)'}
                  style={{ ...bottone('secondario', C.green), height: 48, fontSize: 14.5 }}
                >
                  ↓ Esporta {esportabiliCount === 1 ? '1 pronto' : `${esportabiliCount} pronti`}{selezionatiCount ? ' (selezionati)' : ''}
                </button>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Anteprima al passaggio del mouse sulla coda ──
          Riquadro fisso, fuori dal flusso della tabella: si posiziona con le coordinate
          calcolate in mostraAnteprima e non intercetta il mouse. */}
      {/* ── Menu ⋮ della riga ── */}
      {menuRiga && queue[menuRiga.idx] && (() => {
        const idx = menuRiga.idx
        const f = queue[idx].file
        const chiudi = () => setMenuRiga(null)
        return (
          <div className="menu-riga" role="menu" aria-label={`Azioni su ${f.name}`} style={{ top: menuRiga.top, right: menuRiga.right }}>
            {menuRiga.livello !== 'abbina' && (
              <>
                <button type="button" role="menuitemcheckbox" aria-checked={selezione.has(chiaveFile(f))} autoFocus onClick={() => toggleSelezione(f)} title="Spunta il file: «Elabora» ed «Esporta» agiscono solo sui file spuntati">
                  <span style={{ width: 14, color: C.accent }}>{selezione.has(chiaveFile(f)) ? '☑' : '☐'}</span> {selezione.has(chiaveFile(f)) ? 'Deseleziona' : 'Seleziona'}
                </button>
                {idx !== activeIdx && (
                  <button type="button" role="menuitem" disabled={loading} onClick={() => { chiudi(); selectFile(idx) }} title="Mostra il file (e il suo risultato) nel pannello">
                    <IconDoc size={14} /> Mostra nel pannello
                  </button>
                )}
                <button type="button" role="menuitem" onClick={() => { chiudi(); void apriInFinestra(f) }} title={detectKind(f) === 'excel' ? 'Il browser non mostra i fogli Excel: il file viene scaricato' : detectKind(f) === 'pdf' ? 'Apre il PDF in una nuova scheda del browser, per consultarlo' : 'Apre il file com’è in una nuova scheda del browser'}>
                  <IconExternal size={14} /> {detectKind(f) === 'pdf' ? 'Apri PDF nel browser' : 'Apri in un’altra finestra'}
                </button>
              </>
            )}
            {(() => {
              // Abbinamento a mano bozza Word ↔ PDF: su un PDF si sceglie il Word, su un
              // Word il PDF. Vince su nome e contenuto; «Nessuna bozza» stacca la coppia.
              const k = detectKind(f)
              if (k !== 'pdf' && k !== 'docx') return null
              const candidati = queue.map(v => v.file).filter(x => detectKind(x) === (k === 'pdf' ? 'docx' : 'pdf'))
              if (!candidati.length) return null
              const attuale = k === 'pdf' ? bozzaWordPer(f) : pdfDellaBozza(f)
              if (menuRiga.livello !== 'abbina') {
                return (
                  <button type="button" role="menuitem" aria-haspopup="menu" onClick={() => setMenuRiga({ ...menuRiga, livello: 'abbina' })} title={k === 'pdf' ? 'Scegli quale Word in coda è la bozza di questo PDF' : 'Scegli di quale PDF in coda questo Word è la bozza'}>
                    <IconDoc size={14} /> {k === 'pdf' ? 'Bozza Word' : 'PDF firmato'}: {attuale ? <NomeFile nome={attuale.name} style={{ maxWidth: 150, fontWeight: 600 }} /> : <span style={{ color: C.muted }}>nessun{k === 'pdf' ? 'a' : 'o'}</span>} ›
                  </button>
                )
              }
              // il collegamento si registra sempre sul PDF (chiave PDF → chiave Word)
              const collega = (pdf: File, word: File | null) => setAbbinamenti(a => {
                const out = { ...a }
                for (const [kp, kw] of Object.entries(out)) if (word && kw === chiaveFile(word) && kp !== chiaveFile(pdf)) delete out[kp]
                out[chiaveFile(pdf)] = word ? chiaveFile(word) : ''
                return out
              })
              return (
                <>
                  <button type="button" role="menuitem" onClick={() => setMenuRiga({ ...menuRiga, livello: undefined })} style={{ color: C.muted }}>‹ Indietro</button>
                  <div style={{ padding: '4px 10px 2px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted }}>
                    {k === 'pdf' ? 'La bozza Word di questo PDF' : 'Il PDF firmato di questa bozza'}
                  </div>
                  {candidati.map(c => (
                    <button key={chiaveFile(c)} type="button" role="menuitemradio" aria-checked={attuale === c} onClick={() => { chiudi(); if (k === 'pdf') collega(f, c); else collega(c, f) }}>
                      <span style={{ width: 14, color: C.accent }}>{attuale === c ? '●' : '○'}</span> <NomeFile nome={c.name} style={{ maxWidth: 220 }} />
                    </button>
                  ))}
                  {k === 'pdf' && (
                    <button type="button" role="menuitemradio" aria-checked={!attuale} onClick={() => { chiudi(); collega(f, null) }}>
                      <span style={{ width: 14, color: C.accent }}>{!attuale ? '●' : '○'}</span> Nessuna bozza: solo il PDF
                    </button>
                  )}
                </>
              )
            })()}
            {menuRiga.livello !== 'abbina' && (
              <button type="button" role="menuitem" className="pericolo" disabled={loading} onClick={() => { chiudi(); removeFile(idx) }} title={loading ? 'Non durante una scansione' : 'Toglie il file dalla coda, col suo risultato'}>
                ✕ Rimuovi dalla coda
              </button>
            )}
          </div>
        )
      })()}

      {hoverAnteprima && queue[hoverAnteprima.idx] && (() => {
        const f = queue[hoverAnteprima.idx].file
        const meta = metaFile[chiaveFile(f)]
        const k = detectKind(f)
        return (
          <div className="anteprima-hover" role="presentation" style={{ top: hoverAnteprima.top, left: hoverAnteprima.left, maxHeight: ALTEZZA_HOVER }}>
            {meta?.miniatura ? (
              <img src={meta.miniatura} alt={`Prima pagina di ${f.name}`} />
            ) : (
              <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: C.muted, fontSize: 12, background: C.bg, borderRadius: 4 }}>
                {meta
                  ? <><IconDoc size={18} /> {k === 'docx' ? 'Documento Word' : k === 'excel' ? 'Foglio Excel' : k === 'text' ? 'File di testo' : 'Nessuna anteprima'}</>
                  : <><span className="spinner-sm" /> Preparo l'anteprima…</>}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11.5, color: C.muted, minWidth: 0 }}>
              <NomeFile nome={f.name} style={{ flex: 1, color: C.text, fontWeight: 600 }} />
              <span style={{ flexShrink: 0 }}>{meta?.pagine ? `${meta.pagine} pag · ` : ''}{(f.size / 1024).toFixed(0)} KB</span>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
