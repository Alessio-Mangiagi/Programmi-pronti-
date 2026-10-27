// "><(((º> sabusabu <º)))><"
// Inbox dei compiti di revisione e pagina di esito.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Tab, Table, TableBody,
  TableCell, TableHead, TableRow, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { api, ApiError } from "../api";
import { WorkflowProgress } from "../components/WorkflowProgress";

interface Task {
  id: string;
  status: "OPEN" | "DONE" | "CANCELLED";
  outcome: string | null;
  comment: string | null;
  due_at: string | null;
  created_at: string;
  instance_id: string;
  step_name: string;
  identifier: string;
  title: string;
  revision_id: string;
  revision_code: string;
  suitability: string;
  template_name: string;
  project_code: string;
  overdue: boolean;
}

const OUTCOME_LABEL: Record<string, string> = {
  APPROVED: "Approvato", APPROVED_WITH_COMMENTS: "Approvato con commenti", REJECTED: "Rifiutato",
};

export function TasksPage() {
  const [status, setStatus] = useState<"OPEN" | "ALL">("OPEN");
  const [params, setParams] = useSearchParams();
  const { data: tasks = [] } = useQuery({
    queryKey: ["my-tasks", status],
    queryFn: () => api<Task[]>(`/me/tasks?status=${status}`),
  });
  const focusInstance = params.get("instance");
  const current = tasks.find((t) => t.instance_id === focusInstance && t.status === "OPEN") ?? null;

  return (
    <Stack spacing={2}>
      <Typography variant="h4" fontWeight={600}>I miei compiti</Typography>
      <Paper variant="outlined" sx={{ p: 2, overflowX: "auto" }}>
        <Tabs value={status} onChange={(_, v) => setStatus(v)} sx={{ mb: 1 }}>
          <Tab value="OPEN" label="Da svolgere" />
          <Tab value="ALL" label="Tutti" />
        </Tabs>
        {tasks.length === 0 ? <Typography color="text.secondary">Nessun compito.</Typography> : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Documento</TableCell><TableCell>Rev.</TableCell><TableCell>Workflow / step</TableCell>
                <TableCell>Progetto</TableCell><TableCell>Scadenza</TableCell><TableCell>Stato</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.id} hover sx={{ cursor: t.status === "OPEN" ? "pointer" : "default" }}
                          onClick={() => t.status === "OPEN" && setParams({ instance: t.instance_id })}>
                  <TableCell><Typography fontFamily="monospace" fontSize={13}>{t.identifier}</Typography>{t.title}</TableCell>
                  <TableCell><b>{t.revision_code}</b> {t.suitability}</TableCell>
                  <TableCell>{t.template_name} · {t.step_name}</TableCell>
                  <TableCell>{t.project_code}</TableCell>
                  <TableCell>
                    {t.due_at ? new Date(t.due_at).toLocaleString("it-IT") : "—"}
                    {t.overdue && <Chip size="small" color="error" label="Scaduto" sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell>{t.status === "DONE" ? OUTCOME_LABEL[t.outcome!] : t.status === "OPEN" ? <Chip size="small" color="warning" label="Da svolgere" /> : "Annullato"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
      {current && <ReviewDialog task={current} onClose={() => setParams({})} />}
    </Stack>
  );
}

function ReviewDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<string>("APPROVED");
  const [comment, setComment] = useState("");
  const download = useMutation({
    mutationFn: () => api<{ url: string }>(`/revisions/${task.revision_id}/download`),
    onSuccess: ({ url }) => { window.location.href = url; },
  });
  const complete = useMutation({
    mutationFn: () => api(`/tasks/${task.id}/complete`, { method: "POST", json: { outcome, comment: comment || null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-tasks"] });
      qc.invalidateQueries({ queryKey: ["workflow"] });
      onClose();
    },
  });
  const needsComment = outcome !== "APPROVED";

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Revisione: {task.identifier} {task.revision_code}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {complete.error && <Alert severity="error">{(complete.error as ApiError).message}</Alert>}
          {download.error && <Alert severity="error">{(download.error as ApiError).message}</Alert>}
          <Typography>{task.title} — idoneità {task.suitability}</Typography>
          <Button variant="outlined" startIcon={<DownloadIcon />} sx={{ alignSelf: "flex-start" }} onClick={() => download.mutate()}>
            Scarica il file da esaminare
          </Button>
          <WorkflowProgress instanceId={task.instance_id} />
          <ToggleButtonGroup exclusive value={outcome} onChange={(_, v) => v && setOutcome(v)} color="primary">
            <ToggleButton value="APPROVED">Approvato</ToggleButton>
            <ToggleButton value="APPROVED_WITH_COMMENTS">Con commenti</ToggleButton>
            <ToggleButton value="REJECTED" color="error">Rifiutato</ToggleButton>
          </ToggleButtonGroup>
          <TextField label={`Commento${needsComment ? " (obbligatorio)" : ""}`} value={comment}
                     onChange={(e) => setComment(e.target.value)} multiline minRows={3} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Chiudi</Button>
        <Button variant="contained" color={outcome === "REJECTED" ? "error" : "primary"}
                disabled={complete.isPending || (needsComment && !comment.trim())} onClick={() => complete.mutate()}>
          Conferma esito
        </Button>
      </DialogActions>
    </Dialog>
  );
}
