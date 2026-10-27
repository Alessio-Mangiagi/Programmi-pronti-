// "><(((º> sabusabu <º)))><"
import { DragEvent, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Drawer, IconButton, InputAdornment,
  LinearProgress, List, ListItem, ListItemText, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow,
  TextField, Tooltip, Typography,
} from "@mui/material";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import DownloadIcon from "@mui/icons-material/Download";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import { api, ApiError, Container, Project } from "../../api";
import { abortUpload, uploadFile } from "../../upload";
import { ACTION_LABEL, CdeState, STATE_COLOR, STATE_LABEL, TransitionDialog, useTransitionRules } from "./Transitions";

export interface DocumentRow {
  id: string;
  current_revision_id: string | null;
  current_state: CdeState | null;
  archived_at: string | null;
  identifier: string;
  title: string;
  originator_code: string;
  current_revision: string | null;
  current_suitability: string | null;
  current_scan_status: string | null;
  current_size: number | null;
  current_revision_at: string | null;
}

interface Revision {
  id: string;
  revision_code: string;
  state: CdeState;
  transition_reason: string | null;
  suitability: string;
  original_filename: string;
  comment: string | null;
  created_at: string;
  created_by_name: string;
  size_bytes: number;
  scan_status: "PENDING" | "CLEAN" | "INFECTED" | "ERROR";
  scan_detail: string | null;
  sha256: string;
}

interface NameCheck {
  valid: boolean;
  identifier: string | null;
  errors: { field: string; label: string; value: string | null; message: string; suggestions: string[] }[];
  existing_document_id?: string | null;
  existing_container_id?: string | null;
  current_revision?: string | null;
  next_revision?: string;
}

const SCAN: Record<string, { label: string; color: "default" | "success" | "error" | "warning" }> = {
  PENDING: { label: "In verifica", color: "warning" },
  CLEAN: { label: "Verificato", color: "success" },
  INFECTED: { label: "Quarantena", color: "error" },
  ERROR: { label: "Integrità KO", color: "error" },
};

export function formatBytes(n: number | null | undefined) {
  if (!n) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function DocumentsPanel({ project, container }: { project: Project; container: Container }) {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const canWrite = container.my_actions.includes("WRITE");

  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const { data } = useQuery({
    queryKey: ["documents", project.id, container.id, search],
    queryFn: () => api<{ items: DocumentRow[] }>(
      `/projects/${project.id}/documents?container_id=${container.id}${search ? `&q=${encodeURIComponent(search)}` : ""}`),
    refetchInterval: (query) => (query.state.data?.items.some((d) => d.current_scan_status === "PENDING") ? 3000 : false),
  });

  return (
    <Paper variant="outlined" sx={{ p: 2, overflowX: "auto" }}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} mb={1}>
        <Typography variant="subtitle1" fontWeight={600} flexGrow={1}>Documenti in "{container.name}"</Typography>
        <TextField size="small" placeholder="Cerca per codice o titolo" value={q} onChange={(e) => setQ(e.target.value)}
                   InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
        {canWrite && <Button variant="contained" startIcon={<CloudUploadIcon />} onClick={() => setUploading(true)}>Carica</Button>}
      </Stack>
      {data?.items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">Nessun documento.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Identificativo</TableCell><TableCell>Titolo</TableCell><TableCell>Rev.</TableCell>
              <TableCell>Idoneità</TableCell><TableCell>File</TableCell><TableCell>Stato</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data?.items.map((d) => (
              <TableRow key={d.id} hover sx={{ cursor: "pointer" }} onClick={() => setOpenDoc(d.id)}>
                <TableCell sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{d.identifier}</TableCell>
                <TableCell>{d.title}</TableCell>
                <TableCell><b>{d.current_revision}</b></TableCell>
                <TableCell>{d.current_suitability}</TableCell>
                <TableCell>{formatBytes(d.current_size)}</TableCell>
                <TableCell>{d.current_scan_status && <Chip size="small" {...SCAN[d.current_scan_status]} />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {uploading && <UploadDialog project={project} container={container} onClose={() => setUploading(false)} />}
      <DocumentDrawer projectId={project.id} documentId={openDoc} onClose={() => setOpenDoc(null)} />
    </Paper>
  );
}

// ---------------------------------------------------------------------
// Upload multiplo con validazione del nome in tempo reale
// ---------------------------------------------------------------------
interface Item {
  file: File;
  check?: NameCheck;
  title: string;
  phase: "check" | "ready" | "uploading" | "done" | "error";
  progress: number;
  message?: string;
  controller?: AbortController;
}

export function UploadDialog({ project, container, onClose }: { project: Project; container: Container; onClose: () => void }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const update = (file: File, patch: Partial<Item>) =>
    setItems((list) => list.map((i) => (i.file === file ? { ...i, ...patch } : i)));

  const addFiles = (files: FileList | File[]) => {
    const added = [...files].filter((f) => !items.some((i) => i.file.name === f.name && i.file.size === f.size));
    setItems((list) => [...list, ...added.map((file) => ({ file, title: "", phase: "check" as const, progress: 0 }))]);
    added.forEach(async (file) => {
      const check: NameCheck = await api<NameCheck>(`/projects/${project.id}/naming/validate`, { method: "POST", json: { name: file.name } })
        .catch((e: ApiError) => ({ valid: false, identifier: null, errors: [{ field: "_", label: "Errore", value: null, message: e.message, suggestions: [] }] }));
      let message: string | undefined;
      if (check.valid && check.existing_container_id && check.existing_container_id !== container.id)
        message = "Documento esistente in un altro container";
      update(file, { check, phase: check.valid && !message ? "ready" : "error", message });
    });
  };

  const start = async (item: Item) => {
    const controller = new AbortController();
    update(item.file, { phase: "uploading", controller, progress: 0, message: undefined });
    try {
      const rev = await uploadFile({
        containerId: container.id, file: item.file, title: item.title || undefined,
        expectedRevision: item.check?.current_revision ?? null, signal: controller.signal,
        onProgress: (phase, f) => update(item.file, { progress: phase === "hash" ? f * 0.1 : 0.1 + f * 0.9,
                                                      message: phase === "hash" ? "Calcolo impronta SHA-256…" : "Caricamento…" }),
      });
      update(item.file, { phase: "done", progress: 1, message: `Revisione ${rev.revision_code} creata` });
      qc.invalidateQueries({ queryKey: ["documents", project.id] });
    } catch (e) {
      if ((e as Error).name === "AbortError") return update(item.file, { phase: "ready", progress: 0, message: "Interrotto: riprenderà da dove si era fermato" });
      update(item.file, { phase: "error", message: (e as Error).message });
    }
  };

  const readyToStart = items.filter((i) => i.phase === "ready" && (i.check?.existing_document_id || i.title.trim()));

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Carica documenti in "{container.name}"</DialogTitle>
      <DialogContent>
        <Box onDragOver={(e: DragEvent) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
             onDrop={(e: DragEvent) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
             onClick={() => input.current?.click()}
             sx={{ border: 2, borderStyle: "dashed", borderColor: drag ? "primary.main" : "divider", borderRadius: 2, p: 4,
                   textAlign: "center", cursor: "pointer", bgcolor: drag ? "action.hover" : "transparent", mb: 2 }}>
          <CloudUploadIcon color="primary" sx={{ fontSize: 40 }} />
          <Typography>Trascina qui i file o fai clic per sceglierli</Typography>
          <Typography variant="caption" color="text.secondary">Il nome del file deve rispettare la naming convention ISO 19650 del progetto</Typography>
          <input ref={input} type="file" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files)} />
        </Box>
        <Stack spacing={1.5}>
          {items.map((item) => (
            <Paper key={item.file.name + item.file.size} variant="outlined" sx={{ p: 1.5 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography fontFamily="monospace" fontSize={14} flexGrow={1} sx={{ wordBreak: "break-all" }}>{item.file.name}</Typography>
                <Typography variant="caption" color="text.secondary">{formatBytes(item.file.size)}</Typography>
                {item.check?.valid && <Chip size="small" color="primary" variant="outlined"
                                            label={`${item.check.current_revision ?? "nuovo"} → ${item.check.next_revision}`} />}
                {item.phase === "uploading"
                  ? <IconButton size="small" onClick={() => item.controller?.abort()}><CloseIcon fontSize="small" /></IconButton>
                  : item.phase !== "done" && <IconButton size="small" onClick={async () => {
                      await abortUpload(item.file);
                      setItems((l) => l.filter((i) => i !== item));
                    }}><CloseIcon fontSize="small" /></IconButton>}
              </Stack>
              {item.check && !item.check.valid && (
                <Stack spacing={0.5} mt={1}>
                  {item.check.errors.map((e) => (
                    <Alert key={e.field} severity="error" sx={{ py: 0 }}>
                      <b>{e.label}</b>{e.value ? ` "${e.value}"` : ""}: {e.message}
                      {e.suggestions.length > 0 && <> — prova: {e.suggestions.map((s) => <Chip key={s} size="small" label={s} sx={{ ml: 0.5 }} />)}</>}
                    </Alert>
                  ))}
                </Stack>
              )}
              {item.phase === "ready" && !item.check?.existing_document_id && (
                <TextField size="small" fullWidth sx={{ mt: 1 }} label="Titolo (nuovo documento)" value={item.title}
                           onChange={(e) => update(item.file, { title: e.target.value })} />
              )}
              {(item.phase === "uploading" || item.phase === "done") && <LinearProgress variant="determinate" value={item.progress * 100} sx={{ mt: 1 }} />}
              {item.message && <Typography variant="caption" color={item.phase === "error" ? "error" : "text.secondary"}>{item.message}</Typography>}
            </Paper>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Chiudi</Button>
        <Button variant="contained" disabled={readyToStart.length === 0} onClick={() => readyToStart.forEach(start)}>
          Carica {readyToStart.length || ""}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Dettaglio documento: revisioni (immutabili), azioni di stato, storico
// ---------------------------------------------------------------------
interface HistoryEntry {
  id: number;
  from_state: CdeState;
  to_state: CdeState;
  from_revision: string | null;
  to_revision: string | null;
  suitability: string | null;
  reason: string | null;
  changed_at: string;
  changed_by_name: string | null;
}

export function DocumentDrawer({ projectId, documentId, onClose }: { projectId: string; documentId: string | null; onClose: () => void }) {
  const [action, setAction] = useState<{ from: CdeState; to: CdeState; revision: Revision } | null>(null);
  const { data: rules = [] } = useTransitionRules(projectId);
  const { data: doc } = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => api<DocumentRow & { description: string | null; revisions: Revision[]; my_actions: string[];
                                       can_download_published: boolean; archive_reason: string | null }>(`/documents/${documentId}`),
    enabled: !!documentId,
    refetchInterval: (query) => (query.state.data?.revisions.some((r) => r.scan_status === "PENDING") ? 3000 : false),
  });
  const { data: history = [] } = useQuery({
    queryKey: ["document", documentId, "history"],
    queryFn: () => api<HistoryEntry[]>(`/documents/${documentId}/history`),
    enabled: !!documentId,
  });
  const download = useMutation({
    mutationFn: (revisionId: string) => api<{ url: string }>(`/revisions/${revisionId}/download`),
    onSuccess: ({ url }) => { window.location.href = url; },
  });

  const canDownload = (r: Revision) =>
    r.state === "PUBLISHED" ? doc?.can_download_published : doc?.my_actions.includes("DOWNLOAD");
  // azioni proposte sull'ultima revisione di ciascuno stato (il server ricontrolla tutto)
  const latestOf = (state: CdeState) => doc?.revisions.find((r) => r.state === state);
  const actions = doc && !doc.archived_at
    ? rules.filter((rule) => latestOf(rule.from_state)).map((rule) => ({ rule, revision: latestOf(rule.from_state)! }))
    : [];

  return (
    <Drawer anchor="right" open={!!documentId} onClose={onClose} PaperProps={{ sx: { width: { xs: "100%", sm: 520 }, p: 2 } }}>
      {doc && (
        <Stack spacing={2}>
          <Stack direction="row" alignItems="center">
            <Typography variant="overline" flexGrow={1} fontFamily="monospace">{doc.identifier}</Typography>
            <IconButton onClick={onClose}><CloseIcon /></IconButton>
          </Stack>
          <Typography variant="h6">{doc.title}</Typography>
          {doc.description && <Typography variant="body2">{doc.description}</Typography>}
          <Typography variant="body2" color="text.secondary">Originatore: {doc.originator_code}</Typography>
          {doc.archived_at && <Alert severity="info">Archiviato il {new Date(doc.archived_at).toLocaleDateString("it-IT")}: {doc.archive_reason}</Alert>}
          {download.error && <Alert severity="error">{(download.error as ApiError).message}</Alert>}
          {actions.length > 0 && (
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {actions.map(({ rule, revision }) => (
                <Button key={`${rule.from_state}-${rule.to_state}`} size="small" variant="outlined"
                        disabled={rule.to_state !== "ARCHIVED" && revision.scan_status !== "CLEAN"}
                        onClick={() => setAction({ from: rule.from_state, to: rule.to_state, revision })}>
                  {ACTION_LABEL[rule.to_state]} {revision.revision_code}
                </Button>
              ))}
            </Stack>
          )}
          <Typography variant="subtitle2">Revisioni (immutabili)</Typography>
          <List dense disablePadding>
            {doc.revisions.map((r) => (
              <ListItem key={r.id} divider secondaryAction={canDownload(r) && (
                <Tooltip title={r.scan_status === "CLEAN" ? "Scarica" : SCAN[r.scan_status].label}>
                  <span>
                    <IconButton edge="end" disabled={r.scan_status !== "CLEAN"} onClick={() => download.mutate(r.id)}><DownloadIcon /></IconButton>
                  </span>
                </Tooltip>
              )}>
                <ListItemText
                  primary={<Stack direction="row" spacing={1} alignItems="center">
                    <b>{r.revision_code}</b><span>{r.suitability}</span>
                    <Chip size="small" color={STATE_COLOR[r.state]} label={STATE_LABEL[r.state]} />
                    {r.scan_status !== "CLEAN" && <Chip size="small" {...SCAN[r.scan_status]} />}
                  </Stack>}
                  secondary={<>
                    {new Date(r.created_at).toLocaleString("it-IT")} · {r.created_by_name} · {formatBytes(r.size_bytes)}
                    <br /><span style={{ fontFamily: "monospace", fontSize: 11 }}>SHA-256 {r.sha256.slice(0, 16)}…</span>
                    {r.transition_reason && <><br />Motivazione: {r.transition_reason}</>}
                    {r.scan_status !== "CLEAN" && r.scan_detail && <><br />{r.scan_detail}</>}
                  </>} />
              </ListItem>
            ))}
          </List>
          {history.length > 0 && (
            <>
              <Typography variant="subtitle2">Storico stati</Typography>
              <List dense disablePadding>
                {history.map((h) => (
                  <ListItem key={h.id} divider>
                    <ListItemText
                      primary={`${STATE_LABEL[h.from_state]} → ${STATE_LABEL[h.to_state]}${h.to_revision ? ` (${h.from_revision} → ${h.to_revision} ${h.suitability ?? ""})` : ""}`}
                      secondary={`${new Date(h.changed_at).toLocaleString("it-IT")} · ${h.changed_by_name ?? ""}${h.reason ? ` · ${h.reason}` : ""}`} />
                  </ListItem>
                ))}
              </List>
            </>
          )}
        </Stack>
      )}
      {action && (
        <TransitionDialog projectId={projectId} from={action.from} to={action.to}
                          revisions={[{ id: action.revision.id, label: `${doc?.identifier} ${action.revision.revision_code}` }]}
                          onClose={() => setAction(null)} />
      )}
    </Drawer>
  );
}
