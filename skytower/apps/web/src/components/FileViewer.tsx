// "><(((º> sabusabu <º)))><"
// Lettura di un documento in piattaforma su URL firmato a scadenza: PDF con PDF.js (pagine su canvas e
// annotazioni sovrapposte) oppure nel visualizzatore del browser (ricerca, stampa); immagini con
// annotazioni; modelli IFC in 3D con annotazioni sugli elementi; testo nel browser, modificabile: il salvataggio
// crea una nuova revisione con il normale caricamento (impronta, antivirus, controllo di concorrenza). Gli altri formati si scaricano. Le annotazioni stanno nel pannello a destra.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, AppBar, Badge, Box, Button, CircularProgress, Dialog, IconButton, MenuItem, Stack, TextField, ToggleButton,
  Toolbar, Tooltip, Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import CommentIcon from "@mui/icons-material/Comment";
import DownloadIcon from "@mui/icons-material/Download";
import DrawIcon from "@mui/icons-material/Draw";
import EditIcon from "@mui/icons-material/Edit";
import InfoIcon from "@mui/icons-material/Info";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import { api, ApiError, type Draft, type Markup } from "../api";
import { MarkupLayer } from "./markup/MarkupLayer";
import { MarkupPanel } from "./markup/MarkupPanel";
import { uploadFile } from "../upload";

const PdfView = lazy(() => import("./markup/PdfView"));
const IfcView = lazy(() => import("./markup/IfcView"));

interface Rev { id: string; revision_code: string; suitability: string; state: string; original_filename: string; scan_status: string }
interface Doc { id: string; identifier: string; title: string; container_id: string; my_actions: string[]; revisions: Rev[] }
interface Link { url: string; filename: string; content_type: string | null }

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export function FileViewer({ documentId, revisionId: initialRevision, taskId, onClose, onDetails }: {
  documentId: string; revisionId?: string; taskId?: string; onClose: () => void; onDetails?: () => void;
}) {
  const { data: doc } = useQuery({
    queryKey: ["document", documentId], queryFn: () => api<Doc>(`/documents/${documentId}`),
    // revisione appena caricata (anche da "Modifica"): si ricontrolla finché l'antivirus non ha finito
    refetchInterval: (q) => (q.state.data?.revisions.some((r) => r.scan_status === "PENDING") ? 2000 : false),
  });
  const [revisionId, setRevisionId] = useState<string | null>(initialRevision ?? null);
  useEffect(() => { if (doc && !revisionId) setRevisionId(doc.revisions[0]?.id ?? null); }, [doc, revisionId]);
  const rev = doc?.revisions.find((r) => r.id === revisionId);

  const { data: link, error, isFetching } = useQuery({
    queryKey: ["view-link", revisionId],
    queryFn: () => api<Link>(`/revisions/${revisionId}/download?disposition=inline`),
    enabled: !!revisionId && rev?.scan_status === "CLEAN",
    staleTime: 4 * 60_000,          // l'URL firmato vale 5'
    retry: false,
  });
  const [compareId, setCompareId] = useState("");
  const { data: compareLink } = useQuery({
    queryKey: ["view-link", compareId],
    queryFn: () => api<Link>(`/revisions/${compareId}/download?disposition=inline`),
    enabled: !!compareId,
    staleTime: 4 * 60_000,
    retry: false,
  });
  const { data: markups = [] } = useQuery({
    queryKey: ["markups", revisionId],
    queryFn: () => api<Markup[]>(`/revisions/${revisionId}/markups`),
    enabled: !!revisionId,
  });
  const download = useMutation({
    mutationFn: () => api<{ url: string }>(`/revisions/${revisionId}/download`),
    onSuccess: ({ url }) => { window.location.href = url; },
  });
  const notViewable = (error as ApiError | null)?.status === 415;

  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState(true);
  const [browserPdf, setBrowserPdf] = useState(false);
  const [zoom, setZoom] = useState(1.25);
  const [pages, setPages] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusPage, setFocusPage] = useState<{ page: number; seq: number } | null>(null);
  useEffect(() => { setDraft(null); setSelectedId(null); setDrawing(false); setCompareId(""); setEditing(false); }, [revisionId]);

  // numerazione stabile per data di creazione, indipendente dai filtri
  const numbers = useMemo(() => new Map([...markups].sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m, i) => [m.id, i + 1])), [markups]);
  const isPdf = link?.content_type === "application/pdf";
  const isImage = !!link?.content_type?.startsWith("image/");
  const isIfc = link?.content_type === "application/x-step";
  const canDraw = (isPdf && !browserPdf) || isImage || isIfc;
  const isText = !!link?.content_type?.startsWith("text/plain");
  const canEdit = isText && !!doc && doc.my_actions.includes("WRITE") && doc.revisions[0]?.id === revisionId;
  const fill = (isPdf && !browserPdf) || isIfc;
  const selectedRef = markups.find((m) => m.id === selectedId)?.element_ref ?? null;
  const openCount = markups.filter((m) => m.status === "OPEN").length;

  const layer = (page: number) => (
    <MarkupLayer page={page} markups={markups} numbers={numbers} selectedId={selectedId} drawing={drawing}
                 draft={draft && "page" in draft ? draft : null} onDraw={(a) => { setDraft(a); setDrawing(false); setPanel(true); }} onSelect={setSelectedId} />
  );
  const step = (dir: 1 | -1) => setZoom((z) => (dir > 0
    ? ZOOMS.find((x) => x > z + 0.001) ?? ZOOMS[ZOOMS.length - 1]
    : [...ZOOMS].reverse().find((x) => x < z - 0.001) ?? ZOOMS[0]));

  return (
    <Dialog open fullScreen onClose={onClose} aria-label="Visualizzatore documento">
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ gap: 1, flexWrap: "wrap", py: 0.5 }}>
          <Box flexGrow={1} minWidth={0}>
            <Typography fontWeight={600} noWrap>{doc?.title ?? "…"}</Typography>
            <Typography variant="caption" fontFamily="monospace" color="text.secondary" noWrap>{doc?.identifier}</Typography>
          </Box>
          {doc && doc.revisions.length > 0 && (
            <TextField select size="small" label="Revisione" value={revisionId ?? ""} sx={{ minWidth: 200 }}
                       onChange={(e) => setRevisionId(e.target.value)}>
              {doc.revisions.map((r) => (
                <MenuItem key={r.id} value={r.id}>{r.revision_code} · {r.suitability} · {r.state}</MenuItem>
              ))}
            </TextField>
          )}
          {isPdf && !browserPdf && (
            <Stack direction="row" alignItems="center">
              <IconButton aria-label="Riduci" disabled={zoom <= ZOOMS[0]} onClick={() => step(-1)}><ZoomOutIcon /></IconButton>
              <Typography variant="body2" width={44} textAlign="center">{Math.round(zoom * 100)}%</Typography>
              <IconButton aria-label="Ingrandisci" disabled={zoom >= ZOOMS[ZOOMS.length - 1]} onClick={() => step(1)}><ZoomInIcon /></IconButton>
              {pages > 0 && <Typography variant="caption" color="text.secondary" ml={0.5}>{pages} pag.</Typography>}
            </Stack>
          )}
          {isPdf && !browserPdf && doc && doc.revisions.length > 1 && (
            <TextField select size="small" label="Confronta con" value={compareId} sx={{ minWidth: 170 }}
                       onChange={(e) => setCompareId(e.target.value)}>
              <MenuItem value="">Nessun confronto</MenuItem>
              {doc.revisions.filter((r) => r.id !== revisionId && r.scan_status === "CLEAN").map((r) => (
                <MenuItem key={r.id} value={r.id}>{r.revision_code} · {r.state}</MenuItem>
              ))}
            </TextField>
          )}
          {isPdf && (
            <Tooltip title="Il visualizzatore del browser permette ricerca nel testo e stampa, senza annotazioni">
              <ToggleButton size="small" value="browser" selected={browserPdf} onChange={() => { setBrowserPdf((b) => !b); setDrawing(false); }}>
                Visualizzatore del browser
              </ToggleButton>
            </Tooltip>
          )}
          {canEdit && !editing && <Button startIcon={<EditIcon />} onClick={() => setEditing(true)}>Modifica</Button>}
          {canDraw && (
            <ToggleButton size="small" value="draw" selected={drawing} color="primary" onChange={() => setDrawing((d) => !d)}>
              <DrawIcon fontSize="small" sx={{ mr: 0.5 }} />Annota
            </ToggleButton>
          )}
          <ToggleButton size="small" value="panel" selected={panel} onChange={() => setPanel((p) => !p)} aria-label="Annotazioni">
            <Badge badgeContent={openCount} color="error"><CommentIcon fontSize="small" /></Badge>
          </ToggleButton>
          <Button startIcon={<DownloadIcon />} disabled={!revisionId || rev?.scan_status !== "CLEAN" || download.isPending}
                  onClick={() => download.mutate()}>Scarica</Button>
          {onDetails && <Button startIcon={<InfoIcon />} onClick={onDetails}>Dettagli e cronologia</Button>}
          <IconButton aria-label="Chiudi" onClick={onClose}><CloseIcon /></IconButton>
        </Toolbar>
      </AppBar>
      <Box display="flex" flexGrow={1} minHeight={0}>
        <Box flexGrow={1} bgcolor="#525659" overflow="auto" minWidth={0} display="flex" flexDirection="column"
             alignItems={fill ? "stretch" : "center"} justifyContent={fill ? "flex-start" : "center"}>
          {rev && rev.scan_status !== "CLEAN" && (
            <Alert severity={rev.scan_status === "PENDING" ? "info" : "error"}>
              {rev.scan_status === "PENDING" ? "Verifica antivirus in corso: riprova tra poco." : "File in quarantena: non visualizzabile."}
            </Alert>
          )}
          {isFetching && !link && <CircularProgress sx={{ color: "#fff" }} />}
          {notViewable && (
            <Stack alignItems="center" spacing={2} p={3} bgcolor="background.paper" borderRadius={2}>
              <Typography>{rev?.original_filename}: questo formato non si apre nel browser.</Typography>
              <Typography variant="body2" color="text.secondary">Puoi comunque lasciare commenti generali nel pannello a destra.</Typography>
              <Button variant="contained" startIcon={<DownloadIcon />} onClick={() => download.mutate()}>Scarica il file</Button>
            </Stack>
          )}
          {error && !notViewable && <Alert severity="error">{(error as ApiError).message}</Alert>}
          {download.error && <Alert severity="error">{(download.error as ApiError).message}</Alert>}
          {link && !error && (editing && doc && rev ? (
            <TextEditor url={link.url} doc={doc} rev={rev} onCancel={() => setEditing(false)}
                        onSaved={(id) => { setEditing(false); setRevisionId(id); }} />
          ) : isPdf && !browserPdf ? (
            <Suspense fallback={<CircularProgress sx={{ color: "#fff", m: "auto" }} />}>
              <PdfView key={link.url} url={link.url}
                       onFit={(z) => setZoom(Math.min(1.5, Math.max(ZOOMS[0], Math.round(z * 100) / 100)))} compareUrl={compareId ? compareLink?.url ?? null : null} zoom={zoom} focusPage={focusPage} onPages={setPages} overlay={layer} />
            </Suspense>
          ) : isIfc ? (
            <Suspense fallback={<CircularProgress sx={{ color: "#fff", m: "auto" }} />}>
              <IfcView url={link.url} markups={markups} selectedRef={selectedRef} drawing={drawing} onSelectMarkup={setSelectedId}
                       onPick={(e) => { setDraft({ element_ref: e.guid, label: e.label }); setDrawing(false); setPanel(true); }} />
            </Suspense>
          ) : isImage ? (
            <Box sx={{ position: "relative", display: "inline-block", maxWidth: "100%", maxHeight: "100%", m: 2 }}>
              <Box component="img" src={link.url} alt={doc?.title} draggable={false}
                   sx={{ display: "block", maxWidth: "100%", maxHeight: "calc(100vh - 120px)", bgcolor: "#fff" }} />
              {layer(1)}
            </Box>
          ) : (
            <Box component="iframe" src={link.url} title={doc?.title ?? "Documento"} sx={{ border: 0, width: "100%", flexGrow: 1, alignSelf: "stretch", bgcolor: "#fff" }} />
          ))}
        </Box>
        {panel && revisionId && (
          <Box width={{ xs: "100%", sm: 360 }} flexShrink={0} borderLeft={1} borderColor="divider" bgcolor="background.paper"
               position={{ xs: "absolute", sm: "static" }} top={{ xs: 64 }} bottom={0} right={0} zIndex={1}>
            <MarkupPanel revisionId={revisionId} taskId={taskId} markups={markups} numbers={numbers} selectedId={selectedId}
                         draft={draft} onClearDraft={() => setDraft(null)}
                         onSelect={(m) => { setSelectedId(m.id); if (m.page) setFocusPage({ page: m.page, seq: Date.now() }); }} />
          </Box>
        )}
      </Box>
    </Dialog>
  );
}

function TextEditor({ url, doc, rev, onCancel, onSaved }: {
  url: string; doc: Doc; rev: Rev; onCancel: () => void; onSaved: (revisionId: string) => void;
}) {
  const qc = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const [original, setOriginal] = useState("");
  const [comment, setComment] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    fetch(url).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((t) => { setText(t); setOriginal(t); }).catch((e: Error) => setLoadError(e.message));
  }, [url]);
  const save = useMutation({
    mutationFn: () => uploadFile({
      containerId: doc.container_id, comment: comment.trim() || "Modifica in piattaforma",
      file: new File([text ?? ""], rev.original_filename, { type: "text/plain" }),
      expectedRevision: rev.revision_code,
    }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["document", doc.id] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      onSaved(r.id);
    },
  });
  if (loadError) return <Alert severity="error" sx={{ m: 3 }}>File non leggibile: {loadError}</Alert>;
  if (text === null) return <CircularProgress sx={{ color: "#fff", m: "auto" }} />;
  return (
    <Stack flexGrow={1} alignSelf="stretch" bgcolor="background.paper" minHeight={0}>
      <Stack direction="row" gap={1} p={1} alignItems="center" borderBottom={1} borderColor="divider" flexWrap="wrap">
        <TextField size="small" placeholder="Cosa è cambiato (facoltativo)" value={comment} onChange={(e) => setComment(e.target.value)}
                   sx={{ flexGrow: 1, minWidth: 220 }} inputProps={{ maxLength: 500 }} />
        <Button onClick={onCancel} disabled={save.isPending}>Annulla</Button>
        <Button variant="contained" disabled={save.isPending || text === original} onClick={() => save.mutate()}>
          {save.isPending ? "Salvataggio…" : "Salva come nuova revisione"}
        </Button>
      </Stack>
      {save.error && <Alert severity="error" sx={{ m: 1 }}>{(save.error as ApiError).message}</Alert>}
      <Box component="textarea" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false}
           aria-label="Contenuto del file"
           sx={{ flexGrow: 1, border: 0, outline: 0, resize: "none", p: 2, fontFamily: "ui-monospace, Consolas, monospace",
                 fontSize: 14, lineHeight: 1.5, bgcolor: "background.paper", color: "text.primary" }} />
    </Stack>
  );
}
