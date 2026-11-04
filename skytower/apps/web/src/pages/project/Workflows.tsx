// "><(((º> sabusabu <º)))><"
// Modelli di workflow della commessa (workflow a grafo, docs/workflow-grafo.md §4): elenco delle versioni,
// "Apri" mostra lo schema in sola lettura, "Nuova versione" e "Nuovo workflow" aprono l'editor a scacchiera
// (components/workflow/EditorWorkflow.tsx). Salvare con lo stesso codice crea una nuova versione e disattiva la
// precedente. Un workflow sviluppato in un altro progetto si importa adattandolo a questo (ADR-39).
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Paper, Stack,
  Switch, TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import { api, ApiError, Project } from "../../api";
import { EditorWorkflow } from "../../components/workflow/EditorWorkflow";
import { Definizione, Modello, NOME_TIPO, comeGrafo } from "../../components/workflow/modello";

type Template = Modello;

export function WorkflowsTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const qc = useQueryClient();
  // editor aperto: modello in sola lettura, nuova versione di un modello, o workflow nuovo
  const [editing, setEditing] = useState<{ base: Template | null; nuovo: boolean } | null>(null);
  const [showOld, setShowOld] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<Imported | null>(null);
  const { data: templates = [] } = useQuery({
    queryKey: ["workflow-templates", project.id, "all"],
    queryFn: () => api<Template[]>(`/projects/${project.id}/workflow-templates?include_inactive=true`),
  });
  const toggle = useMutation({
    mutationFn: (t: Template) => api(`/workflow-templates/${t.id}`, { method: "PATCH", json: { is_active: !t.is_active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflow-templates", project.id] }),
  });
  const shown = templates.filter((t) => showOld || t.is_active)
    .sort((a, b) => a.code.localeCompare(b.code) || b.version - a.version);

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <Typography variant="body2" color="text.secondary" flexGrow={1}>
          I workflow sono schemi a grafo: chi decide, con quali esiti, dove porta ogni esito. Quelli per i
          documenti si avviano dalla cartella con "Avvia approvazione" (durante la revisione il documento è
          bloccato); quelli per i processi dalla scheda Processi.
        </Typography>
        <Stack direction="row" alignItems="center" flexShrink={0}>
          <Switch checked={showOld} onChange={(e) => setShowOld(e.target.checked)} inputProps={{ "aria-label": "Mostra versioni disattivate" }} />
          <Typography variant="body2" noWrap>Versioni disattivate</Typography>
        </Stack>
        {canManage && <Button startIcon={<DownloadIcon />} onClick={() => setImporting(true)}>Importa da un altro progetto</Button>}
        {canManage && <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({ base: null, nuovo: true })}>Nuovo workflow</Button>}
      </Stack>
      {imported && (
        <Alert severity={imported.changes.length ? "warning" : "success"} onClose={() => setImported(null)}>
          Importato «{imported.name}» ({imported.code} · v{imported.version}).
          {imported.changes.length > 0 && <> Adattato a questo progetto:
            <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>{imported.changes.map((n) => <li key={n}>{n}</li>)}</ul></>}
        </Alert>
      )}
      {shown.length === 0 && <Alert severity="info">Nessun workflow configurato.{canManage ? "" : " Li crea il Project Admin."}</Alert>}
      {shown.map((t) => {
        const g = comeGrafo(t.definition);
        const decisioni = g.nodes.filter((n) => n.type === "decision" || n.type === "activity");
        const paralleli = maxRamiParalleli(g);
        return (
          <Paper key={t.id} variant="outlined" sx={{ p: 2, opacity: t.is_active ? 1 : 0.6 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Typography fontWeight={600}>{t.name}</Typography>
              <Chip size="small" variant="outlined" label={`${t.code} · v${t.version}`} sx={{ fontFamily: "monospace" }} />
              <Chip size="small" label={t.subject === "PROCESS" ? "Processi" : "Documenti"} color={t.subject === "PROCESS" ? "secondary" : "default"} variant="outlined" />
              {!t.is_active && <Chip size="small" label="Disattivato" />}
              {g.on_completed && (
                <Chip size="small" color="success" variant="outlined"
                      label={`Se concluso → ${g.on_completed.to_state === "SHARED" ? "Condiviso" : "Pubblicato"} ${g.on_completed.suitability}`} />
              )}
              <Box flexGrow={1} />
              <Button size="small" startIcon={<AccountTreeIcon />} onClick={() => setEditing({ base: t, nuovo: false })}>Apri</Button>
              {canManage && (
                <>
                  <Tooltip title="Nuova versione"><IconButton aria-label={`Nuova versione di ${t.code}`} onClick={() => setEditing({ base: t, nuovo: true })}><EditIcon /></IconButton></Tooltip>
                  <Button size="small" onClick={() => toggle.mutate(t)}>{t.is_active ? "Disattiva" : "Riattiva"}</Button>
                </>
              )}
            </Stack>
            <Typography variant="body2" color="text.secondary" mt={1}>
              {g.nodes.length} nodi · {decisioni.length} {decisioni.length === 1 ? "compito" : "compiti"}
              {paralleli > 1 ? ` · fino a ${paralleli} rami in parallelo` : ""}
              {" · "}{decisioni.slice(0, 4).map((n) => n.name).join(" → ")}{decisioni.length > 4 ? " → …" : ""}
            </Typography>
            <Stack direction="row" gap={0.5} mt={1} flexWrap="wrap">
              {(["start", "decision", "activity", "notification", "end"] as const).map((tipo) => {
                const k = g.nodes.filter((n) => n.type === tipo).length;
                return k ? <Chip key={tipo} size="small" variant="outlined" label={`${NOME_TIPO[tipo]} ${k}`} /> : null;
              })}
            </Stack>
          </Paper>
        );
      })}
      {editing && <EditorWorkflow project={project} base={editing.base} nuovo={editing.nuovo} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog project={project} onClose={() => setImporting(false)}
                                  onImported={(t) => { setImporting(false); setImported(t); }} />}
    </Stack>
  );
}

interface Importable extends Template { project_code: string; project_name: string; exists_here: boolean }
type Imported = Template & { changes: string[] };

/** Workflow attivi di altri progetti di cui si è Project Admin (ADR-39): persone e organizzazioni che qui non ci
 *  sono vengono tolte, i ruoli personalizzati mancanti creati uguali; stesso codice ⇒ nuova versione. */
function ImportDialog({ project, onClose, onImported }: { project: Project; onClose: () => void; onImported: (t: Imported) => void }) {
  const qc = useQueryClient();
  const [id, setId] = useState("");
  const [code, setCode] = useState("");
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["workflow-importable", project.id],
    queryFn: () => api<Importable[]>(`/projects/${project.id}/workflow-templates/importable`),
  });
  const chosen = items.find((t) => t.id === id);
  const run = useMutation({
    mutationFn: () => api<Imported>(`/projects/${project.id}/workflow-templates/import`, {
      method: "POST", json: { template_id: id, code: code && code !== chosen?.code ? code : null } }),
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: ["workflow-templates", project.id] }); qc.invalidateQueries({ queryKey: ["roles", project.id] }); onImported(t); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Importa un workflow da un altro progetto</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {!isLoading && items.length === 0 && <Alert severity="info">Nessun workflow attivo in altri progetti di cui sei Project Admin.</Alert>}
          {items.length > 0 && (
            <TextField select label="Workflow" value={id} onChange={(e) => { setId(e.target.value); setCode(items.find((t) => t.id === e.target.value)?.code ?? ""); }}>
              {items.map((t) => (
                <MenuItem key={t.id} value={t.id}>{t.project_code} · {t.name} ({t.code} v{t.version})</MenuItem>
              ))}
            </TextField>
          )}
          {chosen && (
            <>
              <Typography variant="body2" color="text.secondary">
                {comeGrafo(chosen.definition).nodes.filter((n) => n.type === "decision" || n.type === "activity").map((n) => n.name).join(" → ")}
                {" · "}dal progetto «{chosen.project_name}»
              </Typography>
              <TextField label="Codice in questo progetto" value={code} inputProps={{ maxLength: 41 }}
                         onChange={(e) => setCode(e.target.value.toUpperCase())}
                         helperText={code === chosen.code && chosen.exists_here
                           ? "Qui esiste già un workflow con questo codice: l'import ne diventa la nuova versione"
                           : "Persone e organizzazioni che non partecipano a questo progetto vengono tolte; i ruoli personalizzati mancanti si creano uguali"} />
            </>
          )}
          {run.error && <Alert severity="error">{(run.error as ApiError).message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!chosen || !/^[A-Z][A-Z0-9_]{1,40}$/.test(code) || run.isPending}
                onClick={() => run.mutate()}>Importa</Button>
      </DialogActions>
    </Dialog>
  );
}

/** Il gruppo di rami paralleli più grande: quanti archi escono dallo stesso nodo con lo stesso esito. */
function maxRamiParalleli(g: Definizione): number {
  const conta = new Map<string, number>();
  for (const e of g.edges) conta.set(`${e.from}|${e.outcome ?? ""}`, (conta.get(`${e.from}|${e.outcome ?? ""}`) ?? 0) + 1);
  return Math.max(1, ...conta.values());
}
