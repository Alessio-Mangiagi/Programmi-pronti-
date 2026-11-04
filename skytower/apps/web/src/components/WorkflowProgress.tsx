// "><(((º> sabusabu <º)))><"
// Riassunto di un workflow avviato, nel dettaglio documento e nella finestra del compito: modello, stato, nodi
// in corso e fatti, link alla vista finale con lo schema a grafo (/istanze/:id). I dati vengono da
// GET /workflow-instances/{id} (docs/workflow-grafo.md §3).
import { useMemo } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Box, Button, Chip, Stack, Typography } from "@mui/material";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import { api } from "../api";
import { Istanza, comeGrafo, statiDaIstanza } from "./workflow/modello";

/** Riga dell'elenco dei workflow di un documento (GET /documents/{id}/workflows): basta id e stato. */
export interface WorkflowInstance {
  id: string;
  status: string;
  template_name?: string;
  template_version?: number;
  started_at?: string;
}

const STATO: Record<string, { label: string; color: "warning" | "success" | "error" | "default" }> = {
  RUNNING: { label: "In corso", color: "warning" },
  COMPLETED: { label: "Concluso", color: "success" },
  APPROVED: { label: "Approvato", color: "success" },
  REJECTED: { label: "Rifiutato", color: "error" },
  CANCELLED: { label: "Annullato", color: "default" },
};

export function WorkflowProgress({ instanceId }: { instanceId: string }) {
  const { data: ist } = useQuery({
    queryKey: ["workflow-instance", instanceId],
    queryFn: () => api<Istanza>(`/workflow-instances/${instanceId}`),
  });
  const riassunto = useMemo(() => {
    if (!ist) return null;
    const def = comeGrafo(ist.definition);
    const stati = statiDaIstanza(ist);
    const compiti = def.nodes.filter((n) => n.type === "decision" || n.type === "activity");
    const fine = def.nodes.find((n) => n.type === "end" && (stati.get(n.id)?.stato === "ok" || stati.get(n.id)?.stato === "ko"));
    return {
      attivi: compiti.filter((n) => stati.get(n.id)?.stato === "attivo").map((n) => n.name),
      fatti: compiti.filter((n) => stati.get(n.id)?.stato === "fatto").length,
      totale: compiti.length,
      fine,
    };
  }, [ist]);
  if (!ist || !riassunto) return null;
  const stato = ist.result === "KO" ? STATO.REJECTED : STATO[ist.status] ?? { label: ist.status, color: "default" as const };
  return (
    <Box sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.25 }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography fontWeight={600}>{ist.template ? `${ist.template.name} v${ist.template.version}` : ist.title ?? "Workflow"}</Typography>
        <Chip size="small" color={stato.color} label={riassunto.fine ? riassunto.fine.name : stato.label} />
        {ist.started_by?.name && <Typography variant="caption" color="text.secondary">avviato da {ist.started_by.name}</Typography>}
        <Box flexGrow={1} />
        <Button size="small" startIcon={<AccountTreeIcon />} component={RouterLink} to={`/istanze/${ist.id}`}>Apri lo schema</Button>
      </Stack>
      <Typography variant="body2" color="text.secondary" mt={0.5}>
        {riassunto.fatti} di {riassunto.totale} compiti svolti
        {riassunto.attivi.length ? ` · in corso: ${riassunto.attivi.join(", ")}` : ""}
      </Typography>
    </Box>
  );
}
