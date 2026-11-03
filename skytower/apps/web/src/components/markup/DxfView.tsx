// "><(((º> sabusabu <º)))><"
// Viewer dei disegni CAD (DWG/DXF) senza licenza (G44, ADR-41): mostra l'SVG preparato dal worker
// (un <g data-layer> per layer), con pan (trascina), zoom (rotella, pulsanti), spunte dei layer, misura di una
// distanza con due clic nelle unità del disegno e le annotazioni della revisione sopra il disegno (stesso
// livello delle immagini: coordinate 0..1 sul riquadro del disegno, quindi seguono pan e zoom).
// L'SVG è generato dal server, ma prima di metterlo nella pagina si passa da DOMParser e si tengono solo
// gli elementi grafici: niente script, niente gestori di eventi, niente riferimenti esterni.
import { useEffect, useMemo, useRef, useState, type ReactNode, type WheelEvent, type PointerEvent } from "react";
import { Box, Checkbox, Chip, CircularProgress, FormControlLabel, IconButton, Paper, Stack, ToggleButton, Tooltip, Typography } from "@mui/material";
import LayersIcon from "@mui/icons-material/Layers";
import StraightenIcon from "@mui/icons-material/Straighten";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";

export interface DxfLayer { name: string; color: string; visible: boolean; entities: number }

const ALLOWED = new Set(["svg", "g", "path", "text", "circle", "rect", "line", "polyline", "polygon", "ellipse", "tspan"]);
const UNIT_LABEL: Record<string, string> = { mm: "mm", cm: "cm", m: "m", km: "km", dm: "dm", in: "in", ft: "ft" };

/** Tiene solo elementi e attributi grafici dell'SVG (niente script, on*, href): è nostro, ma non ci si fida mai. */
function sanitize(text: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== "svg" || doc.querySelector("parsererror")) return null;
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!ALLOWED.has(child.tagName.toLowerCase())) { child.remove(); continue; }
      for (const a of Array.from(child.attributes)) {
        if (/^on/i.test(a.name) || /href|xlink|src/i.test(a.name)) child.removeAttribute(a.name);
      }
      walk(child);
    }
  };
  walk(root);
  return root as unknown as SVGSVGElement;
}

/** Distanza in unità del disegno formattata con l'unità del DXF (mm → anche in metri sopra il metro). */
function formatDistance(d: number, units: string): string {
  if (units === "mm") return d >= 1000 ? `${(d / 1000).toLocaleString("it-IT", { maximumFractionDigits: 2 })} m` : `${d.toLocaleString("it-IT", { maximumFractionDigits: 0 })} mm`;
  if (units === "cm") return d >= 100 ? `${(d / 100).toLocaleString("it-IT", { maximumFractionDigits: 2 })} m` : `${d.toLocaleString("it-IT", { maximumFractionDigits: 1 })} cm`;
  const label = UNIT_LABEL[units] ?? "";
  return `${d.toLocaleString("it-IT", { maximumFractionDigits: 2 })}${label ? " " + label : ""}`;
}

export default function DxfView({ url, layers, overlay, drawing }: {
  /** URL firmato dell'SVG del derivato */
  url: string;
  /** layer del disegno come li ha letti il worker (nome, colore, visibile) */
  layers: DxfLayer[];
  /** livello annotazioni, in coordinate 0..1 sul riquadro del disegno */
  overlay: (page: number) => ReactNode;
  /** modalità "Annota" attiva: il trascinamento serve a disegnare, non a spostare */
  drawing: boolean;
}) {
  const [svgText, setSvgText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Record<string, boolean>>(() => Object.fromEntries(layers.map((l) => [l.name, l.visible])));
  const [showLayers, setShowLayers] = useState(true);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [measuring, setMeasuring] = useState(false);
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    let alive = true;
    setSvgText(null); setError(null); setScale(1); setOffset({ x: 0, y: 0 }); setPoints([]);
    fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => { if (alive) setSvgText(t); }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [url]);

  // l'SVG entra nel DOM una volta sola (può essere grande); i layer si accendono/spengono per attributo
  const parsed = useMemo(() => (svgText ? sanitize(svgText) : null), [svgText]);
  const units = parsed?.getAttribute("data-units") ?? "";
  const viewBox = useMemo(() => (parsed?.getAttribute("viewBox") ?? "0 0 1 1").split(/\s+/).map(Number), [parsed]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.replaceChildren();
    if (parsed) {
      const node = parsed.cloneNode(true) as SVGSVGElement;
      node.setAttribute("width", "100%"); node.setAttribute("height", "100%");
      node.setAttribute("preserveAspectRatio", "xMidYMid meet");
      node.style.display = "block";
      el.appendChild(node);
    }
  }, [parsed]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    el.querySelectorAll<SVGGElement>("g[data-layer]").forEach((g) => {
      const name = g.getAttribute("data-layer") ?? "";
      g.style.display = visible[name] === false ? "none" : "";
    });
  }, [visible, parsed]);
  useEffect(() => { if (!measuring) setPoints([]); }, [measuring]);
  if (!parsed && error) return <Typography color="error" m="auto">Disegno non leggibile: {error}</Typography>;
  if (!parsed) return <CircularProgress sx={{ color: "#fff", m: "auto" }} />;

  /** punto del mouse in coordinate del disegno (unità del DXF, Y come nel DXF) */
  const toDrawing = (e: PointerEvent) => {
    const box = host.current!.querySelector("svg")!.getBoundingClientRect();
    // con "meet" l'SVG è centrato: si calcola la scala uniforme e il margine
    const [vx, vy, vw, vh] = viewBox;
    const k = Math.min(box.width / vw, box.height / vh);
    const mx = (box.width - vw * k) / 2, my = (box.height - vh * k) / 2;
    const x = vx + (e.clientX - box.left - mx) / k;
    const y = -(vy + (e.clientY - box.top - my) / k);          // l'SVG ha l'Y invertito rispetto al DXF
    return { x, y };
  };
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const next = Math.min(40, Math.max(0.2, scale * factor));
    if (cx !== undefined && cy !== undefined && area.current) {
      const r = area.current.getBoundingClientRect();
      const px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2;
      setOffset((o) => ({ x: px - (px - o.x) * (next / scale), y: py - (py - o.y) * (next / scale) }));
    }
    setScale(next);
  };
  const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, e.clientX, e.clientY); };
  const down = (e: PointerEvent) => {
    if (drawing) return;
    moved.current = false;
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (measuring) setCursor(toDrawing(e));
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
    setOffset({ x: drag.current.ox + dx, y: drag.current.oy + dy });
  };
  const up = (e: PointerEvent) => {
    const wasDrag = moved.current;
    drag.current = null;
    if (measuring && !wasDrag && !drawing) {
      const p = toDrawing(e);
      setPoints((ps) => (ps.length >= 2 ? [p] : [...ps, p]));
    }
  };
  const distance = points.length === 2 ? Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) : null;
  const toPercent = (p: { x: number; y: number }) => {
    const [vx, vy, vw, vh] = viewBox;
    return { left: `${((p.x - vx) / vw) * 100}%`, top: `${((-p.y - vy) / vh) * 100}%` };
  };
  const aspect = viewBox[2] / viewBox[3];

  return (
    <Box position="relative" flexGrow={1} display="flex" minHeight={0} alignSelf="stretch">
      <Box ref={area} flexGrow={1} overflow="hidden" position="relative" onWheel={onWheel}
           onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setCursor(null)}
           sx={{ cursor: drawing ? "crosshair" : measuring ? "cell" : drag.current ? "grabbing" : "grab", touchAction: "none", bgcolor: "#525659" }}
           aria-label="Disegno CAD" role="img">
        {/* il riquadro ha le proporzioni del viewBox, così l'overlay in 0..1 coincide con il disegno */}
        <Box sx={{ position: "absolute", left: "50%", top: "50%", width: aspect >= 1 ? "92%" : `${92 * aspect}%`, aspectRatio: `${aspect}`,
                   transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${scale})`, transformOrigin: "center",
                   bgcolor: "#fff", boxShadow: 3 }}>
          <Box ref={host} sx={{ position: "absolute", inset: 0, "& svg text": { userSelect: "none" } }} />
          {overlay(1)}
          {points.map((p, i) => (
            <Box key={i} sx={{ position: "absolute", ...toPercent(p), width: 10, height: 10, borderRadius: "50%", bgcolor: "#d32f2f",
                               transform: "translate(-50%, -50%)", pointerEvents: "none", border: "2px solid #fff" }} />
          ))}
          {points.length === 2 && (
            <Box component="svg" viewBox="0 0 100 100" preserveAspectRatio="none" sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
              <line x1={parseFloat(toPercent(points[0]).left)} y1={parseFloat(toPercent(points[0]).top)}
                    x2={parseFloat(toPercent(points[1]).left)} y2={parseFloat(toPercent(points[1]).top)}
                    stroke="#d32f2f" strokeWidth={0.4} vectorEffect="non-scaling-stroke" strokeDasharray="1 1" />
            </Box>
          )}
        </Box>
      </Box>

      {/* comandi: zoom, misura, layer */}
      <Stack direction="row" spacing={0.5} sx={{ position: "absolute", top: 8, left: 8, bgcolor: "background.paper", borderRadius: 1, p: 0.5, boxShadow: 2 }}>
        <IconButton size="small" aria-label="Ingrandisci" onClick={() => zoomAt(1.25)}><ZoomInIcon /></IconButton>
        <IconButton size="small" aria-label="Riduci" onClick={() => zoomAt(1 / 1.25)}><ZoomOutIcon /></IconButton>
        <IconButton size="small" aria-label="Adatta" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }); }}><CenterFocusStrongIcon /></IconButton>
        <Tooltip title="Misura: due clic sul disegno, la distanza è nelle unità del DXF">
          <ToggleButton size="small" value="measure" selected={measuring} onChange={() => setMeasuring((m) => !m)} aria-label="Misura">
            <StraightenIcon fontSize="small" />
          </ToggleButton>
        </Tooltip>
        <ToggleButton size="small" value="layers" selected={showLayers} onChange={() => setShowLayers((s) => !s)} aria-label="Layer">
          <LayersIcon fontSize="small" />
        </ToggleButton>
        <Typography variant="caption" alignSelf="center" px={0.5}>{Math.round(scale * 100)}%</Typography>
      </Stack>
      {(distance !== null || (measuring && cursor)) && (
        <Chip size="small" color="primary" sx={{ position: "absolute", bottom: 12, left: 12 }}
              label={distance !== null ? `Distanza: ${formatDistance(distance, units)}` : `X ${formatDistance(cursor!.x, units)} · Y ${formatDistance(cursor!.y, units)} — clic sul primo punto`} />
      )}
      {showLayers && layers.length > 0 && (
        <Paper role="region" aria-label="Layer" sx={{ position: "absolute", top: 8, right: 8, maxHeight: "60%", overflow: "auto", p: 1, minWidth: 180 }}>
          <Typography variant="subtitle2" px={1}>Layer</Typography>
          {layers.map((l) => (
            <FormControlLabel key={l.name} sx={{ display: "flex", mx: 0 }}
              control={<Checkbox size="small" checked={visible[l.name] !== false}
                                 onChange={(e) => setVisible((v) => ({ ...v, [l.name]: e.target.checked }))} />}
              label={<Stack direction="row" alignItems="center" spacing={1}>
                <Box width={12} height={12} borderRadius="2px" bgcolor={l.color} border="1px solid #999" />
                <Typography variant="body2" noWrap>{l.name}</Typography>
                <Typography variant="caption" color="text.secondary">{l.entities}</Typography>
              </Stack>} />
          ))}
        </Paper>
      )}
    </Box>
  );
}
