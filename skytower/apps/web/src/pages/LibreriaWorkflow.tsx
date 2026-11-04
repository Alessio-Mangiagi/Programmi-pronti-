// "><(((º> sabusabu <º)))><"
// Libreria workflow dell'organizzazione (ADR-50, docs/workflow-grafo.md §5), rotta /organizzazione/workflow.
// I modelli si disegnano qui una volta e valgono in tutte le commesse di cui l'organizzazione è proprietaria:
// ogni commessa li vede nella scheda Workflow ("Dalla libreria dell'organizzazione"), in Processi e nel dialogo di
// avvio su un documento. Collegamento vivo: salvare con lo stesso codice crea una nuova versione, che vale per gli
// avvii successivi; i processi già partiti restano sulla versione con cui sono partiti.
// Solo l'amministratore dell'organizzazione crea, versiona e disattiva; gli altri utenti dell'organizzazione la
// consultano. Il platform admin sceglie l'organizzazione (?org=…), come nella pagina Organizzazione.
// Stesso editor a scacchiera della commessa (EditorWorkflow con `libreria`): assegnatari solo per ruolo.
import { useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, IconButton, Link, MenuItem, Stack, Switch, TextField, Tooltip, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import { api, ApiError } from "../api";
import { useAuth } from "../auth";
import { EditorWorkflow } from "../components/workflow/EditorWorkflow";
import { Modello } from "../components/workflow/modello";
import { SchedaModello } from "../components/workflow/SchedaModello";

interface Org { id: string; legal_name: string; code: string }

export function LibreriaWorkflowPage() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const orgId = params.get("org") ?? me?.organization_id ?? "";
  const [editing, setEditing] = useState<{ base: Modello | null; nuovo: boolean } | null>(null);
  const [showOld, setShowOld] = useState(false);
  const { data: orgs = [] } = useQuery({
    queryKey: ["organizations"], queryFn: () => api<Org[]>("/organizations"), enabled: !!me?.is_platform_admin,
  });
  const { data: org } = useQuery({
    queryKey: ["organization", orgId], queryFn: () => api<Org>(`/organizations/${orgId}`), enabled: !!orgId,
  });
  const { data: modelli = [], error, isLoading } = useQuery({
    queryKey: ["workflow-library", orgId, "all"], enabled: !!orgId,
    queryFn: () => api<Modello[]>(`/organizations/${orgId}/workflow-library?include_inactive=true`),
  });
  const toggle = useMutation({
    mutationFn: (t: Modello) => api(`/workflow-library/${t.id}`, { method: "PATCH", json: { is_active: !t.is_active } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["workflow-library", orgId] }),
  });

  if (!me) return null;
  const canManage = me.is_platform_admin || (me.is_org_admin && me.organization_id === orgId);
  const shown = modelli.filter((t) => showOld || t.is_active).sort((a, b) => a.code.localeCompare(b.code) || b.version - a.version);
  const attivi = modelli.filter((t) => t.is_active).length;

  return (
    <Stack spacing={2} maxWidth={1100}>
      <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap">
        <Stack flexGrow={1}>
          <Typography variant="h4" fontWeight={600}>Libreria workflow</Typography>
          <Typography variant="body2" color="text.secondary">
            {org ? <>Modelli di <b>{org.legal_name}</b> validi in tutte le commesse di cui l'organizzazione è proprietaria</> : " "}
          </Typography>
        </Stack>
        {me.is_platform_admin && (
          <TextField select size="small" label="Organizzazione" value={orgId} sx={{ minWidth: 280 }}
                     onChange={(e) => setParams({ org: e.target.value })}>
            {orgs.map((o) => <MenuItem key={o.id} value={o.id}>{o.legal_name} · {o.code}</MenuItem>)}
          </TextField>
        )}
        <Link component={RouterLink} to={me.is_platform_admin && orgId ? `/organizzazione?org=${orgId}` : "/organizzazione"} underline="hover">
          Organizzazione e utenti
        </Link>
      </Stack>

      <Alert severity="info" variant="outlined">
        Ogni commessa dell'organizzazione avvia questi modelli così come sono: i processi dalla scheda Processi, quelli
        per i documenti da "Avvia approvazione". Una nuova versione vale per gli avvii successivi; i processi già
        partiti restano sulla loro. Gli assegnatari sono ruoli (Project Admin, Lead Designer…), non persone: se in una
        commessa nessuno ha il ruolo richiesto, l'avvio viene bloccato con l'elenco dei nodi. Chi vuole una variante
        per una sola commessa usa "Copia nella commessa" dalla scheda Workflow.
      </Alert>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <Typography variant="body2" color="text.secondary" flexGrow={1}>
          {isLoading ? " " : `${attivi} ${attivi === 1 ? "modello attivo" : "modelli attivi"}`}
          {!canManage && " · solo l'amministratore dell'organizzazione crea e modifica i modelli"}
        </Typography>
        <Stack direction="row" alignItems="center" flexShrink={0}>
          <Switch checked={showOld} onChange={(e) => setShowOld(e.target.checked)} inputProps={{ "aria-label": "Mostra versioni disattivate" }} />
          <Typography variant="body2" noWrap>Versioni disattivate</Typography>
        </Stack>
        {canManage && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing({ base: null, nuovo: true })}>Nuovo workflow</Button>
        )}
      </Stack>
      {error && <Alert severity="error">{(error as ApiError).message}</Alert>}
      {toggle.error && <Alert severity="error">{(toggle.error as ApiError).message}</Alert>}
      {!isLoading && !error && shown.length === 0 && (
        <Alert severity="info">
          La libreria è vuota.{canManage ? " Disegna un modello con \"Nuovo workflow\", oppure pubblica qui un modello di una commessa dalla sua scheda Workflow." : ""}
        </Alert>
      )}
      {shown.map((t) => (
        <SchedaModello key={t.id} t={{ ...t, scope: "LIBRARY" }} onApri={() => setEditing({ base: t, nuovo: false })}
                       sottotitolo={t.source_template_id ? "Pubblicato da un modello di commessa" : undefined}>
          {canManage && (
            <>
              <Tooltip title="Nuova versione"><IconButton aria-label={`Nuova versione di ${t.code}`} onClick={() => setEditing({ base: t, nuovo: true })}><EditIcon /></IconButton></Tooltip>
              <Button size="small" onClick={() => toggle.mutate(t)}>{t.is_active ? "Disattiva" : "Riattiva"}</Button>
            </>
          )}
        </SchedaModello>
      ))}
      {editing && (
        <EditorWorkflow libreria={{ orgId }} base={editing.base ? { ...editing.base, scope: "LIBRARY" } : null} nuovo={editing.nuovo}
                        solaLettura={!canManage} onClose={() => setEditing(null)} />
      )}
    </Stack>
  );
}
