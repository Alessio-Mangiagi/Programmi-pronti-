// "><(((º> sabusabu <º)))><"
// Viste per area del CDE (ISO 19650): WIP, Condivisi, Pubblicati, Archiviati — su tutto il progetto.
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Box, Button, Checkbox, Chip, InputAdornment, Paper, Stack, Tab, Table, TableBody, TableCell, TableHead, TableRow,
  Tabs, TextField, Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { api, Project } from "../../api";
import { DocumentDrawer, DocumentRow, formatBytes } from "./Documents";
import { ACTION_LABEL, CdeState, STATE_COLOR, STATE_LABEL, TransitionDialog, useTransitionRules } from "./Transitions";

const AREAS: CdeState[] = ["WIP", "SHARED", "PUBLISHED", "ARCHIVED"];
const AREA_HELP: Record<CdeState, string> = {
  WIP: "Visibile solo alla tua organizzazione.",
  SHARED: "Visibile al team di coordinamento (chi ha accesso al container).",
  PUBLISHED: "Visibile a tutti i membri del progetto.",
  ARCHIVED: "Sola lettura.",
};

export function AreasTab({ project }: { project: Project }) {
  const [area, setArea] = useState<CdeState>("WIP");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [params, setParams] = useSearchParams();
  const [openDoc, setOpenDocState] = useState<string | null>(params.get("doc"));   // link delle notifiche
  const setOpenDoc = (id: string | null) => {
    setOpenDocState(id);
    if (!id && params.has("doc")) setParams((p) => { p.delete("doc"); return p; }, { replace: true });
  };
  const [action, setAction] = useState<CdeState | null>(null);
  const { data: rules = [] } = useTransitionRules(project.id);

  useEffect(() => {
    const t = setTimeout(() => setSearch(q), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setSelected(new Set()), [area, search]);

  const { data } = useQuery({
    queryKey: ["area", project.id, area, search],
    queryFn: () => api<{ items: DocumentRow[] }>(
      `/projects/${project.id}/documents?area=${area}&limit=200${search ? `&q=${encodeURIComponent(search)}` : ""}`),
  });
  const items = data?.items ?? [];
  const targets = area === "ARCHIVED" ? [] : rules.filter((r) => r.from_state === area).map((r) => r.to_state);
  const chosen = items.filter((d) => selected.has(d.id));

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <Paper variant="outlined" sx={{ p: 2, overflowX: "auto" }}>
      <Tabs value={area} onChange={(_, v) => setArea(v)} variant="scrollable" sx={{ mb: 1 }}>
        {AREAS.map((a) => <Tab key={a} value={a} label={STATE_LABEL[a]} />)}
      </Tabs>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} mb={1}>
        <Typography variant="body2" color="text.secondary" flexGrow={1}>{AREA_HELP[area]}</Typography>
        <TextField size="small" placeholder="Cerca" value={q} onChange={(e) => setQ(e.target.value)}
                   InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }} />
        {targets.map((t) => (
          <Button key={t} variant="contained" size="small" disabled={chosen.length === 0} onClick={() => setAction(t)}>
            {ACTION_LABEL[t]} {chosen.length > 0 ? `(${chosen.length})` : ""}
          </Button>
        ))}
      </Stack>
      {items.length === 0 ? (
        <Box py={3}><Typography color="text.secondary" textAlign="center">Nessun documento in quest'area.</Typography></Box>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              {targets.length > 0 && (
                <TableCell padding="checkbox">
                  <Checkbox checked={chosen.length === items.length} indeterminate={chosen.length > 0 && chosen.length < items.length}
                            onChange={(e) => setSelected(e.target.checked ? new Set(items.map((d) => d.id)) : new Set())} />
                </TableCell>
              )}
              <TableCell>Identificativo</TableCell><TableCell>Titolo</TableCell><TableCell>Originatore</TableCell>
              <TableCell>Rev.</TableCell><TableCell>Idoneità</TableCell><TableCell>Stato</TableCell><TableCell>File</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {items.map((d) => (
              <TableRow key={d.id} hover selected={selected.has(d.id)} sx={{ cursor: "pointer" }} onClick={() => setOpenDoc(d.id)}>
                {targets.length > 0 && (
                  <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                  </TableCell>
                )}
                <TableCell sx={{ fontFamily: "monospace", whiteSpace: "nowrap" }}>{d.identifier}</TableCell>
                <TableCell>{d.title}</TableCell>
                <TableCell>{d.originator_code}</TableCell>
                <TableCell><b>{d.current_revision}</b></TableCell>
                <TableCell>{d.current_suitability}</TableCell>
                <TableCell>
                  <Chip size="small" color={STATE_COLOR[d.archived_at ? "ARCHIVED" : (d.current_state ?? "WIP")]}
                        label={STATE_LABEL[d.archived_at ? "ARCHIVED" : (d.current_state ?? "WIP")]} />
                </TableCell>
                <TableCell>{formatBytes(d.current_size)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {action && (
        <TransitionDialog projectId={project.id} from={area} to={action}
                          revisions={chosen.map((d) => ({ id: d.current_revision_id!, label: `${d.identifier} ${d.current_revision}` }))}
                          onClose={() => { setAction(null); setSelected(new Set()); }} />
      )}
      <DocumentDrawer projectId={project.id} documentId={openDoc} onClose={() => setOpenDoc(null)} />
    </Paper>
  );
}
