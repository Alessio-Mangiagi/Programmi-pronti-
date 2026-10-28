// "><(((º> sabusabu <º)))><"
// Frecce Indietro / Avanti nella barra in alto: si muovono nella cronologia delle pagine visitate dentro
// l'app (react-router tiene la posizione in history.state.idx). Avanti si accende solo dopo un Indietro;
// una nuova pagina aperta cancella l'"avanti", come nel browser. Scorciatoie del browser: Alt+← / Alt+→.
import { useEffect, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { IconButton, Stack } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";

const KEY = "cde-nav-max";      // posizione più avanti raggiunta, sopravvive al ricaricamento della scheda
const currentIdx = () => (window.history.state as { idx?: number } | null)?.idx ?? 0;
const readMax = () => {
  try { return Number(sessionStorage.getItem(KEY)) || 0; } catch { return 0; }
};

export function HistoryArrows() {
  const location = useLocation();
  const type = useNavigationType();
  const navigate = useNavigate();
  const [pos, setPos] = useState(() => ({ idx: currentIdx(), max: Math.max(readMax(), currentIdx()) }));

  useEffect(() => {
    const idx = currentIdx();
    setPos((p) => {
      const max = type === "PUSH" ? idx : Math.max(p.max, idx);
      try { sessionStorage.setItem(KEY, String(max)); } catch { /* archiviazione non disponibile */ }
      return { idx, max };
    });
  }, [location.key, type]);

  return (
    <Stack direction="row">
      <IconButton color="inherit" aria-label="Indietro" title="Indietro (Alt+←)" disabled={pos.idx <= 0}
                  onClick={() => navigate(-1)} sx={{ "&.Mui-disabled": { color: "rgba(255,255,255,0.4)" } }}>
        <ArrowBackIcon />
      </IconButton>
      <IconButton color="inherit" aria-label="Avanti" title="Avanti (Alt+→)" disabled={pos.idx >= pos.max}
                  onClick={() => navigate(1)} sx={{ "&.Mui-disabled": { color: "rgba(255,255,255,0.4)" } }}>
        <ArrowForwardIcon />
      </IconButton>
    </Stack>
  );
}
