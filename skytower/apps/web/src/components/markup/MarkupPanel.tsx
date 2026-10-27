// "><(((º> sabusabu <º)))><"
// Pannello delle annotazioni di una revisione: nuova annotazione (sull'area disegnata o generale),
// elenco filtrabile, risposte, risolvi/riapri.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Box, Button, Chip, Divider, IconButton, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip,
  Typography,
} from "@mui/material";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CloseIcon from "@mui/icons-material/Close";
import ReplayIcon from "@mui/icons-material/Replay";
import { api, ApiError, type Anchor, type Markup } from "../../api";

export const COLORS = ["#e53935", "#fb8c00", "#fdd835", "#43a047", "#1e88e5", "#8e24aa"];

export function MarkupPanel({ revisionId, taskId, markups, numbers, selectedId, draft, onClearDraft, onSelect }: {
  revisionId: string;
  taskId?: string;
  markups: Markup[];
  numbers: Map<string, number>;
  selectedId: string | null;
  draft: Anchor | null;
  onClearDraft: () => void;
  onSelect: (m: Markup) => void;
}) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"OPEN" | "ALL">("OPEN");
  const [text, setText] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["markups", revisionId] });

  const create = useMutation({
    mutationFn: () => api<Markup>(`/revisions/${revisionId}/markups`, {
      method: "POST", json: { body: text.trim(), color, task_id: taskId ?? null, ...(draft ?? {}) },
    }),
    onSuccess: (m) => { setText(""); onClearDraft(); refresh(); onSelect(m); },
  });
  const shown = markups.filter((m) => filter === "ALL" || m.status === "OPEN");
  const open = markups.filter((m) => m.status === "OPEN").length;

  return (
    <Stack sx={{ height: "100%", minHeight: 0 }}>
      <Box px={2} pt={1.5} pb={1}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography fontWeight={600}>Annotazioni</Typography>
          <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v) => v && setFilter(v)}>
            <ToggleButton value="OPEN">Aperte {open}</ToggleButton>
            <ToggleButton value="ALL">Tutte {markups.length}</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
      </Box>
      <Paper variant="outlined" sx={{ mx: 2, p: 1.5, borderColor: draft ? "primary.main" : "divider" }}>
        <Typography variant="caption" color="text.secondary" display="block" mb={1}>
          {draft
            ? `${draft.w ? "Area" : "Punto"} a pagina ${draft.page}`
            : "Commento generale. Per annotare un punto, attiva \"Annota\" e traccia un'area sulla pagina."}
        </Typography>
        <TextField size="small" fullWidth multiline minRows={2} maxRows={8} placeholder="Scrivi l'osservazione…"
                   value={text} onChange={(e) => setText(e.target.value)} inputProps={{ maxLength: 4000 }} />
        <Stack direction="row" alignItems="center" gap={0.5} mt={1}>
          {COLORS.map((c) => (
            <Box key={c} component="button" type="button" aria-label={`Colore ${c}`} onClick={() => setColor(c)}
                 sx={{ width: 20, height: 20, borderRadius: "50%", bgcolor: c, border: 0, cursor: "pointer", p: 0,
                       outline: c === color ? "2px solid" : "none", outlineColor: "text.primary", outlineOffset: 2 }} />
          ))}
          <Box flexGrow={1} />
          {draft && <IconButton size="small" aria-label="Annulla area" onClick={onClearDraft}><CloseIcon fontSize="small" /></IconButton>}
          <Button size="small" variant="contained" disabled={!text.trim() || create.isPending} onClick={() => create.mutate()}>
            Aggiungi
          </Button>
        </Stack>
        {create.error && <Alert severity="error" sx={{ mt: 1 }}>{(create.error as ApiError).message}</Alert>}
      </Paper>
      <Box flexGrow={1} overflow="auto" px={2} py={1.5} minHeight={0}>
        {shown.length === 0 && (
          <Typography variant="body2" color="text.secondary" textAlign="center" py={4}>
            {markups.length ? "Nessuna annotazione aperta." : "Nessuna annotazione su questa revisione."}
          </Typography>
        )}
        <Stack spacing={1}>
          {shown.map((m) => (
            <MarkupCard key={m.id} m={m} n={numbers.get(m.id)} selected={m.id === selectedId} onSelect={() => onSelect(m)}
                        onChanged={refresh} />
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}

function MarkupCard({ m, n, selected, onSelect, onChanged }: {
  m: Markup; n?: number; selected: boolean; onSelect: () => void; onChanged: () => void;
}) {
  const [reply, setReply] = useState("");
  const send = useMutation({
    mutationFn: () => api(`/markups/${m.id}/replies`, { method: "POST", json: { body: reply.trim() } }),
    onSuccess: () => { setReply(""); onChanged(); },
  });
  const status = useMutation({
    mutationFn: (s: "OPEN" | "RESOLVED") => api(`/markups/${m.id}/status`, { method: "POST", json: { status: s } }),
    onSuccess: onChanged,
  });
  const err = (send.error || status.error) as ApiError | null;

  return (
    <Paper variant="outlined" onClick={onSelect}
           sx={{ p: 1.25, cursor: "pointer", borderLeft: `4px solid ${m.color}`, opacity: m.status === "RESOLVED" ? 0.7 : 1,
                 borderColor: selected ? "primary.main" : undefined, borderLeftColor: m.color }}>
      <Stack direction="row" alignItems="center" gap={1} mb={0.5}>
        <Chip size="small" label={n} sx={{ bgcolor: m.color, color: "#fff", fontWeight: 700, height: 20 }} />
        <Typography variant="caption" color="text.secondary" flexGrow={1} noWrap>
          {m.page ? `pag. ${m.page} · ` : m.element_ref ? `elemento ${m.element_ref} · ` : "generale · "}
          {m.author_name} {m.author_org_code && `(${m.author_org_code})`} · {new Date(m.created_at).toLocaleDateString("it-IT")}
        </Typography>
        {m.can_resolve && (m.status === "OPEN" ? (
          <Tooltip title="Risolvi">
            <IconButton size="small" color="success" disabled={status.isPending}
                        onClick={(e) => { e.stopPropagation(); status.mutate("RESOLVED"); }}><CheckCircleIcon fontSize="small" /></IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="Riapri">
            <IconButton size="small" disabled={status.isPending}
                        onClick={(e) => { e.stopPropagation(); status.mutate("OPEN"); }}><ReplayIcon fontSize="small" /></IconButton>
          </Tooltip>
        ))}
      </Stack>
      <Typography variant="body2" whiteSpace="pre-wrap">{m.body}</Typography>
      {m.status === "RESOLVED" && (
        <Typography variant="caption" color="success.main">Risolta da {m.resolved_by_name}</Typography>
      )}
      {m.replies.length > 0 && <Divider sx={{ my: 1 }} />}
      {m.replies.map((r) => (
        <Box key={r.id} mb={0.75}>
          <Typography variant="caption" color="text.secondary">{r.author_name} · {new Date(r.created_at).toLocaleString("it-IT")}</Typography>
          <Typography variant="body2" whiteSpace="pre-wrap">{r.body}</Typography>
        </Box>
      ))}
      {selected && (
        <Stack direction="row" gap={1} mt={1} onClick={(e) => e.stopPropagation()}>
          <TextField size="small" fullWidth placeholder="Rispondi…" value={reply} onChange={(e) => setReply(e.target.value)}
                     inputProps={{ maxLength: 4000 }}
                     onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && reply.trim()) { e.preventDefault(); send.mutate(); } }} />
          <Button size="small" disabled={!reply.trim() || send.isPending} onClick={() => send.mutate()}>Invia</Button>
        </Stack>
      )}
      {err && <Alert severity="error" sx={{ mt: 1 }}>{err.message}</Alert>}
    </Paper>
  );
}
