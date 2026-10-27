// "><(((º> sabusabu <º)))><"
// Naming convention del progetto e rinomina automatica in caricamento (progressivo deciso dal Project Admin).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Checkbox, Chip, FormControlLabel, FormGroup, IconButton, MenuItem, Paper, Radio, RadioGroup, Stack,
  Switch, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import DeleteIcon from "@mui/icons-material/Delete";
import { api, ApiError, Project } from "../../api";

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
}

export interface DocumentSettings {
  naming_scheme: { separator: string; fields: NamingField[] };
  metadata_schema: Record<string, unknown>;
  custom_naming: boolean;
  example: string;
  auto_number: AutoNumbering | null;
}

export function useDocumentSettings(projectId: string) {
  return useQuery({
    queryKey: ["document-settings", projectId],
    queryFn: () => api<DocumentSettings>(`/projects/${projectId}/document-settings`),
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
    <TextField size="small" label={field.label} value={value} helperText={field.help ?? undefined} sx={{ minWidth: 140 }}
               inputProps={{ maxLength: field.max_length, style: { textTransform: "uppercase" } }}
               onChange={(e) => onChange(e.target.value.toUpperCase())} />
  );
}

type SeriesMode = "combination" | "project" | "custom";

export function NamingTab({ project, canManage }: { project: Project; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: settings } = useDocumentSettings(project.id);
  const [enabled, setEnabled] = useState(false);
  const [auto, setAuto] = useState<AutoNumbering>({ field: "number", start: 1, series: null, defaults: {} });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [editingScheme, setEditingScheme] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setEnabled(!!settings.auto_number);
    if (settings.auto_number) setAuto(settings.auto_number);
    else {
      const numeric = settings.naming_scheme.fields.find((f) => f.kind === "regex" && /\\d/.test(f.pattern ?? ""));
      setAuto((a) => ({ ...a, field: numeric?.key ?? a.field }));
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: () => api(`/projects/${project.id}/document-settings`, {
      method: "PUT",
      json: {
        naming_scheme: settings!.custom_naming ? settings!.naming_scheme : null,
        metadata_schema: settings!.metadata_schema,
        auto_number: enabled ? { ...auto, defaults: Object.fromEntries(Object.entries(auto.defaults).filter(([, v]) => v)) } : null,
      },
    }),
    onSuccess: () => { setError(null); setSaved(true); qc.invalidateQueries({ queryKey: ["document-settings", project.id] }); },
    onError: (e: ApiError) => { setSaved(false); setError(e.message); },
  });

  if (!settings) return null;
  const fields = settings.naming_scheme.fields;
  const numericFields = fields.filter((f) => f.kind === "regex");
  const others = fields.filter((f) => f.key !== auto.field);
  const mode: SeriesMode = auto.series === null ? "combination" : auto.series.length === 0 ? "project" : "custom";
  const numberField = fields.find((f) => f.key === auto.field);
  const sample = fields.map((f) => f.kind === "fixed" ? f.value
    : f.key === auto.field ? String(Math.max(auto.start, 1)).padStart(numberField?.min_length ?? 4, "0")
    : f.key === "originator" ? "‹organizzazione›"
    : auto.defaults[f.key] || `‹${f.label.toLowerCase()}›`).join(settings.naming_scheme.separator);

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1" fontWeight={600}>Naming convention ISO 19650</Typography>
          {canManage && !editingScheme && <Button onClick={() => setEditingScheme(true)}>Modifica schema</Button>}
        </Stack>
        <Typography variant="body2" color="text.secondary" mb={1}>
          {settings.custom_naming ? "Schema personalizzato del progetto" : "Schema predefinito (UK NA)"} · esempio{" "}
          <Chip size="small" label={settings.example} sx={{ fontFamily: "monospace" }} />
        </Typography>
        {editingScheme
          ? <SchemeEditor project={project} settings={settings} onDone={() => setEditingScheme(false)} />
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
    </Stack>
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

function SchemeEditor({ project, settings, onDone }: { project: Project; settings: DocumentSettings; onDone: () => void }) {
  const qc = useQueryClient();
  const [separator, setSeparator] = useState(settings.naming_scheme.separator);
  const [fields, setFields] = useState<NamingField[]>(settings.naming_scheme.fields.map((f) => ({ ...f })));
  const [codesText, setCodesText] = useState<string[]>(settings.naming_scheme.fields.map((f) => codesToText(f.codes)));
  const [error, setError] = useState<string | null>(null);

  const put = useMutation({
    mutationFn: (scheme: DocumentSettings["naming_scheme"] | null) => api(`/projects/${project.id}/document-settings`, {
      method: "PUT",
      json: { naming_scheme: scheme, metadata_schema: settings.metadata_schema, auto_number: settings.auto_number },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["document-settings", project.id] }); onDone(); },
    onError: (e: ApiError) => setError(e.message),
  });

  const set = (i: number, patch: Partial<NamingField>) => setFields((l) => l.map((f, k) => (k === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) => {
    const swap = <T,>(l: T[]) => { const c = [...l]; [c[i], c[i + d]] = [c[i + d], c[i]]; return c; };
    setFields(swap); setCodesText(swap);
  };
  const remove = (i: number) => { setFields((l) => l.filter((_, k) => k !== i)); setCodesText((l) => l.filter((_, k) => k !== i)); };
  const add = () => { const f = blankField(fields.length); setFields((l) => [...l, f]); setCodesText((l) => [...l, codesToText(f.codes)]); };

  const draft = () => ({
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
            <TextField size="small" label="Chiave" value={f.key} helperText="minuscole e _"
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
              <IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUpwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" disabled={i === fields.length - 1} onClick={() => move(i, 1)}><ArrowDownwardIcon fontSize="small" /></IconButton>
              <IconButton size="small" disabled={fields.length <= 2} onClick={() => remove(i)}><DeleteIcon fontSize="small" /></IconButton>
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
        {settings.custom_naming && <Button color="warning" disabled={put.isPending} onClick={() => put.mutate(null)}>Ripristina schema predefinito</Button>}
        <Button onClick={onDone}>Annulla</Button>
        <Button variant="contained" disabled={put.isPending} onClick={() => { setError(null); put.mutate(draft()); }}>Salva schema</Button>
      </Stack>
    </Stack>
  );
}
