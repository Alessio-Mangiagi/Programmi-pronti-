// "><(((º> sabusabu <º)))><"
// Modelli di workflow della commessa (workflow a grafo, docs/workflow-grafo.md §4): elenco delle versioni,
// "Apri" mostra lo schema in sola lettura, "Nuova versione" e "Nuovo workflow" aprono l'editor a scacchiera
// (components/workflow/EditorWorkflow.tsx). Salvare con lo stesso codice crea una nuova versione e disattiva la
// precedente. Un workflow sviluppato in un altro progetto si importa adattandolo a questo (ADR-39).
// Sotto, "Dalla libreria dell'organizzazione" (ADR-50, §5): i modelli che l'organizzazione proprietaria della
// commessa tiene nella sua libreria, avviabili qui così come sono (collegamento vivo: vale l'ultima versione).
// Si aprono in sola lettura; "Copia nella commessa" ne fa un modello del progetto da modificare. L'amministratore
// dell'organizzazione può pubblicare in libreria un modello della commessa ("Pubblica in libreria").
import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, IconButton, Link, MenuItem, Stack, Switch,
  TextField, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import PublishIcon from "@mui/icons-material/Publish";
import { api, ApiError, Project } from "../../api";
import { useAuth } from "../../auth";
import { EditorWorkflow } from "../../components/workflow/EditorWorkflow";
import { Modello, comeGrafo, diLibreria } from "../../components/workflow/modello";
import { SchedaModello } from "../../components/workflow/SchedaModello";

type Template = Modello;

export function WorkflowsTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const qc = useQueryClient();
  const { me } = useAuth();
  // editor aperto: modello in sola lettura, nuova versione di un modello, o workflow nuovo
  const [editing, setEditing] = useState<{ base: Template | null; nuovo: boolean } | null>(null);
  const [showOld, setShowOld] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<Imported | null>(null);
  // copia di un modello di libreria nella commessa, o pubblicazione in libreria di un modello della commessa
  const [copia, setCopia] = useState<{ t: Template; verso: "commessa" | "libreria" } | null>(null);
  const { data: templates = [] } = useQuery({
    queryKey: ["workflow-templates", project.id, "all"],
    queryFn: () => api<Template[]>(`/projects/${project.id}/workflow-templates?include_inactive=true`),
  });
  const toggle = useMutation({
    mutationFn: (t: Template) => api(`/workflow-templates/${t.id}`, { method: "PATCH", json: { is_active: !t.is_active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflow-templates", project.id] }),
  });
  // l'amministratore dell'organizzazione proprietaria (o il platform admin) pubblica in libreria
  const orgAdmin = !!me && (me.is_platform_admin || (me.is_org_admin && me.organization_id === project.owner_organization_id));
  const delProgetto = templates.filter((t) => !diLibreria(t));
  const diOrganizzazione = templates.filter(diLibreria).sort((a, b) => a.name.localeCompare(b.name));
  const shown = delProgetto.filter((t) => showOld || t.is_active)
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
          {imported.azione ?? "Importato"}
          {" "}«{imported.name}» ({imported.code} · v{imported.version}).
          {imported.changes.length > 0 && <> {imported.scope === "LIBRARY" ? "Adattato alla libreria:" : "Adattato a questo progetto:"}
            <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>{imported.changes.map((n) => <li key={n}>{n}</li>)}</ul></>}
        </Alert>
      )}
      {shown.length === 0 && <Alert severity="info">Nessun workflow della commessa.{canManage ? "" : " Li crea il Project Admin."}</Alert>}
      {shown.map((t) => (
        <SchedaModello key={t.id} t={t} onApri={() => setEditing({ base: t, nuovo: false })}>
          {canManage && (
            <>
              <Tooltip title="Nuova versione"><IconButton aria-label={`Nuova versione di ${t.code}`} onClick={() => setEditing({ base: t, nuovo: true })}><EditIcon /></IconButton></Tooltip>
              <Button size="small" onClick={() => toggle.mutate(t)}>{t.is_active ? "Disattiva" : "Riattiva"}</Button>
            </>
          )}
          {orgAdmin && t.is_active && (
            <Button size="small" startIcon={<PublishIcon />} onClick={() => setCopia({ t, verso: "libreria" })}>Pubblica in libreria</Button>
          )}
        </SchedaModello>
      ))}

      <Divider />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} component="section"
             aria-labelledby="titolo-libreria">
        <Stack flexGrow={1}>
          <Typography id="titolo-libreria" variant="h6" component="h3" fontWeight={600}>Dalla libreria dell'organizzazione</Typography>
          <Typography variant="body2" color="text.secondary">
            Modelli di {diOrganizzazione[0]?.organization_name ?? project.owner_name ?? "chi è proprietario della commessa"} validi in
            tutte le sue commesse: si avviano da qui così come sono, sempre nell'ultima versione. Per una variante solo
            per questa commessa usa "Copia nella commessa".
          </Typography>
        </Stack>
        {orgAdmin && (
          <Link component={RouterLink} to={me?.is_platform_admin ? `/organizzazione/workflow?org=${project.owner_organization_id}` : "/organizzazione/workflow"}
                underline="hover" sx={{ flexShrink: 0 }}>
            Gestisci la libreria
          </Link>
        )}
      </Stack>
      {diOrganizzazione.length === 0 && (
        <Alert severity="info" variant="outlined">
          La libreria dell'organizzazione non ha modelli attivi.{orgAdmin ? " Puoi pubblicarci un modello della commessa." : ""}
        </Alert>
      )}
      {diOrganizzazione.map((t) => (
        <SchedaModello key={t.id} t={t} onApri={() => setEditing({ base: t, nuovo: false })}>
          {canManage && (
            <Button size="small" startIcon={<ContentCopyIcon />} onClick={() => setCopia({ t, verso: "commessa" })}>Copia nella commessa</Button>
          )}
        </SchedaModello>
      ))}

      {editing && (
        <EditorWorkflow project={project} base={editing.base} nuovo={editing.nuovo} onClose={() => setEditing(null)}
                        solaLettura={!!editing.base && diLibreria(editing.base)}
                        azioni={editing.base && diLibreria(editing.base) && canManage ? (
                          <Button variant="contained" startIcon={<ContentCopyIcon />}
                                  onClick={() => { setCopia({ t: editing.base!, verso: "commessa" }); setEditing(null); }}>
                            Copia nella commessa
                          </Button>
                        ) : undefined} />
      )}
      {importing && <ImportDialog project={project} onClose={() => setImporting(false)}
                                  onImported={(t) => { setImporting(false); setImported(t); }} />}
      {copia && <CopiaDialog project={project} t={copia.t} verso={copia.verso} esistenti={copia.verso === "commessa" ? delProgetto : diOrganizzazione}
                             onClose={() => setCopia(null)} onDone={(t) => { setCopia(null); setImported(t); }} />}
    </Stack>
  );
}

interface Importable extends Template { project_code: string; project_name: string; exists_here: boolean }
type Imported = Template & { changes: string[]; azione?: string };

/** "Copia nella commessa" (modello di libreria → modello del progetto) o "Pubblica in libreria" (il contrario).
 *  Stesso codice di un modello già presente dall'altra parte ⇒ ne diventa la nuova versione. */
function CopiaDialog({ project, t, verso, esistenti, onClose, onDone }: {
  project: Project; t: Template; verso: "commessa" | "libreria"; esistenti: Template[];
  onClose: () => void; onDone: (t: Imported) => void;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState(t.code);
  const [name, setName] = useState(t.name);
  const run = useMutation({
    mutationFn: () => api<Imported>(verso === "commessa"
      ? `/projects/${project.id}/workflow-templates/from-library`
      : `/organizations/${project.owner_organization_id}/workflow-library/from-project`, {
      method: "POST", json: { template_id: t.id, code: code !== t.code ? code : null, name: name !== t.name ? name : null },
    }),
    onSuccess: (out) => {
      qc.invalidateQueries({ queryKey: ["workflow-templates", project.id] });
      qc.invalidateQueries({ queryKey: ["workflow-library"] });
      onDone({ ...out, azione: verso === "commessa" ? "Copiato nella commessa" : "Pubblicato in libreria" });
    },
  });
  const giaPresente = esistenti.some((x) => x.code === code);
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{verso === "commessa" ? "Copia nella commessa" : "Pubblica nella libreria dell'organizzazione"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <Typography variant="body2" color="text.secondary">
            {verso === "commessa"
              ? "La copia diventa un modello di questa commessa: la puoi modificare e non segue più le nuove versioni della libreria. I ruoli che qui non esistono vengono segnalati."
              : "La copia vale in tutte le commesse dell'organizzazione. Nella libreria gli assegnatari sono solo ruoli: le persone indicate nel modello vengono tolte e segnalate. Il modello della commessa resta com'è."}
          </Typography>
          <TextField label={verso === "commessa" ? "Codice nella commessa" : "Codice in libreria"} value={code} inputProps={{ maxLength: 41 }}
                     onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))}
                     helperText={giaPresente ? "Esiste già un modello con questo codice: la copia ne diventa la nuova versione" : " "} />
          <TextField label="Nome" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 200 }} />
          {run.error && <Alert severity="error">{(run.error as ApiError).message}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!/^[A-Z][A-Z0-9_]{1,40}$/.test(code) || name.trim().length < 2 || run.isPending}
                onClick={() => run.mutate()}>{verso === "commessa" ? "Copia" : "Pubblica"}</Button>
      </DialogActions>
    </Dialog>
  );
}

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
