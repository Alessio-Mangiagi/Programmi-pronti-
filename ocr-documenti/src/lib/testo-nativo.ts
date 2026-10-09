/**
 * PERCORSO NATIVO: struttura vera al posto dei pixel.
 *
 * Un PDF generato al computer e un .docx portano già il testo esatto e — nel caso del
 * Word — le tabelle come tabelle. Rasterizzarli per darli all'OCR butta via entrambe le
 * cose e le rilegge peggio: i codici tariffa vanno poi riparati a mano
 * (`normalizzaCodice`) e le celle ricostruite per geometria (`righeDaBlocchi`,
 * `sogliaCorta`).
 *
 * Qui l'input nativo viene ridotto allo STESSO testo a righe che il server riceve dal
 * percorso OCR, e spedito a /api/ocr nel campo `text` che esiste già. I parser a valle
 * (RE_CODA_VALORI, estraiRigheElencoPrezzi, estraiRigheSommano) restano identici:
 * cambia solo da dove arrivano le righe.
 *
 * Modulo CONDIVISO fra frontend (src/App.tsx) e banco di prova (tools/harness.ts): le
 * euristiche di raggruppamento stanno scritte una volta sola. È la lezione di
 * tools/render_pdf.py, che deve inseguire a mano il rendering del frontend e diverge al
 * primo ritocco. Per questo qui dentro non entrano né DOM né pdf.js: solo dati.
 */

export interface FrammentoTesto {
  str: string
  x: number   // bordo sinistro, in punti
  y: number   // verticale CRESCENTE VERSO IL BASSO (il chiamante ha già ribaltato l'asse)
  w: number
  h: number   // corpo del carattere: fa da scala a tutte le tolleranze
}

// Molti generatori PDF spezzano il testo in frammenti — a volte glifo per glifo, per
// applicare la crenatura. Il salto fra la fine del frammento precedente e l'inizio del
// successivo dice se ci va uno spazio: sotto un quarto di corpo è la stessa parola.
const unisciRiga = (riga: FrammentoTesto[]): string => {
  let out = ''
  let fine = 0
  for (const f of [...riga].sort((a, b) => a.x - b.x)) {
    if (out && f.x - fine > f.h * 0.25) out += ' '
    out += f.str
    fine = f.x + f.w
  }
  return out.replace(/\s+/g, ' ').trim()
}

/**
 * Frammenti posizionati → righe di testo.
 *
 * Il raggruppamento verticale usa una tolleranza legata al CORPO del carattere, non un
 * valore assoluto: le celle di una stessa riga di tabella differiscono di frazioni di
 * punto sulla baseline, un capoverso nuovo di un'interlinea intera. La mediana regge
 * anche quando la pagina mescola titoli e note a piè di pagina.
 */
export const righeDaFrammenti = (frammenti: FrammentoTesto[]): string[] => {
  const buoni = frammenti.filter(f => f.str.trim())
  if (!buoni.length) return []
  const altezze = buoni.map(f => f.h).sort((a, b) => a - b)
  const tol = Math.max(1, (altezze[Math.floor(altezze.length / 2)] || 10) * 0.5)

  const righe: FrammentoTesto[][] = []
  for (const f of [...buoni].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const corrente = righe[righe.length - 1]
    if (corrente && Math.abs(f.y - corrente[0].y) <= tol) corrente.push(f)
    else righe.push([f])
  }
  return righe.map(unisciRiga).filter(Boolean)
}

/**
 * Un "layer di testo" non è per forza nativo: molte scansioni passano per Acrobat e si
 * portano dietro l'OCR di qualcun altro — non migliore del nostro e per giunta senza
 * confidenza per riga. Guardia con la stessa metrica di `testoGarbled` (server.ts:526),
 * più una soglia di densità: sotto quella la pagina è un'immagine con due etichette
 * sopra, e conviene comunque l'OCR.
 */
export const layerUtile = (testo: string): boolean => {
  if (testo.replace(/\s/g, '').length < 120) return false
  const toks = testo.split(/\s+/).filter(Boolean)
  if (toks.length < 60) return true              // pagina corta ma densa: non giudicare
  let corti = 0
  let vere = 0
  for (const w of toks) {
    if (w.length <= 2) corti++
    const s = w.toLowerCase().replace(/[^a-zà-ù]/g, '')
    if (s.length >= 4 && /[aeiouàèéìòù]/.test(s) && !/[bcdfghjklmnpqrstvwxyz]{4,}/.test(s)) vere++
  }
  return !(vere / toks.length < 0.35 && corti / toks.length > 0.42)
}

export interface ItemPdfTesto { str: string; width?: number; height?: number; transform: number[] }

/**
 * Item di `page.getTextContent()` (pdf.js) → testo della pagina, oppure `null` se il
 * layer non è utilizzabile (scansione) e la pagina va mandata all'OCR.
 */
export const testoDaTextContent = (items: ItemPdfTesto[]): string | null => {
  const frammenti: FrammentoTesto[] = []
  for (const it of items) {
    if (typeof it?.str !== 'string' || !it.str.trim()) continue
    const t = it.transform ?? []
    // transform = [a, b, c, d, e, f]: e/f sono x/y della baseline, d il corpo del
    // carattere. L'asse y del PDF cresce verso l'ALTO, quello dei blocchi OCR verso il
    // basso → si ribalta il segno, così "ordine di lettura" vale in entrambi i percorsi.
    frammenti.push({
      str: it.str,
      x: t[4] ?? 0,
      y: -(t[5] ?? 0),
      w: it.width ?? 0,
      h: Math.abs(t[3]) || it.height || 10,
    })
  }
  if (frammenti.length < 5) return null
  const testo = righeDaFrammenti(frammenti).join('\n')
  return layerUtile(testo) ? testo : null
}

// ── Word ────────────────────────────────────────────────────────────────────

interface CellaHtml { testo: string; cs: number; rs: number }

/**
 * Griglia di celle → una riga di testo per riga di tabella.
 *
 * colspan/rowspan vanno espansi: una cella unita compare SOLO nella prima riga che la
 * contiene, e senza espansione ogni riga successiva slitta a sinistra di una colonna —
 * le quantità finirebbero sotto i prezzi.
 */
const righeDaGriglia = (righe: CellaHtml[][]): string[] => {
  const griglia: string[][] = righe.map(() => [])
  righe.forEach((celle, r) => {
    let c = 0
    for (const cella of celle) {
      while (griglia[r][c] !== undefined) c++
      for (let dr = 0; dr < cella.rs && r + dr < righe.length; dr++) {
        for (let dc = 0; dc < cella.cs; dc++) {
          griglia[r + dr][c + dc] = dr === 0 && dc === 0 ? cella.testo : ''
        }
      }
      c += cella.cs
    }
  })
  return griglia.map(r => r.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
}

// Le entità nominate che compaiono davvero nei contratti: mammoth emette UTF-8 diretto
// per le lettere accentate, ma i trattini e le virgolette tipografiche di Word arrivano
// spesso in questa forma. Una sconosciuta resta com'è: meglio "&xyz;" nel testo che un
// carattere inventato in un codice tariffa.
const ENTITA: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  ndash: '–', mdash: '—', hellip: '…', middot: '·', bull: '•',
  laquo: '«', raquo: '»', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  deg: '°', euro: '€', times: '×', sup2: '²', sup3: '³', frac12: '½',
  agrave: 'à', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  Agrave: 'À', Egrave: 'È', Eacute: 'É', Igrave: 'Ì', Ograve: 'Ò', Ugrave: 'Ù',
  oslash: 'ø', Oslash: 'Ø',
}

const decodifica = (s: string): string =>
  s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (tutto, e: string) => {
    // prima il confronto esatto: &Oslash; è "Ø", e nei codici tariffa ("Ø.1000") la
    // differenza di maiuscola non è cosmetica
    if (e[0] !== '#') return ENTITA[e] ?? ENTITA[e.toLowerCase()] ?? tutto
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return Number.isFinite(n) && n > 0 ? String.fromCodePoint(n) : tutto
  })

const TAG_BLOCCO = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'DIV', 'BLOCKQUOTE', 'PRE'])

const attrNum = (grezzo: string, nome: string): number => {
  const m = new RegExp(`${nome}\\s*=\\s*["']?(\\d+)`, 'i').exec(grezzo)
  const n = m ? Number(m[1]) : 1
  return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * HTML di mammoth → righe di testo, TABELLE COMPRESE.
 *
 * `mammoth.extractRawText` — che questo percorso usava — appiattisce le tabelle: ogni
 * cella diventa un paragrafo a sé. La coda "[U.M.] quantità prezzo [importo]" che i
 * parser cercano su UNA riga non si forma mai, e l'elenco prezzi di un .docx esce vuoto.
 *
 * Tokenizzatore minimo invece di DOMParser perché questo modulo gira anche in node
 * (banco di prova), dove il DOM non c'è. È tarato sull'output di mammoth, che è ristretto
 * e prevedibile: p, h1-h6, ul/ol/li, table/tr/td/th, strong/em/a/img/br/sup/sub, con le
 * entità già escapate.
 */
export const docxHtmlATesto = (html: string): string => {
  const out: string[] = []
  let buffer = ''
  let livelloTabella = 0
  let righeTab: CellaHtml[][] = []
  let rigaTab: CellaHtml[] = []
  let cella: CellaHtml | null = null

  const scarica = () => {
    const t = buffer.replace(/\s+/g, ' ').trim()
    if (t) out.push(t)
    buffer = ''
  }
  const aggiungi = (t: string) => {
    if (cella) cella.testo += t
    else buffer += t
  }
  const chiudiRiga = () => {
    if (cella) { rigaTab.push(cella); cella = null }
    if (rigaTab.length) { righeTab.push(rigaTab); rigaTab = [] }
  }

  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^>])*)>/g
  let pos = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    aggiungi(decodifica(html.slice(pos, m.index)))
    pos = re.lastIndex
    if (!m[1]) continue                                  // commento
    const tag = m[1].toUpperCase()
    const chiusura = m[0][1] === '/'

    if (tag === 'BR') { if (cella) aggiungi(' '); else scarica(); continue }

    if (tag === 'TABLE') {
      if (!chiusura) {
        if (livelloTabella === 0) { scarica(); righeTab = []; rigaTab = []; cella = null }
        livelloTabella++
      } else if (livelloTabella > 0) {
        livelloTabella--
        if (livelloTabella === 0) { chiudiRiga(); out.push(...righeDaGriglia(righeTab)); righeTab = [] }
      }
      continue
    }

    if (tag === 'TR' || tag === 'TD' || tag === 'TH') {
      // In una tabella ANNIDATA la struttura non conta: il testo confluisce nella cella
      // esterna. Sdoppiare le righe farebbe leggere due volte le stesse voci ai parser.
      // Serve però lo spazio, o le celle interne si incollano fra loro e alla esterna.
      if (livelloTabella !== 1) { aggiungi(' '); continue }
      // vale sia per <tr> sia per </tr>: un'apertura chiude la riga precedente rimasta
      // aperta (</tr> mancante), una chiusura chiude la propria
      if (tag === 'TR') { chiudiRiga(); continue }
      if (!chiusura) {
        if (cella) rigaTab.push(cella)                   // </td> mancante
        cella = { testo: '', cs: attrNum(m[2], 'colspan'), rs: attrNum(m[2], 'rowspan') }
      } else if (cella) { rigaTab.push(cella); cella = null }
      continue
    }

    // Un <p> dentro una cella non apre una riga nuova — la cella resta una cella — ma
    // separa comunque due capoversi che altrimenti si incollerebbero.
    if (TAG_BLOCCO.has(tag)) { if (cella) aggiungi(' '); else scarica() }
  }
  aggiungi(decodifica(html.slice(pos)))
  if (livelloTabella > 0) { chiudiRiga(); out.push(...righeDaGriglia(righeTab)) }
  scarica()
  return out.join('\n')
}
