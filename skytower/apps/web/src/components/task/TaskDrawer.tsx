// "><(((º> sabusabu <º)))><"
// Scheda di un task (ADR-59), aperta a destra sopra la bacheca: stato (si cambia anche da qui), persone, priorità,
// scadenza, descrizione, discussione di origine, sotto-task da spuntare con la barra di avanzamento, commenti e
// storia. Chi ha assegnato il task lo modifica e lo elimina; le persone assegnate cambiano stato, spuntano e
// aggiungono sotto-task e commentano. Aprendola, gli avvisi di quel task diventano letti.
import { ReactNode, useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider,
  Drawer, IconButton, LinearProgress, Link, List, ListItem, ListItemIcon, ListItemText, Stack, TextField,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import EditIcon from "@mui/icons-material/Edit";
import ForumIcon from "@mui/icons-material/Forum";
import { api, ApiError, TeamTaskDetail, TeamTaskStatus } from "../../api";
import { STATUS, STATUS_ORDER, frase, giorno, quando } from "./common";
import { TaskDialog, useSpostaTask } from "./TaskDialog";
import { PriorityChip } from "./PriorityChip";

export function TaskDrawer({ projectId, taskId, onClose }: { projectId: string; taskId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [voce, setVoce] = useState("");
  const [commento, setCommento] = useState("");
  const { data: task, error } = useQuery({
    queryKey: ["team-task", taskId],
    queryFn: () => api<TeamTaskDetail>(`/team-tasks/${taskId}`),
    refetchInterval: 30_000,
  });
  const sposta = useSpostaTask(projectId);

  // aperta = letta: gli avvisi del task (assegnazione, commenti…) spariscono dalla campanella
  useEffect(() => {
    api(`/team-tasks/${taskId}/read`, { method: "POST" })
      .then(() => qc.invalidateQueries({ queryKey: ["notifications"] }))
      .catch(() => undefined);
  }, [taskId, task?.comment_count, qc]);

  const aggiorna = (t: TeamTaskDetail) => {
    qc.setQueryData(["team-task", taskId], t);
    qc.invalidateQueries({ queryKey: ["team-tasks", projectId] });
    qc.invalidateQueries({ queryKey: ["my-team-tasks"] });
  };
  const azione = useMutation({
    mutationFn: ({ path, method, json }: { path: string; method: string; json?: unknown }) =>
      api<TeamTaskDetail>(`/team-tasks/${taskId}${path}`, { method, json }),
    onSuccess: aggiorna,
  });
  // Spunte in attesa del server: la casella cambia subito (stato di React, ridisegnato nello stesso clic; la cache di
  // React Query avvisa i componenti un attimo dopo) e torna allo stato del server appena risponde, sì o no.
  const [spunte, setSpunte] = useState<Record<string, boolean>>({});
  const spunta = (itemId: string, done: boolean) => {
    setSpunte((s) => ({ ...s, [itemId]: done }));
    azione.mutate({ path: `/items/${itemId}`, method: "PATCH", json: { done } },
                  { onSettled: () => setSpunte(({ [itemId]: _, ...resto }) => resto) });
  };
  const fatto = (i: TeamTaskDetail["items"][number]) => spunte[i.id] ?? !!i.done_at;
  const elimina = useMutation({
    mutationFn: () => api(`/team-tasks/${taskId}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team-tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["my-team-tasks"] });
      onClose();
    },
  });

  const errore = (error ?? azione.error ?? sposta.error ?? elimina.error) as ApiError | null;
  const fatti = task ? task.items.filter(fatto).length : 0;
  const percent = task && task.items_total ? Math.round((fatti / task.items_total) * 100) : 0;

  return (
    <Drawer anchor="right" open onClose={onClose}
            PaperProps={{ sx: { width: { xs: "100%", sm: 560 } }, role: "dialog", "aria-label": task ? `Task ${task.code}` : "Task" }}>
      <Stack direction="row" alignItems="center" spacing={1} px={2.5} py={1.5} borderBottom={1} borderColor="divider">
        <Typography fontFamily="monospace" color="text.secondary" flexGrow={1}>{task?.code ?? ""}</Typography>
        {task?.i_am_creator && (
          <>
            <Tooltip title="Modifica"><IconButton aria-label="Modifica il task" onClick={() => setEditing(true)}><EditIcon /></IconButton></Tooltip>
            <Tooltip title="Elimina"><IconButton aria-label="Elimina il task" onClick={() => setDeleting(true)}><DeleteOutlineIcon /></IconButton></Tooltip>
          </>
        )}
        <IconButton aria-label="Chiudi la scheda del task" onClick={onClose}><CloseIcon /></IconButton>
      </Stack>
      <Box px={2.5} py={2} overflow="auto" flexGrow={1}>
        {errore && <Alert severity="error" sx={{ mb: 2 }}>{errore.status === 404 ? "Task non trovato" : errore.message}</Alert>}
        {!task ? (error ? null : <LinearProgress />) : (
          <Stack spacing={2.5}>
            <Typography variant="h5" fontWeight={600}>{task.title}</Typography>
            <ToggleButtonGroup size="small" exclusive value={task.status} aria-label="Stato del task" fullWidth
                               onChange={(_, v: TeamTaskStatus | null) => v && v !== task.status && sposta.mutate({ id: task.id, status: v })}>
              {STATUS_ORDER.map((s) => <ToggleButton key={s} value={s}>{STATUS[s].label}</ToggleButton>)}
            </ToggleButtonGroup>

            <Stack spacing={1}>
              <Riga label="Assegnato a">
                <Stack direction="row" gap={0.5} flexWrap="wrap">
                  {task.assignees.map((a) => <Chip key={a.user_id} size="small" label={`${a.name}${a.organization_code ? ` · ${a.organization_code}` : ""}`} />)}
                </Stack>
              </Riga>
              <Riga label="Assegnato da"><Typography variant="body2">{task.created_by_name} · {quando(task.created_at)}</Typography></Riga>
              <Riga label="Priorità"><PriorityChip priority={task.priority} /></Riga>
              <Riga label="Scadenza">
                <Typography variant="body2" color={task.overdue ? "error.main" : undefined} fontWeight={task.overdue ? 600 : undefined}>
                  {task.due_on ? `${giorno(task.due_on)}${task.overdue ? " · in ritardo" : ""}` : "—"}
                </Typography>
              </Riga>
              {task.completed_at && <Riga label="Completato"><Typography variant="body2">{quando(task.completed_at)}</Typography></Riga>}
              {task.discussion && (
                <Riga label="Discussione">
                  <Link component={RouterLink} to={`/progetti/${projectId}/discussioni/${task.discussion.id}`} variant="body2"
                        sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}>
                    <ForumIcon fontSize="inherit" />{task.discussion.title}
                  </Link>
                </Riga>
              )}
            </Stack>

            {task.description && <Typography whiteSpace="pre-wrap" variant="body2">{task.description}</Typography>}

            <Divider />
            <Stack spacing={1}>
              <Stack direction="row" alignItems="baseline" spacing={1}>
                <Typography variant="h6" fontSize="1rem" fontWeight={600} flexGrow={1}>Sotto-task</Typography>
                {task.items_total > 0 && <Typography variant="body2" color="text.secondary">{fatti} di {task.items_total}</Typography>}
              </Stack>
              {task.items_total > 0 && (
                <LinearProgress variant="determinate" value={percent} aria-label={`Avanzamento ${percent}%`}
                                color={percent === 100 ? "success" : "primary"} sx={{ height: 6, borderRadius: 3 }} />
              )}
              <List dense disablePadding>
                {task.items.map((i) => (
                  <ListItem key={i.id} disableGutters
                            secondaryAction={(task.i_am_creator || i.mine) && (
                              <IconButton edge="end" size="small" aria-label={`Togli il sotto-task ${i.title}`}
                                          onClick={() => azione.mutate({ path: `/items/${i.id}`, method: "DELETE" })}>
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            )}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <Checkbox edge="start" checked={fatto(i)} inputProps={{ "aria-label": i.title }}
                                onChange={(e) => spunta(i.id, e.target.checked)} />
                    </ListItemIcon>
                    <ListItemText primary={i.title}
                                  secondary={i.done_at ? `fatto da ${i.done_by_name ?? "—"} · ${quando(i.done_at)}` : undefined}
                                  primaryTypographyProps={{ sx: fatto(i) ? { textDecoration: "line-through", color: "text.secondary" } : undefined }} />
                  </ListItem>
                ))}
              </List>
              <Stack direction="row" spacing={1}
                     component="form" onSubmit={(e) => {
                       e.preventDefault();
                       if (voce.trim()) azione.mutate({ path: "/items", method: "POST", json: { title: voce.trim() } }, { onSuccess: () => setVoce("") });
                     }}>
                <TextField size="small" fullWidth label="Nuovo sotto-task" value={voce} onChange={(e) => setVoce(e.target.value)} />
                <Button type="submit" variant="outlined" disabled={!voce.trim() || azione.isPending}>Aggiungi</Button>
              </Stack>
            </Stack>

            <Divider />
            <Stack spacing={1.5}>
              <Typography variant="h6" fontSize="1rem" fontWeight={600}>Commenti</Typography>
              {task.comments.length === 0 && <Typography variant="body2" color="text.secondary">Ancora nessun commento.</Typography>}
              {task.comments.map((k) => (
                <Box key={k.id} sx={{ borderLeft: 3, borderColor: "divider", pl: 1.5 }}>
                  <Typography variant="body2"><b>{k.author_name}</b>{k.author_org_code && ` · ${k.author_org_code}`}
                    <Typography component="span" variant="caption" color="text.secondary"> · {quando(k.created_at)}</Typography></Typography>
                  <Typography variant="body2" whiteSpace="pre-wrap">{k.body}</Typography>
                </Box>
              ))}
              <TextField label="Scrivi un commento" multiline minRows={2} value={commento} onChange={(e) => setCommento(e.target.value)} />
              <Box textAlign="right">
                <Button variant="contained" disabled={!commento.trim() || azione.isPending}
                        onClick={() => azione.mutate({ path: "/comments", method: "POST", json: { body: commento } }, { onSuccess: () => setCommento("") })}>
                  Commenta
                </Button>
              </Box>
            </Stack>

            <Divider />
            <Stack spacing={0.75}>
              <Typography variant="h6" fontSize="1rem" fontWeight={600}>Storia</Typography>
              {task.events.map((e) => (
                <Typography key={e.id} variant="body2" color="text.secondary">
                  {quando(e.created_at)} · <b>{e.actor_name ?? "Sistema"}</b> {frase(e.kind, e.data)}
                </Typography>
              ))}
            </Stack>
          </Stack>
        )}
      </Box>
      {editing && task && <TaskDialog projectId={projectId} task={task} onClose={() => setEditing(false)} onSaved={aggiorna} />}
      <Dialog open={deleting} onClose={() => setDeleting(false)}>
        <DialogTitle>Eliminare {task?.code}?</DialogTitle>
        <DialogContent>
          <DialogContentText>Il task sparisce dalla bacheca di tutti. Il registro attività conserva che l'hai eliminato.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(false)}>Annulla</Button>
          <Button color="error" variant="contained" disabled={elimina.isPending} onClick={() => elimina.mutate()}>Elimina</Button>
        </DialogActions>
      </Dialog>
    </Drawer>
  );
}

function Riga({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction="row" spacing={2} alignItems="center">
      <Typography variant="body2" color="text.secondary" width={110} flexShrink={0}>{label}</Typography>
      <Box flexGrow={1}>{children}</Box>
    </Stack>
  );
}
