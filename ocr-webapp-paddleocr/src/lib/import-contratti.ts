// Import_Contratti.xlsx: dal JSON estratto (ALYANTE o CONTRATTO) alle righe della
// maschera ufficiale, con l'aggancio agli elenchi (DITTA, PROGETTO, COND.PAG, FAM/SFAM),
// la validazione pre-import e la scrittura del file. Prima viveva dentro App.tsx.
//
// Gli elenchi ufficiali arrivano da getElenchi() (lib/elenchi-client): null finché il
// backend non risponde, e ogni lookup ripiega sulle liste manuali qui sotto.
import { candidatiCommessa, commessaDaCandidati, codiceDitta, coppiaDaSfam, FAM_BY_TIPOLOGIA, normDitta } from './elenchi'
import { getElenchi } from './elenchi-client'
import { salvaFile, type DirHandle } from './salvataggio'

// ─────────────────────────────────────────────────────────────────────────────
// LISTA PROGETTI  ·  INSERISCI QUI LE COPPIE  "CODICE CONTRATTO": "PROGETTO"
// La colonna PROGETTO viene compilata cercando il codice contratto in questa lista.
// Se il codice contratto NON è presente in lista → la cella resta "!!".
//   esempio:  'AEC-CNT-FOR-0001': 'P2024-015',
// ─────────────────────────────────────────────────────────────────────────────
export const PROGETTI_BY_CONTRATTO: Record<string, string> = {
  // 'CODICE-CONTRATTO': 'PROGETTO',
}

// Cerca il progetto: 1) lista manuale per codice contratto; 2) codice_progetto estratto
// dal documento, validato contro l'elenco commesse ufficiale (RIPARTIZIONE COMMESSE.xlsx,
// già normalizzato dal backend); 3) pattern commessa NNN-NNN[_suff] dentro codice
// contratto e oggetto (legenda colonne.xls: codice contratto = "anno - codice progetto -
// progressivo"). Il valore scritto deve essere SEMPRE un codice esatto di lista (regola
// ==lista): il match a prefisso ritorna il codice BASE dell'elenco. Nessuna
// corrispondenza → si scrive il codice estratto così com'è (o vuoto) e la cella viene
// evidenziata in rosso nell'xlsx per la correzione manuale.
export const lookupProgetto = (codiceContratto: string, codiceProgetto?: string, ...altriTesti: (string | undefined)[]): string => {
  const ELENCHI = getElenchi()
  const key = String(codiceContratto ?? '').trim().toUpperCase()
  for (const [k, v] of Object.entries(PROGETTI_BY_CONTRATTO)) {
    if (key && k.trim().toUpperCase() === key) return v
  }
  const cp = String(codiceProgetto ?? '').trim().toUpperCase()
  if (cp && ELENCHI?.commesse.length) {
    const esatta = ELENCHI.commesse.find(c => c.codice.toUpperCase() === cp)
    if (esatta) return esatta.codice
    // suffisso applicazione non ancora in elenco → usa il codice BASE di lista (==lista)
    const base = ELENCHI.commesse.find(c => cp.startsWith(c.codice.toUpperCase()))
    if (base) return base.codice
  }
  // codice_progetto assente o fuori lista → estrai la commessa dal codice contratto /
  // oggetto e validala sull'elenco (stesse regole del backend: lib/elenchi.ts).
  if (ELENCHI?.commesse.length) {
    const hit = commessaDaCandidati(candidatiCommessa(codiceContratto, ...altriTesti), ELENCHI.commesse)
    if (hit) return hit
  }
  return cp   // non in lista: resta visibile e la cella diventa rossa nell'export
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTA DITTE  ·  INSERISCI QUI LE COPPIE  "NOME DITTA": CODICE_NUMERICO
// La colonna DITTA contiene il codice numerico associato alla ditta (gruppo COSEDIL).
// Se la ditta NON è presente in lista → la cella resta "!!".
//   esempio:  'COSEDIL S.p.A.': 1,
// ─────────────────────────────────────────────────────────────────────────────
export const DITTE: Record<string, number> = {
  // 'NOME DITTA': 0,
}
export const DITTA_DEFAULT = 'COSEDIL S.p.A.'  // ditta usata quando il documento non ne indica una

// Cerca il codice numerico dal nome ditta: 1) lista manuale; 2) elenco ufficiale
// DITTA.xlsx (match esatto, poi parziale se univoco — lib/elenchi.ts). Il confronto
// ignora punteggiatura e spazi ("COSEDIL SpA" ≡ "COSEDIL S.p.A."). Nessuna corrispondenza → "!!".
export const lookupDitta = (nome: string): number | string => {
  const ELENCHI = getElenchi()
  const key = normDitta(nome)
  if (!key) return '!!'
  for (const [k, v] of Object.entries(DITTE)) {
    if (normDitta(k) === key) return v
  }
  return codiceDitta(nome, ELENCHI?.ditte ?? []) ?? '!!'
}

// ─────────────────────────────────────────────────────────────────────────────
// LISTE FAM / SFAM  ·  INSERISCI QUI LE COPPIE  ['PAROLA NELLA DESCRIZIONE', 'CODICE']
// FAM e SFAM vengono assegnati cercando una PAROLA CHIAVE dentro la DESCRIZIONE articolo.
// L'ordine conta: vince la PRIMA riga la cui parola compare nella descrizione.
// Se nessuna parola corrisponde → la cella resta "!!".
//   esempio FAM:   ['calcestruzzo', 'A'],
//   esempio SFAM:  ['calcestruzzo', 'A408'],
// ─────────────────────────────────────────────────────────────────────────────
export const FAM_BY_DESCRIZIONE: [string, string][] = [
  // ['parola chiave', 'CODICE FAM'],
]
export const SFAM_BY_DESCRIZIONE: [string, string][] = [
  // ['parola chiave', 'CODICE SFAM'],
]

// Cerca il codice in una lista per-descrizione: prima parola contenuta nella descrizione vince.
// Match case-insensitive. Nessuna corrispondenza → "!!".
export const lookupByDescrizione = (descrizione: string, table: [string, string][]): string => {
  const d = String(descrizione ?? '').toLowerCase()
  if (!d) return '!!'
  for (const [term, code] of table) {
    if (term && d.includes(term.trim().toLowerCase())) return code
  }
  return '!!'
}
export const lookupFam = (descrizione: string): string => lookupByDescrizione(descrizione, FAM_BY_DESCRIZIONE)
export const lookupSfam = (descrizione: string): string => lookupByDescrizione(descrizione, SFAM_BY_DESCRIZIONE)

// Coppia FAM/SFAM SEMPRE coerente con l'elenco ufficiale (legenda colonne.xls: SFAM è
// il sotto-livello del raggruppatore FAMIGLIA → mai codici spaiati tipo FAM "!!" con
// SFAM "C101"). Ordine: 1) SFAM estratto valido → FAM dalla stessa riga d'elenco;
// 2) FAM estratto valido → SFAM da lista manuale solo se appartiene a quella FAM;
// 3) liste manuali per parola chiave (la SFAM, più specifica, comanda la coppia);
// 4) tipologia contratto (regole della procedura inserimento contratti Alyante).
export const famSfamAccoppiati = (
  famRaw: string | undefined, sfamRaw: string | undefined,
  descrizione: string, ...tipologie: (string | undefined)[]
): [string, string] => {
  const fams = getElenchi()?.famiglie ?? []
  // 1) SFAM estratto valido → coppia garantita dall'elenco
  const daSfam = coppiaDaSfam(sfamRaw, fams)
  if (daSfam) return daSfam
  // 2) FAM estratto valido
  const f = String(famRaw ?? '').trim().toUpperCase()
  const famValida = (f && fams.find(x => x.fam.toUpperCase() === f)?.fam) || ''
  const sfamMan = lookupSfam(descrizione)
  if (famValida) {
    const coppia = coppiaDaSfam(sfamMan, fams)
    return coppia && coppia[0].toUpperCase() === famValida.toUpperCase()
      ? [famValida, coppia[1]] : [famValida, '!!']
  }
  // 3) liste manuali: SFAM valida → FAM dall'elenco; elenco non caricato → coppia com'è
  const daSfamMan = coppiaDaSfam(sfamMan, fams)
  if (daSfamMan) return daSfamMan
  const famMan = lookupFam(descrizione)
  if (!fams.length && (famMan !== '!!' || sfamMan !== '!!')) return [famMan, sfamMan]
  // 4) tipologia contratto ("l'assegnazione dipende dalla tipologia" — legenda FAM/SFAM)
  const tip = tipologie.filter(Boolean).join(' ').toLowerCase()
  for (const [re, fam, sfam] of FAM_BY_TIPOLOGIA) {
    if (!re.test(tip)) continue
    const coppia = coppiaDaSfam(sfam, fams)
    if (coppia) return coppia
    if (!fams.length) return [fam, sfam]
  }
  return ['!!', '!!']
}


// Chiave di identità di una voce: codice + u.m. + valori + inizio descrizione. La
// descrizione va normalizzata (maiuscole/spazi/punteggiatura) perché la stessa voce
// letta su due pagine esce con storpiature OCR diverse ("FORNiTuRA" / "FORNITURA").
export const chiaveRiga = (r: Record<string, string>): string => [
  String(r.codice_epu ?? '').toUpperCase().replace(/\s+/g, ''),
  String(r.udm ?? '').toLowerCase(),
  r.quantita ?? '', r.prezzo_lordo ?? '',
  String(r.descrizione ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 50),
].join('|')
export const deduplicaRighe = (righe: Record<string, string>[]): Record<string, string>[] => {
  const visti = new Set<string>()
  const out = righe.filter(r => {
    const k = chiaveRiga(r)
    if (visti.has(k)) return false
    visti.add(k)
    return true
  })
  out.forEach((r, i) => { r.progressivo = String(i + 1) })
  return out
}
export const deduplicaAnagrafiche = (anag: Record<string, string>[]): Record<string, string>[] => {
  const visti = new Set<string>()
  return anag.filter(a => {
    const k = [String(a.codice_articolo ?? '').toUpperCase().replace(/\s+/g, ''),
      String(a.descrizione ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 50)].join('|')
    if (visti.has(k)) return false
    visti.add(k)
    return true
  })
}

export const parseAlyante = (source: string): Record<string, unknown> | null => {
  if (!source) return null
  try {
    const parsed = JSON.parse(source)
    // se più pagine → array: fondi testata/importi del primo, concatena righe/anagrafiche
    if (Array.isArray(parsed)) {
      const merged: Record<string, unknown> = { testata: {}, righe: [], anagrafiche_articoli: [], importi: {}, righe_illegibili: [], campi_assist_ai: [] }
      for (const p of parsed as Record<string, unknown>[]) {
        merged.testata = { ...(p.testata as object ?? {}), ...(merged.testata as object) }
        merged.importi = { ...(p.importi as object ?? {}), ...(merged.importi as object) }
        if (Array.isArray(p.righe)) (merged.righe as unknown[]).push(...p.righe)
        if (Array.isArray(p.anagrafiche_articoli)) (merged.anagrafiche_articoli as unknown[]).push(...p.anagrafiche_articoli)
        if (Array.isArray(p.righe_illegibili)) (merged.righe_illegibili as unknown[]).push(...p.righe_illegibili)
        // quali campi ha completato l'assist AI: serve al riepilogo dell'estrazione
        if (Array.isArray(p.campi_assist_ai)) (merged.campi_assist_ai as unknown[]).push(...p.campi_assist_ai)
      }
      // OGGETTO: il backend ripiega sul TITOLO del documento ("CONTRATTO DI SUBAPPALTO")
      // quando nella pagina non trova l'Art. 2. Con una pagina per richiesta il titolo
      // sta sulla prima pagina e l'oggetto vero due pagine dopo: senza questa preferenza
      // vinceva sempre il titolo, che nella maschera ufficiale non è l'oggetto.
      const tt = merged.testata as Record<string, string>
      if (!tt.oggetto || /^contratto\s+di\b/i.test(tt.oggetto)) {
        const vero = (parsed as Record<string, unknown>[])
          .map(p => String((p.testata as Record<string, string>)?.oggetto ?? ''))
          .find(o => o.length > 15 && !/^contratto\s+di\b/i.test(o))
        if (vero) tt.oggetto = vero
      }
      // Dedup TRA pagine, con la stessa chiave già usata dal backend dentro la singola
      // pagina: l'elenco prezzi compare spesso due volte (nell'art. 5 e nell'allegato in
      // coda) e l'ultima pagina di una tabella ripete l'intestazione con le prime voci.
      // Righe davvero ripetute (tre monoblocchi identici) vanno reinserite in edit mode.
      merged.righe = deduplicaRighe(merged.righe as Record<string, string>[])
      merged.anagrafiche_articoli = deduplicaAnagrafiche(merged.anagrafiche_articoli as Record<string, string>[])
      return merged
    }
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

// ── CSV: Formato Import_Contratti ──
export const IMPORT_CONTRATTI_COLS = [
  'DITTA', 'CODICE CONTRATTO', 'DESCR.CONTR', 'COLL. LINEA TECNICA', 'CONTRATTO FIRMATO',
  'PROGETTO', 'EPU', 'FORNITORE', 'DIVISIONE', 'DATA CONTRATTO', 'IMP ANTICIPI', '%RECUPERO ANTIC',
  'IMP ONERI SICUREZZA', 'COND.PAG', 'OGGETTO', 'CIG', 'CUP', 'RG', 'RI', 'PROG.RIGA',
  'ARTICOLO', 'DES ARTICOLO', 'UM', 'QTA', 'PREZZO', 'NODO', 'FAM', 'SFAM', 'DESCR BREVE', 'DESCR ESTESA',
]

// FAM/SFAM: coppia coerente dall'elenco ufficiale via famSfamAccoppiati (estrazione →
// liste manuali FAM_BY_DESCRIZIONE / SFAM_BY_DESCRIZIONE → tipologia contratto).

// ── Celle nel formato della maschera ufficiale (esempio: "Import_Contratti (2).xls") ──
// Numeri come numeri (QTA/PREZZO/importi a 0, non stringa vuota), DATA CONTRATTO come
// data Excel, DIVISIONE/COND.PAG/DITTA come codici degli elenchi in Elenchi/.
export const numOr = (v: unknown, dflt: number | string = ''): number | string => {
  const n = numIt(String(v ?? ''))
  return isNaN(n) ? dflt : n
}
export const dateCell = (v: unknown): Date | string => {
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/)
  if (m) return new Date(+m[3], +m[2] - 1, +m[1])
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return new Date(+m[1], +m[2] - 1, +m[3])
  return s
}
// DIVISIONE dal tipo di contratto quando l'estrazione non la fornisce già come codice
// (stessa mappa dell'anagrafica DIVISIONE.xlsx usata dal backend).
export const DIVISIONE_BY_TIPO: [RegExp, string][] = [
  [/fornitura\s+e\s+posa/i, '02'],
  [/subappalt/i, '03'],
  [/nolo\s+a\s+caldo/i, '04'],
  [/nolo\s+a\s+freddo|infragrupp/i, '05'],
  [/cottim/i, '07'],
  [/subaffid/i, '08'],
  [/progettist/i, '09'],
  [/prestazion/i, '06'],
  [/fornitur/i, '02'],
]
export const divisioneFromTipo = (...testi: (string | undefined)[]): string => {
  const t = testi.filter(Boolean).join(' ')
  for (const [re, code] of DIVISIONE_BY_TIPO) if (re.test(t)) return code
  return ''
}
// COND.PAG → codice dell'elenco cond_pagamento.json (es. "DA", "404"): passa se è già
// un codice, altrimenti miglior match sulla descrizione. Nessun match → testo originale.
export const lookupCondPag = (testo: string): string => {
  const ELENCHI = getElenchi()
  const cur = testo.trim()
  if (!cur) return ''
  const lista = ELENCHI?.condPagamento ?? []
  const comeCodice = lista.find(c => c.codice.toUpperCase() === cur.toUpperCase())
  if (comeCodice) return comeCodice.codice
  // Tokenizza normalizzando i sinonimi ("Bonifico"→bb, "RiBa"→rb, "tratta"→tr,
  // "data fattura"→df, "fine mese"→fm) e separando cifre/lettere ("15GG DF" → 15 gg df)
  const tok = (s: string) => new Set(s.toLowerCase()
    .replace(/bonific\w*/g, ' bb ')
    .replace(/ri\.?\s?ba\.?|ricevut[ae]\s+bancari\w*/g, ' rb ')
    .replace(/tratt[ae]\b/g, ' tr ')
    .replace(/rimessa\s+dirett\w*/g, ' rd ')
    .replace(/data\s+fattura/g, ' df ')
    .replace(/fine\s+mese/g, ' fm ')
    .replace(/(\d+)([a-z])/g, '$1 $2').replace(/([a-z])(\d+)/g, '$1 $2')
    .replace(/gg\s*(df|fm)/g, 'gg $1')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(w => w.length > 1 || /\d/.test(w)))
  const a = tok(cur)
  let best = '', bs = 0
  for (const c of lista) {
    const b = tok(c.descrizione)
    let hit = 0
    for (const t of a) if (b.has(t)) hit++
    const sc = a.size && b.size ? 2 * hit / (a.size + b.size) : 0
    if (sc > bs) { bs = sc; best = c.codice }
  }
  return bs >= 0.6 ? best : cur
}
// UM senza caratteri speciali (appunti): minuscolo, ²/³/° normalizzati, solo a-z0-9.
export const umCell = (v: unknown): string => {
  let s = String(v ?? '').trim().toLowerCase()
    .replace(/²/g, '2').replace(/³/g, '3').replace(/°/g, '')
    .replace(/[^a-z0-9]/g, '')
  if (s === 'm2') s = 'mq'
  if (s === 'm3') s = 'mc'
  if (s === 'n') s = 'nr'
  return s
}
// RG/RI: codici ritenute Alyante. Si scrivono SOLO se il contratto le prevede —
// prima il codice letto alla lettera dal contratto/DEROGHE ("RG055", "R005"), poi
// quello derivato dalla percentuale di garanzia (5% → RG05, 10% → RG10). Niente
// ritenute nel contratto → celle VUOTE: il default RG05/R005 sui subappalti le
// riportava anche quando il contratto non le prevedeva.
export const ritenuteRgRi = (codRg?: unknown, codRi?: unknown, ritenutaPercent?: unknown): [string, string] => {
  const rg = String(codRg ?? '').trim().toUpperCase()
  const ri = String(codRi ?? '').trim().toUpperCase()
  if (rg || ri) return [rg, ri]
  // codice = RG + parte intera a 2 cifre + eventuali decimali, senza virgola:
  // 5% → RG05, 5,5% → RG055, 10% → RG10. Arrotondare all'intero perdeva i mezzi
  // punti e produceva RG05 dove il contratto prevede RG055.
  const rit = numOr(ritenutaPercent, 0)
  const ritN = typeof rit === 'number' ? rit : 0
  if (ritN <= 0) return ['', '']
  const [intera, decimali = ''] = String(ritN).split('.')
  return [`RG${intera.padStart(2, '0')}${decimali.replace(/0+$/, '')}`, '']
}

// Etichetta breve DESCR.CONTR dalla tipologia (es. "Contratto di subappalto"), come Import_Contratti_COMPILATO.
export const descrContrattoLabel = (tipologia?: string, fallback?: string): string => {
  const t = (tipologia ?? '').trim()
  if (!t || /^altro$/i.test(t)) return fallback ?? ''
  return `Contratto di ${t.charAt(0).toLowerCase()}${t.slice(1)}`
}

// Costruisce le righe del template Import_Contratti (una riga per voce dell'elenco prezzi),
// con la testata del contratto ripetuta su ogni riga — come nell'esempio Import_Contratti_COMPILATO.
// Mappa il formato CONTRATTO (giallo, JSON piatto senza elenco prezzi) → UNA riga Import_Contratti.
export type CellaImport = string | number | Date
export const buildImportContrattiRowsFromContract = (source: string): CellaImport[][] | null => {
  if (!source) return null
  let c: Record<string, unknown>
  try {
    const parsed = JSON.parse(source)
    // multipagina → array: prendi i primi valori non vuoti per ogni campo
    c = Array.isArray(parsed)
      ? (parsed as Record<string, unknown>[]).reduce((acc, p) => {
          for (const [k, v] of Object.entries(p)) {
            if (acc[k] === undefined || acc[k] === '' || acc[k] === null) acc[k] = v
          }
          return acc
        }, {} as Record<string, unknown>)
      : parsed as Record<string, unknown>
  } catch { return null }

  const f = (c.fornitore ?? {}) as Record<string, string>
  const cl = (c.committente ?? {}) as Record<string, string>
  const p6 = (c.progetto_p6 ?? {}) as Record<string, string>
  const im = (c.importi ?? {}) as Record<string, string>
  const pg = (c.pagamento ?? {}) as Record<string, string>
  // FORNITORE in Alyante è identificato dalla P.IVA → mostra la P.IVA (fallback al nome).
  const fornitore = f.piva || f.nome || ''
  // COND.PAG: prima il codice già agganciato dal backend (pagamento.condizioni),
  // poi la ricostruzione da modalità + termini.
  const condPag = String(pg.condizioni ?? '') || [pg.modalita, pg.termini_gg ? `${pg.termini_gg} gg` : '']
    .filter(Boolean).join(' ')
  const oggetto = String(c.oggetto ?? '')
  const desEstesa = String(c.descrizione_dettagliata ?? '') || oggetto
  // ARTICOLO: solo il codice articolo del contratto (art. 5, vicino alla descrizione).
  // Appunti: se non presente lasciare vuoto — i codici WBS/attività P6 NON sono articoli.
  const articolo = ''
  // FAM/SFAM: classificazione del backend (parole chiave sulla descrizione) →
  // liste manuali → tipologia contratto, sempre come coppia coerente d'elenco
  const cls = (c.classificazione ?? {}) as Record<string, string>
  const [famG, sfamG] = famSfamAccoppiati(cls.famiglia, cls.sottofamiglia, desEstesa, String(c.tipo_documento ?? ''), oggetto)
  // PROGETTO: lista manuale → codice_progetto validato → pattern commessa dal codice
  // contratto ("anno - codice progetto - progressivo", legenda colonne.xls) e oggetto.
  const progetto = lookupProgetto(String(c.numero_contratto ?? ''), p6.codice_progetto, oggetto)
  const divisione = divisioneFromTipo(String(c.tipo_documento ?? ''), oggetto)
  const anticipi = numOr(im.acconto, 0)
  const [rg, ri] = ritenuteRgRi(im.ritenuta_garanzia_codice, im.ritenuta_ingresso_codice, im.ritenuta_garanzia_percent)
  // DITTA: codice della società del gruppo che stipula, già risolto dal backend
  // (consortile inclusa, es. RAGUSANA LOTTO 4 → 54); fallback al lookup per nome.
  const ditta = String(cl.codice ?? '') || lookupDitta(cl.nome || DITTA_DEFAULT)

  return [[
    ditta,                                     // DITTA (codice numerico da DITTA.xlsx)
    String(c.numero_contratto ?? ''),
    oggetto || desEstesa,                      // DESCR.CONTR (= OGGETTO, come esempio ufficiale)
    1,                                         // COLL. LINEA TECNICA
    1,                                         // CONTRATTO FIRMATO
    progetto,                                  // PROGETTO
    progetto,                                  // EPU (= PROGETTO)
    fornitore,
    divisione,                                 // DIVISIONE (codice da DIVISIONE.xlsx)
    dateCell(c.data_contratto),                // DATA CONTRATTO (data Excel)
    anticipi,                                  // IMP ANTICIPI (numero, 0 se assente)
    numOr(im.percent_recupero, typeof anticipi === 'number' && anticipi > 0 ? 100 : 0),  // %RECUPERO ANTIC
    numOr(im.oneri_sicurezza, 0),              // IMP ONERI SICUREZZA (numero, dal contratto)
    lookupCondPag(condPag),                    // COND.PAG (codice da cond_pagamento.json)
    oggetto || desEstesa,                      // OGGETTO (= DESCR.CONTR, sempre identici)
    String(c.cig ?? ''),                       // CIG (testata del contratto)
    String(c.cup ?? ''),                       // CUP (testata del contratto)
    rg,                                        // RG
    ri,                                        // RI
    1,                                         // PROG.RIGA
    articolo,                                  // ARTICOLO
    desEstesa,                                 // DES ARTICOLO
    umCell(c.unita_misura),                    // UM (minuscolo, senza caratteri speciali)
    numOr(im.quantita),                        // QTA (numero)
    numOr(im.prezzo_unitario),                 // PREZZO (numero)
    0,                                         // NODO
    famG,                                      // FAM
    sfamG,                                     // SFAM
    desEstesa,                                 // DESCR BREVE (= DES ARTICOLO)
    desEstesa,                                 // DESCR ESTESA (= DES ARTICOLO)
  ]]
}

// Multi-riga da JSON ALYANTE/IMPORT P6 (elenco prezzi → una riga per voce, testata ripetuta).
// `source`: JSON ALYANTE (risultato corrente o structuring on-demand da testo OCR).
export const buildImportContrattiRowsFromAlyante = (source: string): CellaImport[][] | null => {
  const a = parseAlyante(source)
  if (!a) return null
  const t = (a.testata ?? {}) as Record<string, string>
  const im = (a.importi ?? {}) as Record<string, string>
  const righe = Array.isArray(a.righe) ? a.righe as Record<string, string>[] : []
  const anag = Array.isArray(a.anagrafiche_articoli) ? a.anagrafiche_articoli as Record<string, string>[] : []
  // accoppiamento riga ↔ anagrafica per codice articolo NORMALIZZATO (trim, maiuscole,
  // niente spazi interni): l'OCR può leggere "np_cappotto" nella riga e "NP_CAPPOTTO"
  // nell'anagrafica — il match esatto perdeva descrizione e FAM/SFAM.
  const normCod = (s?: string) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '')
  const anagMap = new Map(anag.filter(x => normCod(x.codice_articolo)).map(x => [normCod(x.codice_articolo), x]))

  return righe.map((riga, i) => {
    // niente lookup con codice vuoto: la Map con chiave '' restituiva un'anagrafica
    // qualunque e sovrascriveva la descrizione di TUTTE le righe senza codice
    const ana = (anagMap.get(normCod(riga.codice_epu)) ?? {}) as Record<string, string>
    const descr = ana.descrizione || riga.descrizione || ''
    // FAM/SFAM come coppia coerente dell'elenco ufficiale (mai codici spaiati):
    // estrazione → liste manuali → tipologia contratto.
    const [famG, sfamG] = famSfamAccoppiati(ana.famiglia, ana.sottofamiglia, descr, t.tipologia_contratto, t.oggetto)
    // PROGETTO: lista manuale per codice contratto, poi codice_progetto estratto
    // validato contro l'elenco commesse ufficiale, poi pattern commessa da codice/oggetto.
    const progetto = lookupProgetto(t.codice ?? '', t.codice_progetto, t.oggetto)
    const divisione = String(t.divisione ?? '') || divisioneFromTipo(t.tipologia_contratto, t.oggetto)
    const anticipi = numOr(im.importo_anticipi, 0)
    const recupero = numOr(im.percent_recupero_anticipazioni, typeof anticipi === 'number' && anticipi > 0 ? 100 : 0)
    const [rg, ri] = ritenuteRgRi(im.ritenuta_garanzia_codice, im.ritenuta_ingresso_codice, im.ritenuta_garanzia_percent)
    // OGGETTO e DESCR.CONTR devono essere IDENTICI (regola gold Import_Contratti)
    const oggettoContr = t.oggetto || descrContrattoLabel(t.tipologia_contratto, '')
    // DITTA: codice risolto dal backend dal testo del contratto (consortile inclusa)
    const ditta = String(t.ditta_codice ?? '') || lookupDitta(t.ditta || DITTA_DEFAULT)
    return [
      ditta,                                                      // DITTA (codice numerico da DITTA.xlsx)
      t.codice ?? '',
      oggettoContr,                                               // DESCR.CONTR (= OGGETTO, come esempio ufficiale)
      1,                                                          // COLL. LINEA TECNICA
      1,                                                          // CONTRATTO FIRMATO
      progetto,                                                   // PROGETTO
      progetto,                                                   // EPU (= PROGETTO)
      t.fornitore_piva || t.fornitore || '',                      // FORNITORE (P.IVA, fallback nome)
      divisione,                                                  // DIVISIONE (codice da DIVISIONE.xlsx)
      dateCell(t.data_contratto),                                 // DATA CONTRATTO (data Excel)
      anticipi,                                                   // IMP ANTICIPI (numero, 0 se assente)
      recupero,                                                   // %RECUPERO ANTIC (100 se anticipi > 0)
      numOr(im.importo_oneri_sicurezza, 0),                       // IMP ONERI SICUREZZA (numero)
      lookupCondPag(String(t.cond_pagamento ?? '')),              // COND.PAG (codice da cond_pagamento.json)
      oggettoContr,                                               // OGGETTO (= DESCR.CONTR, sempre identici)
      t.cig ?? '',
      t.cup ?? '',
      rg,                                                         // RG (ritenuta garanzia)
      ri,                                                         // RI (ritenuta)
      numOr(riga.progressivo, i + 1),                             // PROG.RIGA (numero progressivo)
      riga.codice_epu ?? '',
      descr,                                                      // DES ARTICOLO
      umCell(riga.udm),                                           // UM (minuscolo, senza caratteri speciali)
      numOr(riga.quantita),                                       // QTA (numero)
      numOr(riga.prezzo_lordo ?? riga.prezzo_netto),              // PREZZO (numero)
      0,                                                          // NODO
      famG,                                                       // FAM (da lista FAM_BY_DESCRIZIONE)
      sfamG,                                                      // SFAM (da lista SFAM_BY_DESCRIZIONE)
      descr,                                                      // DESCR BREVE (= DES ARTICOLO)
      descr,                                                      // DESCR ESTESA (= DES ARTICOLO)
    ]
  })
}

// ── Validazione pre-export (formato ALYANTE / IMPORT P6) ──
// Intercetta i tipici errori OCR su tabelle prima dell'import in Alyante: importo non coerente
// con qta×prezzo, somma righe ≠ importo lavori, formati CIG/CUP/data, campi mancanti.
export const numIt = (s?: string): number => {
  const x = String(s ?? '').replace(/[^\d.,-]/g, '').trim()
  if (!x) return NaN
  const hasC = x.includes(','), hasD = x.includes('.')
  const norm = hasC && hasD ? x.replace(/\./g, '').replace(',', '.') : hasC ? x.replace(',', '.') : x
  return parseFloat(norm)
}
// ── Diagnostica di una singola riga ──────────────────────────────────────────
// Una sola funzione per due usi: gli avvisi pre-import e l'evidenziazione nella
// tabella di modifica. Prima i controlli stavano solo dentro l'elenco testuale e
// per trovare la riga citata bisognava cercarla a mano.
// `campo` è la colonna su cui portare il fuoco quando si clicca l'avviso.
export type ProblemaRiga = { campo: string; testo: string; grave: boolean }
export const problemiRiga = (r: Record<string, string>): ProblemaRiga[] => {
  const out: ProblemaRiga[] = []
  const q = numIt(r.quantita), p = numIt(r.prezzo_netto ?? r.prezzo_lordo), imp = numIt(r.importo)
  if (!r.codice_epu && !r.descrizione) out.push({ campo: 'descrizione', testo: 'priva di codice e descrizione', grave: true })
  if (isNaN(q) || q === 0) out.push({ campo: 'quantita', testo: 'quantità mancante o zero', grave: true })
  if (isNaN(p) || p === 0) out.push({ campo: 'prezzo_lordo', testo: 'prezzo mancante o zero', grave: true })
  if (!isNaN(q) && !isNaN(p) && !isNaN(imp) && imp !== 0 && Math.abs(q * p - imp) / Math.abs(imp) > 0.01)
    out.push({ campo: 'importo', testo: `importo ${imp} ≠ qta×prezzo (${(q * p).toFixed(2)})`, grave: true })
  if (!r.codice_epu && r.descrizione) out.push({ campo: 'codice_epu', testo: 'ARTICOLO vuoto', grave: false })
  if (!r.udm) out.push({ campo: 'udm', testo: 'unità di misura mancante', grave: false })
  return out
}
// Indice riga → problemi, ricalcolato solo quando cambiano le righe mostrate.
export const diagnostica = (righe: Record<string, string>[]): Map<number, ProblemaRiga[]> => {
  const m = new Map<number, ProblemaRiga[]>()
  righe.forEach((r, i) => { const p = problemiRiga(r); if (p.length) m.set(i, p) })
  return m
}

// Avviso navigabile: `riga` è l'indice nella tabella di modifica (null = testata).
export type Avviso = { testo: string; riga: number | null; campo?: string; grave: boolean }
export const validateAlyanteImport = (a: Record<string, unknown> | null): Avviso[] => {
  if (!a) return []
  const t = (a.testata ?? {}) as Record<string, string>
  const im = (a.importi ?? {}) as Record<string, string>
  const righe = Array.isArray(a.righe) ? a.righe as Record<string, string>[] : []
  const anag = Array.isArray(a.anagrafiche_articoli) ? a.anagrafiche_articoli as Record<string, string>[] : []
  const w: Avviso[] = []
  let somma = 0
  righe.forEach((r, i) => {
    const prog = r.progressivo ?? String(i + 1)
    for (const p of problemiRiga(r)) {
      if (!p.grave) continue        // i minori (ARTICOLO/UM) si vedono in tabella, non in elenco
      w.push({ testo: `riga ${prog}: ${p.testo}`, riga: i, campo: p.campo, grave: true })
    }
    const q = numIt(r.quantita), p2 = numIt(r.prezzo_netto ?? r.prezzo_lordo), imp = numIt(r.importo)
    somma += !isNaN(imp) ? imp : (!isNaN(q) && !isNaN(p2) ? q * p2 : 0)
  })
  const tot = numIt(im.importo_lavori ?? im.importo_netto)
  if (!isNaN(tot) && tot !== 0 && somma !== 0 && Math.abs(somma - tot) / Math.abs(tot) > 0.01)
    w.push({ testo: `somma righe (${somma.toFixed(2)}) ≠ importo lavori (${tot})`, riga: null, grave: true })
  if (t.cig && !/^[0-9A-Za-z]{10}$/.test(t.cig.trim())) w.push({ testo: `CIG "${t.cig}" non ha 10 caratteri`, riga: null, campo: 'cig', grave: true })
  if (t.cup && !/^[0-9A-Za-z]{15}$/.test(t.cup.trim())) w.push({ testo: `CUP "${t.cup}" non ha 15 caratteri`, riga: null, campo: 'cup', grave: true })
  if (t.data_contratto && !/^\d{2}\/\d{2}\/\d{4}$/.test(t.data_contratto.trim()))
    w.push({ testo: `data contratto "${t.data_contratto}" non in formato GG/MM/AAAA`, riga: null, campo: 'data_contratto', grave: true })
  if (!t.fornitore) w.push({ testo: 'fornitore mancante', riga: null, campo: 'fornitore', grave: false })
  if (!righe.length) w.push({ testo: 'nessuna riga elenco prezzi estratta', riga: null, grave: true })
  const noFam = anag.filter(x => !x.famiglia).length
  if (noFam) w.push({ testo: `${noFam} articoli senza famiglia: FAM/SFAM da verificare`, riga: null, grave: false })
  return w
}
// CSV: le date Excel tornano stringhe GG/MM/AAAA
export const cellaCsv = (v: CellaImport): string | number =>
  v instanceof Date ? v.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : v

// Scrive l'xlsx Import_Contratti dalle righe fornite.
// Regola ==lista (legenda colonne.xls): ogni colonna con anagrafica — DITTA, PROGETTO,
// EPU, DIVISIONE, COND.PAG, FAM, SFAM — deve contenere ESATTAMENTE un codice del suo
// elenco (SFAM valida solo in COPPIA con la sua FAM). Cella vuota o fuori lista →
// evidenziata in ROSSO (stile Excel "Valore non valido") per la correzione manuale.
// Un elenco non caricato (backend giù / file mancante) disattiva solo la SUA colonna.
// nomeBase/dir servono alla scansione continua: ogni contratto della coda produce il
// PROPRIO xlsx, con il nome del suo file, nella cartella scelta a inizio scansione.
export const scriviImportContrattiXlsx = async (rows: CellaImport[][], nomeBase: string, dir: DirHandle | null | undefined) => {
  const ELENCHI = getElenchi()
  const XLSXS = (await import('xlsx-js-style')).default
  const wb = XLSXS.utils.book_new()
  const ws = XLSXS.utils.aoa_to_sheet([IMPORT_CONTRATTI_COLS, ...rows])
  ws['!cols'] = IMPORT_CONTRATTI_COLS.map(c => ({ wch: Math.max(c.length + 2, 14) }))
  const codici = (lista?: { codice: string | number }[]) =>
    new Set((lista ?? []).map(x => String(x.codice).trim().toUpperCase()))
  const codiciCommesse = codici(ELENCHI?.commesse)
  const codiciDitte = codici(ELENCHI?.ditte)
  const codiciDivisioni = codici(ELENCHI?.divisioni)
  const codiciCondPag = codici(ELENCHI?.condPagamento)
  const fams = ELENCHI?.famiglie ?? []
  const codiciFam = new Set(fams.map(x => x.fam.trim().toUpperCase()))
  const coppieFamSfam = new Set(fams.map(x => `${x.fam.trim().toUpperCase()}|${x.sfam.trim().toUpperCase()}`))
  const COL = { DITTA: 0, PROGETTO: 5, EPU: 6, DIVISIONE: 8, CONDPAG: 13, FAM: 26, SFAM: 27 }
  const validatori: [number, (v: string, r: CellaImport[]) => boolean][] = []
  if (codiciDitte.size) validatori.push([COL.DITTA, v => codiciDitte.has(v)])
  if (codiciCommesse.size) validatori.push([COL.PROGETTO, v => codiciCommesse.has(v)], [COL.EPU, v => codiciCommesse.has(v)])
  if (codiciDivisioni.size) validatori.push([COL.DIVISIONE, v => codiciDivisioni.has(v)])
  if (codiciCondPag.size) validatori.push([COL.CONDPAG, v => codiciCondPag.has(v)])
  if (fams.length) validatori.push(
    [COL.FAM, v => codiciFam.has(v)],
    [COL.SFAM, (v, r) => coppieFamSfam.has(`${String(r[COL.FAM] ?? '').trim().toUpperCase()}|${v}`)],
  )
  rows.forEach((r, i) => {
    for (const [col, valida] of validatori) {
      const v = String(r[col] ?? '').trim().toUpperCase()
      if (v && v !== '!!' && valida(v, r)) continue
      const addr = XLSXS.utils.encode_cell({ r: i + 1, c: col })
      if (!ws[addr]) ws[addr] = { t: 's', v: '' }
      ws[addr].s = { fill: { patternType: 'solid', fgColor: { rgb: 'FFC7CE' } }, font: { color: { rgb: '9C0006' } } }
    }
  })
  XLSXS.utils.book_append_sheet(wb, ws, 'Contratti')
  await salvaFile(
    new Blob([XLSXS.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' }),
    `${nomeBase}_Import_Contratti.xlsx`,
    dir)
}

// Una riga Import_Contratti è "vuota" se contiene solo valori costanti o derivati
// (DITTA, COLL/FIRMATO, importi a 0, RG/RI, PROG.RIGA, NODO) ma nessun dato estratto
// dal contratto → da trattare come fallimento. Indici dei campi "veri":
// codice, descr, progetto, epu, fornitore, data, cond.pag, oggetto, cig, cup,
// articolo, des articolo, um, qta, prezzo, fam, sfam, descr breve/estesa.
export const IDX_DATI_ESTRATTI = [1, 2, 5, 6, 7, 9, 13, 14, 15, 16, 20, 21, 22, 23, 24, 26, 27, 28, 29]
export const rowsHaveData = (rows: CellaImport[][] | null): boolean =>
  !!rows && rows.some(r => IDX_DATI_ESTRATTI.some(i => {
    const v = r[i]
    return v !== '' && v != null && v !== 0 && v !== '!!'
  }))
