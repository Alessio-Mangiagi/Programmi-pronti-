// "><(((º> sabusabu <º)))><"
// Finestra "Nuovo task" / "Modifica task" (ADR-59). Nuovo: titolo, descrizione, una o più persone della commessa,
// priorità, scadenza e sotto-task (uno per riga); dalla discussione arriva già con il testo del messaggio e il
// collegamento. Modifica (solo chi ha assegnato il task): gli stessi campi tranne i sotto-task, che si gestiscono
// nella scheda del task.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField,
} from "@mui/material";
import { api, ApiError, TeamTask, TeamTaskDetail, TeamTaskPriority } from "../../api";
import { useAuth } from "../../auth";
import { PRIORITY, nomeMembro, usePersone } from "./common";

interface Origine { discussionId: string; messageId?: string; testo?: string; titolo?: string }

export function TaskDialog({ projectId, task, origine, onClose, onSaved }: {
  projectId: string;
  /** presente = modifica */
  task?: TeamTaskDetail;
  /** task nato dal messaggio di una discussione */
  origine?: Origine;
  onClose: () => void;
  onSaved?: (t: TeamTaskDetail) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me } = useAuth();
  const persone = usePersone(projectId);
  const [title, setTitle] = useState(task?.title ?? origine?.titolo ?? "");
  const [description, setDescription] = useState(task?.description ?? origine?.testo ?? "");
  const [assegnati, setAssegnati] = useState<string[]>(task ? task.assignees.map((a) => a.user_id) : []);
  const [priority, setPriority] = useState<TeamTaskPriority>(task?.priority ?? "NORMAL");
  const [due, setDue] = useState(task?.due_on ?? "");
  const [voci, setVoci] = useState("");

  const save = useMutation({
    mutationFn: () => {
      const comuni = { title, description, priority, due_on: due || null, assignee_ids: assegnati };
      return task
        ? api<TeamTaskDetail>(`/team-tasks/${task.id}`, { method: "PATCH", json: comuni })
        : api<TeamTaskDetail>(`/projects/${projectId}/team-tasks`, {
            method: "POST",
            json: { ...comuni, items: voci.split("\n").map((v) => v.trim()).filter(Boolean),
                    discussion_id: origine?.discussionId ?? null, message_id: origine?.messageId ?? null },
          });
    },
    onSuccess: (t) => {
      qc.setQueryData(["team-task", t.id], t);
      qc.invalidateQueries({ queryKey: ["team-tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["my-team-tasks"] });
      if (origine) qc.invalidateQueries({ queryKey: ["discussion", origine.discussionId] });
      onSaved?.(t);
      onClose();
      if (!task && !origine) navigate(`/progetti/${projectId}/task/${t.id}`);
    },
  });

  const scelti = persone.filter((p) => assegnati.includes(p.user_id));
  const valid = title.trim().length >= 3 && assegnati.length > 0;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{task ? `Modifica ${task.code}` : "Nuovo task"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {save.error && <Alert severity="error">{(save.error as ApiError).message}</Alert>}
          {origine && !task && (
            <Alert severity="info" variant="outlined">
              Il task resta collegato alla discussione: lo trovi sotto il messaggio. Lo vedono solo chi lo assegna e le persone assegnate.
            </Alert>
          )}
          <TextField label="Titolo" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
                     inputProps={{ maxLength: 200 }} />
          <TextField label="Descrizione" multiline minRows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          <Autocomplete multiple options={persone} value={scelti}
                        onChange={(_, v) => setAssegnati(v.map((p) => p.user_id))}
                        getOptionLabel={(m) => (m.user_id === me?.id ? `${nomeMembro(m)} — io` : nomeMembro(m))}
                        isOptionEqualToValue={(a, b) => a.user_id === b.user_id}
                        renderInput={(p) => <TextField {...p} label="Assegnato a" helperText="Una o più persone della commessa" />} />
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField select label="Priorità" value={priority} onChange={(e) => setPriority(e.target.value as TeamTaskPriority)}
                       sx={{ minWidth: 160 }}>
              {(Object.keys(PRIORITY) as TeamTaskPriority[]).map((p) => <MenuItem key={p} value={p}>{PRIORITY[p].label}</MenuItem>)}
            </TextField>
            <TextField type="date" label="Scadenza" value={due} onChange={(e) => setDue(e.target.value)}
                       InputLabelProps={{ shrink: true }} fullWidth />
          </Stack>
          {!task && (
            <TextField label="Sotto-task (facoltativi, uno per riga)" multiline minRows={2} value={voci}
                       onChange={(e) => setVoci(e.target.value)} placeholder={"Pianta piano terra\nSezione A-A"} />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {task ? "Salva" : "Crea il task"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Spostare una scheda (bacheca, scheda del task, "Sposta in…"): aggiorna subito la cache e poi chiede al server. */
export function useSpostaTask(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: TeamTask["status"] }) =>
      api<TeamTaskDetail>(`/team-tasks/${id}`, { method: "PATCH", json: { status } }),
    onMutate: ({ id, status }) => {
      qc.setQueriesData<TeamTask[]>({ queryKey: ["team-tasks", projectId] },
                                     (old) => old?.map((t) => (t.id === id ? { ...t, status } : t)));
      qc.setQueryData<TeamTaskDetail>(["team-task", id], (old) => old && { ...old, status });
    },
    // il server non ha accettato: bacheca e scheda tornano allo stato vero
    onError: (_e, { id }) => qc.invalidateQueries({ queryKey: ["team-task", id] }),
    onSuccess: (t) => qc.setQueryData(["team-task", t.id], t),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["team-tasks", projectId] });
      qc.invalidateQueries({ queryKey: ["my-team-tasks"] });
    },
  });
}
