// "><(((º> sabusabu <º)))><"
// Inbox dei compiti di revisione e pagina di esito. Con i workflow a grafo (docs/workflow-grafo.md §3) ogni
// compito porta il nodo e i suoi esiti liberi: i pulsanti dell'esito sono quelli del nodo ("In gara",
// "Respinto"…), non più Approvato/Rifiutato fissi; un compito di un processo non ha documento.
// Tornare indietro (§6, ADR-51): da ogni decisione o attività "Chiedi chiarimento" e "Richiedi modifiche" (dialogo
// con la destinazione e il commento); i compiti di chiarimento si chiudono rispondendo; un compito in attesa di
// chiarimento non si completa; un compito riaperto mostra la richiesta e il caricamento dei file.
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Stack, Tab, Table, TableBody,
  TableCell, TableHead, TableRow, Tabs, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import DrawIcon from "@mui/icons-material/Draw";
import { api, ApiError } from "../api";
import { openDocument } from "../openDocument";
import { WorkflowProgress } from "../components/WorkflowProgress";
import { COLORE_ESITO } from "../components/workflow/GrafoWorkflow";
import { Esito } from "../components/workflow/modello";
import { AvvisiRitorno, CompitoRitorno, DialogoRisposta, DialogoRitorno } from "../components/workflow/Ritorni";

interface Task extends CompitoRitorno {
  id: string;
  status: "OPEN" | "DONE" | "CANCELLED";
  outcome: string | null;
  comment: string | null;
  due_at: string | null;
  created_at: string;
  instance_id: string;
  step_name: string;
  /** Workflow a grafo: nodo del compito ed esiti tra cui scegliere. */
  node_id?: string;
  node_name?: string;
  outcomes?: Esito[];
  subject?: "DOCUMENT" | "PROCESS";
  identifier: string | null;
  title: string;
  document_id: string | null;
  revision_id: string | null;
  revision_code: string | null;
  suitability: string | null;
  template_name: string;
  project_code: string;
  overdue: boolean;
  // Escalation (G35): quando e quante volte i responsabili sono stati sollecitati, giorni di ritardo.
  escalated_at: string | null;
  escalation_count: number;
  days_late: number | null;
  /** Perché il compito è stato annullato (es. "Rimandato indietro a …"). */
  cancel_reason?: string | null;
}

const OUTCOME_LABEL: Record<string, string> = {
  APPROVED: "Approvato", APPROVED_WITH_COMMENTS: "Approvato con commenti", REJECTED: "Rifiutato",
};
/** Esiti dei compiti dei modelli a lista di passi (versione 1), se l'API non manda quelli del nodo. */
const ESITI_V1: Esito[] = [
  { code: "APPROVED", label: "Approvato", color: "green" },
  { code: "APPROVED_WITH_COMMENTS", label: "Con commenti", color: "green" },
  { code: "REJECTED", label: "Rifiutato", color: "red" },
];
const esitiDelCompito = (t: Task) => (t.outcomes?.length ? t.outcomes : ESITI_V1);
const etichettaEsito = (t: Task) => esitiDelCompito(t).find((e) => e.code === t.outcome)?.label ?? OUTCOME_LABEL[t.outcome ?? ""] ?? t.outcome;

export function TasksPage() {
  const [status, setStatus] = useState<"OPEN" | "ALL">("OPEN");
  const [params, setParams] = useSearchParams();
  const { data: tasks = [] } = useQuery({
    queryKey: ["my-tasks", status],
    queryFn: () => api<Task[]>(`/me/tasks?status=${status}`),
  });
  const focusInstance = params.get("instance");
  // ?task= sceglie il compito preciso (stessa istanza: il proprio compito e un chiarimento da dare, o più rami)
  const focusTask = params.get("task");
  const current = (focusTask ? tasks.find((t) => t.id === focusTask && t.status === "OPEN") : undefined)
    ?? tasks.find((t) => t.instance_id === focusInstance && t.status === "OPEN") ?? null;

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
                          onClick={() => t.status === "OPEN" && setParams({ instance: t.instance_id, task: t.id })}>
                  <TableCell>
                    <Typography fontFamily="monospace" fontSize={13}>{t.identifier ?? (t.subject === "PROCESS" ? "Processo" : "")}</Typography>{t.title}
                  </TableCell>
                  <TableCell>{t.revision_code ? <><b>{t.revision_code}</b> {t.suitability}</> : "—"}</TableCell>
                  <TableCell>{t.template_name} · {t.kind === "CLARIFICATION" ? `Chiarimento su «${t.node_name ?? t.step_name}»` : t.node_name ?? t.step_name}</TableCell>
                  <TableCell>{t.project_code}</TableCell>
                  <TableCell>
                    {t.due_at ? new Date(t.due_at).toLocaleString("it-IT") : "—"}
                    {t.overdue && (
                      <Chip size="small" color="error" sx={{ ml: 1 }}
                            label={t.days_late ? `In ritardo di ${t.days_late} ${t.days_late === 1 ? "giorno" : "giorni"}` : "Scaduto"} />
                    )}
                    {t.escalation_count > 0 && t.escalated_at && (
                      <Typography variant="caption" display="block" color="error.main">
                        Responsabili avvisati il {new Date(t.escalated_at).toLocaleString("it-IT")}
                        {t.escalation_count > 1 ? ` (sollecito n. ${t.escalation_count})` : ""}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {t.status === "DONE" ? (t.kind === "CLARIFICATION" ? "Risposto" : etichettaEsito(t))
                      : t.status === "OPEN" ? (
                        t.kind === "CLARIFICATION" ? <Chip size="small" color="info" label="Chiarimento da dare" />
                          : t.waiting_for ? <Chip size="small" variant="outlined" color="info" label="In attesa di chiarimento" />
                          : t.changes_request ? <Chip size="small" color="warning" label="Modifiche richieste" />
                          : <Chip size="small" color="warning" label="Da svolgere" />)
                      : <span title={t.cancel_reason ?? undefined}>{t.cancel_reason ?? "Annullato"}</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
      {current && (current.kind === "CLARIFICATION"
        ? <DialogoRisposta key={current.id} task={current} onClose={() => setParams({})} />
        : <ReviewDialog key={current.id} task={current} onClose={() => setParams({})} />)}
    </Stack>
  );
}

function ReviewDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const qc = useQueryClient();
  const esiti = esitiDelCompito(task);
  // proposto il primo esito non rosso: i rossi (rifiuto, annullamento) si scelgono apposta
  const [outcome, setOutcome] = useState<string>((esiti.find((e) => e.color !== "red") ?? esiti[0]).code);
  const [comment, setComment] = useState("");
  const [ritorno, setRitorno] = useState<"chiarimento" | "modifiche" | null>(null);
  const inAttesa = !!task.waiting_for;
  const download = useMutation({
    mutationFn: () => api<{ url: string }>(`/revisions/${task.revision_id!}/download`),
    onSuccess: ({ url }) => { window.location.href = url; },
  });
  const complete = useMutation({
    mutationFn: () => api(`/tasks/${task.id}/complete`, { method: "POST", json: { outcome, comment: comment || null } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-tasks"] });
      qc.invalidateQueries({ queryKey: ["workflow-instance"] });
      onClose();
    },
  });
  const scelto = esiti.find((e) => e.code === outcome);
  // commento obbligatorio per gli esiti rossi e per "Approvato con commenti" dei modelli vecchi
  const needsComment = scelto?.color === "red" || outcome === "APPROVED_WITH_COMMENTS";

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{task.revision_id ? `Revisione: ${task.identifier} ${task.revision_code}` : `${task.node_name ?? task.step_name}: ${task.title}`}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {complete.error && <Alert severity="error">{(complete.error as ApiError).message}</Alert>}
          {download.error && <Alert severity="error">{(download.error as ApiError).message}</Alert>}
          <Typography>{task.title}{task.suitability ? ` — idoneità ${task.suitability}` : ""}</Typography>
          <AvvisiRitorno task={task} />
          {task.document_id && task.revision_id && <Stack direction="row" gap={1} flexWrap="wrap">
            <Button variant="contained" startIcon={<DrawIcon />} onClick={() => openDocument(task.document_id!, {
              revisionId: task.revision_id!, taskId: task.status === "OPEN" ? task.id : undefined })}>Apri e annota</Button>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => download.mutate()}>
              Scarica il file da esaminare
            </Button>
          </Stack>}
          <WorkflowProgress instanceId={task.instance_id} />
          <ToggleButtonGroup exclusive value={outcome} onChange={(_, v) => v && setOutcome(v)} color="primary" aria-label="Esito"
                             sx={{ flexWrap: "wrap" }} disabled={inAttesa}>
            {esiti.map((e) => (
              <ToggleButton key={e.code} value={e.code} color={e.color === "red" ? "error" : "primary"}>
                <Box component="span" sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: COLORE_ESITO[e.color], mr: 1, display: "inline-block" }} />
                {e.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <TextField label={`Commento${needsComment ? " (obbligatorio)" : ""}`} value={comment} disabled={inAttesa}
                     onChange={(e) => setComment(e.target.value)} multiline minRows={3} />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: "wrap", gap: 1 }}>
        {/* tornare indietro: da ogni decisione o attività, non mentre si aspetta un chiarimento */}
        {task.can_send_back && (
          <Stack direction="row" spacing={1} flexGrow={1}>
            <Button variant="outlined" disabled={inAttesa} onClick={() => setRitorno("chiarimento")}>Chiedi chiarimento</Button>
            <Button variant="outlined" color="warning" disabled={inAttesa} onClick={() => setRitorno("modifiche")}>Richiedi modifiche</Button>
          </Stack>
        )}
        <Button onClick={onClose}>Chiudi</Button>
        <Button variant="contained" color={scelto?.color === "red" ? "error" : "primary"}
                disabled={inAttesa || complete.isPending || (needsComment && !comment.trim())} onClick={() => complete.mutate()}>
          Conferma esito
        </Button>
      </DialogActions>
      {ritorno && <DialogoRitorno task={task} tipo={ritorno} onClose={() => setRitorno(null)}
                                  onDone={ritorno === "modifiche" ? onClose : undefined} />}
    </Dialog>
  );
}
