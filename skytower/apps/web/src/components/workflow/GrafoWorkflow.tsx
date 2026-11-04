// "><(((º> sabusabu <º)))><"
// Foglio a scacchiera del workflow a grafo (docs/workflow-grafo.md §4), in SVG: lo usano l'editor (modo
// "modifica": trascinamento con aggancio alla casella, collegamento trascinando dal bollino di un esito al nodo
// di arrivo, tastiera) e la vista finale di un'istanza (modo "vista": colori di stato, spunta sugli esiti
// percorsi, "N giri"). L'aspetto riprende lo schema che l'utente usa oggi: schede chiare con ombra e
// intestazione del tipo, archi neri ortogonali, connettori verdi all'ingresso, esiti come bollini colorati.
// Posizioni e tracciati li calcola griglia.ts; qui c'è solo il disegno e l'interazione.
// Niente script inline né risorse esterne: solo elementi SVG con attributi, compatibile con la CSP.
import { KeyboardEvent, PointerEvent, useMemo, useRef, useState } from "react";
import { Box } from "@mui/material";
import { aCapo, casellaDaPunto, caselleOccupate, disponi, larghezzaTesto, percorsoSvg } from "./griglia";
import type { Disposizione, Punto } from "./griglia";
import { Casella, Colore, Definizione, NOME_TIPO, Nodo, esitiDi } from "./modello";

export type StatoNodo = "fatto" | "attivo" | "non_raggiunto" | "ok" | "ko" | "annullato";
export type Selezione = { tipo: "nodo"; id: string } | { tipo: "arco"; indice: number } | null;

export const COLORE_ESITO: Record<Colore, string> = { green: "#4caf2a", yellow: "#f0c020", red: "#d93025" };
const STILE_STATO: Record<StatoNodo, { fill: string; stroke: string; testo: string; tratteggio?: string }> = {
  fatto: { fill: "#e8f5e2", stroke: "#4caf2a", testo: "#212326" },
  attivo: { fill: "#fff6d1", stroke: "#e0a800", testo: "#212326" },
  ok: { fill: "#e8f5e2", stroke: "#4caf2a", testo: "#212326" },
  ko: { fill: "#fde8e7", stroke: "#d93025", testo: "#212326" },
  annullato: { fill: "#f4f5f7", stroke: "#9aa3ad", testo: "#6b7280", tratteggio: "4 3" },
  non_raggiunto: { fill: "#f4f5f7", stroke: "#c6cbd2", testo: "#7a828c" },
};
const NOME_STATO: Record<StatoNodo, string> = {
  fatto: "fatto", attivo: "in corso", non_raggiunto: "non raggiunto", ok: "concluso", ko: "finito male", annullato: "annullato",
};

export interface PropsGrafo {
  definizione: Definizione;
  modo: "modifica" | "vista";
  zoom?: number;
  etichetta: string;
  selezione?: Selezione;
  onSeleziona?: (s: Selezione) => void;
  /** Modifica: il nodo è stato lasciato in un'altra casella libera. */
  onSposta?: (id: string, cella: Casella) => void;
  /** Modifica: arco nuovo trascinato dal bollino di un esito (o dall'uscita di inizio/notifica) a un nodo. */
  onCollega?: (from: string, outcome: string | undefined, to: string) => void;
  /** Modifica: pulsante "+" della scheda. */
  onPiu?: (id: string) => void;
  /** Modifica: frecce e Canc sul nodo selezionato (la logica sta nell'editor). */
  onTastoNodo?: (id: string, e: KeyboardEvent) => void;
  /** Vista: stato e numero di giri di ogni nodo. */
  stati?: Map<string, { stato: StatoNodo; giri: number }>;
  /** Vista: archi percorsi ("from|outcome|to") e gruppi percorsi ("from|outcome"). */
  archiPercorsi?: Set<string>;
  gruppiPercorsi?: Set<string>;
  /** Modifica: nodi e archi con errori di validazione. */
  errori?: { nodi: Set<string>; archi: Set<number> };
  /** Modo modifica senza interazione: modello esistente aperto in sola lettura (niente trascinamento, uscite, "+"). */
  solaLettura?: boolean;
  /** Altezza massima del riquadro con lo scorrimento (predefinita 74vh; "none" = tutto il foglio). */
  altezzaMax?: string;
}

export const chiaveArco = (from: string, outcome: string | null | undefined, to: string) => `${from}|${outcome ?? ""}|${to}`;

export function GrafoWorkflow(p: PropsGrafo) {
  const { definizione, modo } = p;
  const zoom = p.zoom ?? 1;
  const edit = modo === "modifica" && !p.solaLettura;
  const svgRef = useRef<SVGSVGElement>(null);
  // Trascinamento di un nodo: la casella provvisoria fa ricalcolare la disposizione, così il nodo salta di
  // casella in casella e gli archi lo seguono ("si agganciano alla casella").
  const [trascina, setTrascina] = useState<{ id: string; inizio: Punto; cella: Casella; mosso: boolean } | null>(null);
  // Collegamento in corso: dal bollino di un esito al puntatore.
  const [lega, setLega] = useState<{ from: string; outcome?: string; da: Punto; a: Punto } | null>(null);

  const defMostrata = useMemo(() => {
    if (!trascina) return definizione;
    return { ...definizione, nodes: definizione.nodes.map((n) => (n.id === trascina.id ? { ...n, cell: trascina.cella } : n)) };
  }, [definizione, trascina]);
  // due colonne e due righe vuote in più solo quando si modifica: servono come spazio dove trascinare
  const d = useMemo(() => disponi(defMostrata, edit ? { col: 2, row: 2 } : { col: 0, row: 0 }), [defMostrata, edit]);

  const puntoSvg = (e: { clientX: number; clientY: number }): Punto => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  };
  const nodoSotto = (pt: Punto) => [...d.nodi.values()].find((n) => pt.x >= n.x && pt.x <= n.x + n.w && pt.y >= n.y && pt.y <= n.y + n.h);

  const giuNodo = (e: PointerEvent, n: Nodo) => {
    p.onSeleziona?.({ tipo: "nodo", id: n.id });
    if (!edit || e.button !== 0) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    setTrascina({ id: n.id, inizio: puntoSvg(e), cella: n.cell, mosso: false });
  };
  const giuPorta = (e: PointerEvent, from: string, outcome: string | undefined, da: Punto) => {
    e.stopPropagation();
    if (!edit || e.button !== 0) return;
    svgRef.current?.setPointerCapture(e.pointerId);
    setLega({ from, outcome, da, a: da });
  };
  const muovi = (e: PointerEvent) => {
    if (lega) setLega({ ...lega, a: puntoSvg(e) });
    if (trascina) {
      const pt = puntoSvg(e);
      const mosso = trascina.mosso || Math.hypot(pt.x - trascina.inizio.x, pt.y - trascina.inizio.y) > 6;
      if (!mosso) return;
      const c = casellaDaPunto(d, pt.x, pt.y);
      const libera = !caselleOccupate(definizione.nodes, trascina.id).has(`${c.col}:${c.row}`);
      setTrascina({ ...trascina, mosso, cella: libera ? c : trascina.cella });
    }
  };
  const su = (e: PointerEvent) => {
    if (lega) {
      const n = nodoSotto(puntoSvg(e));
      if (n && n.id !== lega.from) p.onCollega?.(lega.from, lega.outcome, n.id);
      setLega(null);
    }
    if (trascina) {
      const orig = definizione.nodes.find((n) => n.id === trascina.id)?.cell;
      if (trascina.mosso && orig && (orig.col !== trascina.cella.col || orig.row !== trascina.cella.row))
        p.onSposta?.(trascina.id, trascina.cella);
      setTrascina(null);
    }
  };

  const nodiPer = new Map(definizione.nodes.map((n) => [n.id, n]));
  const W = d.width, H = d.height;
  // Ordine di disegno degli archi: i non percorsi sotto, i percorsi sopra, il selezionato in cima.
  const rango = (a: { indice: number; arco: { from: string; outcome?: string; to: string } }) =>
    p.selezione?.tipo === "arco" && p.selezione.indice === a.indice ? 2
      : modo === "vista" && p.archiPercorsi?.has(chiaveArco(a.arco.from, a.arco.outcome, a.arco.to)) ? 1 : 0;

  return (
    <Box sx={{ overflow: "auto", border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "#fbfbfc", maxHeight: p.altezzaMax ?? "74vh" }}>
      <svg ref={svgRef} width={W * zoom} height={H * zoom} viewBox={`0 0 ${W} ${H}`} role="group" aria-label={p.etichetta}
           style={{ display: "block", touchAction: "none", userSelect: "none" }}
           onPointerMove={muovi} onPointerUp={su} onPointerCancel={() => { setLega(null); setTrascina(null); }}
           onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as Element).getAttribute("data-sfondo")) p.onSeleziona?.(null); }}>
        <Sfondo d={d} />
        <defs>
          <filter id="ombra-scheda" x="-10%" y="-10%" width="130%" height="140%">
            <feDropShadow dx="1.5" dy="2" stdDeviation="1.6" floodColor="#1c2a3a" floodOpacity="0.28" />
          </filter>
          <marker id="freccia" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#212326" />
          </marker>
          <marker id="freccia-chiara" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L8,4 L0,8 z" fill="#b8bec6" />
          </marker>
        </defs>

        {/* archi: prima quelli non percorsi (sotto), poi i percorsi e il selezionato (sopra) */}
        {[...d.archi].sort((a, b) => rango(a) - rango(b)).map((a) => {
          const percorso = modo === "vista" ? !!p.archiPercorsi?.has(chiaveArco(a.arco.from, a.arco.outcome, a.arco.to)) : true;
          const sel = p.selezione?.tipo === "arco" && p.selezione.indice === a.indice;
          const errore = !!p.errori?.archi.has(a.indice);
          const dPath = percorsoSvg(a.punti);
          return (
            <g key={a.indice}>
              <path d={dPath} fill="none" stroke={sel ? "#1f4e79" : errore ? "#d93025" : percorso ? "#212326" : "#b8bec6"}
                    strokeWidth={sel ? 3.4 : percorso ? 2.6 : 1.6} strokeDasharray={errore ? "6 4" : undefined}
                    strokeLinejoin="round" markerEnd={percorso || sel ? "url(#freccia)" : "url(#freccia-chiara)"} />
              {edit && (
                <path d={dPath} fill="none" stroke="transparent" strokeWidth={12} style={{ cursor: "pointer" }}
                      onPointerDown={(e) => { e.stopPropagation(); p.onSeleziona?.({ tipo: "arco", indice: a.indice }); }}>
                  <title>{`${nodiPer.get(a.arco.from)?.name} → ${nodiPer.get(a.arco.to)?.name}`}</title>
                </path>
              )}
            </g>
          );
        })}
        {lega && <path d={`M${lega.da.x},${lega.da.y} L${lega.a.x},${lega.da.y} L${lega.a.x},${lega.a.y}`} fill="none"
                       stroke="#1f4e79" strokeWidth={2} strokeDasharray="5 4" />}

        {/* connettori verdi davanti all'ingresso dei nodi */}
        {d.ingressi.map(({ nodo, punto }) => (
          <g key={nodo} transform={`translate(${punto.x - 21},${punto.y - 7})`} aria-hidden="true">
            <rect width={14} height={14} rx={3} fill="#7cb518" stroke="#4d7a0c" strokeWidth={1} />
            <path d="M5,3.5 L10.5,7 L5,10.5 z" fill="#fff" />
          </g>
        ))}

        {/* etichette degli esiti, una per esito, sul tratto che esce dalla scheda */}
        {d.etichette.map((et) => {
          const n = nodiPer.get(et.from);
          const esito = n ? esitiDi(n).find((x) => x.code === et.outcome) : undefined;
          if (!esito) return null;
          const spunta = modo === "vista" && !!p.gruppiPercorsi?.has(et.gruppo);
          const spazioTesto = et.larghezza - 18 - (spunta ? 12 : 0);
          const maxCar = Math.max(3, Math.floor(spazioTesto / (10 * 0.53)));
          const testo = esito.label.length > maxCar ? `${esito.label.slice(0, maxCar - 1)}…` : esito.label;
          const w = Math.min(et.larghezza, larghezzaTesto(testo) + 22 + (spunta ? 12 : 0));
          const spento = modo === "vista" && !spunta;
          return (
            <g key={et.gruppo} transform={`translate(${et.x},${et.y - 8})`} opacity={spento ? 0.55 : 1}>
              <title>{`${n?.name}: ${esito.label}`}</title>
              <rect width={w} height={16} rx={3} fill="#fff" stroke="#8d96a0" strokeWidth={0.8} />
              <circle cx={8} cy={8} r={4.5} fill={COLORE_ESITO[esito.color]} stroke="#00000033" strokeWidth={0.6} />
              <text x={16} y={11.5} fontSize={10} fontWeight={600} fill="#212326">{testo}</text>
              {spunta && <path d={`M${w - 13},8 l3,3 l6,-7`} fill="none" stroke="#2e8b1f" strokeWidth={2} strokeLinecap="round" />}
            </g>
          );
        })}

        {/* schede dei nodi */}
        {definizione.nodes.map((n) => {
          const pos = d.nodi.get(n.id);
          if (!pos) return null;
          const sel = p.selezione?.tipo === "nodo" && p.selezione.id === n.id;
          const st = modo === "vista" ? p.stati?.get(n.id) : undefined;
          const stile = modo === "vista" ? STILE_STATO[st?.stato ?? "non_raggiunto"] : null;
          const errore = !!p.errori?.nodi.has(n.id);
          return (
            <g key={n.id} transform={`translate(${pos.x},${pos.y})`} tabIndex={0} role="button"
               aria-label={`${NOME_TIPO[n.type]}: ${n.name}${st ? `, ${NOME_STATO[st.stato]}${st.giri > 1 ? `, ${st.giri} giri` : ""}` : ""}${errore ? ", con errori" : ""}`}
               aria-pressed={sel} style={{ cursor: edit ? (trascina?.id === n.id ? "grabbing" : "grab") : "pointer", outline: "none" }}
               onPointerDown={(e) => giuNodo(e, n)}
               onKeyDown={(e) => {
                 if (e.key === "Enter" || e.key === " ") { e.preventDefault(); p.onSeleziona?.({ tipo: "nodo", id: n.id }); }
                 else p.onTastoNodo?.(n.id, e);
               }}
               onFocus={() => p.onSeleziona?.({ tipo: "nodo", id: n.id })}>
              <Scheda n={n} w={pos.w} h={pos.h} sel={sel} errore={errore} stile={stile} giri={st?.giri ?? 0}
                      piu={edit && n.type !== "end" ? () => p.onPiu?.(n.id) : undefined} />
              {edit && Object.entries(pos.porte).map(([code, pt]) => {
                const esito = esitiDi(n).find((x) => x.code === code);
                return (
                  <circle key={code || "uscita"} cx={pt.x - pos.x} cy={pt.y - pos.y} r={5.5}
                          fill={esito ? COLORE_ESITO[esito.color] : "#1f4e79"} stroke="#fff" strokeWidth={1.5}
                          style={{ cursor: "crosshair" }} onPointerDown={(e) => giuPorta(e, n.id, code || undefined, pt)}>
                    <title>{`Trascina su un nodo per collegare${esito ? ` l'esito «${esito.label}»` : ""}`}</title>
                  </circle>
                );
              })}
            </g>
          );
        })}
      </svg>
    </Box>
  );
}

/** Foglio: scacchiera leggera delle caselle più una griglia fine, come nello strumento che l'utente usa oggi. */
function Sfondo({ d }: { d: Disposizione }) {
  const cols = Math.ceil((d.width - d.padX) / d.cellW);
  const rows = Math.ceil((d.height - d.padTop) / d.cellH);
  const celle = [];
  for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
    if ((c + r) % 2) celle.push(<rect key={`${c}:${r}`} x={d.padX + c * d.cellW} y={d.padTop + r * d.cellH}
                                      width={d.cellW} height={d.cellH} fill="#1f4e79" opacity={0.035} data-sfondo="1" />);
  }
  return (
    <g>
      <defs>
        <pattern id="griglia-fine" width={12} height={12} patternUnits="userSpaceOnUse">
          <path d="M12,0 L0,0 L0,12" fill="none" stroke="#e1e5ea" strokeWidth={0.8} />
        </pattern>
      </defs>
      <rect width={d.width} height={d.height} fill="url(#griglia-fine)" data-sfondo="1" />
      {celle}
    </g>
  );
}

/** Una scheda del grafo: intestazione col tipo e l'icona, nome, pulsante "+" in basso, stati finali compatti. */
function Scheda({ n, w, h, sel, errore, stile, giri, piu }: {
  n: Nodo; w: number; h: number; sel: boolean; errore: boolean;
  stile: { fill: string; stroke: string; testo: string; tratteggio?: string } | null; giri: number; piu?: () => void;
}) {
  const fill = stile?.fill ?? "#f7f8fa";
  const stroke = sel ? "#1f4e79" : errore ? "#d93025" : stile?.stroke ?? "#aab2bc";
  const sw = sel ? 2.6 : errore || (stile && stile.stroke !== "#c6cbd2") ? 2 : 1.1;
  const testo = stile?.testo ?? "#212326";
  if (n.type === "end" || n.type === "start") {
    const righe = aCapo(n.name, 19, 2);
    return (
      <g>
        <rect width={w} height={h} rx={5} fill={fill} stroke={stroke} strokeWidth={sw} filter="url(#ombra-scheda)"
              strokeDasharray={errore ? "5 3" : stile?.tratteggio} />
        {n.type === "end"
          ? <circle cx={w / 2} cy={14} r={6} fill={n.result === "KO" ? COLORE_ESITO.red : COLORE_ESITO.green} stroke="#00000033" />
          : <path d={`M${w / 2 - 5},8 L${w / 2 + 6},14 L${w / 2 - 5},20 z`} fill="#4d7a0c" />}
        {righe.map((r, i) => (
          <text key={i} x={w / 2} y={33 + i * 12} textAnchor="middle" fontSize={10.5} fontWeight={700} fill={testo}>{r}</text>
        ))}
        {n.type === "start" && <text x={6} y={h - 5} fontSize={8.5} fill="#6b7280">Inizio</text>}
        {giri > 1 && <Giri w={w} giri={giri} />}
      </g>
    );
  }
  const righe = aCapo(n.name, Math.floor((w - 14) / 6), Math.max(3, Math.floor((h - 44) / 12.5)));
  return (
    <g>
      <rect width={w} height={h} rx={3} fill={fill} stroke={stroke} strokeWidth={sw} filter="url(#ombra-scheda)"
            strokeDasharray={errore ? "5 3" : stile?.tratteggio} />
      <rect x={1} y={1} width={w - 2} height={17} fill="#e9edf2" />
      <Icona tipo={n.type} />
      <text x={22} y={13} fontSize={9} fill="#434549">{n.type === "activity" ? "Attività" : NOME_TIPO[n.type]}</text>
      <rect x={5} y={22} width={w - 10} height={h - 34} fill="#fff" stroke="#d5dae0" strokeWidth={0.8} />
      {righe.map((r, i) => <text key={i} x={9} y={34 + i * 12.5} fontSize={10} fontWeight={700} fill={testo}>{r}</text>)}
      {giri > 1 && <Giri w={w} giri={giri} />}
      {piu && (
        <g transform={`translate(${w / 2},${h})`} style={{ cursor: "pointer" }}
           onPointerDown={(e) => { e.stopPropagation(); piu(); }}>
          <title>{n.type === "decision" || n.type === "activity" ? "Aggiungi un esito" : "Aggiungi il nodo successivo"}</title>
          <circle r={8} fill="#1f4e79" stroke="#fff" strokeWidth={1.5} />
          <path d="M-4,0 H4 M0,-4 V4" stroke="#fff" strokeWidth={2} />
        </g>
      )}
    </g>
  );
}

function Giri({ w, giri }: { w: number; giri: number }) {
  return (
    <g transform={`translate(${w - 44},-9)`}>
      <rect width={42} height={15} rx={7.5} fill="#1f4e79" />
      <text x={21} y={11} textAnchor="middle" fontSize={9} fontWeight={700} fill="#fff">{giri} giri</text>
    </g>
  );
}

/** Icone piccole dell'intestazione, disegnate a mano (niente font di icone esterni). */
function Icona({ tipo }: { tipo: Nodo["type"] }) {
  if (tipo === "notification")
    return (
      <g transform="translate(5,4)">
        <rect width={13} height={10} fill="#fff" stroke="#434549" strokeWidth={0.9} />
        <path d="M0,0 L6.5,5.5 L13,0" fill="none" stroke="#434549" strokeWidth={0.9} />
      </g>
    );
  if (tipo === "activity")
    return (
      <g transform="translate(5,4)">
        <rect width={11} height={11} fill="#fff" stroke="#434549" strokeWidth={0.9} />
        <path d="M2.5,6 l2.5,2.5 l4,-6" fill="none" stroke="#2e7d32" strokeWidth={1.4} />
      </g>
    );
  return (
    <g transform="translate(5,4)">
      <rect width={11} height={11} fill="#fffbe6" stroke="#6b5a00" strokeWidth={0.9} />
      <text x={5.5} y={9} textAnchor="middle" fontSize={9} fontWeight={700} fill="#4d7a0c">?</text>
    </g>
  );
}
