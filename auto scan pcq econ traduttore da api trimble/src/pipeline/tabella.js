// Utility per leggere tabelle da un PDF a partire dalle righe estratte.
// Vale per tutta la modulistica ANAS/Cosedil, non solo per i PCQ: le tabelle di
// questi moduli hanno intestazioni CENTRATE nella cella e contenuto allineato a
// sinistra, quindi la x dell'intestazione NON e' il bordo della colonna. Per
// questo le bande si ricavano dai dati (dove il testo c'e' davvero) e le
// intestazioni servono solo a dare un nome alle bande trovate.

export const normalizza = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/**
 * Raggruppa gli elementi in colonne guardando i corridoi vuoti: due gruppi di
 * testo separati da uno spazio orizzontale piu' largo di `gapMin` stanno in
 * colonne diverse.
 * @returns {Array<{inizio:number, fine:number, elementi:Array}>}
 */
export function clusterOrizzontali(elementi, gapMin = 8) {
  const ordinati = [...elementi].sort((a, b) => a.x - b.x);
  const cluster = [];
  for (const el of ordinati) {
    const fine = el.x + (el.larghezza || 0);
    const ultimo = cluster[cluster.length - 1];
    if (ultimo && el.x - ultimo.fine <= gapMin) {
      ultimo.fine = Math.max(ultimo.fine, fine);
      ultimo.elementi.push(el);
    } else {
      cluster.push({ inizio: el.x, fine, elementi: [el] });
    }
  }
  return cluster;
}

/**
 * Assegna a ogni colonna dichiarata una banda [inizio, fine).
 * Le colonne che nei dati hanno del testo prendono la banda del cluster; quelle
 * vuote (tipiche caselle da spuntare a mano) restano centrate sulla loro ancora.
 *
 * @param {Array<{id:string, x:number}>} ancore  intestazioni, ordinate per x
 * @param {Array} cluster                        uscita di clusterOrizzontali sui dati
 * @param {{tolleranza?:number, larghezzaVuota?:number}} [opzioni]
 * @returns {Array<{id:string, inizio:number, fine:number}>}
 */
export function bandeColonne(ancore, cluster, { tolleranza = 12, larghezzaVuota = 30 } = {}) {
  const ordinate = [...ancore].sort((a, b) => a.x - b.x);
  const bande = new Map();

  // Un cluster appartiene all'ancora che gli cade dentro (con tolleranza) ed e'
  // la piu' vicina al suo inizio: il testo di una cella parte da sinistra, quindi
  // e' l'inizio del cluster a dire di quale colonna si tratta.
  for (const c of cluster) {
    const candidate = ordinate.filter((a) => a.x >= c.inizio - tolleranza && a.x <= c.fine + tolleranza);
    if (!candidate.length) continue;
    const scelta = candidate.reduce((m, a) => (Math.abs(a.x - c.inizio) < Math.abs(m.x - c.inizio) ? a : m));
    const b = bande.get(scelta.id);
    bande.set(scelta.id, b
      ? { id: scelta.id, inizio: Math.min(b.inizio, c.inizio), fine: Math.max(b.fine, c.fine), daDati: true }
      : { id: scelta.id, inizio: c.inizio, fine: c.fine, daDati: true });
  }

  for (const a of ordinate) {
    if (!bande.has(a.id)) bande.set(a.id, { id: a.id, inizio: a.x - tolleranza, fine: a.x + larghezzaVuota, daDati: false });
  }

  // Bande contigue. Dove una banda nata dai dati confina con una stimata attorno
  // a un'intestazione (colonna vuota), vince il dato: la stima e' larga a caso e
  // altrimenti si mangia la prima parola della colonna accanto.
  const lista = ordinate.map((a) => bande.get(a.id)).sort((x, y) => x.inizio - y.inizio);
  for (let i = 0; i < lista.length - 1; i++) {
    const sx = lista[i];
    const dx = lista[i + 1];
    let bordo;
    if (sx.daDati && !dx.daDati) bordo = Math.max(sx.fine, dx.inizio);
    else if (!sx.daDati && dx.daDati) bordo = Math.min(dx.inizio, sx.fine);
    else bordo = (sx.fine + dx.inizio) / 2;
    sx.fine = bordo;
    dx.inizio = bordo;
  }
  if (lista.length) {
    lista[0].inizio = -Infinity;
    lista[lista.length - 1].fine = Infinity;
  }
  return lista;
}

/** Colonna di un elemento: la banda che lo contiene (o la piu' vicina). */
export function colonnaDi(bande, el) {
  const dentro = bande.find((b) => el.x >= b.inizio && el.x < b.fine);
  if (dentro) return dentro.id;
  if (!bande.length) return null;
  return bande.reduce((m, b) =>
    Math.abs(el.x - (b.inizio + b.fine) / 2) < Math.abs(el.x - (m.inizio + m.fine) / 2) ? b : m).id;
}

/**
 * Spezza le righe in blocchi (= celle di una riga di tabella) usando i salti
 * verticali: dentro una riga le linee di testo sono fitte, tra una riga e
 * l'altra c'e' il bordo della tabella e quindi piu' spazio.
 * La soglia si ricava dai dati: i moduli hanno interlinee diverse per font e zoom.
 */
export function blocchiVerticali(righe, { soglia } = {}) {
  const ordinate = [...righe].sort((a, b) => b.y - a.y);
  const salti = ordinate.slice(1).map((r, i) => ordinate[i].y - r.y).filter((d) => d > 0);
  const limite = soglia ?? sogliaSalto(salti);

  const blocchi = [];
  let corrente = [];
  for (let i = 0; i < ordinate.length; i++) {
    if (i > 0 && ordinate[i - 1].y - ordinate[i].y > limite && corrente.length) {
      blocchi.push(corrente);
      corrente = [];
    }
    corrente.push(ordinate[i]);
  }
  if (corrente.length) blocchi.push(corrente);
  return { blocchi, soglia: limite };
}

/** Soglia = 2,2 volte l'interlinea tipica (mediana), mai sotto 10 punti. */
export function sogliaSalto(salti) {
  if (!salti.length) return 12;
  const ord = [...salti].sort((a, b) => a - b);
  const mediana = ord[Math.floor(ord.length / 2)];
  return Math.max(mediana * 2.2, 10);
}
