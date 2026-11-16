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
// tabella (mancano le linee fra le voci): le voci si dividono allora sui codici della
// colonna tariffa (tabellaDaAncore, in fondo); senza codici la pagina si lascia alla
// ricostruzione geometrica di sempre (tabellaDaTsv), meglio che indovinare.
//
// Uscita: righe "| codice | descrizione | um | qta | prezzo | importo |", lette alla
// lettera da estraiRigheCelle (server/parser-contratti.ts).
import type { BloccoOcr } from './ocr.ts'
import { NUM_SRC, RE_COD_GRIGLIA, UM_SRC, contoTorna, itStr, normalizzaValoriTabella, numIt } from './parser-contratti.ts'
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

// Intestazioni di colonna: quelle dei valori (quantità, prezzi, importi, oneri) e quella
// della descrizione, che conferma di essere sulla riga d'intestazione.
const RE_INTEST_VALORE = /quantit|q\.?\s?t[àa']|\bqty\b|prezz|p\.\s?u\b|unitari|importo|totale|oneri/i
const RE_INTEST_DESCR = /descri|lavorazion|indicazione/i

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
// `ripara`: scansioni sporche lette per ancore (tabellaDaAncore), dove una cella è un
// solo numero e i separatori arrivano storpiati — "11.688 46€" (spazio per la virgola),
// "16.82881€" e "1:18042" (virgola persa, due punti per il punto), "17 82e" (€ letto e).
// Fuori da lì restano spenti: "17.32454" è un prezzo Primus a 5 decimali, non 17.324,54.
const numeroCella = (t: string, ripara = false): string | null => {
  let s = t.replace(/\s+(?=€)|(?<=€)\s+/g, '').trim()
  if (ripara) {
    s = s.replace(/(\d)[eE€]$/, '$1')
      .replace(/(\d):(?=\d)/g, '$1.')
      .replace(/^(\d{1,3}(?:\.\d{3})*) (\d{2})$/, '$1,$2')
      .replace(/^([1-9]\d{0,2})\.(\d{3})(\d{2})$/, '$1.$2,$3')
  }
  const m = RE_NUM.exec(normalizzaValoriTabella(s))
  return m ? m[1] : null
}

// Riga sopra la prima linea orizzontale. Sulla pagina di prosecuzione la tabella riprende
// spesso senza il bordo superiore: nel subappalto 030 (pag. 4) la voce 3 stava fra
// l'intestazione di pagina e la prima linea trovata, fuori da ogni cella, e mancava. Se
// nella fascia alta una riga mediana sopra la prima linea ci sono almeno due valori
// numerici dentro le colonne della tabella, la fascia diventa una riga in più. Righe di
// prosa senza numeri lì sopra ("…riepilogato nella seguente tabella:") non la aprono.
const conRigaSopra = (blocchi: BloccoOcr[], g: Griglia): Griglia => {
  const alt = g.ys.slice(1).map((y, i) => y - g.ys[i]).sort((a, b) => a - b)
  const h = alt[Math.floor(alt.length / 2)]
  const su = g.ys[0] - h, x0 = g.xs[0], x1 = g.xs[g.xs.length - 1]
  const valori = blocchi.filter(b => {
    const cy = b.y + b.h / 2, cx = b.x + b.w / 2
    return cy >= su && cy < g.ys[0] && cx >= x0 && cx < x1 && numeroCella(b.text) !== null && !RE_PCT.test(b.text)
  })
  return su > 0 && valori.length >= 2 ? { xs: g.xs, ys: [su, ...g.ys] } : g
}

// Tabella della pagina: prima cella per cella; se la griglia non dà voci (linee solo
// attorno a un riquadro di totali, o più voci impilate nella stessa riga perché mancano
// le linee fra le voci) o manca del tutto, le voci si dividono sui codici
// (tabellaDaAncore). Nessuna delle due → '' e vale la ricostruzione geometrica.
export const tabellaDaGriglia = (blocchi: BloccoOcr[], griglia: Griglia | null | undefined): string => {
  if (!griglia || griglia.xs.length < 3 || griglia.ys.length < 3) return tabellaDaAncore(blocchi, null)
  const g = conRigaSopra(blocchi, griglia)
  // vince la lettura con più voci: una griglia parziale può dare una voce spuria dalle
  // celle e nascondere le dieci che si leggono sui codici (allegato A, pag. 3 e 7)
  const celle = leggiCelle(blocchi, g), ancore = tabellaDaAncore(blocchi, g)
  const n = (t: string) => (t ? t.split('\n').length : 0)
  return n(ancore) > n(celle) ? ancore : celle
}

const leggiCelle = (blocchi: BloccoOcr[], g: Griglia): string => {
  const nr = g.ys.length - 1, nc = g.xs.length - 1
  const celle: BloccoOcr[][][] = Array.from({ length: nr }, () => Array.from({ length: nc }, () => []))
  for (const b of blocchi) {
    const r = indiceIn(g.ys, b.y + b.h / 2), c = indiceIn(g.xs, b.x + b.w / 2)
    if (r >= 0 && c >= 0) celle[r][c].push(b)
  }
  type Voce = { codice: string; descr: string; um: string; nums: string[] }
  const voci: Voce[] = []
  // Intestazione della tabella, se è su questa pagina: dice quali colonne portano i
  // valori (quantità, prezzi, importi, anche quelle degli oneri). Da lì in giù i numeri
  // si prendono SOLO da quelle colonne: un "N." o un sotto-numero accanto al codice
  // ("A.01.010 | 2") finiva letto come quantità (TMT). Senza intestazione (pagine di
  // continuazione) decide il contenuto, come sotto.
  let colonneValori: Set<number> | null = null
  for (let r = 0; r < nr; r++) {
    const testi = celle[r].map(testoCella)
    if (testi.every(t => !t)) continue
    const valori = testi.map((t, c) => (RE_INTEST_VALORE.test(t) && !numeroCella(t) ? c : -1)).filter(c => c >= 0)
    if (valori.length >= 2 && testi.some(t => RE_INTEST_DESCR.test(t))) { colonneValori = new Set(valori); continue }
    // più numeri impilati nella stessa cella numerica = più voci senza linea fra loro:
    // le celle non bastano (si passa a tabellaDaAncore)
    for (let c = 0; c < nc; c++) {
      const numeriInCella = celle[r][c].filter(b => numeroCella(b.text) !== null && !RE_PCT.test(b.text))
      const righeY = new Set(numeriInCella.map(b => Math.round((b.y + b.h / 2) / Math.max(8, b.h * 0.6))))
      if (righeY.size >= 2 && numeriInCella.length === celle[r][c].length) return ''
    }
    let codice = '', um = '', descr = ''
    const nums: string[] = []
    let iCod = -1
    // codice: la prima cella in forma di codice fra le prime tre colonne (davanti può
    // esserci la WBS, "Lotto4 - VI07", come nei subappalti Ragusana); nelle prime due
    // colonne vale anche un numero di posizione ("1", "12": colonna "Pos.")
    const prima = testi.findIndex(t => !!t)
    const formaCodice = (k: number) => !!testi[k] && RE_COD.test(testi[k]) && numeroCella(testi[k]) === null
    const kCod = [0, 1, 2].find(k => k < nc && formaCodice(k))
    // codice in testa alla cella, seguito dall'etichetta della voce: "BA.CZ.A.3 02.F
    // BAGGIOLI/RITEGNI" (SICS). Codice in due pezzi, con lettera e punto interno; il resto
    // della cella va in testa alla descrizione, come nel modulo di riferimento.
    const inTesta = kCod === undefined && prima >= 0 && prima <= 2 ? RE_COD_GRIGLIA.exec(testi[prima]) : null
    let etichetta = ''
    if (kCod !== undefined) { codice = testi[kCod]; iCod = kCod }
    else if (prima >= 0 && prima <= 1 && /^\d{1,3}$/.test(testi[prima])) { codice = testi[prima]; iCod = prima }
    else if (inTesta && /[A-Za-z]/.test(inTesta[2]) && /[A-Za-z0-9]\.[A-Za-z0-9]/.test(inTesta[2])) {
      codice = inTesta[2].replace(/[.,]+$/, ''); iCod = prima; etichetta = testi[prima].slice(inTesta[0].length).trim()
    }
    for (let c = 0; c < nc; c++) {
      if (c === iCod || !testi[c]) continue
      const t = testi[c]
      if (RE_PCT.test(t)) continue                         // incidenza % (colonna degli oneri)
      const n = numeroCella(t)
      if (n !== null) { if (!colonneValori || colonneValori.has(c)) nums.push(n); continue }
      if (!um && RE_UM.test(t.replace(/[^A-Za-z0-9²³°.]/g, ''))) { um = t.replace(/[^A-Za-z0-9²³°]/g, '').toLowerCase(); continue }
      if (t.length > descr.length) descr = t
    }
    if (etichetta) descr = descr ? `${etichetta} - ${descr}` : etichetta
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
  // Servono voci con valori, e valori da elenco prezzi: almeno un numero con la virgola
  // (prezzi e importi hanno i decimali). Una tabella di soli interi è altro: l'elenco
  // degli automezzi di una fornitura di calcestruzzo ("MB 4140 B | 290 | 2001", portata
  // e anno) usciva come 15 voci e prendeva il posto dell'elenco prezzi vero (Beton).
  const prezzi = (v: Voce) => v.nums.some(n => n.includes(','))
  const conValori = voci.filter(v => v.nums.length >= 2 && prezzi(v))
  if (!conValori.length || conValori.length < voci.filter(v => v.nums.length >= 2).length / 2) return ''
  return voci
    .filter(v => (v.nums.length >= 1 && prezzi(v)) || (v.codice && v.um))
    .map(v => {
      // un solo numero (voce "opzionale" senza quantità, listino): è il prezzo unitario
      const [q = '', p = '', i = ''] = v.nums.length === 1 ? ['', v.nums[0], ''] : valoriRiga(v.nums)
      const pulisci = (s: string) => s.replace(/\|/g, '/').trim()
      return `| ${pulisci(v.codice)} | ${pulisci(v.descr)} | ${v.um} | ${q} | ${p} | ${i} |`
    })
    .join('\n')
}

// ── Tabelle con le sole linee verticali ─────────────────────────────────────
// Elenco prezzi del subappalto Progetto Costruzioni Ragusana (allegato A): le colonne
// hanno le linee, le voci no. Ogni riga della griglia contiene allora più voci e i numeri
// si impilano nella stessa cella. Le voci si dividono sui CODICI della colonna tariffa
// ("B.03.031.c"), uno per voce e scritti a metà altezza della voce come i valori: il
// confine fra due voci sta a metà strada fra i due codici, e quantità, prezzi e importi si
// prendono sulla riga di testo del codice. Su una scansione così sporca i numeri passano
// per la riparazione dei separatori (numeroCella con `ripara`) e la voce tiene i valori
// solo se i conti tornano (valoriLavoriOneri): altrimenti escono codice e unità di
// misura con i valori vuoti, da completare a mano, mai numeri inventati.

// Codice di tariffa con almeno due separatori ("B.03.025.a", "8.04.001", "B.03,031.c",
// "1.01.009"); i numeri ("60.228,72") li esclude numeroCella.
const RE_ANCORA = /^[A-Z0-9]{1,3}[.,]\d{2}[.,]\d{3}(?:[._,][A-Za-z0-9]{1,4})?[.,]?$/

const centroY = (b: BloccoOcr) => b.y + b.h / 2
const mediana = (v: number[]) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]

// Valori di una voce con le colonne lavori + oneri della sicurezza ("Quantità | P.U. |
// Importo | P.U. O.S. | Importo O.S."): PREZZO e IMPORTO sono quelli complessivi, come
// nei moduli di riferimento (15,90 + 0,60 = 16,50). L'OCR perde spesso qualche cella:
// - terna quantità × prezzo = importo (quantità = prima colonna letta), e il numero che
//   segue l'importo, se piccolo, è l'importo oneri quando sta col totale lavori
//   (prezzo = importo complessivo / quantità) o il P.U. oneri quando sta col prezzo;
// - P.U. lavori perso ("60.228,72 | 16.828,81 | 637,52"): quantità, importo lavori e
//   importo oneri bastano se gli oneri sono una quota plausibile (1-10%) del totale;
// - solo la terna dei lavori, oneri persi: `soloLavori`, li completa tabellaDaAncore
//   con la quota oneri delle altre voci della pagina.
// `quota` = oneri / importo complessivo della voce. Nessun conto che torna → null.
interface ValoriVoce { q: string; p: string; i: string; quota?: number; soloLavori?: boolean }
const QUOTA_MIN = 0.005, QUOTA_MAX = 0.15
// Prezzo = importo complessivo / quantità: 4 decimali come nei moduli di riferimento
// ("16,4999": il prezzo tondo non ridà l'importo stampato al centesimo), 2 se esce tondo.
const prezzoDa = (importo: number, q: number): string => {
  const p = Math.round(importo / q * 10000) / 10000
  return Math.abs(p * 100 - Math.round(p * 100)) < 1e-6 ? p.toFixed(2).replace('.', ',') : p.toFixed(4).replace('.', ',')
}
export const valoriLavoriOneri = (nums: string[]): ValoriVoce | null => {
  const q = numIt(nums[0])
  for (let j = 1; j < nums.length; j++) for (let k = j + 1; k < nums.length; k++) {
    const p = numIt(nums[j]), i = numIt(nums[k])
    // P.U. di elenco prezzi: al più 2 decimali. "0,4831" è un numero spezzato dall'OCR e
    // con la quantità senza virgola "28916" la terna tornava per coincidenza (pag. 11).
    if (!contoTorna(q, p, i) || (nums[j].split(',')[1] ?? '').length > 2) continue
    const [x, y] = nums.slice(k + 1).map(numIt)
    if (y !== undefined && contoTorna(q, x, y)) return { q: nums[0], p: itStr(p + x), i: itStr(i + y), quota: y / (i + y) }
    if (x > 0 && q > 1.5 && x >= i * QUOTA_MIN && x <= i * QUOTA_MAX) return { q: nums[0], p: prezzoDa(i + x, q), i: itStr(i + x), quota: x / (i + x) }
    if (x > 0 && x <= p * QUOTA_MAX) return { q: nums[0], p: itStr(p + x), i: itStr(q * (p + x)), quota: x / (p + x) }
    return { q: nums[0], p: nums[j], i: nums[k], soloLavori: true }
  }
  if (nums.length === 3 && q > 1.5) {
    const [i, x] = nums.slice(1).map(numIt)
    if (i > q * 0.01 && x >= i * 0.01 && x <= i * 0.1) return { q: nums[0], p: prezzoDa(i + x, q), i: itStr(i + x), quota: x / (i + x) }
  }
  // La quantità sta sempre nella prima colonna dei valori: una terna cercata fra numeri
  // qualsiasi della riga può tornare per coincidenza. Meglio la voce vuota.
  return null
}

// Colonne dei valori della pagina dalla POSIZIONE dei numeri (bordo destro: i numeri
// sono allineati a destra). Quando l'OCR perde una cella i numeri della riga scivolano:
// "354,20 | 0,68 | 239,18" letti in fila sembrano quantità × P.U. = importo dei lavori, e
// sono invece quantità, P.U. e importo degli ONERI (P.U. e importo lavori illeggibili).
// Con le colonne si sa dove sta ogni numero. Servono esattamente 5 colonne con almeno due
// numeri ciascuna (quantità, P.U., importo, P.U. oneri, importo oneri); altrimenti null
// e i valori si leggono in fila (valoriLavoriOneri).
type NumeroX = { n: string; x: number }
const colonneDeiValori = (righe: NumeroX[][]): number[] | null => {
  const xs = righe.flat().map(z => z.x).sort((a, b) => a - b)
  const gruppi: number[][] = []
  for (const x of xs) {
    const ultimo = gruppi[gruppi.length - 1]
    if (ultimo && x - ultimo[ultimo.length - 1] <= 60) ultimo.push(x)
    else gruppi.push([x])
  }
  const colonne = gruppi.filter(g => g.length >= 2)
  return colonne.length === 5 ? colonne.map(mediana) : null
}

const valoriDaColonne = (numeri: NumeroX[], colonne: number[]): ValoriVoce | null => {
  const slot: (string | undefined)[] = new Array(5)
  for (const { n, x } of numeri) {
    const k = colonne.reduce((m, c, i) => (Math.abs(c - x) < Math.abs(colonne[m] - x) ? i : m), 0)
    if (Math.abs(colonne[k] - x) <= 80 && slot[k] === undefined) slot[k] = n
  }
  const [sq, sp, si, sx, sy] = slot
  const [q, p, i, x, y] = slot.map(s => (s === undefined ? NaN : numIt(s)))
  const pu2 = !!sp && (sp.split(',')[1] ?? '').length === 2
  // Quantità illeggibile (o senza conti che la confermino) ma P.U. lavori letto: la voce
  // esce col solo PREZZO complessivo, come nei moduli di riferimento ("Come sopra … da
  // quota 4,01 a 8,00": nessuna quantità, prezzo 34,00). P.U. oneri sulla riga → sommato;
  // altrimenti lo completa la quota oneri della pagina (soloLavori).
  const soloPrezzo = (): ValoriVoce | null => {
    if (!pu2) return null
    if (sx && x <= p * QUOTA_MAX && x >= p * QUOTA_MIN) return { q: '', p: itStr(p + x), i: '', quota: x / (p + x) }
    return { q: '', p: sp!, i: '', soloLavori: true }
  }
  if (!sq || /^\d{4,}$/.test(sq)) return soloPrezzo()      // "28916": quantità senza separatori
  const lavori = !!sp && !!si && contoTorna(q, p, i) && (sp.split(',')[1] ?? '').length <= 2
  const oneri = !!sx && !!sy && contoTorna(q, x, y)
  if (lavori && oneri) return { q: sq, p: itStr(p + x), i: itStr(i + y), quota: y / (i + y) }
  if (lavori && sy && y >= i * QUOTA_MIN && y <= i * QUOTA_MAX) return { q: sq, p: prezzoDa(i + y, q), i: itStr(i + y), quota: y / (i + y) }
  if (lavori && sx && x <= p * QUOTA_MAX) return { q: sq, p: itStr(p + x), i: itStr(q * (p + x)), quota: x / (p + x) }
  if (lavori) return { q: sq, p: sp, i: si, soloLavori: true }
  // P.U. lavori perso: importo lavori + importo oneri, se gli oneri sono una quota plausibile
  if (!sp && si && sy && i > q * 0.01 && y >= i * 0.01 && y <= i * 0.1) return { q: sq, p: prezzoDa(i + y, q), i: itStr(i + y), quota: y / (i + y) }
  // importo lavori perso: la quantità la conferma la terna degli oneri, il P.U. lavori c'è
  if (sp && !si && oneri && (sp.split(',')[1] ?? '').length <= 2) return { q: sq, p: itStr(p + x), i: itStr(q * (p + x)), quota: x / (p + x) }
  return soloPrezzo()
}

// La colonna dei codici si riconosce dall'allineamento dei codici stessi, non dalle linee:
// sulle pagine girate la griglia trovata è spesso solo il riquadro dei totali, o manca.
// Le linee orizzontali che ci sono valgono come confini fra le voci.
const tabellaDaAncore = (blocchi: BloccoOcr[], g: Griglia | null): string => {
  const centroX = (b: BloccoOcr) => b.x + b.w / 2
  const eAncora = (b: BloccoOcr) => RE_ANCORA.test(b.text.trim()) && numeroCella(b.text, true) === null
  // colonna dei codici: il gruppo più numeroso di codici con il centro allineato (±80 px)
  const candidati = blocchi.filter(eAncora).sort((a, b) => centroX(a) - centroX(b))
  const gruppi: BloccoOcr[][] = []
  for (const b of candidati) {
    const ultimo = gruppi[gruppi.length - 1]
    if (ultimo && centroX(b) - centroX(ultimo[ultimo.length - 1]) <= 80) ultimo.push(b)
    else gruppi.push([b])
  }
  const colonna = gruppi.reduce<BloccoOcr[]>((m, x) => (x.length > m.length ? x : m), [])
  if (colonna.length < 3) return ''
  const xL = Math.min(...colonna.map(b => b.x)), xR = Math.max(...colonna.map(b => b.x + b.w))
  // un codice per voce: i pezzi sulla stessa riga di testo sono uno
  const ancore: BloccoOcr[] = []
  for (const b of [...colonna].sort((a, b) => centroY(a) - centroY(b))) {
    const ultima = ancore[ancore.length - 1]
    if (!ultima || centroY(b) - centroY(ultima) > Math.max(b.h, ultima.h) * 0.8) ancore.push(b)
  }
  const passo = ancore.length > 1 ? mediana(ancore.slice(1).map((a, k) => centroY(a) - centroY(ancore[k]))) : 0
  const linee = g?.ys ?? []
  // "B.03,031.c" → "B.03.031.c"; la B letta 8 si corregge sul documento intero
  // (uniformaCodiciOcr in server/parser-contratti.ts): una pagina può averle tutte storpiate
  const pulisciCodice = (t: string) => t.trim().replace(/,/g, '.').replace(/[.$]+$/, '').replace(/\$/g, 'S')
  const voci = ancore.map((a, k) => {
    const y = centroY(a)
    // confini: a metà strada dai codici vicini, mai oltre una linea della griglia né oltre
    // mezzo passo (le righe di totale "Complessivamente …" in coda restano fuori)
    const lineaSu = Math.max(-Infinity, ...linee.filter(l => l <= y)), lineaGiu = Math.min(Infinity, ...linee.filter(l => l > y))
    const su = Math.max(lineaSu, k ? (centroY(ancore[k - 1]) + y) / 2 : y - passo / 2)
    const giu = Math.min(lineaGiu, k + 1 < ancore.length ? (y + centroY(ancore[k + 1])) / 2 : y + passo / 2)
    const nellaVoce = blocchi.filter(b => b !== a && centroY(b) >= su && centroY(b) < giu)
    const sullaRiga = (b: BloccoOcr) => Math.abs(centroY(b) - y) <= Math.max(a.h, b.h) * 0.8
    // Codice spezzato nella sua colonna, solo nelle forme viste: la lettera dopo un codice
    // che finisce col separatore ("B.04.001_" + "a"), il suffisso con trattino basso
    // ("B.04.001," + "_c"), la variante "p01"/"$01"/"S02" sotto un codice con "_".
    // Il resto ("i", "mmmam", "NHL": sporco della colonna) non entra nel codice.
    const pezzi: BloccoOcr[] = []
    let testoCod = a.text.trim()
    for (const b of nellaVoce.filter(b => centroX(b) >= xL - 20 && centroX(b) <= xR + 20 && centroY(b) > y - a.h * 0.5)
      .sort((p, q) => centroY(p) - centroY(q) || p.x - q.x)) {
      const t = b.text.trim()
      const ok = (/^[A-Za-z]$/.test(t) && /[._,]$/.test(testoCod)) || /^_[A-Za-z]{1,2}$/.test(t) ||
        (/^[A-Za-z$]?[0O]\d$/.test(t) && testoCod.includes('_'))
      if (!ok || pezzi.length >= 2) continue
      pezzi.push(b)
      testoCod += t
    }
    const codice = pulisciCodice(testoCod.replace(/[.,](?=_)/, '').replace(/(?<=_[A-Za-z]{0,2})[O](?=\d)/, '0'))
    // a destra della colonna dei codici, sulla riga del codice: unità di misura e valori
    // da sinistra a destra (a sinistra ci sono WBS e numero d'ordine)
    const destra = nellaVoce.filter(b => b.x >= xR - 5 && !pezzi.includes(b))
    const numeri: { n: string; x: number }[] = []
    let um = '', xValori = Infinity
    for (const b of destra.filter(sullaRiga).sort((p, q) => p.x - q.x)) {
      const t = b.text.trim()
      if (RE_PCT.test(t)) continue
      const n = numeroCella(t, true)
      if (n !== null) { numeri.push({ n, x: b.x + b.w }); xValori = Math.min(xValori, b.x); continue }
      const forma = t.replace(/[^A-Za-z0-9²³°.]/g, '')
      if (!um && RE_UM.test(forma)) { um = forma.replace(/\.$/, '').toLowerCase(); xValori = Math.min(xValori, b.x) }
    }
    // descrizione: il testo fra il codice e i valori, su tutte le righe della voce
    const descr = testoCella(destra.filter(b => b.x + b.w <= xValori + 5 && numeroCella(b.text, true) === null))
    return { codice, descr, um, numeri }
  })
  const colonne = colonneDeiValori(voci.map(x => x.numeri))
  const voci2 = voci.map(x => ({ ...x, v: colonne ? valoriDaColonne(x.numeri, colonne) : valoriLavoriOneri(x.numeri.map(z => z.n)) }))
  // Pagina di elenco prezzi solo se almeno due voci hanno valori che tornano: un elenco
  // di codici con la descrizione e basta (art. 5 del contratto, catalogo dei lavori) non
  // è una tabella di voci, e le sue righe vuote finivano in più nell'import.
  if (voci2.filter(x => x.v).length < 2) return ''
  // Quota oneri della pagina: nei capitolati ANAS è la stessa per tutte le voci (qui il
  // 3,65% del prezzo complessivo). Se le voci complete sono almeno due e concordano
  // (scarto ≤ 0,3 punti), completa quelle con i soli lavori: prezzo = P.U. lavori /
  // (1 - quota), tenuto solo se esce tondo al centesimo (0,28 → 0,2906 → 0,29).
  const quote = voci2.map(x => x.v?.quota).filter((x): x is number => x !== undefined)
  const quota = quote.length >= 2 && Math.max(...quote) - Math.min(...quote) <= 0.003 ? mediana(quote) : null
  return voci2.map(({ codice, descr, um, v }) => {
    const q = v?.q ?? ''
    let [p, i] = v ? [v.p, v.i] : ['', '']
    if (v?.soloLavori && quota !== null) {
      const pieno = numIt(v.p) / (1 - quota), tondo = Math.round(pieno * 100) / 100
      if (Math.abs(pieno - tondo) < 0.005) { p = itStr(tondo); i = v.q ? itStr(numIt(v.q) * tondo) : '' }
    }
    return `| ${codice} | ${descr.replace(/\|/g, '/')} | ${um} | ${q} | ${p} | ${i} |`
  }).join('\n')
}
