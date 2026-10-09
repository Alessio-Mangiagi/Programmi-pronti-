// Confronto bozza Word ↔ PDF firmato dello stesso contratto.
//
// In ufficio il contratto nasce in Word e torna firmato in PDF, spesso come scansione,
// e fra i due ci sono le modifiche fatte in fase di firma: un prezzo cambiato a penna,
// una clausola tolta, una riga aggiunta. Il PDF è il documento che vale, ma la sua
// lettura è OCR (approssimativa); il Word è esatto carattere per carattere, ma è la
// versione PRIMA delle modifiche. Il testo unito prende il meglio dei due:
//
//   - dove coincidono → il testo del Word (esatto, niente errori OCR);
//   - dove il PDF differisce → il testo del PDF (è quello firmato);
//   - quello che c'è solo nel Word → sparisce (nel PDF non c'è più);
//   - una differenza SENZA numeri e quasi uguale è rumore OCR ("Fornltura"), non una
//     modifica: resta il Word. Coi numeri no: "1.250,00" → "1.350,00" è una modifica
//     vera anche se differisce di un carattere, ed è proprio ciò che va preso dal PDF.
//
// Il confronto è a PAROLE, non a righe: un paragrafo del Word è una riga sola, mentre
// l'OCR lo spezza nelle righe fisiche della pagina. La struttura (righe, separatori di
// pagina `---`, tabelle in markdown) resta quella del PDF, così il backend continua a
// ri-spezzare il testo per pagina.
//
// Puro TypeScript senza dipendenze: gira nel browser e nel banco di prova (vitest).

export type TipoDifferenza = 'modificata' | 'aggiunta' | 'rimossa' | 'spostata' | 'rumore'

export interface Differenza {
  tipo: TipoDifferenza
  word: string      // testo della bozza (vuoto se «aggiunta»)
  pdf: string       // testo del PDF (vuoto se «rimossa»)
  rigaPdf: number   // riga del PDF (1-based) in cui cade la differenza
}

export interface Confronto {
  testoUnito: string
  differenze: Differenza[]
  riepilogo: { modificate: number; aggiunte: number; rimosse: number; spostate: number; rumore: number }
  // false = documenti troppo diversi (o vuoti): il testo unito è il PDF così com'è
  confrontabile: boolean
}

interface Token { testo: string; chiave: string; riga: number }

// Confusioni OCR classiche, applicate SOLO alla chiave di confronto (mai al testo emesso):
// "Il"/"II"/"11" devono contarsi uguali, "0" e "O" pure.
const CONFUSIONI: Record<string, string> = { o: '0', q: '0', i: '1', l: '1', '|': '1', s: '5', b: '8', z: '2' }

// Chiave di confronto di una parola: minuscolo, senza accenti (l'OCR li perde), senza
// punteggiatura e simboli markdown, con le confusioni OCR appiattite. Chiave vuota =
// token di sola formattazione ("|", "**", "---"): non entra nel confronto.
export const chiaveParola = (s: string): string => {
  const base = s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()   // via gli accenti scomposti
  let out = ''
  for (const ch of base) {
    if (/[a-z0-9]/.test(ch)) out += CONFUSIONI[ch] ?? ch
  }
  return out
}

// Parole → riga di testo. Dopo un apostrofo niente spazio ("dell’Utilizzatrice"): la
// tokenizzazione lo aveva staccato apposta per il confronto.
const unisciParole = (parole: string[]): string =>
  parole.reduce((acc, p) => acc + (acc && !/[’']$/.test(acc) ? ' ' : '') + p, '')

const tokenizza = (testo: string): Token[] => {
  const out: Token[] = []
  testo.split('\n').forEach((riga, i) => {
    // "dell'Utilizzatrice" e "dell' Utilizzatrice" sono la stessa cosa: Word e OCR
    // mettono lo spazio dopo l'apostrofo a modo loro, quindi l'apostrofo chiude la parola
    for (const p of riga.replace(/([’'])(?=\S)/g, '$1 ').split(/\s+/)) {
      if (p) out.push({ testo: p, chiave: chiaveParola(p), riga: i })
    }
  })
  return out
}

// Somiglianza fra due stringhe (Dice sui bigrammi): 1 = uguali, 0 = nulla in comune.
export const somiglianza = (a: string, b: string): number => {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const bigrammi = (s: string) => {
    const m = new Map<string, number>()
    for (let i = 0; i < s.length - 1; i++) {
      const k = s.slice(i, i + 2)
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }
  const ba = bigrammi(a), bb = bigrammi(b)
  let comuni = 0
  for (const [k, n] of ba) comuni += Math.min(n, bb.get(k) ?? 0)
  return (2 * comuni) / (a.length - 1 + b.length - 1)
}

// ── Diff di Myers (O(ND)) su due sequenze di chiavi ─────────────────────────
// I due testi sono quasi uguali, quindi D (numero di differenze) è piccolo e
// l'algoritmo è veloce; oltre `maxD` differenze i documenti non sono la stessa cosa
// e si rinuncia (null) invece di macinare per minuti.
type Passo = { tipo: 'uguale'; a: number; b: number } | { tipo: 'togli'; a: number } | { tipo: 'metti'; b: number }

export const diffMyers = (a: string[], b: string[], maxD = 2000): Passo[] | null => {
  const n = a.length, m = b.length
  const cap = Math.min(n + m, maxD)
  const offset = cap + 1
  const v = new Int32Array(2 * cap + 3)
  v[offset + 1] = 0
  const traccia: Int32Array[] = []
  let dFinale = -1
  for (let d = 0; d <= cap && dFinale < 0; d++) {
    // si tiene solo la fascia di k usata al passo d: memoria D², non D·(n+m)
    traccia.push(v.slice(offset - d - 1, offset + d + 2))
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1]
      else x = v[offset + k - 1] + 1
      let y = x - k
      while (x < n && y < m && a[x] === b[y]) { x++; y++ }
      v[offset + k] = x
      if (x >= n && y >= m) { dFinale = d; break }
    }
  }
  if (dFinale < 0) return null

  // ricostruzione a ritroso
  const passi: Passo[] = []
  let x = n, y = m
  for (let d = dFinale; d >= 0; d--) {
    const vd = traccia[d]
    const at = (k: number) => vd[k + d + 1]       // stessa fascia salvata sopra
    const k = x - y
    let kPrec: number
    if (k === -d || (k !== d && at(k - 1) < at(k + 1))) kPrec = k + 1
    else kPrec = k - 1
    const xPrec = at(kPrec)
    const yPrec = xPrec - kPrec
    while (x > xPrec && y > yPrec) { passi.push({ tipo: 'uguale', a: x - 1, b: y - 1 }); x--; y-- }
    if (d > 0) {
      if (x === xPrec) passi.push({ tipo: 'metti', b: yPrec })
      else passi.push({ tipo: 'togli', a: xPrec })
    }
    x = xPrec; y = yPrec
  }
  return passi.reverse()
}

// ── Il confronto vero e proprio ──────────────────────────────────────────────
// Sopra questa somiglianza una differenza senza numeri è rumore OCR, non una modifica.
const SOGLIA_RUMORE = 0.6
// Sotto questa somiglianza «tolto X, messo Y» non è una modifica di X ma due fatti
// distinti (una riga sparita e un'altra comparsa): si riportano separati, si leggono meglio.
const SOGLIA_ESTRANEI = 0.3

export const confrontaTesti = (testoWord: string, testoPdf: string): Confronto => {
  const tokWord = tokenizza(testoWord)
  const tokPdf = tokenizza(testoPdf)
  const righePdf = testoPdf.split('\n')
  const vuoto: Confronto = {
    testoUnito: testoPdf,
    differenze: [],
    riepilogo: { modificate: 0, aggiunte: 0, rimosse: 0, spostate: 0, rumore: 0 },
    confrontabile: false,
  }
  // solo i token con chiave entrano nel diff; quelli di formattazione del PDF
  // ("|", "---") restano al loro posto nel testo unito
  const iw = tokWord.map((t, i) => (t.chiave ? i : -1)).filter(i => i >= 0)
  const ip = tokPdf.map((t, i) => (t.chiave ? i : -1)).filter(i => i >= 0)
  if (!iw.length || !ip.length) return vuoto
  const passi = diffMyers(iw.map(i => tokWord[i].chiave), ip.map(i => tokPdf[i].chiave))
  if (!passi) return vuoto

  // Per ogni token del PDF: il testo da emettere (Word se coincide, PDF altrimenti).
  const emesso: string[] = tokPdf.map(t => t.testo)
  const differenze: Differenza[] = []

  // Le differenze si leggono a blocchi: una sequenza di togli/metti contigui è UNA
  // modifica ("1.250,00" → "1.350,00", oppure una frase riscritta).
  let blocco: { word: string[]; pdf: string[]; pdfIdx: number[]; rigaPdf: number } | null = null
  let ultimaRigaPdf = 0
  const chiudiBlocco = () => {
    if (!blocco) return
    const word = unisciParole(blocco.word)
    const pdf = unisciParole(blocco.pdf)
    let tipo: TipoDifferenza = blocco.word.length && blocco.pdf.length ? 'modificata' : blocco.pdf.length ? 'aggiunta' : 'rimossa'
    const rigaPdf = blocco.rigaPdf + 1
    if (tipo === 'modificata') {
      const senzaNumeri = !/\d/.test(word) && !/\d/.test(pdf)
      const kw = blocco.word.map(chiaveParola).join(' ')
      const kp = blocco.pdf.map(chiaveParola).join(' ')
      const sim = somiglianza(kw, kp)
      if (senzaNumeri && sim >= SOGLIA_RUMORE) {
        // rumore OCR: nel testo unito va il Word. Le parole del PDF nel blocco vengono
        // rimpiazzate dalle parole del Word (stesso numero o no: si emette tutto il
        // blocco Word al posto del primo token PDF e si azzerano gli altri)
        tipo = 'rumore'
        blocco.pdfIdx.forEach((i, k) => { emesso[i] = k === 0 ? word : '' })
      } else if (sim < SOGLIA_ESTRANEI && blocco.word.length >= 3 && blocco.pdf.length >= 3) {
        // solo a scala di frase: "30" → "60" resta una modifica, non un tolto+messo
        differenze.push({ tipo: 'rimossa', word, pdf: '', rigaPdf }, { tipo: 'aggiunta', word: '', pdf, rigaPdf })
        blocco = null
        return
      }
    }
    differenze.push({ tipo, word, pdf, rigaPdf })
    blocco = null
  }

  for (const p of passi) {
    if (p.tipo === 'uguale') {
      chiudiBlocco()
      const tp = tokPdf[ip[p.b]]
      emesso[ip[p.b]] = tokWord[iw[p.a]].testo   // esatto dal Word
      ultimaRigaPdf = tp.riga
      continue
    }
    if (!blocco) blocco = { word: [], pdf: [], pdfIdx: [], rigaPdf: ultimaRigaPdf }
    if (p.tipo === 'togli') blocco.word.push(tokWord[iw[p.a]].testo)
    else {
      const idx = ip[p.b]
      blocco.pdf.push(tokPdf[idx].testo)
      blocco.pdfIdx.push(idx)
      blocco.rigaPdf = tokPdf[idx].riga
      ultimaRigaPdf = tokPdf[idx].riga
    }
  }
  chiudiBlocco()

  // testo unito: le righe del PDF, con le parole sostituite
  const perRiga: string[][] = righePdf.map(() => [])
  tokPdf.forEach((t, i) => { if (emesso[i]) perRiga[t.riga].push(emesso[i]) })
  const testoUnito = righePdf.map((r, i) => (r.trim() ? unisciParole(perRiga[i]) : '')).join('\n')

  // Una riga tolta in un punto e rimessa uguale in un altro non è una modifica: è
  // lo stesso testo in un altro ordine (tabelle lette per colonna, allegati spostati).
  // insieme di parole, non sequenza: il diff può agganciare al blocco una parola della
  // frase accanto ("La"), e il testo spostato deve riconoscersi lo stesso
  const chiaveTesto = (t: string) => t.split(/\s+/).map(chiaveParola).filter(Boolean).sort().join(' ')
  const rimosse = new Map<string, Differenza[]>()
  for (const d of differenze) {
    if (d.tipo !== 'rimossa') continue
    const k = chiaveTesto(d.word)
    if (k) (rimosse.get(k) ?? rimosse.set(k, []).get(k)!).push(d)
  }
  for (const d of differenze) {
    if (d.tipo !== 'aggiunta') continue
    const gemella = rimosse.get(chiaveTesto(d.pdf))?.shift()
    if (!gemella) continue
    d.tipo = 'spostata'
    d.word = gemella.word
    gemella.tipo = 'spostata'
    gemella.word = ''        // segnaposto: si toglie sotto, resta la voce sul lato PDF
  }
  const finali = differenze.filter(d => !(d.tipo === 'spostata' && !d.word))

  const riepilogo = { modificate: 0, aggiunte: 0, rimosse: 0, spostate: 0, rumore: 0 }
  for (const d of finali) {
    if (d.tipo === 'modificata') riepilogo.modificate++
    else if (d.tipo === 'aggiunta') riepilogo.aggiunte++
    else if (d.tipo === 'rimossa') riepilogo.rimosse++
    else if (d.tipo === 'spostata') riepilogo.spostate++
    else riepilogo.rumore++
  }
  return { testoUnito, differenze: finali, riepilogo, confrontabile: true }
}
