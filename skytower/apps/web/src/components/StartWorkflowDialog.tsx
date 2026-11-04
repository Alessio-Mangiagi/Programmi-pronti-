// "><(((º> sabusabu <º)))><"
// Avvio di un workflow di approvazione su una revisione (dalla cartella o dal dettaglio documento).
// Nell'elenco anche i modelli della libreria dell'organizzazione proprietaria (ADR-50), col bollino "Libreria".
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { api, ApiError } from "../api";

// subject: i modelli per i processi (workflow a grafo) non si avviano su un documento
// scope: LIBRARY = modello della libreria dell'organizzazione proprietaria della commessa (ADR-50)
interface Template {
  id: string; code: string; version: number; name: string; is_active: boolean; subject?: "DOCUMENT" | "PROCESS";
  scope?: "PROJECT" | "LIBRARY"; organization_name?: string | null;
}

export function StartWorkflowDialog({ projectId, revisionId, label, onClose }: {
  projectId: string; revisionId: string; label: string; onClose: () => void;
}) {
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState("");
  const [comment, setComment] = useState("");
  const { data: templates = [] } = useQuery({
    queryKey: ["workflow-templates", projectId],
    queryFn: () => api<Template[]>(`/projects/${projectId}/workflow-templates`),
  });
  const perDocumenti = templates.filter((t) => t.is_active && t.subject !== "PROCESS")
    .sort((a, b) => Number(a.scope === "LIBRARY") - Number(b.scope === "LIBRARY") || a.name.localeCompare(b.name));
  const start = useMutation({
    mutationFn: () => api<{ id: string }>(`/revisions/${revisionId}/workflows`, {
      method: "POST", json: { template_id: templateId, comment: comment || null },
    }),
    onSuccess: (wf) => { onClose(); navigate(`/compiti?instance=${wf.id}`); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Avvia approvazione</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Typography variant="body2">Documento: <b>{label}</b>. Durante la revisione il documento è bloccato.</Typography>
          {start.error && <Alert severity="error">{(start.error as ApiError).message}</Alert>}
          {perDocumenti.length === 0
            ? <Alert severity="info">Nessun workflow configurato per la commessa: lo crea il Project Admin nella scheda Workflow.</Alert>
            : (
              <TextField select label="Workflow" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {perDocumenti.map((t) => (
                  <MenuItem key={t.id} value={t.id}>
                    {t.name} (v{t.version})
                    {t.scope === "LIBRARY" && <Chip size="small" color="primary" label="Libreria" sx={{ ml: 1, height: 20 }} />}
                  </MenuItem>
                ))}
              </TextField>
            )}
          <TextField label="Nota per i revisori" multiline minRows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!templateId || start.isPending} onClick={() => start.mutate()}>Avvia</Button>
      </DialogActions>
    </Dialog>
  );
}
