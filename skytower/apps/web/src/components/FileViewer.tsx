// "><(((º> sabusabu <º)))><"
// Lettura di un documento in piattaforma: PDF, immagini e testo con il visualizzatore del browser
// (zoom, ricerca, stampa), su URL firmato a scadenza servito "inline". Gli altri formati si scaricano.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert, AppBar, Box, Button, CircularProgress, Dialog, IconButton, MenuItem, Stack, TextField, Toolbar, Typography,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import InfoIcon from "@mui/icons-material/Info";
import { api, ApiError } from "../api";

interface Rev { id: string; revision_code: string; suitability: string; state: string; original_filename: string; scan_status: string }
interface Doc { id: string; identifier: string; title: string; revisions: Rev[] }
interface Link { url: string; filename: string; content_type: string | null }

export function FileViewer({ documentId, onClose, onDetails }: {
  documentId: string; onClose: () => void; onDetails?: () => void;
}) {
  const { data: doc } = useQuery({ queryKey: ["document", documentId], queryFn: () => api<Doc>(`/documents/${documentId}`) });
  const [revisionId, setRevisionId] = useState<string | null>(null);
  useEffect(() => { if (doc && !revisionId) setRevisionId(doc.revisions[0]?.id ?? null); }, [doc, revisionId]);
  const rev = doc?.revisions.find((r) => r.id === revisionId);

  const { data: link, error, isFetching } = useQuery({
    queryKey: ["view-link", revisionId],
    queryFn: () => api<Link>(`/revisions/${revisionId}/download?disposition=inline`),
    enabled: !!revisionId && rev?.scan_status === "CLEAN",
    staleTime: 4 * 60_000,          // l'URL firmato vale 5'
    retry: false,
  });
  const download = useMutation({
    mutationFn: () => api<{ url: string }>(`/revisions/${revisionId}/download`),
    onSuccess: ({ url }) => { window.location.href = url; },
  });
  const notViewable = (error as ApiError | null)?.status === 415;

  return (
    <Dialog open fullScreen onClose={onClose} aria-label="Visualizzatore documento">
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ gap: 1.5, flexWrap: "wrap", py: 0.5 }}>
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
          <Button startIcon={<DownloadIcon />} disabled={!revisionId || rev?.scan_status !== "CLEAN" || download.isPending}
                  onClick={() => download.mutate()}>Scarica</Button>
          {onDetails && <Button startIcon={<InfoIcon />} onClick={onDetails}>Dettagli e cronologia</Button>}
          <IconButton aria-label="Chiudi" onClick={onClose}><CloseIcon /></IconButton>
        </Toolbar>
      </AppBar>
      <Box flexGrow={1} bgcolor="#525659" display="flex" alignItems="center" justifyContent="center" minHeight={0}>
        {rev && rev.scan_status !== "CLEAN" && (
          <Alert severity={rev.scan_status === "PENDING" ? "info" : "error"}>
            {rev.scan_status === "PENDING" ? "Verifica antivirus in corso: riprova tra poco." : "File in quarantena: non visualizzabile."}
          </Alert>
        )}
        {isFetching && !link && <CircularProgress sx={{ color: "#fff" }} />}
        {notViewable && (
          <Stack alignItems="center" spacing={2} p={3} bgcolor="background.paper" borderRadius={2}>
            <Typography>{rev?.original_filename}: questo formato non si apre nel browser.</Typography>
            <Typography variant="body2" color="text.secondary">I modelli IFC e i DWG avranno un visualizzatore dedicato.</Typography>
            <Button variant="contained" startIcon={<DownloadIcon />} onClick={() => download.mutate()}>Scarica il file</Button>
          </Stack>
        )}
        {error && !notViewable && <Alert severity="error">{(error as ApiError).message}</Alert>}
        {download.error && <Alert severity="error">{(download.error as ApiError).message}</Alert>}
        {link && !error && (link.content_type?.startsWith("image/")
          ? <Box component="img" src={link.url} alt={doc?.title} sx={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", bgcolor: "#fff" }} />
          : <Box component="iframe" src={link.url} title={doc?.title ?? "Documento"} sx={{ border: 0, width: "100%", height: "100%", bgcolor: "#fff" }} />)}
      </Box>
    </Dialog>
  );
}
