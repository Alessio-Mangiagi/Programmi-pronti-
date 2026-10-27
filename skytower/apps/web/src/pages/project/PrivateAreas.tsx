// "><(((º> sabusabu <º)))><"
// Aree riservate della commessa: chi non è admin le vede chiuse e chiede l'accesso; l'admin decide
// (accesso personale, anche a scadenza) e crea nuove aree.
import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Card, CardActions, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControlLabel, FormGroup, Grid, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import FolderSpecialIcon from "@mui/icons-material/FolderSpecial";
import LockIcon from "@mui/icons-material/Lock";
import { AccessRequest, Action, api, ApiError, PrivateArea, Project } from "../../api";
import { usePrivateAreas } from "../../components/ProjectTree";

const ACTION_LABEL: Partial<Record<Action, string>> = { READ: "Lettura", DOWNLOAD: "Download", WRITE: "Scrittura", APPROVE: "Approvazione" };
const STATUS: Record<AccessRequest["status"], { label: string; color: "warning" | "success" | "error" | "default" }> = {
  PENDING: { label: "In attesa", color: "warning" },
  APPROVED: { label: "Approvata", color: "success" },
  REJECTED: { label: "Rifiutata", color: "error" },
  CANCELLED: { label: "Annullata", color: "default" },
};

const toIso = (date: string) => (date ? new Date(`${date}T23:59:59`).toISOString() : null);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("it-IT") : "senza scadenza");

export function PrivateAreasTab({ project }: { project: Project }) {
  const qc = useQueryClient();
  const { data: areas = [], isLoading } = usePrivateAreas(project.id);
  const { data: requests = [] } = useQuery({
    queryKey: ["access-requests", project.id],
    queryFn: () => api<AccessRequest[]>(`/projects/${project.id}/access-requests`),
  });
  const [asking, setAsking] = useState<PrivateArea | null>(null);
  const [deciding, setDeciding] = useState<AccessRequest | null>(null);
  const [creating, setCreating] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["private-areas", project.id] });
    qc.invalidateQueries({ queryKey: ["access-requests", project.id] });
    qc.invalidateQueries({ queryKey: ["containers", project.id] });
  };
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/access-requests/${id}/cancel`, { method: "POST" }),
    onSuccess: refresh,
  });
  const isAdmin = !!project.my_permissions?.ADMIN?.PROJECT || !!project.my_permissions?.ADMIN?.OWN_ORGANIZATION;
  const toDecide = requests.filter((r) => r.can_decide && r.status === "PENDING");

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <Typography variant="body2" color="text.secondary" flexGrow={1}>
          Le aree riservate sono accessibili solo agli amministratori. Gli altri membri della commessa le vedono chiuse
          e possono chiedere l'accesso: decide un amministratore, anche con una scadenza.
        </Typography>
        {isAdmin && <Button variant="contained" startIcon={<AddIcon />} sx={{ flexShrink: 0, whiteSpace: "nowrap" }}
                            onClick={() => setCreating(true)}>Nuova area riservata</Button>}
      </Stack>

      {toDecide.length > 0 && (
        <Paper variant="outlined" sx={{ p: 2, borderColor: "warning.main" }}>
          <Typography fontWeight={600} mb={1}>Richieste da decidere ({toDecide.length})</Typography>
          <Stack spacing={1}>
            {toDecide.map((r) => (
              <Stack key={r.id} direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}
                     p={1.25} border={1} borderColor="divider" borderRadius={2}>
                <Box flexGrow={1}>
                  <Typography variant="body2"><b>{r.requester_name}</b> ({r.requester_org_code}) chiede {r.actions.map((a) => ACTION_LABEL[a]).join(", ").toLowerCase()} su <b>{r.container_name}</b></Typography>
                  <Typography variant="body2" color="text.secondary">“{r.reason}” · fino a: {fmt(r.valid_until)}</Typography>
                </Box>
                <Button variant="contained" size="small" onClick={() => setDeciding(r)}>Decidi</Button>
              </Stack>
            ))}
          </Stack>
        </Paper>
      )}

      {!isLoading && areas.length === 0 && <Alert severity="info">Nessuna area riservata in questa commessa.</Alert>}
      <Grid container spacing={2}>
        {areas.map((a) => (
          <Grid item xs={12} sm={6} lg={4} key={a.id}>
            <Card variant="outlined" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
              <CardContent sx={{ flexGrow: 1 }}>
                <Stack direction="row" spacing={1} alignItems="center" mb={1}>
                  {a.has_access ? <FolderSpecialIcon sx={{ color: "#7a4fb5" }} /> : <LockIcon color="action" />}
                  <Typography fontWeight={600} flexGrow={1}>{a.name}</Typography>
                  <Chip size="small" variant="outlined" label={a.owner_organization_code} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  {a.is_admin ? "Ne sei amministratore." : a.has_access ? "Hai accesso." : "Accesso chiuso."}
                  {a.is_admin && !!a.pending_requests && ` ${a.pending_requests} richieste in attesa.`}
                </Typography>
                {!a.has_access && a.request_status && a.request_status !== "PENDING" && (
                  <Typography variant="body2" mt={1}>Ultima richiesta: <Chip size="small" {...STATUS[a.request_status]} /></Typography>
                )}
              </CardContent>
              <CardActions>
                {a.has_access && (
                  <Button component={RouterLink} to={`/progetti/${project.id}/cartelle/${a.id}`}>Apri</Button>
                )}
                {!a.has_access && a.request_status === "PENDING" && (
                  <>
                    <Chip size="small" color="warning" label="Richiesta inviata" sx={{ mx: 1 }} />
                    <Button size="small" color="inherit" disabled={cancel.isPending}
                            onClick={() => a.request_id && cancel.mutate(a.request_id)}>Annulla richiesta</Button>
                  </>
                )}
                {!a.has_access && a.request_status !== "PENDING" && (
                  <Button variant="outlined" startIcon={<LockIcon />} onClick={() => setAsking(a)}>Richiedi accesso</Button>
                )}
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {requests.length > 0 && (
        <Paper variant="outlined" sx={{ overflowX: "auto" }}>
          <Typography fontWeight={600} px={2} pt={1.5}>Storico richieste</Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Data</TableCell><TableCell>Richiedente</TableCell><TableCell>Area</TableCell>
                <TableCell>Accesso</TableCell><TableCell>Stato</TableCell><TableCell>Decisione</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {requests.map((r) => (
                <TableRow key={r.id}>
                  <TableCell sx={{ whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleDateString("it-IT")}</TableCell>
                  <TableCell>{r.requester_name} <Typography component="span" variant="caption" color="text.secondary">{r.requester_org_code}</Typography></TableCell>
                  <TableCell>{r.container_name}</TableCell>
                  <TableCell>{r.actions.map((a) => ACTION_LABEL[a]).join(", ")} · {fmt(r.valid_until)}</TableCell>
                  <TableCell><Chip size="small" {...STATUS[r.status]} /></TableCell>
                  <TableCell>{r.decided_by_name ? `${r.decided_by_name}${r.decision_note ? `: ${r.decision_note}` : ""}` : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      {asking && <RequestDialog area={asking} onClose={() => setAsking(null)} onDone={refresh} />}
      {deciding && <DecisionDialog request={deciding} onClose={() => setDeciding(null)} onDone={refresh} />}
      {creating && <NewAreaDialog project={project} onClose={() => setCreating(false)} onDone={refresh} />}
    </Stack>
  );
}

function ActionsPicker({ value, onChange }: { value: Action[]; onChange: (v: Action[]) => void }) {
  return (
    <FormGroup row>
      {(["READ", "DOWNLOAD", "WRITE"] as Action[]).map((a) => (
        <FormControlLabel key={a} label={ACTION_LABEL[a]} control={
          <Checkbox checked={value.includes(a)} disabled={a === "READ"}
                    onChange={(e) => onChange(e.target.checked ? [...value, a] : value.filter((x) => x !== a))} />
        } />
      ))}
    </FormGroup>
  );
}

function RequestDialog({ area, onClose, onDone }: { area: PrivateArea; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [actions, setActions] = useState<Action[]>(["READ", "DOWNLOAD"]);
  const [until, setUntil] = useState("");
  const send = useMutation({
    mutationFn: () => api(`/containers/${area.id}/access-requests`, {
      method: "POST", json: { reason, actions, valid_until: toIso(until) },
    }),
    onSuccess: () => { onDone(); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Richiedi accesso a “{area.name}”</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {send.error && <Alert severity="error">{(send.error as ApiError).message}</Alert>}
          <TextField label="Motivazione" multiline minRows={3} value={reason} onChange={(e) => setReason(e.target.value)}
                     helperText="La leggono gli amministratori dell'area" autoFocus />
          <Box>
            <Typography variant="body2" color="text.secondary">Accesso richiesto</Typography>
            <ActionsPicker value={actions} onChange={setActions} />
          </Box>
          <TextField type="date" label="Fino al (facoltativo)" value={until} onChange={(e) => setUntil(e.target.value)}
                     InputLabelProps={{ shrink: true }} inputProps={{ min: new Date().toISOString().slice(0, 10) }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={reason.trim().length < 3 || send.isPending} onClick={() => send.mutate()}>Invia richiesta</Button>
      </DialogActions>
    </Dialog>
  );
}

function DecisionDialog({ request, onClose, onDone }: { request: AccessRequest; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [actions, setActions] = useState<Action[]>(request.actions);
  const [until, setUntil] = useState(request.valid_until?.slice(0, 10) ?? "");
  const decide = useMutation({
    mutationFn: (approve: boolean) => api(`/access-requests/${request.id}/decide`, {
      method: "POST", json: { approve, note: note || null, valid_until: approve ? toIso(until) : null, actions: approve ? actions : null },
    }),
    onSuccess: () => { onDone(); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Richiesta di {request.requester_name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {decide.error && <Alert severity="error">{(decide.error as ApiError).message}</Alert>}
          <Typography variant="body2">
            Area <b>{request.container_name}</b> · {request.requester_email} ({request.requester_org_code})
          </Typography>
          <Alert severity="info" icon={false}>“{request.reason}”</Alert>
          <Box>
            <Typography variant="body2" color="text.secondary">Accesso da concedere</Typography>
            <ActionsPicker value={actions} onChange={setActions} />
          </Box>
          <TextField type="date" label="Valido fino al" value={until} onChange={(e) => setUntil(e.target.value)}
                     InputLabelProps={{ shrink: true }} helperText="Vuoto: senza scadenza (revocabile dalla cartella, Accessi)"
                     inputProps={{ min: new Date().toISOString().slice(0, 10) }} />
          <TextField label="Nota per il richiedente" value={note} onChange={(e) => setNote(e.target.value)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Chiudi</Button>
        <Button color="error" disabled={decide.isPending} onClick={() => decide.mutate(false)}>Rifiuta</Button>
        <Button variant="contained" disabled={decide.isPending} onClick={() => decide.mutate(true)}>Approva</Button>
      </DialogActions>
    </Dialog>
  );
}

function NewAreaDialog({ project, onClose, onDone }: { project: Project; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api(`/projects/${project.id}/containers`, { method: "POST", json: { name, is_private: true } }),
    onSuccess: () => { onDone(); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Nuova area riservata</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {create.error && <Alert severity="error">{(create.error as ApiError).message}</Alert>}
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} autoFocus
                     helperText="Le sottocartelle che ci crei restano riservate" />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Crea</Button>
      </DialogActions>
    </Dialog>
  );
}
