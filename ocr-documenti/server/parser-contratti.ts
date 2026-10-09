// Parser deterministici del contratto: testata, importi, elenco prezzi (più
// maschere), famiglia di contratto. Tutto regex + euristiche, niente LLM.
import { DBG_FORN } from './config.ts'
import { normalizzaNumeriOcr } from './testo.ts'
import { ELENCHI } from './alyante.ts'
import { normDitta } from '../src/lib/elenchi.ts'

export { normDitta }

// Numero italiano: "1.234,56" · "12,50" · "151.000"
export const NUM_SRC = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d{1,3})?|\d+,\d{1,3}|\d+`
// dm2/dm3 SOLO con l'esponente: il "dm" nudo non entra perché nei contratti "D.M. 2"
// (decreto ministeriale) è frequentissimo e diventerebbe una falsa unità di misura.
// Per lo stesso motivo restano fuori km (marcatore chilometrico ANAS "KM 1+200"),
// cm e mm (compaiono nelle descrizioni: "500x500 mm").
export const UM_SRC = String.raw`kg|mqxcm|mcxcm|mc|mq|ml|m[23²³]|dm[23²³]|m|cad|ton|t|nr|n°|pz|corpo|ac|h|ore|lt|l|gg|q\.?li`

// Toglie dalla descrizione articolo i residui delle colonne valori che l'OCR
// può mescolare al testo: sotto-prezzi "0,575 €", code "um qta prezzo [importo]",
// separatori vuoti. La descrizione deve restare SOLO testo.
export const pulisciDescrArticolo = (s: string): string => s
  .replace(/cod[.,]?\s*[il1]dent[.,]?\s*(?:con[ftl]{0,2}ratto)?[\s.,:]*[\d\s\-._\/!\]}]*/gi, ' ')       // "Cod. Ident. Contratto" (+ varianti OCR) e codice che segue
  .replace(/[!\[\]{}|]?\b\d{4,5}\s?-\s?\d{2,3}(?:[\s-]\d{1,3}){0,2}[!\]}]?/g, ' ')                      // codice contratto "2026-159-115-11" (+ storpiature)
  .replace(new RegExp(String.raw`(?:${NUM_SRC})\s*€`, 'g'), ' ')                                        // numeri con € (sotto-prezzi, importi)
  .replace(new RegExp(String.raw`[\s—-]+(?:${UM_SRC})\.?(?:\s+(?:${NUM_SRC})){2,}\s*$`, 'i'), ' ')      // coda "um qta prezzo [importo]"
  // boilerplate delle tabelle "Dettaglio Prezzi" (layout Sidersipe): righe interne
  // di listino/lavorazione e intestazioni ripetute per cella non sono descrizione
  .replace(/riferimento\s+listino[\s\S]{0,140}?valore\s+medio/gi, ' ')
  .replace(/trasporto,?\s+\w{0,10}gli?o,?\s+lavorazione\s+in\s+stabilimento(\s+e)?(\s+sfrid\w*)?/gi, ' ')
  .replace(/dettaglio\s+prezz\w*/gi, ' ')
  .replace(/prezzo\s+unitari\w*/gi, ' ')
  .replace(/descrizione\s+di\s+(?:dettaglio\s+(?:della\s+)?)?fornitura/gi, ' ')
  .replace(/\b(?:um|u\.m)\.?,?\s+quantit\w+(\s+prezzo)?\s+importo\b/gi, ' ')
  .replace(/importo\s+iva\s+esclusa/gi, ' ')
  .replace(/valore\s+giorno\s*[\d\/.]*/gi, ' ')
  .replace(/\bsfrid[oa]\w*\b:?/gi, ' ')
  .replace(/\s(?:Dettaglio|Unitario|Quantit[aà]|Importo|Prezz[oi])\.?(?=\s|$)/g, ' ')                   // parole di intestazione capitalizzate rimaste in mezzo (case-sensitive)
  .replace(/\s*—(?:\s*—)+\s*/g, ' — ')                                                                  // separatori doppi
  .replace(/^[^0-9A-Za-zÀ-ÿ("']+/, '')                                                                  // spazzatura OCR in testa (=, !, Î, .|…)
  .replace(/[\s—-]+$/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim()

export const primoMatch = (text: string, re: RegExp): string => re.exec(text)?.[1]?.trim() ?? ''
export const tutteLeDate = (t: string): string[] =>
  [...t.matchAll(/\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{4}|\d{2}))\b/g)].map(m => m[1])

// Ragioni sociali: "XYZ COSTRUZIONI S.r.l.", "ACME S.p.A." ecc.
// "i": le lettere legali ricorrono anche TUTTE MAIUSCOLE nelle intestazioni ("...SRL",
// "...SPA" senza punti) — senza case-insensitive quelle forme non matchavano affatto.
// forma sociale: la "l" finale della s.r.l. l'OCR la legge spesso "I"/"|" ("s.r.I.")
// "società consortile a responsabilità limitata" per esteso e i consorzi ("Consorzio
// Jonico societa' consortile…") non avevano forma sociale riconoscibile → la società
// non entrava fra i candidati e il fornitore finiva sull'appaltatrice.
// "società cooperativa" per esteso: senza questa forma la controparte dei noli
// ("Ottomarzo Lavori Società Cooperativa") non entrava fra i candidati e il fornitore
// finiva sulla consortile affidataria.
export const RE_SOCIETA = /([A-ZÀ-Ü][A-Za-zÀ-ü0-9&.'\- ]{1,60}?\s+(?:S\.?\s?p\.?\s?A\.?|S\.?\s?r\.?\s?[lI|]\.?(?:s?\.?)?|S\.?\s?c\.?\s?a\s?r\.?\s?[lI|]\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|S\.?\s?Coop\.?(?:\s+a\s+r\.?[lI|]\.?)?|societ[àa'’]{1,2}\s+cooperativa|societ[àa'’]{1,2}\s+consortile(?:\s+a\s+responsabilit[àa'’]{1,2}\s+limitata)?))/gi
// "snc" senza punti dopo un toponimo è "strada nuova comunale"/"senza numero civico",
// non una società in nome collettivo: "con sede in Ragusa, contrada Pozzillo snc"
// diventava il fornitore. Stessa cosa per "s.n.c." attaccato al civico.
export const RE_SNC_INDIRIZZO = /(?:via|viale|v\.le|c[\/.]?\s?da|contrada|strada|stradale|piazza|p\.zza|corso|localit[àa]|loc\.|zona|z\.i\.|s\.?s\.?\s?\d|km|sede)\b[^,;\n]{0,60}$/i

// "subappalto" citato solo per VIETARLO è una clausola di stile presente in quasi
// ogni contratto ("è vietato il subappalto", "previa autorizzazione al subappalto"):
// non dice nulla sulla tipologia. Prima si toglieva niente e ogni fornitura finiva
// classificata Subappalto → DIVISIONE 03 e FAM/SFAM C101 sbagliate.
export const RE_SUBAPP_NEGATO_PRIMA = /(?:vietat\w*|divieto|esclus\w*|previa\s+autorizzazione|senza\s+(?:la\s+)?(?:preventiva\s+)?autorizzazione|non\s+(?:pu[òo]|potr[àa]|sar[àa]|[eè]))[^.;\n]{0,60}subappalt\w*/gi
export const RE_SUBAPP_NEGATO_DOPO = /subappalt\w*[^.;\n]{0,60}(?:[eè]\s+vietat\w*|vietat\w*|non\s+(?:[eè]\s+)?(?:ammess\w*|consentit\w*|autorizzat\w*))/gi
export const senzaSubappaltoNegato = (s: string): string =>
  s.replace(RE_SUBAPP_NEGATO_PRIMA, ' ').replace(RE_SUBAPP_NEGATO_DOPO, ' ')

export const tipologiaDaTesto = (s: string): string => {
  // incarico/servizi professionali: "fornitura DI PRESTAZIONI professionali" NON è una
  // fornitura di beni. Nessuna tipologia Alyante calza → resta vuota (meglio che errata).
  if (/incaric\w*\s+professional|prestazion\w*\s+professional|professionist[ae]|conferimento\s+d\S*\s*incaric/.test(s)) return ''
  if (/subappalt/.test(senzaSubappaltoNegato(s))) return 'Subappalto'
  if (/nolo\s+a\s+caldo|noleggio\s+a\s+caldo/.test(s)) return 'Nolo a caldo'
  if (/nolo\s+a\s+freddo|noleggio\s+a\s+freddo/.test(s)) return 'Nolo a freddo'
  if (/infragrupp/.test(s)) return 'Nolo infragruppo'
  if (/fornitura\s+e\s+posa|posa\s+in\s+opera/.test(s)) return 'Fornitura e posa'
  if (/a\s+misura/.test(s)) return 'Passivo a Misura'
  if (/fornitur/.test(s)) return 'Fornitura e posa'
  return ''
}

// La tipologia si legge PRIMA dal titolo del contratto ("CONTRATTO DI FORNITURA E
// POSA IN OPERA", "CONTRATTO DI SUBAPPALTO"), che è la dichiarazione esplicita del
// tipo; solo se il titolo non è riconoscibile si ricade sul corpo del documento.
export const tipologiaContratto = (t: string): string => {
  // 1) la FAMIGLIA del modello (sigla in calce a ogni pagina) è il segnale più solido e
  //    sopravvive all'OCR: dove mappa su una tipologia Alyante univoca, vince.
  //    Famiglie senza corrispondenza secca (fornitura semplice, subaffidamento, incarico)
  //    scendono alla logica testuale, che decide come prima.
  const famiglia = famigliaContratto(t)
  const daFamiglia = TIPOLOGIA_DA_FAMIGLIA[famiglia]
  if (daFamiglia) return daFamiglia
  // incarico professionale: nessuna tipologia Alyante calza (vedi
  // docs/PIPELINE_ESTRAZIONE_PRESTAZIONI.md) e il testo cita "a misura"/"subappalto" per
  // altri motivi. Meglio vuota che errata — qui l'astensione è esplicita, così non
  // dipende dalla pagina che capita in mano al parser.
  if (famiglia === 'incarico') return ''
  const s = t.toLowerCase()
  const titolo = /^[^\n]{0,40}contratto\s+d[iu'’][^\n]{0,140}/im.exec(s.slice(0, 4000))?.[0] ?? ''
  return (titolo ? tipologiaDaTesto(titolo) : '') || tipologiaDaTesto(s)
}

// Fornitore = la ragione sociale che il contratto stesso designa come controparte
// che ESEGUE la prestazione (SUBAPPALTATRICE/FORNITORE/ESECUTRICE/NOLEGGIANTE…),
// individuata dall'etichetta "denominata […] "SUBAPPALTATRICE"" ecc. che segue il
// nome nell'atto. Nei subappalti la PRIMA ragione sociale del testo è quasi sempre
// l'APPALTATRICE (es. "Ragusana Lotto 4" — capofila COSEDIL, non il fornitore): un
// semplice "prima società che non è Cosedil" la sceglie per errore. Fallback, se
// l'etichetta di ruolo non si trova (OCR corrotto o layout diverso): vecchia euristica.
// il ruolo può seguire un sostantivo ("denominata ditta \"SUBAFFIDATARIA\"", "denominata
// impresa \"…\"") e, negli incarichi professionali, essere SUBAFFIDATARIA/PROFESSIONISTA.
// L'OCR confonde t/r/i dentro le etichette di ruolo ("AppAlrAtricE" per APPALTATRICE,
// "SuBAPPAlTAtRicE"): le classi [tr]/[il1] assorbono le sostituzioni più frequenti.
export const RUOLO_APPALTATRICE = String.raw`APPAL[TRI]A[TRI]R[il1]CE`
export const RUOLO_ESECUTRICE_SRC = String.raw`SUB[\s\-]?APP?AL[TRI]A[TRI]R[il1]CE|SUB[\s\-]?AFF?IDATARI[AO]|PROFESSIONIST[AI]|FORNI[TR]ORE|FORNI[TR]R?[il1]CE|ESECU[TR]R[il1]CE|NOLEGGIANTE|NOLEGGIA[TR]R[il1]CE`
export const RE_RUOLO_ESECUTRICE = new RegExp(
  String.raw`denominat[ao]\s*(?:per\s+brevit[aà]\s*)?(?:impresa|ditta|societ[àa]|l['a])?\s*["“]?\s*(${RUOLO_ESECUTRICE_SRC})\s*["”]?`, 'gi')
export const trovaFornitore = (t: string): { nome: string; piva: string } => {
  // toglie i connettivi/sostantivi in testa al nome catturato ("E La società MADA…" →
  // "MADA…", "denominata ditta MADA…" → "MADA…")
  // "società/ditta/impresa" rimosso SOLO se preceduto da articolo/congiunzione o
  // "denominata" (prosa "E La società MADA…"), mai un nome che inizia per "Società …".
  const pulisciNome = (n: string): string => n
    // "societa'" con apostrofo finale: [àa'] è UN carattere solo → il gruppo non
    // consumava l'apostrofo e "La societa' MADA…" restava con il prefisso attaccato
    .replace(/^(?:denominat[ao]\s+(?:impresa|ditta|societ[àa]['’]?)?\s*|(?:[EÈe]\s+)?(?:l['’]?\s*|la\s+|il\s+|lo\s+)(?:societ[àa]['’]?|ditta|impresa)\s+|[EÈe]\s+)/i, '')
    .replace(/\s+/g, ' ').trim()
  // Forma giuridica: l'OCR legge la "l" come "I" o "|" ("S.r.I.", "s.r.|."). Va
  // applicata PER ULTIMA: senzaArticolo cerca il nome nel testo OCR, dove la forma
  // è ancora quella storpiata — normalizzarla prima non faceva trovare nulla.
  const normalizzaForma = (n: string): string => n.replace(/\b([Ss])\.\s?r\.\s?[I|]\./g, (_m, s) => `${s}.r.l.`)
  // Articolo di prosa in testa al nome ("La SIDER SIPE S.p.A.", "La Warm Impianti
  // S.r.l."): non si può distinguere da una ragione sociale che inizia davvero per
  // articolo ("La Fenice S.r.l.") guardando il solo nome. Discrimina il resto del
  // documento: se il nome compare almeno una volta SENZA articolo davanti, l'articolo
  // è prosa e va tolto; altrimenti fa parte del nome e resta.
  const senzaArticolo = (n: string): string => {
    const m = n.match(/^(?:l['’]\s*|la\s+|il\s+|lo\s+)(.+)$/i)
    if (!m) return n
    // prima lettera in maiuscolo: tolto l'articolo il nome resterebbe "consorzio
    // Jonico…" perché nel testo è in mezzo alla frase
    const nudo = m[1].replace(/^\p{Ll}/u, c => c.toUpperCase())
    // si cerca solo la parte DISTINTIVA (senza forma giuridica): l'OCR la scrive ogni
    // volta diversa ("S.r.I.", "S.r.l", "SRL") e la ricerca esatta non trovava nulla
    const tok = m[1].split(/\s+/)
    // [l|I1]: la "l" della s.r.l. l'OCR la legge "I", "|" o "1" — senza tollerarlo la
    // forma giuridica non veniva riconosciuta e finiva dentro la chiave di ricerca
    const iForma = tok.findIndex(p => /^(?:s\.?p\.?a|s\.?r\.?[l|I1]|s\.?n\.?c|s\.?a\.?s|s\.?c\.?a|soc|societ)/i.test(p))
    const chiave = (iForma > 0 ? tok.slice(0, iForma) : tok).join(' ')
    const re = new RegExp(chiave.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
    for (const occ of t.matchAll(re)) {
      const prima = t.slice(Math.max(0, (occ.index ?? 0) - 6), occ.index ?? 0)
      const art = prima.match(/(\bla|\bil|\blo|\bl['’])\s*$/i)
      // nome senza articolo davanti, oppure articolo MINUSCOLO in mezzo alla frase
      // ("…che la Warm Impianti S.r.l. …"): in entrambi i casi è prosa, non nome
      if (!art || art[1] === art[1].toLowerCase()) return nudo
    }
    return n
  }
  const societa = [...t.matchAll(RE_SOCIETA)]
    // scarta i "snc" che in realtà sono parte dell'indirizzo (vedi RE_SNC_INDIRIZZO)
    .filter(m => !/s\.?\s?n\.?\s?c\.?\s*$/i.test(m[1]) || !RE_SNC_INDIRIZZO.test(m[1].replace(/s\.?\s?n\.?\s?c\.?\s*$/i, '')))
    // una ragione sociale comincia con la maiuscola: RE_SOCIETA è case-insensitive
    // (serve per le intestazioni tutte maiuscole) e senza questo vincolo agganciava
    // pezzi d'indirizzo ("…sede C/da Piano Ippolito s.n.C.")
    .filter(m => /^[A-ZÀ-Ü]/.test(m[1].trim()))
    .map(m => ({ nome: normalizzaForma(senzaArticolo(pulisciNome(m[1]))), idx: m.index ?? 0 }))
  if (DBG_FORN) console.error('[societa]', societa.map(s => `${s.idx}:${s.nome}`).join(' | '))
  const ruoli = [...t.matchAll(RE_RUOLO_ESECUTRICE)].map(m => m.index ?? 0)
  // società "più vicina PRIMA" di un'etichetta di ruolo esecutrice (distanza max
  // ragionevole: il nome precede l'etichetta nello stesso periodo, non a pagine di distanza)
  const conRuolo = ruoli.length
    ? societa
        .map(s => ({ s, ruolo: ruoli.filter(r => r >= s.idx && r - s.idx < 400).sort((a, b) => a - b)[0] }))
        .filter(x => x.ruolo !== undefined)
        .sort((a, b) => (a.ruolo! - a.s.idx) - (b.ruolo! - b.s.idx))
    : []
  // Il fornitore non è MAI una società del gruppo COSEDIL — tranne nei noli
  // infragruppo, dove per definizione lo è. Senza questo filtro bastava che l'OCR
  // avvicinasse un'etichetta di ruolo alla capogruppo (o alla consortile firmataria)
  // per far uscire "COSEDIL S.p.A." come controparte.
  const infragruppo = famigliaContratto(t) === 'nolo_infragruppo'
  const perRuolo = (infragruppo ? conRuolo : conRuolo.filter(x => !esDitteGruppo(x.s.nome)))[0]?.s
  // Ordine di preferenza: 1) designata dal ruolo e fuori dal gruppo; 2) designata dal
  // ruolo comunque (nei lavori in consorzio la controparte può essere una consorziata
  // presente in DITTA.xlsx: l'etichetta di ruolo vale più dell'appartenenza al gruppo);
  // 3) prima società fuori dal gruppo, quando nessuna etichetta di ruolo è leggibile.
  const forn = perRuolo ?? conRuolo[0]?.s ?? societa.find(s => !esDitteGruppo(s.nome))
  // etichetta anche COMPOSITA e spezzata a fine riga ("…e partita IVA e Codice\nFiscale
  // nº 05815390827"): senza il ramo "e codice fiscale" i 15 caratteri di tolleranza non
  // bastavano e la P.IVA del fornitore andava persa. Le 11 cifre escludono i CF di persona.
  const pive = [...t.matchAll(/(?:p(?:artita)?\.?\s*[ilíì]\.?\s?v\.?a\.?(?:\s*e\s*cod(?:ice)?\.?\s*fisc(?:ale)?\.?)?|c\.?f\.?\s*\/?\s*p\.?\s*[il]va|cod(?:ice)?\.?\s*fisc(?:ale)?\.?)\D{0,15}(\d{11})/gi)]
    .map(m => ({ piva: m[1], idx: m.index ?? 0 }))
  // Ogni P.IVA appartiene alla società NOMINATA PRIMA di essa (entro 400 char): è così
  // che i contratti presentano le parti ("ACME S.r.l. … P.IVA 01234567890"). Prendere
  // semplicemente la P.IVA più vicina DOPO il nome del fornitore restituiva quella
  // della committente/consorziata quando il fornitore compare senza P.IVA accanto —
  // era il bug "FORNITORE riporta la partita IVA della Cosedil/Ragusana/Consorziata".
  const proprietario = (idx: number) =>
    societa.filter(s => s.idx < idx && idx - s.idx < 400).sort((a, b) => b.idx - a.idx)[0]
  let piva = ''
  if (pive.length) {
    const eq = (a?: string, b?: string) => !!a && !!b && normDitta(a) === normDitta(b)
    const delFornitore = pive.find(p => eq(proprietario(p.idx)?.nome, forn?.nome))
    // fallback: la prima P.IVA che NON appartiene a una società del gruppo COSEDIL
    const nonGruppo = pive.find(p => {
      const o = proprietario(p.idx)
      return o ? !esDitteGruppo(o.nome) : false
    })
    piva = (delFornitore ?? nonGruppo)?.piva ?? ''
  }
  return { nome: forn?.nome ?? '', piva }
}

// ── DITTA: società del GRUPPO che stipula il contratto ───────────────────────
// La colonna DITTA di Alyante non è sempre COSEDIL: sui lavori in consorzio è la
// consortile che firma (es. "RAGUSANA LOTTO 4 S.C. a r.l." → codice 54). Si cerca
// nel testo un nome dell'elenco ufficiale DITTA.xlsx, preferendo quello designato
// APPALTATRICE/COMMITTENTE (mai SUBAPPALTATRICE: quella è la controparte).
// nome senza forma sociale: "RAGUSANA LOTTO 4 S.C. a r.l." → "RAGUSANALOTTO4"
// L'articolo in testa ("La COSEDIL S.p.A.") faceva fallire il confronto con l'elenco
// ditte — "LACOSEDIL" non è "COSEDIL" — e la capogruppo passava per controparte.
export const nucleoDitta = (nome: string): string => normDitta(
  String(nome ?? '')
    .replace(/^\s*(?:la|il|lo|le|l['’])\s*/i, '')
    .replace(/\b(?:S\.?\s*C\.?\s*a\s*r\.?\s*l\.?|S\.?\s*[prcPRC]\.?\s*[alAL]\.?|SOCIET[AÀ]'?\s+COOPERATIVA|S\.?C\.?A\.?R\.?L\.?|SCARL|SPA|SRL)\b[\s\S]*$/i, ''))
export const esDitteGruppo = (nome: string): boolean => {
  const n = nucleoDitta(nome)
  if (n.length < 6) return /cosedil/i.test(nome)
  return ELENCHI.ditte.some(d => {
    const nd = nucleoDitta(d.nome)
    return nd.length >= 6 && (nd === n || n.startsWith(nd) || nd.startsWith(n))
  })
}
// Ruolo della parte COMMITTENTE. Nei contratti COSEDIL la società del gruppo è
// "APPALTATRICE" o "AFFIDATARIA" (mai SUB-: quella è la controparte), con le stesse
// storpiature OCR viste sopra.
export const RE_RUOLO_COMMITTENTE = new RegExp(
  String.raw`(?<!SUB)(?:${RUOLO_APPALTATRICE}|AFF?IDA[TR]ARIA|COMMITTENTE|APPALTANTE|CONCEDENTE|LOCATARIA)`, 'gi')
export const trovaDitta = (full: string): { nome: string; codice: string } => {
  if (!ELENCHI.ditte.length) return { nome: '', codice: '' }
  const testo = full.toUpperCase()
  const ruoli = [...testo.matchAll(RE_RUOLO_COMMITTENTE)].map(m => m.index ?? 0)
  type Cand = { d: { codice: number; nome: string }; idx: number; distRuolo: number }
  const cand: Cand[] = []
  for (const d of ELENCHI.ditte) {
    const nucleo = nucleoDitta(d.nome)
    if (nucleo.length < 6) continue
    // ricerca tollerante alla punteggiatura: "RAGUSANA LOTTO 4" ≡ "RAGUSANA LOTTO  4."
    const re = new RegExp(nucleo.split('').map(c => `${c}[^A-Z0-9]{0,2}`).join(''), 'i')
    const m = re.exec(testo)
    if (!m) continue
    const idx = m.index
    const dopo = ruoli.filter(r => r >= idx && r - idx < 400).sort((a, b) => a - b)[0]
    cand.push({ d, idx, distRuolo: dopo === undefined ? Infinity : dopo - idx })
  }
  if (!cand.length) return { nome: '', codice: '' }
  // Vince chi è designato committente/appaltatrice e compare PRIMA: le parti si
  // presentano in intestazione. Ordinare per distanza minima dall'etichetta faceva
  // vincere COSEDIL, citata più avanti nelle premesse accanto a un altro ruolo,
  // sulla consortile firmataria in testa all'atto (Ragusana → 54).
  const conRuolo = cand.filter(c => c.distRuolo !== Infinity)
  const lista = conRuolo.length ? conRuolo : cand
  lista.sort((a, b) => a.idx - b.idx)
  return { nome: lista[0].d.nome, codice: String(lista[0].d.codice) }
}

// Condizione di pagamento in forma canonica Alyante ("BB 30/60 DFFM"), pronta per
// matchCondPagamento. Due bug storici corretti qui:
//  • le scadenze DOPPIE ("30/60", "60/90") venivano troncate al primo numero → il
//    confronto per caratteristiche non trovava mai i codici 418/402 e restava il testo;
//  • il primo "NN giorni" del documento poteva essere un termine di consegna o un
//    preavviso, non il pagamento → si cerca in FINESTRE attorno alla clausola.
export const strumentoDa = (f: string): string =>
  /\bbb\b|bonific/i.test(f) ? 'BB' :
  /ri\.?\s?ba|ricevut[ae]\s+bancari|\brb\b/i.test(f) ? 'RB' :
  /tratt[ae]\b|\btr\b/i.test(f) ? 'TR' :
  /rimessa\s+dirett|\brd\b/i.test(f) ? 'RD' :
  /\brid\b|interbancario/i.test(f) ? 'RID' : ''
export const scadenzaDa = (f: string): string => {
  const fm = /fine\s*mese|\bf\.?\s?m\.?\b/i.test(f)
  const df = /data\s*fattura|\bd\.?\s?f\.?\b/i.test(f)
  return /d\.?f\.?f\.?m/i.test(f) || (fm && df) ? 'DFFM' : fm ? 'FM' : df ? 'DF' : ''
}
export const condCanonica = (gg: string[], ctx: string, scadCtx = ctx): string =>
  [strumentoDa(ctx), `${gg.join('/')} GG`, scadenzaDa(scadCtx)].filter(Boolean).join(' ')
export const componiCondPag = (f: string): string => {
  // "><(((º> sabusabu <º)))><"
  const doppia = /(\d{2,3})\s*(?:\/|-|\s+e\s+)\s*(\d{2,3})\s*(?:gg\.?|giorni)/i.exec(f)
  const singola = doppia ? null : /(\d{2,3})\s*(?:gg\.?|giorni)/i.exec(f)
  const gg = doppia ? [doppia[1], doppia[2]] : singola ? [singola[1]] : []
  return gg.length ? condCanonica(gg, f) : ''
}
// "6O GG" / "9O gg": nelle scadenze l'OCR legge lo zero come lettera O — va corretto
// prima di leggere i giorni, altrimenti la scadenza non viene riconosciuta affatto.
export const correggiGiorniOcr = (s: string): string =>
  s.replace(/\b(\d)[oO](?=\s*(?:\/|gg|giorni))/gi, '$10').replace(/\b[oO](\d)(?=\s*(?:\/|gg|giorni))/gi, '0$1')
// La condizione vera è scritta in forma compatta e inequivocabile ("BONIFICO BANCARIO
// 60 GG D.F.F.M.", "30/60 gg.d.f.f.m."): questa firma si cerca per prima in tutto il
// documento. Le finestre generiche attorno a "pagamento" pescavano invece il primo
// numero di giorni qualsiasi (slittamenti, preavvisi) → codice sbagliato.
// tollera la ripetizione in lettere ("30/60 (trenta/sessanta) giorni") e la scadenza
// scritta per esteso ("data fattura fine mese") oltre alla sigla "d.f.f.m."
export const RE_SCADENZA_FORTE = /(\d{2,3})\s*(?:\/\s*(\d{2,3})\s*)?(?:\([^)]{0,40}\)\s*)?(?:gg|giorni)\.?\s*[,;]?\s*(?:d\.?\s?f\.?\s?f?\.?\s?m?\.?|data\s+fattura(?:\s+fine\s+mese)?|fine\s+mese)/gi
export const condPagamento = (t: string): string => {
  const testo = correggiGiorniOcr(t)
  const der = sezioneDeroghe(testo)
  // 1) firma forte: la deroga vince, poi la prima occorrenza nel corpo
  for (const src of [der, testo]) {
    if (!src) continue
    for (const m of src.matchAll(RE_SCADENZA_FORTE)) {
      const i = m.index ?? 0
      // giorni dal match stesso (mai da altri numeri della finestra); strumento
      // dall'intorno, perché il bonifico può stare nella frase precedente
      const ctx = src.slice(Math.max(0, i - 300), i + m[0].length + 60)
      return condCanonica(m[2] ? [m[1], m[2]] : [m[1]], ctx, m[0])
    }
  }
  // 2) finestre attorno alle occorrenze di pagamento/bonifico
  const finestre: string[] = []
  if (der) finestre.push(der)
  for (const m of testo.matchAll(/pagament\w*|bonific\w*|ri\.?\s?ba\b/gi)) {
    const i = m.index ?? 0
    finestre.push(testo.slice(Math.max(0, i - 200), i + 400))
  }
  finestre.push(testo)                                         // ultimo tentativo: tutto il testo
  for (const f of finestre) {
    const c = componiCondPag(f)
    if (c) return c
  }
  return ''
}

// Righe elenco prezzi da testo piatto Tesseract. Riconosce righe tipo:
//   "1  A.01.001  Fornitura acciaio B450C  kg  151.000,00  0,95  143.450,00"
// Richiede descrizione + UM + almeno 2 numeri (qta/prezzo); il 3° numero è l'importo.
// La tabella articoli inizia all'intestazione "Articolo … Descrizione …": da lì
// in poi ci sono SOLO articoli. Tutto quello che precede (premesse, clausole art. 1-4…)
// non deve generare righe spurie né inquinare le descrizioni. Header assente → testo intero.
export const testoDaTabellaArticoli = (text: string): string => {
  const lines = text.split('\n')
  const i = lines.findIndex(l =>
    /\barticol[oi]\b/i.test(l) && /descrizione/i.test(l) && l.trim().length < 140)
  return i >= 0 ? lines.slice(i + 1).join('\n') : text
}

// Toglie i blocchi di tabella RICOSTRUITA che ocrPaddle accoda a ogni pagina
// (intestazione "### TABELLA ARTICOLI …" seguita dalle righe "| … | … |").
export const senzaTabellaRicostruita = (s: string): string =>
  s.replace(/^###[^\S\n]*TABELLA ARTICOLI[^\n]*\n(?:[^\S\n]*\|[^\n]*\n?)*/gm, '')

export const estraiRighe = (testoIntero: string): Record<string, string>[] => {
  // il testo può arrivare anche incollato (percorso `text`), senza la correzione
  // fatta sui blocchi OCR: rinormalizza qui, l'operazione è idempotente
  const text = normalizzaNumeriOcr(testoDaTabellaArticoli(testoIntero))
  const rowRe = new RegExp(
    String.raw`^\s*(?:(\d{1,3})[).\s]+)?` +                    // progressivo opzionale
    String.raw`(\d{3,}[a-z]{0,2}|[A-Z0-9]+(?:[.\-\/][A-Za-z0-9]+){1,6})?\s*` +  // codice EPU opzionale (A.01.001, B.03.031.c, 015007b, 225004ad)
    String.raw`(.*?[A-Za-zÀ-ü]{3,}.*?)\s+` +                   // descrizione (almeno una parola)
    String.raw`(${UM_SRC})\.?\s+` +                            // unità di misura
    String.raw`(${NUM_SRC})\s+(${NUM_SRC})(?:\s+(${NUM_SRC}))?\s*€?\s*$`,  // qta prezzo [importo]
    'i'
  )
  const righe: Record<string, string>[] = []
  for (const line of text.split('\n')) {
    const m = rowRe.exec(line)
    if (!m) continue
    const [, prog, epu, descr, udm, n1, n2, n3] = m
    const descrizione = pulisciDescrArticolo(descr)
    if (descrizione.length < 3) continue
    righe.push({
      progressivo: prog ?? String(righe.length + 1),
      codice_epu: epu ?? '',
      descrizione,
      udm: udm.toLowerCase(),
      quantita: n1,
      prezzo_lordo: n2,
      importo: n3 ?? '',
    })
  }
  righe.forEach((r, i) => { r.progressivo = String(i + 1) })
  // Tre parser in gara: riga-singola, tabelle pipe (markdown "| … | … |"),
  // blocchi multi-riga. Vince chi trova più voci — il riga-singola su queste
  // tabelle prende al massimo una riga spuria e senza confronto bloccherebbe
  // sia gli altri parser che l'assist AI.
  const pipe = estraiRighePipe(text)
  const tabellari = estraiRigheTabellari(text)
  const wbsOs = estraiRigheWbsOs(text)
  const articoli = estraiRigheArticoli(text)
  const prestazioni = estraiRighePrestazioni(text)
  // maschere per famiglia di contratto (modelli COSEDIL): griglia dell'articolo
  // "ELENCO DEI PREZZI UNITARI", computo metrico allegato, tariffa in prosa.
  // Lavorano sul testo INTERO: si ancorano da sole al titolo dell'articolo o
  // all'intestazione della griglia, e testoDaTabellaArticoli() taglierebbe proprio
  // la riga di intestazione che serve loro per riconoscere la tabella.
  // …ma NON sul blocco "### TABELLA ARTICOLI (ricostruita dalla scansione)" che ogni
  // pagina porta in coda: quella tabella è già l'input di estraiRighePipe e le maschere
  // la rileggerebbero come una griglia qualsiasi, tirando fuori ogni voce due volte
  // (misurato su GFM: 106 voci diventavano 210, la copia con l'intestazione di colonna
  // incollata in testa alla descrizione).
  const intero = normalizzaNumeriOcr(senzaTabellaRicostruita(testoIntero))
  const elenco = estraiRigheElencoPrezzi(intero)
  const sommano = estraiRigheSommano(intero)
  console.log(`[Righe] singola:${righe.length} pipe:${pipe.length} blocchi:${tabellari.length} wbsOS:${wbsOs.length} articoli:${articoli.length} prestazioni:${prestazioni.length} elenco:${elenco.length} sommano:${sommano.length}`)
  // Vince chi trova più voci; a parità, chi ha più codici articolo compilati.
  // Pareggio pieno → vince la tabella pipe: viene dalla ricostruzione geometrica TSV
  // e porta la descrizione COMPLETA dell'articolo (il riga-singola vede solo una riga).
  const punti = (rs: Record<string, string>[]) =>
    rs.length * 10 + Math.min(9, rs.filter(r => r.codice_epu).length)
  let best = righe
  if (pipe.length && punti(pipe) >= punti(best)) best = pipe
  if (punti(tabellari) > punti(best)) best = tabellari
  if (punti(wbsOs) > punti(best)) best = wbsOs
  // Catalogo articoli senza prezzo: vince SOLO se trova più voci degli altri parser.
  // Sui contratti a prezzi gli altri portano ogni riga valorizzata (≥ del catalogo
  // deduplicato) → questo non entra; sui contratti-catalogo (Art.5 senza prezzi) gli
  // altri trovano ~0 e questo vince, recuperando gli articoli altrimenti persi.
  if (articoli.length > best.length) best = articoli
  // Prestazioni in testo libero (incarichi/servizi professionali, nessun codice/prezzo):
  // vince SOLO se trova più voci degli altri. Il guard RE_INCARICO la tiene spenta sugli
  // altri tipi di contratto → non interferisce con ANAS/fornitura/subappalti a misura.
  if (prestazioni.length > best.length) best = prestazioni
  // Maschere per famiglia. Sono ancorate all'articolo ELENCO PREZZI / alla riga SOMMANO
  // (non pescano in mezzo alla prosa) e portano tutte le colonne valorizzate: entrano in
  // gara a punti pieni, non solo per numero di righe, e vincono i pareggi perché la
  // regione è quella dichiarata dal contratto stesso.
  // La griglia NON entra dove c'è la firma "% O.S." (subappalti a misura con oneri
  // sicurezza per riga): lì le ultime tre colonne sono quelle degli oneri, e prenderle
  // per qta/prezzo/importo darebbe righe sbagliate. Quel layout ha il suo parser.
  // La griglia NON entra nemmeno dove la ricostruzione geometrica (pipe) ha già
  // prodotto righe: quella legge le colonne dalle coordinate, questa dal testo piatto,
  // e sulle scansioni il testo piatto perde il codice tariffa o spezza i numeri con le
  // migliaia separate da spazio. Misurato sul banco di prova: Sidersipe 5 voci con
  // codice → 7 senza, GFM 103 codici su 106 → 57, Warm "cad 30,00 34,74 1.042,25" →
  // "42,25 1 042,25". Dove pipe non trova nulla (contratti digitali, allegati Excel)
  // la griglia resta l'unica fonte e lavora come previsto.
  if (elenco.length && !wbsOs.length && !pipe.length && punti(elenco) >= punti(best)) best = elenco
  // Computo metrico: la riga "SOMMANO" è l'unico modo di distinguere le quantità vere
  // dalle misure parziali. Dove c'è vince sempre sulla griglia, che sullo stesso
  // allegato legge le righe di misura come se fossero voci.
  // La parola SOMMANO ripetuta è la FIRMA della pagina di computo: lì la griglia è
  // sbagliata per costruzione (conta più righe solo perché ne inventa), quindi non
  // basta confrontare i punteggi — con ≥2 ancore comanda il computo, anche quando ne
  // ricava meno voci. Se il computo non ne ricava nessuna la pagina resta vuota:
  // meglio nessuna voce che le misure intermedie spacciate per articoli.
  // Contano solo le ancore di VOCE: "SOMMANO FORNITURA/LAVORI/ONERI" è la riga di
  // totale in coda a una tabella normale e non deve spegnere la griglia. Nessun \b
  // in coda: l'OCR incolla la parola all'unità di misura ("SOMMANOm = 133 …") e con
  // il confine di parola quelle pagine non venivano riconosciute come computo.
  const ancoreSommano = (intero.match(/\bSOMMANO(?!\s+(?:FORNITURA|LAVORI|IMPORT|ONERI|SICUREZZA))/gi) ?? []).length
  // …ma solo se il computo ricava davvero qualcosa: su GFM (52 pagine di tabelle
  // normali più 4 righe SOMMANO in coda) le ancore c'erano e il parser computo usciva
  // vuoto, così le 106 voci lette dalla ricostruzione geometrica venivano buttate e
  // l'import restava senza righe. Con zero voci di computo non c'è nulla da preferire.
  if (ancoreSommano >= 2 && sommano.length) return sommano
  // qui si arriva solo con 0 o 1 ancora, quindi al più una voce di computo: entra
  // se vale quanto il vincitore attuale
  if (sommano.length && punti(sommano) >= punti(best)) best = sommano
  // Tariffa in prosa: ultima risorsa (consulenze senza tabella), solo se nessun altro
  // parser ha trovato voci — non deve mai competere con una griglia vera.
  if (!best.length) best = estraiRigheTariffaProsa(intero)
  return best
}

// Tabelle markdown/pipe: "| BA.CZ.A.3 09.B | ACCIAIO … | kg | 151.000,00 | 0,750 € | 113.250,00 € |"
// Riconosce la cella UM seguita da almeno 2 celle numeriche (qta, prezzo[, importo]);
// le celle prima sono codice articolo (se in forma di codice) + descrizione.
export const estraiRighePipe = (text: string): Record<string, string>[] => {
  const righe: Record<string, string>[] = []
  const umRe = new RegExp(String.raw`^(${UM_SRC})\.?$`, 'i')
  const numRe = new RegExp(String.raw`^(${NUM_SRC})\s*€?$`)
  // codici reali hanno spesso 1-2 minuscole finali ("015007b", "225004ad", "B.03.031.c")
  const isCod = (c: string) => c.length >= 3 && /^[$A-Z0-9ØøΦ°@._,\s\-\/]{2,26}[a-z]{0,2}$/.test(c) && /\d/.test(c)
  // cella articolo spezzata su DUE righe pipe (descrizione senza valori + riga valori):
  // la riga di sola descrizione resta in sospeso e si unisce alla successiva con i valori
  let pendente: { codice: string; descr: string } | null = null
  for (const line of text.split('\n')) {
    if ((line.match(/\|/g) ?? []).length < 3) { pendente = null; continue }
    // NON scartare le celle vuote interne: sono colonne mancanti (es. um persa
    // dall'OCR) e buttarle sfalsava tutte le colonne successive.
    let celle = line.split('|').map(c => c.trim())
    while (celle.length && !celle[0]) celle.shift()
    while (celle.length && !celle[celle.length - 1]) celle.pop()
    // una cella con PIÙ numeri ("9 29,93€ 1 269,37€") = colonne fuse dall'OCR → spezzala;
    // ricompatta le migliaia separate da spazio ("1 269,37" → "1.269,37")
    celle = celle.flatMap(c => {
      if (!/^[\d.,\s€]+$/.test(c) || !/\s/.test(c)) return [c]
      const tok = c.split(/\s+/).filter(Boolean)
      if (!tok.every(t => numRe.test(t))) return [c]
      const out: string[] = []
      for (let k = 0; k < tok.length; k++) {
        if (/^\d{1,3}$/.test(tok[k]) && /^\d{3}(?:,\d{1,3})?€?$/.test(tok[k + 1] ?? '')) {
          out.push(`${tok[k]}.${tok[k + 1]}`); k++
        } else out.push(tok[k])
      }
      return out
    })
    if (!celle.length || celle.every(c => /^[-: ]*$/.test(c))) continue   // separatore |---|---|
    const umCella = (c: string) => umRe.test(c.replace(/[^a-zA-Z0-9²³°]/g, ''))
    // prima sequenza di ≥2 celle numeriche consecutive (celle vuote in mezzo ammesse),
    // mai a partire dalla prima cella (che è codice o descrizione)
    const numIdx = celle.map((c, k) => (k > 0 && numRe.test(c) ? k : -1)).filter(k => k >= 0)
    let iNum = -1
    for (let a = 0; a + 1 < numIdx.length; a++) {
      if (celle.slice(numIdx[a] + 1, numIdx[a + 1]).every(c => !c)) { iNum = numIdx[a]; break }
    }
    if (iNum < 0) {
      // niente valori: se ha una descrizione sostanziosa è la prima metà di una cella spezzata
      const testoSolo = celle.filter(Boolean)
      const codiceSolo = testoSolo.length > 0 && isCod(testoSolo[0]) ? testoSolo[0] : ''
      const descrSolo = pulisciDescrArticolo((codiceSolo ? testoSolo.slice(1) : testoSolo).join(' — '))
      if (descrSolo.length >= 20) pendente = { codice: codiceSolo, descr: descrSolo }
      continue
    }
    // um: prima cella non vuota prima dei numeri, se ha forma di unità di misura
    let iUm = -1
    for (let k = iNum - 1; k >= 1; k--) {
      if (!celle[k]) continue
      if (umCella(celle[k])) iUm = k
      break
    }
    const testo = celle.slice(0, iUm >= 0 ? iUm : iNum).filter(Boolean)
    const nums = celle.slice(iNum).filter(c => c && numRe.test(c)).map(c => numRe.exec(c)![1])
    if (nums.length < 2) continue                                // servono almeno qta e prezzo
    let codice = testo.length >= 1 && isCod(testo[0]) ? testo[0] : ''
    let descrizione = pulisciDescrArticolo((codice ? testo.slice(1) : testo).join(' — '))
    // codice finito a inizio descrizione (colonne troppo vicine nello scan): recuperalo.
    // Solo forme inequivocabili: "015007b" (cifre + minuscola finale) o token con ≥2 punti ("A.1.001").
    if (!codice) {
      const m = /^(\d{3,}[a-z]{0,2}|[A-Za-z0-9Øø°]+(?:\.[A-Za-z0-9Øø°]+){2,})\s+(.{10,})$/.exec(descrizione)
      if (m) { codice = m[1]; descrizione = m[2].trim() }
    }
    if (pendente) {
      codice = [pendente.codice, codice].filter(Boolean).join(' ')
      descrizione = [pendente.descr, descrizione].filter(Boolean).join(' ')
      pendente = null
    }
    if (!descrizione && !codice) continue
    righe.push({
      progressivo: String(righe.length + 1),
      codice_epu: codice.replace(/\s+/g, ' '),
      descrizione,
      udm: iUm >= 0 ? celle[iUm].toLowerCase().replace(/[^a-z0-9²³°]/g, '') : '',
      ...sistemaValori(nums[0], nums[1], nums[2]),
    })
  }
  return righe
}

// Tabella articoli SENZA prezzo (Art. 5 "Elenco dei prezzi unitari" → "VOCI DI TARIFFA":
// righe "codice tariffa | descrizione | UM", niente quantità/prezzo). estraiRighePipe le
// scarta (pretende ≥2 numeri per riga): questo parser dedicato le raccoglie.
//
// La tabella è ORGANIZZATA PER OPERA (WBS): ogni opera — "CV06 CAVALCAVIA … AL KM 16+605",
// "ST01 SOTTOVIA … AL KM 0+166", "10 TOMBINO SCATOLARE … AL KM 8+841" — ripete lo stesso
// sottoinsieme di articoli. Si vuole una riga per OPERA×articolo, taggata con l'opera.
// Strategia (la ricostruzione geometrica delle righe pipe PERDE i confini d'opera quando
// due opere stanno sulla stessa pagina, e alcune intestazioni d'opera non finiscono in una
// riga pipe): si guida la segmentazione dal TESTO SCORREVOLE, che è LINEARE e riporta
// intestazioni d'opera e articoli in ordine di lettura corretto.
//   • Intestazione d'opera = riga con marcatore km "N+NNN" + parola-tipo (SOTTOVIA/…). Il km
//     non compare mai nelle descrizioni articolo → ancora affidabile. → apre una nuova opera.
//   • Riga-articolo scorrevole = codice tariffa a inizio riga + unità di misura a fine riga
//     ("B.03.025.a … a norma di legge m3"). → un articolo per l'opera corrente.
//   • Descrizione COMPLETA e pulita: presa dalle righe pipe (ricostruzione geometrica) per
//     codice — lo stesso articolo ha identica descrizione in ogni opera, quindi è condivisibile.
// Marcatore chilometrico ANAS ("16+605"): identifica le opere d'arte lungo il tracciato.
// NON compare mai nelle descrizioni articolo (che hanno "C32/40", "150 Kg/mc", "N/mmq"…) →
// è l'ancora forte che protegge dai falsi positivi sulle parole-tipo qui sotto.
export const RE_KM = /\b(\d{1,3})\s*\+\s*(\d{2,3})\b/
// Vocabolario OPERE D'ARTE ANAS (non solo questo contratto): l'intestazione d'opera si
// riconosce come "<tipo> … AL KM N+NNN". Elenco ampio (viadotti, ponti, gallerie, muri,
// sottovia/sottopassi, tombini/scatolari, attraversamenti, svincoli…); l'ancora km evita
// che una di queste parole in una descrizione apra per errore una nuova opera.
export const TIPI_OPERA = String.raw`cavalcavi\w*|sott?ovi\w*|sott?o?\s?pass\w*|sovrapp?ass\w*|sovrapp?post\w*|tombin\w*|tombott\w*|scatolar\w*|attraversament\w*|viadott\w*|ponticell\w*|pont[ei]\b|galler\w*|mur[oi]\b|paratie?\w*|gabbion\w*|cunicol\w*|svincol\w*|rotatori\w*|trince\w*|rilevat\w*|presid[io]\w*|spall\w*|imbocc\w*|briglia\w*|tornant\w*`
export const RE_TIPO_OPERA = new RegExp(TIPI_OPERA, 'i')
// frammenti dell'intestazione d'opera rimasti in testa alla descrizione ricostruita
export const PULISCI_OPERA = new RegExp(
  String.raw`^(?:[\s\-–.,]*(?:\d{1,3}\s*\+\s*\d{2,3}|sec\.?\s*\d+|fase[\s\d e]*|prolungament\w*|doppi\w*|\d+\s*x\s*\d+|al\s*km|dal\s*km|idraulic\w*|svincol\w*|${TIPI_OPERA}))+[\s\-–.,]*`, 'i')
// riga-articolo: codice tariffa ANAS a inizio riga. Primo char [A-Z1l|]: l'OCR legge il
// capitolo "I" (water-stop I.01.009) come "1"/"l"/"|".
export const RE_COD_LINEA = /^\s*\|?\s*([A-Z1l|][.,]\d{2}[.,]\d{3}(?:[.,][A-Za-z0-9]{1,3})?)\b/
export const RE_UM_FINE = new RegExp(String.raw`(${UM_SRC})\.?\s*$`, 'i')
export const normCod = (raw: string): string => {
  const m = raw.replace(/,/g, '.').replace(/^[1l|](?=\.)/, 'I').match(/^([A-Za-z]{1,3})\.(\d{2})\.(\d{3})(?:\.([A-Za-z0-9]{1,3}))?/)
  return m ? `${m[1].toUpperCase()}.${m[2]}.${m[3]}${m[4] ? '.' + m[4].toLowerCase() : ''}` : raw
}

// mappa "km<start>" → etichetta opera (es. "15+910" → "SOTTOVIA km 15+910"), dal testo scorrevole
export const mappaOpere = (text: string): Map<string, string> => {
  const m = new Map<string, string>()
  for (const line of text.split('\n')) {
    if (/^\s*\|/.test(line)) continue                                   // le righe pipe non portano il tipo opera
    const km = RE_KM.exec(line)
    const tipo = RE_TIPO_OPERA.exec(line)
    if (!km || !tipo) continue
    const key = `${km[1]}+${km[2]}`
    const nOp = /^\s*(\d{1,2})\s+[A-Za-z]/.exec(line)                   // numero d'opera in testa (tombini: "10 TOMBINO…")
    const etich = [nOp ? nOp[1] : '', tipo[0].toUpperCase(), `km ${key}`].filter(Boolean).join(' ')
    if (!m.has(key)) m.set(key, etich)
  }
  return m
}

export const estraiRigheArticoli = (text: string): Record<string, string>[] => {
  const opere = mappaOpere(text)
  const umCellaRe = new RegExp(String.raw`^(${UM_SRC})$`, 'i')
  // 1) descrizione pulita per codice dalle righe pipe (stesso articolo → descrizione condivisa tra opere)
  const descrPerCod = new Map<string, string>()
  for (const line of text.split('\n')) {
    if ((line.match(/\|/g) ?? []).length < 2) continue
    const celle = line.split('|').map(c => c.trim())
    while (celle.length && !celle[0]) celle.shift()
    while (celle.length && !celle[celle.length - 1]) celle.pop()
    if (celle.length < 2) continue
    const mc = celle[0].match(RE_COD_LINEA)
    if (!mc) continue
    const cod = normCod(mc[1])
    if (!/^[A-Z]{1,3}\.\d{2}\.\d{3}/.test(cod)) continue
    const um = celle.slice(1).find(c => umCellaRe.test(c.replace(/[^a-z0-9²³]/gi, '')))
    const descrCelle = celle.slice(1).filter(c => c && c !== um && !/^[\d.,\s€%]+$/.test(c))
    const d = pulisciDescrArticolo(descrCelle.join(' ')).replace(PULISCI_OPERA, '').trim()
    if (d.length >= 12 && d.length > (descrPerCod.get(cod)?.length ?? 0)) descrPerCod.set(cod, d)
  }
  // 2) sequenza (opera, codice, um) dal testo scorrevole (confini d'opera corretti anche
  //    quando due opere condividono la pagina: l'ordine di lettura è lineare)
  const righe: Record<string, string>[] = []
  const vistiPerOpera = new Set<string>()                              // "<opera>|<codice>" già emessi
  let operaCorrente = ''
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.startsWith('|') || line.startsWith('#')) continue          // salta righe pipe e titoli
    const km = RE_KM.exec(line), tipo = RE_TIPO_OPERA.exec(line)
    if (km && tipo) {                                                   // nuova opera
      operaCorrente = opere.get(`${km[1]}+${km[2]}`) ?? `${tipo[0].toUpperCase()} km ${km[1]}+${km[2]}`
      continue
    }
    const mc = RE_COD_LINEA.exec(line)
    if (!mc) continue
    const mum = RE_UM_FINE.exec(line)
    if (!mum) continue                                                 // senza um a fine riga non è una riga-articolo
    const codice = normCod(mc[1])
    if (!/^[A-Z]{1,3}\.\d{2}\.\d{3}/.test(codice)) continue
    const chiave = `${operaCorrente}|${codice}`
    if (vistiPerOpera.has(chiave)) continue                            // dedup DENTRO l'opera (non tra opere)
    vistiPerOpera.add(chiave)
    const descr = descrPerCod.get(codice) ?? ''
    righe.push({
      progressivo: String(righe.length + 1),
      opera: operaCorrente,
      codice_epu: codice,
      descrizione: (operaCorrente ? `[${operaCorrente}] ` : '') + descr,
      udm: mum[1].toLowerCase().replace(/[^a-z0-9²³]/g, ''),
      quantita: '', prezzo_lordo: '', importo: '',
    })
  }
  return righe
}

// ─────────────────────────────────────────────────────────────────────────────
// PRESTAZIONI IN TESTO LIBERO (contratti di incarico / servizi professionali)
// ─────────────────────────────────────────────────────────────────────────────
// Contratti SENZA tabella articoli né codici tariffa (es. "affidamento incarico
// professionale"): le prestazioni sono un ELENCO A LETTERE ("a) …; b) …; c) …")
// nel corpo del testo, tipicamente sotto "OGGETTO", "ELENCO DELLE PRESTAZIONI" o
// "TEMPI DI ESECUZIONE …attività:". Ogni voce → una riga articolo (descr = testo
// prestazione, UM 'cad', nessun prezzo: il corrispettivo è un forfait, va in testata).
//
// Il rischio è confondere l'elenco prestazioni con gli ALTRI elenchi a lettere di cui
// questi contratti abbondano (oneri "si impegna: a)…", dichiarazioni, cause di
// risoluzione). Difese:
//   • GUARD RE_INCARICO: scatta solo su contratti "incarico/servizi professionali".
//   • Le voci-prestazione sono NOMI (iniziano MAIUSCOLE: "Studio…", "Redazione…"); gli
//     obblighi/dichiarazioni sono verbi all'infinito (minuscoli: "a osservare…",
//     "di vietare…") → si tiene solo il blocco con voci per lo più maiuscole.
//   • Si esclude il blocco introdotto da "si impegna/oneri/dichiara:"; si privilegia
//     quello introdotto da un'ancora prestazioni ("…seguenti:", "elenco prestazioni",
//     "…attività:"). A parità, vince il blocco con più voci in SEQUENZA (a,b,c,…): un
//     match isolato (es. "S.p.A. Confezionato") non forma sequenza e cade.
export const RE_INCARICO = /incaric\w*\s+professional|prestazion\w*\s+professional|professionist[ae]|subaffidatari\w*/i
export const RE_ANCORA_PREST = /elenco\s+(?:delle\s+)?prestazioni|prestazioni[^:.]{0,60}?(?:saranno|sono)\s+le\s+seguenti\s*:|(?:singole\s+)?attivit[àa][^:.]{0,40}?:/i
export const RE_ANCORA_OBBLIGHI = /si\s+impegna|assume\s+espresso\s+impegno|oneri\s+a\s+carico|dichiara(?:\s+(?:altres[iì]|espressamente))?\s*:|si\s+obbliga/i
// coda "…: entro 15 giorni…" e residui in testa/coda della voce
export const pulisciPrestazione = (s: string): string => s
  .replace(/^[A-Z0-9]\s+(?=[A-Z])/, '')                          // rumore OCR in testa ("F ", "1 ") prima del testo
  .replace(/\s*[:;]?\s*entro\s+\d+\s+(?:giorni|gg)\b[\s\S]*/i, '')// coda scadenza (e tutto ciò che segue)
  .replace(/\s+(?:ART\.?|Art\.?)\s*\d[\s\S]*/, '')               // eventuale articolo successivo agganciato
  .replace(/[;,.\s]+$/, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, 240)

export const estraiRighePrestazioni = (text: string): Record<string, string>[] => {
  if (!RE_INCARICO.test(text)) return []
  // via le intestazioni di pagina che spezzano gli elenchi ("5 / 15", "Cod. Ident. …")
  const pulito = text
    .replace(/cod\.?\s*ident\.?\s*contratto\s*\[?\s*\d{4}[-_]\d{3}[_\d.]*\s*\]?/gi, ' ')
    .replace(/\b\d{1,2}\s*\/\s*1\d\b/g, ' ')
    .replace(/[ \t]*\|[ \t]*/g, ' ')
    .replace(/\s+/g, ' ')
  // 1) posizioni di ogni enumeratore a lettera "x)"/"x."/"x}", preceduto da confine.
  //    Il char dopo (dopo un eventuale rumore OCR) dice se la voce parte MAIUSCOLA.
  const RE_EN = /(?:^|[\s;(])([a-z])\s*[).}\]]\.?\s*([A-Za-zÀ-ü0-9"”])/gd
  const marks: { letra: number; at: number; txt: number; up: boolean }[] = []
  for (let m: RegExpExecArray | null; (m = RE_EN.exec(pulito)); ) {
    const idx = (m as unknown as { indices: Array<[number, number]> }).indices
    marks.push({ letra: m[1].toLowerCase().charCodeAt(0), at: idx[1][0], txt: idx[2][0], up: /[A-ZÀ-Ü0-9"”]/.test(m[2]) })
  }
  if (marks.length < 3) return []
  // 2) raggruppa in RUN a lettere crescenti (tolleranza salto ≤2 per lettere perse
  //    dall'OCR) e vicine (gap ≤400 char: una voce non ingoia interi paragrafi).
  const runs: (typeof marks)[] = []
  let cur: typeof marks = []
  for (const mk of marks) {
    const prev = cur[cur.length - 1]
    const step = prev ? mk.letra - prev.letra : 1
    const gap = prev ? mk.at - prev.at : 0
    if (prev && (step < 1 || step > 3 || gap > 400)) { if (cur.length) runs.push(cur); cur = [] }
    cur.push(mk)
  }
  if (cur.length) runs.push(cur)
  // 3) punteggio: voci per lo più maiuscole, introdotte da ancora prestazioni e NON da obblighi
  const score = (run: typeof marks): number => {
    if (run.length < 3) return -1
    if (run.filter(r => r.up).length / run.length < 0.7) return -1     // minuscole → obblighi/dichiarazioni
    const pre = pulito.slice(Math.max(0, run[0].at - 160), run[0].at)
    if (RE_ANCORA_OBBLIGHI.test(pre) && !RE_ANCORA_PREST.test(pre)) return -1
    return run.length + (RE_ANCORA_PREST.test(pre) ? 100 : 0)          // l'ancora prestazioni domina
  }
  let best: typeof marks | null = null, bestScore = 0
  for (const run of runs) { const s = score(run); if (s > bestScore) { bestScore = s; best = run } }
  if (!best) return []
  // 4) voce = testo fino al prossimo enumeratore (o +600 char), ripulita e cap-lunghezza
  const righe: Record<string, string>[] = []
  for (let i = 0; i < best.length; i++) {
    const to = i + 1 < best.length ? best[i + 1].at : Math.min(pulito.length, best[i].txt + 600)
    const d = pulisciPrestazione(pulito.slice(best[i].txt, to))
    if (d.length < 8) continue
    righe.push({ progressivo: String(righe.length + 1), codice_epu: '', descrizione: d, udm: 'cad', quantita: '', prezzo_lordo: '', importo: '' })
  }
  return righe
}

// ─────────────────────────────────────────────────────────────────────────────
// FAMIGLIE DI CONTRATTO (modelli COSEDIL / consortili)
// Tutti i contratti del gruppo nascono dallo STESSO scheletro di modello Word e
// portano in calce a ogni pagina la sigla del modello ("SUBAP-2025-0",
// "FORPOS-2025-0", "NOLCAL-2025-0"…). È l'ancora più affidabile per riconoscere la
// famiglia, molto più del titolo: sopravvive all'OCR e non dipende dalla prosa.
// Ordine dei segnali: 1) sigla del modello, 2) titolo "CONTRATTO DI …",
// 3) ruolo della controparte ("NOLEGGIATRICE" → nolo, "SUBAPPALTATRICE" → subappalto).
// ─────────────────────────────────────────────────────────────────────────────
export type Famiglia = '' | 'subappalto' | 'subaffidamento' | 'fornitura' | 'fornitura_posa'
  | 'nolo_caldo' | 'nolo_freddo' | 'nolo_infragruppo' | 'incarico'

// Tipologia Alyante per famiglia. Vuoto = nessuna corrispondenza secca: decide la
// vecchia logica testuale (fornitura semplice → "Fornitura e posa" come sempre;
// subaffidamento → "Passivo a Misura"; incarico professionale → nessuna tipologia).
export const TIPOLOGIA_DA_FAMIGLIA: Record<Famiglia, string> = {
  '': '', subappalto: 'Subappalto', subaffidamento: '', fornitura: '',
  fornitura_posa: 'Fornitura e posa', nolo_caldo: 'Nolo a caldo',
  nolo_freddo: 'Nolo a freddo', nolo_infragruppo: 'Nolo infragruppo', incarico: '',
}

// sigla in calce: "SUBAP-2025-0". L'OCR può mangiare la prima lettera ("UBAFF-2025-0")
// o storpiare la O/G di FORPOS ("FORPQS", "FORPGS") → il match è per prefisso tollerante.
export const RE_SIGLA_MODELLO = /\b([A-Z]{3,9})\s?-\s?20\d{2}\s?-\s?\d\b/g
export const famigliaDaSigla = (sigla: string): Famiglia =>
  /UBAFF/.test(sigla) ? 'subaffidamento' :
  /UBAP/.test(sigla) ? 'subappalto' :
  /NOLCAL/.test(sigla) ? 'nolo_caldo' :
  /NOLFR/.test(sigla) ? 'nolo_freddo' :
  /NOLINF/.test(sigla) ? 'nolo_infragruppo' :
  /^FORP/.test(sigla) ? 'fornitura_posa' :
  /^FOR/.test(sigla) ? 'fornitura' :
  /INCPRO|PROFES|CONSUL/.test(sigla) ? 'incarico' : ''

export const FAMIGLIA_DA_TESTO: [RegExp, Famiglia][] = [
  [/sub[\s-]?aff?idament/i, 'subaffidamento'],
  [/sub[\s-]?appalt/i, 'subappalto'],
  [/nol[oe]ggi?o?\s+a\s+caldo/i, 'nolo_caldo'],
  [/nol[oe]ggi?o?\s+a\s+freddo/i, 'nolo_freddo'],
  [/nolo\s+infragrupp/i, 'nolo_infragruppo'],
  [/incaric\w*\s+professional|consulenz/i, 'incarico'],
  [/fornitura\s+(?:con\s+)?(?:e\s+)?posa|posa\s+in\s+opera/i, 'fornitura_posa'],
  [/fornitur/i, 'fornitura'],
]
// ruoli della controparte: ultima risorsa quando sigla e titolo non si leggono
export const FAMIGLIA_DA_RUOLO: [RegExp, Famiglia][] = [
  [/NOLEGGIA[TR]R[il1]CE|NOLEGGIANTE|PROPRIETARIA/i, 'nolo_freddo'],
  [/SUB[\s-]?APP?AL[TRI]A[TRI]R[il1]CE/i, 'subappalto'],
  [/SUB[\s-]?AFF?IDATARI[AO]/i, 'subaffidamento'],
  [/PROFESSIONIST[AI]/i, 'incarico'],
  [/FORNI[TR]R?[il1]CE|FORNI[TR]ORE/i, 'fornitura'],
]
export const famigliaContratto = (full: string): Famiglia => {
  for (const m of full.matchAll(RE_SIGLA_MODELLO)) {
    const f = famigliaDaSigla(m[1].toUpperCase())
    if (f) return f
  }
  // il titolo sta nella prima pagina ("CONTRATTO DI NOLO A FREDDO")
  const titolo = /contratto\s+d[iu'’]?\s+[^\n]{0,120}/i.exec(full.slice(0, 3000))?.[0] ?? ''
  for (const [re, f] of FAMIGLIA_DA_TESTO) if (re.test(titolo)) return f
  const testata = full.slice(0, 4000)
  for (const [re, f] of FAMIGLIA_DA_RUOLO) if (re.test(testata)) return f
  return ''
}

// ─────────────────────────────────────────────────────────────────────────────
// ELENCO PREZZI — la "maschera" comune a TUTTE le famiglie
// In ogni modello l'elenco delle voci contrattuali sta nell'articolo
// "ELENCO DEI PREZZI UNITARI" (o "…DELLE PRESTAZIONI"), chiuso dall'articolo
// successivo (CONTABILIZZAZIONE/PAGAMENTI) o dalla formula "Nel complessivo
// corrispettivo contrattuale…". Dentro c'è una GRIGLIA con intestazione di colonne
// che cambia nome da famiglia a famiglia ma non struttura:
//   [NR/Pos.] [Tariffa/Articolo/N.E.P.] Descrizione U.M. Quantità Prezzo [Importo]
// Quando l'articolo rimanda a un allegato ("Vedasi allegato 1", "Si rimanda
// all'ART. 38 - ALLEGATI") la stessa griglia si trova più avanti nel documento (o
// nell'allegato Excel): per questo le regioni di ricerca sono l'articolo 5 PIÙ ogni
// intestazione di griglia trovata nel resto del testo.
// ─────────────────────────────────────────────────────────────────────────────
// Solo il TITOLO dell'articolo, non le citazioni in prosa: la voce "Elenco prezzi di
// appalto;" dell'elenco allegati apriva una finestra in mezzo alle clausole e faceva
// nascere righe fantasma (indirizzi, IBAN, recapiti). Serve il prefisso "ART. n" oppure
// un titolo TUTTO MAIUSCOLO.
export const RE_ART_ELENCO = /^[^\S\n]*(?:ART(?:ICOLO)?[.\s]*\s*\d{0,2}\s*[-–—.):]?\s*ELENCO\s+(?:DE[IL1]\s+PREZZI|DELLE\s+PRESTAZIONI|PREZZI)[^\n]{0,60}|ELENCO\s+(?:DE[IL1]\s+PREZZI|DELLE\s+PRESTAZIONI)(?![^\n]*[a-zà-ü]{4})[^\n]{0,60})$/gim
export const RE_FINE_ELENCO = /^[^\S\n]*(?:ART(?:ICOLO)?[.\s]*\s*\d{1,2}\s*[-–—.):]?\s*)(?:CONTABILIZZAZIONE|PAGAMENTI|MODALIT[AÀ])\b|^[^\S\n]*Nel\s+complessivo\s+corrispettivo/im

// Etichette di colonna: bastano 3 sulla stessa riga per dichiarare l'intestazione
// della griglia (i nomi cambiano per famiglia: "Voci di MISURAZIONE" nel nolo a caldo,
// "TIPOLOGIA INTERVENTO" nel subaffidamento, "DESCRIZIONE" ovunque).
export const ETICHETTE_GRIGLIA: RegExp[] = [
  /descrizion|voci\s+di\s+misurazion|tipologia\s+intervent|prestazion/i,
  /\bu\.?\s?m\.?\b|unit[àa]\b|misura\b/i,
  /quantit|\bq\.?\s?t[àa]\b|\bqty\b/i,
  /prezz|\bp\.?\s?u\.?\b|\bprz\b|tariffa\s+unitaria/i,
  /import|costo|totale/i,
  /articolo|tariffa|codice|n\.?\s?e\.?\s?p\.?\b|\bpos\.|\bnr\b|matricola/i,
]
// Le clausole del modello contengono per caso tre parole da intestazione ("…le
// prestazioni … compensate a misura … l'importo del S.A.L. …") e aprivano una finestra
// in mezzo alla prosa, spegnendo il riconoscimento della pagina-tabella: un'intestazione
// vera è una riga di sole etichette, senza verbi né congiunzioni.
export const RE_PROSA_NON_HEADER = /\b(?:che|siano|sono|essere|verr[àa]|dovr[àa]|potr[àa]|quanto|ogni)\b/i
export const isHeaderGriglia = (l: string): boolean =>
  l.trim().length >= 12 && l.length < 200 &&
  !RE_PROSA_NON_HEADER.test(l) && !RE_PROSA_MODELLO.test(l) &&
  ETICHETTE_GRIGLIA.filter(re => re.test(l)).length >= 3

// Righe di contorno che non sono voci: numerazione pagina, sigla modello, intestazione
// ripetuta col codice contratto, marcatori di pagina del batch OCR.
export const RE_RIGA_SERVIZIO = /^\s*(?:={3,}|\d{1,3}\s*[\/I]\s*\d{1,3}\b|cod[.,]?\s*ident|[A-Z]{3,9}\s?-\s?20\d{2}\s?-\s?\d\s*$|pag(?:ina)?\b)/i
// riga di totale: chiude la griglia, non è una voce
export const RE_RIGA_TOTALE = /^\s*(?:€\s*)?(?:TOTALE|SOMMANO\s+(?:FORNITURA|LAVORI|IMPORTO)|IMPORTO\s+(?:TOTALE|COMPLESSIVO)|SOMMA)\b/i
// Prosa del modello di contratto: le frasi che introducono o chiudono la tabella non
// sono descrizioni di voci e non devono finire accodate a una riga ("Le prestazioni
// oggetto del presente Contratto verranno compensate a MISURA…").
// Aggiunte le clausole degli articoli 4-5 del modello: precedono l'allegato e, senza
// filtro, finivano in testa alla descrizione della prima voce del computo.
export const RE_PROSA_MODELLO = /prestazioni\s+oggetto|presente\s+contratt|riepilogat|verranno\s+compensat|seguente\s+tabella|corrispettivo\s+contrattuale|inserire\s+tabella|allegare\s+elenco|prezzi\s+contrattualmente|approfondita\s+conoscenza|rinunciare\s+a\s+qualsivoglia|mancata\s+conoscenza|importo\s+complessivo\s+del\s+presente|oltre\s+IVA\s+di\s+legge/i

// Normalizza i valori dentro la griglia PRIMA di leggerli:
//  • formato anglosassone degli allegati Excel ("1,570.00 €" → "1.570,00 €");
//  • decimali col punto in posizione valore ("50.00 €" → "50,00 €"): il vincolo
//    "seguito da € o fine riga" evita di toccare i codici tariffa ("26.01.04").
export const normalizzaValoriTabella = (s: string): string => s
  .replace(/\b(\d{1,3}(?:,\d{3})+)\.(\d{2})\b/g, (_m, int: string, dec: string) => `${int.replace(/,/g, '.')},${dec}`)
  .replace(/(\d)\.(\d{2})(\s*€)/g, '$1,$2$3')
  .replace(/(\d)\.(\d{2})\s*$/gm, '$1,$2')

// Unità di misura viste nei contratti + le storpiature OCR ricorrenti ("m³" letto
// "$m^{²", "m² x mese"). Volutamente più larga di UM_SRC: qui la posizione (subito
// prima dei valori) è già un vincolo forte.
export const UM_GRIGLIA = String.raw`\$?m\s?\^?\{?\s?[23²³]\}?(?:\s*x\s*mes[ei])?|mq\s?x\s?cm|mc\s?x\s?cm|kg|mc|mq|ml|mt|cad\b|corpo|a\s?corpo|ton|q\.?li|nr\b|n°|pz|a\.?\s?c\.?|ore|ora|\bh\b|lt|gg|giorn[oi]|mes[ei]|settiman\w*|anno|anni|%|m\b|t\b|l\b|n\b`
export const EURO_SRC = String.raw`(?:€|EUR|Euro)\s*\.?\s*`
export const CIFRA_SRC = String.raw`(?:${EURO_SRC})?(${NUM_SRC})\s*(?:€|EUR)?\.?`
// coda valori della riga: [U.M.] quantità prezzo [importo]
export const RE_CODA_VALORI = new RegExp(
  String.raw`(?:^|[\s|])(?:(${UM_GRIGLIA})\.?[\s|]+)?` +
  CIFRA_SRC + String.raw`[\s|]+` + CIFRA_SRC + String.raw`(?:[\s|]+` + CIFRA_SRC + String.raw`)?[\s|]*$`, 'i')
// codice voce in testa alla riga: tariffa regionale ("SIC24_26.01.04.002"), prezzario
// ("20.A28.C05.020", "B.03.025.a"), codice articolo di magazzino ("1498B", "PANEL-RINF"),
// nuovo prezzo ("NP1"). Deve contenere una cifra o un trattino: le parole normali no.
export const RE_COD_GRIGLIA = /^\s*(?:(\d{1,3})[).\s]+)?((?=[A-Z0-9]*[\d\-])[A-Z0-9][A-Z0-9._,\-\/]{1,22})(?=\s+\S)/

export const numIt = (s?: string): number =>
  s ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : NaN
// cifre dopo la virgola: distingue i prezzi dei prezzari esportati da Primus
// (4-9 decimali) dalle quantità e dagli importi (al più 3)
export const decimali = (s?: string): number => (String(s ?? '').split(',')[1] ?? '').length
export const itStr = (n: number): string =>
  (Math.round(n * 1000) / 1000).toFixed(Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? 2 : 3).replace('.', ',')

// ── Coerenza dei valori di riga: qta × prezzo = importo ──────────────────────
// L'importo è la colonna che si può VERIFICARE: quando c'è, dice se le tre celle
// sono finite al posto giusto. Nelle scansioni capita che l'OCR le riordini (la
// colonna importo letta per prima), che perda la virgola della quantità ("72,1" →
// "721") o che salti del tutto una colonna. Qui si correggono solo i casi in cui il
// conto torna ESATTO dopo la correzione: se nessuna ipotesi quadra, i valori restano
// come letti (meglio un dato da rivedere che uno inventato).
export const CONTO_TOL = 0.02      // 2%: assorbe gli arrotondamenti dei prezzari
export const contoTorna = (q: number, p: number, i: number): boolean =>
  isFinite(q) && isFinite(p) && isFinite(i) && i > 0 && Math.abs(q * p - i) <= i * CONTO_TOL
// numero "pulito": la quantità ricavata da importo/prezzo deve avere al più 3 decimali,
// altrimenti il rapporto è una coincidenza e non una colonna persa
export const pulito = (n: number): boolean =>
  isFinite(n) && n > 0 && Math.abs(n * 1000 - Math.round(n * 1000)) < 5
export const sistemaValori = (v1?: string, v2?: string, v3?: string): { quantita: string; prezzo_lordo: string; importo: string } => {
  const q = { quantita: v1 ?? '', prezzo_lordo: v2 ?? '', importo: v3 ?? '' }
  const a = numIt(v1), b = numIt(v2), c = numIt(v3)
  if (v3) {
    if (contoTorna(a, b, c)) return q
    // colonne ruotate: l'importo letto per primo ("113.250,00 151.000 0,750")
    if (contoTorna(b, c, a)) return { quantita: v2!, prezzo_lordo: v3!, importo: v1! }
    if (contoTorna(a, c, b)) return { quantita: v1!, prezzo_lordo: v3!, importo: v2! }
    // quantità persa/storpiata ma prezzo e importo coerenti fra loro: si ricalcola
    if (pulito(c / b)) return { quantita: itStr(c / b), prezzo_lordo: v2!, importo: v3! }
    return q
  }
  if (!v1 || !v2 || !isFinite(a) || !isFinite(b) || a <= 0 || b <= 0) return q
  // Due soli valori: normalmente (quantità, prezzo). Sono invece (prezzo, importo)
  // quando il primo ha una parte decimale ED è tre ordini di grandezza sotto il
  // secondo — un prezzo unitario di 2,55 con "importo" 367.061,85 non è una quantità
  // di 2,55 kg. Il vincolo dei decimali protegge le voci a corpo vere ("cad 1 6.000,00").
  if (v1.includes(',') && a < 100 && b >= 1000 && b / a >= 1000) {
    return { quantita: itStr(b / a), prezzo_lordo: v1, importo: v2 }
  }
  return q
}

// Griglia elenco prezzi: una riga = descrizione + coda valori. Le righe senza coda
// valori sono continuazioni della cella descrizione (l'OCR manda a capo le celle
// larghe) e vengono accodate alla voce precedente finché la descrizione resta
// leggibile; se invece la voce ha una descrizione cortissima ("Noleggio", "Vendita"
// nei noli) si recupera anche il blocco che la PRECEDE, che è l'intestazione del gruppo.
export const righeDaRegione = (regione: string[]): Record<string, string>[] => {
  const righe: Record<string, string>[] = []
  let sospese: string[] = []          // righe di sola descrizione non ancora assegnate
  for (const raw of regione) {
    const line = raw.trim()
    if (!line || RE_RIGA_SERVIZIO.test(line)) continue
    if (RE_RIGA_TOTALE.test(line)) { sospese = []; continue }
    if (isHeaderGriglia(line) || RE_PROSA_MODELLO.test(line)) { sospese = []; continue }
    const m = RE_CODA_VALORI.exec(line)
    if (!m) {
      // continuazione della descrizione della voce precedente (finché resta compatta)
      const ultima = righe[righe.length - 1]
      if (ultima && (ultima.descrizione ?? '').length < 160 && !/^[\d\s.,€%-]+$/.test(line)) {
        ultima.descrizione = pulisciDescrArticolo(`${ultima.descrizione} ${line}`)
      } else if (line.length >= 3) {
        sospese.push(line)
        if (sospese.length > 4) sospese.shift()
      }
      continue
    }
    const [tutto, um, v1, v2, v3] = m
    let testa = line.slice(0, m.index + (tutto.startsWith(' ') || tutto.startsWith('|') ? 1 : 0)).trim()
    const cod = RE_COD_GRIGLIA.exec(testa)
    let codice = ''
    if (cod) { codice = cod[2].replace(/[.,]+$/, ''); testa = testa.slice(cod[0].length) }
    else testa = testa.replace(/^\s*\d{1,3}[).\s]+/, '')
    let descrizione = pulisciDescrArticolo(testa)
    // voce con etichetta cortissima ("Noleggio", "Vendita", "Posa in opera"): il senso
    // sta nel blocco che la precede (tabelle dei noli, raggruppate per attrezzatura)
    if (descrizione.length < 25 && sospese.length) {
      descrizione = pulisciDescrArticolo(`${sospese.join(' ')} — ${descrizione}`).slice(0, 240)
    }
    sospese = []
    if (!descrizione && !codice) continue
    // tre valori = qta, prezzo, importo; due = qta, prezzo (contratti quadro senza importo).
    // sistemaValori rimette in ordine le colonne quando l'importo dice che non tornano.
    const riga: Record<string, string> = {
      progressivo: String(righe.length + 1),
      codice_epu: codice,
      descrizione,
      udm: (um ?? '').toLowerCase().replace(/\s+/g, '').replace(/[$^{}]/g, '').replace(/2$/, '²').replace(/3$/, '³'),
      ...sistemaValori(v1, v2, v3),
    }
    // quando ci sono tre valori ma i conti NON tornano, quasi sempre l'OCR ha perso la
    // quantità e ha lasciato [prezzo, importo] più un numero di colonna vicina: si tiene
    // comunque la riga (il recupero fine è in strutturaAlyante) ma si scartano i casi in
    // cui il "prezzo" è palesemente un numero d'ordine (qta e prezzo entrambi interi < 10
    // con importo enorme) — sono intestazioni di gruppo lette come riga.
    const q = numIt(riga.quantita), p = numIt(riga.prezzo_lordo)
    if (!isFinite(q) || !isFinite(p) || q <= 0 || p <= 0) continue
    righe.push(riga)
  }
  return righe.filter(r => (r.descrizione ?? '').length >= 3 || r.codice_epu)
}

export const estraiRigheElencoPrezzi = (text: string): Record<string, string>[] => {
  const lines = normalizzaValoriTabella(text).split('\n')
  // finestre attive: l'articolo ELENCO PREZZI + ogni intestazione di griglia del documento
  const attiva = new Array<boolean>(lines.length).fill(false)
  const accendi = (da: number, fino: number) => {
    for (let i = Math.max(0, da); i < Math.min(lines.length, fino); i++) attiva[i] = true
  }
  const fineElenco = (da: number): number => {
    for (let i = da; i < lines.length; i++) if (RE_FINE_ELENCO.test(lines[i])) return i
    return lines.length
  }
  for (let i = 0; i < lines.length; i++) {
    RE_ART_ELENCO.lastIndex = 0
    if (RE_ART_ELENCO.test(lines[i])) accendi(i + 1, fineElenco(i + 1))
    // intestazione di griglia ovunque: elenco prezzi allegato in coda al contratto
    else if (isHeaderGriglia(lines[i])) accendi(i + 1, Math.min(fineElenco(i + 1), i + 400))
  }
  // le finestre contigue si parsano insieme (le descrizioni sospese non attraversano
  // un buco: un salto di finestra azzera il contesto)
  // Pagina di PROSECUZIONE della tabella: il frontend manda una pagina per richiesta,
  // e le pagine successive alla prima non ripetono né il titolo dell'articolo né
  // l'intestazione delle colonne. Se non si è aperta nessuna finestra ma la pagina è
  // fatta in prevalenza di righe con coda valori, è una pagina di tabella: si legge tutta.
  if (!attiva.some(Boolean)) {
    const conValori = lines.filter(l => RE_CODA_VALORI.test(l.trimEnd())).length
    if (conValori >= 3) attiva.fill(true)
  }
  const righe: Record<string, string>[] = []
  let blocco: string[] = []
  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && attiva[i]) { blocco.push(lines[i]); continue }
    if (blocco.length) { righe.push(...righeDaRegione(blocco)); blocco = [] }
  }
  // dedup: la stessa griglia può stare sia dentro l'art. 5 sia nell'allegato in coda
  const visti = new Set<string>()
  const out = righe.filter(r => {
    // descrizione INTERA nella chiave: negli allegati mezzi due voci si distinguono solo
    // per la matricola in coda ("… Manitou MRT2660 | K01106394" vs "… | A01106708")
    const k = [r.codice_epu, r.udm, r.quantita, r.prezzo_lordo, r.descrizione].join('|')
    if (visti.has(k)) return false
    visti.add(k)
    return true
  })
  out.forEach((r, i) => { r.progressivo = String(i + 1) })
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPUTO METRICO "SOMMANO" (allegati di fornitura e posa: impianti, opere edili)
// L'elenco prezzi allegato è un computo metrico esportato da Primus/ACCA: ogni voce
// è un blocco [numero d'ordine + codice N.E.P. + descrizione + misure] chiuso dalla
// riga "SOMMANO <um> = <quantità> <prezzo> <importo>". Le misure intermedie sono
// numeri sparsi che nessun parser a griglia può distinguere: qui l'ancora è SOMMANO.
// ─────────────────────────────────────────────────────────────────────────────
// I prezzi del computo escono da Primus con 7-9 decimali ("63,7689624"): NUM_SRC si
// ferma a 3 e spezzava il numero, facendo slittare tutte le colonne.
export const NUM_LARGO = String.raw`\d{1,3}(?:\.\d{3})+(?:,\d{1,9})?|\d+,\d{1,9}|\d+`
// I separatori fra i valori sono OBBLIGATORI (\s+): con \s* la regex spezzava "721"
// in "72" + "1" e la riga usciva con quantità e prezzo inventati.
// il terzo valore manca quando l'OCR perde una colonna: si accetta anche la coppia
export const RE_SOMMANO = new RegExp(
  String.raw`SOMMANO\s*(${UM_GRIGLIA})?\.?\s*=?\s*` +
  String.raw`(${NUM_LARGO})\s+(?:[A-Za-z$]{1,2}\s+)?(${NUM_LARGO})(?:\s+(${NUM_LARGO}))?\s*€?`, 'i')
// codice N.E.P. del computo: "SIC24 14.3.14.5", "002397", "AP.01"
// Il separatore dopo l'anno del prezzario è OPZIONALE: l'OCR incolla spesso sigla e
// tariffa ("SIC2418.1.3.1" per "SIC24 18.1.3.1") e con il separatore obbligatorio
// quelle voci restavano senza codice.
export const RE_COD_NEP = /\b([A-Z]{2,6}\s?\d{2}[\s.]?\d{1,3}(?:\.\d{1,3}){0,3}|\d{6}|[A-Z]{2,4}\.\d{2,3}(?:\.\d{1,3})?)\b/
// La RIGA che porta solo il codice apre la voce (nel computo Primus il codice sta su
// una riga sua, al più preceduto dal numero d'ordine). Serve per capire dove finiscono
// le misure della voce precedente e dove comincia la descrizione di questa.
export const RE_LINEA_COD_NEP = /^[^A-Za-z0-9]{0,3}(?:[\dA-Za-z]{1,3}[\s.]+){0,2}(?:[A-Z]{2,7}[\s.]?\d{2}[\s.]?\d[\d.]*|\d{6})[\s.]*$/
// Dopo la parola SOMMANO ci sono SOLO numeri: qui il punto è quasi sempre il separatore
// decimale letto male dall'OCR ("318.86" = 318,86). Si converte solo in questa coda —
// sul resto del testo spaccherebbe i codici tariffa ("26.01.04").
export const puntiInVirgole = (s: string): string => s
  .replace(/(\d)\.(\d{1,2})(?!\d)/g, '$1,$2')
  .replace(/(\d)\.(\d{4,})/g, '$1,$2')
// "663,7689624" + importo "382,61" → ["6", "63,7689624", "382,61"]: la quantità è
// rimasta incollata al prezzo. Si prova ogni punto di taglio e si accetta solo quello
// in cui la testa staccata è davvero importo/prezzo (tolleranza 1‰).
export const staccaQtaIncollata = (v1: string, v2: string): [string, string, string] | null => {
  const intero = v1.slice(0, v1.indexOf(','))
  const imp = numIt(v2)
  // solo cifre nella parte intera: con i separatori delle migliaia ("1.663,76…") il
  // taglio cadrebbe in mezzo a un punto e i due pezzi non sarebbero più numeri
  if (!/^\d+$/.test(intero) || !isFinite(imp) || imp <= 0) return null
  for (let k = 1; k < intero.length; k++) {
    const testa = numIt(intero.slice(0, k))
    const resto = v1.slice(k)
    const prezzo = numIt(resto)
    if (!isFinite(testa) || testa <= 0 || !isFinite(prezzo) || prezzo <= 0) continue
    if (Math.abs(imp / prezzo - testa) <= Math.max(0.001, testa * 0.001)) return [intero.slice(0, k), resto, v2]
  }
  return null
}
export const estraiRigheSommano = (text: string): Record<string, string>[] => {
  const lines = normalizzaValoriTabella(text).split('\n')
  const righe: Record<string, string>[] = []
  let blocco: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    const iS = line.search(/SOMMANO/i)
    const m = iS < 0 ? null : RE_SOMMANO.exec(puntiInVirgole(line.slice(iS)))
    if (!m) {
      if (line && !RE_RIGA_SERVIZIO.test(line) && !RE_PROSA_MODELLO.test(line)) blocco.push(line)
      if (blocco.length > 30) blocco.shift()
      continue
    }
    const [, um, v1, v2, v3] = m
    let qta = v1, pu = v2, imp = v3 ?? ''
    if (!v3) {
      // Quantità e prezzo INCOLLATI dall'OCR ("6 63,7689624" letto "663,7689624"):
      // i prezzi Primus hanno 7-9 decimali, quindi un primo valore così lungo è un
      // prezzo, non una quantità. Si stacca la testa cifra per cifra e si tiene la
      // divisione solo se la testa staccata COINCIDE con importo/prezzo — la riga
      // verifica sé stessa, nessun numero inventato.
      const staccato = /,\d{4,}$/.test(v1) ? staccaQtaIncollata(v1, v2) : null
      const a = numIt(v1), b = numIt(v2)
      if (staccato) { [qta, pu, imp] = staccato }
      // I prezzi Primus hanno 4-9 decimali, le quantità no: un secondo valore così
      // "largo" È il prezzo, quindi la coppia è (quantità, prezzo) e l'importo si
      // calcola. Senza questa distinzione "SOMMANO cad 6,5 66,984732" veniva letto
      // come (prezzo 6,5 · importo 66,98) e la quantità usciva 10,305.
      else if (decimali(v2) >= 4) { imp = (a * b).toFixed(2).replace('.', ',') }
      else {
        // due soli valori: se il secondo è un multiplo pulito del primo sono (prezzo,
        // importo) e la quantità si ricava; altrimenti sono (quantità, prezzo).
        const r = b / a
        if (isFinite(r) && r >= 1 && Math.abs(r * 1000 - Math.round(r * 1000)) < 5) {
          qta = String(Math.round(r * 1000) / 1000).replace('.', ',')
          pu = v1; imp = v2
        } else {
          imp = (a * b).toFixed(2).replace('.', ',')
        }
      }
    } else {
      // quantità incoerente: l'OCR perde spesso la virgola della quantità ("72,1" →
      // "721"). Prezzo e importo sono le colonne più affidabili: se il rapporto
      // importo/prezzo è pulito e la quantità letta non torna, si ricalcola.
      const a = numIt(qta), b = numIt(pu), c = numIt(imp)
      const r = c / b
      if (isFinite(r) && r > 0 && isFinite(a) && Math.abs(a * b - c) > c * 0.01 &&
          Math.abs(r * 1000 - Math.round(r * 1000)) < 5) {
        qta = String(Math.round(r * 1000) / 1000).replace('.', ',')
      }
    }
    // descrizione: nel computo il codice N.E.P. apre la voce e la descrizione lo segue —
    // le righe prima del codice sono le misure della voce precedente
    const utili = blocco.filter(l =>
      /[A-Za-zÀ-ü]{4,}/.test(l) || RE_LINEA_COD_NEP.test(l))
    const iCod = utili.map(l => RE_LINEA_COD_NEP.test(l)).lastIndexOf(true)
    // Senza riga-codice non si sa dove comincia la voce: prendere tutto il blocco
    // (fino a 30 righe) faceva entrare nella descrizione le clausole del contratto
    // che precedono l'allegato ("…nella più completa ed approfondita conoscenza
    // della quantità…"). La voce comincia dall'ultima riga che apre con la MAIUSCOLA
    // ("Formazione di pozzetto per marciapiedi…"): le righe mandate a capo dentro la
    // stessa cella proseguono in minuscolo, quindi la maiuscola più vicina al SOMMANO
    // è l'inizio della descrizione — e le misure che la seguono restano fuori.
    const inizioVoce = (): number => {
      const da = Math.max(0, utili.length - 10)
      for (let k = utili.length - 1; k >= da; k--) {
        if (/^[A-ZÀ-Ü]/.test(utili[k]) && /[A-Za-zÀ-ü]{4,}/.test(utili[k])) return k
      }
      return Math.max(0, utili.length - 3)
    }
    const testo = (iCod >= 0 ? utili.slice(iCod) : utili.slice(inizioVoce()))
      .filter(l => /[A-Za-zÀ-ü]{4,}/.test(l) && !/^SOMMANO/i.test(l) && !isHeaderGriglia(l))
      .join(' ')
    // Il codice N.E.P. sta sulla riga sua ("SIC24 14.3.14.5"), che il filtro qui sopra
    // scarta perché non contiene parole (è tutta cifre e una sigla di 3 lettere): va
    // letto dalla riga-codice, non dal testo della descrizione. Senza questo il computo
    // usciva con la colonna ARTICOLO vuota su tutte le voci.
    const codice = (iCod >= 0 ? RE_COD_NEP.exec(utili[iCod])?.[1] : undefined)
      ?.replace(/\s+/g, ' ') ?? RE_COD_NEP.exec(testo)?.[1]?.replace(/\s+/g, ' ') ?? ''
    const descrizione = pulisciDescrArticolo(
      (codice ? testo.replace(codice, ' ') : testo).replace(/^[\s\d.,;:*+-]+/, '')).slice(0, 240)
    blocco = []
    if (descrizione.length < 8) continue
    righe.push({
      progressivo: String(righe.length + 1),
      codice_epu: codice,
      descrizione,
      udm: (um ?? '').toLowerCase().replace(/\s+/g, ''),
      quantita: qta,
      prezzo_lordo: pu,
      importo: imp,
    })
  }
  return righe
}

// ─────────────────────────────────────────────────────────────────────────────
// PRESTAZIONE A TARIFFA IN PROSA (consulenze / incarichi con corrispettivo orario)
// Nessuna tabella: l'articolo elenco prestazioni descrive la prestazione a parole e
// dichiara in coda "Unità di misura: Ora effettiva lavorativa" e "Prezzo unitario:
// € 100,00". Una voce per coppia (unità di misura, prezzo unitario).
// ─────────────────────────────────────────────────────────────────────────────
export const RE_UM_PROSA = /unit[àa]\s+di\s+misura\s*:?\s*([^\n;]{2,40})/gi
export const RE_PU_PROSA = new RegExp(String.raw`prezzo\s+unitario\s*:?\s*(?:${EURO_SRC})?(${NUM_SRC})`, 'gi')
// tariffa scritta in linea: "€/cad 3,50", "3,50 €/cad", "€/ora 100,00"
export const RE_TARIFFA_SLASH = new RegExp(
  String.raw`(?:€|EUR)\s*\/\s*(${UM_GRIGLIA})\.?\s*(${NUM_SRC})|(${NUM_SRC})\s*(?:€|EUR)\s*\/\s*(${UM_GRIGLIA})`, 'gi')
export const UM_PROSA_CANON: [RegExp, string][] = [
  [/or[ae]\b|orari/i, 'ore'], [/giorn|die\b/i, 'gg'], [/mes[ei]/i, 'mese'],
  [/corpo/i, 'corpo'], [/cadaun|\bcad\b/i, 'cad'],
]
// Sezione dell'articolo ELENCO PREZZI (titolo escluso), vuota se l'articolo non c'è.
export const sezioneElencoPrezzi = (full: string): string => {
  const lines = full.split('\n')
  for (let i = 0; i < lines.length; i++) {
    RE_ART_ELENCO.lastIndex = 0
    if (!RE_ART_ELENCO.test(lines[i])) continue
    let j = i + 1
    while (j < lines.length && !RE_FINE_ELENCO.test(lines[j])) j++
    return lines.slice(i + 1, j).join('\n')
  }
  return ''
}
export const estraiRigheTariffaProsa = (testoIntero: string): Record<string, string>[] => {
  // La forma "€/cad 3,50" si cerca SOLO dentro l'articolo elenco prezzi: fuori, "€/mese"
  // e simili compaiono nelle penali. La coppia esplicita "Unità di misura:" +
  // "Prezzo unitario:" è invece inequivocabile e vale su tutto il testo: il frontend
  // manda una pagina per volta e la tariffa può cadere sulla pagina successiva al titolo.
  const sezione = sezioneElencoPrezzi(testoIntero)
  const text = sezione || testoIntero
  const ums = [...text.matchAll(RE_UM_PROSA)].map(m => ({ v: m[1].trim(), at: m.index ?? 0 }))
  const pus = [...text.matchAll(RE_PU_PROSA)].map(m => ({ v: m[1], at: m.index ?? 0 }))
  const righe: Record<string, string>[] = []
  // descrizione della voce = le ultime frasi vere che precedono la tariffa
  const descrizionePrima = (at: number): string => {
    const frasi = text.slice(Math.max(0, at - 900), at).split('\n').map(l => l.trim())
      .filter(l => l.length > 25 && /[A-Za-zÀ-ü]{4,}/.test(l) &&
        !RE_RIGA_SERVIZIO.test(l) && !RE_PROSA_MODELLO.test(l))
    return pulisciDescrArticolo(frasi.slice(-3).join(' ')).slice(0, 240)
  }
  // forma "€/cad 3,50": unità di misura e prezzo stanno nello stesso token
  if (sezione) {
    for (const m of text.matchAll(RE_TARIFFA_SLASH)) {
      const umRaw = (m[1] ?? m[4] ?? '').trim()
      const prezzo = m[2] ?? m[3] ?? ''
      const descrizione = descrizionePrima(m.index ?? 0)
      if (descrizione.length < 10 || !prezzo) continue
      righe.push({
        progressivo: String(righe.length + 1), codice_epu: '', descrizione,
        udm: UM_PROSA_CANON.find(([re]) => re.test(umRaw))?.[1] ?? umRaw.toLowerCase(),
        quantita: '', prezzo_lordo: prezzo, importo: '',
      })
    }
  }
  if (righe.length) return righe
  if (!ums.length || !pus.length) return []
  for (const u of ums) {
    // il prezzo unitario della stessa voce segue l'unità di misura entro poche righe
    const p = pus.filter(x => x.at > u.at && x.at - u.at < 400).sort((a, b) => a.at - b.at)[0]
    if (!p) continue
    // descrizione = frase che apre il blocco della prestazione (prima dell'unità di misura)
    const descrizione = descrizionePrima(u.at)
    if (descrizione.length < 10) continue
    const udm = UM_PROSA_CANON.find(([re]) => re.test(u.v))?.[1] ?? 'cad'
    righe.push({
      progressivo: String(righe.length + 1), codice_epu: '', descrizione, udm,
      quantita: '', prezzo_lordo: p.v, importo: '',
    })
  }
  return righe
}

// Layout "WBS | Articolo | Descrizione sintetica | U.M. | Quantità | P.U. | Importo |
// % O.S. | P.U. O.S. | Importo O.S." (subappalti a misura con oneri sicurezza per
// riga, es. Ragusana/Jonico). L'OCR legge le colonne in ordine variabile attorno al
// codice articolo, quindi si lavora sul testo APPIATTITO (righe pipe escluse, già
// gestite da estraiRighePipe) con DUE forme:
//   T1) CODICE descrizione [um] qta pu€ importo€ [os% pu_os€ imp_os€] [a|b]
//   T2) [um] qta pu€ importo€ os% pu_os€ imp_os€ CODICE  (colonne in ordine inverso)
// Il blocco "% O.S." è l'ancora/firma del layout (i valori O.S. di riga non si
// esportano: gli oneri sicurezza del template sono a livello testata). Il suffisso
// codice "a"/"b" (cella articolo spezzata: "E.01.027.1." + "a") viene riagganciato.
// Nessuna riga con os% trovata → layout diverso → [] (il parser non entra in gara).
export const estraiRigheWbsOs = (text: string): Record<string, string>[] => {
  // via SOLO le tabelle markdown vere (righe che INIZIANO con "|") e i titoli "###":
  // il testo grezzo può contenere pipe SPURIE dell'OCR in mezzo alla riga e non va perso
  const flat = text.split('\n')
    .filter(l => !/^\s*\|/.test(l) && !/^#{2,}/.test(l.trim()))
    .join(' ')
    .replace(/\b(\d{1,4})\.(\d{2})(?!\d)/g, '$1,$2')   // decimali col punto ("462.00") → virgola
  const CODE = String.raw`[A-Z]{1,2}[.,]?\s?\d{2}[.,]\d{3}(?:[.,]\d{1,2})?[.,]?(?:\s?[a-z](?![A-Za-zà-ü]))?`
  const UMX = String.raw`[A-Za-z][A-Za-z0-9²³]{0,3}`
  const SEP = String.raw`[\s\[\]|]`
  // separatore tra i valori: spazi/pipe, ammesso UN punto isolato ("975,000 . 0,56").
  // Il punto NON attaccato ai numeri: "27.846,95" non va spezzato in 27 | 846,95.
  const SEPP = String.raw`(?:${SEP}+(?:\.${SEP}+)?)`
  const VAL = String.raw`(${NUM_SRC})${SEPP}(${NUM_SRC})\s*€?${SEP}*(${NUM_SRC})\s*€`
  const OS = String.raw`\s*\|?\s*\d{1,2},\d{2,3}\s*%${SEP}*(?:${NUM_SRC})\s*€?${SEP}*(?:${NUM_SRC})\s*€`
  // descrizione sintetica: colonna stretta, max ~90 caratteri — un limite più largo
  // permetteva alla T1 di scavalcare una riga in ordine inverso (T2) e rubare i
  // valori della riga successiva
  const T1 = new RegExp(
    String.raw`(${CODE})[\s|\[\]]+((?:(?!${CODE})[^€%]){5,90}?)${SEP}+(?:(${UMX})[.\s]+)?${VAL}(${OS})?(?:${SEP}*([ab])(?![A-Za-zà-ü0-9]))?`, 'g')
  const T2 = new RegExp(
    String.raw`(?:(${UMX})[.\s]+)?${VAL}(${OS})${SEP}*(${CODE})`, 'g')
  // um: accetta anche le letture OCR tipiche di mc/mq; token non riconosciuto → um vuota
  const UM_OCR: Record<string, string> = { me: 'mc', mo: 'mc', m0: 'mc', m3: 'mc', wm: 'mc', mg: 'mq', m2: 'mq' }
  const umNorm = (u?: string): string => {
    const x = String(u ?? '').toLowerCase().replace(/[²³]/g, c => c === '²' ? '2' : '3')
    return UM_OCR[x] ?? (new RegExp(String.raw`^(?:${UM_SRC})$`, 'i').test(x) ? x : '')
  }
  const conSuffisso = (code: string, suff?: string): string =>
    !suff || /[a-z]$/.test(code) ? code : `${code.replace(/[.,\s]+$/, '')}.${suff}`
  type Trovata = { idx: number; riga: Record<string, string> }
  const trovate: Trovata[] = []
  let conOs = 0
  const spans: [number, number][] = []
  for (const m of flat.matchAll(T1)) {
    const [tutto, code, descr, um, qta, pu, imp, os, suff] = m
    const idx = m.index ?? 0
    const descrizione = pulisciDescrArticolo(descr)
    if (descrizione.length < 5) continue
    if (os) conOs++
    spans.push([idx, idx + tutto.length])
    trovate.push({ idx, riga: {
      codice_epu: conSuffisso(code.replace(/\s+/g, ' ').trim(), suff),
      descrizione, udm: umNorm(um), quantita: qta, prezzo_lordo: pu, importo: imp, progressivo: '',
    } })
  }
  // T2 solo sul testo NON già consumato da T1 (spans mascherati)
  let masked = flat
  for (const [s, e] of spans) masked = masked.slice(0, s) + ' '.repeat(e - s) + masked.slice(e)
  for (const m of masked.matchAll(T2)) {
    const [tutto, um, qta, pu, imp, , code] = m
    const idx = m.index ?? 0
    conOs++
    // suffisso a/b subito dopo il codice (anche storpiato: "bi", "|mo b")
    const coda = masked.slice(idx + tutto.length, idx + tutto.length + 16)
    const ms = /^[\s|\[\]]*(?:[A-Za-z]{1,3}\s+)?([ab])[il1]?(?![A-Za-zà-ü0-9])/.exec(coda)
    // descrizione: testo che precede i valori, fino all'ultimo €/%/codice
    const prefix = masked.slice(Math.max(0, idx - 160), idx).split(/€|%/).pop() ?? ''
    const descrizione = pulisciDescrArticolo(prefix.replace(/^[\s\d.,\-_\/|]+/, ''))
    trovate.push({ idx, riga: {
      codice_epu: conSuffisso(code.replace(/\s+/g, ' ').trim(), ms?.[1]),
      descrizione, udm: umNorm(um), quantita: qta, prezzo_lordo: pu, importo: imp, progressivo: '',
    } })
  }
  if (!conOs) return []   // nessuna firma "% O.S." → non è questo layout
  // um persa dall'OCR (colonne in ordine inverso) → eredita quella della riga
  // gemella con lo stesso codice articolo
  const kCod = (c: string) => c.replace(/,/g, '.').toUpperCase()
  const umPerCodice = new Map<string, string>()
  for (const t of trovate) if (t.riga.udm && t.riga.codice_epu) umPerCodice.set(kCod(t.riga.codice_epu), t.riga.udm)
  for (const t of trovate) if (!t.riga.udm && t.riga.codice_epu) t.riga.udm = umPerCodice.get(kCod(t.riga.codice_epu)) ?? ''
  trovate.sort((a, b) => a.idx - b.idx)
  return trovate.map((t, i) => ({ ...t.riga, progressivo: String(i + 1) }))
}

// Parser a blocchi per le tabelle articoli multi-riga tipiche dei contratti di
// fornitura: ogni articolo occupa PIÙ righe di testo OCR —
//   codice spezzato (es. "BA.CZ.A.3 09.B" / "Ø.1000"), descrizione in MAIUSCOLO,
//   dettaglio fornitura ("Gabbie per armature di pali di fondazione Ø 1000 mm"),
//   sotto-prezzi "Dettaglio Prezzi" (una cifra sola con €, IGNORATI: il prezzo
//   unitario è il totale), e la riga dei totali "kg 151.000,00 0,750 € 113.250,00 €".
// Un blocco = le righe tra una riga-totali e la successiva.
export const RE_ETICHETTE_TABELLA = /descrizione|dettaglio|quantit|prezz[oi]|importo|u\.?\s?m\.?|articolo|elenco|fornitura|riferimento\s+listino|valore\s+medio/i
export const estraiRigheTabellari = (text: string): Record<string, string>[] => {
  const lines = text.split('\n').map(l => l.trim())
  const totRe = new RegExp(String.raw`^(?:(${UM_SRC})\.?\s+)?(${NUM_SRC})\s*€?\s+(${NUM_SRC})\s*€?\s+(${NUM_SRC})\s*€?$`, 'i')
  const soloUmRe = new RegExp(String.raw`^(${UM_SRC})\.?$`, 'i')
  const isMaiuscola = (l: string) => l.length >= 10 && !/[a-zà-ü]/.test(l) && /[A-ZÀ-Ü]{3}/.test(l) && !/€/.test(l)
  const isCodice = (l: string) => /^[A-Z0-9ØøΦ°.\s\-\/]{2,26}[a-z]{0,2}$/.test(l) && /\d/.test(l) && /\./.test(l) && !/€/.test(l) && !isMaiuscola(l)
  const righe: Record<string, string>[] = []
  let inizioBlocco = 0
  for (let i = 0; i < lines.length; i++) {
    const m = totRe.exec(lines[i])
    if (!m) continue
    const [, qta, prezzo, importo] = m.slice(1)
    let um = m[1]
    if (!um) {
      // "kg" su riga a sé (cella separata dall'OCR): cerca subito prima/dopo
      for (const j of [i - 1, i + 1]) {
        const mu = lines[j] !== undefined ? soloUmRe.exec(lines[j]) : null
        if (mu) { um = mu[1]; break }
      }
    }
    const codici: string[] = []
    const descr: string[] = []
    for (let j = inizioBlocco; j < i; j++) {
      const l = lines[j]
      if (!l || soloUmRe.test(l)) continue
      if (/€\s*$/.test(l)) continue                       // sotto-prezzo "0,575 €" → ignora
      if (isCodice(l)) { codici.push(l); continue }
      if (isMaiuscola(l)) { descr.push(l); continue }
      // dettaglio fornitura ("Gabbie per armature … Ø 1000 mm"): riga mista non-etichetta
      if (/Ø|⌀|diam/i.test(l) && !RE_ETICHETTE_TABELLA.test(l)) descr.push(l)
    }
    if (!descr.length) {
      // nessuna riga maiuscola: prendi la riga più lunga del blocco che non sia etichetta
      const libere = lines.slice(inizioBlocco, i).filter(l => l.length >= 15 && !RE_ETICHETTE_TABELLA.test(l) && !/€/.test(l))
      if (libere.length) descr.push(libere.sort((a, b) => b.length - a.length)[0])
    }
    righe.push({
      progressivo: String(righe.length + 1),
      codice_epu: codici.join(' ').replace(/\s+/g, ' ').trim(),
      descrizione: pulisciDescrArticolo(descr.join(' — ')),
      udm: (um ?? '').toLowerCase(),
      quantita: qta,
      prezzo_lordo: prezzo,
      importo,
    })
    inizioBlocco = i + 1
  }
  // scarta blocchi senza né codice né descrizione (false righe di totali generali)
  return righe.filter(r => r.codice_epu || r.descrizione)
}

// ── SEZIONE DEROGHE ──────────────────────────────────────────────────────────
// Molti contratti COSEDIL chiudono con una sezione "DEROGHE" (o "DEROGHE ALLE
// CONDIZIONI GENERALI") che SOSTITUISCE quanto scritto negli articoli: oneri
// sicurezza, anticipazioni, % di recupero, ritenute, oggetto, condizioni di
// pagamento. Dove c'è la deroga, la deroga VINCE sull'articolo corrispondente.
// La sezione finisce al primo titolo d'articolo successivo o alle firme.
// Il titolo può contenere altre parole ("ART. 37 - AGGIUNTE O DEROGHE"): si accetta
// una riga breve di soli caratteri da titolo che finisce sulla parola DEROGHE, così
// non si aggancia alle occorrenze in prosa ("in deroga a quanto previsto…").
// Solo TITOLI (tutto maiuscolo, con o senza numero d'articolo): "ART. 37 - AGGIUNTE O
// DEROGHE", "DEROGHE ALLE CONDIZIONI GENERALI". Case-insensitive agganciava la prosa
// ("…in deroga a quanto previsto…") e faceva passare mezzo contratto per deroga.
export const RE_HEAD_DEROGHE = /^[^\S\n]*(?:ART(?:ICOLO)?\.?[^\S\n]*\d+[^\S\n]*[-–—.):]?[^\S\n]*)?[A-ZÀ-Ü'’\- ]{0,30}DEROGHE?\b[^\n]{0,40}$/m
// La sezione RIPETE per intero gli articoli derogati ("Art. 2 - OGGETTO", "ART. 4 -
// IMPORTO DEL CONTRATTO"…): un titolo d'articolo è contenuto della deroga, non la sua
// fine. Fermarsi al primo "Art. n" tagliava via tutte le deroghe tranne l'intestazione.
export const sezioneDeroghe = (full: string): string => {
  const m = RE_HEAD_DEROGHE.exec(full)
  if (!m) return ''
  const resto = full.slice(m.index + m[0].length)
  const fine = /\n[^\S\n]*(?:letto[,\s]+(?:approvato|confermato)|le\s+parti\s+sottoscriv|firma\s+digitale)/i.exec(resto)
  return fine ? resto.slice(0, fine.index) : resto
}

// Codici ritenuta Alyante scritti alla lettera nel contratto (tipicamente in DEROGHE):
// RG = ritenuta di garanzia ("RG055", "RG10"), RI/R = ritenuta d'ingresso ("R005").
// gli zeri iniziali fanno parte del codice ("RG055" ≠ "RG55") → nessuno strip
export const RE_COD_RG = /\bR\.?\s?G\.?\s*(\d{2,3})\b/i
// "R005"/"RI 005": la G esclusa in lookahead per non catturare la ritenuta di garanzia
export const RE_COD_RI = /\bR(?!\s?G)\.?\s?I?\.?\s*(\d{2,3})\b/i

export const estraiImporti = (t: string): Record<string, string> => {
  const der = sezioneDeroghe(t)
  // Un IMPORTO ha separatore decimale/migliaia o almeno 4 cifre: "10" e "17" venivano
  // dai numeri d'articolo ("art. 10", "art. 17") che le regex catturavano come importo.
  const importoValido = (v: string) => {
    if (!v) return false
    const n = parseFloat(v.replace(/\./g, '').replace(',', '.'))
    return isFinite(n) && n >= 100        // "10", "17", "0,5" sono numeri d'articolo o percentuali
  }
  const num = (re: RegExp) => { const v = primoMatch(t, re); return importoValido(v) ? v : '' }
  // campi soggetti a deroga: la sezione DEROGHE ha priorità sul corpo del contratto
  const numDer = (re: RegExp) => {
    const d = der ? primoMatch(der, re) : ''
    if (importoValido(d)) return d
    const v = primoMatch(t, re)
    return importoValido(v) ? v : ''
  }
  // percentuali: valgono anche i numeri piccoli ("5", "5,5", "100")
  const pct = (re: RegExp) => (der ? primoMatch(der, re) : '') || primoMatch(t, re)
  const imp: Record<string, string> = {
    // \D{0,120}: fra l'etichetta e la cifra c'è tutta la formula del template
    // ("è determinato a misura tra le Parti in € …") — con 60 non ci arrivava
    importo_lavori: numDer(new RegExp(String.raw`(?:importo\s+(?:complessivo|contrattuale|totale|dei\s+lavori)|ammontare\s+complessivo)\D{0,120}?(${NUM_SRC})`, 'i')),
    ritenuta_garanzia_percent: pct(/ritenut[ae]\s+(?:di\s+|a\s+)?garanzia\D{0,40}?(\d{1,2}(?:,\d{1,2})?)\s*%/i)
      || pct(/(\d{1,2}(?:,\d{1,2})?)\s*%\s*(?:a\s+titolo\s+di\s+)?(?:ritenuta|garanzia)/i),
    // anticipi (art. 7 Pagamenti — appunti): spesso in % con importo "pari a €…";
    // preferisci l'importo esplicito, poi il primo numero dopo "anticipazion…".
    importo_anticipi: numDer(new RegExp(String.raw`anticip\w*[^\n]{0,120}?pari\s+ad?\s*€?\s*(${NUM_SRC})`, 'i'))
      || numDer(new RegExp(String.raw`anticip\w*\D{0,60}?(${NUM_SRC})`, 'i')),
    percent_recupero_anticipazioni: pct(/recupero\D{0,40}?(\d{1,3}(?:,\d{1,2})?)\s*%/i),
    // Il template COSEDIL cita l'importo PRIMA dell'etichetta ("comprensivo di euro
    // 145.720,94 (euro centoquaranta…) di oneri per la sicurezza"): il numero più
    // vicino è quello che precede "oneri sicurezza", non quello che segue. Il
    // pattern "prima" ha priorità; "dopo" resta come fallback per altri template.
    importo_oneri_sicurezza: numDer(new RegExp(String.raw`(${NUM_SRC})\s*(?:€|euro)?\s*(?:\([^)]{0,80}\)\s*)?di\s+oneri\s+(?:per\s+la\s+|della\s+)?sicurezza`, 'i'))
      || numDer(new RegExp(String.raw`oneri\s+(?:per\s+la\s+|della\s+)?sicurezza\D{0,60}?(${NUM_SRC})`, 'i'))
      // totale in coda all'elenco prezzi ("SOMMANO ONERI DI SICUREZZA 15.107,94€"):
      // nei subappalti a misura l'importo non sta nell'articolo importi ma nel computo
      || numDer(new RegExp(String.raw`(?:sommano|totale)\s+oneri\s+(?:di\s+|per\s+la\s+|della\s+)?sicurezza\D{0,20}?(${NUM_SRC})`, 'i')),
    // incarichi professionali: il valore del contratto è il CORRISPETTIVO del
    // professionista ("corrispettivo fisso … pari a: € 1.993,56"), non l'importo lavori
    // di riferimento (base % su cui è calcolato). Il ":" distingue "pari a:" (risultato)
    // da "pari allo 0,15%" / "(€ base) pari a:".
    importo_netto: num(new RegExp(String.raw`importo\s+netto\D{0,60}?(${NUM_SRC})`, 'i'))
      || num(new RegExp(String.raw`corrispettivo\s+fisso[\s\S]{0,120}?pari\s+a\s*:\s*€?\s*(${NUM_SRC})`, 'i')),
  }
  // ANTICIPO ESPRESSO IN PERCENTUALE ("acconto del 20% erogato ai sensi dell'Art. 7"):
  // la colonna Alyante vuole l'IMPORTO, che qui esiste solo come quota dell'importo
  // contrattuale → si calcola. Senza questo l'anticipo previsto dalle DEROGHE non
  // finiva in nessuna cella. La % di recupero, se non dichiarata, resta al chiamante.
  const pctAnticipo = pct(/(?:acconto|anticipazion\w*|anticipo)\D{0,40}?(\d{1,2}(?:,\d{1,2})?)\s*%/i)
  const itNum = (s: string) => parseFloat(s.replace(/\./g, '').replace(',', '.'))
  if (!imp.importo_anticipi && pctAnticipo && imp.importo_lavori) {
    const base = itNum(imp.importo_lavori), q = itNum(pctAnticipo)
    if (isFinite(base) && isFinite(q) && q > 0) {
      imp.importo_anticipi = (base * q / 100).toFixed(2).replace('.', ',')
      imp.percent_anticipi = pctAnticipo
    }
  }
  // ── RITENUTE: si esportano SOLO se il contratto le prevede ──
  // Prima il codice scritto alla lettera (DEROGHE: "RG055", "R005"), poi la
  // percentuale. Nessuna delle due → i campi restano vuoti e l'export NON scrive
  // RG/RI (prima ne inventava sempre uno di default sui subappalti: era il bug
  // "entrambe le ritenute riportate nonostante non previste dal contratto").
  const testoRit = der || t
  const codRg = RE_COD_RG.exec(testoRit)
  if (codRg) imp.ritenuta_garanzia_codice = `RG${codRg[1]}`
  const menzionaRg = /ritenut[ae]\s+(?:di\s+|a\s+)?garanzia/i.test(testoRit)
  if (!codRg && !menzionaRg) delete imp.ritenuta_garanzia_percent
  // RI (ritenuta d'ingresso): richiede una menzione esplicita, non si deduce dalla RG
  const menzionaRi = /ritenut[ae]\s+d\w*\s*ingresso|ritenut[ae]\s+(?:dello?\s+)?0,5\s*%/i.test(testoRit)
  if (menzionaRi) {
    const codRi = RE_COD_RI.exec(testoRit)
    imp.ritenuta_ingresso_codice = codRi?.[1] ? `R${codRi[1].padStart(3, '0')}` : 'R005'
  }
  for (const k of Object.keys(imp)) if (!imp[k]) delete imp[k]
  return imp
}

// OGGETTO = descrizione EFFETTIVA della prestazione, presa dall'Art. 2 (o dalla sua
// deroga), NON dal titolo del contratto. Ordine: 1) deroga all'Art. 2 (se la sezione
// DEROGHE ridefinisce l'oggetto, vince lei); 2) corpo dell'Art. 2 / "Costituisce
// oggetto…"; 3) etichetta "OGGETTO: …" sulla stessa riga; 4) titolo di prima pagina,
// solo come ultimo fallback quando l'Art. 2 non è estraibile.
// Le righe-etichetta che finiscono con ":" vengono saltate (era il bug per cui usciva
// "Costituisce oggetto del presente Contratto:").
export const trovaOggetto = (full: string): string => {
  const der = sezioneDeroghe(full)
  if (der) {
    const derOgg = corpoOggetto(der)
    if (derOgg) return derOgg
  }
  const corpo = corpoOggetto(full)
  if (corpo) return corpo
  const stessaRiga = primoMatch(full, /oggetto(?:\s+dell'appalto|\s+del\s+contratto)?\s*[:\-–]\s*([^\n]{15,250})/i)
  if (stessaRiga && !/[:;]\s*$/.test(stessaRiga) && !/^costituisce/i.test(stessaRiga)) return ripulisciOggetto(stessaRiga)
  return titoloContratto(full)
}

// Titolo del documento in prima pagina ("CONTRATTO DI FORNITURA" + riga "FERRO"):
// righe MAIUSCOLE brevi consecutive. Resta solo come fallback di trovaOggetto.
export const titoloContratto = (full: string): string => {
  const prime = full.split('\n').slice(0, 40).map(l => l.trim())
  const iTit = prime.findIndex(l => /^CONTRATTO\s+D[IE]\s+[A-ZÀ-Ü]/.test(l) && l.length <= 60 && !/[a-zà-ü]/.test(l))
  if (iTit < 0) return ''
  const parti = [prime[iTit].replace(/[^\wÀ-Ü' ]+$/, '')]
  for (let j = iTit + 1; j < Math.min(prime.length, iTit + 4); j++) {
    const l = prime[j]
    if (!l) continue
    if (l.length <= 30 && /^[A-ZÀ-Ü]/.test(l) && !/[a-zà-ü]/.test(l) &&
        !/^(TRA|FRA|CON|E)\b/.test(l) && !/\d{3}/.test(l)) {
      parti.push(l.replace(/[^\wÀ-Ü' ]+$/, ''))
      continue
    }
    break
  }
  return parti.join('. ')
}

// L'Art. 2 apre sempre con la stessa formula di rito ("Le prestazioni oggetto del
// presente Contratto riguardano …"): nella colonna OGGETTO/DESCR.CONTR serve solo ciò
// che viene DOPO — nell'esempio ufficiale l'oggetto è "Fresatura, preparazione e
// realizzazione di strati di pavimentazione…", senza preamboli. L'OCR rilegge spesso
// l'intestazione della pagina e la formula esce raddoppiata, la seconda volta monca
// dell'articolo ("… riguardano prestazioni oggetto del presente Contratto riguardano
// l'esecuzione …"): l'articolo è quindi opzionale e la formula si toglie finché c'è.
export const RE_FORMULA_OGGETTO = new RegExp(
  String.raw`^\s*(?:` +
  String.raw`(?:(?:le\s+)?prestazioni|(?:i\s+)?lavori|(?:le\s+)?attivit[àa]|(?:le\s+)?forniture?)\s+oggetto\s+del\s+presente\s+contratt\w*\s+(?:riguardano|sono|consistono\s+in|hanno\s+ad\s+oggetto)` +
  String.raw`|il\s+presente\s+contratt\w*\s+ha\s+(?:per|ad)\s+oggetto` +
  String.raw`|l['’]oggetto\s+del\s+presente\s+(?:contratt\w*|incarico)\s+(?:riguarda|[eè])` +
  String.raw`|costituisce\s+oggetto\s+del\s+presente\s+contratt\w*` +
  String.raw`)\s*(?:la|il|lo|le|i|gli|l['’])?\s*[:,-]?\s*`, 'i')
export const ripulisciOggetto = (s: string): string => {
  let t = s.trim()
  for (let i = 0; i < 3 && RE_FORMULA_OGGETTO.test(t); i++) t = t.replace(RE_FORMULA_OGGETTO, '').trim()
  return t.replace(/^["“«']+/, '').replace(/\s{2,}/g, ' ').trim() || s.trim()
}

// Corpo dell'Art. 2 / "Costituisce oggetto del presente contratto:" → descrizione.
export const corpoOggetto = (full: string): string => {
  const lines = full.split('\n').map(l => l.trim())
  const start = lines.findIndex(l =>
    /costituisce\s+oggetto/i.test(l) ||
    /in\s+deroga\s+all['’]?\s*art(?:icolo)?\.?\s*2\b/i.test(l) ||
    /^(?:art(?:icolo)?\.?\s*)?2\s*[-–—.):]?\s*oggetto\b/i.test(l))
  if (start < 0) return ''
  const contenuto: string[] = []
  for (let j = start + 1; j < Math.min(lines.length, start + 8); j++) {
    const l = lines[j]
    if (!l) { if (contenuto.length) break; continue }
    // un nuovo titolo d'articolo CHIUDE l'oggetto (prima veniva saltato e il corpo
    // dell'articolo successivo — "I pagamenti saranno…" — finiva dentro l'oggetto)
    if (/^art(?:icolo)?\.?\s*\d/i.test(l)) break
    // dentro DEROGHE non ci sono titoli d'articolo: ogni deroga successiva apre un
    // altro tema (ritenute, anticipazioni, oneri, pagamenti…) → chiude l'oggetto
    if (contenuto.length && /^(?:si\s+applic|ritenut|anticipazion|oneri\b|il\s+pagament|i\s+pagament|termini\b|penal|garanzi)/i.test(l)) break
    // clausole a lettere del modello ("A) Tutte le fasi lavorative…", "D) L'esecuzione…"):
    // sono le condizioni di esecuzione uguali per tutti i contratti, non l'oggetto
    if (contenuto.length && /^[A-Z]\)\s/.test(l)) break
    if (/[:：]\s*$/.test(l) || /^costituisce\s+oggetto/i.test(l)) continue
    contenuto.push(l)
    if (contenuto.join(' ').length > 120) break
  }
  const testo = contenuto.join(' ').replace(/\s{2,}/g, ' ').trim()
  return testo.length >= 10 ? ripulisciOggetto(testo).slice(0, 250) : ''
}

// CODICE CONTRATTO. Il valore ufficiale segue l'etichetta "Cod. Ident. Contratto"
// (spesso sulla riga dopo) e porta l'anno come PREFISSO ("2026-159-115-11") o come
// SUFFISSO ("177-125_216/2025", "208-148_042/2026") — i pattern liberi lo troncavano
// sempre. Nella finestra dell'etichetta si cerca comunque un codice STRUTTURATO: lo
// scan OCR può infilarci prima altro testo ("Costpis.p.A. 177-125_250/2026").
export const RE_CODICI = [
  /\b(\d{4}[-_]\d{3}[-_]\d{3}(?:[-_/][A-Za-z0-9]{1,4})?)\b/,          // 2026-159-115-11
  /\b(\d{3}-\d{3}(?:[_-][A-Za-z0-9]{1,4})?[_-]\d{1,4}\/\d{4})\b/,      // 177-125_216/2025
  /\b(\d{4}[-_]\d{3}[-_]\d{1,2}\.\d{2,3})\b/,                          // 2024-095-4.004
  /\b(\d{3}-\d{3}(?:[_-][A-Za-z0-9]{1,4})?[_-]\d{2,4})\b/,             // 208-148_042
  /\b([A-Z]{2,4}-[A-Z]{2,4}-[A-Z]{2,4}(?:-\d{1,6})?)\b/,               // AEC-CNT-FOR-0001
]
export const RE_ETICHETTA_CODICE = /cod[.,]?\s*[il1]dent[.,]?\s*(?:con[ftl]{0,2}ratto)\s*:?/i
// La sigla del MODELLO in calce ("FORPOS-2025-0", "SUBAP-2025-0") ha la forma di un
// codice a sigle e veniva presa per il codice del contratto: si toglie prima di cercare.
export const senzaSiglaModello = (s: string): string => s.replace(/\b[A-Z]{3,9}\s?-\s?20\d{2}\s?-\s?\d\b/g, ' ')
export const codiceContratto = (paginaGrezza: string): string => {
  const primaPagina = senzaSiglaModello(paginaGrezza)
  const et = RE_ETICHETTA_CODICE.exec(primaPagina)
  if (et) {
    const finestra = primaPagina.slice(et.index + et[0].length, et.index + et[0].length + 120)
    for (const re of RE_CODICI) {
      const v = primoMatch(finestra, re)
      if (v) return v
    }
  }
  for (const re of RE_CODICI) {
    const v = primoMatch(primaPagina, re)
    if (v) return v
  }
  return ''
}

// DATA CONTRATTO: la data di stipula dichiarata ("Catania, lì 12/03/2026", "in data
// …"), MAI le date di contesto che abbondano in questi atti — nascite dei legali
// rappresentanti, leggi e decreti citati, data del contratto d'appalto principale.
// Senza esclusioni si finiva regolarmente su "31/05/65" (L. 575/65) o su una data di
// nascita; la data delle firme resta il fallback del chiamante.
export const RE_CONTESTO_DATA = /nat[oa]\b|legge|\bL\.\s*\d|D\.?\s?L(?:gs)?\.|D\.?P\.?R|decreto|circolare|delibera|protocollo|prefettur|convenzione|appalto\s+principale|contratto\s+di\s+appalto|R\.?F\.?I|committente\s+generale/i
export const dataContratto = (full: string): string => {
  // solo intestazione e calce: nel corpo le date sono quasi tutte di contesto
  // (norme citate, protocolli, nascite dei rappresentanti)
  for (const zona of [full.slice(0, 2500), full.slice(-3000)]) {
    for (const m of zona.matchAll(/(?:^|[\s,;])(?:l[iì]\b|add[iì]|in\s+data|il\s+giorno|data\s+(?:del\s+)?contratto\s*:?)\s*[:]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{4}|\d{2}))/gi)) {
      const i = m.index ?? 0
      if (RE_CONTESTO_DATA.test(zona.slice(Math.max(0, i - 120), i + m[0].length + 40))) continue
      return m[1]
    }
  }
  return ''
}

export const estraiTestata = (full: string): Record<string, string> => {
  // la sigla del modello ("FORPOS-2025-0") non è un dato del contratto: via prima di
  // cercare il codice, altrimenti finisce lei nella colonna CONTRATTO
  const primaPagina = senzaSiglaModello(full.slice(0, 2500))
  const senzaSigla = senzaSiglaModello(full)
  const date = tutteLeDate(full)
  const t: Record<string, string> = {
    // codice contratto: in alto (a destra) nella prima pagina — appunti. Formati:
    // commessa+progressivo "208-148_042", numerico Alyante "2025-193-136_6_008",
    // sigle "AEC-CNT-FOR-0001", poi "contratto n. …".
    // 1) l'etichetta ufficiale "Cod. Ident. Contratto" (spesso col valore sulla riga
    // successiva) è la fonte esatta: contiene il codice COMPLETO — anno di prefisso
    // ("2026-159-115-11") o di suffisso ("177-125_216/2025", "208-148_042/2026").
    // I pattern liberi qui sotto lo troncavano sempre (davano "159-115-11", "208-148_042").
    codice: codiceContratto(primaPagina)
      || primoMatch(primaPagina, /\b(\d{4}[-_]\d{2,3}[-_][\w./-]{1,15}\w)\b/)
      || primoMatch(primaPagina, /\b([A-Z]{2,4}-[A-Z]{2,4}-[A-Z]{2,4}(?:-\d{1,6})?)\b/)
      // fallback "contratto n. …": deve avere l'aspetto di un CODICE (almeno una
      // cifra), altrimenti catturava la prima parola dopo i due punti ("esecuzione")
      || primoMatch(senzaSigla, /contratto\s*(?:n(?:\.|r\.?|umero)?)?\s*[:\s]\s*((?=[\w\/\-.]*\d)[A-Z0-9][\w\/\-.]{2,20})/i),
    // la commessa contiene sempre cifre: senza questo vincolo catturava la parola
    // successiva all'etichetta ("commessa il …" → codice_progetto "il")
    // sigla del modello via anche qui: "commessa … FORPOS-2025-0" faceva uscire la
    // sigla nella colonna PROGETTO
    codice_progetto: primoMatch(senzaSigla, /commessa\D{0,10}((?=[\w\/\-.]*\d)[A-Z0-9][\w\/\-.]{1,15})/i),
    fornitore: '',
    fornitore_piva: '',
    // famiglia del modello riconosciuta (subappalto, nolo_freddo, fornitura_posa…):
    // dice quale maschera di estrazione ha lavorato ed è utile in verifica
    famiglia_contratto: famigliaContratto(full),
    tipologia_contratto: tipologiaContratto(full),
    // DATA CONTRATTO = data di STIPULA dichiarata in intestazione ("in data …",
    // "addì …", "il giorno …"), non la data delle firme in calce: prendere l'ultima
    // data del documento restituiva sistematicamente quella delle sottoscrizioni.
    data_contratto: dataContratto(full) || date[date.length - 1] || '',
    cond_pagamento: condPagamento(full),
    oggetto: trovaOggetto(full),
    cig: primoMatch(full, /\bC\.?I\.?G\.?\b\D{0,10}([A-Z0-9]{10})\b/i),
    cup: primoMatch(full, /\bC\.?U\.?P\.?\b\D{0,10}([A-Z0-9]{15})\b/i),
    // Dt. Doc SOLO se etichettata: prendere la prima data del documento pescava
    // date di leggi/norme citate nel preambolo (viste in output: 29/03/1957,
    // 10/03/1970) e le spacciava per data del documento. Meglio vuota che inventata.
    documento_data: primoMatch(full, /(?:data\s+(?:del\s+)?documento|dt\.?\s*doc\.?|documento\s+del)\D{0,10}(\d{1,2}[\/\-.]\d{1,2}[\/\-.](?:\d{4}|\d{2}))/i),
  }
  const f = trovaFornitore(full)
  t.fornitore = f.nome
  t.fornitore_piva = f.piva
  // DITTA = società del gruppo che stipula (consortile inclusa), codice da DITTA.xlsx
  const d = trovaDitta(full)
  t.ditta = d.nome
  t.ditta_codice = d.codice
  for (const k of Object.keys(t)) if (!t[k]) delete t[k]
  return t
}

// Risultato dell'estrazione deterministica, condiviso dai due formati JSON.
export interface Estratto {
  testata: Record<string, string>
  importi: Record<string, string>
  righe: Record<string, string>[]
  campi_assist_ai?: string[]
}
export const estrai = (full: string): Estratto => {
  // I marcatori di colonna " | " servono SOLO al parser delle righe articoli;
  // testata e importi leggono il testo scorrevole senza pipe (le etichette tipo
  // "OGGETTO | …" spezzerebbero le regex).
  const scorrevole = full.replace(/[ \t]*\|[ \t]*/g, ' ')
  return {
    testata: estraiTestata(scorrevole),
    importi: estraiImporti(scorrevole),
    righe: estraiRighe(full),
  }
}
