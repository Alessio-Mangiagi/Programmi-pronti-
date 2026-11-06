// "><(((º> sabusabu <º)))><"
// Registro attività della commessa (solo Project Admin): filtri, verifica della hash chain, export CSV e PDF firmati.
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
// Esito della verifica di una firma di export (POST /audit/export/verify, G49)
interface VerifyExport { valid: boolean; reason: string | null; claims?: Record<string, unknown>; file_matches?: boolean | null; issued_at?: string }
interface Verify {
  ok: boolean; checked: number; first_broken_seq: number | null; head_seq: number | null; head_hash: string | null; unsealed: number;
  anchors_ok: boolean; anchors: Anchor[];
}

const EVENT_LABEL: Record<string, string> = {
  DOCUMENT_SETTINGS_UPDATED: "Impostazioni naming", NAMING_RESERVED: "Numeri prenotati", NAMING_RESERVATION_RELEASED: "Prenotazione rilasciata",
  NAMING_PROFILE_CREATED: "Schema di naming creato", NAMING_PROFILE_UPDATED: "Schema di naming modificato",
  NAMING_PROFILE_DELETED: "Schema di naming eliminato", NAMING_PROFILE_ASSIGNED: "Schema di naming applicato a cartelle",
  NAMING_RESERVATIONS_EXPIRED: "Prenotazioni scadute",
  DOCUMENT_VIEWED: "Documento visualizzato", REVISION_DOWNLOADED: "Download", REVISION_UPLOADED: "Caricamento", OFFICE_EDIT_OPENED: "Aperto nell'editor OnlyOffice", SIGNATURE_VERIFIED: "Firma digitale verificata di nuovo",
  REVISION_STATE_CHANGED: "Cambio di stato", BULK_STATE_CHANGE: "Cambio di stato multiplo", WORKFLOW_STARTED: "Workflow avviato", WORKFLOW_TEMPLATE_IMPORTED: "Workflow importato da un altro progetto",
  WORKFLOW_CANCELLED: "Workflow annullato", TASK_COMPLETED: "Esito di revisione", WORKFLOW_TEMPLATE_SAVED: "Template workflow",
  RFI_CREATED: "RFI aperta", RFI_ANSWERED: "RFI risposta", RFI_MESSAGE_POSTED: "RFI messaggio", RFI_CLOSED: "RFI chiusa",
  GRANT_CREATED: "Condivisione concessa", GRANT_REVOKED: "Condivisione revocata", CONTAINER_CREATED: "Cartella creata",
  CONTAINER_UPDATED: "Cartella modificata", MEMBER_ADDED: "Membro aggiunto", MEMBER_REMOVED: "Membro rimosso",
  ROLE_CREATED: "Ruolo creato", ROLE_UPDATED: "Ruolo modificato", ROLE_DELETED: "Ruolo eliminato",
  ACCESS_REQUESTED: "Richiesta di accesso", ACCESS_GRANTED: "Accesso concesso", ACCESS_REJECTED: "Accesso negato",
  AUDIT_EXPORTED: "Registro esportato", PROJECT_UPDATED: "Commessa modificata", PROJECT_CREATED: "Commessa creata",
  PROJECT_ORGANIZATION_ADDED: "Organizzazione aggiunta", PROJECT_ORGANIZATION_UPDATED: "Organizzazione modificata",
  PROJECT_ORGANIZATION_REMOVED: "Organizzazione rimossa", REVISION_VIEWED: "Visualizzazione", FILE_QUARANTINED: "File in quarantena",
  MARKUP_CREATED: "Annotazione", MARKUP_REPLIED: "Risposta a un'annotazione", MARKUP_RESOLVED: "Annotazione risolta",
  TRANSMITTAL_ISSUED: "Transmittal emesso", TRANSMITTAL_PRINTED: "Transmittal stampato", TRANSMITTAL_ACKNOWLEDGED: "Ricevuta transmittal",
  REPORT_EXPORTED: "Report esportato", WATERMARK_UPDATED: "Impostazioni filigrana",
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
  // Dopo un export si mostrano firma e impronta del file: chi riceve il file le può ricontrollare qui sotto.
  const [ultimoExport, setUltimoExport] = useState<{ signature: string; sha256: string; ext: string } | null>(null);
  const exportCsv = useMutation({
    mutationFn: async (ext: "csv" | "pdf") => {
      const res = await apiDownload(`/projects/${project.id}/audit/export.${ext}${qs ? `?${qs}` : ""}`, `registro.${ext}`);
      const signature = res.headers.get("x-cde-signature") ?? "";
      const sha256 = res.headers.get("x-cde-sha256") ?? "";
      if (signature) setUltimoExport({ signature, sha256, ext });
      return res;
    },
  });
  // Verifica di una firma (anche di un export fatto da altri): firma obbligatoria, SHA-256 del file facoltativo.
  const [firma, setFirma] = useState("");
  const [impronta, setImpronta] = useState("");
  const verificaFirma = useMutation({
    mutationFn: () => api<VerifyExport>(`/projects/${project.id}/audit/export/verify`, {
      method: "POST", json: { signature: firma.trim(), sha256: impronta.trim() || null },
    }),
  });

  if (error) return <Alert severity="warning">{(error as ApiError).message}</Alert>;

  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">
        Ogni azione su documenti, permessi, workflow e RFI resta nel registro. Gli eventi vengono sigillati in una
        catena di hash: qualsiasi modifica successiva è rilevata dalla verifica. Gli export CSV e PDF sono firmati digitalmente.
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
        <Button startIcon={<DownloadIcon />} disabled={exportCsv.isPending} onClick={() => exportCsv.mutate("pdf")}>
          PDF firmato
        </Button>
        <Button variant="contained" startIcon={<DownloadIcon />} disabled={exportCsv.isPending} onClick={() => exportCsv.mutate("csv")}>
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
      {ultimoExport && (
        <Alert severity="info" onClose={() => setUltimoExport(null)}>
          Export {ultimoExport.ext.toUpperCase()} firmato. SHA-256 del file: <code>{ultimoExport.sha256}</code>.
          <Button size="small" sx={{ ml: 1 }} onClick={() => { setFirma(ultimoExport.signature); setImpronta(ultimoExport.sha256); }}>
            Copia nella verifica
          </Button>
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: 1.5 }}>
        <Typography variant="subtitle2" gutterBottom>Verifica una firma</Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={1}>
          Ogni export porta negli header X-CDE-Signature (firma RS256 del server) e X-CDE-SHA256 (impronta del file).
          Incolla la firma e, se hai il file, la sua impronta: si controlla che l'export sia autentico, di questa commessa e non alterato.
        </Typography>
        <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "flex-start" }}>
          <TextField size="small" label="Firma (X-CDE-Signature)" value={firma} onChange={(e) => setFirma(e.target.value)} fullWidth multiline maxRows={3} />
          <TextField size="small" label="SHA-256 del file (facoltativo)" value={impronta} onChange={(e) => setImpronta(e.target.value)} sx={{ minWidth: 300 }} />
          <Button variant="outlined" startIcon={<VerifiedIcon />} disabled={!firma.trim() || verificaFirma.isPending} onClick={() => verificaFirma.mutate()}>Verifica firma</Button>
        </Stack>
        {verificaFirma.data && (
          verificaFirma.data.valid
            ? <Alert severity="success" sx={{ mt: 1 }}>Firma autentica: export del {verificaFirma.data.issued_at ? new Date(verificaFirma.data.issued_at).toLocaleString("it-IT") : "—"},
                {" "}{String(verificaFirma.data.claims?.rows ?? "?")} eventi, catena {verificaFirma.data.claims?.chain_ok ? "integra" : "NON integra"} al momento dell'export
                {verificaFirma.data.file_matches === true ? "; il file corrisponde" : verificaFirma.data.file_matches === false ? "; il file NON corrisponde" : ""}.</Alert>
            : <Alert severity="error" sx={{ mt: 1 }}>{verificaFirma.data.reason === "firma_non_valida" ? "Firma non valida: non è un export emesso da questo server."
                : verificaFirma.data.reason === "altra_commessa" ? "La firma è autentica ma riguarda un'altra commessa."
                : "Il file non corrisponde a quello firmato: è stato modificato o è un altro export."}</Alert>
        )}
        {verificaFirma.error && <Alert severity="error" sx={{ mt: 1 }}>{(verificaFirma.error as ApiError).message}</Alert>}
      </Paper>
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
