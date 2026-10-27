// "><(((º> sabusabu <º)))><"
// Dialog di transizione di stato (singola o massiva) guidato dalle regole del progetto.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItem, ListItemText, MenuItem, Stack,
  TextField, Typography,
} from "@mui/material";
import { api, ApiError } from "../../api";

export type CdeState = "WIP" | "SHARED" | "PUBLISHED" | "ARCHIVED";

export interface TransitionRule {
  from_state: CdeState;
  to_state: CdeState;
  required_action: string;
  originator_only: boolean;
  allowed_suitability: string[];
  reason_required: boolean;
}

export const STATE_LABEL: Record<CdeState, string> = {
  WIP: "In lavorazione", SHARED: "Condiviso", PUBLISHED: "Pubblicato", ARCHIVED: "Archiviato",
};
export const STATE_COLOR: Record<CdeState, "default" | "info" | "success" | "secondary"> = {
  WIP: "default", SHARED: "info", PUBLISHED: "success", ARCHIVED: "secondary",
};
export const ACTION_LABEL: Partial<Record<CdeState, string>> = {
  SHARED: "Condividi", PUBLISHED: "Pubblica", ARCHIVED: "Archivia",
};
const SUITABILITY: Record<string, string> = {
  S1: "S1 — Coordinamento", S2: "S2 — Informazione", S3: "S3 — Revisione e commento", S4: "S4 — Approvazione di fase",
  A1: "A1 — Accettato (fase 1)", A2: "A2 — Accettato (fase 2)", A3: "A3 — Accettato (fase 3)", A4: "A4", A5: "A5",
  A6: "A6", A7: "A7", B1: "B1 — Parziale con commenti", B2: "B2", B3: "B3", CR: "CR — As-built",
};

export function useTransitionRules(projectId: string) {
  return useQuery({
    queryKey: ["transition-rules", projectId],
    queryFn: () => api<TransitionRule[]>(`/projects/${projectId}/state-transitions`),
    staleTime: 60_000,
  });
}

interface BulkResult { succeeded: number; failed: number; results: { revision_id: string; ok: boolean; error?: string; revision_code?: string }[] }

export function TransitionDialog({ projectId, from, to, revisions, onClose }: {
  projectId: string;
  from: CdeState;
  to: CdeState;
  revisions: { id: string; label: string }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: rules = [] } = useTransitionRules(projectId);
  const rule = rules.find((r) => r.from_state === from && r.to_state === to);
  const [suitability, setSuitability] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<BulkResult | null>(null);

  const run = useMutation({
    mutationFn: () => api<BulkResult>(`/projects/${projectId}/transitions/bulk`, {
      method: "POST",
      json: { revision_ids: revisions.map((r) => r.id), to_state: to, suitability: suitability || null, reason: reason || null },
    }),
    onSuccess: (r) => {
      setResult(r);
      qc.invalidateQueries({ queryKey: ["documents"] });
      qc.invalidateQueries({ queryKey: ["area"] });
      qc.invalidateQueries({ queryKey: ["document"] });
    },
  });

  const label = (id: string) => revisions.find((r) => r.id === id)?.label ?? id;
  const needsSuitability = to !== "ARCHIVED";

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{ACTION_LABEL[to]} {revisions.length > 1 ? `${revisions.length} documenti` : revisions[0]?.label}</DialogTitle>
      <DialogContent>
        {!rule ? (
          <Alert severity="warning">Transizione {STATE_LABEL[from]} → {STATE_LABEL[to]} non prevista dalle regole del progetto.</Alert>
        ) : result ? (
          <Stack spacing={1}>
            <Alert severity={result.failed ? "warning" : "success"}>
              {result.succeeded} completate, {result.failed} non riuscite
            </Alert>
            <List dense>
              {result.results.map((r) => (
                <ListItem key={r.revision_id}>
                  <ListItemText primary={label(r.revision_id)}
                                secondary={r.ok ? `OK${r.revision_code ? ` → ${r.revision_code}` : ""}` : r.error}
                                secondaryTypographyProps={{ color: r.ok ? "success.main" : "error" }} />
                </ListItem>
              ))}
            </List>
          </Stack>
        ) : (
          <Stack spacing={2} mt={1}>
            {run.error && <Alert severity="error">{(run.error as ApiError).message}</Alert>}
            <Typography variant="body2" color="text.secondary">
              Permesso richiesto: {rule.required_action}{rule.originator_only ? " (solo l'organizzazione autrice)" : ""}.
              {to === "SHARED" && " La revisione WIP verrà ricodificata (es. P01.03 → P01) e diventerà visibile al team di coordinamento."}
              {to === "PUBLISHED" && " Verrà creata la revisione contrattuale (C01, C02…) visibile a tutto il progetto."}
              {to === "ARCHIVED" && " Il documento diventerà di sola lettura."}
            </Typography>
            {needsSuitability && (
              <TextField select label="Codice di idoneità" value={suitability} onChange={(e) => setSuitability(e.target.value)}>
                {rule.allowed_suitability.map((s) => <MenuItem key={s} value={s}>{SUITABILITY[s] ?? s}</MenuItem>)}
              </TextField>
            )}
            <TextField label={`Motivazione${rule.reason_required ? " (obbligatoria)" : ""}`} value={reason}
                       onChange={(e) => setReason(e.target.value)} multiline minRows={2} />
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{result ? "Chiudi" : "Annulla"}</Button>
        {!result && rule && (
          <Button variant="contained" onClick={() => run.mutate()}
                  disabled={run.isPending || (needsSuitability && !suitability) || (rule.reason_required && !reason.trim())}>
            {ACTION_LABEL[to]}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
