// "><(((º> sabusabu <º)))><"
// Menu "Esporta Excel" della commessa: registro documenti, stato approvazioni, RFI (solo ciò che l'utente vede).
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button, CircularProgress, ListItemText, Menu, MenuItem, Snackbar } from "@mui/material";
import TableViewIcon from "@mui/icons-material/TableView";
import { apiDownload, ApiError } from "../api";

const REPORTS = [
  { kind: "documents", label: "Registro documenti", detail: "Ultima revisione, stato e cartella di ogni documento" },
  { kind: "approvals", label: "Stato approvazioni", detail: "Workflow, step corrente, chi deve rispondere" },
  { kind: "rfis", label: "RFI", detail: "Richieste di informazioni con scadenze e risposte" },
  { kind: "reservations", label: "Numeri prenotati", detail: "Elenco elaborati prenotati dalla tua organizzazione e loro stato" },
];

export function ReportMenu({ projectId }: { projectId: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const run = useMutation({
    mutationFn: (kind: string) => apiDownload(`/projects/${projectId}/reports/${kind}.xlsx`, `${kind}.xlsx`),
  });
  return (
    <>
      <Button variant="outlined" startIcon={run.isPending ? <CircularProgress size={16} /> : <TableViewIcon />}
              disabled={run.isPending} onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu">
        Esporta Excel
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {REPORTS.map((r) => (
          <MenuItem key={r.kind} onClick={() => { setAnchor(null); run.mutate(r.kind); }}>
            <ListItemText primary={r.label} secondary={r.detail} />
          </MenuItem>
        ))}
      </Menu>
      <Snackbar open={!!run.error} autoHideDuration={6000} onClose={() => run.reset()}
                message={(run.error as ApiError | null)?.message ?? ""} />
    </>
  );
}
