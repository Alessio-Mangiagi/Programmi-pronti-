// "><(((º> sabusabu <º)))><"
// Pagina d'origine delle voci estratte sul documento INTERO.
//
// L'elenco prezzi si estrae dal testo di tutte le pagine unito (server/lavori.ts): le
// regole che guardano l'intero documento (stesso articolo stesso prezzo, grafie dei
// codici uniformate, posizioni ricostruite, titolo che vale per le voci sotto) dentro
// una pagina sola valgono a metà. Unito il testo, però, le righe non sanno più da che
// pagina vengono, e in Modifica il numero di pagina serve al clic «riga → anteprima» e
// alle note sulle letture incerte (src/lib/note-celle.ts). Qui ogni voce si ritrova nel
// testo delle pagine e si timbra come faceva il browser quando mandava una pagina per
// richiesta (App.tsx, timbraPagina): `pagina_origine` e, se la pagina è nota come
// nativa o OCR, `origine_lettura`.

// Confronto tollerante: maiuscole, solo lettere e cifre. Spazi, punteggiatura e
// separatori numerici cambiano fra testo letto e valore normalizzato dai parser
// ("1.234,50" ↔ "1234,5" no, ma "1.234,50" ↔ "1 234,50" sì).
const pulito = (s: unknown): string => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

// Impronte di una voce da cercare nel testo della pagina, con il loro peso: descrizione
// e codice dicono "è questa voce", quantità e prezzo da soli sono cifre che possono
// ricorrere ovunque e valgono solo come conferma.
const impronte = (r: Record<string, string>): { testo: string; peso: number }[] => {
  const out: { testo: string; peso: number }[] = []
  const d = pulito(r.descrizione)
  // inizio della descrizione; se i parser ci hanno messo davanti un'etichetta (titolo
  // del gruppo, posizione) anche un pezzo più avanti, che sta nel testo così com'è
  if (d.length >= 12) out.push({ testo: d.slice(0, 30), peso: 2 })
  if (d.length >= 40) out.push({ testo: d.slice(d.length - 30), peso: 2 })
  const c = pulito(r.codice_epu)
  if (c.length >= 4) out.push({ testo: c, peso: 2 })
  for (const k of ['quantita', 'prezzo_lordo', 'importo']) {
    const n = pulito(r[k])
    if (n.length >= 3) out.push({ testo: n, peso: 1 })
  }
  return out
}

// Punteggio minimo per dire "la voce sta qui": una descrizione o un codice più una
// cifra, oppure descrizione e codice insieme. Una cifra sola non basta mai.
const SOGLIA = 3

/**
 * Numero di pagina (da 1) di ogni riga, 0 dove la voce non si ritrova in nessuna pagina.
 * Le righe arrivano nell'ordine del documento: si prova prima la pagina della riga
 * precedente e le seguenti, e si torna indietro solo se lì non c'è (voci di un allegato
 * richiamate prima, tabelle riordinate). Così il costo resta quasi lineare anche su
 * contratti di centinaia di pagine e mille voci.
 */
export const paginaDelleRighe = (righe: Record<string, string>[], pagine: string[]): number[] => {
  const testi = pagine.map(pulito)
  const punteggio = (imp: { testo: string; peso: number }[], p: number): number =>
    imp.reduce((s, x) => s + (testi[p].includes(x.testo) ? x.peso : 0), 0)
  let corrente = 0
  return righe.map(r => {
    const imp = impronte(r)
    if (!imp.length || !testi.length) return 0
    // avanti dalla pagina corrente: la prima che supera la soglia
    for (let p = corrente; p < testi.length; p++) {
      if (punteggio(imp, p) >= SOGLIA) { corrente = p; return p + 1 }
    }
    // indietro: la più vicina che la supera
    for (let p = corrente - 1; p >= 0; p--) {
      if (punteggio(imp, p) >= SOGLIA) return p + 1
    }
    return 0
  })
}

/**
 * Timbra le righe del JSON ALYANTE con la pagina d'origine (e `origine_lettura` se
 * `native` dice quali pagine avevano il layer di testo). Un JSON che non si legge, o
 * senza righe, torna com'è: il timbro è un aiuto alla revisione, mai un motivo di errore.
 */
export const timbraPagineRighe = (json: string, pagine: string[], native?: boolean[]): string => {
  if (pagine.length < 2) return json
  try {
    const o = JSON.parse(json) as { righe?: Record<string, string>[] }
    if (!Array.isArray(o.righe) || !o.righe.length) return json
    const pag = paginaDelleRighe(o.righe, pagine)
    o.righe = o.righe.map((r, i) => pag[i]
      ? { ...r, pagina_origine: String(pag[i]), ...(native ? { origine_lettura: native[pag[i] - 1] ? 'nativo' : 'ocr' } : {}) }
      : r)
    return JSON.stringify(o, null, 2)
  } catch {
    return json
  }
}
