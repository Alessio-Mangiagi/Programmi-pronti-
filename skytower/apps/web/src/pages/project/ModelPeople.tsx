// "><(((º> sabusabu <º)))><"
// Scheda Membri di un MODELLO di commessa (ADR-52): le persone salvate nel modello con il loro ruolo. Non sono
// membri del modello (non lo vedono, non ricevono nulla): diventano membri solo delle commesse create dal modello
// con "anche le persone". Chi amministra il modello sono gli amministratori dell'organizzazione, sempre.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Paper, Stack, Table,
  TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import DeleteIcon from "@mui/icons-material/Delete";
import { api, ApiError, Project, Role } from "../../api";

interface ModelPerson {
  user_id: string; role_id: string; role_code: string; role_name: string; email: string | null; first_name: string | null;
  last_name: string | null; status: string | null; organization_code: string | null; organization_name: string | null;
}
interface Candidate { id: string; email: string; first_name: string; last_name: string; organization_code: string }

export function ModelPeopleTab({ project }: { project: Project }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: people = [] } = useQuery({
    queryKey: ["model-people", project.id],
    queryFn: () => api<ModelPerson[]>(`/project-models/${project.id}/people`),
  });
  const remove = useMutation({
    mutationFn: (p: ModelPerson) => api(`/project-models/${project.id}/people/${p.user_id}/${p.role_id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["model-people", project.id] }),
  });

  return (
    <Paper variant="outlined" sx={{ p: 2, overflowX: "auto" }} component="section" aria-label="Persone del modello">
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle1" fontWeight={600}>Persone del modello ({people.length})</Typography>
        <Button startIcon={<PersonAddIcon />} onClick={() => setAdding(true)}>Aggiungi</Button>
      </Stack>
      <Alert severity="info" sx={{ mb: 1.5 }}>
        Queste persone non vedono il modello: entrano, con il ruolo indicato, nelle commesse create dal modello con
        «anche le persone». Il modello lo gestiscono gli amministratori dell'organizzazione.
      </Alert>
      {remove.error && <Alert severity="error" sx={{ mb: 1 }}>{(remove.error as ApiError).message}</Alert>}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Nome</TableCell><TableCell>Email</TableCell><TableCell>Organizzazione</TableCell>
            <TableCell>Ruolo</TableCell><TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {people.map((p) => (
            <TableRow key={`${p.user_id}-${p.role_id}`} hover>
              <TableCell>{p.first_name} {p.last_name}{p.status && p.status !== "ACTIVE" ? " (non attivo)" : ""}</TableCell>
              <TableCell>{p.email}</TableCell>
              <TableCell>{p.organization_code}</TableCell>
              <TableCell>{p.role_name}</TableCell>
              <TableCell padding="checkbox">
                <IconButton size="small" aria-label={`Togli ${p.first_name} ${p.last_name} dal modello`} onClick={() => remove.mutate(p)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </TableCell>
            </TableRow>
          ))}
          {people.length === 0 && <TableRow><TableCell colSpan={5}>Nessuna persona salvata nel modello.</TableCell></TableRow>}
        </TableBody>
      </Table>
      {adding && <AddPersonDialog project={project} onClose={() => setAdding(false)} />}
    </Paper>
  );
}

function AddPersonDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  // candidati: persone delle organizzazioni del modello (scheda Organizzazioni)
  const { data: candidates = [] } = useQuery({
    queryKey: ["candidates", project.id], queryFn: () => api<Candidate[]>(`/projects/${project.id}/candidates`),
  });
  const { data: roles = [] } = useQuery({ queryKey: ["roles", project.id], queryFn: () => api<Role[]>(`/projects/${project.id}/roles`) });
  const add = useMutation({
    mutationFn: () => api(`/project-models/${project.id}/people`, { method: "POST", json: { user_id: userId, role_id: roleId } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["model-people", project.id] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Aggiungi una persona al modello</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {add.error && <Alert severity="error">{(add.error as ApiError).message}</Alert>}
          <TextField select label="Persona" value={userId} onChange={(e) => setUserId(e.target.value)}
                     helperText="Persone delle organizzazioni del modello">
            {candidates.map((c) => <MenuItem key={c.id} value={c.id}>{c.first_name} {c.last_name} · {c.organization_code} · {c.email}</MenuItem>)}
          </TextField>
          <TextField select label="Ruolo" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => <MenuItem key={r.id} value={r.id}>{r.name}{r.is_system ? "" : " (del modello)"}</MenuItem>)}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!userId || !roleId || add.isPending} onClick={() => add.mutate()}>Aggiungi</Button>
      </DialogActions>
    </Dialog>
  );
}
