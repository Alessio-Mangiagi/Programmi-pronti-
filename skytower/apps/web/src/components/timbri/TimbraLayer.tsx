// "><(((º> sabusabu <º)))><"
// Strato "Timbra" sopra una pagina del PDF (ADR-56): con un timbro scelto nel pannello, un clic sulla pagina lo mette
// lì; ogni timbro piazzato si trascina per spostarlo, si ridimensiona dall'angolo in basso a destra (le proporzioni
// dell'immagine restano) e si toglie con la ×. Le posizioni sono frazioni della pagina come la si vede (origine in
// alto a sinistra), le stesse delle annotazioni (MarkupLayer): il server le riporta sul PDF (cde_api/timbri.py).
import { useRef, type PointerEvent } from "react";
import { Box, IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useImmagineTimbro, type Timbro } from "./timbri";

export interface Piazzamento {
  chiave: string;
  timbro: Timbro;
  pagina: number;
  x: number;
  y: number;
  larghezza: number;
  altezza: number;
  didascalia: boolean;
}

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
/** Larghezza iniziale di un timbro: un quinto della pagina (circa 4 cm su un A4). */
const LARGHEZZA_INIZIALE = 0.2;

export function TimbraLayer({ page, piazzamenti, attivo, selezionato, didascalia, testoDidascalia, onAggiungi, onCambia, onSeleziona, onTogli }: {
  page: number;
  piazzamenti: Piazzamento[];
  /** timbro scelto nel pannello: il prossimo clic sulla pagina lo mette lì */
  attivo: Timbro | null;
  selezionato: string | null;
  didascalia: boolean;
  testoDidascalia: string;
  onAggiungi: (p: Omit<Piazzamento, "chiave">) => void;
  onCambia: (chiave: string, p: Partial<Piazzamento>) => void;
  onSeleziona: (chiave: string | null) => void;
  onTogli: (chiave: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // trascinamento in corso: cosa (spostare o ridimensionare), da dove è partito il puntatore, com'era il timbro
  const drag = useRef<{ chiave: string; tipo: "sposta" | "ridimensiona"; px: number; py: number; orig: Piazzamento } | null>(null);

  const pagina = () => ref.current!.getBoundingClientRect();
  const aggiungi = (e: PointerEvent) => {
    if (!attivo || e.target !== e.currentTarget) { onSeleziona(null); return; }
    const r = pagina();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    // altezza in frazione della pagina con le proporzioni dell'immagine e della pagina
    const larghezza = LARGHEZZA_INIZIALE;
    const altezza = Math.min(0.9, larghezza * (attivo.height_px / attivo.width_px) * (r.width / r.height));
    onAggiungi({ timbro: attivo, pagina: page, larghezza, altezza, didascalia,
                 x: clamp(px - larghezza / 2, 0, 1 - larghezza), y: clamp(py - altezza / 2, 0, 1 - altezza) });
  };
  const inizia = (e: PointerEvent, p: Piazzamento, tipo: "sposta" | "ridimensiona") => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeleziona(p.chiave);
    drag.current = { chiave: p.chiave, tipo, px: e.clientX, py: e.clientY, orig: p };
  };
  const muovi = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const r = pagina();
    const dx = (e.clientX - d.px) / r.width, dy = (e.clientY - d.py) / r.height;
    const o = d.orig;
    if (d.tipo === "sposta") {
      onCambia(d.chiave, { x: clamp(o.x + dx, 0, 1 - o.larghezza), y: clamp(o.y + dy, 0, 1 - o.altezza) });
    } else {
      // l'angolo segue il puntatore in orizzontale; l'altezza segue le proporzioni, senza uscire dalla pagina
      const rapporto = o.altezza / o.larghezza;
      const massima = Math.min(1 - o.x, (1 - o.y) / rapporto);
      const larghezza = clamp(o.larghezza + dx, 0.02, massima);
      onCambia(d.chiave, { larghezza, altezza: larghezza * rapporto });
    }
  };
  const fine = () => { drag.current = null; };

  return (
    <Box ref={ref} data-timbra-pagina={page} onPointerDown={aggiungi} onPointerMove={muovi} onPointerUp={fine}
         sx={{ position: "absolute", inset: 0, cursor: attivo ? "copy" : "default", touchAction: "none",
               outline: attivo ? "2px dashed rgba(25,118,210,.5)" : "none" }}>
      {piazzamenti.map((p) => (
        <TimbroPiazzato key={p.chiave} p={p} selezionato={p.chiave === selezionato} testoDidascalia={testoDidascalia}
                        onSposta={(e) => inizia(e, p, "sposta")} onRidimensiona={(e) => inizia(e, p, "ridimensiona")}
                        onTogli={() => onTogli(p.chiave)} />
      ))}
    </Box>
  );
}

function TimbroPiazzato({ p, selezionato, testoDidascalia, onSposta, onRidimensiona, onTogli }: {
  p: Piazzamento; selezionato: boolean; testoDidascalia: string;
  onSposta: (e: PointerEvent) => void; onRidimensiona: (e: PointerEvent) => void; onTogli: () => void;
}) {
  const { data: url } = useImmagineTimbro(p.timbro.id);
  return (
    <Box role="img" aria-label={`Timbro ${p.timbro.name} sulla pagina ${p.pagina}`} onPointerDown={onSposta}
         sx={{ position: "absolute", left: `${p.x * 100}%`, top: `${p.y * 100}%`, width: `${p.larghezza * 100}%`,
               height: `${p.altezza * 100}%`, cursor: "move",
               outline: selezionato ? "2px solid #1976d2" : "1px dashed rgba(25,118,210,.7)" }}>
      {url && <Box component="img" src={url} alt="" draggable={false}
                   sx={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", display: "block" }} />}
      {p.didascalia && (
        <Typography component="span" sx={{ position: "absolute", top: "100%", left: "50%", transform: "translateX(-50%)",
                                           whiteSpace: "nowrap", fontSize: 9, color: "#28285a", pointerEvents: "none" }}>
          {testoDidascalia}
        </Typography>
      )}
      <IconButton size="small" aria-label={`Togli il timbro ${p.timbro.name}`}
                  onPointerDown={(e) => e.stopPropagation()} onClick={onTogli}
                  sx={{ position: "absolute", top: -12, right: -12, width: 22, height: 22, bgcolor: "#fff", boxShadow: 1,
                        "&:hover": { bgcolor: "#fff" } }}>
        <CloseIcon sx={{ fontSize: 14 }} />
      </IconButton>
      <Box aria-label={`Ridimensiona il timbro ${p.timbro.name}`} onPointerDown={onRidimensiona}
           sx={{ position: "absolute", right: -6, bottom: -6, width: 12, height: 12, bgcolor: "#1976d2",
                 border: "2px solid #fff", borderRadius: "2px", cursor: "nwse-resize" }} />
    </Box>
  );
}
