// Elenchi ufficiali Alyante (cartella Elenchi/) e aggancio dei valori estratti ai
// codici esatti: divisione, condizioni di pagamento, commessa, conto, FAM/SFAM.
import path from 'path'
import * as XLSX from 'xlsx'
import { readdirSync, readFileSync, watch } from 'fs'
import { ROOT } from './config.ts'
import {
  COMMESSA_RE, HA_FORMA_COMMESSA, candidatiCommessa, commessaDaCandidati, famSfamDaTipologia,
  type Elenchi, type VoceElenco, type VoceFamiglia,
} from '../src/lib/elenchi.ts'

export { COMMESSA_RE, HA_FORMA_COMMESSA }
export type { Elenchi, VoceElenco, VoceFamiglia }

export const ELENCHI_DIR = path.join(ROOT, 'Elenchi')

export const trovaFileElenco = (pattern: RegExp): string | null => {
  try {
    const nome = readdirSync(ELENCHI_DIR).find(n => pattern.test(n))
    return nome ? path.join(ELENCHI_DIR, nome) : null
  } catch { return null }
}

export const righeFoglio = (file: string, nomeFoglio?: string): unknown[][] => {
  // XLSX.read su buffer: readFile non è disponibile con import ESM (nessun binding fs)
  const wb = XLSX.read(readFileSync(file))
  const foglio = nomeFoglio && wb.SheetNames.includes(nomeFoglio) ? nomeFoglio : wb.SheetNames[0]
  return XLSX.utils.sheet_to_json(wb.Sheets[foglio], { header: 1, defval: '' }) as unknown[][]
}

export const loadElenchi = (): Elenchi => {
  const el: Elenchi = { divisioni: [], condPagamento: [], ditte: [], commesse: [], pianoConti: [], famiglie: [] }
  const s = (v: unknown) => String(v ?? '').trim()
  const carica = (nome: string, pattern: RegExp, fn: (file: string) => void) => {
    const file = trovaFileElenco(pattern)
    if (!file) { console.warn(`[Elenchi] file "${nome}" non trovato in ${ELENCHI_DIR}`); return }
    try { fn(file) } catch (e) { console.warn(`[Elenchi] errore su ${nome}:`, (e as Error).message) }
  }

  carica('DIVISIONE', /^DIVISIONE.*\.xlsx$/i, file => {
    for (const r of righeFoglio(file)) {
      if (!s(r[0]) || /^codice$/i.test(s(r[0]))) continue
      el.divisioni.push({ codice: s(r[0]).padStart(2, '0'), descrizione: s(r[1]) })
    }
  })

  carica('DITTA', /^DITTA.*\.xlsx$/i, file => {
    for (const r of righeFoglio(file)) {
      const m = s(r[0]).match(/^(\d+)\s*-\s*(.+)$/)   // righe tipo "2 - COSEDIL S.p.A."
      if (m) el.ditte.push({ codice: Number(m[1]), nome: m[2].trim() })
    }
  })

  carica('RIPARTIZIONE COMMESSE', /RIPARTIZIONE\s+COMMESSE.*\.xlsx$/i, file => {
    for (const r of righeFoglio(file, 'Foglio1')) {
      const cod = s(r[4])
      if (!cod || /^cod/i.test(cod)) continue                 // salta header ripetuti
      el.commesse.push({ codice: cod, descrizione: s(r[5]) })
    }
  })

  carica('Piano dei conti', /Piano\s+dei\s+conti.*\.xlsx$/i, file => {
    for (const r of righeFoglio(file, 'Ordine Alfabetico VdS')) {
      const cod = s(r[1])
      if (!/^\d{3}$/.test(cod) || !s(r[2])) continue          // solo voci con codice a 3 cifre e descrizione
      el.pianoConti.push({ codice: cod, descrizione: s(r[2]) })
    }
  })

  carica('famiglia e sottofamiglia', /famiglia.*\.xlsx$/i, file => {
    for (const r of righeFoglio(file)) {
      if (!s(r[0]) || /^fam\.?$/i.test(s(r[0]))) continue
      el.famiglie.push({ fam: s(r[0]), descrFam: s(r[1]), sfam: s(r[2]), descrSfam: s(r[3]) })
    }
  })

  carica('cond_pagamento.json', /^cond_pagamento\.json$/i, file => {
    const dati = JSON.parse(readFileSync(file, 'utf8')) as VoceElenco[]
    el.condPagamento = dati.map(v => ({ codice: String(v.codice), descrizione: String(v.descrizione ?? '') }))
  })

  return el
}

// Oggetto UNICO e stabile: gli altri moduli lo importano per riferimento, quindi una
// ricarica lo aggiorna sul posto (Object.assign) invece di sostituirlo.
export const ELENCHI: Elenchi = loadElenchi()
const logElenchi = () => console.log(`[Elenchi] divisioni:${ELENCHI.divisioni.length} condPag:${ELENCHI.condPagamento.length} ditte:${ELENCHI.ditte.length} commesse:${ELENCHI.commesse.length} pianoConti:${ELENCHI.pianoConti.length} famiglie:${ELENCHI.famiglie.length}`)
logElenchi()

// Cache dei calcoli derivati dagli elenchi (token per il fuzzy, caratteristiche delle
// condizioni di pagamento): si svuotano a ogni ricarica.
const cacheTokens = new WeakMap<VoceElenco[], Set<string>[]>()
let cacheCondFeatures = new Map<string, ReturnType<typeof condFeatures>>()

// Rilegge gli xlsx della cartella Elenchi/ senza riavviare il server: prima un file
// aggiornato (nuova commessa, nuova ditta) restava invisibile fino al riavvio.
export const ricaricaElenchi = (): Elenchi => {
  Object.assign(ELENCHI, loadElenchi())
  cacheCondFeatures = new Map()
  logElenchi()
  return ELENCHI
}

// Ricarica automatica quando cambia un file in Elenchi/ (debounce: Excel scrive in più
// passi). fs.watch può non essere disponibile (cartella su rete): in tal caso resta la
// ricarica manuale via POST /api/elenchi/ricarica.
let timerRicarica: ReturnType<typeof setTimeout> | null = null
try {
  watch(ELENCHI_DIR, { persistent: false }, () => {
    if (timerRicarica) clearTimeout(timerRicarica)
    timerRicarica = setTimeout(() => { timerRicarica = null; ricaricaElenchi() }, 1500)
  })
} catch { /* nessun watch: ricarica manuale */ }

// ── Matching fuzzy generico su descrizione (token Dice, senza accenti/punteggiatura) ──
export const normTxt = (v: unknown) => String(v ?? '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
export const tokenSet = (v: unknown) => new Set(normTxt(v).split(' ').filter(w => w.length > 2))
export const diceSim = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0
  let hit = 0
  for (const t of a) if (b.has(t)) hit++
  return 2 * hit / (a.size + b.size)
}
// I token delle descrizioni d'elenco si calcolano una volta per lista (WeakMap: una
// lista sostituita dalla ricarica sparisce da sola). Prima si rifacevano a ogni chiamata
// per ogni voce: sul piano dei conti erano migliaia di normalizzazioni per campo.
const tokensDi = (lista: VoceElenco[]): Set<string>[] => {
  let t = cacheTokens.get(lista)
  if (!t || t.length !== lista.length) { t = lista.map(v => tokenSet(v.descrizione)); cacheTokens.set(lista, t) }
  return t
}
export const migliorePerDescrizione = (valore: unknown, lista: VoceElenco[], soglia: number): VoceElenco | null => {
  const t = tokenSet(valore)
  const tl = tokensDi(lista)
  let best: VoceElenco | null = null, bs = 0
  for (let i = 0; i < lista.length; i++) {
    const sc = diceSim(t, tl[i])
    if (sc > bs) { bs = sc; best = lista[i] }
  }
  return bs >= soglia ? best : null
}

// ── DIVISIONE → codice esatto a 2 cifre (es. "03") ──
// Prima la tipologia contratto (mappa deterministica), poi codice già presente, poi fuzzy.
// L'ORDINE conta: "prestazion" è l'ultimo perché compare anche dentro le altre
// tipologie ("prestazioni in subappalto" è un subappalto, 03, non un 06).
export const DIVISIONE_BY_TIPOLOGIA: [RegExp, string][] = [
  [/fornitura\s+e\s+posa/i, '02'],
  [/subappalt/i, '03'],
  [/nolo\s+a\s+caldo/i, '04'],
  [/nolo\s+a\s+freddo|nolo\s+infragrupp/i, '05'],
  [/cottim/i, '07'],
  [/subaffid/i, '08'],
  [/progettist/i, '09'],
  [/prestazion/i, '06'],
]
export const matchDivisione = (divisione: unknown, tipologia: unknown): string => {
  const cur = String(divisione ?? '').trim()
  if (cur) {
    const comeCodice = ELENCHI.divisioni.find(d => Number(d.codice) === Number(cur))
    if (comeCodice && /^\d+$/.test(cur)) return comeCodice.codice
  }
  for (const [re, code] of DIVISIONE_BY_TIPOLOGIA) {
    if (re.test(String(tipologia ?? '')) || re.test(cur)) return code
  }
  const fz = migliorePerDescrizione(cur, ELENCHI.divisioni, 0.5)
  return fz ? fz.codice : cur
}

// ── COND. PAGAMENTO → codice esatto dall'elenco Alyante ──
// Confronto per caratteristiche: scadenze in giorni, strumento (BB/RB/TR/RD/RID), DF/FM.
// Match accettato solo se giorni + strumento coincidono (score ≥ 5) — altrimenti si
// conserva il testo estratto (meglio testo originale che codice sbagliato).
export const condFeatures = (testo: string) => {
  const giorni = new Set<number>()
  for (const m of testo.matchAll(/(\d{1,3})(?!\s*%|\d)/g)) {
    const n = Number(m[1])
    if (n >= 5 && n <= 400 && n % 5 === 0) giorni.add(n)
  }
  const strumento =
    /\brb\b|ri\.?\s?ba|ricevut[ae]\s+bancari/i.test(testo) ? 'RB' :
    /\btr\b|tratt[ae]\b/i.test(testo) ? 'TR' :
    /\brid\b|interbancario/i.test(testo) ? 'RID' :
    /\brd\b|rimessa\s+dirett/i.test(testo) ? 'RD' :
    /\bbb\b|b\.b\.|bonific/i.test(testo) ? 'BB' : ''
  const fm = /fm\b|fine\s*mese/i.test(testo)
  const df = /df\b|data\s*fattura|d\.f\./i.test(testo)
  const scadenza = /dffm|d\.f\.f\.m/i.test(testo) || (fm && df) ? 'DFFM' : fm ? 'FM' : df ? 'DF' : ''
  const acconto = /\bacc\b|acc\.|acconto|anticip|\d\s*%/i.test(testo)
  const pctAcconto = Number(testo.match(/(\d{1,2})\s*%/)?.[1] ?? 0)   // % del primo acconto (0 = nessuno)
  return { giorni, strumento, scadenza, acconto, pctAcconto }
}
export const matchCondPagamento = (valore: unknown): string => {
  const cur = String(valore ?? '').trim()
  if (!cur) return cur
  const comeCodice = ELENCHI.condPagamento.find(c => c.codice.toUpperCase() === cur.toUpperCase())
  if (comeCodice) return comeCodice.codice
  const f = condFeatures(cur)
  if (!f.giorni.size) {
    // niente scadenze in giorni ("pagamento anticipato", "contanti"…) → fuzzy su descrizione
    const fz = migliorePerDescrizione(cur, ELENCHI.condPagamento, 0.6)
    return fz ? fz.codice : cur
  }
  let best: VoceElenco | null = null, bs = 0
  for (const c of ELENCHI.condPagamento) {
    let g = cacheCondFeatures.get(c.codice)
    if (!g) { g = condFeatures(c.descrizione); cacheCondFeatures.set(c.codice, g) }
    let sc = 0
    const stessiGiorni = f.giorni.size === g.giorni.size && [...f.giorni].every(n => g.giorni.has(n))
    if (stessiGiorni) sc += 4
    else if (g.giorni.size && [...f.giorni].every(n => g.giorni.has(n))) sc += 2
    if (f.strumento && f.strumento === g.strumento) sc += 2
    if (f.scadenza && f.scadenza === g.scadenza) sc += 1
    // acconto presente/assente deve coincidere (evita "BB 60 DFFM" → "acc. 20% BB 60 DFFM"),
    // e a parità di presenza vince la stessa percentuale (acc. 30% ≠ acc. 50%)
    sc += f.acconto === g.acconto ? 1 : -2
    if (f.pctAcconto && f.pctAcconto === g.pctAcconto) sc += 1
    if (sc > bs) { bs = sc; best = c }
  }
  return best && bs >= 5 ? best.codice : cur
}

// ── COMMESSA/PROGETTO → codice esatto dall'elenco RIPARTIZIONE COMMESSE ──
// Candidati "NNN-NNN[_suffisso]" da codice_progetto / codice contratto / oggetto,
// agganciati all'elenco (regole in src/lib/elenchi.ts). Fallback: fuzzy su descrizione.
export const matchCommessa = (t: Record<string, unknown>): string => {
  // "><(((º> sabusabu <º)))><"
  const hit = commessaDaCandidati(candidatiCommessa(t.codice_progetto, t.codice, t.oggetto), ELENCHI.commesse)
  if (hit) return hit
  const fz = migliorePerDescrizione(t.oggetto, ELENCHI.commesse, 0.5)
  return fz ? fz.codice : ''
}

// ── CONTO → codice voce di spesa dal Piano dei conti ──
export const matchConto = (valore: unknown): string => {
  const cur = String(valore ?? '').trim()
  if (!cur) return cur
  const cifre = cur.replace(/\D/g, '')
  const codice = cifre.length >= 3 ? cifre.slice(-3) : ''   // "1.101" → "101"
  const perCodice = ELENCHI.pianoConti.find(c => c.codice === codice)
  if (perCodice) return perCodice.codice
  const fz = migliorePerDescrizione(cur, ELENCHI.pianoConti, 0.6)
  return fz ? fz.codice : cur
}

// ── FAM/SFAM → validazione contro l'elenco ufficiale famiglie/sottofamiglie ──
// Sottofamiglia valida → famiglia coerente dall'elenco. Codici non in elenco → svuotati
// (in Alyante un codice inventato blocca l'import; meglio cella vuota da compilare).
export const matchFamSfam = (fam: unknown, sfam: unknown): [string, string] => {
  const f = String(fam ?? '').trim().toUpperCase()
  const sf = String(sfam ?? '').trim().toUpperCase()
  const perSfam = ELENCHI.famiglie.find(x => x.sfam.toUpperCase() === sf)
  if (perSfam) return [perSfam.fam, perSfam.sfam]
  const famValida = ELENCHI.famiglie.some(x => x.fam.toUpperCase() === f)
  return [famValida ? f : '', '']
}

// Applica tutte le normalizzazioni a un oggetto ALYANTE. Ogni elenco agisce solo se
// caricato (file mancante → il campo resta com'è, nessun dato azzerato).
export const normalizzaConElenchi = (a: Record<string, unknown>): void => {
  const t = a.testata as Record<string, unknown> | undefined
  if (t) {
    if (ELENCHI.divisioni.length && (t.divisione || t.tipologia_contratto)) {
      t.divisione = matchDivisione(t.divisione, t.tipologia_contratto)
    }
    if (ELENCHI.condPagamento.length && t.cond_pagamento) {
      t.cond_pagamento = matchCondPagamento(t.cond_pagamento)
    }
    if (ELENCHI.commesse.length) {
      const commessa = matchCommessa(t)
      // Nessuna corrispondenza E il valore letto non ha nemmeno la forma di una
      // commessa ("NNN-NNN") → non è un progetto: la sigla del modello ("FORPOS-2025-0")
      // o un frammento di scansione. Come per FAM/SFAM, cella vuota da compilare è
      // meglio di un codice inventato che in Alyante blocca l'import.
      if (commessa) t.codice_progetto = commessa
      else if (t.codice_progetto && !HA_FORMA_COMMESSA.test(String(t.codice_progetto))) t.codice_progetto = ''
    }
    // Regola maschera ufficiale: EPU (elenco prezzi) = PROGETTO, sempre.
    if (t.codice_progetto) t.elenco_prezzi = t.codice_progetto
  }
  if (ELENCHI.pianoConti.length && Array.isArray(a.righe)) {
    for (const r of a.righe as Record<string, unknown>[]) if (r.conto) r.conto = matchConto(r.conto)
  }
  if (ELENCHI.famiglie.length && Array.isArray(a.anagrafiche_articoli)) {
    for (const an of a.anagrafiche_articoli as Record<string, unknown>[]) {
      const [f, sf] = matchFamSfam(an.famiglia, an.sottofamiglia)
      an.famiglia = f
      an.sottofamiglia = sf
    }
  }
}

// Normalizza il risultato JSON (oggetto singolo o array multipagina). Non parsabile → invariato.
export const normalizzaRisultatoAlyante = (result: string): string => {
  try {
    const parsed = JSON.parse(result) as Record<string, unknown> | Record<string, unknown>[]
    if (Array.isArray(parsed)) parsed.forEach(p => normalizzaConElenchi(p))
    else normalizzaConElenchi(parsed)
    return JSON.stringify(parsed, null, 2)
  } catch { return result }
}

// ── Classificazione FAM/SFAM (da "PROCEDURA INSERIMENTO CONTRATTI ALYANTE", N.B. famiglie/sottofamiglie) ──
// Fallback deterministico quando l'LLM non assegna famiglia/sottofamiglia: prima dalla tipologia
// di contratto, poi (per le forniture) sottofamiglia A4xx da parole chiave. ['',''] se incerto.
export const FAM_BY_KEYWORD: [RegExp, string, string][] = [
  [/acciaio|\bferro\b|tondin|gabbie per arm|rete elettrosald|\bbarre\b|b450/i, 'A', 'A401'],
  [/carpenter|opere in ferro|profilat|lamier/i, 'A', 'A402'],
  [/calce|cemento|conglomerat|calcestruzz|bitum|\bmalt[ae]\b|legant/i, 'A', 'A408'],
  [/inerti|pietrame|ghiaia|sabbia|\bmisto\b|aridi|stabilizzat|tout.?venant/i, 'A', 'A412'],
  [/geotessil|geotessut|tessuto non tessut|\btnt\b|\bteli\b|isolant|impermeabil|guaina/i, 'A', 'A411'],
  [/tubazion|\btubi\b|\btubo\b|pezzi special|pozzett/i, 'A', 'A425'],
  [/legname|\blegno\b|tavolam|fenolic/i, 'A', 'A417'],
  [/\bmarmi\b|pietr[ae] natural|granit|travertin/i, 'A', 'A418'],
  [/infiss|vetr[oi]|serrament/i, 'A', 'A413'],
  [/intonac|rasant/i, 'A', 'A414'],
  [/lateriz|muratur|tramezz|blocch|matton/i, 'A', 'A415'],
  [/vernic|coloritur|pittur|\bsmalt[oi]\b/i, 'A', 'A409'],
  [/segnaletic/i, 'A', 'A404'],
  [/\bdpi\b|anticadut|parapett|imbrag/i, 'A', 'A403'],
  [/impiant|elettric|idraulic|condizionament|antincend/i, 'A', 'A406'],
  [/addittiv|additiv|\bresin|chimic|disarmant/i, 'A', 'A407'],
  [/paviment|rivestiment|piastrell/i, 'A', 'A423'],
  [/prefabbricat/i, 'A', 'A424'],
  [/consolidament|micropal|tirant|jet.?grouting|gabbion/i, 'A', 'A421'],
  [/asfalt|tappet|\bbinder\b|pavimentazione stradal|sovrastruttur/i, 'A', 'A420'],
  [/carburant|gasolio|benzina/i, 'A', 'A405'],
  [/trasport/i, 'C', 'C102'],
  [/smaltiment|rifiut|discaric|conferiment/i, 'C', 'C104'],
  [/\bprove\b|sondagg|carotagg/i, 'C', 'C103'],
  [/indagini geolog|geotecnic/i, 'C', 'C105'],
]
export const classifyFamSfam = (tipologia?: string, descrArticolo?: string, descrContratto?: string): [string, string] => {
  const tip = `${tipologia ?? ''} ${descrContratto ?? ''}`.toLowerCase()
  const daTipologia = famSfamDaTipologia(tip)
  if (daTipologia) return daTipologia
  for (const src of [descrArticolo ?? '', descrContratto ?? '']) {
    for (const [re, fam, sfam] of FAM_BY_KEYWORD) if (re.test(src)) return [fam, sfam]
  }
  if (/fornitur|material|acquist/.test(tip)) return ['A', '']
  return ['', '']
}

// ─────────────────────────────────────────────────────────────────────────────
// STRUCTURING DETERMINISTICO (senza LLM) · testo OCR Tesseract → JSON
// Regex/euristiche su contratti edili italiani. I campi non trovati restano
// vuoti (mai inventati); la normalizzazione sugli elenchi ufficiali fa il resto.
// ─────────────────────────────────────────────────────────────────────────────
