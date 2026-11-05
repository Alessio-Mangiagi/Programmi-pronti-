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
// segno meno ammesso: negli elenchi prezzi ci sono detrazioni e sconti a importo negativo
const RE_NUM_IT = /^-?(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d+)?$/
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

// riga 0 = modulo nel suo insieme. `letta`: il testo della riga, solo per un modulo
// impaginato (PDF, scansione) — lì il numero di riga è quello del testo estratto, che
// l'utente non vede: per trovare la voce da correggere serve sapere che cosa c'era scritto.
export interface ErroreModulo { riga: number; testo: string; letta?: string }
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

// Unione di un pezzo andato a capo: la stampa va a capo DOPO un trattino attaccato
// ("Ticopter-" + "Sistra", "CEI 92-" + "1") e lì si riattacca senza spazio; un trattino
// staccato ("A -") e tutto il resto si riuniscono con uno spazio.
const unisciACapo = (a: string, b: string): string => (/\S-$/.test(a) ? a + b : `${a} ${b}`)

/**
 * MODULO IMPAGINATO (PDF stampato dal computer o scansione di un modulo stampato): le
 * righe lunghe vanno a capo e il testo estratto arriva spezzato — l'OGGETTO su tre righe,
 * la DESCRIZIONE di una voce sotto la riga con le celle. Qui si ricuciono:
 * - in [TESTATA]/[IMPORTI] una riga che non è "ETICHETTA: valore" con un'etichetta
 *   conosciuta continua il campo precedente;
 * - in [RIGHE] una riga senza "|" continua la DESCRIZIONE della voce precedente (nella
 *   pagina le altre celle stanno su una riga sola, è la descrizione che va a capo) —
 *   a meno che non finisca con quantità, prezzo e importo che tornano: allora è una
 *   voce a cui la scansione ha mangiato tutti i "|" (vedi voceRicostruita);
 * - l'intestazione delle colonne RIPETUTA in cima a ogni pagina (la stampa delle tabelle
 *   lunghe la ripete) sparisce: letta come voce sarebbe tutta fuori formato;
 * - le righe di soli trattini (separatore di pagina "---" dell'app) spariscono.
 * Ritorna lo STESSO numero di righe: la riga ricucita resta al posto della prima e le
 * continuazioni diventano vuote, così i numeri di riga degli errori restano quelli del
 * testo letto. Le continuazioni di una voce NON entrano nella riga ma in `seguiti`
 * (indice della voce → testo): se la scansione ha perso un "|" non si sa quale cella è
 * la descrizione finché la voce non è letta, e attaccarle alla cella sbagliata rovinava
 * proprio i numeri. leggiModulo le aggiunge alla DESCRIZIONE della voce letta.
 * Una continuazione dopo una nota "#" non si attacca a niente e resta errore: meglio
 * respinta che appesa al campo sbagliato.
 * Solo su richiesta (`aCapo`): in un .txt scritto a mano una riga senza etichetta o senza
 * "|" è un errore di battitura da segnalare, non un a capo.
 */
const ricuciACapo = (righe: string[]): { righe: string[]; seguiti: Map<number, string> } => {
  const out = [...righe]
  const seguiti = new Map<number, string>()
  let sezione: Sezione = 'inizio'
  let ultima = -1               // indice della riga che una continuazione allunga
  let intestazione = false      // intestazione di [RIGHE] già letta
  let bordi = false
  let colonne: (ColonnaModulo | null)[] = []
  let chiaveIntestazione = ''   // l'intestazione normalizzata, per riconoscerla ripetuta
  const chiaveCelle = (l: string) => celleIntestazione(l, l.startsWith('|'), true).map(normEtichetta).join('|')
  for (let i = 0; i < out.length; i++) {
    const l = out[i].trim()
    if (!l) continue
    if (/^-{3,}$/.test(l)) { out[i] = ''; continue }
    if (l.startsWith('#') || l.startsWith('//')) { ultima = -1; continue }
    if (RE_MARCATORE.test(l)) continue
    const sez = RE_SEZIONE.exec(l)
    if (sez) {
      sezione = sez[1].toLowerCase() as Sezione
      ultima = -1
      if (sezione === 'righe') intestazione = false
      continue
    }
    if (sezione === 'testata' || sezione === 'importi') {
      const campo = campoDaRiga(l)
      const conosciuta = campo && (IDX_TESTATA.has(normEtichetta(campo[0])) || IDX_IMPORTI.has(normEtichetta(campo[0])))
      if (conosciuta) ultima = i
      else if (ultima >= 0) { out[ultima] = unisciACapo(out[ultima].trim(), l); out[i] = '' }
      continue
    }
    if (sezione !== 'righe' || RE_SEP_MD.test(l)) continue
    if (!intestazione) {
      intestazione = true
      bordi = l.startsWith('|')
      colonne = celleIntestazione(l, bordi, true).map(x => IDX_COLONNE.get(normEtichetta(x)) ?? null)
      chiaveIntestazione = chiaveCelle(l)
      continue
    }
    if (l.includes('|') && chiaveCelle(l) === chiaveIntestazione) { out[i] = ''; ultima = -1; continue }
    if (l.includes('|') || voceRicostruita(l, colonne, bordi)) { ultima = i; continue }
    if (ultima >= 0) {
      const prima = seguiti.get(ultima)
      seguiti.set(ultima, prima ? unisciACapo(prima, l) : l)
      out[i] = ''
    }
  }
  return { righe: out, seguiti }
}

// Celle dell'intestazione di [RIGHE]. In un modulo impaginato (scansione) un "|" fra due
// etichette può sparire ("UM QUANTITA"): una cella che non è un'etichetta ma è fatta solo
// di etichette di una parola si divide. Nel .txt scritto a mano resta un errore.
const celleIntestazione = (l: string, bordi: boolean, aCapo: boolean): string[] =>
  celle(l, bordi).flatMap(x => {
    if (!aCapo || !x || IDX_COLONNE.has(normEtichetta(x))) return [x]
    const parti = x.split(/\s+/)
    return parti.length > 1 && parti.every(p => IDX_COLONNE.has(normEtichetta(p))) ? parti : [x]
  })

const VOCE_VUOTA = (): Record<string, string> => ({ progressivo: '', codice_epu: '', descrizione: '', udm: '', quantita: '', prezzo_lordo: '', importo: '' })

// L'importo è l'unica colonna verificabile: se c'è deve essere quantità × prezzo
// (1% di tolleranza per gli arrotondamenti dei prezzari).
const importoTorna = (q: number, p: number, im: number): boolean => im === 0 || Math.abs(q * p - im) / Math.abs(im) <= 0.01

/**
 * Celle di una voce di [RIGHE] → voce, oppure gli errori che la respingono (senza numero
 * di riga: lo aggiunge il chiamante). È la lettura ALLA LETTERA, cella per cella.
 */
const voceDaCelle = (c: string[], colonne: (ColonnaModulo | null)[]): { voce?: Record<string, string>; errori: string[] } => {
  if (c.length !== colonne.length) {
    return { errori: [`la riga ha ${c.length} celle, l'intestazione ${colonne.length}: ogni voce deve avere lo stesso numero di celle (anche vuote) separate da "|"`] }
  }
  const r = VOCE_VUOTA()
  const errori: string[] = []
  c.forEach((v, k) => {
    const col = colonne[k]
    if (!col || !v) return
    const val = validaValore(v, col.tipo)
    if (val.startsWith('!')) errori.push(`${col.etichetta}: ${val.slice(1)}`)
    else r[col.chiave] = val
  })
  if (errori.length) return { errori }
  if (!r.descrizione && !r.codice_epu) return { errori: ['voce senza ARTICOLO né DESCRIZIONE'] }
  if (r.quantita && r.prezzo_lordo && r.importo && !importoTorna(numIt(r.quantita), numIt(r.prezzo_lordo), numIt(r.importo))) {
    return { errori: [`IMPORTO ${r.importo} ≠ QUANTITA × PREZZO (${itStr(numIt(r.quantita) * numIt(r.prezzo_lordo))})`] }
  }
  r.udm = r.udm.toLowerCase()
  return { voce: r, errori: [] }
}

// Le sei colonne obbligatorie nell'ordine del modulo: la ricostruzione sa leggere solo questa forma.
const ORDINE_STANDARD = ['codice_epu', 'descrizione', 'udm', 'quantita', 'prezzo_lordo', 'importo'].join()
// Un codice articolo ha almeno una cifra, un punto o un "_" ("B.07.115.A", "NPYY_G.03.030.a"):
// una parola qualunque in testa alla riga è l'inizio della descrizione di una voce senza codice.
const RE_CODICE = /^[^\s|]*[\d._][^\s|]*$/

/**
 * Voce di una SCANSIONE di modulo stampato che la lettura cella per cella respinge: l'OCR
 * ha perso un "|" ("bordo ml 295,00") o l'ha letto come "1" ("| 1 120,00"). Si ricostruisce
 * dalla coda, che ha la forma più rigida:
 * - in fondo alla riga c'è una sequenza di numeri: l'ultimo è l'IMPORTO, e QUANTITA e
 *   PREZZO sono la coppia di numeri prima di lui con quantità × prezzo = importo (1%).
 *   È questo controllo a rendere sicura la ricostruzione: senza importo, o se nessuna
 *   coppia torna, la voce resta respinta con gli errori della lettura alla lettera;
 * - prima dei numeri c'è l'UM (l'ultima cella, o l'ultima parola se il "|" è sparito);
 * - in testa il codice (prima parola, se ha la forma di un codice) e poi la descrizione.
 * Solo con le sei colonne standard nell'ordine del modulo; altrimenti null.
 */
const voceRicostruita = (l: string, colonne: (ColonnaModulo | null)[], bordi: boolean): Record<string, string> | null => {
  if (colonne.map(c => c?.chiave).join() !== ORDINE_STANDARD) return null
  const riga = bordi ? l.replace(/^\|/, '').replace(/\|\s*$/, '') : l
  const tok = riga.split(/(\|)|\s+/).filter((t): t is string => !!t)
  // coda numerica: numeri (e "|") dalla fine fino alla prima parola
  const num: number[] = []                 // indici in tok
  let k = tok.length
  while (k > 0 && (tok[k - 1] === '|' || RE_NUM_IT.test(tok[k - 1]))) {
    k--
    if (tok[k] !== '|') num.unshift(k)
  }
  if (num.length < 3) return null
  const im = numIt(tok[num[num.length - 1]])
  if (!im) return null
  let coppia: [number, number] | null = null
  for (let b = num.length - 2; b >= 1 && !coppia; b--) {
    for (let a = b - 1; a >= 0; a--) {
      if (importoTorna(numIt(tok[num[a]]), numIt(tok[num[b]]), im)) { coppia = [num[a], num[b]]; break }
    }
  }
  if (!coppia) return null
  // tutto ciò che sta prima della quantità è codice, descrizione e UM
  const celleTesta = tok.slice(0, coppia[0]).join(' ').split('|').map(x => x.trim())
  while (celleTesta.length && !celleTesta[celleTesta.length - 1]) celleTesta.pop()
  if (celleTesta.length < 2 && !(celleTesta[0] ?? '').includes(' ')) return null
  let um = celleTesta.pop()!
  if (um.split(' ').length > 2 || um.length > 12) {     // "|" prima dell'UM sparito
    const parole = um.split(' ')
    um = parole.pop()!
    celleTesta.push(parole.join(' '))
  }
  um = um.replace(/^[^\p{L}\d]+|[^\p{L}\d²³]+$/gu, '')
  const senzaCodice = celleTesta[0] === ''              // "| descrizione | …": articolo vuoto
  const testa = celleTesta.filter(Boolean)
  const prime = (testa[0] ?? '').split(' ')
  const codice = !senzaCodice && RE_CODICE.test(prime[0]) ? prime.shift()! : ''
  const descrizione = [prime.join(' '), ...testa.slice(1)].filter(Boolean).join(' ')
  if (!um || (!codice && !descrizione)) return null
  // `ricostruita`: i numeri li conferma l'aritmetica, la divisione fra codice, descrizione
  // e UM l'ha decisa questa funzione. L'interfaccia lo dice con un'etichetta (App.tsx,
  // calcolaEsito) ma NON la conta fra le righe da rivedere: sui 5 contratti di prova le
  // 64 voci ricostruite di GFM erano tutte giuste, e 64 falsi allarmi nascondono quelli
  // veri. L'export Excel ignora la chiave.
  return { ...VOCE_VUOTA(), codice_epu: codice, descrizione, udm: um.toLowerCase(), quantita: tok[coppia[0]], prezzo_lordo: tok[coppia[1]], importo: tok[num[num.length - 1]], ricostruita: 'scansione' }
}

export interface OpzioniLettura {
  aCapo?: boolean    // testo da un documento impaginato (PDF, scansione): vedi ricuciACapo
}

/**
 * Modulo compilato → Estratto + elenco degli errori (riga e motivo).
 * Con errori l'Estratto non va usato: la route rifiuta il modulo e li mostra tutti,
 * così si correggono in un giro solo.
 */
export const leggiModulo = (testo: string, opz: OpzioniLettura = {}): EsitoModulo => {
  const errori: ErroreModulo[] = []
  const testata: Record<string, string> = {}
  const importi: Record<string, string> = {}
  const righe: Record<string, string>[] = []
  const err = (riga: number, t: string) => {
    const letta = opz.aCapo && riga ? righeTesto[riga - 1]?.trim() : ''
    // riga lunga: inizio (il codice, per trovare la voce) e fine (le celle, dove di solito
    // sta il problema), il centro della descrizione si può saltare
    errori.push(letta ? { riga, testo: t, letta: letta.length > 100 ? `${letta.slice(0, 50)} … ${letta.slice(-45)}` : letta } : { riga, testo: t })
  }

  let sezione: Sezione = 'inizio'
  let marcatore = false
  let colonne: (ColonnaModulo | null)[] | null = null   // intestazione [RIGHE] letta
  let bordi = false                                       // tabella [RIGHE] in Markdown con cornice
  const visti = new Set<string>()
  const errati = new Set<string>()                       // campi presenti ma respinti dalla validazione

  const divise = testo.split(/\r?\n/)
  const { righe: righeTesto, seguiti } = opz.aCapo ? ricuciACapo(divise) : { righe: divise, seguiti: new Map<number, string>() }
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
    const c: string[] = colonne ? celle(l, bordi) : celleIntestazione(l, bordi, !!opz.aCapo)
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
    const letta = voceDaCelle(c, colonne)
    // Modulo impaginato: nella scansione il "|" a volte sparisce o diventa un "1".
    // Si riprova a ricostruire la voce, accettata solo se l'aritmetica la conferma.
    const r = letta.voce ?? (opz.aCapo ? voceRicostruita(l, colonne, bordi) : null)
    if (!r) { for (const t of letta.errori) err(n, t); continue }
    const seguito = seguiti.get(i)            // descrizione andata a capo (ricuciACapo)
    if (seguito) r.descrizione = r.descrizione ? unisciACapo(r.descrizione, seguito) : seguito
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
  errori.map(e => (!e.riga ? e.testo : e.letta ? `riga ${e.riga} «${e.letta}»: ${e.testo}` : `riga ${e.riga}: ${e.testo}`)).join('\n')

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

// ── Documento → modulo ──────────────────────────────────────────────────────
//
// Il giro inverso del lettore: il risultato che il programma ha già estratto da un
// documento qualsiasi (PDF, scansione, Word: JSON formato ALYANTE, anche corretto a
// mano in revisione) viene riscritto come MODULO CONTRATTO compilato. Il modulo poi si
// rilegge alla lettera, senza OCR né euristiche: è la copia "pulita" del contratto,
// da archiviare, far controllare o ricaricare quando il documento originale dà noie.
//
// Regole della conversione:
// - i valori si riscrivono come letti; cambia solo la FORMA quando il modulo la chiede
//   (numeri all'italiana, date GG/MM/AAAA, spazi e a-capo ridotti a uno spazio);
// - un valore che il modulo non accetterebbe NON si aggiusta: il campo resta vuoto e il
//   valore letto finisce in una riga "# DA VERIFICARE" subito sopra, così non si perde;
// - una voce con IMPORTO ≠ QUANTITA × PREZZO resta com'è, segnata "# DA VERIFICARE":
//   quale dei tre numeri sia sbagliato lo decide chi ha il documento davanti;
// - alla fine il modulo prodotto passa da leggiModulo: gli `errori` dicono esattamente
//   cosa il programma rifiuterebbe ricaricandolo (vuoto = si rilegge senza problemi).

/** Esito di moduloDaRisultato: il modulo, i punti da verificare, il controllo finale. */
export interface EsitoConversione {
  testo: string               // il modulo compilato, pronto da salvare come .txt
  avvisi: ErroreModulo[]      // valori non riportabili così come letti (riga del modulo e motivo)
  errori: ErroreModulo[]      // cosa leggiModulo rifiuterebbe nel modulo prodotto
}

export interface OpzioniConversione {
  origine?: string            // nome del documento di partenza, scritto in testa al modulo
  generato?: string           // data della conversione (la passa il chiamante: funzione pura)
}

// Chiavi del risultato che il modulo non riporta perché le ricava il programma:
// elenco_prezzi = commessa (regola maschera), famiglia_contratto = maschera che ha
// lavorato, ditta_codice = codice DITTA dall'elenco, campi_assist_ai = diagnostica.
const CHIAVI_DERIVATE = new Set(['famiglia_contratto', 'elenco_prezzi', 'ditta_codice', 'campi_assist_ai', 'progressivo'])

const unaRiga = (v: unknown): string => (v == null ? '' : String(v)).replace(/\s+/g, ' ').trim()

/**
 * Numero letto → forma del modulo ("1.234,56"). Accetta la forma italiana (lasciata
 * com'è), quella inglese ("1,234.56", "157200.00") e i number di JSON. Toglie €, spazi
 * e apostrofi delle migliaia. '' = vuoto, null = non è un numero.
 * "12.500" resta "12.500" (dodicimilacinquecento, come in un contratto italiano).
 */
export const numeroPerModulo = (v: unknown): string | null => {
  if (typeof v === 'number') return isFinite(v) ? String(v).replace('.', ',') : null
  let s = unaRiga(v).replace(/[€\s']/g, '').replace(/^\+/, '')
  if (!s) return ''
  const meno = s.startsWith('-') ? '-' : ''
  if (meno) s = s.slice(1)
  if (RE_NUM_IT.test(s)) return meno + s
  // inglese con migliaia: "1,234.56" → "1.234,56"
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) return meno + s.replace(/,/g, '§').replace('.', ',').replace(/§/g, '.')
  // punto decimale: "157200.00" → "157200,00" (le migliaia col punto le ha già prese RE_NUM_IT)
  if (/^\d+\.\d+$/.test(s)) return meno + s.replace('.', ',')
  return null
}

// Data letta → GG/MM/AAAA. Accetta G/M/AAAA, separatori "-" e ".", anno a 2 cifre
// (20xx) e la forma ISO AAAA-MM-GG. La validità del giorno la controlla validaValore.
const dataPerModulo = (v: unknown): string | null => {
  const s = unaRiga(v)
  if (!s) return ''
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})$/.exec(s)
  if (m) return `${m[1].padStart(2, '0')}/${m[2].padStart(2, '0')}/${m[3].length === 2 ? `20${m[3]}` : m[3]}`
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s)
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  return null
}

// Valore letto → forma del modulo, per tipo di campo. null = forma non riconosciuta.
const formaPerModulo = (v: unknown, tipo: Tipo | 'testo' | 'numero'): string | null => {
  switch (tipo) {
    case 'numero': return numeroPerModulo(v)
    case 'data': return dataPerModulo(v)
    case 'percento': {
      const s = unaRiga(v).replace(/\s*%$/, '')
      return s ? numeroPerModulo(s) : ''
    }
    case 'divisione': {
      const s = unaRiga(v)
      return /^\d$/.test(s) ? `0${s}` : s          // "3" → "03": la divisione è un codice a 2 cifre
    }
    // codici: gli spazi in mezzo sono quasi sempre un artefatto di lettura ("IT 0123…")
    case 'cig': case 'cup': case 'piva': case 'rg': case 'ri':
      return unaRiga(v).replace(/\s+/g, '')
    default: return unaRiga(v)
  }
}

// Il "|" è il separatore del modulo: dentro un valore spezzerebbe la riga in due celle.
const senzaPipe = (s: string): [string, boolean] => (s.includes('|') ? [s.replace(/\|/g, '/'), true] : [s, false])

type RisultatoUnito = {
  testata: Record<string, unknown>
  importi: Record<string, unknown>
  righe: Record<string, unknown>[]
  anagrafiche: Record<string, unknown>[]
}

// Risultato JSON (stringa o oggetto; array = più pagine) → un oggetto solo, come fa
// parseAlyante in import-contratti.ts: testata/importi dal primo che li ha, righe e
// anagrafiche in fila.
const unisciRisultato = (r: unknown): RisultatoUnito => {
  const parsed: unknown = typeof r === 'string' ? JSON.parse(r) : r
  const pagine = (Array.isArray(parsed) ? parsed : [parsed]) as unknown[]
  const out: RisultatoUnito = { testata: {}, importi: {}, righe: [], anagrafiche: [] }
  const oggetto = (o: unknown) => (o && typeof o === 'object' && !Array.isArray(o) ? (o as Record<string, unknown>) : {})
  for (const pag of pagine) {
    const p = oggetto(pag)
    for (const [k, v] of Object.entries(oggetto(p.testata))) if (unaRiga(v) && !unaRiga(out.testata[k])) out.testata[k] = v
    for (const [k, v] of Object.entries(oggetto(p.importi))) if (unaRiga(v) && !unaRiga(out.importi[k])) out.importi[k] = v
    if (Array.isArray(p.righe)) out.righe.push(...p.righe.map(oggetto))
    if (Array.isArray(p.anagrafiche_articoli)) out.anagrafiche.push(...p.anagrafiche_articoli.map(oggetto))
  }
  return out
}

/**
 * Risultato estratto da un documento (JSON formato ALYANTE: {testata, importi, righe,
 * anagrafiche_articoli}, stringa o oggetto) → MODULO CONTRATTO compilato.
 * Solleva un Error se il risultato non è JSON o non contiene alcun dato.
 */
export const moduloDaRisultato = (risultato: unknown, opz: OpzioniConversione = {}): EsitoConversione => {
  let r: RisultatoUnito
  try { r = unisciRisultato(risultato) } catch { throw new Error('il risultato non è JSON: serve quello del formato IMPORT P6 (Alyante)') }
  if (!Object.keys(r.testata).length && !Object.keys(r.importi).length && !r.righe.length) {
    throw new Error('nessun dato estratto da riportare nel modulo')
  }

  const out: string[] = [MODULO_VERSIONE]
  const avvisi: ErroreModulo[] = []
  // l'avviso segue il commento "# DA VERIFICARE" che lo spiega: il numero di riga vero
  // (quella del campo o della voce) si fissa in fondo, a modulo finito
  const daVerificare = (testo: string) => {
    out.push(`# DA VERIFICARE: ${testo}`)
    avvisi.push({ riga: out.length, testo })
  }

  out.push(
    `# Modulo compilato dal programma${opz.origine ? ` leggendo "${unaRiga(opz.origine)}"` : ''}${opz.generato ? ` il ${unaRiga(opz.generato)}` : ''}.`,
    '# Controlla i valori col documento originale e correggi qui: il programma rilegge il',
    '# modulo alla lettera. Le righe "# DA VERIFICARE" segnano ciò che non è stato possibile',
    '# riportare così come letto (valore fuori formato, conti che non tornano).',
    '# Le righe che iniziano con # sono spiegazioni e vengono ignorate.',
    '',
  )

  // ── campi di testata e importi
  const campi = (lista: CampoModulo[], valori: Record<string, unknown>) => {
    for (const c of lista) {
      out.push(`# ${c.aiuto}${c.obbligatorio ? ' — OBBLIGATORIO' : ''}`)
      const letto = valori[c.chiave]
      const forma = formaPerModulo(letto, c.tipo)
      let valore = ''
      let segnalato = false
      if (forma === null) { daVerificare(`${c.etichetta}: letto "${unaRiga(letto)}", non è nella forma richiesta`); segnalato = true }
      else if (forma) {
        const ok = validaValore(forma, c.tipo)
        if (ok.startsWith('!')) { daVerificare(`${c.etichetta}: ${ok.slice(1)}`); segnalato = true }
        else {
          const [v, tolto] = senzaPipe(ok)
          if (tolto) daVerificare(`${c.etichetta}: il carattere "|" è stato sostituito con "/"`)
          valore = v
        }
      }
      if (!valore && c.obbligatorio && !segnalato) daVerificare(`${c.etichetta} non trovato nel documento: va compilato`)
      out.push(`${c.etichetta}: ${valore}`)
    }
  }
  out.push('[TESTATA]')
  campi(CAMPI_TESTATA, r.testata)
  out.push('', '[IMPORTI]')
  campi(CAMPI_IMPORTI, r.importi)

  // valori estratti che il modulo non ha dove mettere: in commento, non persi in silenzio
  const previste = new Set([...CAMPI_TESTATA, ...CAMPI_IMPORTI].map(c => c.chiave))
  const extra = [...Object.entries(r.testata), ...Object.entries(r.importi)]
    .filter(([k, v]) => !previste.has(k) && !CHIAVI_DERIVATE.has(k) && unaRiga(v))
  if (extra.length) {
    out.push('# Altri valori letti dal documento che il modulo non prevede (solo promemoria):')
    for (const [k, v] of extra) out.push(`#   ${k}: ${unaRiga(v)}`)
  }

  // ── righe dell'elenco prezzi
  // FAM/SFAM stanno nelle anagrafiche, una per codice articolo (o descrizione se manca il
  // codice: stessa chiave che usa strutturaAlyante quando le crea)
  const anag = new Map<string, Record<string, unknown>>()
  for (const a of r.anagrafiche) {
    const k = unaRiga(a.codice_articolo) || unaRiga(a.descrizione)
    if (k && !anag.has(k)) anag.set(k, a)
  }
  const valoreColonna = (riga: Record<string, unknown>, chiave: string): unknown => {
    if (chiave !== 'famiglia' && chiave !== 'sottofamiglia') return riga[chiave]
    return riga[chiave] ?? anag.get(unaRiga(riga.codice_epu) || unaRiga(riga.descrizione))?.[chiave]
  }
  // colonne facoltative solo se almeno una voce le usa: il modulo resta leggibile
  const colonne = COLONNE_RIGHE.filter(c => c.obbligatoria || r.righe.some(x => unaRiga(valoreColonna(x, c.chiave))))

  out.push(
    '',
    '[RIGHE]',
    '# Elenco prezzi: una voce per riga, celle separate da "|", anche quando sono vuote.',
    // tabella Markdown con cornice: una voce non inizia mai con "#" (sarebbe un commento)
    // anche se il codice articolo lo fa, e il file si vede come tabella negli editor
    `| ${colonne.map(c => c.etichetta).join(' | ')} |`,
    `|${colonne.map(() => '---').join('|')}|`,
  )
  r.righe.forEach((riga, k) => {
    const voce = `voce ${k + 1}${unaRiga(riga.codice_epu) ? ` (${unaRiga(riga.codice_epu)})` : ''}`
    const note: string[] = []
    const valori: Record<string, string> = {}
    const celleRiga = colonne.map(c => {
      const letto = valoreColonna(riga, c.chiave)
      const forma = formaPerModulo(letto, c.tipo)
      if (forma === null) { note.push(`${c.etichetta} letto "${unaRiga(letto)}" non è un numero: cella lasciata vuota`); return '' }
      const [v, tolto] = senzaPipe(forma)
      if (tolto) note.push(`in ${c.etichetta} il carattere "|" è stato sostituito con "/"`)
      valori[c.chiave] = v
      return v
    })
    if (!valori.codice_epu && !valori.descrizione) {
      // senza articolo né descrizione il lettore la rifiuterebbe: resta in commento
      daVerificare(`${voce} senza articolo né descrizione, tenuta qui sotto in commento: completala e togli il "#"`)
      out.push(`# | ${celleRiga.join(' | ')} |`)
      return
    }
    const { quantita: q, prezzo_lordo: p, importo: im } = valori
    if (q && p && im) {
      const qn = numIt(q), pn = numIt(p), imn = numIt(im)
      if (imn !== 0 && Math.abs(qn * pn - imn) / Math.abs(imn) > 0.01) {
        note.push(`IMPORTO ${im} ≠ QUANTITA × PREZZO (${itStr(qn * pn)}): correggi il valore sbagliato`)
      }
    }
    for (const n of note) daVerificare(`${voce}: ${n}`)
    out.push(`| ${celleRiga.join(' | ')} |`)
  })
  out.push('', '[FINE]', '')

  // ogni avviso punta alla prima riga NON di commento dopo il suo "# DA VERIFICARE":
  // il campo o la voce da correggere (la voce in commento punta a sé stessa)
  for (const a of avvisi) {
    let n = a.riga + 1
    while (n <= out.length && out[n - 1].startsWith('#') && !out[n - 1].startsWith('# |')) n++
    a.riga = n
  }
  const testo = out.join('\n')
  return { testo, avvisi, errori: leggiModulo(testo).errori }
}
