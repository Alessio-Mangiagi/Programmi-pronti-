// "><(((º> sabusabu <º)))><"
// RFI della commessa: elenco con filtri, nuova richiesta (organizzazioni e/o persone destinatarie,
// scadenza) e conversazione con risposta ufficiale e chiusura da parte di chi l'ha aperta.
import { useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Autocomplete, Box, Breadcrumbs, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Link, Paper, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField,
  ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { api, ApiError, Member, Project, ProjectOrganization, Rfi } from "../../api";
import { useAuth } from "../../auth";

const STATUS: Record<Rfi["status"], { label: string; color: "warning" | "info" | "default" }> = {
  OPEN: { label: "Aperta", color: "warning" },
  ANSWERED: { label: "Risposta", color: "info" },
  CLOSED: { label: "Chiusa", color: "default" },
};

interface RfiDetail extends Rfi {
  recipients: { organization_id: string | null; organization_code: string | null; legal_name: string | null;
                user_id: string | null; user_name: string | null }[];
  messages: { id: string; author_id: string; author_name: string; body: string; is_answer: boolean; created_at: string;
              attachments: { revision_id: string; revision_code: string; identifier: string; document_id: string }[] }[];
  i_am_recipient: boolean;
}

const when = (iso: string) => new Date(iso).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });

export function RfisTab({ project }: { project: Project }) {
  const { rfiId } = useParams();
  return rfiId ? <RfiThread project={project} rfiId={rfiId} /> : <RfiList project={project} />;
}

function RfiList({ project }: { project: Project }) {
  const navigate = useNavigate();
  const [status, setStatus] = useState<"ALL" | Rfi["status"]>("ALL");
  const [creating, setCreating] = useState(false);
  const { data: rfis = [], isLoading } = useQuery({
    queryKey: ["rfis", project.id, status],
    queryFn: () => api<Rfi[]>(`/projects/${project.id}/rfis${status === "ALL" ? "" : `?status=${status}`}`),
  });
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <ToggleButtonGroup size="small" exclusive value={status} onChange={(_, v) => v && setStatus(v)} aria-label="Stato">
          <ToggleButton value="ALL">Tutte</ToggleButton>
          <ToggleButton value="OPEN">Aperte</ToggleButton>
          <ToggleButton value="ANSWERED">Con risposta</ToggleButton>
          <ToggleButton value="CLOSED">Chiuse</ToggleButton>
        </ToggleButtonGroup>
        <Box flexGrow={1} />
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Nuova RFI</Button>
      </Stack>
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        {!isLoading && rfis.length === 0 ? (
          <Typography color="text.secondary" textAlign="center" py={5}>Nessuna RFI visibile.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ "& th": { fontWeight: 600, color: "text.secondary" } }}>
                <TableCell>Codice</TableCell><TableCell>Oggetto</TableCell><TableCell>Da</TableCell>
                <TableCell>Scadenza</TableCell><TableCell>Messaggi</TableCell><TableCell>Stato</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rfis.map((r) => (
                <TableRow key={r.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/progetti/${project.id}/rfi/${r.id}`)}>
                  <TableCell sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{r.code}</TableCell>
                  <TableCell>{r.subject}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{r.author_org_code} · {r.author_name}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap", color: r.overdue ? "error.main" : undefined, fontWeight: r.overdue ? 600 : undefined }}>
                    {r.due_at ? new Date(r.due_at).toLocaleDateString("it-IT") : "—"}{r.overdue && " · scaduta"}
                  </TableCell>
                  <TableCell>{r.message_count}</TableCell>
                  <TableCell><Chip size="small" {...STATUS[r.status]} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
      {creating && <NewRfiDialog project={project} onClose={() => setCreating(false)} />}
    </Stack>
  );
}

function NewRfiDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");
  const [due, setDue] = useState("");
  const [orgs, setOrgs] = useState<ProjectOrganization[]>([]);
  const [people, setPeople] = useState<Member[]>([]);
  const { data: allOrgs = [] } = useQuery({
    queryKey: ["project-orgs", project.id],
    queryFn: () => api<ProjectOrganization[]>(`/projects/${project.id}/organizations`),
  });
  const { data: members = [] } = useQuery({
    queryKey: ["members", project.id],
    queryFn: () => api<Member[]>(`/projects/${project.id}/members`),
  });
  const uniquePeople = [...new Map(members.filter((m) => m.user_id !== me?.id).map((m) => [m.user_id, m])).values()];
  const create = useMutation({
    mutationFn: () => api<Rfi>(`/projects/${project.id}/rfis`, {
      method: "POST",
      json: {
        subject, question, due_at: due ? new Date(`${due}T18:00:00`).toISOString() : null,
        recipient_organization_ids: orgs.map((o) => o.organization_id),
        recipient_user_ids: people.map((p) => p.user_id),
      },
    }),
    onSuccess: (rfi) => {
      qc.invalidateQueries({ queryKey: ["rfis", project.id] });
      qc.invalidateQueries({ queryKey: ["my-rfis"] });
      onClose();
      navigate(`/progetti/${project.id}/rfi/${rfi.id}`);
    },
  });
  const valid = subject.trim().length >= 3 && question.trim() && (orgs.length > 0 || people.length > 0);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nuova RFI</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {create.error && <Alert severity="error">{(create.error as ApiError).message}</Alert>}
          <TextField label="Oggetto" value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus />
          <TextField label="Domanda" multiline minRows={4} value={question} onChange={(e) => setQuestion(e.target.value)} />
          <Autocomplete multiple options={allOrgs.filter((o) => o.is_active && o.organization_id !== me?.organization_id)}
                        value={orgs} onChange={(_, v) => setOrgs(v)} getOptionLabel={(o) => `${o.code} — ${o.legal_name}`}
                        isOptionEqualToValue={(a, b) => a.organization_id === b.organization_id}
                        renderInput={(p) => <TextField {...p} label="Organizzazioni destinatarie" />} />
          <Autocomplete multiple options={uniquePeople} value={people} onChange={(_, v) => setPeople(v)}
                        getOptionLabel={(m) => `${m.first_name} ${m.last_name} (${m.organization_code})`}
                        isOptionEqualToValue={(a, b) => a.user_id === b.user_id}
                        renderInput={(p) => <TextField {...p} label="Persone destinatarie (facoltativo)" />} />
          <TextField type="date" label="Risposta entro" value={due} onChange={(e) => setDue(e.target.value)}
                     InputLabelProps={{ shrink: true }} inputProps={{ min: new Date().toISOString().slice(0, 10) }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!valid || create.isPending} onClick={() => create.mutate()}>Invia</Button>
      </DialogActions>
    </Dialog>
  );
}

function RfiThread({ project, rfiId }: { project: Project; rfiId: string }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  const [body, setBody] = useState("");
  const [isAnswer, setIsAnswer] = useState(true);
  const { data: rfi, error } = useQuery({ queryKey: ["rfi", rfiId], queryFn: () => api<RfiDetail>(`/rfis/${rfiId}`) });
  const refresh = (r: RfiDetail) => {
    qc.setQueryData(["rfi", rfiId], r);
    qc.invalidateQueries({ queryKey: ["rfis", project.id] });
    qc.invalidateQueries({ queryKey: ["my-rfis"] });
  };
  const post = useMutation({
    mutationFn: () => api<RfiDetail>(`/rfis/${rfiId}/messages`, { method: "POST", json: { body, is_answer: rfi?.i_am_recipient && isAnswer } }),
    onSuccess: (r) => { setBody(""); refresh(r); },
  });
  const close = useMutation({
    mutationFn: () => api<RfiDetail>(`/rfis/${rfiId}/close`, { method: "POST" }),
    onSuccess: refresh,
  });

  if (error) return <Alert severity="error">{(error as ApiError).status === 404 ? "RFI non trovata" : (error as Error).message}</Alert>;
  if (!rfi) return null;
  const isAuthor = rfi.author_id === me?.id;

  return (
    <Stack spacing={2} maxWidth={900}>
      <Breadcrumbs>
        <Link component={RouterLink} to={`/progetti/${project.id}/rfi`} underline="hover" color="inherit">RFI</Link>
        <Typography color="text.primary" fontFamily="monospace">{rfi.code}</Typography>
      </Breadcrumbs>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h5" fontWeight={600} flexGrow={1}>{rfi.subject}</Typography>
        <Chip {...STATUS[rfi.status]} />
        {isAuthor && rfi.status !== "CLOSED" && (
          <Button variant="outlined" disabled={close.isPending} onClick={() => close.mutate()}>Chiudi RFI</Button>
        )}
      </Stack>
      <Typography variant="body2" color="text.secondary">
        Aperta da {rfi.author_name} ({rfi.author_org_code}) il {when(rfi.created_at)}
        {rfi.due_at && <> · risposta entro il <b style={{ color: rfi.overdue ? "#b42318" : undefined }}>{new Date(rfi.due_at).toLocaleDateString("it-IT")}</b></>}
        {" · "}destinatari: {rfi.recipients.map((r) => r.organization_code ?? r.user_name).join(", ")}
      </Typography>
      {close.error && <Alert severity="error">{(close.error as ApiError).message}</Alert>}

      <Stack spacing={1.5}>
        {rfi.messages.map((m, i) => (
          <Paper key={m.id} variant="outlined" sx={{ p: 2, borderColor: m.is_answer ? "success.main" : undefined,
                                                     bgcolor: m.is_answer ? "#f3fbf5" : undefined }}>
            <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
              <Typography fontWeight={600}>{m.author_name}</Typography>
              <Typography variant="caption" color="text.secondary">{when(m.created_at)}</Typography>
              {i === 0 && <Chip size="small" label="Domanda" />}
              {m.is_answer && <Chip size="small" color="success" label="Risposta" />}
            </Stack>
            <Typography whiteSpace="pre-wrap">{m.body}</Typography>
            {m.attachments.length > 0 && (
              <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" useFlexGap>
                {m.attachments.map((a) => (
                  <Chip key={a.revision_id} size="small" variant="outlined" sx={{ fontFamily: "monospace" }}
                        label={`${a.identifier} ${a.revision_code}`} />
                ))}
              </Stack>
            )}
          </Paper>
        ))}
      </Stack>

      {rfi.status !== "CLOSED" && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1.5}>
            {post.error && <Alert severity="error">{(post.error as ApiError).message}</Alert>}
            <TextField label={rfi.i_am_recipient ? "Rispondi" : "Aggiungi un messaggio"} multiline minRows={3}
                       value={body} onChange={(e) => setBody(e.target.value)} />
            <Stack direction="row" alignItems="center">
              {rfi.i_am_recipient && (
                <FormControlLabel label="È la risposta ufficiale"
                                  control={<Switch checked={isAnswer} onChange={(e) => setIsAnswer(e.target.checked)} />} />
              )}
              <Box flexGrow={1} />
              <Button variant="contained" disabled={!body.trim() || post.isPending} onClick={() => post.mutate()}>Invia</Button>
            </Stack>
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}
