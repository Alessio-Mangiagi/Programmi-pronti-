// "><(((º> sabusabu <º)))><"
// Template di workflow della commessa: elenco versioni e designer (step, assegnatari, quorum, SLA,
// esito automatico). Salvare con lo stesso codice crea una nuova versione e disattiva la precedente.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Autocomplete, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton,
  MenuItem, Paper, Stack, Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import { api, ApiError, Member, Project, Role } from "../../api";

type AssigneeType = "role" | "originator_role" | "user";
interface Assignee { type: AssigneeType; code?: string; id?: string }
interface StepDef { name: string; assignees: Assignee[]; quorum: "ALL" | "ANY" | { n: number }; sla_hours?: number | null }
interface Definition {
  steps: StepDef[];
  on_approved?: { to_state: "SHARED" | "PUBLISHED"; suitability: string } | null;
  escalation_user_id?: string | null;
}
interface Template { id: string; code: string; version: number; name: string; definition: Definition; is_active: boolean; created_at: string }

const ASSIGNEE_LABEL: Record<AssigneeType, string> = {
  role: "Ruolo nella commessa", originator_role: "Ruolo nell'organizzazione autrice", user: "Persona",
};
const SUITABILITY: Record<"SHARED" | "PUBLISHED", string[]> = {
  SHARED: ["S1", "S2", "S3", "S4"],
  PUBLISHED: ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "B1", "B2", "B3", "CR"],
};

export function WorkflowsTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  const [showOld, setShowOld] = useState(false);
  const { data: templates = [] } = useQuery({
    queryKey: ["workflow-templates", project.id, "all"],
    queryFn: () => api<Template[]>(`/projects/${project.id}/workflow-templates?include_inactive=true`),
  });
  const toggle = useMutation({
    mutationFn: (t: Template) => api(`/workflow-templates/${t.id}`, { method: "PATCH", json: { is_active: !t.is_active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflow-templates", project.id] }),
  });
  const shown = templates.filter((t) => showOld || t.is_active)
    .sort((a, b) => a.code.localeCompare(b.code) || b.version - a.version);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <Typography variant="body2" color="text.secondary" flexGrow={1}>
          I workflow definiscono chi approva un documento e in che ordine. Si avviano dalla cartella con
          "Avvia approvazione"; durante la revisione il documento è bloccato.
        </Typography>
        <Stack direction="row" alignItems="center">
          <Switch checked={showOld} onChange={(e) => setShowOld(e.target.checked)} inputProps={{ "aria-label": "Mostra versioni disattivate" }} />
          <Typography variant="body2">Versioni disattivate</Typography>
        </Stack>
        {canManage && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing("new")}>Nuovo workflow</Button>}
      </Stack>
      {shown.length === 0 && <Alert severity="info">Nessun workflow configurato.{canManage ? "" : " Li crea il Project Admin."}</Alert>}
      {shown.map((t) => (
        <Paper key={t.id} variant="outlined" sx={{ p: 2, opacity: t.is_active ? 1 : 0.6 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Typography fontWeight={600}>{t.name}</Typography>
            <Chip size="small" variant="outlined" label={`${t.code} · v${t.version}`} sx={{ fontFamily: "monospace" }} />
            {!t.is_active && <Chip size="small" label="Disattivato" />}
            {t.definition.on_approved && (
              <Chip size="small" color="success" variant="outlined"
                    label={`Se approvato → ${t.definition.on_approved.to_state === "SHARED" ? "Condiviso" : "Pubblicato"} ${t.definition.on_approved.suitability}`} />
            )}
            <Box flexGrow={1} />
            {canManage && (
              <>
                <Tooltip title="Nuova versione"><IconButton onClick={() => setEditing(t)}><EditIcon /></IconButton></Tooltip>
                <Button size="small" onClick={() => toggle.mutate(t)}>{t.is_active ? "Disattiva" : "Riattiva"}</Button>
              </>
            )}
          </Stack>
          <Stack direction={{ xs: "column", md: "row" }} spacing={1} mt={1.5} alignItems={{ md: "stretch" }}>
            {t.definition.steps.map((s, i) => (
              <Stack key={i} direction="row" alignItems="center" spacing={1} flex={1} minWidth={0}>
                <Box flex={1} p={1.25} border={1} borderColor="divider" borderRadius={2} minWidth={0}>
                  <Typography variant="caption" color="text.secondary">Step {i + 1}{s.sla_hours ? ` · ${s.sla_hours} h` : ""}</Typography>
                  <Typography variant="body2" fontWeight={600}>{s.name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {s.assignees.map((a) => a.type === "user" ? "persona" : a.code).join(", ")} · {quorumLabel(s.quorum)}
                  </Typography>
                </Box>
                {i < t.definition.steps.length - 1 && <Typography color="text.secondary" sx={{ display: { xs: "none", md: "block" } }}>→</Typography>}
              </Stack>
            ))}
          </Stack>
        </Paper>
      ))}
      {editing && <TemplateDialog project={project} base={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}

function quorumLabel(q: StepDef["quorum"]) {
  return q === "ALL" ? "tutti" : q === "ANY" ? "uno qualsiasi" : `almeno ${q.n}`;
}

const emptyStep = (): StepDef => ({ name: "", assignees: [{ type: "role", code: "" }], quorum: "ALL", sla_hours: 72 });

function TemplateDialog({ project, base, onClose }: { project: Project; base: Template | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [code, setCode] = useState(base?.code ?? "");
  const [name, setName] = useState(base?.name ?? "");
  const [steps, setSteps] = useState<StepDef[]>(base?.definition.steps ?? [emptyStep()]);
  const [onApproved, setOnApproved] = useState(base?.definition.on_approved ?? null);
  const [escalation, setEscalation] = useState<string | null>(base?.definition.escalation_user_id ?? null);
  const { data: roles = [] } = useQuery({ queryKey: ["roles", project.id], queryFn: () => api<Role[]>(`/projects/${project.id}/roles`) });
  const { data: members = [] } = useQuery({ queryKey: ["members", project.id], queryFn: () => api<Member[]>(`/projects/${project.id}/members`) });
  const people = [...new Map(members.map((m) => [m.user_id, m])).values()];

  const save = useMutation({
    mutationFn: () => api(`/projects/${project.id}/workflow-templates`, {
      method: "POST",
      json: {
        code, name,
        definition: {
          steps: steps.map((s) => ({ ...s, sla_hours: s.sla_hours || null })),
          on_approved: onApproved, escalation_user_id: escalation,
        },
      },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["workflow-templates", project.id] }); onClose(); },
  });

  const setStep = (i: number, patch: Partial<StepDef>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setAssignee = (i: number, k: number, a: Assignee) =>
    setStep(i, { assignees: steps[i].assignees.map((x, j) => (j === k ? a : x)) });
  const move = (i: number, d: -1 | 1) => {
    const next = [...steps];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setSteps(next);
  };
  const valid = /^[A-Z][A-Z0-9_]{1,40}$/.test(code) && name.trim().length >= 2 && steps.length > 0
    && steps.every((s) => s.name.trim().length >= 2 && s.assignees.length > 0
      && s.assignees.every((a) => (a.type === "user" ? !!a.id : !!a.code)));

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{base ? `Nuova versione di ${base.code}` : "Nuovo workflow"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {save.error && <Alert severity="error">{(save.error as ApiError).message}</Alert>}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Codice" value={code} disabled={!!base} sx={{ minWidth: 200 }}
                       onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                       helperText="Es. REVISIONE_PROGETTO" />
            <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} fullWidth />
          </Stack>
          <Divider>Step</Divider>
          {steps.map((s, i) => (
            <Paper key={i} variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" label={i + 1} />
                  <TextField size="small" label="Nome dello step" value={s.name} onChange={(e) => setStep(i, { name: e.target.value })} fullWidth />
                  <IconButton aria-label="Sposta su" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUpwardIcon /></IconButton>
                  <IconButton aria-label="Sposta giù" disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDownwardIcon /></IconButton>
                  <IconButton aria-label="Elimina step" disabled={steps.length === 1} onClick={() => setSteps(steps.filter((_, j) => j !== i))}><DeleteIcon /></IconButton>
                </Stack>
                {s.assignees.map((a, k) => (
                  <Stack key={k} direction={{ xs: "column", sm: "row" }} spacing={1}>
                    <TextField select size="small" label="Assegnatario" value={a.type} sx={{ minWidth: 260 }}
                               onChange={(e) => setAssignee(i, k, { type: e.target.value as AssigneeType })}>
                      {(Object.keys(ASSIGNEE_LABEL) as AssigneeType[]).map((t) => <MenuItem key={t} value={t}>{ASSIGNEE_LABEL[t]}</MenuItem>)}
                    </TextField>
                    {a.type === "user" ? (
                      <Autocomplete size="small" fullWidth options={people} value={people.find((p) => p.user_id === a.id) ?? null}
                                    getOptionLabel={(m) => `${m.first_name} ${m.last_name} (${m.organization_code})`}
                                    onChange={(_, m) => setAssignee(i, k, { type: "user", id: m?.user_id })}
                                    renderInput={(p) => <TextField {...p} label="Persona" />} />
                    ) : (
                      <TextField select size="small" fullWidth label="Ruolo" value={a.code ?? ""}
                                 onChange={(e) => setAssignee(i, k, { type: a.type, code: e.target.value })}>
                        {roles.map((r) => <MenuItem key={r.id} value={r.code}>{r.name} ({r.code})</MenuItem>)}
                      </TextField>
                    )}
                    <IconButton aria-label="Togli assegnatario" disabled={s.assignees.length === 1}
                                onClick={() => setStep(i, { assignees: s.assignees.filter((_, j) => j !== k) })}><DeleteIcon /></IconButton>
                  </Stack>
                ))}
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
                  <Button size="small" startIcon={<AddIcon />}
                          onClick={() => setStep(i, { assignees: [...s.assignees, { type: "role", code: "" }] })}>Assegnatario</Button>
                  <Box flexGrow={1} />
                  <TextField select size="small" label="Approvano" sx={{ minWidth: 160 }}
                             value={typeof s.quorum === "object" ? "N" : s.quorum}
                             onChange={(e) => setStep(i, { quorum: e.target.value === "N" ? { n: 2 } : e.target.value as "ALL" | "ANY" })}>
                    <MenuItem value="ALL">Tutti</MenuItem>
                    <MenuItem value="ANY">Uno qualsiasi</MenuItem>
                    <MenuItem value="N">Almeno N</MenuItem>
                  </TextField>
                  {typeof s.quorum === "object" && (
                    <TextField size="small" type="number" label="N" sx={{ width: 80 }} value={s.quorum.n}
                               inputProps={{ min: 1, max: 50 }} onChange={(e) => setStep(i, { quorum: { n: Math.max(1, Number(e.target.value)) } })} />
                  )}
                  <TextField size="small" type="number" label="Scadenza (ore)" sx={{ width: 140 }} value={s.sla_hours ?? ""}
                             inputProps={{ min: 1, max: 2160 }} onChange={(e) => setStep(i, { sla_hours: e.target.value ? Number(e.target.value) : null })} />
                </Stack>
              </Stack>
            </Paper>
          ))}
          <Button startIcon={<AddIcon />} onClick={() => setSteps([...steps, emptyStep()])} sx={{ alignSelf: "flex-start" }}>Aggiungi step</Button>
          <Divider>Al termine</Divider>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField select label="Se approvato" sx={{ minWidth: 240 }} value={onApproved?.to_state ?? ""}
                       onChange={(e) => setOnApproved(e.target.value
                         ? { to_state: e.target.value as "SHARED" | "PUBLISHED", suitability: SUITABILITY[e.target.value as "SHARED" | "PUBLISHED"][0] }
                         : null)}>
              <MenuItem value="">Nessun cambio di stato</MenuItem>
              <MenuItem value="SHARED">Condividi (SHARED)</MenuItem>
              <MenuItem value="PUBLISHED">Pubblica (PUBLISHED)</MenuItem>
            </TextField>
            {onApproved && (
              <TextField select label="Idoneità" sx={{ minWidth: 120 }} value={onApproved.suitability}
                         onChange={(e) => setOnApproved({ ...onApproved, suitability: e.target.value })}>
                {SUITABILITY[onApproved.to_state].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </TextField>
            )}
            <Autocomplete fullWidth options={people} value={people.find((p) => p.user_id === escalation) ?? null}
                          getOptionLabel={(m) => `${m.first_name} ${m.last_name} (${m.organization_code})`}
                          onChange={(_, m) => setEscalation(m?.user_id ?? null)}
                          renderInput={(p) => <TextField {...p} label="Escalation se scade (facoltativo)" />} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {base ? `Salva come v${base.version + 1}` : "Crea"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
