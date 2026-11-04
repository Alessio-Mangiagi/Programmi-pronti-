// "><(((º> sabusabu <º)))><"
// Vista finale di un workflow avviato (docs/workflow-grafo.md §4): lo stesso foglio a scacchiera dell'editor in
// sola lettura, con i colori di stato (verde fatto, giallo in corso, grigio non raggiunto, rosso finito male),
// la spunta sugli esiti percorsi e "N giri" sui nodi ripassati. Clic su un nodo → giri, compiti, commenti, date.
// Si aggiorna ogni 15 secondi finché il workflow è in corso. Ci si arriva dal documento, dalla scheda Processi
// e dalla posta dei compiti (rotta /istanze/:instanceId).
// Tornare indietro (§6, ADR-51): frecce tratteggiate dal nodo che ha chiesto al nodo interpellato (blu, chiarimento)
// o riaperto (arancio, modifiche), elenco "Chiarimenti e modifiche" con domande, risposte e revisioni, e nel pannello
// del nodo, giro per giro, chi ha chiesto cosa.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Alert, Box, Button, Chip, IconButton, Link, Paper, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip,
  Typography,
} from "@mui/material";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import { api, ApiError } from "../api";
import { COLORE_ESITO, COLORE_RITORNO, GrafoWorkflow, Selezione } from "../components/workflow/GrafoWorkflow";
import { zoomAdatto } from "../components/workflow/griglia";
import {
  Istanza, NOME_TIPO, comeGrafo, esitiDi, percorsiDaIstanza, ritorniDaIstanza, statiDaIstanza,
} from "../components/workflow/modello";
import { ElencoRitorni, VoceRitorno } from "../components/workflow/Ritorni";

const STATO_ISTANZA: Record<Istanza["status"], { label: string; color: "warning" | "success" | "default" }> = {
  RUNNING: { label: "In corso", color: "warning" }, COMPLETED: { label: "Concluso", color: "success" }, CANCELLED: { label: "Annullato", color: "default" },
};
const STATO_GIRO: Record<string, string> = { ACTIVE: "In corso", DONE: "Fatto", CANCELLED: "Annullato" };
const STATO_COMPITO: Record<string, string> = { OPEN: "Da svolgere", DONE: "Svolto", CANCELLED: "Non necessario" };
const data = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("it-IT") : "—");

export function IstanzaWorkflowPage() {
  const { instanceId = "" } = useParams();
  const { data: ist, error } = useQuery({
    queryKey: ["workflow-instance", instanceId],
    queryFn: () => api<Istanza>(`/workflow-instances/${instanceId}`),
    refetchInterval: (q) => (q.state.data?.status === "RUNNING" ? 15_000 : false),
  });
  const { data: miei = [] } = useQuery({
    queryKey: ["my-tasks", "OPEN"],
    queryFn: () => api<{ id: string; instance_id: string; kind?: string }[]>(`/me/tasks?status=OPEN`),
  });
  if (error) return <Alert severity="error">{(error as ApiError).status === 404 ? "Workflow non trovato o non visibile" : (error as Error).message}</Alert>;
  if (!ist) return null;
  const mio = miei.find((t) => t.instance_id === ist.id);
  return <VistaIstanza ist={ist} hoCompito={!!mio} compitoId={mio?.id} chiarimento={mio?.kind === "CLARIFICATION"} />;
}

export function VistaIstanza({ ist, hoCompito, compitoId, chiarimento }: {
  ist: Istanza; hoCompito?: boolean; compitoId?: string; chiarimento?: boolean;
}) {
  const def = useMemo(() => comeGrafo(ist.definition), [ist.definition]);
  const stati = useMemo(() => statiDaIstanza(ist), [ist]);
  const percorsi = useMemo(() => percorsiDaIstanza(ist), [ist]);
  const ritorni = useMemo(() => ritorniDaIstanza(ist), [ist]);
  const [sel, setSel] = useState<Selezione>(null);
  const [zoom, setZoom] = useState(1);
  // all'apertura il foglio si adatta alla larghezza della pagina (gli schemi grandi, come la RdA con 7 buyer,
  // sarebbero tagliati a destra); poi lo zoom resta quello scelto con i pulsanti
  const contenitore = useRef<HTMLDivElement>(null);
  const nodiTotali = def.nodes.length;
  useEffect(() => {
    if (contenitore.current) setZoom(zoomAdatto(def, contenitore.current.clientWidth));
  }, [nodiTotali]);
  const nodoSel = sel?.tipo === "nodo" ? def.nodes.find((n) => n.id === sel.id) : undefined;
  const fine = ist.status !== "RUNNING" ? def.nodes.find((n) => n.type === "end" && stati.get(n.id)?.stato !== "non_raggiunto") : undefined;
  const titolo = ist.title ?? ist.template?.name ?? "Workflow";

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: "column", md: "row" }} spacing={1} alignItems={{ md: "center" }}>
        <Box flexGrow={1}>
          <Typography variant="h4" fontWeight={600}>{titolo}</Typography>
          <Typography variant="body2" color="text.secondary">
            {ist.subject === "PROCESS" ? "Processo" : "Approvazione di documento"}
            {ist.template ? ` · ${ist.template.name} v${ist.template.version}` : ""}
            {` · avviato il ${data(ist.started_at)}`}{ist.started_by?.name ? ` da ${ist.started_by.name}` : ""}
            {ist.finished_at ? ` · chiuso il ${data(ist.finished_at)}` : ""}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexShrink={0}>
          <Chip {...STATO_ISTANZA[ist.status]} />
          {ist.result && <Chip color={ist.result === "OK" ? "success" : "error"} label={fine ? fine.name : ist.result === "OK" ? "Concluso" : "Fallito"} />}
          {hoCompito && (
            <Button variant="contained" component={RouterLink}
                    to={`/compiti?instance=${ist.id}${compitoId ? `&task=${compitoId}` : ""}`}>
              {chiarimento ? "Rispondi al chiarimento" : "Svolgi il tuo compito"}
            </Button>
          )}
        </Stack>
      </Stack>
      {ist.description && <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>{ist.description}</Typography>}
      {ist.document && (
        <Typography variant="body2">
          Documento: <Link component={RouterLink} to={`/documenti/${ist.document.id}`}>{ist.document.identifier}</Link>
          {" "}{ist.document.title} · revisione {ist.document.revision_code}
        </Typography>
      )}
      {ist.outcome_comment && <Typography variant="body2" fontStyle="italic">“{ist.outcome_comment}”</Typography>}
      {!!ist.documents?.length && (
        <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
          <Typography variant="body2" color="text.secondary">Documenti:</Typography>
          {ist.documents.map((d) => (
            <Chip key={d.id} size="small" variant="outlined" clickable component={RouterLink} to={`/documenti/${d.id}`}
                  label={`${d.identifier} · ${d.title}`} />
          ))}
        </Stack>
      )}
      <Stack direction="row" gap={1.5} alignItems="center" flexWrap="wrap" aria-label="Legenda">
        <Legenda colore="#e8f5e2" bordo="#4caf2a" testo="Fatto" />
        <Legenda colore="#fff6d1" bordo="#e0a800" testo="In corso" />
        <Legenda colore="#f4f5f7" bordo="#c6cbd2" testo="Non raggiunto" />
        <Legenda colore="#fde8e7" bordo="#d93025" testo="Finito male" />
        {ritorni.length > 0 && <>
          <LegendaRitorno colore={COLORE_RITORNO.modifiche} testo="Modifiche richieste" />
          <LegendaRitorno colore={COLORE_RITORNO.chiarimento} testo="Chiarimento" />
        </>}
        <Typography variant="caption" color="text.secondary">Il segno di spunta indica l'esito scelto.</Typography>
        <Box flexGrow={1} />
        <Tooltip title="Riduci"><IconButton aria-label="Riduci" onClick={() => setZoom((z) => Math.max(0.35, z - 0.1))}><ZoomOutIcon /></IconButton></Tooltip>
        <Tooltip title="Ingrandisci"><IconButton aria-label="Ingrandisci" onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))}><ZoomInIcon /></IconButton></Tooltip>
        <Tooltip title="Adatta alla finestra">
          <IconButton aria-label="Adatta alla finestra"
                      onClick={() => contenitore.current && setZoom(zoomAdatto(def, contenitore.current.clientWidth))}>
            <FitScreenIcon />
          </IconButton>
        </Tooltip>
      </Stack>
      <Stack direction={{ xs: "column", lg: "row" }} spacing={2} alignItems="flex-start">
        <Box ref={contenitore} flexGrow={1} minWidth={0} width="100%">
          <GrafoWorkflow definizione={def} modo="vista" zoom={zoom} etichetta={`Schema di ${titolo}`}
                         selezione={sel} onSeleziona={setSel} stati={stati}
                         archiPercorsi={percorsi.archi} gruppiPercorsi={percorsi.gruppi} ritorni={ritorni} />
        </Box>
        {nodoSel && (
          <Paper variant="outlined" component="aside" aria-label="Dettaglio del nodo" sx={{ p: 2, width: { xs: "100%", lg: 380 }, flexShrink: 0 }}>
            <Stack spacing={1.5}>
              <Box>
                <Typography variant="caption" color="text.secondary">{NOME_TIPO[nodoSel.type]}</Typography>
                <Typography variant="h6" component="h2" fontWeight={600}>{nodoSel.name}</Typography>
              </Box>
              <DettaglioNodo ist={ist} nodoId={nodoSel.id} />
              <Link component="button" variant="body2" onClick={() => setSel(null)} sx={{ alignSelf: "flex-start" }}>Chiudi</Link>
            </Stack>
          </Paper>
        )}
      </Stack>
      <ElencoRitorni ist={ist} />
    </Stack>
  );
}

function LegendaRitorno({ colore, testo }: { colore: string; testo: string }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box component="svg" width={22} height={10} aria-hidden="true">
        <line x1={1} y1={5} x2={21} y2={5} stroke={colore} strokeWidth={2.4} strokeDasharray="5 3" />
      </Box>
      <Typography variant="caption">{testo}</Typography>
    </Stack>
  );
}

function Legenda({ colore, bordo, testo }: { colore: string; bordo: string; testo: string }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box sx={{ width: 16, height: 12, bgcolor: colore, border: 2, borderColor: bordo, borderRadius: 0.5 }} />
      <Typography variant="caption">{testo}</Typography>
    </Stack>
  );
}

/** Giri del nodo (più di uno se ci si è tornati), con compiti, assegnatari, esiti, commenti e date. */
function DettaglioNodo({ ist, nodoId }: { ist: Istanza; nodoId: string }) {
  const def = comeGrafo(ist.definition);
  const n = def.nodes.find((x) => x.id === nodoId)!;
  const esiti = esitiDi(n);
  const giri = ist.node_runs.filter((g) => g.node_id === nodoId).sort((a, b) => b.round - a.round);
  const etichettaEsito = (code: string | null) => {
    const e = esiti.find((x) => x.code === code);
    return e ? (
      <Stack direction="row" spacing={0.5} alignItems="center" component="span">
        <Box component="span" sx={{ width: 9, height: 9, borderRadius: "50%", bgcolor: COLORE_ESITO[e.color], display: "inline-block" }} />
        <span>{e.label}</span>
      </Stack>
    ) : code;
  };
  if (!giri.length) {
    const arrivi = ist.edges_taken.filter((a) => a.to === nodoId);
    return (
      <Typography variant="body2" color="text.secondary">
        {n.type === "end" && arrivi.length ? `Raggiunto il ${data(arrivi[arrivi.length - 1].at)}.`
          : n.type === "notification" && arrivi.length ? `Notifica inviata il ${data(arrivi[arrivi.length - 1].at)}.`
          : n.type === "start" ? `Avviato il ${data(ist.started_at)}.` : "Non ancora raggiunto."}
      </Typography>
    );
  }
  return (
    <Stack spacing={2}>
      {giri.map((g) => (
        <Box key={g.round}>
          <Stack direction="row" spacing={1} alignItems="center" mb={0.5}>
            {giri.length > 1 && <Chip size="small" label={`Giro ${g.round}`} />}
            <Chip size="small" color={g.status === "ACTIVE" ? "warning" : g.status === "DONE" ? "success" : "default"} label={STATO_GIRO[g.status] ?? g.status} />
            {g.outcome && <Typography variant="body2" component="span">{etichettaEsito(g.outcome)}</Typography>}
          </Stack>
          <Typography variant="caption" color="text.secondary" display="block">
            Attivato {data(g.activated_at)}{g.completed_at ? ` · chiuso ${data(g.completed_at)}` : ""}{g.due_at ? ` · scadenza ${data(g.due_at)}` : ""}
          </Typography>
          {g.tasks.length > 0 && (
            <Table size="small" sx={{ mt: 0.5 }}>
              <TableHead>
                <TableRow><TableCell>Chi</TableCell><TableCell>Esito</TableCell></TableRow>
              </TableHead>
              <TableBody>
                {g.tasks.map((t, i) => (
                  <TableRow key={t.id ?? i}>
                    <TableCell>{t.assignee?.name}</TableCell>
                    <TableCell>
                      {t.status === "DONE" ? etichettaEsito(t.outcome)
                        : t.waiting ? "In attesa di chiarimento"
                        : t.status === "CANCELLED" && t.cancel_reason ? t.cancel_reason
                        : STATO_COMPITO[t.status] ?? t.status}
                      {t.comment && <Typography variant="caption" display="block" fontStyle="italic">“{t.comment}”</Typography>}
                      {t.completed_at && <Typography variant="caption" display="block" color="text.secondary">{data(t.completed_at)}</Typography>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <RitorniDelGiro ist={ist} nodoId={nodoId} round={g.round} sendBackId={g.send_back_id} />
        </Box>
      ))}
    </Stack>
  );
}

/**
 * Storico dei ritorni di un giro (§6): perché il giro è stato riaperto o rifatto, cosa ha chiesto da qui chi lo
 * aveva in carico (chiarimenti con la risposta, modifiche), e i chiarimenti chiesti a chi lo ha svolto.
 */
function RitorniDelGiro({ ist, nodoId, round, sendBackId }: { ist: Istanza; nodoId: string; round: number; sendBackId?: string | null }) {
  const tutte = ist.send_backs ?? [];
  const origine = sendBackId ? tutte.find((b) => b.id === sendBackId) : undefined;
  const daQui = tutte.filter((b) => b.from.node_id === nodoId && b.from.round === round);
  const aQui = tutte.filter((b) => b.kind === "CLARIFICATION" && b.target.node_id === nodoId && b.target.round === round);
  if (!origine && !daQui.length && !aQui.length) return null;
  const riaperto = origine && origine.target.node_id === nodoId && origine.target.reopened_round === round;
  return (
    <Stack spacing={0.75} mt={1}>
      {origine && (
        <Typography variant="caption" color="text.secondary">
          {riaperto ? "Riaperto per la richiesta di modifiche:" : `Rifatto mentre il flusso tornava a «${origine.from.name}»:`}
        </Typography>
      )}
      {origine && <VoceRitorno b={origine} compatta />}
      {daQui.length > 0 && <Typography variant="caption" color="text.secondary">Chiesto da questo passo:</Typography>}
      {daQui.map((b) => <VoceRitorno key={b.id} b={b} compatta />)}
      {aQui.length > 0 && <Typography variant="caption" color="text.secondary">Chiarimenti chiesti a chi ha svolto questo passo:</Typography>}
      {aQui.map((b) => <VoceRitorno key={b.id} b={b} compatta />)}
    </Stack>
  );
}
