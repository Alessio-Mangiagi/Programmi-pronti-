// "><(((º> sabusabu <º)))><"
// Scheda Processi del progetto (docs/workflow-grafo.md §2 e §4): workflow a grafo che partono da sé, senza un
// documento (es. RdA → gara → affidamento), con documenti del progetto allegati. Elenco con stato, esito, data
// e chi l'ha avviato, filtri per stato; "Nuovo processo" sceglie un modello di tipo Processi, titolo,
// descrizione e documenti. Un processo si apre nella vista finale (/istanze/:id).
// I modelli della libreria dell'organizzazione proprietaria (ADR-50) compaiono nello stesso elenco col bollino
// "Libreria": l'API li restituisce già con scope LIBRARY e li avvia in questa commessa.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Autocomplete, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Paper, Stack, Table,
  TableBody, TableCell, TableHead, TableRow, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import { api, ApiError, Project } from "../../api";
import { Modello, diLibreria } from "../../components/workflow/modello";

interface Processo {
  id: string;
  title: string;
  status: "RUNNING" | "COMPLETED" | "CANCELLED";
  result: "OK" | "KO" | null;
  started_at: string;
  finished_at?: string | null;
  started_by_name?: string;
  started_by?: { id: string; name: string } | string;
  template_name?: string;
  template_version?: number;
}
interface DocumentoTrovato { id: string; identifier: string; title: string }

const STATO: Record<Processo["status"], { label: string; color: "warning" | "success" | "default" }> = {
  RUNNING: { label: "In corso", color: "warning" }, COMPLETED: { label: "Concluso", color: "success" }, CANCELLED: { label: "Annullato", color: "default" },
};

export function ProcessiTab({ project }: { project: Project }) {
  const navigate = useNavigate();
  const [filtro, setFiltro] = useState<"TUTTI" | Processo["status"]>("RUNNING");
  const [nuovo, setNuovo] = useState(false);
  const { data: processi = [], error, isLoading } = useQuery({
    queryKey: ["processes", project.id],
    queryFn: () => api<Processo[] | { items: Processo[] }>(`/projects/${project.id}/processes`)
      .then((r) => (Array.isArray(r) ? r : r.items)),
  });
  const mostrati = processi.filter((p) => filtro === "TUTTI" || p.status === filtro)
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
  const chi = (p: Processo) => p.started_by_name ?? (typeof p.started_by === "object" ? p.started_by?.name : undefined) ?? "—";

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }}>
        <Typography variant="body2" color="text.secondary" flexGrow={1}>
          I processi seguono uno schema a grafo senza partire da un documento (per esempio una RdA fino
          all'affidamento). I modelli si disegnano nella scheda Workflow, scegliendo "Processi".
        </Typography>
        <ToggleButtonGroup size="small" exclusive value={filtro} onChange={(_, v) => v && setFiltro(v)} aria-label="Filtra per stato">
          <ToggleButton value="RUNNING">In corso</ToggleButton>
          <ToggleButton value="COMPLETED">Conclusi</ToggleButton>
          <ToggleButton value="CANCELLED">Annullati</ToggleButton>
          <ToggleButton value="TUTTI">Tutti</ToggleButton>
        </ToggleButtonGroup>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setNuovo(true)}>Nuovo processo</Button>
      </Stack>
      {error && <Alert severity="error">{(error as ApiError).message}</Alert>}
      <Paper variant="outlined" sx={{ overflowX: "auto" }}>
        {!isLoading && mostrati.length === 0 ? (
          <Typography color="text.secondary" p={2}>Nessun processo {filtro === "TUTTI" ? "" : STATO[filtro].label.toLowerCase()}.</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Processo</TableCell><TableCell>Modello</TableCell><TableCell>Stato</TableCell>
                <TableCell>Esito</TableCell><TableCell>Avviato</TableCell><TableCell>Da</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {mostrati.map((p) => (
                <TableRow key={p.id} hover sx={{ cursor: "pointer" }} onClick={() => navigate(`/istanze/${p.id}`)}
                          tabIndex={0} onKeyDown={(e) => e.key === "Enter" && navigate(`/istanze/${p.id}`)}>
                  <TableCell><Typography fontWeight={600} fontSize={14}>{p.title}</Typography></TableCell>
                  <TableCell>{p.template_name ?? "—"}{p.template_version ? ` v${p.template_version}` : ""}</TableCell>
                  <TableCell><Chip size="small" {...STATO[p.status]} /></TableCell>
                  <TableCell>
                    {p.result ? <Chip size="small" variant="outlined" color={p.result === "OK" ? "success" : "error"}
                                      label={p.result === "OK" ? "Concluso" : "Fallito"} /> : "—"}
                  </TableCell>
                  <TableCell>{new Date(p.started_at).toLocaleString("it-IT")}</TableCell>
                  <TableCell>{chi(p)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
      {nuovo && <NuovoProcessoDialog project={project} onClose={() => setNuovo(false)} />}
    </Stack>
  );
}

function NuovoProcessoDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [documenti, setDocumenti] = useState<DocumentoTrovato[]>([]);
  const [cerca, setCerca] = useState("");
  const { data: modelli = [] } = useQuery({
    queryKey: ["workflow-templates", project.id],
    queryFn: () => api<Modello[]>(`/projects/${project.id}/workflow-templates`),
  });
  // prima i modelli della commessa, poi quelli della libreria dell'organizzazione
  const perProcessi = modelli.filter((m) => m.is_active && m.subject === "PROCESS")
    .sort((a, b) => Number(diLibreria(a)) - Number(diLibreria(b)) || a.name.localeCompare(b.name));
  const scelto = perProcessi.find((m) => m.id === templateId);
  // documenti del progetto da allegare: ricerca per identificativo o titolo, fra quelli che l'utente vede
  const { data: trovati = [] } = useQuery({
    queryKey: ["documenti-da-allegare", project.id, cerca],
    queryFn: () => api<{ items: DocumentoTrovato[] }>(`/projects/${project.id}/documents?limit=30${cerca ? `&q=${encodeURIComponent(cerca)}` : ""}`)
      .then((r) => r.items),
  });
  const avvia = useMutation({
    mutationFn: () => api<{ id: string }>(`/projects/${project.id}/processes`, {
      method: "POST", json: { template_id: templateId, title: title.trim(), description: description.trim() || null, document_ids: documenti.map((d) => d.id) },
    }),
    onSuccess: (p) => { qc.invalidateQueries({ queryKey: ["processes", project.id] }); onClose(); navigate(`/istanze/${p.id}`); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Nuovo processo</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {avvia.error && <Alert severity="error">{(avvia.error as ApiError).message}</Alert>}
          {perProcessi.length === 0
            ? <Alert severity="info">Nessun modello di tipo Processi: lo disegna il Project Admin nella scheda Workflow, oppure l'amministratore dell'organizzazione nella libreria.</Alert>
            : (
              <TextField select label="Modello" value={templateId} onChange={(e) => setTemplateId(e.target.value)}
                         helperText={scelto && diLibreria(scelto)
                           ? `Dalla libreria di ${scelto.organization_name ?? "organizzazione"}: vale in tutte le sue commesse, sempre nell'ultima versione`
                           : " "}>
                {perProcessi.map((m) => (
                  <MenuItem key={m.id} value={m.id}>
                    {m.name} (v{m.version})
                    {diLibreria(m) && <Chip size="small" color="primary" label="Libreria" sx={{ ml: 1, height: 20 }} />}
                  </MenuItem>
                ))}
              </TextField>
            )}
          <TextField label="Titolo" value={title} onChange={(e) => setTitle(e.target.value)} inputProps={{ maxLength: 200 }}
                     helperText="Es. RdA 2026/118 – Ponteggi Sede Acireale" />
          <TextField label="Descrizione" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={3}
                     inputProps={{ maxLength: 4000 }} />
          <Autocomplete multiple options={trovati} value={documenti} filterOptions={(x) => x}
                        isOptionEqualToValue={(a, b) => a.id === b.id}
                        getOptionLabel={(d) => `${d.identifier} · ${d.title}`}
                        onInputChange={(_, v, reason) => reason === "input" && setCerca(v)}
                        onChange={(_, v) => setDocumenti(v)}
                        renderInput={(p) => <TextField {...p} label="Documenti allegati" helperText="Cerca per identificativo o titolo" />} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" disabled={!templateId || title.trim().length < 2 || avvia.isPending} onClick={() => avvia.mutate()}>Avvia</Button>
      </DialogActions>
    </Dialog>
  );
}
