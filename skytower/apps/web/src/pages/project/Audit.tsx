// "><(((º> sabusabu <º)))><"
// Registro attività della commessa (solo Project Admin): filtri, verifica della hash chain, export CSV firmato.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert, Box, Button, Chip, MenuItem, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, TextField,
  Tooltip, Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import VerifiedIcon from "@mui/icons-material/Verified";
import { api, apiDownload, ApiError, Project } from "../../api";

interface AuditEvent {
  id: number;
  occurred_at: string;
  event_type: string;
  user_name: string | null;
  organization_code: string | null;
  ip: string | null;
  details: Record<string, unknown>;
  chain_seq: number | null;
  hash: string | null;
}
interface Anchor { day: string; chain_seq: number; matches_chain: boolean; matches_s3: boolean | null; has_tsa: boolean; lock_mode: string | null; retain_until: string | null }
interface Verify {
  ok: boolean; checked: number; first_broken_seq: number | null; head_seq: number | null; head_hash: string | null; unsealed: number;
  anchors_ok: boolean; anchors: Anchor[];
}

const EVENT_LABEL: Record<string, string> = {
  DOCUMENT_VIEWED: "Documento visualizzato", REVISION_DOWNLOADED: "Download", REVISION_UPLOADED: "Caricamento",
  REVISION_STATE_CHANGED: "Cambio di stato", BULK_STATE_CHANGE: "Cambio di stato multiplo", WORKFLOW_STARTED: "Workflow avviato",
  WORKFLOW_CANCELLED: "Workflow annullato", TASK_COMPLETED: "Esito di revisione", WORKFLOW_TEMPLATE_SAVED: "Template workflow",
  RFI_CREATED: "RFI aperta", RFI_ANSWERED: "RFI risposta", RFI_MESSAGE_POSTED: "RFI messaggio", RFI_CLOSED: "RFI chiusa",
  GRANT_CREATED: "Condivisione concessa", GRANT_REVOKED: "Condivisione revocata", CONTAINER_CREATED: "Cartella creata",
  CONTAINER_UPDATED: "Cartella modificata", MEMBER_ADDED: "Membro aggiunto", MEMBER_REMOVED: "Membro rimosso",
  ROLE_CREATED: "Ruolo creato", ROLE_UPDATED: "Ruolo modificato", ROLE_DELETED: "Ruolo eliminato",
  ACCESS_REQUESTED: "Richiesta di accesso", ACCESS_GRANTED: "Accesso concesso", ACCESS_REJECTED: "Accesso negato",
  AUDIT_EXPORTED: "Registro esportato", PROJECT_UPDATED: "Commessa modificata",
};

const toIso = (date: string, endOfDay = false) => (date ? new Date(`${date}T${endOfDay ? "23:59:59" : "00:00:00"}`).toISOString() : "");

export function AuditTab({ project }: { project: Project }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [type, setType] = useState("");
  const [object, setObject] = useState("");
  const params = new URLSearchParams();
  if (from) params.set("from", toIso(from));
  if (to) params.set("to", toIso(to, true));
  if (type) params.set("event_type", type);
  if (object.trim()) params.set("object", object.trim());
  const qs = params.toString();

  const { data: events = [], error, isLoading } = useQuery({
    queryKey: ["audit", project.id, qs],
    queryFn: () => api<AuditEvent[]>(`/projects/${project.id}/audit?limit=500${qs ? `&${qs}` : ""}`),
  });
  const verify = useMutation({ mutationFn: () => api<Verify>(`/projects/${project.id}/audit/verify`) });
  const exportCsv = useMutation({
    mutationFn: () => apiDownload(`/projects/${project.id}/audit/export.csv${qs ? `?${qs}` : ""}`, "registro.csv"),
  });

  if (error) return <Alert severity="warning">{(error as ApiError).message}</Alert>;

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Ogni azione su documenti, permessi, workflow e RFI resta nel registro. Gli eventi vengono sigillati in una
        catena di hash: qualsiasi modifica successiva è rilevata dalla verifica. L'export CSV è firmato digitalmente.
      </Typography>
      <Paper variant="outlined" sx={{ p: 1.5, display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
        <TextField size="small" type="date" label="Dal" value={from} onChange={(e) => setFrom(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" type="date" label="Al" value={to} onChange={(e) => setTo(e.target.value)} InputLabelProps={{ shrink: true }} />
        <TextField size="small" select label="Evento" value={type} onChange={(e) => setType(e.target.value)} sx={{ minWidth: 220 }}>
          <MenuItem value="">Tutti</MenuItem>
          {Object.entries(EVENT_LABEL).sort((a, b) => a[1].localeCompare(b[1])).map(([k, v]) => <MenuItem key={k} value={k}>{v}</MenuItem>)}
        </TextField>
        <TextField size="small" label="Documento o oggetto" placeholder="identificativo, id…" value={object}
                   onChange={(e) => setObject(e.target.value)} />
        <Box flexGrow={1} />
        <Button startIcon={<VerifiedIcon />} disabled={verify.isPending} onClick={() => verify.mutate()}>Verifica integrità</Button>
        <Button variant="contained" startIcon={<DownloadIcon />} disabled={exportCsv.isPending} onClick={() => exportCsv.mutate()}>
          Esporta CSV firmato
        </Button>
      </Paper>
      {verify.data && (
        verify.data.ok
          ? <Alert severity="success">Catena integra: {verify.data.checked} eventi verificati
              {verify.data.unsealed ? `, ${verify.data.unsealed} in attesa di sigillo` : ""}. Hash di testa <code>{verify.data.head_hash?.slice(0, 16)}…</code>
              {verify.data.anchors.length > 0 && <AnchorsLine anchors={verify.data.anchors} />}</Alert>
          : verify.data.first_broken_seq !== null
            ? <Alert severity="error">Catena interrotta all'evento n. {verify.data.first_broken_seq}: il registro è stato alterato.</Alert>
            : <Alert severity="error">La catena non corrisponde alle ancore giornaliere
                {" "}({verify.data.anchors.filter((a) => !a.matches_chain || a.matches_s3 === false).map((a) => a.day).join(", ")}):
                il registro è stato riscritto.</Alert>
      )}
      {(verify.error || exportCsv.error) && <Alert severity="error">{((verify.error || exportCsv.error) as ApiError).message}</Alert>}
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        {!isLoading && events.length === 0 ? (
          <Typography color="text.secondary" textAlign="center" py={5}>Nessun evento con questi filtri.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow sx={{ "& th": { fontWeight: 600, color: "text.secondary" } }}>
                <TableCell>Quando</TableCell><TableCell>Evento</TableCell><TableCell>Chi</TableCell>
                <TableCell>Dettagli</TableCell><TableCell>IP</TableCell><TableCell>Sigillo</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.id}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(e.occurred_at).toLocaleString("it-IT")}</TableCell>
                  <TableCell>{EVENT_LABEL[e.event_type] ?? e.event_type}</TableCell>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{e.user_name ?? "sistema"} {e.organization_code && <Chip size="small" variant="outlined" label={e.organization_code} />}</TableCell>
                  <TableCell sx={{ fontSize: 12, color: "text.secondary", maxWidth: 420, wordBreak: "break-word" }}>
                    {Object.entries(e.details).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")}
                  </TableCell>
                  <TableCell sx={{ fontFamily: "monospace", fontSize: 12 }}>{e.ip ?? ""}</TableCell>
                  <TableCell>
                    {e.chain_seq
                      ? <Tooltip title={e.hash ?? ""}><Chip size="small" color="success" variant="outlined" label={`#${e.chain_seq}`} /></Tooltip>
                      : <Chip size="small" label="in attesa" />}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Stack>
  );
}

function AnchorsLine({ anchors }: { anchors: Anchor[] }) {
  const onS3 = anchors.filter((a) => a.matches_s3).length;
  const stamped = anchors.filter((a) => a.has_tsa).length;
  return (
    <Typography variant="body2" mt={0.5}>
      Ultime {anchors.length} ancore giornaliere coerenti con la catena; {onS3} confermate dalla copia su S3 non modificabile
      {stamped ? `, ${stamped} con marca temporale` : ""}.
    </Typography>
  );
}
