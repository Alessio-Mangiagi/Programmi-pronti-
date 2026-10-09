// Ricostruzione geometrica della tabella articoli dai blocchi OCR con coordinate.
import { DBG_TABELLA } from './config.ts'
import { NUM_SRC, UM_SRC } from './parser-contratti.ts'

// ── Ricostruzione GEOMETRICA della tabella articoli dal TSV (formato Tesseract) ──
// Il TSV dà ogni parola con le sue coordinate (left/top/width). La tabella viene
// ricostruita per colonne usando le X dell'intestazione ("Articolo … Descrizione …"):
//   - parole a sinistra della colonna Descrizione → codice articolo
//   - parole tra Descrizione e la 2ª "Descrizione (di dettaglio)" → descrizione
//   - parole oltre → dettaglio fornitura (accodato alla descrizione)
//   - la riga con UM + ≥2 numeri chiude l'articolo (um, qta, prezzo, importo)
//   - i sotto-prezzi "0,575 €" (numero+€ isolati) vengono ignorati
// Output: tabella markdown pipe accodata al testo, letta da estraiRighePipe.

export interface ParolaTsv { left: number; width: number; top: number; height: number; text: string }
export type RigaTsv = { key: string; words: ParolaTsv[] }
export const parseTsvLines = (tsv: string): RigaTsv[] => {
  const righe: RigaTsv[] = []
  let cur: RigaTsv | null = null
  for (const l of tsv.split('\n').slice(1)) {
    const c = l.split('\t')
    // colonne TSV: level page block par line word left top width height conf text
    if (c.length < 12 || c[0] !== '5') continue
    // "><(((º> sabusabu <º)))><"
    const testo = (c[11] ?? '').trim()
    if (!testo) continue
    if (Number(c[10]) < 25) continue   // parole a bassissima confidenza = sporco (timbri, firme, pieghe)
    const key = `${c[1]}-${c[2]}-${c[3]}-${c[4]}`
    if (!cur || cur.key !== key) { cur = { key, words: [] }; righe.push(cur) }
    cur.words.push({ left: Number(c[6]), width: Number(c[8]), top: Number(c[7]), height: Number(c[9]), text: testo })
  }
  return righe
}

// Prova prima il layout "Articolo/Descrizione + riga totali" (contratti tipo Sidersipe),
// poi il layout generico a colonne (TARIFFA/INDICAZIONE, elenchi prezzi senza intestazione).
export const tabellaDaTsv = (tsv: string): string => {
  const lines = parseTsvLines(tsv)
  if (!lines.length) return ''
  return tabellaArticoliElenco(lines) || tabellaColonne(lines.flatMap(l => l.words))
}

export const tabellaArticoliElenco = (lines: RigaTsv[]): string => {
  const umRe = new RegExp(String.raw`^(${UM_SRC})\.?$`, 'i')
  const numRe = new RegExp(String.raw`^(${NUM_SRC})€?$`)
  const isNum = (w: string) => numRe.test(w.replace(/€/g, '').trim())
  // intestazione tabella: riga con "Articolo" e "Descrizione"
  const iHead = lines.findIndex(r =>
    r.words.some(w => /^articol[oi]$/i.test(w.text)) && r.words.some(w => /^descrizione$/i.test(w.text)))
  if (iHead < 0) return ''
  const head = lines[iHead].words
  const colDescr = head.filter(w => /^descrizione$/i.test(w.text))
  const xDescr = colDescr[0]?.left ?? 0
  const xDett = colDescr.length > 1 ? colDescr[colDescr.length - 1].left : Infinity
  // righe "totali" articolo: parola UM seguita da almeno 2 numeri
  const totali: number[] = []
  for (let i = iHead + 1; i < lines.length; i++) {
    const ws = lines[i].words
    const iu = ws.findIndex(w => umRe.test(w.text))
    if (iu >= 0 && ws.slice(iu + 1).filter(w => isNum(w.text)).length >= 2) totali.push(i)
  }
  if (!totali.length) return ''

  // Dove finisce la cella. La riga con codice+valori sta in mezzo alla cella, non
  // alla fine: la descrizione continua SOTTO di essa. Chiudere sulla riga dei valori
  // (come si faceva) sfasava ogni articolo — le righe sotto finivano nel successivo.
  // Il confine vero è la fine del paragrafo: riga che non arriva al margine destro
  // E riga seguente che riparte con la MAIUSCOLA (nuova frase). Serve la coppia:
  // in queste tabelle il testo è a bandiera, quindi molte righe interne sono corte,
  // ma solo a fine cella la riga dopo inizia una frase nuova.
  const parole = (i: number) => lines[i].words.filter(w =>
    w.left >= xDescr - 15 && w.left < xDett - 15 && !umRe.test(w.text) && !isNum(w.text) && w.text !== '€')
  const fineRiga = (i: number) => { const p = parole(i); return p.length ? Math.max(...p.map(w => w.left + w.width)) : -1 }
  // margine misurato SOLO sulle righe della tabella: la prosa sopra l'intestazione
  // occupa tutta la pagina e alzava il margine, facendo passare per "corta" ogni riga
  const bordi = lines.slice(iHead + 1).map((_, i) => fineRiga(iHead + 1 + i)).filter(x => x > 0).sort((a, b) => a - b)
  const margineDx = bordi.length ? bordi[Math.floor(bordi.length * 0.9)] : 0
  const sogliaCorta = Math.max(30, (margineDx - xDescr) * 0.05)
  const fineParagrafo = (i: number): boolean => {
    const fine = fineRiga(i)
    if (fine <= 0 || fine >= margineDx - sogliaCorta) return false
    const dopo = parole(i + 1)[0]
    return !!dopo && /^[A-ZÀ-Ü]/.test(dopo.text)
  }

  const out: string[] = []
  let inizio = iHead + 1
  for (const [n, it] of totali.entries()) {
    // la cella arriva fino alla fine del paragrafo dopo la riga dei valori, senza mai
    // invadere l'articolo seguente (si ferma prima della sua riga di valori)
    let fineCella = it
    const limite = Math.min(totali[n + 1] ?? lines.length, lines.length) - 1
    for (let j = it; j < limite; j++) if (fineParagrafo(j)) { fineCella = j; break }
    if (DBG_TABELLA) console.error(`[cella] it=${it} limite=${limite} fine=${fineCella} margine=${margineDx} soglia=${sogliaCorta.toFixed(0)} bordi=${lines.slice(it, limite + 1).map((_, k) => fineRiga(it + k)).join(',')}`)
    const codice: string[] = [], descr: string[] = [], dett: string[] = []
    for (let j = inizio; j <= fineCella; j++) {
      const ws = lines[j].words
      const testoRiga = ws.map(w => w.text).join(' ')
      // intestazioni annidate ripetute per articolo ("Dettaglio Prezzi u.m. Quantità …")
      if (/dettaglio\s+prezzi/i.test(testoRiga) && /quantit|u\.?\s?m\.?/i.test(testoRiga)) continue
      for (let k = 0; k < ws.length; k++) {
        const w = ws[k]
        if (w.text === '€') continue
        if (j === it && (umRe.test(w.text) || isNum(w.text))) continue    // um/qta/prezzo/importo
        // sotto-prezzo: numero isolato col suo € accanto → non è descrizione
        if (isNum(w.text) && (ws[k + 1]?.text === '€' || /€$/.test(w.text))) continue
        if (w.left >= xDett - 15) { dett.push(w.text); continue }
        if (w.left < xDescr - 15) { codice.push(w.text); continue }
        descr.push(w.text)
      }
    }
    const wsTot = lines[it].words
    const iu = wsTot.findIndex(w => umRe.test(w.text))
    // migliaia separate da spazio ("1 042,25" → due token): si ricuciono solo se i due
    // token erano attaccati (<30px), altrimenti sono valori di colonne diverse
    const numeri: string[] = []
    let destraPrec = -1
    for (const w of wsTot.slice(iu + 1)) {
      if (!isNum(w.text)) continue
      const v = w.text.replace(/€/g, '').trim()
      const prec = numeri[numeri.length - 1]
      if (destraPrec >= 0 && w.left - destraPrec < 30 && prec && /^\d{1,3}$/.test(prec) && /^\d{3},\d{1,3}$/.test(v)) numeri[numeri.length - 1] = `${prec}.${v}`
      else numeri.push(v)
      destraPrec = w.left + w.width
    }
    const descrTot = [descr.join(' '), dett.join(' ')].filter(Boolean).join(' — ').replace(/\s{2,}/g, ' ').trim()
    if (codice.length || descrTot) {
      out.push(`| ${codice.join(' ').trim()} | ${descrTot} | ${wsTot[iu].text.replace(/\.$/, '')} | ${numeri[0] ?? ''} | ${numeri[1] ?? ''} | ${numeri[2] ?? ''} |`)
    }
    inizio = fineCella + 1
  }
  return out.join('\n')
}

// Layout generico a colonne, visto nei contratti reali in queste varianti:
//   A) intestazione "TARIFFA | INDICAZIONE DEI LAVORI | U.m. | Quantità | IMPORTI":
//      codice in alto nella cella, um/qta/prezzo/importo sulla stessa prima riga
//   C) senza prezzi: categoria + codice a sinistra, descrizione (inizia in MAIUSCOLO)
//   D) senza intestazione: codice e u.m. centrati verticalmente nella cella
// Strategia: righe VISUALI raggruppate per Y (l'ordine dei blocchi TSV non è affidabile
// sui layout a colonne); colonna descrizione = X di inizio riga più frequente (le righe
// mandate a capo si allineano lì); valori = coda di um/numeri staccata da un salto
// orizzontale ≥45px; nuovo articolo su codice+descrizione MAIUSCOLA, codice dopo valori
// già raccolti, o salto verticale ≥1.75× l'interlinea tipica.
export const tabellaColonne = (words: ParolaTsv[]): string => {
  if (!words.length) return ''
  const umRe = new RegExp(String.raw`^(${UM_SRC})\.?$`, 'i')
  const numRe = new RegExp(String.raw`^(${NUM_SRC})€?$`)
  // pulizia parola-valore: parentesi/spazzatura attaccate dall'OCR ("80.000,00)" · "(2")
  const sgombra = (t: string) => t.replace(/^[([{|]+/, '').replace(/[)\]}|,;:]+$/, '').replace(/€/g, '').trim()
  const isNum = (t: string) => numRe.test(sgombra(t))
  const isVal = (t: string) => t === '€' || umRe.test(t) || isNum(t)

  // righe visuali per Y
  const ordinate = [...words].sort((a, b) => a.top - b.top)
  const righe: { top: number; words: ParolaTsv[] }[] = []
  for (const w of ordinate) {
    const r = righe[righe.length - 1]
    if (r && w.top - r.top <= Math.max(8, w.height * 0.6)) r.words.push(w)
    else righe.push({ top: w.top, words: [w] })
  }
  righe.forEach(r => r.words.sort((a, b) => a.left - b.left))

  const fondoPagina = Math.max(...words.map(w => w.top + w.height))
  const headerVoc = /^(somministrazion\w*|unitari[oa]|totale|impo|rti|importi?|um|quantit\w*|prezzo|tariffa|articol[oi]|descrizione|indicazione|dei|delle?|della|di|e|lavori|elenco|prezzi|dettaglio|fornitura|sommano)$/i
  const pulita = (t: string) => t.replace(/[^a-zA-Z0-9àèéìòùÀÈÉÌÒÙ]/g, '')
  const utili = righe.filter(r => {
    if (r.top >= fondoPagina * 0.965) return false                  // piè di pagina (n° pagina, sigle)
    const testoR = r.words.map(w => w.text).join(' ')
    if (/^\d+\s*\/\s*\d+$/.test(testoR)) return false               // "3 / 27"
    if (/cod\W{0,3}ident\W{0,3}contratto/i.test(testoR)) return false // intestazione di pagina ripetuta
    if (/^\d{3}-\d{3}[_-][A-Za-z0-9]{1,4}\/\d{4}$/.test(testoR)) return false // valore dell'intestazione andato a capo ("208-148_042/2026"): diventerebbe un finto codice articolo
    if (/\bsommano\b/i.test(testoR)) return false                   // righe "SOMMANO cad 1"
    // riga di intestazione tabella: quasi tutte le parole sono vocabolario di intestazione
    // (confronto senza punteggiatura: l'OCR scrive "RT!", "U.m.", "IMPO…")
    const voc = r.words.filter(w => !pulita(w.text) || headerVoc.test(pulita(w.text))).length
    if (voc === r.words.length) return false                                          // tutte parole di intestazione
    if (r.words.length >= 3 && voc >= Math.ceil(r.words.length * 0.8)) return false   // quasi tutte
    return true
  })
  if (utili.length < 3) return ''

  // Attacco tabella: se la pagina contiene "…riepilogato nella seguente tabella:" /
  // "ELENCO DEI PREZZI UNITARI", tutto ciò che precede è prosa contrattuale → scartalo
  // (altrimenti le clausole di inizio pagina finiscono nella descrizione del 1° articolo).
  let iAttacco = -1
  utili.forEach((r, i) => {
    if (/(?:seguente|riepilogat\w*)\s+tabella|elenco\s+dei\s+prezzi\s+unitari/i.test(r.words.map(w => w.text).join(' '))) iAttacco = i
  })
  const corpo = iAttacco >= 0 ? utili.slice(iAttacco + 1) : utili
  if (corpo.length < 3) return ''

  // colonna descrizione: X di inizio riga più frequente tra le righe con abbastanza testo
  const bins = new Map<number, number>()
  for (const r of corpo) if (r.words.length >= 4) {
    const b = Math.round(r.words[0].left / 20) * 20
    bins.set(b, (bins.get(b) ?? 0) + 1)
  }
  let xDescr = -1, best = 0
  for (const [b, n] of bins) if (n > best || (n === best && b < xDescr)) { xDescr = b; best = n }
  if (xDescr <= 0 || best < 3) return ''

  // interlinea tipica, per riconoscere i salti verticali tra celle
  const salti = corpo.slice(1).map((r, i) => r.top - corpo[i].top).filter(d => d > 0).sort((a, b) => a - b)
  const passo = salti[Math.floor(salti.length / 2)] || 25

  // "@" incluso: è la lettura OCR tipica di "Ø" nei codici articolo ("@.1000")
  const codeRe = /^[A-Za-zØø@0-9][A-Za-zØø@0-9°.\-_\/]*$/
  const capsRe = /^[A-Z0-9ÀÈÉÌÒÙ.,'()\-\/]+$/
  type Art = { codice: string[]; descr: string[]; um: string; num: string[] }
  // PASSATA 1 — scompone ogni riga in codice / descrizione / coda valori. Serve
  // separata perché il confine di cella (sotto) si decide guardando TUTTE le righe.
  type RigaAn = { top: number; codici: ParolaTsv[]; descr: ParolaTsv[]; val: ParolaTsv[]; fineDescr: number; salta?: boolean }
  const analizzate: RigaAn[] = []
  for (const r of corpo) {
    const ws = r.words
    // Coda valori: sequenza finale di um/numeri/€ che tollera parole-spazzatura corte
    // (residui OCR come "i", "Î", ".|" spezzavano il riconoscimento). La coda è valida
    // se inizia riga, o è staccata dal testo con salto orizzontale ≥45px, oppure se la
    // parola subito prima è una u.m. attaccata alla descrizione ("cad ." senza gap).
    let iVal = ws.length
    {
      let i = ws.length - 1
      while (i >= 0 && (isVal(ws[i].text) || ws[i].text.length <= 2)) i--
      const inizioCoda = i + 1
      if (inizioCoda === 0) iVal = 0     // riga di soli valori (+ eventuale spazzatura)
      for (let k = inizioCoda; k < ws.length && iVal === ws.length; k++) {
        if (!isVal(ws[k].text)) continue
        const prev = ws[k - 1]
        const gap = prev ? ws[k].left - (prev.left + prev.width) : 999
        if (k === 0 || gap >= 45) { iVal = k; break }
        // um prima dei numeri anche con spazzatura in mezzo ("cad . 100"): risali
        // saltando le parole corte non-valore e includi la um nella coda
        let ip = k - 1
        while (ip >= 0 && ws[ip].text.length <= 2 && !isVal(ws[ip].text)) ip--
        if (ip >= 0 && umRe.test(ws[ip].text.replace(/\.$/, '')) && ws.slice(k).some(w => isNum(w.text))) { iVal = ip; break }
      }
      // la coda parte da un numero ma subito prima (oltre la spazzatura) c'è la um
      // attaccata alla descrizione ("… segnalazione, cad . 100 38,70") → inglobala
      if (iVal > 0 && iVal < ws.length && !umRe.test(ws[iVal].text.replace(/\.$/, ''))) {
        let ip = iVal - 1
        while (ip >= 0 && ws[ip].text.length <= 2 && !isVal(ws[ip].text)) ip--
        if (ip >= 0 && umRe.test(ws[ip].text.replace(/\.$/, '')) && ws.slice(iVal).some(w => isNum(w.text))) iVal = ip
      }
    }
    // sotto-prezzo "0,575 €" su riga propria (un solo numero + €, niente um):
    // è un dettaglio interno dell'articolo, NON un valore di colonna → salta la riga
    if (iVal === 0) {
      const numsRiga = ws.filter(w => isNum(w.text))
      const haUm = ws.some(w => umRe.test(w.text.replace(/\.$/, '')))
      // salta=true: la riga non porta contenuto ma il suo Y conta ancora per misurare
      // i salti verticali tra celle (senza, il salto risultava gonfiato)
      if (!haUm && numsRiga.length === 1 && ws.some(w => w.text.includes('€'))) {
        analizzate.push({ top: r.top, codici: [], descr: [], val: [], fineDescr: -1, salta: true })
        continue
      }
    }
    const codici = ws.slice(0, iVal).filter(w =>
      w.left < xDescr - 20 && codeRe.test(w.text) && /\d/.test(w.text) &&
      !/^art[.\s\-]*\d*[.\s\-]*$/i.test(w.text))   // "ART.5-" è il titolo dell'articolo di contratto, non un codice
    const descrWs = ws.slice(0, iVal).filter(w => w.left >= xDescr - 20)
    analizzate.push({
      top: r.top, codici, descr: descrWs, val: ws.slice(iVal),
      fineDescr: descrWs.length ? Math.max(...descrWs.map(w => w.left + w.width)) : -1,
    })
  }

  // Confine di cella dalla TIPOGRAFIA: in una cella di testo il paragrafo tocca il
  // margine destro su ogni riga TRANNE l'ultima. La riga corta segna quindi la fine
  // della cella, indipendentemente da DOVE sta il codice — che in molte tabelle è
  // centrato verticalmente nella cella, con descrizione sopra E sotto. Chiudere la
  // cella sul codice (come si faceva prima) sfasava ogni articolo di una riga:
  // la descrizione sopra il codice finiva nell'articolo precedente.
  const fini = analizzate.map(a => a.fineDescr).filter(x => x > 0).sort((a, b) => a - b)
  const margineDx = fini.length ? fini[Math.floor(fini.length * 0.9)] : 0
  const sogliaCorta = Math.max(30, (margineDx - xDescr) * 0.08)
  // Il segnale vale solo se il testo è davvero giustificato a destra: se le righe
  // finiscono a caso (colonna stretta, testo a bandiera) ogni riga sembrerebbe
  // "corta" e ogni riga diventerebbe un articolo → in quel caso non si usa.
  const pieneN = analizzate.filter(a => a.fineDescr > 0 && a.fineDescr >= margineDx - sogliaCorta).length
  const conDescr = analizzate.filter(a => a.fineDescr > 0).length
  const giustificato = conDescr >= 5 && pieneN / conDescr >= 0.4
  const rigaCorta = (a: RigaAn) => giustificato && a.fineDescr > 0 && a.fineDescr < margineDx - sogliaCorta

  // PASSATA 2 — montaggio delle celle
  const arts: Art[] = []
  let cur: Art | null = null
  let prevTop = -1
  let chiudiCella = false     // la riga precedente terminava la cella (riga corta)
  for (const a of analizzate) {
    if (a.salta) { prevTop = a.top; continue }
    const { codici, descr: descrWs, val: valWs } = a
    const caps = descrWs.length >= 2 && descrWs.slice(0, 2).every(w => capsRe.test(w.text))
    const salto = prevTop >= 0 && a.top - prevTop > passo * 1.75
    const salto12 = prevTop >= 0 && a.top - prevTop > passo * 1.2
    const nuovo = cur !== null && (
      chiudiCella ||                                                         // cella chiusa dalla riga corta precedente
      (codici.length > 0 && caps && cur.descr.length > 0) ||                 // nuova cella: codice + titolo MAIUSCOLO
      (codici.length > 0 && cur.num.length >= 2 && salto12) ||               // codice dopo valori raccolti, con stacco verticale
      (salto && cur.codice.length > 0) ||                                    // salto verticale tra celle
      (caps && cur.um !== '' && cur.descr.length > 0))                       // titolo MAIUSCOLO dopo cella completa
    if (!cur || nuovo) { cur = { codice: [], descr: [], um: '', num: [] }; arts.push(cur) }
    prevTop = a.top
    cur.codice.push(...codici.map(w => w.text))
    cur.descr.push(...descrWs.map(w => w.text))
    // si chiude solo una cella già "riempita" (col codice o coi valori): senza questa
    // condizione un paragrafo di prosa corto spezzerebbe l'articolo a metà
    chiudiCella = rigaCorta(a) && (cur.codice.length > 0 || cur.num.length >= 2 || valWs.length > 0)
    // riga-totali (um + ≥2 numeri): è la verità sulla cella → butta gli eventuali
    // numeri spuri raccolti prima (frammenti "Ø.1500", quantità orfane…)
    const numsTot = valWs.filter(w => isNum(w.text))
    const umTot = valWs.find(w => umRe.test(w.text.replace(/\.$/, '')))
    if (umTot && numsTot.length >= 2) { cur.um = umTot.text.replace(/\.$/, ''); cur.num = [] }
    let destraPrec = -1        // bordo destro dell'ultimo numero raccolto, per la ricucitura
    for (const w of valWs) {
      if (w.text === '€') continue
      const t = w.text.replace(/\.$/, '')
      if (umRe.test(t)) { if (!cur.um) cur.um = t; continue }
      if (!isNum(w.text)) continue
      const valore = sgombra(w.text)
      const prec = cur.num[cur.num.length - 1]
      // Migliaia separate da uno spazio ("1 042,25"): l'OCR le consegna come due token.
      // Si ricuciono SOLO se erano attaccati (spazio tipografico, <30px): a distanza
      // di colonna sono quantità e prezzo di due colonne diverse, e fonderli faceva
      // sparire l'importo.
      const attaccati = destraPrec >= 0 && w.left - destraPrec < 30
      if (attaccati && prec && /^\d{1,3}$/.test(prec) && /^\d{3},\d{1,3}$/.test(valore)) {
        cur.num[cur.num.length - 1] = `${prec}.${valore}`
      } else if (cur.num.length < 3) cur.num.push(valore)
      else continue
      destraPrec = w.left + w.width
    }
  }
  // codice = solo un numeretto ("1", "2") → è il numero d'articolo delle CLAUSOLE, non un codice.
  // Senza codice l'articolo passa SOLO con valori completi (um + ≥2 numeri): capita alla
  // voce che continua dalla pagina precedente, col codice rimasto sulla pagina prima.
  const validi = arts.filter(a =>
    a.descr.length >= 2 &&
    (a.codice.length ? !/^\d{1,3}$/.test(a.codice.join(' ').trim()) : a.um !== '' && a.num.length >= 2))
  if (!validi.length) return ''
  // pagina di sole clausole travestita da tabella: nessun articolo con valori (um o
  // ≥2 numeri) e meno di 2 codici "veri" (con punto interno, es. A.1.001) → scarta tutto
  const conValori = validi.filter(a => a.um || a.num.length >= 2).length
  const codiciVeri = validi.filter(a => /[A-Za-z0-9]\.[A-Za-z0-9]/.test(a.codice.join(' '))).length
  if (!conValori && codiciVeri < 2) return ''
  return validi.map(a =>
    `| ${a.codice.join(' ')} | ${a.descr.join(' ').replace(/\s{2,}/g, ' ').trim()} | ${a.um} | ${a.num[0] ?? ''} | ${a.num[1] ?? ''} | ${a.num[2] ?? ''} |`).join('\n')
}
