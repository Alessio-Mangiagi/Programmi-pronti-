// "><(((º> sabusabu <º)))><"
// UI matrice permessi (ruolo × azione × scope) e ruoli personalizzati di progetto.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Select, Stack, Table,
  TableBody, TableCell, TableHead, TableRow, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { Action, api, ApiError, Matrix, Project, Scope } from "../../api";

const SYMBOL: Record<Scope, string> = { PROJECT: "◆", OWN_ORGANIZATION: "●" };
const SCOPE_LABEL: Record<Scope, string> = { PROJECT: "Intero progetto", OWN_ORGANIZATION: "Propria organizzazione" };

export function RolesTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const [editing, setEditing] = useState<Matrix["roles"][number] | "new" | null>(null);
  const { data: matrix } = useQuery({
    queryKey: ["matrix", project.id],
    queryFn: () => api<Matrix>(`/projects/${project.id}/permission-matrix`),
  });
  if (!matrix) return null;

  return (
    <Paper variant="outlined" sx={{ p: 2, overflowX: "auto" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle1" fontWeight={600}>Matrice dei permessi</Typography>
        {canManage && <Button startIcon={<AddIcon />} onClick={() => setEditing("new")}>Ruolo di progetto</Button>}
      </Stack>
      <Typography variant="body2" color="text.secondary" mb={2}>
        ◆ intero progetto · ● perimetro della propria organizzazione · le condivisioni esplicite estendono la visibilità ma non le azioni. ADMIN implica tutte le azioni nello stesso ambito.
      </Typography>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Ruolo</TableCell>
            {matrix.actions.map((a) => <TableCell key={a} align="center">{a}</TableCell>)}
          </TableRow>
        </TableHead>
        <TableBody>
          {matrix.roles.map((r) => (
            <TableRow key={r.role_id} hover sx={{ cursor: canManage && !r.is_system ? "pointer" : "default" }}
                      onClick={() => canManage && !r.is_system && setEditing(r)}>
              <TableCell>
                <Typography variant="body2" fontWeight={600}>{r.name}</Typography>
                <Typography variant="caption" color="text.secondary">{r.code}{r.is_system ? " · sistema" : " · progetto"}</Typography>
              </TableCell>
              {matrix.actions.map((a) => (
                <TableCell key={a} align="center">
                  {r.cells[a] ? <Tooltip title={SCOPE_LABEL[r.cells[a]!]}><Box component="span" color="primary.main" fontSize={18}>{SYMBOL[r.cells[a]!]}</Box></Tooltip> : "—"}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {editing && <RoleDialog project={project} actions={matrix.actions} role={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Paper>
  );
}

function RoleDialog({ project, actions, role, onClose }: {
  project: Project; actions: Action[]; role: Matrix["roles"][number] | null; onClose: () => void;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState(role?.code ?? "");
  const [name, setName] = useState(role?.name ?? "");
  const [cells, setCells] = useState<Record<string, Scope | "">>(
    Object.fromEntries(actions.map((a) => [a, role?.cells[a] ?? ""])),
  );
  const save = useMutation({
    mutationFn: () => {
      const permissions = Object.entries(cells).filter(([, s]) => s).map(([action, scope]) => ({ action, scope }));
      return role
        ? api(`/projects/${project.id}/roles/${role.role_id}`, { method: "PATCH", json: { name, permissions } })
        : api(`/projects/${project.id}/roles`, { method: "POST", json: { code, name, permissions } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["matrix", project.id] });
      qc.invalidateQueries({ queryKey: ["roles", project.id] });
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{role ? `Modifica ${role.code}` : "Nuovo ruolo di progetto"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {save.error && <Alert severity="error">{(save.error as ApiError).message}</Alert>}
          {!role && <TextField label="Codice" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                               helperText="Es. BIM_COORDINATOR" />}
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          {actions.map((a) => (
            <Stack key={a} direction="row" alignItems="center" spacing={2}>
              <Typography width={110} fontWeight={600}>{a}</Typography>
              <Select size="small" fullWidth value={cells[a]} displayEmpty onChange={(e) => setCells({ ...cells, [a]: e.target.value as Scope | "" })}>
                <MenuItem value="">Nessuno</MenuItem>
                <MenuItem value="OWN_ORGANIZATION">● Propria organizzazione</MenuItem>
                <MenuItem value="PROJECT">◆ Intero progetto</MenuItem>
              </Select>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={name.length < 2 || (!role && !/^[A-Z][A-Z0-9_]{1,40}$/.test(code)) || save.isPending}
                onClick={() => save.mutate()}>Salva</Button>
      </DialogActions>
    </Dialog>
  );
}
