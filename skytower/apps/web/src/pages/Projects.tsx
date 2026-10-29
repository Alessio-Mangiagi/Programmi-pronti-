// "><(((º> sabusabu <º)))><"
// Elenco dei progetti e creazione di un progetto nuovo, vuoto o da un progetto esistente usato come template
// (ADR-38): se ne copiano cartelle, naming, schemi per cartelle, ruoli e workflow, a scelta anche organizzazioni e
// persone; mai i documenti.
import { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Card, CardActionArea, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Grid, MenuItem, Stack, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { api, ApiError, Project } from "../api";
import { useAuth } from "../auth";

export function ProjectsPage() {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  const { data: projects, isLoading } = useQuery({ queryKey: ["my-projects"], queryFn: () => api<Project[]>("/me/projects") });

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <div>
          <Typography variant="h4" fontWeight={600}>Progetti</Typography>
          <Typography color="text.secondary">{me?.organization_name}</Typography>
        </div>
        {me?.is_org_admin && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>Nuovo progetto</Button>}
      </Stack>
      {!isLoading && projects?.length === 0 && <Alert severity="info">Non partecipi ancora a nessun progetto.</Alert>}
      <Grid container spacing={2}>
        {projects?.map((p) => (
          <Grid item xs={12} sm={6} md={4} key={p.id}>
            <Card variant="outlined">
              <CardActionArea component={RouterLink} to={`/progetti/${p.id}`}>
                <CardContent>
                  <Typography variant="overline" color="primary">{p.code}</Typography>
                  <Typography variant="h6" component="h2" gutterBottom>{p.name}</Typography>
                  <Typography variant="body2" color="text.secondary" gutterBottom>Committente: {p.owner_name}</Typography>
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                    <Chip size="small" label={p.status} />
                    {p.my_roles?.map((r) => <Chip key={r} size="small" color="primary" variant="outlined" label={r} />)}
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          </Grid>
        ))}
      </Grid>
      <NewProjectDialog open={open} onClose={() => setOpen(false)} />
    </Stack>
  );
}

interface Template { id: string; code: string; name: string; folders: number; naming_profiles: number; workflows: number; organizations: number }

function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [withOrgs, setWithOrgs] = useState(false);
  const [withMembers, setWithMembers] = useState(false);
  const { data: templates = [] } = useQuery({
    queryKey: ["project-templates"], queryFn: () => api<Template[]>("/projects/templates"), enabled: open,
  });
  const template = templates.find((t) => t.id === templateId);
  const create = useMutation({
    mutationFn: () => api<Project>("/projects", { method: "POST", json: {
      code, name, template_id: templateId || null,
      with_organizations: !!templateId && withOrgs, with_members: !!templateId && withOrgs && withMembers } }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ["my-projects"] });
      navigate(`/progetti/${p.id}`);
    },
  });
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nuovo progetto</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {create.error && <Alert severity="error">{(create.error as ApiError).message}</Alert>}
          <TextField label="Codice progetto (ISO 19650)" value={code} helperText="2–6 caratteri A-Z, 0-9"
                     onChange={(e) => setCode(e.target.value.toUpperCase())} inputProps={{ maxLength: 6 }} />
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField select label="Parti da" value={templateId} onChange={(e) => setTemplateId(e.target.value)}
                     helperText={template
                       ? `Si copiano ${template.folders} cartelle, naming, ${template.naming_profiles} schemi per cartelle, ruoli e ${template.workflows} workflow. I documenti no.`
                       : "Puoi usare come template un progetto di cui sei Project Admin"}>
            <MenuItem value="">Progetto vuoto</MenuItem>
            {templates.map((t) => <MenuItem key={t.id} value={t.id}>{t.code} — {t.name}</MenuItem>)}
          </TextField>
          {templateId && (
            <Stack>
              <FormControlLabel control={<Checkbox checked={withOrgs} onChange={(e) => { setWithOrgs(e.target.checked); if (!e.target.checked) setWithMembers(false); }} />}
                                label={`Anche le organizzazioni partecipanti (${template?.organizations ?? 0}) e le loro cartelle`} />
              <FormControlLabel control={<Checkbox checked={withMembers} disabled={!withOrgs} onChange={(e) => setWithMembers(e.target.checked)} />}
                                label="Anche le persone, con i loro ruoli" />
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!/^[A-Z0-9]{2,6}$/.test(code) || name.length < 2 || create.isPending}
                onClick={() => create.mutate()}>Crea</Button>
      </DialogActions>
    </Dialog>
  );
}
