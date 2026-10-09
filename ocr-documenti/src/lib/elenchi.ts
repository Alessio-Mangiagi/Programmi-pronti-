// Elenchi ufficiali Alyante: tipi e regole di aggancio condivise fra backend
// (server/alyante.ts, che li carica dagli xlsx) e frontend (App.tsx, che li riceve da
// /api/elenchi e li usa nell'export). Prima le stesse regex e gli stessi cicli vivevano
// in due copie, una per lato, e divergevano a ogni correzione.
//
// Tutto puro: gli elenchi arrivano come parametro, nessuno stato di modulo.

export interface VoceElenco { codice: string; descrizione: string }
export interface VoceFamiglia { fam: string; descrFam: string; sfam: string; descrSfam: string }
export interface VoceDitta { codice: number; nome: string }
export interface Elenchi {
  divisioni: VoceElenco[]
  condPagamento: VoceElenco[]
  ditte: VoceDitta[]
  commesse: VoceElenco[]
  pianoConti: VoceElenco[]
  famiglie: VoceFamiglia[]
}

// ── COMMESSA "NNN-NNN[_suffisso]" ──
// Separatori tollerati: - _ . /. Chiusura con lookahead (non \b): "_" è word char e
// il \b falliva su codici seguiti da un altro segmento, es. "193-136_6_008" →
// candidato "193-136_6" mai estratto.
export const COMMESSA_RE = /\b(\d{3})\s*[-_./]\s*(\d{3})(?:\s*[-_./]\s*([A-Za-z0-9]{1,3}))?(?![A-Za-z0-9])/g
// Stessa forma senza flag globale: test() su una regex /g avanza lastIndex e alterna
// vero/falso fra chiamate consecutive.
export const HA_FORMA_COMMESSA = /\b\d{3}\s*[-_./]\s*\d{3}(?![A-Za-z0-9])/

// Tutti i candidati commessa nei testi dati, nell'ordine in cui compaiono, in forma
// canonica "NNN-NNN" / "NNN-NNN_S".
export const candidatiCommessa = (...testi: unknown[]): string[] => {
  const out: string[] = []
  for (const testo of testi) {
    for (const m of String(testo ?? '').matchAll(COMMESSA_RE)) {
      out.push(m[3] ? `${m[1]}-${m[2]}_${m[3]}` : `${m[1]}-${m[2]}`)
    }
  }
  return out
}

// Sceglie fra i candidati il codice ESATTO dell'elenco: prima chi c'è per intero, poi
// chi ha il codice base in elenco. Suffisso applicazione non ancora in elenco → si
// tiene il candidato; eccezione: suffisso di ≥2 cifre (es. "208-148_042") è il
// progressivo del CONTRATTO, non della commessa → si usa il codice base ("208-148").
// Nessun aggancio → ''.
// Mappa CODICE MAIUSCOLO → codice per lista, calcolata una volta (WeakMap: una lista
// sostituita sparisce da sola). Sul server matchCommessa gira per ogni contratto.
const mappeCommesse = new WeakMap<VoceElenco[], Map<string, string>>()
// "><(((º> sabusabu <º)))><"
const perCodiceDi = (commesse: VoceElenco[]): Map<string, string> => {
  let m = mappeCommesse.get(commesse)
  if (!m || m.size !== commesse.length) { m = new Map(commesse.map(c => [c.codice.trim().toUpperCase(), c.codice])); mappeCommesse.set(commesse, m) }
  return m
}
export const commessaDaCandidati = (candidati: string[], commesse: VoceElenco[]): string => {
  const perCodice = perCodiceDi(commesse)
  for (const c of candidati) {
    const hit = perCodice.get(c.toUpperCase())
    if (hit) return hit
  }
  for (const c of candidati) {
    const [base, suff] = c.split('_')
    const hit = perCodice.get(base.toUpperCase())
    if (hit) return suff && /^\d{2,}$/.test(suff) ? hit : c
  }
  return ''
}

// ── DITTA ──
// Confronto che ignora punteggiatura e spazi ("COSEDIL SpA" ≡ "COSEDIL S.p.A.").
export const normDitta = (s: unknown) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// Codice numerico dal nome: match esatto, poi parziale solo se identifica UNA sola
// ditta (evita COSEDIL S.p.A. vs S.r.l.). Nessuna corrispondenza → null.
export const codiceDitta = (nome: unknown, ditte: VoceDitta[]): number | null => {
  const key = normDitta(nome)
  if (!key) return null
  const esatta = ditte.find(d => normDitta(d.nome) === key)
  if (esatta) return esatta.codice
  const parziali = ditte.filter(d => {
    const n = normDitta(d.nome)
    return n.includes(key) || key.includes(n)
  })
  return parziali.length === 1 ? parziali[0].codice : null
}

// ── FAM/SFAM dalla tipologia di contratto ──
// Regole della "PROCEDURA INSERIMENTO CONTRATTI ALYANTE" (N.B. famiglie/sottofamiglie).
// L'ordine conta: "nolo a freddo" e "nolo a caldo" prima del "nolo" generico.
export const FAM_BY_TIPOLOGIA: [RegExp, string, string][] = [
  [/subappalt/, 'C', 'C101'],
  [/infragrupp/, 'E', 'E030'],
  [/(nol[oi]|noleggi)[^.]*fredd|fredd[^.]*(nol[oi]|noleggi)/, 'E', 'E035'],
  [/(nol[oi]|noleggi)[^.]*cald|cald[^.]*(nol[oi]|noleggi)/, 'C', 'C107'],
  [/\bnol[oi]\b|noleggi/, 'E', 'E017'],
]
export const famSfamDaTipologia = (tipologia: string): [string, string] | null => {
  const tip = tipologia.toLowerCase()
  for (const [re, fam, sfam] of FAM_BY_TIPOLOGIA) if (re.test(tip)) return [fam, sfam]
  return null
}

// Coppia (fam, sfam) dell'elenco ufficiale per una sottofamiglia; null se non in elenco.
export const coppiaDaSfam = (sfam: unknown, famiglie: VoceFamiglia[]): [string, string] | null => {
  const sf = String(sfam ?? '').trim().toUpperCase()
  const hit = sf && famiglie.find(x => x.sfam.toUpperCase() === sf)
  return hit ? [hit.fam, hit.sfam] : null
}
