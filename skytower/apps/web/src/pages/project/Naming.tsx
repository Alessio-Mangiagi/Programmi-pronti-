// "><(((º> sabusabu <º)))><"
// Naming convention del progetto e rinomina automatica in caricamento (progressivo deciso dal Project Admin).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Checkbox, Chip, FormControlLabel, FormGroup, MenuItem, Paper, Radio, RadioGroup, Stack, Switch,
  Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
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
        <Typography variant="subtitle1" fontWeight={600}>Naming convention ISO 19650</Typography>
        <Typography variant="body2" color="text.secondary" mb={1}>
          {settings.custom_naming ? "Schema personalizzato del progetto" : "Schema predefinito (UK NA)"} · esempio{" "}
          <Chip size="small" label={settings.example} sx={{ fontFamily: "monospace" }} />
        </Typography>
        <Table size="small">
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
        </Table>
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
