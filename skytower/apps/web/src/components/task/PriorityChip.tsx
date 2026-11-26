// "><(((º> sabusabu <º)))><"
// Etichetta della priorità di un task (ADR-59). Colori scelti per il contrasto WCAG AA su fondo bianco: l'arancione
// "warning" di MUI (#ed6c02) sul bianco non basta per un testo piccolo, quindi "Alta" usa un arancione scuro.
import { Chip } from "@mui/material";
import { TeamTaskPriority } from "../../api";
import { PRIORITY } from "./common";

const COLORI: Record<TeamTaskPriority, { color: string; borderColor: string }> = {
  LOW: { color: "#4b5563", borderColor: "#9ca3af" },
  NORMAL: { color: "#1f4e79", borderColor: "#7aa0c4" },
  HIGH: { color: "#8a4500", borderColor: "#d97706" },
  URGENT: { color: "#b42318", borderColor: "#e5484d" },
};

export function PriorityChip({ priority }: { priority: TeamTaskPriority }) {
  return <Chip size="small" variant="outlined" label={PRIORITY[priority].label} sx={{ ...COLORI[priority], fontWeight: 600 }} />;
}
