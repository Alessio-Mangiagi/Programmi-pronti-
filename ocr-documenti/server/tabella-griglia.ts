// "><(((º> sabusabu <º)))><"
// Tabella articoli dalle CELLE: blocchi OCR + linee della tabella trovate dal worker.
//
// Perché esiste: l'OCR restituisce righe di testo, non celle. Nelle tabelle con i bordi
// le celle su più righe si mescolano nel testo piatto ("Posa in opera … 1.287,26 / mc
// 80,45 Solo Posa 16,00 €" su tre righe) e le colonne vicine si confondono (P.U. oneri e
// P.U. lavori). Il worker (ocr_worker.py, griglia_tabella) trova con OpenCV le linee
// verticali e orizzontali della tabella; qui ogni blocco va nella cella che contiene il
// suo centro, e la riga della tabella diventa una voce con le colonne giuste.
// È il principio di img2table (docs/RICERCA_OCR_SOLUZIONE.md §5-§6), senza AI.
//
// Ruolo delle colonne dal CONTENUTO, non dall'intestazione (che manca sulle pagine di
// continuazione): codice = prima cella in forma di codice o numero di posizione, unità di
// misura = cella con un'u.m., descrizione = cella col testo più lungo, valori = celle
// numeriche da sinistra a destra (le percentuali "3,368%" escluse). I valori passano per
// valoriRiga (server/tabella-tsv.ts): quantità × prezzo = importo, colonne oneri + lavori
// sommate. Una cella numerica con PIÙ numeri vuol dire più voci nella stessa riga di
// tabella (mancano le linee fra le voci): quella pagina si lascia alla ricostruzione
// geometrica di sempre (tabellaDaTsv), meglio che indovinare.
//
// Uscita: righe "| codice | descrizione | um | qta | prezzo | importo |", lette alla
// lettera da estraiRigheCelle (server/parser-contratti.ts).
import type { BloccoOcr } from './ocr.ts'
import { NUM_SRC, UM_SRC, normalizzaValoriTabella } from './parser-contratti.ts'
import { valoriRiga } from './tabella-tsv.ts'

export interface Griglia { xs: number[]; ys: number[] }

// Intestazione del blocco nel testo: senzaTabellaRicostruita la toglie dal testo che va
// alle maschere, come le altre tabelle ricostruite.
export const TITOLO_CELLE = '### TABELLA ARTICOLI (dalle celle della tabella)'

const RE_NUM = new RegExp(String.raw`^(?:€\s*)?(${NUM_SRC})\s*€?$`)
const RE_UM = new RegExp(String.raw`^(?:${UM_SRC})\.?$`, 'i')
const RE_PCT = /\d\s*%/
// Codice articolo ("B.04.004.a", "SIC24_14.01", "A.N.E.009", "1498B") o numero di
// posizione della tabella ("1", "12"): senza spazi interni, con almeno una cifra.
const RE_COD = /^(?=[^\s]*\d)[A-Za-z0-9][A-Za-z0-9._\-\/]{0,24}$/

const indiceIn = (lim: number[], v: number): number => {
  for (let i = 0; i + 1 < lim.length; i++) if (lim[i] <= v && v < lim[i + 1]) return i
  return -1
}

// Testo di una cella: blocchi in ordine di lettura (righe per Y, poi X).
const testoCella = (bs: BloccoOcr[]): string =>
  [...bs].sort((a, b) => (Math.abs(a.y - b.y) > Math.min(a.h, b.h) * 0.6 ? a.y - b.y : a.x - b.x))
    .map(b => b.text.trim()).filter(Boolean).join(' ').replace(/\s{2,}/g, ' ')

// "1.287,26 €" → "1.287,26"; "€ 16,00" → "16,00"; altro → null. I decimali col punto
// letti dall'OCR ("6.4095564") passano per la stessa normalizzazione del resto del testo.
const numeroCella = (t: string): string | null => {
  const s = normalizzaValoriTabella(t.replace(/\s+(?=€)|(?<=€)\s+/g, '').trim())
  const m = RE_NUM.exec(s)
  return m ? m[1] : null
}

export const tabellaDaGriglia = (blocchi: BloccoOcr[], g: Griglia | null | undefined): string => {
  if (!g || g.xs.length < 3 || g.ys.length < 3) return ''
  const nr = g.ys.length - 1, nc = g.xs.length - 1
  const celle: BloccoOcr[][][] = Array.from({ length: nr }, () => Array.from({ length: nc }, () => []))
  for (const b of blocchi) {
    const r = indiceIn(g.ys, b.y + b.h / 2), c = indiceIn(g.xs, b.x + b.w / 2)
    if (r >= 0 && c >= 0) celle[r][c].push(b)
  }
  type Voce = { codice: string; descr: string; um: string; nums: string[] }
  const voci: Voce[] = []
  for (let r = 0; r < nr; r++) {
    const testi = celle[r].map(testoCella)
    if (testi.every(t => !t)) continue
    // più numeri impilati nella stessa cella numerica = più voci senza linea fra loro
    for (let c = 0; c < nc; c++) {
      const numeriInCella = celle[r][c].filter(b => numeroCella(b.text) !== null && !RE_PCT.test(b.text))
      const righeY = new Set(numeriInCella.map(b => Math.round((b.y + b.h / 2) / Math.max(8, b.h * 0.6))))
      if (righeY.size >= 2 && numeriInCella.length === celle[r][c].length) return ''
    }
    let codice = '', um = '', descr = ''
    const nums: string[] = []
    let iCod = -1
    // codice: la prima cella non vuota, se ha forma di codice; nelle prime due colonne
    // vale anche un numero di posizione ("1", "12": colonna "Pos." dei subappalti)
    const prima = testi.findIndex(t => !!t)
    const formaCodice = prima >= 0 && RE_COD.test(testi[prima]) && numeroCella(testi[prima]) === null
    const posizione = prima >= 0 && prima <= 1 && /^\d{1,3}$/.test(testi[prima])
    if (formaCodice || posizione) { codice = testi[prima]; iCod = prima }
    for (let c = 0; c < nc; c++) {
      if (c === iCod || !testi[c]) continue
      const t = testi[c]
      if (RE_PCT.test(t)) continue                         // incidenza % (colonna degli oneri)
      const n = numeroCella(t)
      if (n !== null) { nums.push(n); continue }
      if (!um && RE_UM.test(t.replace(/[^A-Za-z0-9²³°.]/g, ''))) { um = t.replace(/[^A-Za-z0-9²³°]/g, '').toLowerCase(); continue }
      if (t.length > descr.length) descr = t
    }
    // riga di intestazione o di totale: niente da esportare
    if (/^(?:totale|sommano|importo\s+totale)\b/i.test(descr) && !codice) continue
    if (!nums.length && !codice) {
      // continuazione della descrizione della voce sopra (cella spezzata da una linea)
      const ultima = voci[voci.length - 1]
      if (ultima && descr && !ultima.nums.length) ultima.descr = `${ultima.descr} ${descr}`
      continue
    }
    if (!descr && !codice) continue
    voci.push({ codice, descr, um, nums })
  }
  // servono voci con valori: una tabella di sole intestazioni o clausole non è l'elenco prezzi
  const conValori = voci.filter(v => v.nums.length >= 2)
  if (!conValori.length) return ''
  return voci
    .filter(v => v.nums.length >= 2 || (v.codice && v.um))
    .map(v => {
      // un solo numero (voce "opzionale" senza quantità, listino): è il prezzo unitario
      const [q = '', p = '', i = ''] = v.nums.length === 1 ? ['', v.nums[0], ''] : valoriRiga(v.nums)
      const pulisci = (s: string) => s.replace(/\|/g, '/').trim()
      return `| ${pulisci(v.codice)} | ${pulisci(v.descr)} | ${v.um} | ${q} | ${p} | ${i} |`
    })
    .join('\n')
}
