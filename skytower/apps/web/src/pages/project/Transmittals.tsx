// "><(((º> sabusabu <º)))><"
// Transmittal della commessa: registro di protocollo (inviati/ricevuti), nuova trasmissione con scopo,
// destinatari e documenti condivisi o pubblicati, dettaglio con conferma di ricezione e PDF.
import { useEffect, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Autocomplete, Box, Breadcrumbs, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Link,
  MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import { api, apiDownload, ApiError, Member, Project, ProjectOrganization } from "../../api";
import { useAuth } from "../../auth";
import type { DocumentRow } from "./Documents";

export const PURPOSES: Record<string, string> = {
  INFORMATION: "Per informazione", COMMENT: "Per commenti", APPROVAL: "Per approvazione",
  CONSTRUCTION: "Per costruzione", TENDER: "Per gara", RECORD: "Per archivio",
};
const STATE_LABEL: Record<string, string> = { SHARED: "Condiviso", PUBLISHED: "Pubblicato", ARCHIVED: "Archiviato" };

export interface TransmittalRow {
  id: string;
  project_id: string;
  number: number;
  code: string;
  subject: string;
  purpose: string;
  issued_at: string;
  response_due_at: string | null;
  sender_name: string;
  sender_org_code: string;
  item_count: number;
  recipients_label: string;
  sent_by_my_org: boolean;
  i_am_recipient: boolean;
  acknowledged_by_me: boolean;
  project_code?: string;
}
interface TransmittalDetail extends TransmittalRow {
  message: string | null;
  sender_org_name: string;
  recipients: { organization_id: string | null; organization_code: string | null; legal_name: string | null; user_id: string | null; user_name: string | null; user_org_code: string | null }[];
  items: { position: number; revision_id: string; document_id: string; identifier: string; title: string; revision_code: string; suitability: string; state: string; original_filename: string; size_bytes: number; sha256: string; visible: boolean }[];
  receipts: { user_id: string; user_name: string; organization_code: string; acknowledged_at: string }[];
}

const when = (iso: string) => new Date(iso).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });

export function TransmittalsTab({ project }: { project: Project }) {
  const { transmittalId } = useParams();
  return transmittalId ? <TransmittalDetailView project={project} id={transmittalId} /> : <TransmittalList project={project} />;
}

function TransmittalList({ project }: { project: Project }) {
  const navigate = useNavigate();
  const [direction, setDirection] = useState<"" | "sent" | "received">("");
  const [creating, setCreating] = useState(false);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["transmittals", project.id, direction],
    queryFn: () => api<TransmittalRow[]>(`/projects/${project.id}/transmittals${direction ? `?direction=${direction}` : ""}`),
  });
  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <ToggleButtonGroup size="small" exclusive value={direction} onChange={(_, v) => v !== null && setDirection(v)}>
          <ToggleButton value="">Tutti</ToggleButton>
          <ToggleButton value="sent">Inviati</ToggleButton>
          <ToggleButton value="received">Ricevuti</ToggleButton>
        </ToggleButtonGroup>
        <Box flexGrow={1} />
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setCreating(true)}>Nuova trasmissione</Button>
      </Stack>
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        {!isLoading && rows.length === 0 ? (
          <Typography color="text.secondary" textAlign="center" py={5}>Nessuna trasmissione.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ "& th": { fontWeight: 600, color: "text.secondary" } }}>
                <TableCell>Protocollo</TableCell><TableCell>Data</TableCell><TableCell>Oggetto</TableCell><TableCell>Scopo</TableCell>
                <TableCell>Da</TableCell><TableCell>A</TableCell><TableCell align="right">Doc.</TableCell><TableCell>Ricezione</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/progetti/${project.id}/transmittal/${t.id}`)}>
                  <TableCell sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{t.code}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(t.issued_at).toLocaleDateString("it-IT")}</TableCell>
                  <TableCell>{t.subject}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{PURPOSES[t.purpose] ?? t.purpose}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{t.sender_org_code}</TableCell>
                  <TableCell>{t.recipients_label}</TableCell>
                  <TableCell align="right">{t.item_count}</TableCell>
                  <TableCell>
                    {t.i_am_recipient && (t.acknowledged_by_me
                      ? <Chip size="small" color="success" variant="outlined" label="Confermata" />
                      : <Chip size="small" color="warning" label="Da confermare" />)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
      {creating && <NewTransmittalDialog project={project} onClose={() => setCreating(false)} />}
    </Stack>
  );
}

function useTransmittable(project: Project, q: string) {
  // revisioni condivise o pubblicate e verificate: le sole che si trasmettono
  return useQuery({
    queryKey: ["transmittable", project.id, q],
    queryFn: async () => {
      const qs = q ? `&q=${encodeURIComponent(q)}` : "";
      const [shared, published] = await Promise.all(["SHARED", "PUBLISHED"].map((area) =>
        api<{ items: DocumentRow[] }>(`/projects/${project.id}/documents?area=${area}&limit=100${qs}`)));
      return [...shared.items, ...published.items]
        .filter((d) => d.current_revision_id && d.current_scan_status === "CLEAN" && !d.archived_at);
    },
  });
}

export function NewTransmittalDialog({ project, initial = [], onClose }: {
  project: Project; initial?: DocumentRow[]; onClose: () => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { me } = useAuth();
  const [subject, setSubject] = useState("");
  const [purpose, setPurpose] = useState("INFORMATION");
  const [message, setMessage] = useState("");
  const [due, setDue] = useState("");
  const [orgs, setOrgs] = useState<ProjectOrganization[]>([]);
  const [people, setPeople] = useState<Member[]>([]);
  const [docs, setDocs] = useState<DocumentRow[]>(initial);
  const [input, setInput] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => { const t = setTimeout(() => setQ(input), 300); return () => clearTimeout(t); }, [input]);

  const { data: allOrgs = [] } = useQuery({
    queryKey: ["project-orgs", project.id],
    queryFn: () => api<ProjectOrganization[]>(`/projects/${project.id}/organizations`),
  });
  const { data: members = [] } = useQuery({
    queryKey: ["members", project.id],
    queryFn: () => api<Member[]>(`/projects/${project.id}/members`),
  });
  const { data: options = [], isFetching } = useTransmittable(project, q);
  const uniquePeople = [...new Map(members.filter((m) => m.user_id !== me?.id).map((m) => [m.user_id, m])).values()];

  const create = useMutation({
    mutationFn: () => api<TransmittalRow>(`/projects/${project.id}/transmittals`, {
      method: "POST",
      json: {
        subject, purpose, message: message || null,
        response_due_at: due ? new Date(`${due}T18:00:00`).toISOString() : null,
        recipient_organization_ids: orgs.map((o) => o.organization_id),
        recipient_user_ids: people.map((p) => p.user_id),
        revision_ids: docs.map((d) => d.current_revision_id),
      },
    }),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ["transmittals", project.id] });
      onClose();
      navigate(`/progetti/${project.id}/transmittal/${t.id}`);
    },
  });
  const valid = subject.trim().length >= 3 && docs.length > 0 && (orgs.length > 0 || people.length > 0);

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Nuova trasmissione</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {create.error && <Alert severity="error">{(create.error as ApiError).message}</Alert>}
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <TextField label="Oggetto" value={subject} onChange={(e) => setSubject(e.target.value)} autoFocus fullWidth />
            <TextField select label="Scopo" value={purpose} onChange={(e) => setPurpose(e.target.value)} sx={{ minWidth: 200 }}>
              {Object.entries(PURPOSES).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
            </TextField>
          </Stack>
          <Autocomplete multiple options={allOrgs.filter((o) => o.is_active && o.organization_id !== me?.organization_id)}
                        value={orgs} onChange={(_, v) => setOrgs(v)} getOptionLabel={(o) => `${o.code} — ${o.legal_name}`}
                        isOptionEqualToValue={(a, b) => a.organization_id === b.organization_id}
                        renderInput={(p) => <TextField {...p} label="Organizzazioni destinatarie" />} />
          <Autocomplete multiple options={uniquePeople} value={people} onChange={(_, v) => setPeople(v)}
                        getOptionLabel={(m) => `${m.first_name} ${m.last_name} (${m.organization_code})`}
                        isOptionEqualToValue={(a, b) => a.user_id === b.user_id}
                        renderInput={(p) => <TextField {...p} label="Persone destinatarie (facoltativo)" />} />
          <Autocomplete multiple options={options} value={docs} onChange={(_, v) => setDocs(v)} loading={isFetching}
                        filterOptions={(x) => x} inputValue={input} onInputChange={(_, v, reason) => reason !== "reset" && setInput(v)}
                        getOptionLabel={(d) => `${d.identifier} ${d.current_revision ?? ""}`}
                        isOptionEqualToValue={(a, b) => a.current_revision_id === b.current_revision_id}
                        renderOption={(props, d) => (
                          <li {...props} key={d.current_revision_id}>
                            <Box>
                              <Typography fontFamily="monospace" fontSize={13}>{d.identifier} · {d.current_revision} {d.current_suitability}</Typography>
                              <Typography variant="caption" color="text.secondary">{d.title} · {STATE_LABEL[d.current_state ?? ""] ?? d.current_state}</Typography>
                            </Box>
                          </li>
                        )}
                        renderInput={(p) => <TextField {...p} label="Documenti da trasmettere"
                                                       helperText="Solo revisioni condivise o pubblicate. Cerca per codice o titolo." />} />
          <TextField label="Note (facoltativo)" multiline minRows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
          <TextField type="date" label="Risposta entro (facoltativo)" value={due} onChange={(e) => setDue(e.target.value)}
                     InputLabelProps={{ shrink: true }} inputProps={{ min: new Date().toISOString().slice(0, 10) }} sx={{ maxWidth: 260 }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!valid || create.isPending} onClick={() => create.mutate()}>
          Emetti {docs.length > 0 && `(${docs.length} doc.)`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TransmittalDetailView({ project, id }: { project: Project; id: string }) {
  const qc = useQueryClient();
  const { data: t, error } = useQuery({ queryKey: ["transmittal", id], queryFn: () => api<TransmittalDetail>(`/transmittals/${id}`) });
  const ack = useMutation({
    mutationFn: () => api<TransmittalDetail>(`/transmittals/${id}/acknowledge`, { method: "POST" }),
    onSuccess: (r) => {
      qc.setQueryData(["transmittal", id], r);
      qc.invalidateQueries({ queryKey: ["transmittals", project.id] });
      qc.invalidateQueries({ queryKey: ["my-transmittals"] });
    },
  });
  const pdf = useMutation({ mutationFn: () => apiDownload(`/transmittals/${id}/pdf`, "transmittal.pdf") });

  if (error) return <Alert severity="error">{(error as ApiError).status === 404 ? "Trasmissione non trovata" : (error as Error).message}</Alert>;
  if (!t) return null;
  return (
    <Stack spacing={2} maxWidth={1100}>
      <Breadcrumbs>
        <Link component={RouterLink} to={`/progetti/${project.id}/transmittal`} underline="hover" color="inherit">Transmittal</Link>
        <Typography color="text.primary" fontFamily="monospace">{t.code}</Typography>
      </Breadcrumbs>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="h5" fontWeight={600} flexGrow={1}>{t.subject}</Typography>
        <Chip label={PURPOSES[t.purpose] ?? t.purpose} />
        <Button variant="outlined" startIcon={<PictureAsPdfIcon />} disabled={pdf.isPending} onClick={() => pdf.mutate()}>PDF</Button>
        {t.i_am_recipient && !t.acknowledged_by_me && (
          <Button variant="contained" startIcon={<CheckIcon />} disabled={ack.isPending} onClick={() => ack.mutate()}>Conferma ricezione</Button>
        )}
      </Stack>
      {(ack.error || pdf.error) && <Alert severity="error">{((ack.error || pdf.error) as ApiError).message}</Alert>}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Box display="grid" gridTemplateColumns={{ xs: "1fr", sm: "160px 1fr" }} rowGap={0.75} columnGap={2}>
          <Typography color="text.secondary">Emessa il</Typography><Typography>{when(t.issued_at)}</Typography>
          <Typography color="text.secondary">Mittente</Typography><Typography>{t.sender_name} · {t.sender_org_code} {t.sender_org_name}</Typography>
          <Typography color="text.secondary">Destinatari</Typography>
          <Typography>{t.recipients.map((r) => r.organization_code ? `${r.organization_code} — ${r.legal_name}` : `${r.user_name} (${r.user_org_code})`).join("; ")}</Typography>
          {t.response_due_at && <><Typography color="text.secondary">Risposta entro</Typography><Typography>{new Date(t.response_due_at).toLocaleDateString("it-IT")}</Typography></>}
          {t.message && <><Typography color="text.secondary">Note</Typography><Typography whiteSpace="pre-wrap">{t.message}</Typography></>}
        </Box>
      </Paper>
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ "& th": { fontWeight: 600, color: "text.secondary" } }}>
              <TableCell>N.</TableCell><TableCell>Identificativo</TableCell><TableCell>Titolo</TableCell><TableCell>Rev.</TableCell>
              <TableCell>Idoneità</TableCell><TableCell>Stato</TableCell><TableCell>SHA-256</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {t.items.map((i) => (
              <TableRow key={i.position}>
                <TableCell>{i.position}</TableCell>
                <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>
                  {i.visible
                    ? <Link component={RouterLink} to={`/progetti/${project.id}/documenti?doc=${i.document_id}`}>{i.identifier}</Link>
                    : i.identifier}
                </TableCell>
                <TableCell>{i.title}<Typography variant="caption" display="block" color="text.secondary">{i.original_filename}</Typography></TableCell>
                <TableCell>{i.revision_code}</TableCell><TableCell>{i.suitability}</TableCell>
                <TableCell>{STATE_LABEL[i.state] ?? i.state}</TableCell>
                <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }} title={i.sha256}>{i.sha256.slice(0, 12)}…</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography fontWeight={600} mb={1}>Conferme di ricezione</Typography>
        {t.receipts.length === 0
          ? <Typography variant="body2" color="text.secondary">Nessuna conferma.</Typography>
          : t.receipts.map((k) => (
            <Typography key={k.user_id} variant="body2">{k.user_name} ({k.organization_code}) · {when(k.acknowledged_at)}</Typography>
          ))}
      </Paper>
    </Stack>
  );
}
