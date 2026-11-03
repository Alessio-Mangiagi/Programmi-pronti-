// "><(((º> sabusabu <º)))><"
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Link, List, ListItem, ListItemText, MenuItem,
  Stack, TextField, Typography,
} from "@mui/material";
import { api, ApiError } from "../../api";

/** Esito di un confronto o di una verifica, come lo salva l'API in documents.attributes (suite.py). */
interface Confronto { revision_id: string; revision_code: string; precedente_code: string; job_id: string; url: string; data: string; utente: string }
interface Verifica { revision_id: string; revision_code: string; nome_set: string; esito: string; ko: number; dubbi: number; url: string; data: string }
interface SetRequisiti { id: string; nome: string; descrizione: string; requisiti: number }

const ESITO: Record<string, { label: string; color: "success" | "error" | "warning" | "info" }> = {
  ok: { label: "Conforme", color: "success" },
  ko: { label: "Non conforme", color: "error" },
  dubbio: { label: "Da controllare", color: "warning" },
  "non-applicabile": { label: "Non applicabile", color: "info" },
};

/**
 * Sezione «Suite Cosedil» nel dettaglio documento: confronta una revisione con la precedente
 * (Confronto Documenti) e lancia una checklist di Verifica Requisiti; gli esiti restano nei
 * metadati del documento e si riaprono dai link.
 */
export function SuiteDocumento({ documentId, revisions, attributes }: {
  documentId: string;
  revisions: { id: string; revision_code: string; sequence?: number; scan_status: string }[];
  attributes: Record<string, unknown> | undefined;
}) {
  const qc = useQueryClient();
  const [verifica, setVerifica] = useState<{ id: string; code: string } | null>(null);
  const [setId, setSetId] = useState("");
  const confronti = ((attributes?.confronti as Confronto[] | undefined) ?? []).slice().reverse();
  const verifiche = ((attributes?.verifiche as Verifica[] | undefined) ?? []).slice().reverse();
  const invalida = () => qc.invalidateQueries({ queryKey: ["document", documentId] });
  const confronta = useMutation({
    mutationFn: (revisionId: string) => api<Confronto>(`/revisions/${revisionId}/confronta`, { method: "POST" }),
    onSuccess: (c) => { invalida(); window.open(c.url, "_blank", "noopener"); },
  });
  const set = useQuery({
    queryKey: ["suite-requisiti-set"], enabled: !!verifica,
    queryFn: () => api<{ set: SetRequisiti[] }>("/suite/requisiti/set"),
  });
  const verificaM = useMutation({
    mutationFn: (p: { revisionId: string; setId: string }) =>
      api<Verifica>(`/revisions/${p.revisionId}/verifica`, { method: "POST", json: { set_id: p.setId } }),
    onSuccess: () => { invalida(); setVerifica(null); },
  });
  // revisioni dalla più recente: la prima in assoluto non ha una precedente
  const ordinate = revisions.slice().sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0));
  const minima = Math.min(...ordinate.map((r) => r.sequence ?? 1));

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Suite Cosedil</Typography>
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {ordinate.map((r) => (
          <Stack key={r.id} direction="row" spacing={0.5}>
            {(r.sequence ?? 1) > minima && (
              <Button size="small" variant="outlined" disabled={r.scan_status !== "CLEAN" || confronta.isPending}
                      onClick={() => confronta.mutate(r.id)}>Confronta {r.revision_code} con la precedente</Button>
            )}
            <Button size="small" variant="outlined" disabled={r.scan_status !== "CLEAN" || verificaM.isPending}
                    onClick={() => setVerifica({ id: r.id, code: r.revision_code })}>Verifica requisiti {r.revision_code}</Button>
          </Stack>
        ))}
      </Stack>
      {confronta.isPending && <Alert severity="info">Confronto in corso: si apre in Confronto Documenti…</Alert>}
      {confronta.isError && <Alert severity="error">{(confronta.error as ApiError).message}</Alert>}
      {(confronti.length > 0 || verifiche.length > 0) && (
        <List dense disablePadding>
          {confronti.map((c) => (
            <ListItem key={c.job_id} divider>
              <ListItemText
                primary={<Link href={c.url} target="_blank" rel="noopener">Confronto {c.precedente_code} → {c.revision_code}</Link>}
                secondary={`${new Date(c.data).toLocaleString("it-IT")} · ${c.utente}`} />
            </ListItem>
          ))}
          {verifiche.map((v, i) => (
            <ListItem key={`${v.revision_id}-${i}`} divider>
              <ListItemText
                primary={<><Link href={v.url} target="_blank" rel="noopener">Verifica «{v.nome_set}» su {v.revision_code}</Link>
                  {" · "}<Typography component="span" variant="body2" color={`${ESITO[v.esito]?.color ?? "info"}.main`}>
                    {ESITO[v.esito]?.label ?? v.esito}{v.ko ? ` (${v.ko} ko` : ""}{v.ko && v.dubbi ? `, ${v.dubbi} dubbi)` : v.ko ? ")" : v.dubbi ? ` (${v.dubbi} dubbi)` : ""}
                  </Typography></>}
                secondary={new Date(v.data).toLocaleString("it-IT")} />
            </ListItem>
          ))}
        </List>
      )}
      <Dialog open={!!verifica} onClose={() => setVerifica(null)} fullWidth maxWidth="xs">
        <DialogTitle>Verifica requisiti · {verifica?.code}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} mt={1}>
            {set.isError && <Alert severity="error">{(set.error as ApiError).message}</Alert>}
            {set.data && set.data.set.length === 0 && <Alert severity="info">Nessun set di requisiti in Verifica Requisiti.</Alert>}
            <TextField select label="Set di requisiti" value={setId} onChange={(e) => setSetId(e.target.value)} disabled={!set.data?.set.length}>
              {(set.data?.set ?? []).map((s) => (
                <MenuItem key={s.id} value={s.id}>{s.nome} ({s.requisiti} requisiti)</MenuItem>
              ))}
            </TextField>
            {verificaM.isPending && <Alert severity="info">Verifica in corso: lettura del file e controllo dei requisiti…</Alert>}
            {verificaM.isError && <Alert severity="error">{(verificaM.error as ApiError).message}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setVerifica(null)}>Annulla</Button>
          <Button variant="contained" disabled={!setId || verificaM.isPending}
                  onClick={() => verifica && verificaM.mutate({ revisionId: verifica.id, setId })}>Verifica</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
