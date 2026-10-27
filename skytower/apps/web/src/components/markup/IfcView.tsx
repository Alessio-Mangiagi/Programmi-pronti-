// "><(((º> sabusabu <º)))><"
// Modello IFC nel browser: geometria letta con web-ifc (WASM) e resa con three.js. Orbita, selezione di un
// elemento con proprietà e Pset, albero spaziale per piani, sezione orizzontale. Gli elementi annotati sono
// colorati con il colore dell'annotazione; in modalità "Annota" un clic su un elemento lo propone per un commento.
// Caricato a richiesta: three.js e web-ifc non pesano sul bundle iniziale.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert, Box, CircularProgress, Collapse, Divider, IconButton, LinearProgress, List, ListItemButton, ListItemText,
  Paper, Slider, Stack, Tooltip, Typography,
} from "@mui/material";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { IfcAPI } from "web-ifc";
import wasmUrl from "../../../node_modules/web-ifc/web-ifc.wasm?url";   // fuori dall'export map del pacchetto
import type { Markup } from "../../api";

export interface PickedElement { guid: string; label: string }

interface SpatialNode { expressID: number; type: string; children: SpatialNode[] }
interface Props { name: string; guid: string; type: string; psets: { name: string; props: [string, string][] }[] }

const SELECT_COLOR = new THREE.Color("#1976d2");
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
  markups: Markup[];
  selectedRef: string | null;
  drawing: boolean;
  onPick: (e: PickedElement) => void;
  onSelectMarkup: (id: string) => void;
}

export default function IfcView({ url, markups, selectedRef, drawing, onPick, onSelectMarkup }: IfcViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<Engine | null>(null);
  const [progress, setProgress] = useState<number | null>(0);
  const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<SpatialNode | null>(null);
  const [selected, setSelected] = useState<{ id: number; props: Props | null } | null>(null);
  const [cut, setCut] = useState<number | null>(null);
  const [bounds, setBounds] = useState<[number, number] | null>(null);
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
        setBounds(e.heightRange());
        setTree(await e.spatial());
        setProgress(null);
      } catch (err) {
        console.error("viewer IFC:", err);
        // web-ifc genera codice a runtime: con una CSP senza 'unsafe-eval' non parte (docs/adr.md ADR-22)
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
            <Box px={2} pt={1.5}>
              <Typography variant="caption" color="text.secondary">Sezione orizzontale</Typography>
              <Slider size="small" min={bounds[0]} max={bounds[1]} step={(bounds[1] - bounds[0]) / 200 || 0.01}
                      value={cut ?? bounds[1]} onChange={(_, v) => setCut(v as number >= bounds[1] ? null : v as number)}
                      valueLabelDisplay="auto" valueLabelFormat={(v) => `${v.toFixed(2)} m`} />
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
              {selected.props.psets.map((p) => <Pset key={p.name} name={p.name} props={p.props} />)}
            </>
          )}
        </Paper>
      )}
    </Box>
  );
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
  private clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private frame = 0;
  private resize: ResizeObserver;

  constructor(private host: HTMLElement, onPick: (id: number | null) => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor("#e9edf1");
    this.renderer.localClippingEnabled = false;
    host.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(50, 100, 30);
    this.scene.add(sun, this.root);
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
    const edgeMat = new THREE.LineBasicMaterial({ color: 0x4a4a4a, transparent: true, opacity: 0.45, clippingPlanes: [this.clip] });
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
            transparent: pg.color.w < 1, opacity: pg.color.w, clippingPlanes: [this.clip],
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

  heightRange(): [number, number] {
    const box = new THREE.Box3().setFromObject(this.root);
    return [Number(box.min.y.toFixed(2)), Number(box.max.y.toFixed(2))];
  }

  section(y: number | null) {
    this.renderer.localClippingEnabled = y !== null;
    this.clip.constant = y ?? 0;
  }

  private pick(e: PointerEvent): number | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hits = ray.intersectObjects(this.root.children, false)
      .filter((h) => !this.renderer.localClippingEnabled || h.point.y <= this.clip.constant + 1e-6);
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
      mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), side: THREE.DoubleSide, clippingPlanes: [this.clip] });
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
