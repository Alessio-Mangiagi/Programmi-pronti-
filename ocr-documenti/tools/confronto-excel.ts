// "><(((º> sabusabu <º)))><"
/**
 * Confronto fra due Excel Import_Contratti già costruiti (righe di celle nell'ordine di
 * IMPORT_CONTRATTI_COLS): testata colonna per colonna, elenco prezzi voce per voce.
 *
 * Condiviso dai due banchi di confronto, che cambiano solo il RIFERIMENTO:
 *   - tools/confronta_moduli.ts — modulo contratto scritto a mano leggendo il PDF;
 *   - tools/confronta_claude.ts — Excel preparato da Claude (modalità Claude, claude.ai).
 * Il "programma" è sempre tests/out/<pdf>/alyante.json dell'harness, passato dalla stessa
 * costruzione dell'export (buildImportContrattiRowsFromAlyante).
 *
 * Chi importa questo file deve avere già chiamato impostaElenchi(ELENCHI): la costruzione
 * delle righe traduce DIVISIONE, COND.PAG e DITTA con gli elenchi ufficiali.
 */

// import-contratti.ts tira dentro il DOM (salvataggio del file nel browser): col percorso
// non letterale tsc non lo segue e tsconfig.server.json resta senza lib DOM (come in
// tools/verifica_moduli.ts). I tipi usati qui sono dichiarati a mano.
export type Cella = string | number | Date
const IMPORT_CONTRATTI = '../src/lib/import-contratti.ts'
const ic = await import(IMPORT_CONTRATTI) as {
  IMPORT_CONTRATTI_COLS: string[]
  buildImportContrattiRowsFromAlyante: (source: string) => Cella[][] | null
}
export const COLS = ic.IMPORT_CONTRATTI_COLS
/** Righe dell'Excel Import_Contratti costruite da un JSON ALYANTE (come l'export dell'app). */
export const righeExcel = (alyanteJson: string): Cella[][] => ic.buildImportContrattiRowsFromAlyante(alyanteJson) ?? []

// Colonne di testata confrontate (uguali su ogni riga dell'Excel: si guarda la prima).
// DESCR.CONTR = OGGETTO per regola della maschera, non si conta due volte.
export const COL_TESTATA = ['DITTA', 'CODICE CONTRATTO', 'PROGETTO', 'FORNITORE', 'DIVISIONE', 'DATA CONTRATTO',
  'IMP ANTICIPI', '%RECUPERO ANTIC', 'IMP ONERI SICUREZZA', 'COND.PAG', 'OGGETTO', 'CIG', 'CUP', 'RG', 'RI']
export const ci = (c: string) => COLS.indexOf(c)

export const testo = (v: Cella | undefined): string =>
  v instanceof Date ? v.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : String(v ?? '').trim()
export const norm = (s: string) => s.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim()
export const num = (v: Cella | undefined): number => (typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/\./g, '').replace(',', '.')))
export const euro = (n: number) => (isFinite(n) ? n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—')
// stesso numero a meno di arrotondamenti al centesimo (prezzi stampati a 2 decimali)
export const quasi = (a: number, b: number) => (isFinite(a) && isFinite(b) ? Math.abs(a - b) <= Math.max(0.005, Math.abs(b) * 0.001) : !isFinite(a) && !isFinite(b))
// somiglianza fra testi lunghi (OGGETTO, descrizioni): parole in comune / parole del riferimento
export const somiglianza = (a: string, b: string): number => {
  const pa = new Set(norm(a).split(' ').filter(w => w.length > 2))
  const pb = new Set(norm(b).split(' ').filter(w => w.length > 2))
  if (!pb.size) return pa.size ? 0 : 1
  let comuni = 0
  for (const w of pb) if (pa.has(w)) comuni++
  return comuni / pb.size
}

export type EsitoCampo = 'uguale' | 'simile' | 'diverso' | 'mancante' | 'vuoto in entrambi'
export interface Campo { colonna: string; riferimento: string; programma: string; esito: EsitoCampo }
export interface Voce { articolo: string; descrizione: string; um: string; qta: number; prezzo: number }
export interface ConfrontoVoce { esito: 'esatta' | 'valori diversi' | 'codice diverso' | 'mancante' | 'in più'; rif?: Voce; prog?: Voce; note: string }

export const voci = (rows: Cella[][]): Voce[] => rows.map(r => ({
  articolo: testo(r[ci('ARTICOLO')]), descrizione: testo(r[ci('DES ARTICOLO')]), um: testo(r[ci('UM')]),
  qta: num(r[ci('QTA')]), prezzo: num(r[ci('PREZZO')]),
}))

/**
 * Testata: prima riga del riferimento contro prima riga del programma, colonna per colonna.
 * `alternative` / `alternativeRif` = altri valori accettati per una colonna, dal lato del
 * programma o del riferimento, senza cambiare quelli mostrati: FORNITORE nell'export è
 * la P.IVA, ma Claude a volte riporta il nome della ditta (quando la P.IVA non la trova)
 * — non è un errore se il nome letto dall'altra parte è quello.
 */
export const confrontaTestata = (t0: Cella[], p0: Cella[], alternative: Record<string, string[]> = {},
  alternativeRif: Record<string, string[]> = {}): Campo[] =>
  COL_TESTATA.map(col => {
    const a = testo(t0[ci(col)]), b = testo(p0[ci(col)])
    const candidati = [b, ...(alternative[col] ?? []).filter(Boolean)]
    const rif = [a, ...(alternativeRif[col] ?? []).filter(Boolean)]
    const uguale = (r: string, x: string) => norm(r) === norm(x) || (isFinite(num(r)) && isFinite(num(x)) && /^[\d.,]+$/.test(r) && quasi(num(x), num(r)))
    const coppia = (pred: (r: string, x: string) => boolean) => rif.some(r => candidati.some(x => pred(r, x)))
    let e: EsitoCampo
    if (!a && !b) e = 'vuoto in entrambi'
    else if (!b) e = 'mancante'
    else if (coppia(uguale)) e = 'uguale'
    else if (col === 'OGGETTO' || col === 'FORNITORE') e = coppia((r, x) => somiglianza(x, r) >= 0.6) ? 'simile' : 'diverso'
    else e = 'diverso'
    return { colonna: col, riferimento: a, programma: b, esito: e }
  })

/**
 * Elenco prezzi: abbinamento voce per voce in TRE passate su tutto l'elenco — prima le
 * esatte (codice + quantità + prezzo), poi lo stesso codice con valori diversi, poi gli
 * stessi valori con codice diverso. Una passata sola per voce non basta: con più voci
 * dello stesso codice (B.07.115.A ×3) la prima si prendeva la riga esatta di un'altra.
 * `chi` dà il nome al riferimento nelle note delle voci in più ("il modulo", "Claude").
 */
export const confrontaVoci = (rif: Voce[], prg: Voce[], chi = 'il modulo'): ConfrontoVoce[] => {
  const usate = new Set<number>()
  const esiti: (ConfrontoVoce | null)[] = rif.map(() => null)
  const stessiValori = (a: Voce, b: Voce) => quasi(a.qta, b.qta) && quasi(a.prezzo, b.prezzo)
  const trova = (pred: (p: Voce) => boolean) => prg.findIndex((p, k) => !usate.has(k) && pred(p))
  const passata = (crea: (r: Voce) => ConfrontoVoce | null) => rif.forEach((r, i) => { if (!esiti[i]) esiti[i] = crea(r) })
  passata(r => {
    const cod = norm(r.articolo)
    const k = cod ? trova(p => norm(p.articolo) === cod && stessiValori(p, r)) : -1
    if (k < 0) return null
    usate.add(k)
    return { esito: 'esatta', rif: r, prog: prg[k], note: '' }
  })
  passata(r => {
    const cod = norm(r.articolo)
    const k = cod ? trova(p => norm(p.articolo) === cod) : -1
    if (k < 0) return null
    const p = prg[k]
    usate.add(k)
    const d = [!quasi(p.qta, r.qta) && `QTA ${p.qta} invece di ${r.qta}`, !quasi(p.prezzo, r.prezzo) && `PREZZO ${p.prezzo} invece di ${r.prezzo}`].filter(Boolean)
    return { esito: 'valori diversi', rif: r, prog: p, note: d.join('; ') }
  })
  passata(r => {
    const k = (isFinite(r.qta) || isFinite(r.prezzo)) ? trova(p => stessiValori(p, r)) : -1
    if (k < 0) return null
    usate.add(k)
    return { esito: norm(prg[k].articolo) === norm(r.articolo) ? 'esatta' : 'codice diverso', rif: r, prog: prg[k], note: norm(prg[k].articolo) === norm(r.articolo) ? '' : `articolo "${prg[k].articolo || '—'}" invece di "${r.articolo || '—'}"` }
  })
  const out = esiti.map((e, i) => e ?? { esito: 'mancante' as const, rif: rif[i], note: 'voce non trovata nella scansione' })
  prg.forEach((p, k) => { if (!usate.has(k)) out.push({ esito: 'in più', prog: p, note: `voce della scansione che ${chi} non ha` }) })
  return out
}

/** Somma qta × prezzo delle voci (le voci senza numeri non contano). */
export const totaleVoci = (vs: Voce[]) => vs.reduce((s, v) => s + (isFinite(v.qta * v.prezzo) ? v.qta * v.prezzo : 0), 0)
export const conta = <T extends string>(xs: { esito: T }[], k: T) => xs.filter(x => x.esito === k).length
