// "><(((º> sabusabu <º)))><"
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, Table, TableBody,
  TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import AddBusinessIcon from "@mui/icons-material/AddBusiness";
import { api, ApiError, Project, ProjectOrganization } from "../../api";

export const PARTY_ROLES: Record<string, string> = {
  APPOINTING_PARTY: "Committente",
  LEAD_APPOINTED_PARTY: "Capofila",
  APPOINTED_PARTY: "Incaricato",
  SUBCONTRACTOR: "Subappaltatore",
  CONSULTANT: "Consulente",
  OBSERVER: "Osservatore",
};

export function OrganizationsTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data: orgs = [] } = useQuery({
    queryKey: ["project-orgs", project.id],
    queryFn: () => api<ProjectOrganization[]>(`/projects/${project.id}/organizations`),
  });
  const toggle = useMutation({
    mutationFn: (o: ProjectOrganization) => api(`/projects/${project.id}/organizations/${o.organization_id}`, {
      method: "PATCH", json: { is_active: !o.is_active },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project-orgs", project.id] }),
  });

  return (
    <Paper variant="outlined" sx={{ p: 2, overflowX: "auto" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
        <Typography variant="subtitle1" fontWeight={600}>Organizzazioni partecipanti</Typography>
        {canManage && <Button startIcon={<AddBusinessIcon />} onClick={() => setAdding(true)}>Invita</Button>}
      </Stack>
      <Table size="small">
        <TableHead>
          <TableRow><TableCell>Codice</TableCell><TableCell>Ragione sociale</TableCell><TableCell>Ruolo ISO 19650</TableCell><TableCell>Stato</TableCell></TableRow>
        </TableHead>
        <TableBody>
          {orgs.map((o) => (
            <TableRow key={o.organization_id}>
              <TableCell><b>{o.code}</b></TableCell>
              <TableCell>{o.legal_name}</TableCell>
              <TableCell>{PARTY_ROLES[o.party_role] ?? o.party_role}</TableCell>
              <TableCell>
                <Chip size="small" color={o.is_active ? "success" : "default"} label={o.is_active ? "Attiva" : "Sospesa"}
                      onClick={canManage && !o.is_owner ? () => toggle.mutate(o) : undefined} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {adding && <InviteOrgDialog project={project} onClose={() => setAdding(false)} />}
    </Paper>
  );
}

function InviteOrgDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const [role, setRole] = useState("APPOINTED_PARTY");
  const [found, setFound] = useState<{ id: string; legal_name: string } | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const invite = useMutation({
    mutationFn: () => api(`/projects/${project.id}/organizations`, { method: "POST", json: { organization_id: found!.id, party_role: role } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["project-orgs", project.id] }); onClose(); },
  });
  const lookup = async () => {
    setLookupError(null);
    setFound(null);
    try {
      setFound(await api(`/organizations/lookup/${encodeURIComponent(code)}`));
    } catch {
      setLookupError("Nessuna organizzazione attiva con questo codice");
    }
  };
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Invita organizzazione</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {invite.error && <Alert severity="error">{(invite.error as ApiError).message}</Alert>}
          <Stack direction="row" spacing={1}>
            <TextField label="Codice originatore" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} fullWidth />
            <Button onClick={lookup} disabled={code.length < 3}>Cerca</Button>
          </Stack>
          {lookupError && <Alert severity="warning">{lookupError}</Alert>}
          {found && <Alert severity="success">{found.legal_name}</Alert>}
          <TextField select label="Ruolo nel progetto" value={role} onChange={(e) => setRole(e.target.value)}>
            {Object.entries(PARTY_ROLES).filter(([k]) => k !== "APPOINTING_PARTY")
              .map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!found || invite.isPending} onClick={() => invite.mutate()}>Invita</Button>
      </DialogActions>
    </Dialog>
  );
}
