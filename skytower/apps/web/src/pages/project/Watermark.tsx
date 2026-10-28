// "><(((º> sabusabu <º)))><"
// Filigrana sui PDF: il Project Admin sceglie gli stati CDE in cui i PDF si scaricano e si visualizzano solo
// timbrati con chi li apre (nome, email, organizzazione, data e ora, IP, documento e revisione).
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, FormControlLabel, FormGroup, Paper, Stack, Switch, TextField, Typography } from "@mui/material";
import { api, ApiError, Project } from "../../api";

type CdeState = "WIP" | "SHARED" | "PUBLISHED" | "ARCHIVED";
export interface Watermark { states: CdeState[]; text: string | null }

const STATES: { value: CdeState; label: string }[] = [
  { value: "WIP", label: "WIP (lavori in corso)" },
  { value: "SHARED", label: "Condiviso" },
  { value: "PUBLISHED", label: "Pubblicato" },
  { value: "ARCHIVED", label: "Archiviato" },
];

export function useWatermark(projectId: string) {
  return useQuery({
    queryKey: ["watermark", projectId],
    queryFn: () => api<{ watermark: Watermark | null }>(`/projects/${projectId}/watermark`),
    select: (d) => d.watermark,
  });
}

export function WatermarkPanel({ project, canManage }: { project: Project; canManage: boolean }) {
  const qc = useQueryClient();
  const { data: current, isSuccess } = useWatermark(project.id);
  const [enabled, setEnabled] = useState(false);
  const [states, setStates] = useState<CdeState[]>(["SHARED", "PUBLISHED"]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!isSuccess) return;
    setEnabled(!!current);
    if (current) { setStates(current.states); setText(current.text ?? ""); }
  }, [current, isSuccess]);

  const save = useMutation({
    mutationFn: () => api(`/projects/${project.id}/watermark`, {
      method: "PUT", json: enabled ? { states, text: text.trim() || null } : null,
    }),
    onSuccess: () => { setError(null); setSaved(true); qc.invalidateQueries({ queryKey: ["watermark", project.id] }); },
    onError: (e: ApiError) => { setSaved(false); setError(e.message); },
  });

  if (!isSuccess) return null;
  const toggle = (s: CdeState) => setStates((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]);

  return (
    <Paper variant="outlined" sx={{ p: 2 }} component="section" aria-label="Filigrana sui PDF">
      <Typography variant="subtitle1" fontWeight={600}>Filigrana sui PDF</Typography>
      <Typography variant="body2" color="text.secondary" mb={1}>
        Nei PDF scaricati o aperti nel visualizzatore compare su ogni pagina chi li ha aperti: nome, email,
        organizzazione, data e ora, IP, documento e revisione. Il file archiviato resta quello originale.
      </Typography>
      <FormControlLabel
        control={<Switch checked={enabled} disabled={!canManage} onChange={(e) => { setEnabled(e.target.checked); setSaved(false); }} />}
        label="Filigrana attiva"
      />
      {enabled && (
        <Stack spacing={1.5} mt={1}>
          <FormGroup row aria-label="Stati con filigrana">
            {STATES.map((s) => (
              <FormControlLabel key={s.value} label={s.label} control={
                <Checkbox checked={states.includes(s.value)} disabled={!canManage}
                  onChange={() => { toggle(s.value); setSaved(false); }} />
              } />
            ))}
          </FormGroup>
          <TextField size="small" label="Riga aggiuntiva (facoltativa)" placeholder="Es. Uso interno, non diffondere"
            value={text} disabled={!canManage} inputProps={{ maxLength: 120 }}
            onChange={(e) => { setText(e.target.value); setSaved(false); }} sx={{ maxWidth: 480 }} />
          {states.length === 0 && <Alert severity="warning">Scegliere almeno uno stato</Alert>}
        </Stack>
      )}
      {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
      {saved && !error && <Alert severity="success" sx={{ mt: 2 }}>Filigrana salvata</Alert>}
      {canManage && (
        <Stack direction="row" justifyContent="flex-end" mt={2}>
          <Button variant="contained" disabled={save.isPending || (enabled && states.length === 0)}
            onClick={() => save.mutate()}>Salva filigrana</Button>
        </Stack>
      )}
    </Paper>
  );
}
