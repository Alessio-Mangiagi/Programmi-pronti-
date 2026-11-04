// "><(((º> sabusabu <º)))><"
/**
 * MODULO CONTRATTO: il contratto riscritto a mano in una struttura fissa che il
 * programma legge ALLA LETTERA — niente OCR, niente parser euristici, niente assist AI.
 *
 * Serve quando il documento originale non si lascia leggere (scansione pessima, layout
 * mai visto) o quando i dati arrivano già pronti da un altro ufficio: chi compila
 * scrive i valori nei campi, il programma li copia così come sono nell'Estratto
 * {testata, importi, righe} — lo stesso oggetto che producono i parser dal testo OCR —
 * e da lì la filiera è quella di sempre (anagrafiche, elenchi ufficiali, Excel).
 *
 * Il modulo è testo semplice (.txt / .md) o un Word (.docx) con la stessa struttura:
 *
 *   MODULO CONTRATTO OCR v1          ← riga di riconoscimento, obbligatoria, prima riga
 *   [TESTATA]                        ← campi "ETICHETTA: valore"
 *   [IMPORTI]                        ← campi "ETICHETTA: valore"
 *   [RIGHE]                          ← intestazione colonne + una voce per riga, celle "a | b | c"
 *   [FINE]
 *
 * Le righe che iniziano con "#" sono spiegazioni e vengono ignorate: così il modulo
 * vuoto si spiega da solo e il compilato resta leggibile.
 *
 * Regola di base: il valore si copia com'è (solo gli spazi ai bordi vengono tolti).
 * Quello che il modulo NON accetta lo dice con il numero di riga, e il programma si
 * rifiuta di procedere: meglio un modulo respinto che un valore "aggiustato" in silenzio.
 * Uniche normalizzazioni, dichiarate qui: la tipologia torna alla grafia canonica
 * dell'elenco, la P.IVA perde l'eventuale prefisso "IT", il simbolo "%" in coda alle
 * percentuali viene tolto (l'etichetta lo dice già), i codici RG/RI in maiuscolo.
 *
 * Modulo CONDIVISO fra server (server.ts: route /api/ocr) e browser (App.tsx: scarica il
 * modulo vuoto, riconosce un file modulo in coda): la specifica sta scritta una volta sola.
 * Niente DOM, niente import di node.
 */

export const MODULO_VERSIONE = 'MODULO CONTRATTO OCR v1'

// Stesse etichette canoniche di TIPOLOGIE_VALIDE in server/assist.ts: l'export deriva
// la DIVISIONE da qui (fornitura e posa → 02, subappalto → 03 …).
export const TIPOLOGIE_MODULO = ['Passivo a Misura', 'Subappalto', 'Fornitura e posa', 'Nolo a caldo', 'Nolo a freddo', 'Nolo infragruppo']

type Tipo = 'testo' | 'data' | 'numero' | 'percento' | 'tipologia' | 'cig' | 'cup' | 'piva' | 'rg' | 'ri' | 'divisione'

export interface CampoModulo {
  etichetta: string          // come compare nel modulo
  alias: string[]            // altre grafie accettate (normalizzate con normEtichetta)
  chiave: string             // chiave nell'Estratto (testata.* / importi.*)
  tipo: Tipo
  obbligatorio?: boolean
  aiuto: string              // riga di spiegazione nel modulo vuoto
}

// Chiavi = quelle che leggono strutturaAlyante / buildImportContrattiRowsFromAlyante
// (vedi CAMPI_TESTATA in server/assist.ts e SCHEMA_ESTRATTO in src/lib/claude.ts).
export const CAMPI_TESTATA: CampoModulo[] = [
  { etichetta: 'CODICE CONTRATTO', alias: ['CODICE', 'NUMERO CONTRATTO', 'CONTRATTO'], chiave: 'codice', tipo: 'testo', obbligatorio: true, aiuto: 'Numero o sigla del contratto, come scritto (es. 208-148_042/2026)' },
  { etichetta: 'COMMESSA', alias: ['PROGETTO', 'CODICE PROGETTO', 'CODICE COMMESSA'], chiave: 'codice_progetto', tipo: 'testo', aiuto: 'Codice commessa dell\'elenco RIPARTIZIONE COMMESSE (es. 193-136_6); va in PROGETTO ed EPU' },
  { etichetta: 'DITTA', alias: ['SOCIETA', 'COMMITTENTE'], chiave: 'ditta', tipo: 'testo', aiuto: 'Società del gruppo che stipula (es. COSEDIL S.p.A.); vuoto = COSEDIL S.p.A.' },
  { etichetta: 'FORNITORE', alias: ['CONTROPARTE', 'RAGIONE SOCIALE'], chiave: 'fornitore', tipo: 'testo', aiuto: 'Ragione sociale della controparte (subappaltatore, fornitore, noleggiatore, professionista)' },
  { etichetta: 'PARTITA IVA FORNITORE', alias: ['PARTITA IVA', 'P IVA', 'P IVA FORNITORE', 'PIVA', 'PIVA FORNITORE'], chiave: 'fornitore_piva', tipo: 'piva', aiuto: 'Partita IVA della controparte, 11 cifre: in Alyante il FORNITORE è lei' },
  { etichetta: 'TIPOLOGIA', alias: ['TIPOLOGIA CONTRATTO', 'TIPO CONTRATTO', 'TIPO'], chiave: 'tipologia_contratto', tipo: 'tipologia', obbligatorio: true, aiuto: `Una tra: ${TIPOLOGIE_MODULO.join(' | ')}` },
  { etichetta: 'DATA CONTRATTO', alias: ['DATA', 'DATA STIPULA'], chiave: 'data_contratto', tipo: 'data', obbligatorio: true, aiuto: 'Data di stipula, GG/MM/AAAA' },
  { etichetta: 'DATA DOCUMENTO', alias: ['DT DOC', 'DATA DOC'], chiave: 'documento_data', tipo: 'data', aiuto: 'Data del documento se diversa da quella del contratto, GG/MM/AAAA (di norma vuota)' },
  { etichetta: 'CONDIZIONI DI PAGAMENTO', alias: ['COND PAGAMENTO', 'COND PAG', 'PAGAMENTO', 'CONDIZIONI PAGAMENTO'], chiave: 'cond_pagamento', tipo: 'testo', aiuto: 'Come scritte nel contratto (es. 60 gg DFFM bonifico) oppure il codice dell\'elenco Alyante (es. DA)' },
  { etichetta: 'OGGETTO', alias: ['DESCRIZIONE CONTRATTO', 'DESCR CONTR'], chiave: 'oggetto', tipo: 'testo', obbligatorio: true, aiuto: 'Oggetto del contratto (Art. 2), una riga: va in OGGETTO e DESCR.CONTR' },
  { etichetta: 'CIG', alias: [], chiave: 'cig', tipo: 'cig', aiuto: 'Codice CIG, 10 caratteri (vuoto se assente)' },
  { etichetta: 'CUP', alias: [], chiave: 'cup', tipo: 'cup', aiuto: 'Codice CUP, 15 caratteri (vuoto se assente)' },
  { etichetta: 'DIVISIONE', alias: [], chiave: 'divisione', tipo: 'divisione', aiuto: 'Codice DIVISIONE a 2 cifre dell\'elenco Alyante; vuoto = derivata dalla tipologia' },
]

export const CAMPI_IMPORTI: CampoModulo[] = [
  { etichetta: 'IMPORTO LAVORI', alias: ['IMPORTO CONTRATTO', 'IMPORTO CONTRATTUALE', 'IMPORTO COMPLESSIVO', 'IMPORTO'], chiave: 'importo_lavori', tipo: 'numero', aiuto: 'Importo contrattuale complessivo, IVA esclusa (es. 157.200,00)' },
  { etichetta: 'ONERI SICUREZZA', alias: ['IMPORTO ONERI SICUREZZA', 'ONERI DI SICUREZZA', 'ONERI PER LA SICUREZZA'], chiave: 'importo_oneri_sicurezza', tipo: 'numero', aiuto: 'Oneri della sicurezza (vuoto = 0)' },
  { etichetta: 'IMPORTO NETTO', alias: ['CORRISPETTIVO', 'NETTO'], chiave: 'importo_netto', tipo: 'numero', aiuto: 'Importo netto o corrispettivo (incarichi professionali)' },
  { etichetta: 'ANTICIPO', alias: ['IMPORTO ANTICIPI', 'ANTICIPAZIONE', 'IMPORTO ANTICIPO', 'ACCONTO'], chiave: 'importo_anticipi', tipo: 'numero', aiuto: 'Importo dell\'anticipazione (vuoto = 0)' },
  { etichetta: 'RECUPERO ANTICIPO %', alias: ['RECUPERO ANTICIPO', 'PERCENTUALE RECUPERO', 'RECUPERO ANTIC', '% RECUPERO ANTIC', 'RECUPERO ANTICIPI %'], chiave: 'percent_recupero_anticipazioni', tipo: 'percento', aiuto: 'Percentuale di recupero dell\'anticipo (es. 100); vuoto = 100 se c\'è un anticipo' },
  { etichetta: 'RITENUTA GARANZIA %', alias: ['RITENUTA GARANZIA', 'RITENUTA DI GARANZIA', 'RITENUTA DI GARANZIA %', 'RITENUTA %'], chiave: 'ritenuta_garanzia_percent', tipo: 'percento', aiuto: 'Percentuale di ritenuta di garanzia (es. 5 oppure 5,5): da qui esce RG05 / RG055. Vuoto = nessuna ritenuta' },
  { etichetta: 'CODICE RG', alias: ['RG'], chiave: 'ritenuta_garanzia_codice', tipo: 'rg', aiuto: 'Codice ritenuta di garanzia Alyante se scritto nel contratto (es. RG05); vince sulla percentuale' },
  { etichetta: 'CODICE RI', alias: ['RI'], chiave: 'ritenuta_ingresso_codice', tipo: 'ri', aiuto: 'Codice ritenuta d\'ingresso Alyante se prevista (es. R005)' },
]

export interface ColonnaModulo {
  etichetta: string
  alias: string[]
  chiave: string
  tipo: 'testo' | 'numero'
  obbligatoria: boolean      // deve comparire nell'intestazione
}

// Chiavi = quelle delle righe dell'Estratto (codice_epu, descrizione, udm, quantita,
// prezzo_lordo, importo); conto/famiglia/sottofamiglia sono facoltative e passano agli
// elenchi ufficiali (Piano dei conti, FAM/SFAM) in normalizzaConElenchi.
export const COLONNE_RIGHE: ColonnaModulo[] = [
  { etichetta: 'ARTICOLO', alias: ['CODICE', 'CODICE ARTICOLO', 'TARIFFA', 'COD'], chiave: 'codice_epu', tipo: 'testo', obbligatoria: true },
  { etichetta: 'DESCRIZIONE', alias: ['DES ARTICOLO', 'DESCRIZIONE ARTICOLO', 'VOCE'], chiave: 'descrizione', tipo: 'testo', obbligatoria: true },
  { etichetta: 'UM', alias: ['U M', 'UNITA DI MISURA', 'UNITA MISURA', 'UDM'], chiave: 'udm', tipo: 'testo', obbligatoria: true },
  { etichetta: 'QUANTITA', alias: ['QTA', 'Q TA', 'QUANTITA\'', 'QTY'], chiave: 'quantita', tipo: 'numero', obbligatoria: true },
  { etichetta: 'PREZZO', alias: ['PREZZO UNITARIO', 'P U', 'PU', 'PRZ UNIT', 'PREZZO UNIT'], chiave: 'prezzo_lordo', tipo: 'numero', obbligatoria: true },
  { etichetta: 'IMPORTO', alias: ['IMPORTO TOTALE', 'TOTALE', 'PREZZO TOTALE'], chiave: 'importo', tipo: 'numero', obbligatoria: true },
  { etichetta: 'CONTO', alias: ['VOCE DI SPESA', 'PIANO DEI CONTI'], chiave: 'conto', tipo: 'testo', obbligatoria: false },
  { etichetta: 'FAM', alias: ['FAMIGLIA'], chiave: 'famiglia', tipo: 'testo', obbligatoria: false },
  { etichetta: 'SFAM', alias: ['SOTTOFAMIGLIA', 'SOTTO FAMIGLIA'], chiave: 'sottofamiglia', tipo: 'testo', obbligatoria: false },
]

// Etichette confrontate senza accenti, maiuscole, punteggiatura: "Partita I.V.A. fornitore"
// e "PARTITA IVA FORNITORE" sono la stessa etichetta. I punti si tolgono PRIMA (non
// diventano spazi), altrimenti le sigle puntate ("I.V.A.", "U.M.", "Q.tà") si spezzano
// in lettere sciolte. Il "%" resta perché distingue "RECUPERO ANTICIPO %" da un importo.
export const normEtichetta = (s: string): string => s.toUpperCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/\./g, '').replace(/[^A-Z0-9%]+/g, ' ').trim()

const indice = <T extends { etichetta: string; alias: string[] }>(campi: T[]): Map<string, T> => {
  const m = new Map<string, T>()
  for (const c of campi) for (const e of [c.etichetta, ...c.alias]) m.set(normEtichetta(e), c)
  return m
}
const IDX_TESTATA = indice(CAMPI_TESTATA)
const IDX_IMPORTI = indice(CAMPI_IMPORTI)
const IDX_COLONNE = indice(COLONNE_RIGHE)

// Una riga vale come marcatore anche con la formattazione Markdown attorno
// ("# MODULO CONTRATTO OCR v1", "**MODULO CONTRATTO OCR v1**").
const RE_MARCATORE = /^[#*_\s]*MODULO\s+CONTRATTO\s+OCR\s+v1[*_\s]*$/i
const RE_SEZIONE = /^\[\s*(TESTATA|IMPORTI|RIGHE|FINE)\s*\]$/i
// separatore delle tabelle Markdown ("|---|:--:|"): non è una riga di dati
const RE_SEP_MD = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/
const RE_NUM_IT = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/
const RE_DATA = /^(\d{2})\/(\d{2})\/(\d{4})$/

/** Vero se il testo è un modulo contratto (riga di riconoscimento in testa). */
export const eModulo = (testo: string): boolean => {
  for (const l of testo.split(/\r?\n/)) {
    const t = l.trim()
    if (!t) continue
    return RE_MARCATORE.test(t)
  }
  return false
}

export interface ErroreModulo { riga: number; testo: string }   // riga 0 = modulo nel suo insieme
export interface EstrattoModulo {
  testata: Record<string, string>
  importi: Record<string, string>
  righe: Record<string, string>[]
}
export interface EsitoModulo { estratto: EstrattoModulo; errori: ErroreModulo[] }

// Ritorna il valore accettato, oppure un messaggio d'errore (stringa che inizia con "!").
const validaValore = (v: string, tipo: Tipo | 'testo' | 'numero'): string => {
  switch (tipo) {
    case 'numero':
      return RE_NUM_IT.test(v) ? v : `!"${v}" non è un numero in formato italiano (es. 1.234,56 — punto per le migliaia, virgola per i decimali)`
    case 'percento': {
      const p = v.replace(/\s*%$/, '')
      return /^\d{1,3}(?:,\d{1,2})?$/.test(p) ? p : `!"${v}" non è una percentuale (es. 5 oppure 5,5)`
    }
    case 'data': {
      const m = RE_DATA.exec(v)
      if (!m) return `!data "${v}" non in formato GG/MM/AAAA`
      const g = Number(m[1]), me = Number(m[2]), a = Number(m[3])
      const d = new Date(a, me - 1, g)
      return d.getFullYear() === a && d.getMonth() === me - 1 && d.getDate() === g ? v : `!data "${v}" non esiste`
    }
    case 'tipologia': {
      const canon = TIPOLOGIE_MODULO.find(t => t.toLowerCase() === v.toLowerCase())
      return canon ?? `!tipologia "${v}" non ammessa: una tra ${TIPOLOGIE_MODULO.join(' | ')}`
    }
    case 'cig': return /^[A-Z0-9]{10}$/i.test(v) ? v : `!CIG "${v}" non ha 10 caratteri`
    case 'cup': return /^[A-Z0-9]{15}$/i.test(v) ? v : `!CUP "${v}" non ha 15 caratteri`
    case 'piva': {
      const m = /^(?:IT\s*)?(\d{11})$/i.exec(v.replace(/\s+/g, ''))
      return m ? m[1] : `!partita IVA "${v}" non è di 11 cifre`
    }
    case 'rg': return /^RG\d{2,3}$/i.test(v) ? v.toUpperCase() : `!codice RG "${v}" non ha la forma RG05 / RG055`
    case 'ri': return /^R\d{3}$/i.test(v) ? v.toUpperCase() : `!codice RI "${v}" non ha la forma R005`
    case 'divisione': return /^\d{2}$/.test(v) ? v : `!divisione "${v}" non è un codice a 2 cifre`
    default: return v
  }
}

// Celle di una riga. `bordi` lo decide l'INTESTAZIONE della tabella, non la singola riga:
// in una tabella Markdown ("| a | b |") il pipe ai due bordi è cornice e si toglie; nel
// formato semplice ("a | b | c") un pipe in testa o in coda è una cella VUOTA
// ("| Voce senza codice | corpo | | |" = articolo vuoto, poi descrizione…) e va tenuta,
// altrimenti le colonne slittano. Guardare la riga da sola non basta a distinguerle.
const celle = (l: string, bordi: boolean): string[] => {
  const t = bordi ? l.replace(/^\|/, '').replace(/\|\s*$/, '') : l
  return t.split('|').map(c => c.trim())
}

// "ETICHETTA: valore" oppure "ETICHETTA | valore" (tabella Word a due colonne);
// accettate anche le forme miste "ETICHETTA: | valore" e "valore |" in coda.
const campoDaRiga = (l: string): [string, string] | null => {
  const m = /^([^:|]+?)\s*[:|]\s*(.*)$/.exec(l)
  if (!m) return null
  const valore = m[2].replace(/^\|\s*/, '').replace(/\s*\|$/, '').trim()
  return [m[1].trim(), valore]
}

// Sezione corrente del modulo durante la lettura ('inizio' = prima di qualunque [SEZIONE]).
type Sezione = 'inizio' | 'testata' | 'importi' | 'righe' | 'fine'

const numIt = (s: string): number => parseFloat(s.replace(/\./g, '').replace(',', '.'))
// numero → "1.234,56": scritto apposta perché toLocaleString('it-IT') non mette il punto
// sulle migliaia a quattro cifre ("3360,00"), e il messaggio deve somigliare al modulo
const itStr = (n: number): string => {
  const [int, dec] = Math.abs(n).toFixed(2).split('.')
  return `${n < 0 ? '-' : ''}${int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`
}

/**
 * Modulo compilato → Estratto + elenco degli errori (riga e motivo).
 * Con errori l'Estratto non va usato: la route rifiuta il modulo e li mostra tutti,
 * così si correggono in un giro solo.
 */
export const leggiModulo = (testo: string): EsitoModulo => {
  const errori: ErroreModulo[] = []
  const testata: Record<string, string> = {}
  const importi: Record<string, string> = {}
  const righe: Record<string, string>[] = []
  const err = (riga: number, t: string) => errori.push({ riga, testo: t })

  let sezione: Sezione = 'inizio'
  let marcatore = false
  let colonne: (ColonnaModulo | null)[] | null = null   // intestazione [RIGHE] letta
  let bordi = false                                       // tabella [RIGHE] in Markdown con cornice
  const visti = new Set<string>()
  const errati = new Set<string>()                       // campi presenti ma respinti dalla validazione

  const righeTesto = testo.split(/\r?\n/)
  for (let i = 0; i < righeTesto.length; i++) {
    const n = i + 1
    const l = righeTesto[i].trim()
    if (!l || l.startsWith('#') || l.startsWith('//')) continue
    if (!marcatore) {
      if (RE_MARCATORE.test(l)) { marcatore = true; continue }
      err(n, `la prima riga deve essere "${MODULO_VERSIONE}"`)
      marcatore = true          // segnalato una volta sola, poi si legge il resto
    }
    const sez = RE_SEZIONE.exec(l)
    if (sez) {
      sezione = sez[1].toLowerCase() as Sezione
      if (sezione === 'righe') colonne = null
      continue
    }
    if (sezione === 'fine') { err(n, 'testo dopo [FINE]: va tolto o spostato nella sezione giusta'); continue }
    if (sezione === 'inizio') { err(n, 'riga fuori da ogni sezione: manca [TESTATA], [IMPORTI] o [RIGHE] prima'); continue }

    if (sezione === 'testata' || sezione === 'importi') {
      const campo = campoDaRiga(l)
      if (!campo) { err(n, `"${l.slice(0, 40)}" non è nel formato ETICHETTA: valore`); continue }
      const [etic, valore] = campo
      const idx = sezione === 'testata' ? IDX_TESTATA : IDX_IMPORTI
      const def = idx.get(normEtichetta(etic))
      if (!def) {
        const altrove = (sezione === 'testata' ? IDX_IMPORTI : IDX_TESTATA).get(normEtichetta(etic))
        err(n, altrove
          ? `"${etic}" va nella sezione [${sezione === 'testata' ? 'IMPORTI' : 'TESTATA'}], non in [${sezione.toUpperCase()}]`
          : `etichetta "${etic}" sconosciuta in [${sezione.toUpperCase()}]`)
        continue
      }
      if (visti.has(def.chiave)) { err(n, `"${def.etichetta}" compare due volte`); continue }
      visti.add(def.chiave)
      if (!valore) continue
      const v = validaValore(valore, def.tipo)
      if (v.startsWith('!')) { err(n, `${def.etichetta}: ${v.slice(1)}`); errati.add(def.chiave); continue }
      ;(sezione === 'testata' ? testata : importi)[def.chiave] = v
      continue
    }

    // [RIGHE]
    if (RE_SEP_MD.test(l)) continue
    // intestazione con il pipe in testa = tabella Markdown con cornice (vedi celle())
    if (!colonne) bordi = l.startsWith('|')
    const c = celle(l, bordi)
    if (!colonne) {
      const trovate = c.map(x => (x ? IDX_COLONNE.get(normEtichetta(x)) ?? null : null))
      const sconosciute = c.filter((x, k) => x && !trovate[k])
      if (sconosciute.length || !c.some(Boolean)) {
        err(n, `in [RIGHE] la prima riga deve essere l'intestazione delle colonne (${COLONNE_RIGHE.filter(x => x.obbligatoria).map(x => x.etichetta).join(' | ')})${sconosciute.length ? `: colonne sconosciute ${sconosciute.map(s => `"${s}"`).join(', ')}` : ''}`)
        colonne = COLONNE_RIGHE.slice(0, 6)    // si prosegue con l'ordine standard, per segnalare anche gli errori delle righe
        continue
      }
      const mancanti = COLONNE_RIGHE.filter(x => x.obbligatoria && !trovate.includes(x))
      if (mancanti.length) err(n, `nell'intestazione mancano le colonne ${mancanti.map(x => x.etichetta).join(', ')}`)
      const doppie = trovate.filter((x, k) => x && trovate.indexOf(x) !== k)
      if (doppie.length) err(n, `colonna ripetuta nell'intestazione: ${doppie.map(x => x!.etichetta).join(', ')}`)
      colonne = trovate
      continue
    }
    if (!c.some(Boolean)) continue        // riga di sole celle vuote (modulo vuoto, tabella Word)
    if (c.length !== colonne.length) {
      err(n, `la riga ha ${c.length} celle, l'intestazione ${colonne.length}: ogni voce deve avere lo stesso numero di celle (anche vuote) separate da "|"`)
      continue
    }
    const r: Record<string, string> = { progressivo: '', codice_epu: '', descrizione: '', udm: '', quantita: '', prezzo_lordo: '', importo: '' }
    let ok = true
    c.forEach((v, k) => {
      const col = colonne![k]
      if (!col || !v) return
      const val = validaValore(v, col.tipo)
      if (val.startsWith('!')) { err(n, `${col.etichetta}: ${val.slice(1)}`); ok = false; return }
      r[col.chiave] = val
    })
    if (!ok) continue
    if (!r.descrizione && !r.codice_epu) { err(n, 'voce senza ARTICOLO né DESCRIZIONE'); continue }
    // L'importo è l'unica colonna verificabile: se c'è deve essere quantità × prezzo
    // (1% di tolleranza per gli arrotondamenti dei prezzari).
    if (r.quantita && r.prezzo_lordo && r.importo) {
      const q = numIt(r.quantita), p = numIt(r.prezzo_lordo), im = numIt(r.importo)
      if (im !== 0 && Math.abs(q * p - im) / Math.abs(im) > 0.01) {
        err(n, `IMPORTO ${r.importo} ≠ QUANTITA × PREZZO (${itStr(q * p)})`)
        continue
      }
    }
    r.udm = r.udm.toLowerCase()
    r.progressivo = String(righe.length + 1)
    righe.push(r)
  }

  if (!marcatore) err(0, `modulo vuoto: manca la riga "${MODULO_VERSIONE}"`)
  for (const def of CAMPI_TESTATA) {
    // un obbligatorio scritto ma fuori formato è già segnalato sulla sua riga: non anche "manca"
    if (def.obbligatorio && !testata[def.chiave] && !errati.has(def.chiave)) err(0, `manca ${def.etichetta} (obbligatorio)`)
  }
  if (!testata.fornitore && !testata.fornitore_piva && !errati.has('fornitore_piva')) err(0, 'manca il FORNITORE (ragione sociale o partita IVA, almeno uno)')
  // la maschera che ha lavorato, come famigliaContratto() per i contratti letti dal
  // testo: in revisione si vede subito che i dati vengono dal modulo
  testata.famiglia_contratto = 'modulo'

  // in ordine di riga, come si correggono scorrendo il file; quelli del modulo nel suo
  // insieme (riga 0: obbligatori mancanti) in fondo
  errori.sort((a, b) => (a.riga || Infinity) - (b.riga || Infinity))
  return { estratto: { testata, importi, righe }, errori }
}

/** Errori → testo per l'utente (uno per riga, con il numero di riga del modulo). */
export const descriviErrori = (errori: ErroreModulo[]): string =>
  errori.map(e => (e.riga ? `riga ${e.riga}: ${e.testo}` : e.testo)).join('\n')

// ── Modulo vuoto ────────────────────────────────────────────────────────────

const RIGA_ESEMPIO = 'B.03.025.a | Conglomerato cementizio C25/30 per fondazioni | mc | 120,00 | 95,50 | 11.460,00'

/**
 * Il modulo vuoto, generato dalla stessa specifica che lo legge: un campo aggiunto qui
 * sopra compare da solo nel modulo. Le righe "#" sono le spiegazioni.
 */
export const moduloVuoto = (): string => {
  const out: string[] = [
    MODULO_VERSIONE,
    '# Compila i valori dopo i due punti. Le righe che iniziano con # sono spiegazioni',
    '# e vengono ignorate. Lascia vuoto ciò che il contratto non riporta: niente inventato.',
    '# Numeri in formato italiano (1.234,56), date GG/MM/AAAA. Il programma legge i valori',
    '# alla lettera e si ferma, indicando la riga, se qualcosa non è nel formato atteso.',
    '',
    '[TESTATA]',
  ]
  const campi = (lista: CampoModulo[]) => {
    for (const c of lista) {
      out.push(`# ${c.aiuto}${c.obbligatorio ? ' — OBBLIGATORIO' : ''}`)
      out.push(`${c.etichetta}: `)
    }
  }
  campi(CAMPI_TESTATA)
  out.push('', '[IMPORTI]')
  campi(CAMPI_IMPORTI)
  out.push(
    '',
    '[RIGHE]',
    '# Elenco prezzi: una voce per riga, celle separate da " | " nell\'ordine dell\'intestazione,',
    '# anche quando una cella è vuota. Colonne facoltative in coda: CONTO | FAM | SFAM.',
    `# Esempio: ${RIGA_ESEMPIO}`,
    COLONNE_RIGHE.filter(c => c.obbligatoria).map(c => c.etichetta).join(' | '),
    '',
    '[FINE]',
    '',
  )
  return out.join('\n')
}

export const NOME_FILE_MODULO = 'Modulo_contratto_OCR'
