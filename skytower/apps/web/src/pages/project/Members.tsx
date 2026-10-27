// "><(((º> sabusabu <º)))><"
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Paper, Stack, Table,
  TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import DeleteIcon from "@mui/icons-material/Delete";
import { api, ApiError, Member, Project, Role } from "../../api";

interface Candidate { id: string; email: string; first_name: string; last_name: string; organization_code: string }

export function MembersTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: members = [] } = useQuery({
    queryKey: ["members", project.id],
    queryFn: () => api<Member[]>(`/projects/${project.id}/members`),
  });
  const remove = useMutation({
    mutationFn: (m: Member) => api(`/projects/${project.id}/members/${m.user_id}/${m.role_id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["members", project.id] }),
  });

  return (
    <Paper variant="outlined" sx={{ p: 2, overflowX: "auto" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle1" fontWeight={600}>Membri del progetto ({members.length})</Typography>
        {canManage && <Button startIcon={<PersonAddIcon />} onClick={() => setAdding(true)}>Aggiungi</Button>}
      </Stack>
      {remove.error && <Alert severity="error" sx={{ mb: 1 }}>{(remove.error as ApiError).message}</Alert>}
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Nome</TableCell><TableCell>Email</TableCell><TableCell>Organizzazione</TableCell>
            <TableCell>Ruolo</TableCell><TableCell>Scadenza</TableCell>{canManage && <TableCell />}
          </TableRow>
        </TableHead>
        <TableBody>
          {members.map((m) => (
            <TableRow key={`${m.user_id}-${m.role_id}`} hover>
              <TableCell>{m.first_name} {m.last_name}</TableCell>
              <TableCell>{m.email}</TableCell>
              <TableCell>{m.organization_code}</TableCell>
              <TableCell>{m.role_name}</TableCell>
              <TableCell>{m.expires_at ? new Date(m.expires_at).toLocaleDateString("it-IT") : "—"}</TableCell>
              {canManage && (
                <TableCell padding="checkbox">
                  <IconButton size="small" aria-label="rimuovi" onClick={() => remove.mutate(m)}><DeleteIcon fontSize="small" /></IconButton>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {adding && <AddMemberDialog project={project} onClose={() => setAdding(false)} />}
    </Paper>
  );
}

function AddMemberDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState("");
  const [expires, setExpires] = useState("");
  const { data: candidates = [] } = useQuery({
    queryKey: ["candidates", project.id],
    queryFn: () => api<Candidate[]>(`/projects/${project.id}/candidates`),
  });
  const { data: roles = [] } = useQuery({ queryKey: ["roles", project.id], queryFn: () => api<Role[]>(`/projects/${project.id}/roles`) });
  const add = useMutation({
    mutationFn: () => api(`/projects/${project.id}/members`, {
      method: "POST", json: { user_id: userId, role_id: roleId, expires_at: expires ? new Date(expires).toISOString() : null },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["members", project.id] }); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Aggiungi membro</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {add.error && <Alert severity="error">{(add.error as ApiError).message}</Alert>}
          <TextField select label="Utente" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {candidates.map((c) => <MenuItem key={c.id} value={c.id}>{c.first_name} {c.last_name} · {c.organization_code} · {c.email}</MenuItem>)}
          </TextField>
          <TextField select label="Ruolo" value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {roles.map((r) => <MenuItem key={r.id} value={r.id}>{r.name}{r.is_system ? "" : " (progetto)"}</MenuItem>)}
          </TextField>
          <TextField label="Scadenza (opzionale)" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} InputLabelProps={{ shrink: true }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!userId || !roleId || add.isPending} onClick={() => add.mutate()}>Aggiungi</Button>
      </DialogActions>
    </Dialog>
  );
}
