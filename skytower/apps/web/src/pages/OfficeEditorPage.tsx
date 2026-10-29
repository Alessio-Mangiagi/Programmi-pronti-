// "><(((º> sabusabu <º)))><"
// Modifica di Word, Excel e PowerPoint con OnlyOffice Docs (ADR-37), nella sua scheda: /documenti/:id/modifica?rev=.
// L'API firma la configurazione dell'editor; lo script del Document Server (dal suo indirizzo, ammesso dalla CSP)
// apre l'editor in un iframe. Le modifiche si salvano da sole nel Document Server: quando tutti chiudono l'editor
// il file torna al CDE come revisione WIP successiva. Chi apre la stessa revisione modifica insieme agli altri.
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Alert, AppBar, Box, Button, CircularProgress, Stack, Toolbar, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { api, ApiError } from "../api";

interface Session {
  document_server_url: string;
  config: Record<string, unknown>;
  identifier: string;
  revision_code: string;
}
interface Editor { destroyEditor?: () => void }
declare global {
  interface Window { DocsAPI?: { DocEditor: new (id: string, config: Record<string, unknown>) => Editor } }
}

const loaded = new Map<string, Promise<void>>();

/** Lo script dell'editor dal Document Server, una volta per pagina. */
function loadScript(src: string): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(src, new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = src;
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => { loaded.delete(src); reject(new Error("Document Server OnlyOffice non raggiungibile")); };
      document.head.appendChild(el);
    }));
  }
  return loaded.get(src)!;
}

export function OfficeEditorPage() {
  const { documentId = "" } = useParams();
  const [params] = useSearchParams();
  const revisionId = params.get("rev") ?? "";
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let editor: Editor | null = null;
    (async () => {
      try {
        const s = await api<Session>(`/revisions/${revisionId}/office-session`, { method: "POST" });
        if (!alive) return;
        document.title = `${s.identifier} · modifica`;
        await loadScript(`${s.document_server_url}/web-apps/apps/api/documents/api.js`);
        if (!alive || !window.DocsAPI) return;
        editor = new window.DocsAPI.DocEditor("office-editor", { ...s.config, width: "100%", height: "100%", type: "desktop" });
        setSession(s);
      } catch (err) {
        if (alive) setError(err instanceof ApiError || err instanceof Error ? err.message : String(err));
      }
    })();
    return () => { alive = false; editor?.destroyEditor?.(); };
  }, [revisionId]);

  return (
    <Stack position="fixed" sx={{ inset: 0, zIndex: (t) => t.zIndex.modal, bgcolor: "background.default" }}>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar variant="dense" sx={{ gap: 1 }}>
          <Box flexGrow={1} minWidth={0}>
            <Typography fontWeight={600} noWrap>
              {session ? `${session.identifier} · modifica della ${session.revision_code}` : "Apertura dell'editor…"}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="p">
              Le modifiche si salvano da sole: quando chiudi (e chiudono gli altri che stanno modificando) diventano la
              revisione WIP successiva del documento.
            </Typography>
          </Box>
          <Button startIcon={<CloseIcon />} onClick={() => { window.close(); window.location.assign(`/documenti/${documentId}`); }}>
            Chiudi editor
          </Button>
        </Toolbar>
      </AppBar>
      {error && <Alert severity="error" sx={{ m: 2 }}>Modifica non disponibile: {error}</Alert>}
      {!session && !error && <CircularProgress sx={{ mx: "auto", mt: 4 }} />}
      {/* l'editor sostituisce questo segnaposto con il suo iframe: deve esistere già con la sua dimensione */}
      <Box id="office-editor" flexGrow={1} minHeight={0} />
    </Stack>
  );
}
