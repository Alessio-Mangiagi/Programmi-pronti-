// "><(((º> sabusabu <º)))><"
// Naming convention della commessa e schemi di naming per cartelle (il Project Admin li definisce qui e li applica
// alle cartelle scelte da un albero in un popup), rinomina automatica in caricamento (progressivo deciso dal Project
// Admin) e prenotazione degli identificativi per chi carica; filigrana sui PDF (Watermark.tsx).
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Checkbox, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  FormGroup, IconButton, MenuItem, Paper, Radio, RadioGroup, Stack, Switch, Tab, Table, TableBody, TableCell,
  TableHead, TableRow, Tabs, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderIcon from "@mui/icons-material/Folder";
import { api, ApiError, Container, Project } from "../../api";
import { folderTree, useContainers } from "../../components/ProjectTree";
import { WatermarkPanel } from "./Watermark";

export interface NamingField {
  key: string;
  label: string;
  kind: "fixed" | "list" | "regex";
  min_length: number;
  max_length: number;
  value: string | null;
  codes: Record<string, string>;
  pattern: string | null;
  example: string | null;
  help: string | null;
}

export interface AutoNumbering {
  field: string;
  start: number;
  series: string[] | null;
  defaults: Record<string, string>;
  reservation_days?: number | null;
}

export type NamingScheme = { separator: string; fields: NamingField[] };

export interface DocumentSettings {
  naming_scheme: NamingScheme;
  metadata_schema: Record<string, unknown>;
  custom_naming: boolean;
  example: string;
  auto_number: AutoNumbering | null;
}

export interface NamingProfile {
  id: string;
  name: string;
  naming_scheme: NamingScheme;
  auto_number: AutoNumbering | null;
  example: string;
  container_ids: string[];
}

export interface FolderNaming {
  naming_scheme: NamingScheme;
  auto_number: AutoNumbering | null;
  example: string;
  profile: { id: string; name: string } | null;
}

export function useDocumentSettings(projectId: string) {
  return useQuery({
    queryKey: ["document-settings", projectId],
    queryFn: () => api<DocumentSettings>(`/projects/${projectId}/document-settings`),
  });
}

/** Schema che vale per i caricamenti in una cartella: il suo, se il Project Admin gliene ha applicato uno. */
export function useFolderNaming(containerId: string) {
  return useQuery({
    queryKey: ["folder-naming", containerId],
    queryFn: () => api<FolderNaming>(`/containers/${containerId}/naming`),
  });
}

function useNamingProfiles(projectId: string) {
  return useQuery({
    queryKey: ["naming-profiles", projectId],
    queryFn: () => api<NamingProfile[]>(`/projects/${projectId}/naming-profiles`),
  });
}

/** Campi che chi carica sceglie: né fissi, né il progressivo, né l'originatore (è sempre la propria organizzazione). */
export function choosableFields(fields: NamingField[], auto: AutoNumbering) {
  return fields.filter((f) => f.kind !== "fixed" && f.key !== auto.field && f.key !== "originator");
}

/** Selettore di un valore di campo: lista di codici o testo libero validato dal server. */
export function FieldValueInput({ field, value, onChange, allowEmpty }: {
  field: NamingField; value: string; onChange: (v: string) => void; allowEmpty?: boolean;
}) {
  if (field.kind === "list")
    return (
      <TextField select size="small" label={field.label} value={value} onChange={(e) => onChange(e.target.value)} sx={{ minWidth: 180 }}>
        {allowEmpty && <MenuItem value=""><em>nessuno</em></MenuItem>}
        {Object.entries(field.codes).map(([code, label]) => <MenuItem key={code} value={code}>{code} — {label}</MenuItem>)}
      </TextField>
    );
  return (
    <TextField size="small" label={field.label} value={value} helperText={field.help ?? undefined} sx={{ width: 190 }}
               inputProps={{ maxLength: field.max_length, style: { textTransform: "uppercase" } }}
               onChange={(e) => onChange(e.target.value.toUpperCase())} />
  );
}

/** Quello che si modifica nella scheda: lo schema della commessa o uno schema per cartelle. */
interface NamingTarget {
  key: string;
  scheme: NamingScheme;
  custom: boolean;
  example: string;
  auto: AutoNumbering | null;
  profileId: string | null;
  /** scheme: null = torna allo schema predefinito (solo commessa), undefined = invariato */
  save: (scheme: NamingScheme | null | undefined, auto: AutoNumbering | null) => Promise<unknown>;
}

export function NamingTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: settings } = useDocumentSettings(project.id);
  const { data: profiles = [] } = useNamingProfiles(project.id);
  const [current, setCurrent] = useState("project");
  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState<NamingProfile | null>(null);
  const profile = profiles.find((p) => p.id === current) ?? null;
  useEffect(() => { if (current !== "project" && profiles.length && !profile) setCurrent("project"); }, [profiles, profile, current]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["document-settings", project.id] });
    qc.invalidateQueries({ queryKey: ["naming-profiles", project.id] });
    qc.invalidateQueries({ queryKey: ["folder-naming"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => api(`/naming-profiles/${id}`, { method: "DELETE" }),
    onSuccess: () => { setCurrent("project"); refresh(); qc.invalidateQueries({ queryKey: ["containers", project.id] }); },
  });

  if (!settings) return null;
  const canWrite = Object.values(project.my_permissions?.WRITE ?? {}).some(Boolean)
    || Object.values(project.my_permissions?.ADMIN ?? {}).some(Boolean);
  const target: NamingTarget = profile ? {
    key: profile.id, scheme: profile.naming_scheme, custom: true, example: profile.example, auto: profile.auto_number,
    profileId: profile.id,
    save: (scheme, auto) => api(`/naming-profiles/${profile.id}`, {
      method: "PUT", json: { name: profile.name, naming_scheme: scheme ?? profile.naming_scheme, auto_number: auto } }),
  } : {
    key: "project", scheme: settings.naming_scheme, custom: settings.custom_naming, example: settings.example,
    auto: settings.auto_number, profileId: null,
    save: (scheme, auto) => api(`/projects/${project.id}/document-settings`, {
      method: "PUT",
      json: { naming_scheme: scheme === undefined ? (settings.custom_naming ? settings.naming_scheme : null) : scheme,
              metadata_schema: settings.metadata_schema, auto_number: auto } }),
  };

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }} component="section" aria-label="Schemi di naming">
        <Typography variant="subtitle1" fontWeight={600}>Schemi di naming</Typography>
        <Typography variant="body2" color="text.secondary" mb={1}>
          Ogni cartella usa lo schema della commessa, a meno che non le venga applicato uno schema per cartelle
          (es. foto di cantiere, modelli BIM): crealo qui e applicalo alle cartelle che vuoi.
        </Typography>
        <Stack direction="row" alignItems="center" flexWrap="wrap" useFlexGap>
          <Tabs value={profile ? profile.id : "project"} onChange={(_, v) => setCurrent(v)} variant="scrollable" scrollButtons="auto"
                sx={{ flexGrow: 1, minWidth: 0 }} aria-label="Schema da modificare">
            <Tab value="project" label="Commessa (predefinito)" />
            {profiles.map((p) => <Tab key={p.id} value={p.id} label={`${p.name} · ${p.container_ids.length} cart.`} />)}
          </Tabs>
          {canManage && <Button startIcon={<AddIcon />} onClick={() => setCreating(true)}>Nuovo schema per cartelle</Button>}
        </Stack>
        {profile && (
          <ProfileHeader key={profile.id} project={project} profile={profile} canManage={canManage}
                         onApply={() => setPicking(profile)} onRenamed={refresh}
                         onDelete={() => { if (confirm(`Eliminare lo schema «${profile.name}»? Le sue cartelle tornano allo schema della commessa.`)) remove.mutate(profile.id); }} />
        )}
        {!profile && profiles.length > 0 && (
          <Typography variant="body2" mt={1}>
            Cartelle con uno schema proprio: {profiles.reduce((n, p) => n + p.container_ids.length, 0)} — tutte le altre usano questo.
          </Typography>
        )}
      </Paper>

      <NamingEditor key={target.key} target={target} canManage={canManage} onSaved={refresh} />
      {target.auto && canWrite && <ReservationsPanel key={`r-${target.key}`} project={project} scheme={target.scheme}
                                                    auto={target.auto} profileId={target.profileId} />}
      {!profile && <WatermarkPanel project={project} canManage={canManage} />}

      {creating && <NewProfileDialog project={project} onClose={() => setCreating(false)}
                                     onCreated={(p) => { setCreating(false); refresh(); setCurrent(p.id); setPicking(p); }} />}
      {picking && <ApplyToFoldersDialog project={project} profile={picking} profiles={profiles} onClose={() => setPicking(null)}
                                        onSaved={() => { setPicking(null); refresh(); qc.invalidateQueries({ queryKey: ["containers", project.id] }); }} />}
    </Stack>
  );
}

function ProfileHeader({ project, profile, canManage, onApply, onRenamed, onDelete }: {
  project: Project; profile: NamingProfile; canManage: boolean; onApply: () => void; onRenamed: () => void; onDelete: () => void;
}) {
  const [name, setName] = useState(profile.name);
  const { data: containers = [] } = useContainers(project.id);
  const names = containers.filter((c) => profile.container_ids.includes(c.id)).map((c) => c.name);
  const rename = useMutation({
    mutationFn: () => api(`/naming-profiles/${profile.id}`, {
      method: "PUT", json: { name, naming_scheme: profile.naming_scheme, auto_number: profile.auto_number } }),
    onSuccess: onRenamed,
  });
  return (
    <Stack spacing={1} mt={1.5}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField size="small" label="Nome dello schema" value={name} disabled={!canManage} sx={{ width: 260 }}
                   inputProps={{ maxLength: 80 }} onChange={(e) => setName(e.target.value)} />
        {canManage && name.trim() && name !== profile.name && (
          <Button disabled={rename.isPending} onClick={() => rename.mutate()}>Rinomina</Button>
        )}
        {canManage && <Button variant="contained" startIcon={<FolderIcon />} onClick={onApply}>Applica a cartelle…</Button>}
        {canManage && <Button color="error" startIcon={<DeleteIcon />} onClick={onDelete}>Elimina schema</Button>}
      </Stack>
      {rename.error && <Alert severity="error">{(rename.error as ApiError).message}</Alert>}
      <Typography variant="body2" color="text.secondary">
        {names.length ? <>Applicato a: {names.map((n) => <Chip key={n} size="small" icon={<FolderIcon />} label={n} sx={{ mr: 0.5, mb: 0.5 }} />)}</>
          : "Non ancora applicato a nessuna cartella."}
      </Typography>
    </Stack>
  );
}

function NewProfileDialog({ project, onClose, onCreated }: {
  project: Project; onClose: () => void; onCreated: (p: NamingProfile) => void;
}) {
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api<NamingProfile>(`/projects/${project.id}/naming-profiles`, { method: "POST", json: { name: name.trim() } }),
    onSuccess: onCreated,
  });
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Nuovo schema per cartelle</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Parte come copia dello schema della commessa: poi lo modifichi e scegli a quali cartelle applicarlo.
        </Typography>
        <TextField autoFocus fullWidth size="small" label="Nome (es. Foto di cantiere)" value={name} inputProps={{ maxLength: 80 }}
                   onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) create.mutate(); }} />
        {create.error && <Alert severity="error" sx={{ mt: 2 }}>{(create.error as ApiError).message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Crea</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Popup con l'albero delle cartelle: lo schema vale esattamente per quelle spuntate
// ---------------------------------------------------------------------
function ApplyToFoldersDialog({ project, profile, profiles, onClose, onSaved }: {
  project: Project; profile: NamingProfile; profiles: NamingProfile[]; onClose: () => void; onSaved: () => void;
}) {
  const { data: containers } = useContainers(project.id);
  const tree = useMemo(() => folderTree(containers ?? []), [containers]);
  const [checked, setChecked] = useState<Set<string>>(new Set(profile.container_ids));
  const [withChildren, setWithChildren] = useState(true);
  const [open, setOpen] = useState<Set<string>>(new Set());
  useEffect(() => {                                  // aperte le cartelle che portano a quelle già spuntate
    if (!containers) return;
    const byId = new Map(containers.map((c) => [c.id, c]));
    const o = new Set<string>();
    for (const id of profile.container_ids) for (let c = byId.get(id); c?.parent_id; c = byId.get(c.parent_id)) o.add(c.parent_id);
    setOpen(o);
  }, [containers, profile.container_ids]);
  const other = new Map(profiles.filter((p) => p.id !== profile.id).flatMap((p) => p.container_ids.map((id) => [id, p.name] as const)));

  const descendants = (id: string): string[] => (tree.get(id) ?? []).flatMap((c) => [c.id, ...descendants(c.id)]);
  const toggle = (c: Container, on: boolean) => setChecked((cur) => {
    const next = new Set(cur);
    for (const id of [c.id, ...(withChildren ? descendants(c.id) : [])]) { if (on) next.add(id); else next.delete(id); }
    return next;
  });
  const save = useMutation({
    mutationFn: () => api(`/naming-profiles/${profile.id}/containers`, { method: "PUT", json: { container_ids: [...checked] } }),
    onSuccess: onSaved,
  });
  const moved = [...checked].filter((id) => other.has(id)).length;

  const render = (parent: string | null, depth: number): JSX.Element[] => (tree.get(parent) ?? []).map((c) => {
    const kids = tree.get(c.id) ?? [];
    const isOpen = open.has(c.id);
    return (
      <Box key={c.id}>
        <Stack direction="row" alignItems="center" pl={depth * 2.5} minHeight={34}>
          <IconButton size="small" aria-label={isOpen ? `Chiudi ${c.name}` : `Apri ${c.name}`} sx={{ visibility: kids.length ? "visible" : "hidden" }}
                      onClick={() => setOpen((o) => { const n = new Set(o); if (isOpen) n.delete(c.id); else n.add(c.id); return n; })}>
            {isOpen ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
          </IconButton>
          <FormControlLabel sx={{ mr: 1 }}
                            control={<Checkbox size="small" checked={checked.has(c.id)} onChange={(e) => toggle(c, e.target.checked)}
                                               indeterminate={!checked.has(c.id) && descendants(c.id).some((id) => checked.has(id))} />}
                            label={<Stack direction="row" alignItems="center" spacing={0.75}>
                              <FolderIcon fontSize="small" sx={{ color: c.is_private ? "#9b7ccc" : "#d9a93c" }} />
                              <Typography variant="body2">{c.name}</Typography>
                            </Stack>} />
          {other.has(c.id) && (
            <Chip size="small" variant="outlined" label={checked.has(c.id) ? `ora «${other.get(c.id)}»: passa a questo` : `schema «${other.get(c.id)}»`}
                  color={checked.has(c.id) ? "warning" : "default"} />
          )}
        </Stack>
        {kids.length > 0 && <Collapse in={isOpen} unmountOnExit>{render(c.id, depth + 1)}</Collapse>}
      </Box>
    );
  });

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Applica «{profile.name}» alle cartelle</DialogTitle>
      <DialogContent dividers sx={{ minHeight: 320 }}>
        <Typography variant="body2" color="text.secondary" mb={1}>
          Spunta le cartelle che devono usare questo schema; quelle non spuntate usano lo schema della commessa (o un altro
          schema per cartelle, se ne hanno uno). I documenti già caricati tengono il loro identificativo.
        </Typography>
        <FormControlLabel label="Spuntando una cartella, spunta anche le sottocartelle"
                          control={<Switch size="small" checked={withChildren} onChange={(e) => setWithChildren(e.target.checked)} />} />
        <Box role="tree" aria-label="Cartelle della commessa" mt={1}>
          {containers === undefined ? <Typography variant="body2">Caricamento…</Typography>
            : containers.length === 0 ? <Typography variant="body2">Nessuna cartella.</Typography> : render(null, 0)}
        </Box>
        {save.error && <Alert severity="error" sx={{ mt: 2 }}>{(save.error as ApiError).message}</Alert>}
      </DialogContent>
      <DialogActions>
        <Typography variant="body2" color="text.secondary" mr="auto" ml={2}>
          {checked.size} cartell{checked.size === 1 ? "a" : "e"}{moved ? ` · ${moved} cambiano schema` : ""}
        </Typography>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate()}>Applica</Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------
// Schema e rinomina automatica dello schema selezionato
// ---------------------------------------------------------------------
type SeriesMode = "combination" | "project" | "custom";

function NamingEditor({ target, canManage, onSaved }: { target: NamingTarget; canManage: boolean; onSaved: () => void }) {
  const [enabled, setEnabled] = useState(!!target.auto);
  const [auto, setAuto] = useState<AutoNumbering>(() => {
    if (target.auto) return target.auto;
    const numeric = target.scheme.fields.find((f) => f.kind === "regex" && /\\d/.test(f.pattern ?? ""));
    return { field: numeric?.key ?? "number", start: 1, series: null, defaults: {} };
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editingScheme, setEditingScheme] = useState(false);

  const save = useMutation({
    mutationFn: () => target.save(undefined,
      enabled ? { ...auto, defaults: Object.fromEntries(Object.entries(auto.defaults).filter(([, v]) => v)) } : null),
    onSuccess: () => { setError(null); setSaved(true); onSaved(); },
    onError: (e: ApiError) => { setSaved(false); setError(e.message); },
  });

  const fields = target.scheme.fields;
  const numericFields = fields.filter((f) => f.kind === "regex");
  const others = fields.filter((f) => f.key !== auto.field);
  const mode: SeriesMode = auto.series === null ? "combination" : auto.series.length === 0 ? "project" : "custom";
  const numberField = fields.find((f) => f.key === auto.field);
  const sample = fields.map((f) => f.kind === "fixed" ? f.value
    : f.key === auto.field ? String(Math.max(auto.start, 1)).padStart(numberField?.min_length ?? 4, "0")
    : f.key === "originator" ? "‹organizzazione›"
    : auto.defaults[f.key] || `‹${f.label.toLowerCase()}›`).join(target.scheme.separator);

  return (
    <>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1" fontWeight={600}>
            {target.profileId ? "Naming convention dello schema" : "Naming convention ISO 19650"}
          </Typography>
          {canManage && !editingScheme && <Button onClick={() => setEditingScheme(true)}>Modifica schema</Button>}
        </Stack>
        <Typography variant="body2" color="text.secondary" mb={1}>
          {target.profileId ? "Vale per le cartelle a cui è applicato" : target.custom ? "Schema personalizzato del progetto" : "Schema predefinito (UK NA)"}
          {" "}· esempio <Chip size="small" label={target.example} sx={{ fontFamily: "monospace" }} />
        </Typography>
        {editingScheme
          ? <SchemeEditor scheme={target.scheme} canReset={!target.profileId && target.custom}
                          onSave={async (scheme) => { await target.save(scheme, target.auto); onSaved(); setEditingScheme(false); }}
                          onCancel={() => setEditingScheme(false)} />
          : <Table size="small">
          <TableHead><TableRow><TableCell>Campo</TableCell><TableCell>Tipo</TableCell><TableCell>Valori</TableCell></TableRow></TableHead>
          <TableBody>
            {fields.map((f) => (
              <TableRow key={f.key}>
                <TableCell>{f.label}</TableCell>
                <TableCell>{{ fixed: "fisso", list: "lista di codici", regex: "formato" }[f.kind]}</TableCell>
                <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>
                  {f.kind === "fixed" ? f.value : f.kind === "list" ? Object.keys(f.codes).join(" · ") : f.help ?? f.pattern}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1" fontWeight={600}>Rinomina automatica in caricamento</Typography>
          <FormControlLabel label={enabled ? "Attiva" : "Disattivata"} disabled={!canManage}
                            control={<Switch checked={enabled} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} />} />
        </Stack>
        <Typography variant="body2" color="text.secondary" mb={2}>
          Chi carica un file con un nome qualsiasi può farlo rinominare secondo la naming convention: sceglie i campi,
          il progressivo lo assegna la piattaforma. Il nome originale resta nelle note della revisione.
        </Typography>

        {enabled && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              <TextField select size="small" label="Campo progressivo" value={auto.field} disabled={!canManage} sx={{ minWidth: 200 }}
                         onChange={(e) => setAuto({ ...auto, field: e.target.value })}>
                {numericFields.map((f) => <MenuItem key={f.key} value={f.key}>{f.label}</MenuItem>)}
              </TextField>
              <TextField size="small" type="number" label="Primo numero" value={auto.start} disabled={!canManage} sx={{ width: 140 }}
                         inputProps={{ min: 0 }} onChange={(e) => setAuto({ ...auto, start: Math.max(0, Number(e.target.value) || 0) })} />
              <TextField size="small" type="number" label="Scadenza prenotazioni (giorni)" disabled={!canManage} sx={{ width: 230 }}
                         value={auto.reservation_days ?? ""} helperText="Vuoto = le prenotazioni non scadono"
                         inputProps={{ min: 1, max: 3650 }}
                         onChange={(e) => setAuto({ ...auto, reservation_days: e.target.value ? Math.min(3650, Math.max(1, Number(e.target.value))) : null })} />
            </Stack>

            <div>
              <Typography variant="body2" fontWeight={600}>Serie di numerazione</Typography>
              <RadioGroup value={mode} onChange={(e) => {
                const m = e.target.value as SeriesMode;
                setAuto({ ...auto, series: m === "combination" ? null : m === "project" ? [] : others.filter((f) => f.kind !== "fixed").slice(0, 1).map((f) => f.key) });
              }}>
                <FormControlLabel value="combination" disabled={!canManage} control={<Radio size="small" />}
                                  label="Un progressivo per ogni combinazione degli altri campi (consigliato ISO 19650)" />
                <FormControlLabel value="project" disabled={!canManage} control={<Radio size="small" />}
                                  label="Un unico progressivo per tutta la commessa" />
                <FormControlLabel value="custom" disabled={!canManage} control={<Radio size="small" />}
                                  label="Un progressivo per i campi scelti:" />
              </RadioGroup>
              {mode === "custom" && (
                <FormGroup row sx={{ pl: 4 }}>
                  {others.filter((f) => f.kind !== "fixed").map((f) => (
                    <FormControlLabel key={f.key} label={f.label} disabled={!canManage} control={
                      <Checkbox size="small" checked={auto.series!.includes(f.key)} onChange={(e) => setAuto({
                        ...auto, series: e.target.checked ? [...auto.series!, f.key] : auto.series!.filter((k) => k !== f.key),
                      })} />} />
                  ))}
                </FormGroup>
              )}
            </div>

            <div>
              <Typography variant="body2" fontWeight={600} mb={1}>Valori proposti (modificabili da chi carica)</Typography>
              <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                {choosableFields(fields, auto).map((f) => (
                  <FieldValueInput key={f.key} field={f} allowEmpty value={auto.defaults[f.key] ?? ""}
                                   onChange={(v) => setAuto({ ...auto, defaults: { ...auto.defaults, [f.key]: v } })} />
                ))}
              </Stack>
            </div>

            <Typography variant="body2">
              Anteprima: <Chip size="small" label={sample} sx={{ fontFamily: "monospace" }} />
            </Typography>
          </Stack>
        )}

        {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
        {saved && !error && <Alert severity="success" sx={{ mt: 2 }}>Impostazioni salvate</Alert>}
        {canManage && (
          <Stack direction="row" justifyContent="flex-end" mt={2}>
            <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate()}>Salva</Button>
          </Stack>
        )}
      </Paper>
    </>
  );
}

// ---------------------------------------------------------------------
// Editor dello schema (Project Admin): campi, ordine, codici, formati, separatore
// ---------------------------------------------------------------------
const codesToText = (codes: Record<string, string>) => Object.entries(codes).map(([k, v]) => `${k} = ${v}`).join("\n");
const textToCodes = (text: string) => Object.fromEntries(text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
  const [code, ...label] = l.split("=");
  return [code.trim().toUpperCase(), label.join("=").trim() || code.trim().toUpperCase()];
}));

function blankField(n: number): NamingField {
  return { key: `campo_${"abcdefghijkl"[n] ?? "x"}`, label: "Nuovo campo", kind: "list", min_length: 1, max_length: 3,
           value: null, codes: { XX: "Da definire" }, pattern: null, example: null, help: null };
}

function SchemeEditor({ scheme, canReset, onSave, onCancel }: {
  scheme: NamingScheme; canReset: boolean; onSave: (scheme: NamingScheme | null) => Promise<void>; onCancel: () => void;
}) {
  const [separator, setSeparator] = useState(scheme.separator);
  const [fields, setFields] = useState<NamingField[]>(scheme.fields.map((f) => ({ ...f })));
  const [codesText, setCodesText] = useState<string[]>(scheme.fields.map((f) => codesToText(f.codes)));
  const [error, setError] = useState<string | null>(null);

  const put = useMutation({ mutationFn: onSave, onError: (e: ApiError) => setError(e.message) });

  const set = (i: number, patch: Partial<NamingField>) => setFields((l) => l.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => {
    const swap = <T,>(l: T[]) => { const c = [...l]; [c[i], c[i + d]] = [c[i + d], c[i]]; return c; };
    setFields(swap); setCodesText(swap);
  };
  const remove = (i: number) => { setFields((l) => l.filter((_, k) => k !== i)); setCodesText((l) => l.filter((_, k) => k !== i)); };
  const add = () => { const f = blankField(fields.length); setFields((l) => [...l, f]); setCodesText((l) => [...l, codesToText(f.codes)]); };

  const draft = (): NamingScheme => ({
    separator,
    fields: fields.map((f, i) => ({
      ...f,
      value: f.kind === "fixed" ? (f.value ?? "").toUpperCase() : null,
      codes: f.kind === "list" ? textToCodes(codesText[i]) : {},
      pattern: f.kind === "regex" ? f.pattern : null,
    })),
  });
  const preview = draft().fields.map((f) => f.kind === "fixed" ? f.value : f.kind === "list" ? Object.keys(f.codes)[0] ?? "?"
    : f.example || "#".repeat(f.min_length)).join(separator);

  return (
    <Stack spacing={1.5}>
      <Alert severity="warning">
        I documenti già caricati mantengono il loro identificativo: lo schema vale per i nuovi caricamenti.
        Con uno schema personalizzato l'elenco degli originatori non si aggiorna più da solo quando entra una nuova organizzazione.
      </Alert>
      <TextField select size="small" label="Separatore" value={separator} onChange={(e) => setSeparator(e.target.value)} sx={{ width: 160 }}>
        {["-", "_", "."].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
      </TextField>
      {fields.map((f, i) => (
        <Paper key={i} variant="outlined" sx={{ p: 1.5 }}>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="flex-start">
            <TextField size="small" label="Etichetta" value={f.label} onChange={(e) => set(i, { label: e.target.value })} sx={{ width: 180 }} />
            <TextField size="small" label="Chiave" value={f.key} title="Solo lettere minuscole e _"
                       onChange={(e) => set(i, { key: e.target.value.toLowerCase().replace(/[^a-z_]/g, "") })} sx={{ width: 140 }} />
            <TextField select size="small" label="Tipo" value={f.kind} sx={{ width: 160 }}
                       onChange={(e) => set(i, { kind: e.target.value as NamingField["kind"],
                                                  pattern: e.target.value === "regex" ? f.pattern ?? "\\d{4}" : f.pattern })}>
              <MenuItem value="fixed">Fisso</MenuItem>
              <MenuItem value="list">Lista di codici</MenuItem>
              <MenuItem value="regex">Formato (regex)</MenuItem>
            </TextField>
            <TextField size="small" type="number" label="Min" value={f.min_length} sx={{ width: 80 }}
                       onChange={(e) => set(i, { min_length: Number(e.target.value) || 1 })} />
            <TextField size="small" type="number" label="Max" value={f.max_length} sx={{ width: 80 }}
                       onChange={(e) => set(i, { max_length: Number(e.target.value) || 1 })} />
            <Stack direction="row" ml="auto">
              <IconButton size="small" aria-label={`Sposta ${f.label} prima`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" aria-label={`Sposta ${f.label} dopo`} disabled={i === fields.length - 1} onClick={() => move(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" aria-label={`Elimina il campo ${f.label}`} disabled={fields.length <= 2} onClick={() => remove(i)}><DeleteIcon fontSize="small" /></IconButton>
            </Stack>
          </Stack>
          <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
            {f.kind === "fixed" && <TextField size="small" label="Valore" value={f.value ?? ""} sx={{ width: 180 }}
                                              onChange={(e) => set(i, { value: e.target.value.toUpperCase() })} />}
            {f.kind === "list" && <TextField size="small" multiline minRows={2} maxRows={8} fullWidth label="Codici (uno per riga: CODICE = descrizione)"
                                             value={codesText[i]} onChange={(e) => setCodesText((l) => l.map((t, k) => (k === i ? e.target.value : t)))} />}
            {f.kind === "regex" && <>
              <TextField size="small" label="Espressione regolare" value={f.pattern ?? ""} sx={{ width: 220, fontFamily: "monospace" }}
                         onChange={(e) => set(i, { pattern: e.target.value })} />
              <TextField size="small" label="Esempio" value={f.example ?? ""} sx={{ width: 120 }}
                         onChange={(e) => set(i, { example: e.target.value.toUpperCase() || null })} />
              <TextField size="small" label="Aiuto per chi carica" value={f.help ?? ""} sx={{ flexGrow: 1, minWidth: 200 }}
                         onChange={(e) => set(i, { help: e.target.value || null })} />
            </>}
          </Stack>
        </Paper>
      ))}
      <Stack direction="row" spacing={1} alignItems="center">
        <Button startIcon={<AddIcon />} disabled={fields.length >= 12} onClick={add}>Campo</Button>
        <Typography variant="body2" ml={2}>Esempio: <Chip size="small" label={preview} sx={{ fontFamily: "monospace" }} /></Typography>
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction="row" spacing={1} justifyContent="flex-end">
        {canReset && <Button color="warning" disabled={put.isPending} onClick={() => put.mutate(null)}>Ripristina schema predefinito</Button>}
        <Button onClick={onCancel}>Annulla</Button>
        <Button variant="contained" disabled={put.isPending} onClick={() => { setError(null); put.mutate(draft()); }}>Salva schema</Button>
      </Stack>
    </Stack>
  );
}

// ---------------------------------------------------------------------
// Prenotazione degli identificativi (elenco elaborati): per chi carica, con il progressivo attivo
// ---------------------------------------------------------------------
interface Reservation {
  id: string;
  identifier: string;
  note: string | null;
  created_at: string;
  used_at: string | null;
  released_at: string | null;
  document_id: string | null;
  reserved_by_name: string;
}

function ReservationsPanel({ project, scheme, auto, profileId }: {
  project: Project; scheme: NamingScheme; auto: AutoNumbering; profileId: string | null;
}) {
  const qc = useQueryClient();
  const fieldsList = choosableFields(scheme.fields, auto);
  const [fields, setFields] = useState<Record<string, string>>(
    Object.fromEntries(fieldsList.map((f) => [f.key, auto.defaults[f.key] ?? ""])));
  const [count, setCount] = useState(5);
  const [note, setNote] = useState("");
  const [showAll, setShowAll] = useState(false);
  const key = ["naming-reservations", project.id, showAll];
  const { data: list = [] } = useQuery({
    queryKey: key,
    queryFn: () => api<Reservation[]>(`/projects/${project.id}/naming/reservations?status=${showAll ? "all" : "open"}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["naming-reservations", project.id] });
  const reserve = useMutation({
    mutationFn: () => api<Reservation[]>(`/projects/${project.id}/naming/reservations`, {
      method: "POST", json: { fields, count, note: note || null, profile_id: profileId } }),
    onSuccess: () => { setNote(""); refresh(); },
  });
  const release = useMutation({
    mutationFn: (id: string) => api(`/naming/reservations/${id}/release`, { method: "POST" }),
    onSuccess: refresh,
  });
  const copyAll = () => navigator.clipboard?.writeText(list.filter((r) => !r.used_at && !r.released_at).map((r) => r.identifier).join("\n"));
  const status = (r: Reservation) => r.used_at ? <Chip size="small" color="success" label="Usato" />
    : r.released_at ? <Chip size="small" label="Rilasciato" /> : <Chip size="small" color="primary" variant="outlined" label="Prenotato" />;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" fontWeight={600}>Prenota numeri</Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Per un elenco elaborati da produrre: prenota gli identificativi in anticipo{profileId ? ", con questo schema" : ""}. Restano
        riservati alla tua organizzazione finché un caricamento con quel nome non li usa
        {auto.reservation_days ? ` (al massimo ${auto.reservation_days} giorni, poi vengono rilasciati in automatico)` : ""}.
        Un numero rilasciato non torna disponibile.
      </Typography>
      <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap alignItems="flex-start">
        {fieldsList.map((f) => (
          <FieldValueInput key={f.key} field={f} value={fields[f.key] ?? ""} onChange={(v) => setFields({ ...fields, [f.key]: v })} />
        ))}
        <TextField size="small" type="number" label="Quanti" value={count} sx={{ width: 100 }} inputProps={{ min: 1, max: 50 }}
                   onChange={(e) => setCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))} />
        <TextField size="small" label="Nota (es. elenco tavole piano terra)" value={note} sx={{ flexGrow: 1, minWidth: 240 }}
                   inputProps={{ maxLength: 500 }} onChange={(e) => setNote(e.target.value)} />
        <Button variant="contained" disabled={reserve.isPending} onClick={() => reserve.mutate()}>Prenota</Button>
      </Stack>
      {reserve.error && <Alert severity="error" sx={{ mt: 1 }}>{(reserve.error as ApiError).message}</Alert>}
      {release.error && <Alert severity="error" sx={{ mt: 1 }}>{(release.error as ApiError).message}</Alert>}

      <Stack direction="row" alignItems="center" spacing={1} mt={2}>
        <Typography variant="body2" fontWeight={600} flexGrow={1}>Prenotazioni della tua organizzazione</Typography>
        <FormControlLabel label="Anche usate e rilasciate" control={<Switch size="small" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />} />
        <Button size="small" disabled={!list.some((r) => !r.used_at && !r.released_at)} onClick={copyAll}>Copia elenco</Button>
      </Stack>
      {list.length === 0
        ? <Typography variant="body2" color="text.secondary">Nessuna prenotazione aperta.</Typography>
        : (
          <Table size="small">
            <TableHead><TableRow>
              <TableCell>Identificativo</TableCell><TableCell>Nota</TableCell><TableCell>Prenotato da</TableCell>
              <TableCell>Stato</TableCell><TableCell />
            </TableRow></TableHead>
            <TableBody>
              {list.map((r) => (
                <TableRow key={r.id}>
                  <TableCell sx={{ fontFamily: "monospace" }}>{r.identifier}</TableCell>
                  <TableCell>{r.note}</TableCell>
                  <TableCell>{r.reserved_by_name} · {new Date(r.created_at).toLocaleDateString("it-IT")}</TableCell>
                  <TableCell>{status(r)}</TableCell>
                  <TableCell align="right">
                    {!r.used_at && !r.released_at && (
                      <Button size="small" color="warning" disabled={release.isPending} onClick={() => release.mutate(r.id)}>Rilascia</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
    </Paper>
  );
}
