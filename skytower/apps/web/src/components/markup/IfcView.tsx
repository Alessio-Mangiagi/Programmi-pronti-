// "><(((º> sabusabu <º)))><"
// Modello IFC nel browser: geometria letta con web-ifc (WASM) e resa con three.js. Orbita, selezione di un
// elemento con proprietà e Pset, albero spaziale per piani, sezioni orizzontale e verticale (asse X o Y, lato
// invertibile, piano guida visibile mentre si trascina). Gli elementi annotati sono
// colorati con il colore dell'annotazione; in modalità "Annota" un clic su un elemento lo propone per un commento.
// Per l'elemento selezionato: misure ricavate dalla geometria, piano con il codice livello della naming convention,
// documenti che lo citano (nome o GUID nel testo indicizzato) e tavole dello stesso piano, apribili al volo.
// Caricato a richiesta: three.js e web-ifc non pesano sul bundle iniziale.
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert, Box, CircularProgress, Collapse, Divider, IconButton, LinearProgress, List, ListItemButton, ListItemText,
  Paper, Slider, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from "@mui/material";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SwapHorizIcon from "@mui/icons-material/SwapHoriz";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IfcAPI } from "web-ifc";
import wasmUrl from "../../../node_modules/web-ifc/web-ifc.wasm?url";   // fuori dall'export map del pacchetto
import { api, type Markup } from "../../api";

export interface PickedElement { guid: string; label: string }

interface SpatialNode { expressID: number; type: string; children: SpatialNode[] }
type Axis = "x" | "z";
interface Range { x: [number, number]; y: [number, number]; z: [number, number] }
interface Storey { id: number; name: string; elevation: number; level: string }
interface Measures { length: number; width: number; height: number; volume: number }
interface LinkedDoc {
  id: string; identifier: string; title: string; current_revision: string | null; current_state: string | null;
  match_snippet?: string | null; match_revision?: string | null;
}
interface ElementDocs { cited: LinkedDoc[]; same_level: LinkedDoc[]; level: string | null }
interface Props { name: string; guid: string; type: string; psets: { name: string; props: [string, string][] }[] }

const SELECT_COLOR = new THREE.Color("#1976d2");
const OFF = 1e9;
const TYPE_COLOR: Record<string, string> = {
  IFCWALL: "#e6dccb", IFCWALLSTANDARDCASE: "#e6dccb", IFCSLAB: "#aeb7c0", IFCROOF: "#b5654f", IFCBEAM: "#c2a27c",
  IFCCOLUMN: "#c2a27c", IFCMEMBER: "#c2a27c", IFCWINDOW: "#9fd0ee", IFCDOOR: "#a77b52", IFCSTAIR: "#cfc6b8",
  IFCRAILING: "#7d8790", IFCCOVERING: "#ddd5c8", IFCFURNISHINGELEMENT: "#d8b98c",
};
const str = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "value" in (v as Record<string, unknown>)) return String((v as { value: unknown }).value);
  return String(v);
};

export interface IfcViewProps {
  url: string;
  projectId: string;
  documentId: string;
  /** apre un altro documento (in una nuova scheda), con il testo da evidenziare */
  onOpenDocument: (documentId: string, search: string) => void;
  markups: Markup[];
  selectedRef: string | null;
  drawing: boolean;
  onPick: (e: PickedElement) => void;
  onSelectMarkup: (id: string) => void;
}

export default function IfcView({ url, projectId, documentId, onOpenDocument, markups, selectedRef, drawing, onPick, onSelectMarkup }: IfcViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<SpatialNode | null>(null);
  const [selected, setSelected] = useState<{ id: number; props: Props | null } | null>(null);
  const [storeys, setStoreys] = useState<Map<number, Storey>>(new Map());
  const measures = useMemo(() => (selected ? engine.current?.measures(selected.id) ?? null : null), [selected?.id]);  // eslint-disable-line react-hooks/exhaustive-deps
  const [cut, setCut] = useState<number | null>(null);
  const [bounds, setBounds] = useState<Range | null>(null);
  const [vAxis, setVAxis] = useState<Axis | null>(null);
  const [vCut, setVCut] = useState(0);
  const [vFlip, setVFlip] = useState(false);
  const [guide, setGuide] = useState<"h" | "v" | null>(null);      // piano guida mentre si trascina
  const drawingRef = useRef(drawing);
  drawingRef.current = drawing;

  const select = async (id: number | null, fromClick = false) => {
    const e = engine.current;
    if (!e) return;
    e.highlight(id);
    if (id === null) { setSelected(null); return; }
    setSelected({ id, props: null });
    const props = await e.properties(id);
    setSelected({ id, props });
    if (fromClick && props) {
      const markup = markups.find((m) => m.element_ref === props.guid);
      if (drawingRef.current) onPick({ guid: props.guid, label: `${props.type} ${props.name}`.trim() });
      else if (markup) onSelectMarkup(markup.id);
    }
  };
  const selectRef = useRef(select);
  selectRef.current = select;

  useEffect(() => {
    let alive = true;
    const e = new Engine(host.current!, (id) => selectRef.current(id, true));
    engine.current = e;
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = new Uint8Array(await res.arrayBuffer());
        if (!alive) return;
        await e.load(data, (p) => alive && setProgress(p));
        if (!alive) return;
        setBounds(e.ranges());
        const spatial = await e.spatial();
        setTree(spatial);
        if (spatial) setStoreys(storeyIndex(spatial, e));
        setProgress(null);
      } catch (err) {
        console.error("viewer IFC:", err);
        // fino a web-ifc 0.0.57 embind generava codice con eval, bloccato dalla CSP (ADR-22): ora non più, ma se
        // una versione futura lo reintroducesse l'utente riceve un messaggio chiaro invece dell'errore tecnico
        const blocked = err instanceof EvalError || /Content Security Policy|unsafe-eval/i.test((err as Error).message);
        if (alive) setError(blocked
          ? "il viewer 3D non può avviarsi con le impostazioni di sicurezza di questa installazione. Usa «Scarica» per aprire il modello in un programma BIM."
          : (err as Error).message);
      }
    })();
    return () => { alive = false; e.dispose(); engine.current = null; };
  }, [url]);

  // annotazioni sugli elementi: colore dell'annotazione aperta più recente
  useEffect(() => {
    const colors = new Map<string, string>();
    for (const m of markups) if (m.element_ref && m.status === "OPEN") colors.set(m.element_ref, m.color);
    engine.current?.tint(colors);
  }, [markups, progress]);

  useEffect(() => {
    const e = engine.current;
    if (!e || !selectedRef || progress !== null) return;
    const id = e.idOf(selectedRef);
    if (id !== undefined) { select(id); e.focus(id); }
  }, [selectedRef, progress]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { engine.current?.section(cut); }, [cut]);
  useEffect(() => { engine.current?.sectionV(vAxis, vCut, vFlip); }, [vAxis, vCut, vFlip]);
  useEffect(() => { engine.current?.showGuide(guide); }, [guide, cut, vAxis, vCut]);
  const vRange = bounds && vAxis ? bounds[vAxis] : null;
  // in three.js l'asse Y del modello IFC è -Z: le quote mostrate sono quelle del file
  const vLabel = (v: number) => `${(vAxis === "z" ? -v : v).toFixed(2)} m`;
  const step = (r: [number, number]) => (r[1] - r[0]) / 200 || 0.01;

  return (
    <Box display="flex" flexGrow={1} minHeight={0} width="100%" position="relative">
      <Box ref={host} flexGrow={1} minWidth={0} sx={{ cursor: drawing ? "crosshair" : "grab", "& canvas": { display: "block" } }} />
      {progress !== null && !error && (
        <Stack position="absolute" top="45%" left={0} right={0} alignItems="center" spacing={1}>
          <CircularProgress sx={{ color: "#fff" }} />
          <Typography color="#fff" variant="body2">Lettura del modello… {Math.round(progress * 100)}%</Typography>
          <LinearProgress variant="determinate" value={progress * 100} sx={{ width: 240 }} />
        </Stack>
      )}
      {error && <Alert severity="error" sx={{ position: "absolute", top: 16, left: 16 }}>Modello non leggibile: {error}</Alert>}
      {progress === null && (
        <Paper elevation={3} sx={{ position: "absolute", top: 12, left: 12, width: 280, maxHeight: "calc(100% - 24px)",
                                    display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {bounds && (
            <Box px={2} pt={1.5} component="section" aria-label="Sezioni">
              <Typography variant="caption" color="text.secondary">Sezione orizzontale</Typography>
              <Slider size="small" min={bounds.y[0]} max={bounds.y[1]} step={step(bounds.y)} aria-label="Sezione orizzontale"
                      value={cut ?? bounds.y[1]} onChange={(_, v) => { setGuide("h"); setCut(v as number >= bounds.y[1] ? null : v as number); }}
                      onChangeCommitted={() => setGuide(null)}
                      valueLabelDisplay="auto" valueLabelFormat={(v) => `${v.toFixed(2)} m`} />
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography variant="caption" color="text.secondary" flexGrow={1}>Sezione verticale</Typography>
                <ToggleButtonGroup size="small" exclusive value={vAxis ?? "off"} aria-label="Asse della sezione verticale"
                                   onChange={(_, v) => {
                                     if (!v) return;
                                     const axis = v === "off" ? null : v as Axis;
                                     setVAxis(axis);
                                     if (axis) setVCut((bounds[axis][0] + bounds[axis][1]) / 2);
                                   }}>
                  <ToggleButton value="off" sx={{ py: 0.25, px: 1 }}>No</ToggleButton>
                  <ToggleButton value="x" sx={{ py: 0.25, px: 1 }} title="Piano perpendicolare all'asse X del modello">X</ToggleButton>
                  <ToggleButton value="z" sx={{ py: 0.25, px: 1 }} title="Piano perpendicolare all'asse Y del modello">Y</ToggleButton>
                </ToggleButtonGroup>
                <IconButton size="small" aria-label="Inverti lato della sezione" title="Mostra l'altra metà"
                            disabled={!vAxis} onClick={() => setVFlip((f) => !f)}>
                  <SwapHorizIcon fontSize="small" />
                </IconButton>
              </Stack>
              {vRange && (
                <Slider size="small" min={vRange[0]} max={vRange[1]} step={step(vRange)} aria-label="Sezione verticale"
                        value={vCut} onChange={(_, v) => { setGuide("v"); setVCut(v as number); }}
                        onChangeCommitted={() => setGuide(null)} valueLabelDisplay="auto" valueLabelFormat={vLabel} />
              )}
            </Box>
          )}
          <Divider />
          <Box overflow="auto" flexGrow={1}>
            {tree && <TreeNode node={tree} engine={engine.current} depth={0} selectedId={selected?.id ?? null}
                               onSelect={(id) => { select(id); engine.current?.focus(id); }} />}
          </Box>
        </Paper>
      )}
      {selected && (
        <Paper elevation={3} sx={{ position: "absolute", top: 12, right: 12, width: 320, maxHeight: "calc(100% - 24px)", overflow: "auto", p: 1.5 }}>
          {!selected.props ? <CircularProgress size={20} /> : (
            <>
              <Stack direction="row" alignItems="flex-start">
                <Box flexGrow={1} minWidth={0}>
                  <Typography fontWeight={600}>{selected.props.name || "(senza nome)"}</Typography>
                  <Typography variant="caption" color="text.secondary" display="block">{selected.props.type}</Typography>
                  <Typography variant="caption" fontFamily="monospace" color="text.secondary">{selected.props.guid}</Typography>
                </Box>
                <Tooltip title="Inquadra">
                  <IconButton size="small" onClick={() => engine.current?.focus(selected.id)}><CenterFocusStrongIcon fontSize="small" /></IconButton>
                </Tooltip>
              </Stack>
              <MeasuresTable type={selected.props.type} m={measures} />
              <ElementLinks projectId={projectId} documentId={documentId} name={selected.props.name} guid={selected.props.guid}
                            storey={storeys.get(selected.id) ?? null} onOpen={onOpenDocument} />
              {selected.props.psets.map((p) => <Pset key={p.name} name={p.name} props={p.props} />)}
            </>
          )}
        </Paper>
      )}
    </Box>
  );
}

const m2 = (v: number) => `${v.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m`;
const FLAT = new Set(["IFCSLAB", "IFCROOF", "IFCCOVERING", "IFCPLATE"]);
const THIN = new Set(["IFCWALL", "IFCWALLSTANDARDCASE", "IFCCURTAINWALL"]);

/** Misure dell'ingombro dell'elemento, nel suo sistema locale (un muro ruotato non si "allarga"). */
function MeasuresTable({ type, m }: { type: string; m: Measures | null }) {
  if (!m) return null;
  const t = type.toUpperCase();
  const rows: [string, string][] = FLAT.has(t)
    ? [["Lunghezza", m2(m.length)], ["Larghezza", m2(m.width)], ["Spessore", m2(m.height)],
       ["Superficie", `${(m.length * m.width).toLocaleString("it-IT", { maximumFractionDigits: 2 })} m²`]]
    : [["Lunghezza", m2(m.length)], [THIN.has(t) ? "Spessore" : "Larghezza", m2(m.width)], ["Altezza", m2(m.height)]];
  if (m.volume > 0) rows.push(["Volume", `${m.volume.toLocaleString("it-IT", { maximumFractionDigits: 3 })} m³`]);
  return (
    <Box mt={1} component="section" aria-label="Misure">
      <Typography variant="body2" fontWeight={600} px={0.5}>Misure</Typography>
      <Box component="table" sx={{ width: "100%", fontSize: 12, borderCollapse: "collapse", "& td": { py: 0.25, px: 0.5 } }}>
        <tbody>{rows.map(([k, v]) => <tr key={k}><td style={{ color: "#666" }}>{k}</td><td>{v}</td></tr>)}</tbody>
      </Box>
    </Box>
  );
}

const STATE: Record<string, string> = { WIP: "In lavorazione", SHARED: "Condiviso", PUBLISHED: "Pubblicato", ARCHIVED: "Archiviato" };

/** Documenti che citano l'elemento e tavole del suo piano: un clic apre il documento in una nuova scheda, con il nome evidenziato. */
function ElementLinks({ projectId, documentId, name, guid, storey, onOpen }: {
  projectId: string; documentId: string; name: string; guid: string; storey: Storey | null;
  onOpen: (documentId: string, search: string) => void;
}) {
  const params = new URLSearchParams({ exclude: documentId });
  if (name) params.set("name", name);
  if (guid) params.set("guid", guid);
  if (storey) params.set("level", storey.level);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["model-element-docs", projectId, params.toString()],
    queryFn: () => api<ElementDocs>(`/projects/${projectId}/model-element/documents?${params}`),
    enabled: !!(name || guid || storey),
    staleTime: 60_000,
  });
  const item = (d: LinkedDoc, search: string) => (
    <ListItemButton key={d.id} dense onClick={() => onOpen(d.id, search)} sx={{ px: 0.5, alignItems: "flex-start" }}>
      <ListItemText
        primary={<><Typography component="span" variant="caption" fontFamily="monospace" display="block">{d.identifier}</Typography>{d.title}</>}
        primaryTypographyProps={{ variant: "body2", component: "div" }}
        secondary={<>
          {`Rev. ${d.match_revision ?? d.current_revision ?? "–"}${d.current_state ? ` · ${STATE[d.current_state] ?? d.current_state}` : ""}`}
          {d.match_snippet && <Snippet text={d.match_snippet} />}
        </>}
        secondaryTypographyProps={{ variant: "caption", component: "div" }} />
    </ListItemButton>
  );
  return (
    <Box mt={1} component="section" aria-label="Tavole e documenti collegati">
      {storey && (
        <Typography variant="caption" color="text.secondary" display="block" px={0.5}>
          Piano: {storey.name || "senza nome"} · livello {storey.level}
        </Typography>
      )}
      {isLoading && <LinearProgress sx={{ my: 1 }} />}
      {isError && <Typography variant="caption" color="error" px={0.5}>Documenti collegati non disponibili.</Typography>}
      {data && (
        <>
          <Typography variant="body2" fontWeight={600} px={0.5} mt={0.5}>Citato in</Typography>
          {data.cited.length ? <List dense disablePadding>{data.cited.map((d) => item(d, name || guid))}</List>
            : <Typography variant="caption" color="text.secondary" px={0.5} display="block">Nessuna tavola o documento cita questo elemento.</Typography>}
          {storey && (
            <>
              <Typography variant="body2" fontWeight={600} px={0.5} mt={1}>Tavole del piano (livello {storey.level})</Typography>
              {data.same_level.length ? <List dense disablePadding>{data.same_level.map((d) => item(d, ""))}</List>
                : <Typography variant="caption" color="text.secondary" px={0.5} display="block">Nessuna tavola con livello {storey.level}.</Typography>}
            </>
          )}
        </>
      )}
    </Box>
  );
}

/** Estratto con le parole trovate: i marcatori ⟦ ⟧ vengono da ts_headline, il resto è testo (niente HTML). */
function Snippet({ text }: { text: string }) {
  return (
    <Typography component="span" variant="caption" display="block" sx={{ mt: 0.25 }}>
      {text.split(/(⟦[^⟧]*⟧)/).map((p, i) => p.startsWith("⟦") ? <mark key={i}>{p.slice(1, -1)}</mark> : <span key={i}>{p}</span>)}
    </Typography>
  );
}

/**
 * Codice livello ISO 19650 del piano: dal nome ("Piano terra" → 00, "Piano 2" → 02, "Interrato" → B1,
 * "Copertura" → RF) o, se il nome non lo dice, dalla posizione per quota rispetto al piano più vicino a quota 0.
 */
export function levelCode(name: string, rank: number, groundRank: number): string {
  const n = name.toLowerCase();
  if (/terra|ground/.test(n)) return "00";
  if (/copertura|tetto|roof/.test(n)) return "RF";
  const num = n.match(/-?\d+/);
  if (/interrat|basement/.test(n)) return `B${Math.abs(num ? parseInt(num[0], 10) : 1) || 1}`;
  if (num) { const k = parseInt(num[0], 10); return k < 0 ? `B${-k}` : String(k).padStart(2, "0"); }
  const rel = rank - groundRank;
  return rel >= 0 ? String(rel).padStart(2, "0") : `B${-rel}`;
}

/** Per ogni elemento contenuto in un piano (anche dentro gli spazi), il piano con il suo codice livello. */
function storeyIndex(root: SpatialNode, engine: Engine): Map<number, Storey> {
  const found: { node: SpatialNode; name: string; elevation: number }[] = [];
  const walk = (n: SpatialNode) => {
    if (n.type.toUpperCase() === "IFCBUILDINGSTOREY") found.push({ node: n, name: engine.nameOf(n.expressID), elevation: engine.elevationOf(n.expressID) });
    else n.children.forEach(walk);
  };
  walk(root);
  const sorted = [...found].sort((a, b) => a.elevation - b.elevation);
  const ground = sorted.reduce((best, s, i) => (Math.abs(s.elevation) < Math.abs(sorted[best].elevation) ? i : best), 0);
  const out = new Map<number, Storey>();
  sorted.forEach((s, rank) => {
    const storey = { id: s.node.expressID, name: s.name, elevation: s.elevation, level: levelCode(s.name, rank, ground) };
    const mark = (n: SpatialNode) => { out.set(n.expressID, storey); n.children.forEach(mark); };
    mark(s.node);
  });
  return out;
}

function Pset({ name, props }: { name: string; props: [string, string][] }) {
  const [open, setOpen] = useState(true);
  return (
    <Box mt={1}>
      <ListItemButton dense onClick={() => setOpen(!open)} sx={{ px: 0.5 }}>
        <ListItemText primary={name} primaryTypographyProps={{ variant: "body2", fontWeight: 600 }} />
        {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </ListItemButton>
      <Collapse in={open}>
        <Box component="table" sx={{ width: "100%", fontSize: 12, borderCollapse: "collapse", "& td": { py: 0.25, verticalAlign: "top" } }}>
          <tbody>
            {props.map(([k, v]) => <tr key={k}><td style={{ color: "#666", paddingRight: 8 }}>{k}</td><td>{v}</td></tr>)}
          </tbody>
        </Box>
      </Collapse>
    </Box>
  );
}

// web-ifc restituisce i tipi con maiuscole miste (IFCPROJECT, IfcSite): si confrontano in maiuscolo
const SPATIAL: Record<string, string> = {
  IFCPROJECT: "Progetto", IFCSITE: "Sito", IFCBUILDING: "Edificio", IFCBUILDINGSTOREY: "Piano", IFCSPACE: "Spazio",
};

function TreeNode({ node, engine, depth, selectedId, onSelect }: {
  node: SpatialNode; engine: Engine | null; depth: number; selectedId: number | null; onSelect: (id: number) => void;
}) {
  const [open, setOpen] = useState(depth < 3);
  const name = useMemo(() => engine?.nameOf(node.expressID) ?? "", [engine, node.expressID]);
  const kind = SPATIAL[node.type.toUpperCase()];
  const spatial = kind !== undefined;
  const label = `${kind ?? node.type.replace(/^ifc/i, "")}${name ? ` · ${name}` : ""}`;
  return (
    <List dense disablePadding>
      <ListItemButton selected={selectedId === node.expressID} sx={{ pl: 1 + depth * 1.5, py: 0.25 }}
                      onClick={() => (spatial ? setOpen(!open) : onSelect(node.expressID))}>
        <ListItemText primary={label} primaryTypographyProps={{ variant: "body2", noWrap: true, fontWeight: spatial ? 600 : 400 }}
                      secondary={spatial && node.children.length ? `${node.children.length} elementi` : undefined}
                      secondaryTypographyProps={{ variant: "caption" }} />
        {spatial && node.children.length > 0 && (open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />)}
      </ListItemButton>
      {spatial && (
        <Collapse in={open} unmountOnExit>
          {node.children.slice(0, 500).map((c) => (
            <TreeNode key={c.expressID} node={c} engine={engine} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
          ))}
        </Collapse>
      )}
    </List>
  );
}

// ---------------------------------------------------------------------
// Motore: scena three.js + modello web-ifc
// ---------------------------------------------------------------------
class Engine {
  private ifc = new IfcAPI();
  private model = -1;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
  private controls: OrbitControls;
  private root = new THREE.Group();
  private meshes = new Map<number, THREE.Mesh[]>();
  private guids = new Map<string, number>();
  private base = new Map<THREE.Mesh, THREE.Material>();
  private highlighted: number | null = null;
  private tints = new Map<string, string>();
  // piani di taglio: un piano "spento" ha la costante enorme e non taglia niente
  private clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), OFF);
  private clipV = new THREE.Plane(new THREE.Vector3(-1, 0, 0), OFF);
  private planes = [this.clip, this.clipV];
  private guide = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x1976d2, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  private frame = 0;
  private resize: ResizeObserver;

  constructor(private host: HTMLElement, onPick: (id: number | null) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor("#e9edf1");
    this.renderer.localClippingEnabled = true;
    this.guide.visible = false;
    host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(50, 100, 30);
    this.scene.add(sun, this.root, this.guide);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.resize = new ResizeObserver(() => this.fit());
    this.resize.observe(host);
    this.fit();

    let down: { x: number; y: number } | null = null;
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; });
    el.addEventListener("pointerup", (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;   // trascinamento = orbita
      onPick(this.pick(e));
    });
    const loop = () => { this.frame = requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }

  async load(data: Uint8Array, onProgress: (p: number) => void) {
    await this.ifc.Init((path) => (path.endsWith(".wasm") ? wasmUrl : path));
    this.model = this.ifc.OpenModel(data, { COORDINATE_TO_ORIGIN: true });
    const materials = new Map<string, THREE.MeshLambertMaterial>();
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x4a4a4a, transparent: true, opacity: 0.45, clippingPlanes: this.planes });
    let last = 0;
    this.ifc.StreamAllMeshes(this.model, (mesh, index, total) => {
      const placed = mesh.geometries;
      for (let i = 0; i < placed.size(); i++) {
        const pg = placed.get(i);
        const g = this.ifc.GetGeometry(this.model, pg.geometryExpressID);
        const verts = this.ifc.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize());
        const index3 = this.ifc.GetIndexArray(g.GetIndexData(), g.GetIndexDataSize());
        const geom = new THREE.BufferGeometry();
        const inter = new THREE.InterleavedBuffer(new Float32Array(verts), 6);
        geom.setAttribute("position", new THREE.InterleavedBufferAttribute(inter, 3, 0));
        geom.setAttribute("normal", new THREE.InterleavedBufferAttribute(inter, 3, 3));
        geom.setIndex(new THREE.BufferAttribute(new Uint32Array(index3), 1));
        g.delete();
        // senza stili nel file (grigio uniforme) si colora per tipo di elemento, per distinguerli a colpo d'occhio
        const unstyled = pg.color.x === pg.color.y && pg.color.y === pg.color.z && pg.color.w === 1;
        const byType = unstyled ? TYPE_COLOR[this.typeOf(mesh.expressID)] : undefined;
        const key = byType ?? `${pg.color.x},${pg.color.y},${pg.color.z},${pg.color.w}`;
        let mat = materials.get(key);
        if (!mat) {
          mat = new THREE.MeshLambertMaterial({
            color: byType ? new THREE.Color(byType) : new THREE.Color(pg.color.x, pg.color.y, pg.color.z), side: THREE.DoubleSide,
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
            transparent: pg.color.w < 1, opacity: pg.color.w, clippingPlanes: this.planes,
          });
          materials.set(key, mat);
        }
        const m = new THREE.Mesh(geom, mat);
        m.matrixAutoUpdate = false;
        m.matrix.fromArray(pg.flatTransformation);
        m.userData.id = mesh.expressID;
        this.base.set(m, mat);
        this.root.add(m);
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geom, 30), edgeMat);   // spigoli
        edges.matrixAutoUpdate = false;
        edges.matrix.copy(m.matrix);
        edges.raycast = () => undefined;
        this.root.add(edges);
        const list = this.meshes.get(mesh.expressID) ?? [];
        list.push(m);
        this.meshes.set(mesh.expressID, list);
      }
      if (index - last > 50 || index === total - 1) { last = index; onProgress((index + 1) / total); }
    });
    for (const id of this.meshes.keys()) {
      const guid = this.ifc.GetGuidFromExpressId(this.model, id);
      if (typeof guid === "string") this.guids.set(guid, id);
    }
    this.root.updateMatrixWorld(true);
    this.frameAll();
  }

  private fit() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private frameBox(box: THREE.Box3) {
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()).length() || 1;
    const center = box.getCenter(new THREE.Vector3());
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(size * 1.5));
    this.camera.near = size / 1000;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
  }

  frameAll() { this.frameBox(new THREE.Box3().setFromObject(this.root)); }

  focus(id: number) {
    const box = new THREE.Box3();
    for (const m of this.meshes.get(id) ?? []) box.expandByObject(m);
    this.frameBox(box);
  }

  private box = new THREE.Box3();

  ranges(): Range {
    this.box = new THREE.Box3().setFromObject(this.root);
    const r = (a: number, b: number): [number, number] => [Number(a.toFixed(2)), Number(b.toFixed(2))];
    const { min, max } = this.box;
    return { x: r(min.x, max.x), y: r(min.y, max.y), z: r(min.z, max.z) };
  }

  /** Taglio orizzontale: resta ciò che sta sotto la quota y. */
  section(y: number | null) { this.clip.constant = y ?? OFF; }

  /** Taglio verticale perpendicolare a X o Z: resta il lato "prima" del piano, o l'altro con flip. */
  sectionV(axis: Axis | null, value: number, flip: boolean) {
    if (!axis) { this.clipV.constant = OFF; return; }
    const sign = flip ? 1 : -1;
    this.clipV.normal.set(axis === "x" ? sign : 0, 0, axis === "z" ? sign : 0);
    this.clipV.constant = flip ? -value : value;
  }

  /** Piano semitrasparente sulla sezione che si sta regolando, grande quanto il modello. */
  showGuide(which: "h" | "v" | null) {
    const g = this.guide;
    const plane = which === "h" ? this.clip : which === "v" ? this.clipV : null;
    if (!plane || plane.constant >= OFF || this.box.isEmpty()) { g.visible = false; return; }
    const size = this.box.getSize(new THREE.Vector3()).multiplyScalar(1.1);
    const center = this.box.getCenter(new THREE.Vector3());
    const at = -plane.constant / (plane.normal.x + plane.normal.y + plane.normal.z);   // un solo asse non nullo
    g.rotation.set(0, 0, 0);
    if (which === "h") { g.rotation.x = -Math.PI / 2; g.scale.set(size.x, size.z, 1); g.position.set(center.x, plane.constant, center.z); }
    else if (plane.normal.x) { g.rotation.y = Math.PI / 2; g.scale.set(size.z, size.y, 1); g.position.set(at, center.y, center.z); }
    else { g.scale.set(size.x, size.y, 1); g.position.set(center.x, center.y, at); }
    g.visible = true;
  }

  private pick(e: PointerEvent): number | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hits = ray.intersectObjects(this.root.children, false)
      .filter((h) => this.planes.every((p) => p.distanceToPoint(h.point) >= -1e-6));   // niente parti tagliate
    return hits.length ? (hits[0].object.userData.id as number) : null;
  }

  private paint() {
    const byId = new Map<number, string>();
    for (const [guid, color] of this.tints) { const id = this.guids.get(guid); if (id !== undefined) byId.set(id, color); }
    for (const [id, list] of this.meshes) {
      const color = id === this.highlighted ? `#${SELECT_COLOR.getHexString()}` : byId.get(id);
      for (const m of list) m.material = color ? this.solid(color) : this.base.get(m)!;
    }
  }

  private solids = new Map<string, THREE.MeshLambertMaterial>();
  private solid(color: string) {
    let mat = this.solids.get(color);
    if (!mat) {
      mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide, clippingPlanes: this.planes });
      this.solids.set(color, mat);
    }
    return mat;
  }

  highlight(id: number | null) { this.highlighted = id; this.paint(); }
  tint(colors: Map<string, string>) { this.tints = colors; this.paint(); }
  idOf(guid: string) { return this.guids.get(guid); }

  private typeOf(id: number): string {
    try { return (this.ifc.GetNameFromTypeCode(this.ifc.GetLineType(this.model, id)) ?? "").toUpperCase(); } catch { return ""; }
  }

  elevationOf(id: number): number {
    try { return Number(str(this.ifc.GetLine(this.model, id)?.Elevation)) || 0; } catch { return 0; }
  }

  /** Ingombro nel sistema locale del primo pezzo dell'elemento e volume dalla mesh chiusa (metri). */
  measures(id: number): Measures | null {
    const list = this.meshes.get(id);
    if (!list?.length) return null;
    const inv = list[0].matrix.clone().invert();
    const local = new THREE.Box3();
    const v = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let volume = 0;
    for (const m of list) {
      const pos = m.geometry.getAttribute("position");
      const toLocal = inv.clone().multiply(m.matrix);
      for (let i = 0; i < pos.count; i++) local.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(toLocal));
      const index = m.geometry.getIndex();
      if (!index) continue;
      let part = 0;
      for (let t = 0; t + 2 < index.count; t += 3) {
        a.fromBufferAttribute(pos, index.getX(t)); b.fromBufferAttribute(pos, index.getX(t + 1)); c.fromBufferAttribute(pos, index.getX(t + 2));
        part += a.dot(b.cross(c)) / 6;          // tetraedro con l'origine: la somma è il volume del solido chiuso
      }
      volume += part * m.matrix.determinant();
    }
    const size = local.getSize(new THREE.Vector3()).toArray();
    // l'asse locale che nella scena punta più in verticale (Y) è l'altezza; degli altri due il maggiore è la lunghezza
    const up = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]
      .map((ax) => Math.abs(ax.transformDirection(list[0].matrix).y));
    const vertical = up.indexOf(Math.max(...up));
    const [length, width] = size.filter((_, i) => i !== vertical).sort((x, y) => y - x);
    return { length, width, height: size[vertical], volume: Math.abs(volume) };
  }

  nameOf(id: number): string {
    try { return str(this.ifc.GetLine(this.model, id)?.Name); } catch { return ""; }
  }

  async properties(id: number): Promise<Props | null> {
    try {
      const item = await this.ifc.properties.getItemProperties(this.model, id);
      const psets = await this.ifc.properties.getPropertySets(this.model, id, true);
      return {
        name: str(item?.Name), guid: str(item?.GlobalId), type: this.ifc.GetNameFromTypeCode(item?.type) ?? "",
        psets: (psets ?? []).map((p) => ({
          name: str(p.Name) || "Proprietà",
          props: ((p.HasProperties ?? p.Quantities ?? []) as Record<string, unknown>[]).map((x) => [
            str(x.Name), str(x.NominalValue ?? x.LengthValue ?? x.AreaValue ?? x.VolumeValue ?? x.CountValue ?? x.WeightValue),
          ] as [string, string]),
        })).filter((p) => p.props.length),
      };
    } catch { return null; }
  }

  async spatial(): Promise<SpatialNode | null> {
    try { return await this.ifc.properties.getSpatialStructure(this.model) as SpatialNode; } catch { return null; }
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resize.disconnect();
    this.controls.dispose();
    this.root.traverse((o) => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose(); });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    try { if (this.model >= 0) this.ifc.CloseModel(this.model); } catch { /* già chiuso */ }
  }
}
