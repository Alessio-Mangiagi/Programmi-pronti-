// "><(((º> sabusabu <º)))><"
// Livello annotazioni sopra una pagina (PDF o immagine): mostra rettangoli e puntine in coordinate 0..1
// e, in modalità disegno, traccia una nuova area trascinando (un clic senza trascinare = puntina).
import { useRef, useState, type PointerEvent } from "react";
import { Box, Tooltip } from "@mui/material";
import type { Anchor, Markup } from "../../api";

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export function MarkupLayer({ page, markups, numbers, selectedId, drawing, draft, onDraw, onSelect }: {
  page: number;
  markups: Markup[];
  numbers: Map<string, number>;
  selectedId: string | null;
  drawing: boolean;
  draft: Anchor | null;
  onDraw: (a: Anchor) => void;
  onSelect: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [end, setEnd] = useState<{ x: number; y: number } | null>(null);

  const point = (e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height) };
  };
  const down = (e: PointerEvent) => {
    if (!drawing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e);
    setStart(p);
    setEnd(p);
  };
  const up = () => {
    if (!start || !end) return;
    const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x), h = Math.abs(end.y - start.y);
    onDraw(w < 0.01 && h < 0.01 ? { page, x: start.x, y: start.y } : { page, x, y, w, h });
    setStart(null);
    setEnd(null);
  };
  const live: Anchor | null = start && end
    ? { page, x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), w: Math.abs(end.x - start.x), h: Math.abs(end.y - start.y) }
    : draft?.page === page ? draft : null;

  return (
    <Box ref={ref} onPointerDown={down} onPointerMove={(e) => start && setEnd(point(e))} onPointerUp={up}
         sx={{ position: "absolute", inset: 0, cursor: drawing ? "crosshair" : "default", touchAction: drawing ? "none" : "auto" }}>
      {markups.filter((m) => m.page === page && m.x !== null && m.y !== null).map((m) => {
        const selected = m.id === selectedId;
        const faded = m.status === "RESOLVED";
        const label = numbers.get(m.id);
        const common = { position: "absolute", left: `${m.x! * 100}%`, top: `${m.y! * 100}%`, cursor: "pointer",
                         opacity: faded ? 0.45 : 1, pointerEvents: drawing ? "none" : "auto" } as const;
        return (
          <Tooltip key={m.id} title={`${label}. ${m.body}`} placement="top">
            {m.w !== null && m.h !== null ? (
              <Box onClick={() => onSelect(m.id)} sx={{
                ...common, width: `${m.w * 100}%`, height: `${m.h * 100}%`, border: `2px solid ${m.color}`,
                bgcolor: `${m.color}1f`, boxShadow: selected ? `0 0 0 3px ${m.color}66` : "none",
              }}>
                <Box component="span" sx={{ position: "absolute", top: -11, left: -11, ...badge(m.color) }}>{label}</Box>
              </Box>
            ) : (
              <Box component="span" onClick={() => onSelect(m.id)}
                   sx={{ ...common, transform: "translate(-50%, -50%)", ...badge(m.color),
                         boxShadow: selected ? `0 0 0 3px ${m.color}66` : "0 1px 3px rgba(0,0,0,.4)" }}>{label}</Box>
            )}
          </Tooltip>
        );
      })}
      {live && (live.w ? (
        <Box sx={{ position: "absolute", left: `${live.x * 100}%`, top: `${live.y * 100}%`, width: `${live.w * 100}%`,
                   height: `${(live.h ?? 0) * 100}%`, border: "2px dashed #1976d2", bgcolor: "#1976d21f", pointerEvents: "none" }} />
      ) : (
        <Box sx={{ position: "absolute", left: `${live.x * 100}%`, top: `${live.y * 100}%`, transform: "translate(-50%, -50%)",
                   ...badge("#1976d2"), pointerEvents: "none" }}>+</Box>
      ))}
    </Box>
  );
}

function badge(color: string) {
  return {
    width: 22, height: 22, borderRadius: "50%", bgcolor: color, color: "#fff", fontSize: 12, fontWeight: 700,
    display: "flex", alignItems: "center", justifyContent: "center",
  } as const;
}
