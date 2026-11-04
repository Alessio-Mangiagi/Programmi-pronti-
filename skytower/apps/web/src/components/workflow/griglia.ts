// "><(((º> sabusabu <º)))><"
// Geometria del foglio a scacchiera dei workflow a grafo (docs/workflow-grafo.md §4): dimensioni delle schede,
// posizione in pixel delle caselle, aggancio alla casella, prima casella libera, instradamento ortogonale
// degli archi e posto delle etichette degli esiti.
//
// Regole di disegno, pensate per il caso vero dell'utente (7 buyer in parallelo che partono dallo stesso esito
// e si riuniscono in un nodo solo) e perché il foglio resti leggibile a colpo d'occhio:
// - gli archi non passano mai sopra le schede: i tratti verticali stanno nei corridoi fra le colonne
//   ("corsie"), i tratti orizzontali lunghi nelle fasce fra le righe; un arco fra colonne vicine alla
//   stessa altezza è una linea dritta;
// - un'etichetta sola per esito, sul tratto che esce dalla scheda: gli archi dello stesso esito (rami
//   paralleli) condividono la stessa corsia, come un bus, quindi 7 archi = 1 etichetta;
// - gli archi che entrano nello stesso nodo da colonne vicine si riuniscono su una corsia sola davanti al
//   nodo (come la riunione dei rami nell'immagine), invece di occupare 7 corsie.
// Il file non ha dipendenze a runtime (solo tipi): lo provano i test unitari in unit/ con node --test.
import type { Arco, Casella, Definizione, Nodo } from "./modello";

export const MAX_CASELLA = 39;      // col e row 0–39, come nel contratto
export const NODE_W = 132;          // larghezza di riferimento delle schede (decisione, attività, notifica)
export const LABEL_W = 118;         // zona delle etichette degli esiti (con la spunta), subito a destra della scheda
export const LANE_SP = 9;           // distanza fra due corsie verticali nello stesso corridoio
const GUTTER_SP = 7;                // distanza fra due corsie orizzontali nella stessa fascia fra righe
const PORT_SP = 22;                 // distanza verticale fra le uscite di due esiti dello stesso nodo
const VGAP = 24;                    // spazio minimo sopra e sotto la scheda più alta
const ENTRATA = 26;                 // spazio fra l'ultima corsia e la scheda di arrivo (connettore verde)
const PAD_TOP = VGAP + 10;

export interface Punto { x: number; y: number }

export interface NodoPosizionato {
  id: string; x: number; y: number; w: number; h: number;
  /** Uscite: per codice di esito (decisione, attività) o "" (inizio, notifica). */
  porte: Record<string, Punto>;
  /** Ingresso: lato sinistro, a metà altezza. */
  ingresso: Punto;
}

export interface ArcoTracciato {
  /** Indice dell'arco in `definition.edges`: serve agli errori dell'API riferiti a un arco. */
  indice: number;
  arco: Arco;
  /** Gruppo = nodo di partenza + esito: tutti gli archi del gruppo hanno la stessa etichetta. */
  gruppo: string;
  punti: Punto[];
}

export interface Etichetta { gruppo: string; from: string; outcome: string; x: number; y: number; larghezza: number }

export interface Disposizione {
  cellW: number; cellH: number; padX: number; padTop: number;
  width: number; height: number;
  nodi: Map<string, NodoPosizionato>;
  archi: ArcoTracciato[];
  etichette: Etichetta[];
  /** Un connettore verde per ogni nodo che riceve archi, davanti all'ingresso. */
  ingressi: { nodo: string; punto: Punto }[];
}

// ------------------------------------------------------------------- dimensioni delle schede
/** Codici degli esiti come li usa il motore (stessa regola di `esitiDi` in modello.ts, copiata per restare
 *  senza dipendenze a runtime): un'attività senza esiti vale "Fatto". */
export function codiciEsiti(n: Nodo): string[] {
  if (n.type === "decision") return (n.outcomes ?? []).map((e) => e.code);
  if (n.type === "activity") return n.outcomes?.length ? n.outcomes.map((e) => e.code) : ["FATTO"];
  return [];
}

export function dimensioni(n: Nodo): { w: number; h: number } {
  if (n.type === "start") return { w: 120, h: 70 };
  if (n.type === "end") return { w: 120, h: 58 };
  if (n.type === "notification") return { w: NODE_W, h: 92 };
  return { w: NODE_W, h: Math.max(100, 40 + codiciEsiti(n).length * PORT_SP) };
}

/** Larghezza stimata del testo di un'etichetta (font 10px, sans): basta per decidere dove troncare. */
export function larghezzaTesto(testo: string, px = 10): number {
  return Math.ceil(testo.length * px * 0.53);
}

// ------------------------------------------------------------------- caselle
const chiaveCasella = (c: Casella) => `${c.col}:${c.row}`;

export function caselleOccupate(nodi: Nodo[], tranne?: string): Set<string> {
  return new Set(nodi.filter((n) => n.id !== tranne).map((n) => chiaveCasella(n.cell)));
}

/** Prima casella libera a destra del nodo `da` (stessa riga, poi le righe più vicine sopra e sotto,
 *  colonna per colonna). Senza nodo di partenza: a destra dell'ultima colonna usata, riga 0. */
export function primaCasellaLibera(nodi: Nodo[], da?: Nodo | null): Casella {
  const occ = caselleOccupate(nodi);
  if (!da) {
    const col = nodi.length ? Math.min(MAX_CASELLA, Math.max(...nodi.map((n) => n.cell.col)) + 1) : 0;
    for (let row = 0; row <= MAX_CASELLA; row++) if (!occ.has(`${col}:${row}`)) return { col, row };
    return { col, row: 0 };
  }
  for (let col = Math.min(MAX_CASELLA, da.cell.col + 1); col <= MAX_CASELLA; col++) {
    for (let d = 0; d <= MAX_CASELLA; d++) {
      for (const row of d === 0 ? [da.cell.row] : [da.cell.row + d, da.cell.row - d]) {
        if (row < 0 || row > MAX_CASELLA) continue;
        if (!occ.has(`${col}:${row}`)) return { col, row };
      }
    }
  }
  return { col: MAX_CASELLA, row: MAX_CASELLA };
}

/** Casella sotto un punto del foglio (aggancio al trascinamento), entro i limiti 0–39. */
export function casellaDaPunto(d: Pick<Disposizione, "cellW" | "cellH" | "padX" | "padTop">, x: number, y: number): Casella {
  const lim = (v: number) => Math.max(0, Math.min(MAX_CASELLA, v));
  return { col: lim(Math.floor((x - d.padX) / d.cellW)), row: lim(Math.floor((y - d.padTop) / d.cellH)) };
}

/** Sposta un nodo di una casella (tastiera). Null se si esce dal foglio o la casella è occupata. */
export function spostaDiUna(nodi: Nodo[], id: string, dc: number, dr: number): Casella | null {
  const n = nodi.find((x) => x.id === id);
  if (!n) return null;
  const c = { col: n.cell.col + dc, row: n.cell.row + dr };
  if (c.col < 0 || c.row < 0 || c.col > MAX_CASELLA || c.row > MAX_CASELLA) return null;
  return caselleOccupate(nodi, id).has(chiaveCasella(c)) ? null : c;
}

// ------------------------------------------------------------------- disposizione e instradamento
interface Percorso {
  indice: number; arco: Arco; gruppo: string; da: Nodo; a: Nodo;
  tipo: "dritto" | "vicino" | "fascia";
  corsiaUscita?: string;    // chiave della corsia verticale dopo la colonna di partenza
  corsiaArrivo?: string;    // chiave della corsia verticale prima della colonna di arrivo (solo "fascia")
  fascia?: number;          // indice della fascia orizzontale fra le righe (solo "fascia")
}

/**
 * Calcola posizioni, archi ed etichette del grafo. `extra` aggiunge colonne e righe vuote in fondo
 * (l'editor le usa per avere spazio dove trascinare).
 */
export function disponi(def: Definizione, extra = { col: 0, row: 0 }): Disposizione {
  const nodiPer = new Map(def.nodes.map((n) => [n.id, n]));
  const dim = new Map(def.nodes.map((n) => [n.id, dimensioni(n)]));
  const maxH = Math.max(100, ...[...dim.values()].map((d) => d.h));
  const cellH = maxH + 2 * VGAP;

  // Gruppi (nodo + esito) e quanti archi hanno: un gruppo con più archi è un bus di rami paralleli.
  const archiValidi = def.edges
    .map((arco, indice) => ({ arco, indice, da: nodiPer.get(arco.from), a: nodiPer.get(arco.to) }))
    .filter((x): x is { arco: Arco; indice: number; da: Nodo; a: Nodo } => !!x.da && !!x.a);
  const gruppoDi = (a: Arco) => `${a.from}|${a.outcome ?? ""}`;
  const dimGruppo = new Map<string, number>();
  for (const { arco } of archiValidi) dimGruppo.set(gruppoDi(arco), (dimGruppo.get(gruppoDi(arco)) ?? 0) + 1);

  // Y relative alla riga: servono prima di conoscere la larghezza delle colonne.
  const yCentro = (n: Nodo) => PAD_TOP + n.cell.row * cellH + cellH / 2;
  const yPorta = (n: Nodo, outcome?: string) => {
    const codici = codiciEsiti(n);
    const i = outcome ? Math.max(0, codici.indexOf(outcome)) : 0;
    const k = Math.max(1, codici.length);
    return yCentro(n) + (codici.length ? (i - (k - 1) / 2) * PORT_SP : 0);
  };

  // 1. Tipo di percorso e chiavi delle corsie.
  const percorsi: Percorso[] = archiValidi.map(({ arco, indice, da, a }) => {
    const gruppo = gruppoDi(arco);
    const vicino = a.cell.col === da.cell.col + 1;
    if (vicino && Math.abs(yPorta(da, arco.outcome) - yCentro(a)) < 0.5)
      return { indice, arco, gruppo, da, a, tipo: "dritto" };
    if (vicino) {
      // rami paralleli: corsia del gruppo (bus in uscita); arco singolo: corsia del nodo d'arrivo (riunione)
      const corsiaUscita = (dimGruppo.get(gruppo) ?? 1) > 1 ? `s:${gruppo}` : `t:${a.id}`;
      return { indice, arco, gruppo, da, a, tipo: "vicino", corsiaUscita };
    }
    // colonne lontane, stessa colonna o all'indietro: si scende/sale alla fascia accanto alla riga d'arrivo
    const fascia = a.cell.row > da.cell.row ? a.cell.row : a.cell.row < da.cell.row ? a.cell.row + 1
      : (a.cell.col > da.cell.col ? a.cell.row : a.cell.row + 1);
    // archi singoli verso lo stesso nodo lontano (es. i 7 "Respinto" verso la filigrana) si riuniscono
    // subito su una corsia sola e percorrono insieme la fascia, come un bus; i rami paralleli restano sul
    // bus del loro esito
    const corsiaUscita = (dimGruppo.get(gruppo) ?? 1) > 1 ? `s:${gruppo}` : `u:${a.id}:${fascia}`;
    return { indice, arco, gruppo, da, a, tipo: "fascia", corsiaUscita, corsiaArrivo: `t:${a.id}`, fascia };
  });

  // 2. Corsie per corridoio (corridoio c = spazio a destra della colonna c; -1 = margine sinistro).
  const corridoi = new Map<number, Map<string, number>>();   // corridoio → chiave → ordinamento (y)
  const aggiungi = (c: number, chiave: string, y: number) => {
    const m = corridoi.get(c) ?? new Map<string, number>();
    m.set(chiave, Math.min(m.get(chiave) ?? Infinity, y));
    corridoi.set(c, m);
  };
  for (const p of percorsi) {
    if (p.tipo === "vicino") aggiungi(p.da.cell.col, p.corsiaUscita!, p.corsiaUscita!.startsWith("s:") ? yPorta(p.da, p.arco.outcome) : 1e6 + yCentro(p.a));
    if (p.tipo === "fascia") {
      aggiungi(p.da.cell.col, p.corsiaUscita!, yPorta(p.da, p.arco.outcome));
      aggiungi(p.a.cell.col - 1, p.corsiaArrivo!, 1e6 + yCentro(p.a));
    }
  }
  // ordine: prima le corsie in uscita (vicine alle etichette), poi quelle d'arrivo (vicine al nodo), dall'alto
  const ordineCorsie = new Map<number, string[]>();
  for (const [c, m] of corridoi) ordineCorsie.set(c, [...m.entries()].sort((x, y) => x[1] - y[1]).map(([k]) => k));
  const maxCorsie = Math.max(1, ...[...ordineCorsie.entries()].filter(([c]) => c >= 0).map(([, v]) => v.length));
  const cellW = Math.min(520, NODE_W + LABEL_W + (maxCorsie - 1) * LANE_SP + ENTRATA + 18);
  const padX = Math.max(48, 30 + ((ordineCorsie.get(-1)?.length ?? 1) - 1) * LANE_SP + ENTRATA);

  const xCorsia = (c: number, chiave: string) => {
    const i = (ordineCorsie.get(c) ?? []).indexOf(chiave);
    if (c < 0) return padX - ENTRATA - i * LANE_SP;
    return padX + c * cellW + NODE_W + LABEL_W + i * LANE_SP;
  };

  // 3. Fasce orizzontali: corsie per fascia, una per gruppo.
  const fasce = new Map<number, string[]>();
  // la corsia orizzontale è quella della corsia verticale d'uscita: chi la condivide (bus) viaggia insieme
  for (const p of percorsi) if (p.tipo === "fascia") {
    const l = fasce.get(p.fascia!) ?? [];
    if (!l.includes(p.corsiaUscita!)) l.push(p.corsiaUscita!);
    fasce.set(p.fascia!, l);
  }
  const yFascia = (f: number, chiave: string) => {
    const l = fasce.get(f) ?? [chiave];
    const sp = Math.min(GUTTER_SP, (2 * VGAP - 12) / Math.max(1, l.length));
    return PAD_TOP + f * cellH + (l.indexOf(chiave) - (l.length - 1) / 2) * sp;
  };

  // 4. Posizioni delle schede.
  const nodi = new Map<string, NodoPosizionato>();
  for (const n of def.nodes) {
    const { w, h } = dim.get(n.id)!;
    const x = padX + n.cell.col * cellW;
    const y = yCentro(n) - h / 2;
    const porte: Record<string, Punto> = {};
    const codici = codiciEsiti(n);
    if (codici.length) for (const c of codici) porte[c] = { x: x + w, y: yPorta(n, c) };
    else if (n.type !== "end") porte[""] = { x: x + w, y: y + h / 2 };
    nodi.set(n.id, { id: n.id, x, y, w, h, porte, ingresso: { x, y: y + h / 2 } });
  }

  // 5. Tracciati.
  const archi: ArcoTracciato[] = percorsi.map((p) => {
    const da = nodi.get(p.da.id)!;
    const a = nodi.get(p.a.id)!;
    const porta = da.porte[p.arco.outcome ?? ""] ?? Object.values(da.porte)[0] ?? { x: da.x + da.w, y: da.y + da.h / 2 };
    const ing = a.ingresso;
    let punti: Punto[];
    if (p.tipo === "dritto") punti = [porta, ing];
    else if (p.tipo === "vicino") {
      const x = xCorsia(p.da.cell.col, p.corsiaUscita!);
      punti = [porta, { x, y: porta.y }, { x, y: ing.y }, ing];
    } else {
      const x1 = xCorsia(p.da.cell.col, p.corsiaUscita!);
      const x2 = xCorsia(p.a.cell.col - 1, p.corsiaArrivo!);
      const yf = yFascia(p.fascia!, p.corsiaUscita!);
      punti = [porta, { x: x1, y: porta.y }, { x: x1, y: yf }, { x: x2, y: yf }, { x: x2, y: ing.y }, ing];
    }
    return { indice: p.indice, arco: p.arco, gruppo: p.gruppo, punti: semplifica(punti) };
  });

  // 6. Etichette: una per gruppo con esito, sul tratto in uscita.
  const etichette: Etichetta[] = [];
  const visti = new Set<string>();
  for (const p of percorsi) {
    if (!p.arco.outcome || visti.has(p.gruppo)) continue;
    visti.add(p.gruppo);
    const porta = nodi.get(p.da.id)!.porte[p.arco.outcome];
    if (!porta) continue;
    etichette.push({ gruppo: p.gruppo, from: p.da.id, outcome: p.arco.outcome, x: porta.x + 6, y: porta.y,
                     larghezza: LABEL_W - 12 });
  }

  const ingressi = [...new Set(percorsi.map((p) => p.a.id))].map((id) => ({ nodo: id, punto: nodi.get(id)!.ingresso }));
  const maxCol = Math.max(0, ...def.nodes.map((n) => n.cell.col)) + extra.col;
  const maxRow = Math.max(0, ...def.nodes.map((n) => n.cell.row)) + extra.row;
  return {
    cellW, cellH, padX, padTop: PAD_TOP,
    width: padX + (maxCol + 1) * cellW + 12, height: PAD_TOP + (maxRow + 1) * cellH + VGAP,
    nodi, archi, etichette, ingressi,
  };
}

/** Zoom con cui il foglio entra nella larghezza disponibile, mai sotto il 55% (sotto il testo delle schede non si
 *  legge più: meglio scorrere) e mai sopra il 100%. */
export function zoomAdatto(def: Definizione, larghezza: number, extra = { col: 0, row: 0 }): number {
  const w = disponi(def, extra).width;
  return Math.max(0.55, Math.min(1, (larghezza - 4) / w));
}

/** Toglie i punti allineati e i doppioni, così il tracciato SVG ha solo gli angoli veri. */
export function semplifica(punti: Punto[]): Punto[] {
  const out: Punto[] = [];
  for (const p of punti) {
    const u = out[out.length - 1];
    if (u && Math.abs(u.x - p.x) < 0.01 && Math.abs(u.y - p.y) < 0.01) continue;
    const v = out[out.length - 2];
    if (u && v && ((Math.abs(v.x - u.x) < 0.01 && Math.abs(u.x - p.x) < 0.01) || (Math.abs(v.y - u.y) < 0.01 && Math.abs(u.y - p.y) < 0.01))) {
      out[out.length - 1] = p;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** Il tracciato come attributo `d` di un <path>. */
export function percorsoSvg(punti: Punto[]): string {
  return punti.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

/** True se un segmento orizzontale o verticale attraversa l'interno di una scheda (lo usano i test). */
export function segmentoTagliaScheda(a: Punto, b: Punto, s: { x: number; y: number; w: number; h: number }, margine = 1): boolean {
  const [x1, x2] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
  const [y1, y2] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
  return x2 > s.x + margine && x1 < s.x + s.w - margine && y2 > s.y + margine && y1 < s.y + s.h - margine;
}

/** Testo spezzato su più righe di al massimo `max` caratteri (nomi dei nodi nelle schede). */
export function aCapo(testo: string, max: number, righe: number): string[] {
  const parole = testo.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const p of parole) {
    const prova = cur ? `${cur} ${p}` : p;
    if (prova.length <= max) cur = prova;
    else {
      if (cur) out.push(cur);
      cur = p.length > max ? `${p.slice(0, max - 1)}…` : p;
    }
  }
  if (cur) out.push(cur);
  if (out.length > righe) return [...out.slice(0, righe - 1), `${out[righe - 1].slice(0, max - 1)}…`];
  return out;
}
