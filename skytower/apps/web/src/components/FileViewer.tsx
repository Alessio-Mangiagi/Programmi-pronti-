// "><(((º> sabusabu <º)))><"
// Lettura di un documento in piattaforma su URL firmato a scadenza: PDF con PDF.js (pagine su canvas e
// annotazioni sovrapposte) oppure nel visualizzatore del browser (ricerca, stampa); immagini con
// annotazioni; modelli IFC e glTF/GLB (Blender) in 3D con annotazioni sugli elementi (gli IFC pesanti nella
// versione .glb preparata dal worker, ADR-31, con l'originale a un clic); disegni CAD (DWG/DXF) nell'SVG preparato
// dal worker, con layer e misure (ADR-41); Word ed Excel in anteprima di sola lettura;
// PDF firmati in busta .p7m: si legge il documento contenuto, con il badge della verifica della firma (ADR-55);
// "Timbra" sui PDF: timbri (firma, logo, «Approvato») messi sulle pagine e salvati come nuova revisione WIP (ADR-56);
// testo nel browser, modificabile: il salvataggio
// crea una nuova revisione con il normale caricamento (impronta, antivirus, controllo di concorrenza). Gli altri formati si scaricano. Le annotazioni stanno nel pannello a destra.
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, AppBar, Badge, Box, Button, Chip, CircularProgress, Dialog, IconButton, InputAdornment, MenuItem, Stack, TextField,
  ToggleButton, Toolbar, Tooltip, Typography,
} from "@mui/material";
import ApprovalIcon from "@mui/icons-material/Approval";
import CloseIcon from "@mui/icons-material/Close";
import CommentIcon from "@mui/icons-material/Comment";
import DownloadIcon from "@mui/icons-material/Download";
import DrawIcon from "@mui/icons-material/Draw";
import EditIcon from "@mui/icons-material/Edit";
import InfoIcon from "@mui/icons-material/Info";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import SearchIcon from "@mui/icons-material/Search";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import { api, ApiError, type Draft, type Markup } from "../api";
import { MarkupLayer } from "./markup/MarkupLayer";
import { MarkupPanel } from "./markup/MarkupPanel";
import { uploadFile } from "../upload";
import { openDocument } from "../openDocument";
import { FirmaBadge, type FirmaInfo } from "./FirmaDigitale";
import { TimbraLayer, type Piazzamento } from "./timbri/TimbraLayer";
import { TimbraPanel } from "./timbri/TimbraPanel";
import type { Timbro } from "./timbri/timbri";
import { useAuth } from "../auth";
import type { ModelPart } from "./markup/model3d";
import type { DxfLayer } from "./markup/DxfView";

const PdfView = lazy(() => import("./markup/PdfView"));
const DxfView = lazy(() => import("./markup/DxfView"));
const ModelView = lazy(() => import("./markup/ModelView"));
const OfficeView = lazy(() => import("./OfficeView"));
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// l'anteprima Office si converte nella pagina: oltre questa soglia (o con file compressi ostili) la bloccherebbe
const OFFICE_PREVIEW_MAX = 25 * 1024 * 1024;

interface Rev { id: string; revision_code: string; suitability: string; state: string; original_filename: string; scan_status: string; size_bytes: number }
interface Doc { id: string; project_id: string; identifier: string; title: string; container_id: string; my_actions: string[]; revisions: Rev[] }
/** derivato per il viewer: .glb di un IFC pesante (con `parts` diviso per piano: indice in `url`, piani dal più
 * basso) oppure SVG di un disegno CAD (con `layers`; `detail` spiega un errore, es. ODA File Converter assente) */
interface Derivative {
  status: "READY" | "PENDING" | "FAILED"; url: string | null; size_bytes: number | null;
  parts?: ModelPart[] | null;
  layers?: DxfLayer[] | null;
  detail?: string | null;
}
/** `firma`: solo per le buste .p7m (ADR-55). Busta aperta: `url`/`content_type` sono del documento contenuto;
 * altrimenti content_type = application/pkcs7-mime e `url` scarica il file firmato. */
interface Link { url: string; filename: string; content_type: string | null; watermark?: boolean; derivative?: Derivative | null;
                 firma?: FirmaInfo | null }

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];


export function FileViewer({ documentId, revisionId: initialRevision, taskId, initialSearch, onClose, onDetails }: {
  documentId: string; revisionId?: string; taskId?: string; onClose: () => void; onDetails?: () => void;
  /** testo da cercare ed evidenziare subito nel PDF (es. l'elemento del modello che la tavola cita) */
  initialSearch?: string;
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
    // busta firmata appena caricata: il worker la sta aprendo, si ricontrolla finché il documento è pronto
    refetchInterval: (q) => (q.state.data?.firma?.stato === "PENDING" ? 3000 : false),
  });
  // Il link filigranato in cache può essere già esaurito (ticket a usi contati, ADR-49 B6): se il PDF risponde 401
  // ("Link già usato" o scaduto) si scarta il link dalla cache e se ne chiede uno nuovo, una volta sola per revisione.
  const qc = useQueryClient();
  const [relinked, setRelinked] = useState<string | null>(null);
  const onPdfError = (status: number | null) => {
    if (status !== 401 || !revisionId || relinked === revisionId) return;
    setRelinked(revisionId);
    qc.resetQueries({ queryKey: ["view-link", revisionId], exact: true });
  };
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
  const { data: officeConfig } = useQuery({         // OnlyOffice attivo in questa installazione (ADR-37)
    queryKey: ["office-config"],
    queryFn: () => api<{ enabled: boolean }>("/office/config"),
    staleTime: 10 * 60_000,
  });
  const download = useMutation({
    mutationFn: () => api<{ url: string }>(`/revisions/${revisionId}/download`),
    onSuccess: ({ url }) => { window.location.href = url; },
  });
  const notViewable = (error as ApiError | null)?.status === 415;

  const [editing, setEditing] = useState(false);
  const [originalIfc, setOriginalIfc] = useState(false);      // IFC pesante: l'originale invece del derivato .glb
  const [panel, setPanel] = useState(true);
  const [browserPdf, setBrowserPdf] = useState(false);
  const [zoom, setZoom] = useState(1.25);
  const [pages, setPages] = useState(0);
  const [drawing, setDrawing] = useState(false);
  // strumento "Timbra" (ADR-56): timbro scelto, timbri messi sulle pagine, quello selezionato, didascalia sui nuovi
  const [stamping, setStamping] = useState(false);
  const [piazzamenti, setPiazzamenti] = useState<Piazzamento[]>([]);
  const [timbroAttivo, setTimbroAttivo] = useState<Timbro | null>(null);
  const [piazzamentoSel, setPiazzamentoSel] = useState<string | null>(null);
  const [didascalia, setDidascalia] = useState(true);
  const { me } = useAuth();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusPage, setFocusPage] = useState<{ page: number; seq: number } | null>(null);
  const [searchInput, setSearchInput] = useState(initialSearch ?? "");
  const [search, setSearch] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatch, setActiveMatch] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setActiveMatch(0); }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  const nextMatch = (d: 1 | -1) => matchCount && setActiveMatch((m) => (m + d + matchCount) % matchCount);
  useEffect(() => { setDraft(null); setSelectedId(null); setDrawing(false); setCompareId(""); setEditing(false); setOriginalIfc(false); }, [revisionId]);
  const chiudiTimbra = () => { setStamping(false); setPiazzamenti([]); setTimbroAttivo(null); setPiazzamentoSel(null); };
  useEffect(chiudiTimbra, [revisionId]);

  // numerazione stabile per data di creazione, indipendente dai filtri
  const numbers = useMemo(() => new Map([...markups].sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m, i) => [m.id, i + 1])), [markups]);
  const isPdf = link?.content_type === "application/pdf";
  const isImage = !!link?.content_type?.startsWith("image/");
  const model = link?.content_type === "application/x-step" ? "ifc" as const
    : link?.content_type === "model/gltf-binary" ? "glb" as const : link?.content_type === "model/gltf+json" ? "gltf" as const : null;
  const isCad = link?.content_type === "image/vnd.dwg" || link?.content_type === "image/vnd.dxf";
  const cad = isCad ? link?.derivative ?? null : null;      // SVG preparato dal worker (ADR-41)
  const isCsv = !!link?.filename?.toLowerCase().endsWith(".csv");
  const office = link?.content_type === DOCX ? "docx" : link?.content_type === XLSX ? "xlsx" : isCsv ? "csv" : null;
  const derivative = model === "ifc" ? link?.derivative ?? null : null;
  const optimized = derivative?.status === "READY" && !!derivative.url && !originalIfc;
  const canDraw = (isPdf && !browserPdf) || isImage || !!model || cad?.status === "READY";
  const isText = !!link?.content_type?.startsWith("text/plain");
  const canEdit = isText && !!doc && doc.my_actions.includes("WRITE") && doc.revisions[0]?.id === revisionId;
  // Word ed Excel nell'editor OnlyOffice: solo l'ultima revisione, in WIP; il salvataggio crea la WIP successiva
  // busta .p7m: si guarda il documento contenuto ma non si modifica (la firma riguarda il file originale)
  const busta = link?.content_type === "application/pkcs7-mime";
  const canOffice = !!officeConfig?.enabled && (office === "docx" || office === "xlsx") && !!doc && !link?.firma
    && doc.my_actions.includes("WRITE") && doc.revisions[0]?.id === revisionId && doc.revisions[0]?.state === "WIP";
  // Timbra: PDF (non il documento dentro una busta .p7m: la firma andrebbe persa), ultima revisione, permesso di
  // scrittura; durante un workflow il server risponde 423 salvo modifiche richieste a chi timbra (ADR-51)
  const canStamp = isPdf && !browserPdf && !link?.firma && !!doc && doc.my_actions.includes("WRITE")
    && doc.revisions[0]?.id === revisionId && rev?.scan_status === "CLEAN";
  const testoDidascalia = `Timbrato da ${me ? `${me.first_name} ${me.last_name}` : "…"} il ${new Date().toLocaleString("it-IT",
    { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "")}`;
  const fill = (isPdf && !browserPdf) || !!model || !!office || isCad;
  const selectedRef = markups.find((m) => m.id === selectedId)?.element_ref ?? null;
  const openCount = markups.filter((m) => m.status === "OPEN").length;

  const layer = (page: number) => (stamping ? (
    <TimbraLayer page={page} piazzamenti={piazzamenti.filter((p) => p.pagina === page)} attivo={timbroAttivo}
                 selezionato={piazzamentoSel} didascalia={didascalia} testoDidascalia={testoDidascalia}
                 onAggiungi={(p) => { const chiave = crypto.randomUUID(); setPiazzamenti((l) => [...l, { ...p, chiave }]); setPiazzamentoSel(chiave); }}
                 onCambia={(k, c) => setPiazzamenti((l) => l.map((p) => (p.chiave === k ? { ...p, ...c } : p)))}
                 onSeleziona={setPiazzamentoSel} onTogli={(k) => setPiazzamenti((l) => l.filter((p) => p.chiave !== k))} />
  ) : (
    <MarkupLayer page={page} markups={markups} numbers={numbers} selectedId={selectedId} drawing={drawing}
                 draft={draft && "page" in draft ? draft : null} onDraw={(a) => { setDraft(a); setDrawing(false); setPanel(true); }} onSelect={setSelectedId} />
  ));
  const step = (dir: 1 | -1) => setZoom((z) => (dir > 0
    ? ZOOMS.find((x) => x > z + 0.001) ?? ZOOMS[ZOOMS.length - 1]
    : [...ZOOMS].reverse().find((x) => x < z - 0.001) ?? ZOOMS[0]));

  return (
    <Dialog open fullScreen onClose={onClose}
            PaperProps={{ "aria-label": doc?.title ? `Visualizzatore: ${doc.title}` : "Visualizzatore documento" }}>
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
          {isPdf && !browserPdf && (
            <Stack direction="row" alignItems="center">
              <TextField size="small" placeholder="Cerca nel testo" value={searchInput} sx={{ width: 190 }}
                         onChange={(e) => setSearchInput(e.target.value)}
                         onKeyDown={(e) => { if (e.key === "Enter") nextMatch(e.shiftKey ? -1 : 1); }}
                         InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
              {search.trim().length >= 2 && (
                <>
                  <Typography variant="caption" width={52} textAlign="center" color={matchCount ? "text.primary" : "error"}>
                    {matchCount ? `${activeMatch + 1}/${matchCount}` : "0"}
                  </Typography>
                  <IconButton size="small" aria-label="Occorrenza precedente" disabled={!matchCount} onClick={() => nextMatch(-1)}><KeyboardArrowUpIcon /></IconButton>
                  <IconButton size="small" aria-label="Occorrenza successiva" disabled={!matchCount} onClick={() => nextMatch(1)}><KeyboardArrowDownIcon /></IconButton>
                </>
              )}
            </Stack>
          )}
          {isPdf && !browserPdf && doc && doc.revisions.length > 1 && (
            <TextField select size="small" label="Confronta con" value={compareId} sx={{ minWidth: 170 }} disabled={stamping}
                       onChange={(e) => setCompareId(e.target.value)}>
              <MenuItem value="">Nessun confronto</MenuItem>
              {doc.revisions.filter((r) => r.id !== revisionId && r.scan_status === "CLEAN").map((r) => (
                <MenuItem key={r.id} value={r.id}>{r.revision_code} · {r.state}</MenuItem>
              ))}
            </TextField>
          )}
          {isPdf && (
            <Tooltip title="Il visualizzatore del browser permette la stampa, senza annotazioni">
              <ToggleButton size="small" value="browser" selected={browserPdf} sx={{ color: "text.primary" }} onChange={() => { setBrowserPdf((b) => !b); setDrawing(false); }}>
                Visualizzatore del browser
              </ToggleButton>
            </Tooltip>
          )}
          {derivative?.status === "READY" && (
            <Tooltip title="Il modello è pesante: si apre la versione ottimizzata preparata dal server (stessi elementi, piani e proprietà). L'IFC originale si legge nel browser, più lentamente.">
              <ToggleButton size="small" value="original" selected={originalIfc} sx={{ color: "text.primary" }}
                            onChange={() => { setOriginalIfc((o) => !o); setSelectedId(null); }}>
                {originalIfc ? "IFC originale" : "Versione ottimizzata"}
              </ToggleButton>
            </Tooltip>
          )}
          {derivative?.status === "PENDING" && (
            <Tooltip title="Il server sta preparando la versione ottimizzata del modello: intanto si legge l'IFC originale">
              <Chip size="small" variant="outlined" label="Versione ottimizzata in preparazione" tabIndex={0} />
            </Tooltip>
          )}
          {isCad && cad?.status === "READY" && (
            <Tooltip title="Disegno convertito dal server (DWG → DXF → SVG): layer, misure e annotazioni; il file originale si scarica">
              <Chip size="small" variant="outlined" label={`Vista del disegno · ${cad.layers?.length ?? 0} layer`} tabIndex={0} />
            </Tooltip>
          )}
          {canEdit && !editing && <Button startIcon={<EditIcon />} onClick={() => setEditing(true)}>Modifica</Button>}
          {canOffice && (
            <Button startIcon={<EditIcon />}
                    onClick={() => window.open(`/documenti/${documentId}/modifica?rev=${revisionId}`, "_blank", "noopener")}>
              Modifica con OnlyOffice
            </Button>
          )}
          {canStamp && (
            <Tooltip describeChild title="Metti sulle pagine firma, logo o «Approvato»: il PDF timbrato diventa una nuova revisione in WIP">
              <ToggleButton size="small" value="timbra" selected={stamping} color="primary" sx={{ color: "text.primary" }}
                            onChange={() => { if (stamping) chiudiTimbra(); else { setStamping(true); setDrawing(false); setCompareId(""); setPanel(true); } }}>
                <ApprovalIcon fontSize="small" sx={{ mr: 0.5 }} />Timbra
              </ToggleButton>
            </Tooltip>
          )}
          {canDraw && !stamping && (
            <ToggleButton size="small" value="draw" selected={drawing} color="primary" sx={{ color: "text.primary" }} onChange={() => setDrawing((d) => !d)}>
              <DrawIcon fontSize="small" sx={{ mr: 0.5 }} />Annota
            </ToggleButton>
          )}
          <ToggleButton size="small" value="panel" selected={panel} onChange={() => setPanel((p) => !p)} aria-label="Annotazioni">
            <Badge badgeContent={openCount} color="error"><CommentIcon fontSize="small" /></Badge>
          </ToggleButton>
          {link?.firma && revisionId && <FirmaBadge firma={link.firma} revisionId={revisionId} />}
          {link?.watermark && (
            <Tooltip title="Su ogni pagina, anche scaricata, compaiono il tuo nome, l'organizzazione, data e ora: lo ha deciso il Project Admin">
              <Chip size="small" color="warning" variant="outlined" label="Filigranato" tabIndex={0} />
            </Tooltip>
          )}
          <Button startIcon={<DownloadIcon />} disabled={!revisionId || rev?.scan_status !== "CLEAN" || download.isPending}
                  onClick={() => download.mutate()}>Scarica</Button>
          {onDetails && <Button startIcon={<InfoIcon />} onClick={onDetails}>Dettagli e cronologia</Button>}
          <IconButton aria-label="Chiudi" onClick={onClose}><CloseIcon /></IconButton>
        </Toolbar>
      </AppBar>
      <Box display="flex" flexGrow={1} minHeight={0}>
        <Box data-pdf-scroll tabIndex={0} role="region" aria-label="Contenuto del documento" flexGrow={1} bgcolor="#525659" overflow="auto" minWidth={0} display="flex" flexDirection="column"
             // "safe center": se il contenuto è più largo o più alto dello spazio (tablet con il pannello annotazioni
             // aperto, U23) il centramento normale lo taglia a sinistra/in alto senza poter scorrere; con "safe"
             // il browser lo allinea all'inizio e lo scroll arriva ovunque
             alignItems={fill ? "stretch" : "safe center"} justifyContent={fill ? "flex-start" : "safe center"}>
          {rev && rev.scan_status !== "CLEAN" && (
            <Alert severity={rev.scan_status === "PENDING" ? "info" : "error"}>
              {rev.scan_status === "PENDING" ? "Verifica antivirus in corso: riprova tra poco." : "File in quarantena: non visualizzabile."}
            </Alert>
          )}
          {isFetching && !link && <CircularProgress sx={{ color: "#fff" }} />}
          {notViewable && (
            <Stack alignItems="center" spacing={2} p={3} bgcolor="background.paper" borderRadius={2}>
              <Typography>{rev?.original_filename}: questo formato non si apre nel browser.</Typography>
              {rev?.original_filename.toLowerCase().endsWith(".blend") && (
                <Typography variant="body2" maxWidth={520}>
                  Per vederlo in 3D qui, da Blender: File → Esporta → glTF 2.0, formato «glTF Binary (.glb)», e carica il .glb
                  come nuova revisione o documento collegato.
                </Typography>
              )}
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
              <PdfView key={link.url} url={link.url} onLoadError={onPdfError}
                       onFit={(z) => setZoom(Math.min(1.5, Math.max(ZOOMS[0], Math.round(z * 100) / 100)))} compareUrl={compareId ? compareLink?.url ?? null : null} zoom={zoom} focusPage={focusPage} onPages={setPages} overlay={layer}
                       search={search} activeMatch={activeMatch} onMatches={setMatchCount} />
            </Suspense>
          ) : isCad ? (
            cad?.status === "READY" && cad.url ? (
              <Suspense fallback={<CircularProgress sx={{ color: "#fff", m: "auto" }} />}>
                <DxfView key={cad.url} url={cad.url} layers={cad.layers ?? []} overlay={layer} drawing={drawing} />
              </Suspense>
            ) : (
              <Stack alignItems="center" spacing={2} p={3} m="auto" bgcolor="background.paper" borderRadius={2} maxWidth={560}>
                {cad?.status === "FAILED" ? (
                  <>
                    <Typography>Il disegno non si è potuto convertire per la visualizzazione.</Typography>
                    {cad.detail && <Typography variant="body2" color="text.secondary">{cad.detail}</Typography>}
                    <Typography variant="body2" color="text.secondary">
                      I DWG richiedono ODA File Converter sul server; un DXF si vede sempre. Il file originale resta scaricabile.
                    </Typography>
                  </>
                ) : (
                  <>
                    <CircularProgress size={28} />
                    <Typography>Il server sta preparando la vista del disegno: pochi secondi dopo la verifica antivirus.</Typography>
                  </>
                )}
                <Button variant="contained" startIcon={<DownloadIcon />} onClick={() => download.mutate()}>Scarica il file</Button>
              </Stack>
            )
          ) : model ? (
            <Suspense fallback={<CircularProgress sx={{ color: "#fff", m: "auto" }} />}>
              <ModelView key={optimized ? "glb" : "ifc"} url={optimized ? derivative!.url! : link.url} format={optimized ? "glb" : model}
                       parts={optimized ? derivative!.parts ?? undefined : undefined} projectId={doc?.project_id ?? ""} documentId={documentId}
                       onOpenDocument={(id, search) => openDocument(id, { search })} markups={markups} selectedRef={selectedRef} drawing={drawing} onSelectMarkup={setSelectedId}
                       onPick={(e) => { setDraft({ element_ref: e.ref, label: e.label }); setDrawing(false); setPanel(true); }} />
            </Suspense>
          ) : office && (rev?.size_bytes ?? 0) > OFFICE_PREVIEW_MAX ? (
            <Stack alignItems="center" spacing={2} p={3} m="auto" bgcolor="background.paper" borderRadius={2}>
              <Typography>File troppo grande per l'anteprima in piattaforma (oltre 25 MB).</Typography>
              <Button variant="contained" startIcon={<DownloadIcon />} onClick={() => download.mutate()}>Scarica il file</Button>
            </Stack>
          ) : office ? (
            <Suspense fallback={<CircularProgress sx={{ color: "#fff", m: "auto" }} />}>
              <OfficeView url={link.url} kind={office} />
            </Suspense>
          ) : busta ? (
            <Stack alignItems="center" spacing={2} p={3} m="auto" bgcolor="background.paper" borderRadius={2} maxWidth={560}>
              {link.firma?.stato === "FAILED" ? (
                <>
                  <Typography>Il documento firmato non si è potuto aprire per la visualizzazione.</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {link.firma.rapporto?.riepilogo ?? link.firma.dettaglio ?? "Motivo sconosciuto"}
                  </Typography>
                </>
              ) : link.firma?.stato === "READY" ? (
                <Typography>Il documento dentro la busta firmata ({link.firma.contenuto}) non si apre nel browser.</Typography>
              ) : (
                <>
                  <CircularProgress size={28} />
                  <Typography>Il server sta aprendo la busta firmata e verificando la firma: pochi secondi dopo la verifica antivirus.</Typography>
                </>
              )}
              <Button variant="contained" startIcon={<DownloadIcon />} onClick={() => download.mutate()}>Scarica il file firmato</Button>
            </Stack>
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
        {/* sotto i 900 px (tablet in verticale, U23) il pannello si stringe per lasciare spazio alla tavola */}
        {panel && revisionId && (
          <Box width={{ xs: "100%", sm: 300, md: 360 }} flexShrink={0} borderLeft={1} borderColor="divider" bgcolor="background.paper"
               position={{ xs: "absolute", sm: "static" }} top={{ xs: 64 }} bottom={0} right={0} zIndex={1}>
            {stamping && doc ? (
              <TimbraPanel projectId={doc.project_id} documentId={documentId} revisionId={revisionId} piazzamenti={piazzamenti}
                           attivo={timbroAttivo} didascalia={didascalia} onScegli={setTimbroAttivo} onDidascalia={setDidascalia}
                           onTogli={(k) => setPiazzamenti((l) => l.filter((p) => p.chiave !== k))} onAnnulla={chiudiTimbra}
                           onSalvato={(r) => { chiudiTimbra(); setRevisionId(r.id); }} />
            ) : (
              <MarkupPanel revisionId={revisionId} taskId={taskId} markups={markups} numbers={numbers} selectedId={selectedId}
                           draft={draft} onClearDraft={() => setDraft(null)}
                           onSelect={(m) => { setSelectedId(m.id); if (m.page) setFocusPage({ page: m.page, seq: Date.now() }); }} />
            )}
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
