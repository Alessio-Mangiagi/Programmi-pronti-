// Normalizzazioni del testo (nativo e OCR) e spezzatura per pagina: funzioni pure.

// Refusi numerici tipici dell'OCR sulle colonne importi, da correggere PRIMA di
// ogni parser (testo scorrevole, TSV, ricostruzione tabella):
//   1) quantità e prezzo incollati senza spazio: "151.000,000,750" → "151.000,00 0,750"
//   2) migliaia con la virgola al posto del punto: "3,101,318,00" → "3.101.318,00"
// Le migliaia separate da SPAZIO ("1 042,25") NON si ricuciono qui: sul solo testo
// "2 211,73" è indistinguibile da quantità 2 + prezzo 211,73 di due colonne diverse
// (misurato: fondendole si perdeva l'importo su 18 righe di GFM). Si ricuciono in
// tabellaColonne, dove si sa se i due token erano fisicamente attaccati.
// Migliaia separate da SPAZIO ("5 125,08 €", "17 244,67 €"): formato usato da diversi
// fornitori. Senza questa riunione la coda valori si sfalsa — "1 042,25" usciva come prezzo
// "1" + importo "042,25", con l'unità di misura risucchiata nella descrizione.
//
// Vale SOLO sul testo nativo, MAI sull'OCR: nel nativo lo spazio l'ha scritto il generatore
// del documento ed è un separatore vero; nell'OCR è dedotto dalla distanza fra i glifi e
// cade dove capita.
//
// Anche nel nativo, però, lo spazio separa ANCHE due colonne: "cad 2 211,73 € 423,46 €"
// è quantità 2 × prezzo 211,73 (vedi il commento qui sopra), non un importo di 2.211,73.
// Si unisce quindi solo quando la casella della quantità è GIÀ occupata: numero spaziato
// preceduto da un € (colonna precedente chiusa, "€ 1 042,25 €") oppure da una quantità
// con decimali ("cad 1,00 17 244,67 €").
//
// Misurato sui 31 contratti: senza questa guardia si rovinavano 20 righe di GFM e 10 di
// Ulma — fra cui "4,00 450,00" → "4,00.450,00", dove la coda decimale della quantità
// faceva da testa alle migliaia — mentre le 101 righe con migliaia spaziate vere si
// uniscono lo stesso.
export const unisciMigliaiaSpazio = (t: string): string =>
  // \u00a0 = spazio unificatore: nei PDF nativi le migliaia sono separate da quello
  t.replace(/(?<=(?:€|\d,\d{1,3})[ \u00a0])\d{1,3}(?:[ \u00a0]\d{3})+(?=,\d{1,3}(?!\d))/g, m => m.replace(/[ \u00a0]/g, '.'))

export const normalizzaNumeriOcr = (t: string): string => t
  .replace(/\b(\d{1,3}(?:\.\d{3})+,\d{2})(\d+,\d{1,3})(?!\d)/g, '$1 $2')
  .replace(/\b\d{1,3}(?:,\d{3})+,\d{2}(?!\d)/g, m =>
    m.slice(0, m.lastIndexOf(',')).replace(/,/g, '.') + m.slice(m.lastIndexOf(',')))

// Spezza un markdown multi-pagina in tiles per pagina. Riconosce il separatore dell'app
// (riga di soli "---") e l'eventuale marcatore "--- PAGE n ---". Vuoti scartati.
export const splitPageTiles = (md: string): string[] =>
  md.split(/\n[ \t]*---(?:[ \t]+PAGE[ \t]+\d+[ \t]+---)?[ \t]*\n/i)
    .map(t => t.trim())
    .filter(Boolean)
