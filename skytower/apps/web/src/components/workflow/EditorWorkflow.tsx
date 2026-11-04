// "><(((º> sabusabu <º)))><"
// Editor dei workflow a grafo (docs/workflow-grafo.md §4): finestra a tutto schermo con la tavolozza dei
// cinque tipi di nodo, il foglio a scacchiera (GrafoWorkflow) e il pannello delle proprietà del nodo o dell'arco
// selezionato. La validazione vera è dell'API (POST .../workflow-templates/validate), chiamata mentre si
// disegna; gli errori si vedono sul nodo/arco e in elenco. Salvare crea una nuova versione del modello.
// Un modello esistente si apre in sola lettura; "Nuova versione" lo rende modificabile come copia.
// Lo stesso editor serve la libreria dell'organizzazione (ADR-50, prop `libreria`): valida e salva sulle rotte della
// libreria e gli assegnatari si scelgono solo per ruolo (le persone cambiano da commessa a commessa). Un modello di
// libreria aperto da una commessa è solo da consultare (`solaLettura`), con le azioni passate in `azioni`.
import { KeyboardEvent, ReactNode, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert, AppBar, Autocomplete, Box, Button, Chip, Dialog, Divider, IconButton, List, ListItemButton, ListItemText,
  MenuItem, Stack, TextField, ToggleButton, ToggleButtonGroup, Toolbar, Tooltip, Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import FitScreenIcon from "@mui/icons-material/FitScreen";
import { api, ApiError, Member, Project, Role } from "../../api";
import { GrafoWorkflow, Selezione } from "./GrafoWorkflow";
import { primaCasellaLibera, spostaDiUna, zoomAdatto } from "./griglia";
import {
  Arco, Assegnatario, Colore, DESCRIZIONE_TIPO, Definizione, ErroreGrafo, Esito, Modello, NOME_COLORE, NOME_TIPO,
  Nodo, Oggetto, TipoAssegnatario, TipoNodo, codiceDaEtichetta, comeGrafo, controlliRapidi, definizioneVuota, erroriLeggibili, esitiDi,
  haEsiti, idNuovo, nodoNuovo,
} from "./modello";

const NOME_ASSEGNATARIO: Record<TipoAssegnatario, string> = {
  role: "Ruolo nella commessa", originator_role: "Ruolo nell'organizzazione autrice", user: "Persona",
};
const SUITABILITY: Record<"SHARED" | "PUBLISHED", string[]> = {
  SHARED: ["S1", "S2", "S3", "S4"],
  PUBLISHED: ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "B1", "B2", "B3", "CR"],
};
const TIPI: TipoNodo[] = ["start", "decision", "activity", "notification", "end"];

/** Ruolo da scegliere fra gli assegnatari: quelli della commessa o, per la libreria, quelli dell'organizzazione. */
type RuoloScelta = Pick<Role, "id" | "code" | "name">;

export function EditorWorkflow({ project, libreria, base, nuovo, solaLettura, azioni, onClose }: {
  /** Commessa del modello (editor della scheda Workflow). */
  project?: Project;
  /** Editor della libreria dell'organizzazione (ADR-50): salva lì e gli assegnatari sono solo ruoli. */
  libreria?: { orgId: string };
  /** Modello da aprire (sola lettura finché non si sceglie "Nuova versione"); null = nuovo workflow. */
  base: Modello | null;
  /** Apre direttamente in modifica (nuova versione del modello `base`). */
  nuovo?: boolean;
  /** Solo consultazione, senza "Nuova versione" (es. modello di libreria aperto da una commessa). */
  solaLettura?: boolean;
  /** Pulsanti in più nella barra in sola lettura (es. "Copia nella commessa"). */
  azioni?: ReactNode;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  // rotte di validazione e salvataggio: libreria dell'organizzazione o modelli della commessa
  const radice = libreria ? `/organizations/${libreria.orgId}/workflow-library` : `/projects/${project?.id}/workflow-templates`;
  const soloRuoli = !!libreria || base?.scope === "LIBRARY";
  const [modifica, setModifica] = useState(!base || !!nuovo);
  const [code, setCode] = useState(base?.code ?? "");
  const [name, setName] = useState(base?.name ?? "");
  const [subject, setSubject] = useState<Oggetto>(base?.subject ?? "DOCUMENT");
  const [def, setDef] = useState<Definizione>(() => (base ? structuredClone(comeGrafo(base.definition)) : definizioneVuota()));
  const [sel, setSel] = useState<Selezione>(null);
  const [zoom, setZoom] = useState(1);
  const [erroriApi, setErroriApi] = useState<ErroreGrafo[] | null>(null);
  // Un modello esistente si apre adattato alla larghezza (lo schema RdA con 7 buyer sarebbe tagliato a destra).
  // Riferimento a callback: la finestra MUI monta il contenuto in un secondo passaggio (portale), quindi al
  // primo effetto il foglio non c'è ancora; l'adattamento parte quando l'elemento compare.
  const [foglio, setFoglio] = useState<HTMLDivElement | null>(null);
  const [adattato, setAdattato] = useState(!base);
  const larghezzaUtile = () => (foglio ? foglio.clientWidth - 24 : 0);
  useEffect(() => {
    if (adattato || !foglio) return;
    setZoom(zoomAdatto(def, larghezzaUtile(), modifica ? { col: 2, row: 2 } : undefined));
    setAdattato(true);
  }, [foglio, adattato]);

  const { data: roles = [] } = useQuery({
    queryKey: libreria ? ["workflow-library-roles", libreria.orgId] : ["roles", project?.id],
    queryFn: () => api<RuoloScelta[]>(libreria ? `${radice}/roles` : `/projects/${project?.id}/roles`),
  });
  // persone solo per i modelli della commessa: in libreria non si indicano
  const { data: members = [] } = useQuery({
    queryKey: ["members", project?.id], enabled: !!project && !libreria,
    queryFn: () => api<Member[]>(`/projects/${project?.id}/members`),
  });
  const persone = useMemo(() => [...new Map(members.map((m) => [m.user_id, m])).values()], [members]);

  // Validazione dell'API mentre si disegna (attesa di 700 ms dopo l'ultima modifica). Se la rotta non c'è
  // ancora (API vecchia) restano i controlli rapidi fatti nella pagina.
  useEffect(() => {
    if (!modifica) return;
    const t = setTimeout(() => {
      api<{ ok: boolean; errors: ErroreGrafo[] }>(`${radice}/validate`, {
        method: "POST", json: { code: code || "BOZZA", name: name || "Bozza", subject, definition: pulisci(def, subject, soloRuoli) },
      }).then((r) => setErroriApi(r.errors ?? [])).catch((e: ApiError) => setErroriApi(e.status === 404 ? null : [{ message: e.message }]));
    }, 700);
    return () => clearTimeout(t);
  }, [def, code, name, subject, modifica, radice]);

  const errori = useMemo(() => (erroriApi ? erroriLeggibili(def, erroriApi) : controlliRapidi(def)), [erroriApi, def]);
  const conErrori = useMemo(() => ({
    nodi: new Set(errori.map((e) => e.node).filter((x): x is string => !!x)),
    archi: new Set(errori.map((e) => indiceArco(def, e.edge)).filter((x): x is number => x !== null)),
  }), [errori, def]);

  const salva = useMutation({
    mutationFn: () => api<Modello>(radice, {
      method: "POST", json: { code, name, subject, definition: pulisci(def, subject, soloRuoli) },
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: libreria ? ["workflow-library", libreria.orgId] : ["workflow-templates", project?.id] });
      onClose();
    },
  });

  // ---------------------------------------------------------------- operazioni sul grafo
  const nodo = (id: string) => def.nodes.find((n) => n.id === id);
  const aggiornaNodo = (id: string, patch: Partial<Nodo>) =>
    setDef((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  const collega = (from: string, outcome: string | undefined, to: string) => setDef((d) => {
    if (d.edges.some((a) => a.from === from && (a.outcome ?? "") === (outcome ?? "") && a.to === to)) return d;
    const n = d.nodes.find((x) => x.id === from);
    if (!n || n.type === "end" || to === from) return d;
    // da inizio e notifica si esce senza esito; da decisione e attività serve l'esito (il primo, se manca)
    const esito = haEsiti(n.type) ? outcome ?? esitiDi(n)[0]?.code : undefined;
    if (haEsiti(n.type) && !esito) return d;
    return { ...d, edges: [...d.edges, esito ? { from, outcome: esito, to } : { from, to }] };
  });
  const aggiungiNodo = (tipo: TipoNodo) => {
    const da = sel?.tipo === "nodo" ? nodo(sel.id) ?? null : null;
    const id = idNuovo(tipo, def.nodes.map((n) => n.id));
    const n = nodoNuovo(tipo, id, primaCasellaLibera(def.nodes, da));
    setDef((d) => {
      const nodes = [...d.nodes, n];
      let edges = d.edges;
      // collegamento automatico dal nodo selezionato: primo esito ancora scollegato, o l'uscita libera
      if (da && da.type !== "end" && tipo !== "start") {
        const libero = haEsiti(da.type)
          ? esitiDi(da).find((e) => !d.edges.some((a) => a.from === da.id && a.outcome === e.code))?.code
          : d.edges.some((a) => a.from === da.id) ? null : "";
        if (libero !== null && libero !== undefined) edges = [...edges, libero ? { from: da.id, outcome: libero, to: id } : { from: da.id, to: id }];
      }
      return { ...d, nodes, edges };
    });
    setSel({ tipo: "nodo", id });
  };
  const eliminaNodo = (id: string) => {
    setDef((d) => ({ ...d, nodes: d.nodes.filter((n) => n.id !== id), edges: d.edges.filter((a) => a.from !== id && a.to !== id) }));
    setSel(null);
  };
  const eliminaArco = (i: number) => { setDef((d) => ({ ...d, edges: d.edges.filter((_, j) => j !== i) })); setSel(null); };
  const piu = (id: string) => {
    const n = nodo(id);
    if (!n) return;
    if (haEsiti(n.type)) {
      const esiti = esitiDi(n);
      aggiornaNodo(id, { outcomes: [...esiti, { code: codiceDaEtichetta("Nuovo esito", esiti.map((e) => e.code)), label: "Nuovo esito", color: "yellow" }] });
      setSel({ tipo: "nodo", id });
    } else {
      setSel({ tipo: "nodo", id });
      aggiungiNodo("decision");
    }
  };
  const tastoNodo = (id: string, e: KeyboardEvent) => {
    if (!modifica) return;
    const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (dir[e.key]) {
      e.preventDefault();
      const c = spostaDiUna(def.nodes, id, ...dir[e.key]);
      if (c) aggiornaNodo(id, { cell: c });
    } else if (e.key === "Delete") {
      e.preventDefault();
      eliminaNodo(id);
    }
  };
  const adatta = () => foglio && setZoom(zoomAdatto(def, larghezzaUtile(), modifica ? { col: 2, row: 2 } : undefined));

  const valido = /^[A-Z][A-Z0-9_]{1,40}$/.test(code) && name.trim().length >= 2 && errori.length === 0;
  const selNodo = sel?.tipo === "nodo" ? nodo(sel.id) : undefined;
  const selArco = sel?.tipo === "arco" ? def.edges[sel.indice] : undefined;

  return (
    <Dialog open fullScreen onClose={onClose} aria-labelledby="titolo-editor-workflow"
            PaperProps={{ onKeyDown: (e: KeyboardEvent) => {
              if (modifica && sel?.tipo === "arco" && e.key === "Delete") { e.preventDefault(); eliminaArco(sel.indice); }
            } }}>
      <AppBar position="sticky" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar sx={{ gap: 1.5, flexWrap: "wrap", py: 1 }}>
          <IconButton edge="start" onClick={onClose} aria-label="Chiudi l'editor"><CloseIcon /></IconButton>
          <Typography id="titolo-editor-workflow" variant="h6" component="h2" fontWeight={600} sx={{ mr: 1 }}>
            {!base ? (libreria ? "Nuovo workflow di libreria" : "Nuovo workflow")
              : modifica ? `Nuova versione di ${base.code}` : `${base.name} · v${base.version}`}
          </Typography>
          {modifica ? (
            <>
              <TextField size="small" label="Codice" value={code} disabled={!!base} sx={{ width: 190 }}
                         onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} />
              <TextField size="small" label="Nome" value={name} onChange={(e) => setName(e.target.value)} sx={{ minWidth: 240, flexGrow: 1 }} />
              <ToggleButtonGroup size="small" exclusive value={subject} onChange={(_, v) => v && setSubject(v)} aria-label="Si avvia su">
                <ToggleButton value="DOCUMENT">Documenti</ToggleButton>
                <ToggleButton value="PROCESS">Processi</ToggleButton>
              </ToggleButtonGroup>
            </>
          ) : (
            <Stack direction="row" spacing={1} flexGrow={1}>
              <Chip size="small" variant="outlined" label={`${base?.code} · v${base?.version}`} sx={{ fontFamily: "monospace" }} />
              <Chip size="small" label={subject === "PROCESS" ? "Processi" : "Documenti"} />
              {soloRuoli && <Chip size="small" color="primary" label="Libreria" />}
            </Stack>
          )}
          <Stack direction="row">
            <Tooltip title="Riduci"><IconButton onClick={() => setZoom((z) => Math.max(0.35, z - 0.1))} aria-label="Riduci"><ZoomOutIcon /></IconButton></Tooltip>
            <Tooltip title="Ingrandisci"><IconButton onClick={() => setZoom((z) => Math.min(1.6, z + 0.1))} aria-label="Ingrandisci"><ZoomInIcon /></IconButton></Tooltip>
            <Tooltip title="Adatta alla finestra"><IconButton onClick={adatta} aria-label="Adatta alla finestra"><FitScreenIcon /></IconButton></Tooltip>
          </Stack>
          {modifica ? (
            <Button variant="contained" disabled={!valido || salva.isPending} onClick={() => salva.mutate()}>
              {base ? `Salva come v${base.version + 1}` : "Salva"}
            </Button>
          ) : solaLettura ? (
            azioni ?? null
          ) : (
            <Button variant="contained" onClick={() => setModifica(true)}>Nuova versione</Button>
          )}
        </Toolbar>
      </AppBar>
      <Stack direction="row" sx={{ flexGrow: 1, minHeight: 0 }}>
        {modifica && (
          <Box component="nav" aria-label="Tavolozza dei nodi" sx={{ width: 168, flexShrink: 0, p: 1.5, borderRight: 1, borderColor: "divider", overflowY: "auto" }}>
            <Typography variant="subtitle2" gutterBottom>Aggiungi</Typography>
            <Stack spacing={1}>
              {TIPI.map((t) => (
                <Tooltip key={t} title={DESCRIZIONE_TIPO[t]} placement="right">
                  <span>
                    <Button fullWidth variant="outlined" size="small" startIcon={<AddIcon />} sx={{ justifyContent: "flex-start" }}
                            disabled={t === "start" && def.nodes.some((n) => n.type === "start")} onClick={() => aggiungiNodo(t)}>
                      {NOME_TIPO[t]}
                    </Button>
                  </span>
                </Tooltip>
              ))}
            </Stack>
            <Typography variant="caption" color="text.secondary" display="block" mt={2}>
              Il nodo nuovo va nella prima casella libera a destra di quello selezionato e ne prende l'esito libero.
              Trascina un nodo per cambiargli casella (anche con le frecce), trascina dal bollino di un esito a un
              nodo per collegarli; Canc elimina il nodo o l'arco selezionato.
            </Typography>
          </Box>
        )}
        <Box ref={setFoglio} sx={{ flexGrow: 1, minWidth: 0, p: 1.5, overflow: "auto" }}>
          <GrafoWorkflow definizione={def} modo="modifica" solaLettura={!modifica} zoom={zoom} altezzaMax="calc(100vh - 110px)"
                         etichetta={`Schema del workflow ${name || code || "nuovo"}`} selezione={sel} onSeleziona={setSel}
                         onSposta={(id, cell) => aggiornaNodo(id, { cell })} onCollega={collega} onPiu={piu}
                         onTastoNodo={tastoNodo} errori={modifica ? conErrori : undefined} />
        </Box>
        <Box component="aside" aria-label="Proprietà" sx={{ width: 340, flexShrink: 0, borderLeft: 1, borderColor: "divider", p: 2, overflowY: "auto" }}>
          {salva.error && <Alert severity="error" sx={{ mb: 2 }}>{(salva.error as ApiError).message}</Alert>}
          {selNodo ? (
            <PannelloNodo key={selNodo.id} n={selNodo} def={def} modifica={modifica} roles={roles} persone={persone} soloRuoli={soloRuoli}
                          aggiorna={(patch) => aggiornaNodo(selNodo.id, patch)}
                          setDef={setDef} elimina={() => eliminaNodo(selNodo.id)} collega={collega} />
          ) : selArco && sel?.tipo === "arco" ? (
            <PannelloArco a={selArco} indice={sel.indice} def={def} modifica={modifica} setDef={setDef} elimina={() => eliminaArco(sel.indice)} />
          ) : (
            <PannelloModello def={def} setDef={setDef} subject={subject} modifica={modifica} persone={persone} soloRuoli={soloRuoli} />
          )}
          {modifica && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle2" gutterBottom>
                {errori.length ? `Da sistemare prima di salvare (${errori.length})` : "Nessun errore: si può salvare"}
              </Typography>
              <List dense disablePadding aria-label="Errori di validazione">
                {errori.map((e, i) => (
                  <ListItemButton key={i} onClick={() => {
                    const ia = indiceArco(def, e.edge);
                    if (e.node) setSel({ tipo: "nodo", id: e.node });
                    else if (ia !== null) setSel({ tipo: "arco", indice: ia });
                  }}>
                    <ListItemText primaryTypographyProps={{ variant: "body2", color: "error.main" }} primary={e.message} />
                  </ListItemButton>
                ))}
              </List>
            </>
          )}
        </Box>
      </Stack>
    </Dialog>
  );
}

/** Indice dell'arco a cui si riferisce un errore dell'API (indice o terna from/outcome/to). */
function indiceArco(def: Definizione, edge: ErroreGrafo["edge"]): number | null {
  if (edge === null || edge === undefined) return null;
  if (typeof edge === "number") return edge >= 0 && edge < def.edges.length ? edge : null;
  const i = def.edges.findIndex((a) => a.from === edge.from && a.to === edge.to && (a.outcome ?? "") === (edge.outcome ?? ""));
  return i < 0 ? null : i;
}

/** Definizione da mandare all'API: niente campi che non c'entrano col tipo, `on_completed` solo per i documenti;
 *  per la libreria (`soloRuoli`) niente escalation verso una persona. */
function pulisci(def: Definizione, subject: Oggetto, soloRuoli = false): Definizione {
  const nodes = def.nodes.map((n) => {
    const base: Nodo = { id: n.id, type: n.type, name: n.name.trim(), cell: n.cell };
    if (n.join && def.edges.filter((a) => a.to === n.id).length > 1) base.join = n.join;
    if (n.type === "decision" || n.type === "activity")
      return { ...base, assignees: n.assignees ?? [], quorum: n.quorum ?? "ALL", sla_hours: n.sla_hours || null, outcomes: esitiDi(n) };
    if (n.type === "notification") return { ...base, recipients: n.recipients ?? [], message: n.message ?? "" };
    if (n.type === "end") return { ...base, result: n.result ?? "OK" };
    return base;
  });
  return {
    version: 2, nodes, edges: def.edges,
    on_completed: subject === "DOCUMENT" ? def.on_completed ?? null : null,
    escalation_user_id: soloRuoli ? null : def.escalation_user_id ?? null,
  };
}

// ---------------------------------------------------------------- pannelli delle proprietà
function PannelloModello({ def, setDef, subject, modifica, persone, soloRuoli }: {
  def: Definizione; setDef: (f: (d: Definizione) => Definizione) => void; subject: Oggetto; modifica: boolean; persone: Member[];
  soloRuoli: boolean;
}) {
  const oc = def.on_completed ?? null;
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1" component="h3" fontWeight={600}>Modello</Typography>
      <Typography variant="body2" color="text.secondary">
        {subject === "PROCESS"
          ? "Si avvia dalla scheda Processi del progetto, senza documento, con eventuali documenti allegati."
          : "Si avvia su una revisione di documento; alla fine positiva il documento può cambiare stato."}
        {" "}Seleziona un nodo o un arco per modificarlo.
      </Typography>
      {subject === "DOCUMENT" && (
        <Stack direction="row" spacing={1}>
          <TextField select size="small" label="Alla fine positiva" fullWidth disabled={!modifica} value={oc?.to_state ?? ""}
                     onChange={(e) => setDef((d) => ({ ...d, on_completed: e.target.value
                       ? { to_state: e.target.value as "SHARED" | "PUBLISHED", suitability: SUITABILITY[e.target.value as "SHARED" | "PUBLISHED"][0] } : null }))}>
            <MenuItem value="">Nessun cambio di stato</MenuItem>
            <MenuItem value="SHARED">Condividi (SHARED)</MenuItem>
            <MenuItem value="PUBLISHED">Pubblica (PUBLISHED)</MenuItem>
          </TextField>
          {oc && (
            <TextField select size="small" label="Idoneità" sx={{ minWidth: 100 }} disabled={!modifica} value={oc.suitability}
                       onChange={(e) => setDef((d) => ({ ...d, on_completed: { ...oc, suitability: e.target.value } }))}>
              {SUITABILITY[oc.to_state].map((s) => <MenuItem key={s} value={s}>{s}</MenuItem>)}
            </TextField>
          )}
        </Stack>
      )}
      {soloRuoli ? (
        <Alert severity="info" variant="outlined">
          Modello della libreria dell'organizzazione: vale in tutte le sue commesse, quindi assegnatari e destinatari
          si scelgono per ruolo. Se un compito scade sono avvisati i Project Admin della commessa.
        </Alert>
      ) : (
        <Autocomplete size="small" options={persone} disabled={!modifica}
                      value={persone.find((p) => p.user_id === def.escalation_user_id) ?? null}
                      getOptionLabel={(m) => `${m.first_name} ${m.last_name} (${m.organization_code})`}
                      onChange={(_, m) => setDef((d) => ({ ...d, escalation_user_id: m?.user_id ?? null }))}
                      renderInput={(p) => <TextField {...p} label="Escalation se un compito scade (facoltativo)" />} />
      )}
      <Typography variant="caption" color="text.secondary">
        {def.nodes.length} nodi, {def.edges.length} archi.
      </Typography>
    </Stack>
  );
}

function PannelloArco({ a, indice, def, modifica, setDef, elimina }: {
  a: Arco; indice: number; def: Definizione; modifica: boolean; setDef: (f: (d: Definizione) => Definizione) => void; elimina: () => void;
}) {
  const da = def.nodes.find((n) => n.id === a.from);
  const esito = da ? esitiDi(da).find((e) => e.code === a.outcome) : undefined;
  return (
    <Stack spacing={2}>
      <Typography variant="subtitle1" component="h3" fontWeight={600}>Arco</Typography>
      <Typography variant="body2">
        Da <b>{da?.name}</b>{esito ? <> con l'esito <b>{esito.label}</b></> : null}
      </Typography>
      <TextField select size="small" label="Porta a" disabled={!modifica} value={a.to}
                 onChange={(e) => setDef((d) => ({ ...d, edges: d.edges.map((x, j) => (j === indice ? { ...x, to: e.target.value } : x)) }))}>
        {def.nodes.filter((n) => n.type !== "start" && n.id !== a.from).map((n) => <MenuItem key={n.id} value={n.id}>{n.name}</MenuItem>)}
      </TextField>
      {modifica && <Button color="error" startIcon={<DeleteIcon />} onClick={elimina} sx={{ alignSelf: "flex-start" }}>Elimina arco</Button>}
    </Stack>
  );
}

function PannelloNodo({ n, def, modifica, roles, persone, soloRuoli, aggiorna, setDef, elimina, collega }: {
  n: Nodo; def: Definizione; modifica: boolean; roles: RuoloScelta[]; persone: Member[]; soloRuoli: boolean;
  aggiorna: (patch: Partial<Nodo>) => void; setDef: (f: (d: Definizione) => Definizione) => void; elimina: () => void;
  collega: (from: string, outcome: string | undefined, to: string) => void;
}) {
  const entranti = def.edges.filter((a) => a.to === n.id).length;
  const esiti = esitiDi(n);
  const destinazioni = def.nodes.filter((x) => x.type !== "start" && x.id !== n.id);
  const nomeDi = (id: string) => def.nodes.find((x) => x.id === id)?.name ?? id;

  /** Cambia un esito; se cambia il codice (etichetta nuova di un esito col codice automatico) segue anche gli archi. */
  const cambiaEsito = (i: number, patch: Partial<Esito>) => {
    const vecchio = esiti[i];
    const nuovo = { ...vecchio, ...patch };
    if (patch.label !== undefined && vecchio.code === codiceDaEtichetta(vecchio.label, esiti.filter((_, j) => j !== i).map((e) => e.code)))
      nuovo.code = codiceDaEtichetta(patch.label || "Esito", esiti.filter((_, j) => j !== i).map((e) => e.code));
    setDef((d) => ({
      ...d,
      nodes: d.nodes.map((x) => (x.id === n.id ? { ...x, outcomes: esiti.map((e, j) => (j === i ? nuovo : e)) } : x)),
      edges: d.edges.map((a) => (a.from === n.id && a.outcome === vecchio.code ? { ...a, outcome: nuovo.code } : a)),
    }));
  };
  const togliEsito = (i: number) => setDef((d) => ({
    ...d,
    nodes: d.nodes.map((x) => (x.id === n.id ? { ...x, outcomes: esiti.filter((_, j) => j !== i) } : x)),
    edges: d.edges.filter((a) => !(a.from === n.id && a.outcome === esiti[i].code)),
  }));
  const scollega = (outcome: string | undefined, to: string) => setDef((d) => ({
    ...d, edges: d.edges.filter((a) => !(a.from === n.id && (a.outcome ?? "") === (outcome ?? "") && a.to === to)),
  }));

  /** Destinazioni di un'uscita: chip eliminabili più la tendina "Collega a…" (alternativa al trascinamento). */
  const Uscite = ({ outcome }: { outcome?: string }) => {
    const verso = def.edges.filter((a) => a.from === n.id && (a.outcome ?? "") === (outcome ?? "")).map((a) => a.to);
    return (
      <Stack spacing={0.75}>
        <Stack direction="row" gap={0.5} flexWrap="wrap">
          {verso.length === 0 && <Typography variant="caption" color="error.main">Non porta a nessun nodo</Typography>}
          {verso.map((to) => (
            <Chip key={to} size="small" label={`→ ${nomeDi(to)}`} onDelete={modifica ? () => scollega(outcome, to) : undefined} />
          ))}
        </Stack>
        {modifica && (
          <TextField select size="small" label="Collega a…" value="" onChange={(e) => collega(n.id, outcome, e.target.value)}>
            {destinazioni.filter((x) => !verso.includes(x.id)).map((x) => <MenuItem key={x.id} value={x.id}>{x.name}</MenuItem>)}
          </TextField>
        )}
        {verso.length > 1 && <Typography variant="caption" color="text.secondary">{verso.length} rami in parallelo</Typography>}
      </Stack>
    );
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Typography variant="subtitle1" component="h3" fontWeight={600} flexGrow={1}>{NOME_TIPO[n.type]}</Typography>
        <Typography variant="caption" color="text.secondary" fontFamily="monospace">{n.id} · {n.cell.col + 1},{n.cell.row + 1}</Typography>
      </Stack>
      <TextField size="small" label="Nome" value={n.name} disabled={!modifica} inputProps={{ maxLength: 100 }}
                 onChange={(e) => aggiorna({ name: e.target.value })} />

      {(n.type === "decision" || n.type === "activity") && (
        <>
          <Assegnatari titolo="Assegnatari" valore={n.assignees ?? []} modifica={modifica} roles={roles} persone={persone} soloRuoli={soloRuoli}
                       onChange={(assignees) => aggiorna({ assignees })} />
          <Stack direction="row" spacing={1}>
            <TextField select size="small" label="Decidono" sx={{ minWidth: 140 }} disabled={!modifica}
                       value={typeof n.quorum === "object" ? "N" : n.quorum ?? "ALL"}
                       onChange={(e) => aggiorna({ quorum: e.target.value === "N" ? { n: 2 } : e.target.value as "ALL" | "ANY" })}>
              <MenuItem value="ALL">Tutti</MenuItem>
              <MenuItem value="ANY">Uno qualsiasi</MenuItem>
              <MenuItem value="N">Almeno N</MenuItem>
            </TextField>
            {typeof n.quorum === "object" && (
              <TextField size="small" type="number" label="N" sx={{ width: 70 }} disabled={!modifica} value={n.quorum.n}
                         inputProps={{ min: 1, max: 50 }} onChange={(e) => aggiorna({ quorum: { n: Math.max(1, Number(e.target.value)) } })} />
            )}
            <TextField size="small" type="number" label="Scadenza (ore)" disabled={!modifica} value={n.sla_hours ?? ""}
                       inputProps={{ min: 1, max: 2160 }} onChange={(e) => aggiorna({ sla_hours: e.target.value ? Number(e.target.value) : null })} />
          </Stack>
          <Divider textAlign="left"><Typography variant="caption">Esiti</Typography></Divider>
          <Typography variant="caption" color="text.secondary">
            Un esito rosso decide subito (basta una persona); gli altri quando raggiungono il quorum.
          </Typography>
          {esiti.map((e, i) => (
            <Box key={e.code} sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 1.25 }}>
              <Stack spacing={1}>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField size="small" label="Etichetta" value={e.label} disabled={!modifica} inputProps={{ maxLength: 40 }}
                             onChange={(ev) => cambiaEsito(i, { label: ev.target.value })} sx={{ flexGrow: 1 }} />
                  <TextField select size="small" label="Colore" value={e.color} disabled={!modifica} sx={{ width: 110 }}
                             onChange={(ev) => cambiaEsito(i, { color: ev.target.value as Colore })}>
                    {(Object.keys(NOME_COLORE) as Colore[]).map((c) => <MenuItem key={c} value={c}>{NOME_COLORE[c]}</MenuItem>)}
                  </TextField>
                  {modifica && (
                    <IconButton size="small" aria-label={`Togli l'esito ${e.label}`} disabled={esiti.length === 1} onClick={() => togliEsito(i)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  )}
                </Stack>
                <Typography variant="caption" color="text.secondary" fontFamily="monospace">{e.code}</Typography>
                <Uscite outcome={e.code} />
              </Stack>
            </Box>
          ))}
          {modifica && esiti.length < 8 && (
            <Button size="small" startIcon={<AddIcon />} sx={{ alignSelf: "flex-start" }}
                    onClick={() => aggiorna({ outcomes: [...esiti, { code: codiceDaEtichetta("Nuovo esito", esiti.map((x) => x.code)), label: "Nuovo esito", color: "yellow" }] })}>
              Aggiungi esito
            </Button>
          )}
        </>
      )}

      {n.type === "notification" && (
        <>
          <Assegnatari titolo="Destinatari" valore={n.recipients ?? []} modifica={modifica} roles={roles} persone={persone} soloRuoli={soloRuoli}
                       onChange={(recipients) => aggiorna({ recipients })} />
          <TextField size="small" label="Messaggio" multiline minRows={2} disabled={!modifica} value={n.message ?? ""}
                     onChange={(e) => aggiorna({ message: e.target.value })}
                     helperText="Si possono usare {titolo}, {progetto} e {documento}" />
        </>
      )}
      {(n.type === "start" || n.type === "notification") && (
        <>
          <Divider textAlign="left"><Typography variant="caption">Porta a</Typography></Divider>
          <Uscite />
        </>
      )}
      {n.type === "end" && (
        <ToggleButtonGroup size="small" exclusive disabled={!modifica} value={n.result ?? "OK"} onChange={(_, v) => v && aggiorna({ result: v })}
                           aria-label="Esito finale">
          <ToggleButton value="OK" color="success">Concluso (OK)</ToggleButton>
          <ToggleButton value="KO" color="error">Fallito (KO)</ToggleButton>
        </ToggleButtonGroup>
      )}
      {entranti > 1 && (
        <TextField select size="small" label="Quando arrivano più rami" disabled={!modifica} value={n.join ?? "ALL"}
                   onChange={(e) => aggiorna({ join: e.target.value as "ALL" | "ANY" })}
                   helperText={`${entranti} archi in entrata`}>
          <MenuItem value="ALL">Aspetta tutti i rami ancora in corso</MenuItem>
          <MenuItem value="ANY">Parte al primo arrivo</MenuItem>
        </TextField>
      )}
      {modifica && <Button color="error" startIcon={<DeleteIcon />} onClick={elimina} sx={{ alignSelf: "flex-start" }}>Elimina nodo</Button>}
    </Stack>
  );
}

/** Selettore degli assegnatari (o dei destinatari di una notifica): stesso modello della versione 1.
 *  In libreria (`soloRuoli`) la persona non si può scegliere: solo ruolo nella commessa o nell'organizzazione autrice. */
function Assegnatari({ titolo, valore, modifica, roles, persone, soloRuoli, onChange }: {
  titolo: string; valore: Assegnatario[]; modifica: boolean; roles: RuoloScelta[]; persone: Member[]; soloRuoli: boolean;
  onChange: (v: Assegnatario[]) => void;
}) {
  const cambia = (k: number, a: Assegnatario) => onChange(valore.map((x, j) => (j === k ? a : x)));
  const tipi = (Object.keys(NOME_ASSEGNATARIO) as TipoAssegnatario[]).filter((t) => !soloRuoli || t !== "user");
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">{titolo}</Typography>
      {valore.map((a, k) => (
        <Stack key={k} spacing={0.75} sx={{ borderLeft: 3, borderColor: "divider", pl: 1 }}>
          <Stack direction="row" spacing={0.5} alignItems="center">
            <TextField select size="small" label="Tipo" value={a.type} disabled={!modifica} fullWidth
                       onChange={(e) => cambia(k, { type: e.target.value as TipoAssegnatario })}>
              {tipi.map((t) => <MenuItem key={t} value={t}>{NOME_ASSEGNATARIO[t]}</MenuItem>)}
            </TextField>
            {modifica && (
              <IconButton size="small" aria-label={`Togli ${titolo.toLowerCase()} ${k + 1}`} disabled={valore.length === 1}
                          onClick={() => onChange(valore.filter((_, j) => j !== k))}><DeleteIcon fontSize="small" /></IconButton>
            )}
          </Stack>
          {a.type === "user" ? (
            <Autocomplete size="small" options={persone} disabled={!modifica} value={persone.find((p) => p.user_id === a.id) ?? null}
                          getOptionLabel={(m) => `${m.first_name} ${m.last_name} (${m.organization_code})`}
                          onChange={(_, m) => cambia(k, { type: "user", id: m?.user_id })}
                          renderInput={(p) => <TextField {...p} label="Persona" />} />
          ) : (
            <TextField select size="small" label="Ruolo" value={a.code ?? ""} disabled={!modifica}
                       onChange={(e) => cambia(k, { type: a.type, code: e.target.value })}>
              {roles.map((r) => <MenuItem key={r.id} value={r.code}>{r.name} ({r.code})</MenuItem>)}
            </TextField>
          )}
        </Stack>
      ))}
      {modifica && valore.length < 20 && (
        <Button size="small" startIcon={<AddIcon />} sx={{ alignSelf: "flex-start" }}
                onClick={() => onChange([...valore, { type: "role", code: "" }])}>{titolo === "Destinatari" ? "Destinatario" : "Assegnatario"}</Button>
      )}
    </Stack>
  );
}
