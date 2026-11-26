// "><(((º> sabusabu <º)))><"
// Scheda "Discussioni" della commessa (ADR-59): conversazioni fra persone invitate. Le vede solo chi è invitato
// (nemmeno il Project Admin, se non lo è). Elenco con i messaggi non letti; nella discussione i messaggi in ordine di
// tempo, documenti della commessa allegati, e da ogni messaggio "Crea task" (il task resta collegato e compare sotto
// il messaggio). Chi l'ha aperta cambia titolo e persone e la chiude o riapre; gli altri possono uscirne.
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Autocomplete, Badge, Box, Breadcrumbs, Button, Chip, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, Link, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AddTaskIcon from "@mui/icons-material/AddTask";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import DescriptionIcon from "@mui/icons-material/Description";
import GroupIcon from "@mui/icons-material/Group";
import LockIcon from "@mui/icons-material/Lock";
import { api, ApiError, Discussion, DiscussionDetail, Project } from "../../api";
import { useAuth } from "../../auth";
import { STATUS, nomeMembro, quando, usePersone } from "../../components/task/common";
import { TaskDialog } from "../../components/task/TaskDialog";

type Stato = "aperte" | "chiuse" | "tutte";
interface DocOption { id: string; identifier: string; title: string; current_revision_id: string | null; current_revision: string | null }

export function DiscussioniTab({ project }: { project: Project }) {
  const { discussionId } = useParams();
  return discussionId ? <Conversazione project={project} discussionId={discussionId} /> : <Elenco project={project} />;
}

function Elenco({ project }: { project: Project }) {
  const navigate = useNavigate();
  const [stato, setStato] = useState<Stato>("aperte");
  const [creating, setCreating] = useState(false);
  const { data = [], isLoading } = useQuery({
    queryKey: ["discussions", project.id, stato],
    queryFn: () => api<Discussion[]>(`/projects/${project.id}/discussions?stato=${stato}`),
    refetchInterval: 30_000,
  });
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <ToggleButtonGroup size="small" exclusive value={stato} onChange={(_, v) => v && setStato(v)} aria-label="Stato">
          <ToggleButton value="aperte">Aperte</ToggleButton>
          <ToggleButton value="chiuse">Chiuse</ToggleButton>
          <ToggleButton value="tutte">Tutte</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary" flexGrow={1} px={1}>
          Vedi solo le discussioni a cui sei stato invitato.
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Nuova discussione</Button>
      </Stack>
      <Paper variant="outlined">
        {!isLoading && data.length === 0 && (
          <Typography color="text.secondary" textAlign="center" py={5}>
            {stato === "chiuse" ? "Nessuna discussione chiusa." : "Nessuna discussione: aprine una con «Nuova discussione»."}
          </Typography>
        )}
        {data.map((d, i) => (
          <Box key={d.id} role="link" tabIndex={0} aria-label={`Discussione ${d.title}`}
               onClick={() => navigate(`/progetti/${project.id}/discussioni/${d.id}`)}
               onKeyDown={(e) => { if (e.key === "Enter") navigate(`/progetti/${project.id}/discussioni/${d.id}`); }}
               sx={{ px: 2, py: 1.5, cursor: "pointer", borderTop: i ? 1 : 0, borderColor: "divider", "&:hover": { bgcolor: "action.hover" } }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography fontWeight={d.unread ? 700 : 600} flexGrow={1} noWrap>{d.title}</Typography>
              {d.closed_at && <Chip size="small" icon={<LockIcon />} label="Chiusa" />}
              {d.unread > 0 && <Chip size="small" color="primary" label={d.unread === 1 ? "1 nuovo" : `${d.unread} nuovi`} />}
              <Typography variant="caption" color="text.secondary" whiteSpace="nowrap">{quando(d.last_message_at)}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" noWrap>
              {d.last_author && <b>{d.last_author}: </b>}{d.last_body}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              <GroupIcon sx={{ fontSize: 13, verticalAlign: "-2px", mr: 0.5 }} />{d.participant_names}
            </Typography>
          </Box>
        ))}
      </Paper>
      {creating && <NuovaDiscussione project={project} onClose={() => setCreating(false)} />}
    </Stack>
  );
}

function NuovaDiscussione({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me } = useAuth();
  const persone = usePersone(project.id).filter((p) => p.user_id !== me?.id);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [invitati, setInvitati] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () => api<DiscussionDetail>(`/projects/${project.id}/discussions`, {
      method: "POST", json: { title, body, participant_ids: invitati },
    }),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ["discussions", project.id] });
      onClose();
      navigate(`/progetti/${project.id}/discussioni/${d.id}`);
    },
  });
  const valid = title.trim().length >= 3 && body.trim() && invitati.length > 0;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nuova discussione</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {create.error && <Alert severity="error">{(create.error as ApiError).message}</Alert>}
          <TextField label="Titolo" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus inputProps={{ maxLength: 200 }} />
          <Autocomplete multiple options={persone} value={persone.filter((p) => invitati.includes(p.user_id))}
                        onChange={(_, v) => setInvitati(v.map((p) => p.user_id))} getOptionLabel={nomeMembro}
                        isOptionEqualToValue={(a, b) => a.user_id === b.user_id}
                        renderInput={(p) => <TextField {...p} label="Persone invitate"
                                                       helperText="La discussione la vedono solo loro e tu" />} />
          <TextField label="Primo messaggio" multiline minRows={4} value={body} onChange={(e) => setBody(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!valid || create.isPending} onClick={() => create.mutate()}>Avvia la discussione</Button>
      </DialogActions>
    </Dialog>
  );
}

function Conversazione({ project, discussionId }: { project: Project; discussionId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [body, setBody] = useState("");
  const [allegati, setAllegati] = useState<DocOption[]>([]);
  const [allegando, setAllegando] = useState(false);
  const [persone, setPersone] = useState(false);
  const [uscita, setUscita] = useState(false);
  const [taskDa, setTaskDa] = useState<DiscussionDetail["messages"][number] | null>(null);
  const { data: d, error } = useQuery({
    queryKey: ["discussion", discussionId],
    queryFn: () => api<DiscussionDetail>(`/discussions/${discussionId}`),
    refetchInterval: 15_000,
  });

  // mostrata = letta: azzera i non letti e gli avvisi della discussione (anche quando arrivano messaggi nuovi)
  useEffect(() => {
    if (!d) return;
    api(`/discussions/${discussionId}/read`, { method: "POST" })
      .then(() => {
        qc.invalidateQueries({ queryKey: ["discussions", project.id] });
        qc.invalidateQueries({ queryKey: ["my-discussions"] });
        qc.invalidateQueries({ queryKey: ["notifications"] });
      })
      .catch(() => undefined);
  }, [discussionId, d?.message_count, project.id, qc]); // eslint-disable-line react-hooks/exhaustive-deps

  const aggiorna = (x: DiscussionDetail) => {
    qc.setQueryData(["discussion", discussionId], x);
    qc.invalidateQueries({ queryKey: ["discussions", project.id] });
  };
  const post = useMutation({
    mutationFn: () => api<DiscussionDetail>(`/discussions/${discussionId}/messages`, {
      method: "POST", json: { body, revision_ids: allegati.map((a) => a.current_revision_id).filter(Boolean) },
    }),
    onSuccess: (x) => { setBody(""); setAllegati([]); setAllegando(false); aggiorna(x); },
  });
  const chiudi = useMutation({
    mutationFn: (closed: boolean) => api<DiscussionDetail>(`/discussions/${discussionId}`, { method: "PATCH", json: { closed } }),
    onSuccess: aggiorna,
  });
  const esci = useMutation({
    mutationFn: () => api(`/discussions/${discussionId}/leave`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["discussions", project.id] });
      navigate(`/progetti/${project.id}/discussioni`);
    },
  });

  if (error) return <Alert severity="error">{(error as ApiError).status === 404 ? "Discussione non trovata (o non sei fra gli invitati)" : (error as Error).message}</Alert>;
  if (!d) return null;
  const chiusa = !!d.closed_at;

  return (
    <Stack spacing={2} maxWidth={960}>
      <Breadcrumbs>
        <Link component={RouterLink} to={`/progetti/${project.id}/discussioni`} underline="hover" color="inherit">Discussioni</Link>
        <Typography color="text.primary">{d.title}</Typography>
      </Breadcrumbs>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h5" fontWeight={600} flexGrow={1}>{d.title}</Typography>
        {chiusa && <Chip icon={<LockIcon />} label="Chiusa" />}
        {d.i_am_creator ? (
          <>
            <Button variant="outlined" startIcon={<GroupIcon />} onClick={() => setPersone(true)}>Persone</Button>
            <Button variant="outlined" disabled={chiudi.isPending} onClick={() => chiudi.mutate(!chiusa)}>
              {chiusa ? "Riapri la discussione" : "Chiudi la discussione"}
            </Button>
          </>
        ) : (
          <Button variant="outlined" color="inherit" onClick={() => setUscita(true)}>Esci dalla discussione</Button>
        )}
      </Stack>
      <Stack direction="row" spacing={0.5} alignItems="center" flexWrap="wrap" useFlexGap aria-label="Persone nella discussione">
        <Typography variant="body2" color="text.secondary" mr={0.5}>Aperta da {d.created_by_name} il {quando(d.created_at)} · con</Typography>
        {d.participants.filter((p) => !p.is_creator).map((p) => (
          <Chip key={p.user_id} size="small" variant="outlined" label={`${p.name}${p.organization_code ? ` · ${p.organization_code}` : ""}`} />
        ))}
      </Stack>
      {(chiudi.error || esci.error) && <Alert severity="error">{((chiudi.error ?? esci.error) as ApiError).message}</Alert>}

      {d.tasks.length > 0 && (
        <Paper variant="outlined" sx={{ p: 1.5 }} aria-label="Task nati dalla discussione">
          <Typography variant="body2" fontWeight={600} mb={0.75}>Task nati da questa discussione</Typography>
          <Stack direction="row" gap={0.75} flexWrap="wrap">
            {d.tasks.map((t) => (
              <Chip key={t.id} size="small" clickable color={STATUS[t.status].color} component={RouterLink}
                    to={`/progetti/${project.id}/task/${t.id}`} label={`${t.code} ${t.title} · ${STATUS[t.status].label}`} />
            ))}
          </Stack>
        </Paper>
      )}

      <Stack spacing={1.5}>
        {d.messages.map((m) => {
          const nascosti = m.attachment_count - m.attachments.length;
          return (
            <Paper key={m.id} variant="outlined" sx={{ p: 2 }} component="article" aria-label={`Messaggio di ${m.author_name}`}>
              <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
                <Typography fontWeight={600}>{m.author_name}</Typography>
                {m.author_org_code && <Chip size="small" variant="outlined" label={m.author_org_code} />}
                <Typography variant="caption" color="text.secondary" flexGrow={1}>{quando(m.created_at)}</Typography>
                {!chiusa && <Button size="small" startIcon={<AddTaskIcon />} onClick={() => setTaskDa(m)}>Crea task</Button>}
              </Stack>
              <Typography whiteSpace="pre-wrap">{m.body}</Typography>
              {(m.attachments.length > 0 || nascosti > 0) && (
                <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" useFlexGap>
                  {m.attachments.map((a) => (
                    <Chip key={a.revision_id} size="small" variant="outlined" icon={<DescriptionIcon />} clickable
                          component={RouterLink} to={`/documenti/${a.document_id}`} target="_blank"
                          label={`${a.identifier} ${a.revision_code} — ${a.title}`} />
                  ))}
                  {nascosti > 0 && <Chip size="small" label={`${nascosti} allegat${nascosti === 1 ? "o" : "i"} che non puoi vedere`} />}
                </Stack>
              )}
              {m.tasks.length > 0 && (
                <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" useFlexGap>
                  {m.tasks.map((t) => (
                    <Chip key={t.id} size="small" icon={<AddTaskIcon />} clickable component={RouterLink}
                          to={`/progetti/${project.id}/task/${t.id}`} label={`${t.code} · ${STATUS[t.status].label}`} />
                  ))}
                </Stack>
              )}
            </Paper>
          );
        })}
      </Stack>

      {chiusa ? (
        <Alert severity="info" icon={<LockIcon />}>
          La discussione è chiusa: si legge ma non si scrive. {d.i_am_creator ? "Puoi riaprirla dal pulsante in alto." : ""}
        </Alert>
      ) : (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            {post.error && <Alert severity="error">{(post.error as ApiError).message}</Alert>}
            <TextField label="Scrivi un messaggio" multiline minRows={3} value={body} onChange={(e) => setBody(e.target.value)} />
            {allegando && <AllegaDocumenti project={project} value={allegati} onChange={setAllegati} />}
            <Stack direction="row" alignItems="center" spacing={1}>
              <Badge badgeContent={allegati.length} color="primary">
                <Button startIcon={<AttachFileIcon />} onClick={() => setAllegando((x) => !x)}>Allega documenti</Button>
              </Badge>
              <Box flexGrow={1} />
              <Button variant="contained" disabled={!body.trim() || post.isPending} onClick={() => post.mutate()}>Invia</Button>
            </Stack>
          </Stack>
        </Paper>
      )}

      {persone && <PersoneDialog project={project} d={d} onClose={() => setPersone(false)} onSaved={aggiorna} />}
      {taskDa && (
        <TaskDialog projectId={project.id} onClose={() => setTaskDa(null)}
                    origine={{ discussionId: d.id, messageId: taskDa.id, testo: taskDa.body,
                               titolo: taskDa.body.split("\n")[0]!.slice(0, 120) }} />
      )}
      <Dialog open={uscita} onClose={() => setUscita(false)}>
        <DialogTitle>Uscire dalla discussione?</DialogTitle>
        <DialogContent>
          <DialogContentText>Non la vedrai più e non riceverai più avvisi. Per rientrare deve invitarti di nuovo {d.created_by_name}.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUscita(false)}>Annulla</Button>
          <Button variant="contained" disabled={esci.isPending} onClick={() => esci.mutate()}>Esci</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

/** Documenti della commessa da allegare: si cerca per identificativo o titolo, si allega la revisione corrente. */
function AllegaDocumenti({ project, value, onChange }: { project: Project; value: DocOption[]; onChange: (v: DocOption[]) => void }) {
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["doc-search", project.id, q],
    queryFn: () => api<{ items: DocOption[] }>(`/projects/${project.id}/documents?q=${encodeURIComponent(q)}&limit=20`),
    enabled: q.trim().length >= 2,
  });
  const options = useMemo(() => {
    const visti = new Set(value.map((v) => v.id));
    return [...value, ...(data?.items ?? []).filter((d) => d.current_revision_id && !visti.has(d.id))];
  }, [data, value]);
  return (
    <Autocomplete multiple options={options} value={value} filterOptions={(x) => x}
                  onChange={(_, v) => onChange(v)} onInputChange={(_, v) => setQ(v)}
                  getOptionLabel={(d) => `${d.identifier} ${d.current_revision ?? ""} — ${d.title}`}
                  isOptionEqualToValue={(a, b) => a.id === b.id} noOptionsText={q.trim().length < 2 ? "Scrivi almeno 2 lettere" : "Nessun documento"}
                  renderInput={(p) => <TextField {...p} label="Documenti da allegare" placeholder="identificativo o titolo"
                                                 helperText="Si allega la revisione corrente; chi non può vedere il documento non lo vede nemmeno qui" />} />
  );
}

function PersoneDialog({ project, d, onClose, onSaved }: {
  project: Project; d: DiscussionDetail; onClose: () => void; onSaved: (x: DiscussionDetail) => void;
}) {
  const { me } = useAuth();
  const persone = usePersone(project.id).filter((p) => p.user_id !== me?.id);
  const [title, setTitle] = useState(d.title);
  const [scelti, setScelti] = useState<string[]>(d.participants.filter((p) => !p.is_creator).map((p) => p.user_id));
  const save = useMutation({
    mutationFn: () => api<DiscussionDetail>(`/discussions/${d.id}`, {
      method: "PATCH", json: { title: title.trim() === d.title ? undefined : title, participant_ids: scelti },
    }),
    onSuccess: (x) => { onSaved(x); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Titolo e persone</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {save.error && <Alert severity="error">{(save.error as ApiError).message}</Alert>}
          <TextField label="Titolo" value={title} onChange={(e) => setTitle(e.target.value)} inputProps={{ maxLength: 200 }} />
          <Autocomplete multiple options={persone} value={persone.filter((p) => scelti.includes(p.user_id))}
                        onChange={(_, v) => setScelti(v.map((p) => p.user_id))} getOptionLabel={nomeMembro}
                        isOptionEqualToValue={(a, b) => a.user_id === b.user_id}
                        renderInput={(p) => <TextField {...p} label="Persone invitate"
                                                       helperText="Chi aggiungi vede tutta la discussione, anche i messaggi di prima; chi togli non la vede più" />} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={title.trim().length < 3 || scelti.length === 0 || save.isPending}
                onClick={() => save.mutate()}>Salva</Button>
      </DialogActions>
    </Dialog>
  );
}
