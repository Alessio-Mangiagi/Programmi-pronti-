// "><(((º> sabusabu <º)))><"
// Tornare indietro da un nodo (docs/workflow-grafo.md §6, ADR-51): pezzi di interfaccia usati dalla posta "Compiti"
// e dalla vista finale.
// - DialogoRitorno: "Chiedi chiarimento" / "Richiedi modifiche" dal proprio compito, con la scelta della
//   destinazione (i nodi già fatti del ramo, il più vicino proposto, oppure "Chi ha avviato") e il commento
//   obbligatorio;
// - DialogoRisposta: il compito di chiarimento di chi è interpellato (domanda, risposta con un commento);
// - AvvisiRitorno: dentro il compito, la richiesta di modifiche ricevuta (con "Carica nuova revisione" per i
//   documenti e gli allegati per i processi), l'attesa di un chiarimento e i chiarimenti già avuti;
// - VoceRitorno / ElencoRitorni: come si leggono le richieste nella vista finale.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, Autocomplete, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, Paper, Radio, RadioGroup, Stack, TextField, Typography,
} from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import { api, ApiError, Container, Project } from "../../api";
import { UploadDialog } from "../../pages/project/Documents";
import { COLORE_RITORNO } from "./GrafoWorkflow";
import type { Istanza, RichiestaRitorno } from "./modello";

/** Campi del compito (da /me/tasks) che servono al ritorno. */
export interface CompitoRitorno {
  id: string;
  instance_id: string;
  project_id?: string;
  node_name?: string;
  step_name?: string;
  subject?: "DOCUMENT" | "PROCESS";
  document_id: string | null;
  container_id?: string | null;
  identifier: string | null;
  title: string;
  kind?: "WORKFLOW" | "CLARIFICATION";
  can_send_back?: boolean;
  /** Compito di chiarimento: la domanda a cui rispondere. */
  clarification?: RichiestaRitorno | null;
  /** Il proprio compito è fermo in attesa di questo chiarimento. */
  waiting_for?: RichiestaRitorno | null;
  /** Il giro del compito è stato riaperto (o va rifatto) per questa richiesta di modifiche. */
  changes_request?: RichiestaRitorno | null;
  /** Chiarimenti chiesti da questo compito (con le risposte). */
  clarifications?: RichiestaRitorno[];
  /** Workflow su documento durante le modifiche: revisione più recente di quella in esame, se caricata. */
  new_revision?: { id: string; revision_code: string; state: string } | null;
}

interface Destinazione {
  target: string; node_id: string | null; name: string; node_type: string; depth: number;
  people: string | null; active: boolean; default: boolean;
}

const data = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("it-IT") : "");

function invalida(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["my-tasks"] });
  qc.invalidateQueries({ queryKey: ["workflow-instance"] });
  qc.invalidateQueries({ queryKey: ["notifications"] });
}

/** "Chiedi chiarimento" o "Richiedi modifiche": destinazione fra i nodi già fatti del ramo e commento obbligatorio. */
export function DialogoRitorno({ task, tipo, onClose, onDone }: {
  task: CompitoRitorno; tipo: "chiarimento" | "modifiche"; onClose: () => void; onDone?: () => void;
}) {
  const qc = useQueryClient();
  const { data: destinazioni, error } = useQuery({
    queryKey: ["send-back-targets", task.id],
    queryFn: () => api<Destinazione[]>(`/tasks/${task.id}/send-back-targets`),
  });
  const [scelta, setScelta] = useState<string | null>(null);
  const [commento, setCommento] = useState("");
  const proposta = destinazioni?.find((d) => d.default)?.target ?? null;
  const target = scelta ?? proposta;
  const invia = useMutation({
    mutationFn: () => api(`/tasks/${task.id}/${tipo === "chiarimento" ? "clarification" : "request-changes"}`, {
      method: "POST", json: { target, comment: commento.trim() },
    }),
    onSuccess: () => { invalida(qc); onDone?.(); onClose(); },
  });
  const titolo = tipo === "chiarimento" ? "Chiedi chiarimento" : "Richiedi modifiche";
  // un nodo con un giro già in corso non si riapre: per lui solo il chiarimento
  const disattivo = (d: Destinazione) => tipo === "modifiche" && d.active;
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="titolo-ritorno">
      <DialogTitle id="titolo-ritorno">{titolo}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={0.5}>
          <Typography variant="body2" color="text.secondary">
            {tipo === "chiarimento"
              ? "Chi scegli riceve un compito con la tua domanda e risponde con un commento. Il flusso non si sposta: il tuo compito resta in attesa (scadenza sospesa) finché arriva la risposta."
              : "Il passo scelto si riapre con la tua richiesta: chi lo ha in carico modifica i file e lo completa, poi il flusso riprende e rifà i passi intermedi fino a tornare a te. Il tuo compito si chiude; gli altri rami continuano."}
          </Typography>
          {error && <Alert severity="error">{(error as ApiError).message}</Alert>}
          {invia.error && <Alert severity="error">{(invia.error as ApiError).message}</Alert>}
          {!destinazioni ? <CircularProgress size={22} /> : (
            <RadioGroup value={target ?? ""} onChange={(e) => setScelta(e.target.value)} aria-label="Dove rimandare">
              <Typography variant="subtitle2" mb={0.5}>Dove rimandare</Typography>
              {destinazioni.map((d) => (
                <FormControlLabel key={d.target} value={d.target} disabled={disattivo(d)} control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography variant="body2" fontWeight={600} component="span">
                        {d.target === "ORIGINATOR" ? "Chi ha avviato" : d.name}
                      </Typography>
                      {d.default && <Chip size="small" label="passo precedente" sx={{ ml: 1, height: 18 }} />}
                      <Typography variant="caption" color="text.secondary" display="block">
                        {d.people ?? "—"}{disattivo(d) ? " · già in corso: si può solo chiedere un chiarimento" : ""}
                      </Typography>
                    </Box>
                  } />
              ))}
            </RadioGroup>
          )}
          <TextField label={tipo === "chiarimento" ? "Domanda (obbligatoria)" : "Cosa va modificato (obbligatorio)"}
                     value={commento} onChange={(e) => setCommento(e.target.value)} multiline minRows={3}
                     inputProps={{ maxLength: 4000 }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Annulla</Button>
        <Button variant="contained" color={tipo === "modifiche" ? "warning" : "primary"}
                disabled={!target || !commento.trim() || invia.isPending} onClick={() => invia.mutate()}>
          {tipo === "chiarimento" ? "Invia la domanda" : "Rimanda indietro"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Compito di chiarimento: la domanda di chi l'ha chiesta e la risposta (un commento). */
export function DialogoRisposta({ task, onClose }: { task: CompitoRitorno; onClose: () => void }) {
  const qc = useQueryClient();
  const [risposta, setRisposta] = useState("");
  const b = task.clarification;
  const rispondi = useMutation({
    mutationFn: () => api(`/tasks/${task.id}/clarification/answer`, { method: "POST", json: { comment: risposta.trim() } }),
    onSuccess: () => { invalida(qc); onClose(); },
  });
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" aria-labelledby="titolo-risposta">
      <DialogTitle id="titolo-risposta">Chiarimento richiesto: {task.title}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={0.5}>
          {rispondi.error && <Alert severity="error">{(rispondi.error as ApiError).message}</Alert>}
          {b && (
            <Paper variant="outlined" sx={{ p: 1.5, borderLeft: 4, borderLeftColor: COLORE_RITORNO.chiarimento }}>
              <Typography variant="caption" color="text.secondary">
                {b.asked_by.name} · passo «{b.from.name}» · {data(b.created_at)}
              </Typography>
              <Typography sx={{ whiteSpace: "pre-wrap" }}>{b.comment}</Typography>
            </Paper>
          )}
          <Typography variant="body2" color="text.secondary">
            Il suo compito è fermo finché non rispondi. Rispondi con un commento: nulla del flusso si sposta.
          </Typography>
          <TextField label="Risposta (obbligatoria)" value={risposta} onChange={(e) => setRisposta(e.target.value)}
                     multiline minRows={3} inputProps={{ maxLength: 4000 }} autoFocus />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Chiudi</Button>
        <Button variant="contained" disabled={!risposta.trim() || rispondi.isPending} onClick={() => rispondi.mutate()}>
          Invia risposta
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Avvisi dentro il compito: modifiche ricevute (con file), attesa di chiarimento, chiarimenti già ricevuti. */
export function AvvisiRitorno({ task }: { task: CompitoRitorno }) {
  const m = task.changes_request;
  const w = task.waiting_for;
  return (
    <Stack spacing={1.5}>
      {m && (
        <Alert severity="warning" icon={false} sx={{ borderLeft: 4, borderLeftColor: COLORE_RITORNO.modifiche }}>
          <Typography variant="subtitle2">
            Modifiche richieste da {m.asked_by.name} (passo «{m.from.name}») · {data(m.created_at)}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{m.comment}</Typography>
          <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
            Fai le modifiche e scegli di nuovo un esito: il flusso riprende da qui e torna a «{m.from.name}».
          </Typography>
          {task.subject === "DOCUMENT" && task.document_id && <Box mt={1}><CaricaRevisione task={task} /></Box>}
          {task.subject === "PROCESS" && <Box mt={1}><AllegatiProcesso task={task} /></Box>}
        </Alert>
      )}
      {w && (
        <Alert severity="info" sx={{ borderLeft: 4, borderLeftColor: COLORE_RITORNO.chiarimento }}>
          <Typography variant="subtitle2">
            In attesa di chiarimento da {w.recipients.join(", ") || w.target.name} · chiesto il {data(w.created_at)}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>«{w.comment}»</Typography>
          <Typography variant="caption" color="text.secondary">
            Il compito non si completa e la scadenza è sospesa finché arriva la risposta.
          </Typography>
        </Alert>
      )}
      {(task.clarifications ?? []).filter((b) => b.answer).map((b) => <VoceRitorno key={b.id} b={b} />)}
    </Stack>
  );
}

/** Workflow su documento: "Carica nuova revisione" apre il caricamento di sempre nella cartella del documento. */
function CaricaRevisione({ task }: { task: CompitoRitorno }) {
  const qc = useQueryClient();
  const [aperto, setAperto] = useState(false);
  const { data: cartella } = useQuery({
    queryKey: ["container", task.container_id], enabled: aperto && !!task.container_id,
    queryFn: () => api<Container>(`/containers/${task.container_id}`),
  });
  return (
    <>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Button size="small" variant="contained" color="warning" startIcon={<UploadFileIcon />} onClick={() => setAperto(true)}>
          Carica nuova revisione
        </Button>
        {task.new_revision
          ? <Typography variant="body2">Caricata la revisione <b>{task.new_revision.revision_code}</b>: completando il compito il workflow prosegue su questa{task.new_revision.state === "WIP" ? " (verrà condivisa con la stessa idoneità)" : ""}.</Typography>
          : <Typography variant="caption" color="text.secondary">Usa lo stesso nome file del documento ({task.identifier}).</Typography>}
      </Stack>
      {aperto && cartella && task.project_id && (
        <UploadDialog project={{ id: task.project_id } as Project} container={cartella}
                      onClose={() => { setAperto(false); invalida(qc); }} />
      )}
    </>
  );
}

interface DocumentoTrovato { id: string; identifier: string; title: string }

/** Processo: allegati sostituiti o aggiunti da chi ha ricevuto la richiesta di modifiche. */
function AllegatiProcesso({ task }: { task: CompitoRitorno }) {
  const qc = useQueryClient();
  const { data: ist } = useQuery({
    queryKey: ["workflow-instance", task.instance_id],
    queryFn: () => api<Istanza>(`/workflow-instances/${task.instance_id}`),
  });
  const [scelti, setScelti] = useState<DocumentoTrovato[] | null>(null);
  const [cerca, setCerca] = useState("");
  const { data: trovati = [] } = useQuery({
    queryKey: ["documenti-da-allegare", task.project_id, cerca], enabled: !!task.project_id,
    queryFn: () => api<{ items: DocumentoTrovato[] }>(`/projects/${task.project_id}/documents?limit=30${cerca ? `&q=${encodeURIComponent(cerca)}` : ""}`)
      .then((r) => r.items),
  });
  const valore = scelti ?? ist?.documents ?? [];
  const salva = useMutation({
    mutationFn: () => api(`/processes/${task.instance_id}/documents`, { method: "PUT", json: { document_ids: valore.map((d) => d.id) } }),
    onSuccess: () => { setScelti(null); invalida(qc); },
  });
  return (
    <Stack spacing={1}>
      {salva.error && <Alert severity="error">{(salva.error as ApiError).message}</Alert>}
      <Autocomplete multiple size="small" options={trovati} value={valore} filterOptions={(x) => x}
                    isOptionEqualToValue={(a, b) => a.id === b.id} getOptionLabel={(d) => `${d.identifier} · ${d.title}`}
                    onInputChange={(_, v, reason) => reason === "input" && setCerca(v)}
                    onChange={(_, v) => setScelti(v)}
                    renderInput={(p) => <TextField {...p} label="Allegati del processo" helperText="Togli o aggiungi documenti, poi salva" />} />
      <Box>
        <Button size="small" variant="outlined" disabled={scelti === null || salva.isPending} onClick={() => salva.mutate()}>
          Salva allegati
        </Button>
        {salva.isSuccess && <Typography variant="caption" color="success.main" ml={1}>Allegati aggiornati</Typography>}
      </Box>
    </Stack>
  );
}

const STATO_RICHIESTA: Record<RichiestaRitorno["status"], string> = {
  OPEN: "in corso", ANSWERED: "risposto", RETURNED: "tornato a chi ha chiesto", CLOSED: "chiusa",
};

/** Una richiesta letta nella vista finale o nel compito: chi, da quale passo, a chi, commento, risposta, file. */
export function VoceRitorno({ b, compatta }: { b: RichiestaRitorno; compatta?: boolean }) {
  const modifiche = b.kind === "CHANGES";
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderLeft: 4, borderLeftColor: modifiche ? COLORE_RITORNO.modifiche : COLORE_RITORNO.chiarimento }}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <Typography variant="subtitle2" component="span">
          {modifiche ? "↩ Modifiche richieste" : "? Chiarimento"}
        </Typography>
        <Chip size="small" label={STATO_RICHIESTA[b.status]} color={b.status === "OPEN" ? "warning" : b.status === "CLOSED" ? "default" : "success"} />
      </Stack>
      <Typography variant="caption" color="text.secondary" display="block">
        {b.asked_by.name} da «{b.from.name}»{b.from.round > 1 ? ` (giro ${b.from.round})` : ""} → «{b.target.name}»
        {modifiche && b.target.reopened_round ? ` (riaperto al giro ${b.target.reopened_round})` : ""} · {data(b.created_at)}
      </Typography>
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{b.comment}</Typography>
      {!modifiche && !compatta && b.recipients.length > 0 && !b.answer && (
        <Typography variant="caption" color="text.secondary">Chiesto a {b.recipients.join(", ")}</Typography>
      )}
      {b.answer && (
        <Box mt={0.75} pl={1.5} borderLeft={2} borderColor="divider">
          <Typography variant="caption" color="text.secondary">Risposta di {b.answered_by?.name} · {data(b.answered_at)}</Typography>
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{b.answer}</Typography>
        </Box>
      )}
      {b.revision && (
        <Typography variant="caption" display="block" mt={0.5}>
          Nuova revisione: {b.revision.from_code ?? "—"} → <b>{b.revision.to_code ?? "—"}</b> (la precedente resta nello storico)
        </Typography>
      )}
      {b.documents_changed_at && (
        <Typography variant="caption" display="block" mt={0.5}>Allegati del processo cambiati il {data(b.documents_changed_at)}</Typography>
      )}
    </Paper>
  );
}

/** Vista finale: tutte le richieste di chiarimento e di modifiche dell'istanza, dalla più recente. */
export function ElencoRitorni({ ist }: { ist: Istanza }) {
  const tutte = [...(ist.send_backs ?? [])].reverse();
  if (!tutte.length) return null;
  return (
    <Paper variant="outlined" component="section" aria-label="Chiarimenti e modifiche" sx={{ p: 2 }}>
      <Typography variant="h6" component="h2" fontWeight={600} mb={1}>Chiarimenti e modifiche</Typography>
      <Stack spacing={1}>{tutte.map((b) => <VoceRitorno key={b.id} b={b} />)}</Stack>
    </Paper>
  );
}
