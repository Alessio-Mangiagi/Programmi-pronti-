// "><(((º> sabusabu <º)))><"
// Modello glTF 2.0 (.glb, o .gltf autonomo) letto con il GLTFLoader di three.js: è il formato che Blender esporta
// senza componenti aggiuntivi. Ogni nodo con una mesh è un elemento selezionabile (le proprietà personalizzate di
// Blender arrivano in `extras`); i nodi vuoti sono gruppi e, se il nome è quello di un piano ("Piano terra",
// "Livello 2", "Copertura"), fanno da piano con quota e codice livello come i piani IFC.
// Sotto la CSP di produzione: le texture si caricano come <img> (img-src blob:/data:), non con fetch, e un .gltf
// con i buffer in data: URI si ricompone in .glb prima della lettura (connect-src non ammette data:).
// Il derivato di un IFC pesante prodotto dal worker (ifc2glb.py) porta in `extras` GlobalId, tipo IFC, quota dei
// piani e Pset: albero, annotazioni e tavole collegate si comportano come sull'IFC originale. La geometria di un
// elemento sta in un nodo figlio "part" (matrice di posizionamento): appartiene all'elemento, non è un nodo a sé.
import * as THREE from "three";
import { GLTFLoader, type GLTF, type GLTFLoaderPlugin, type GLTFParser } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { AddMesh, ElementProps, ModelSource, SpatialNode } from "./model3d";

interface NodeDef { name?: string; mesh?: number; children?: number[]; extras?: Record<string, unknown> }

const isPart = (n: NodeDef | undefined) => n?.extras?.part === true;

/** Dati IFC di un nodo del derivato (vuoto per i glTF qualsiasi). */
function ifcOf(n: NodeDef | undefined): { guid: string; type: string } | null {
  const e = n?.extras;
  return e && typeof e.type === "string" && /^Ifc/.test(e.type) ? { guid: typeof e.GlobalId === "string" ? e.GlobalId : "", type: e.type } : null;
}
interface GltfJson {
  scene?: number;
  scenes?: { name?: string; nodes?: number[] }[];
  nodes?: NodeDef[];
  meshes?: { name?: string; primitives: { material?: number }[] }[];
  materials?: { name?: string }[];
  buffers?: { uri?: string; byteLength: number }[];
  bufferViews?: { buffer: number; byteOffset?: number }[];
  images?: { uri?: string }[];
  extensionsRequired?: string[];
}

const LEVEL = /\b(piano|livello|level|floor|storey|interrat|copertura|tetto|roof)/i;
const UNSUPPORTED: Record<string, string> = {
  KHR_draco_mesh_compression: "la compressione Draco",
  EXT_meshopt_compression: "la compressione meshopt",
  KHR_texture_basisu: "le texture KTX2",
};

export class GltfSource implements ModelSource {
  private json: GltfJson = {};
  private refs = new Map<number, string>();
  private boxes = new Map<number, THREE.Box3>();
  private triangles = new Map<number, number>();
  private scene: THREE.Object3D | null = null;

  constructor(private textual: boolean) {}

  async load(data: Uint8Array, onProgress: (p: number) => void, add: AddMesh) {
    const glb = this.textual ? textToGlb(data) : data;
    checkExtensions(glbJson(glb));
    const loader = new GLTFLoader();
    loader.register((parser: GLTFParser) => {
      (parser as unknown as { textureLoader: THREE.Loader }).textureLoader = new THREE.TextureLoader(parser.options.manager);
      return { name: "cde_texture_img" } as GLTFLoaderPlugin;   // nessuna estensione: serve solo a cambiare il loader
    });
    const buffer = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
    const gltf: GLTF = await loader.parseAsync(buffer, "");
    this.json = gltf.parser.json as GltfJson;
    this.scene = gltf.scene;
    gltf.scene.updateMatrixWorld(true);
    const assoc = gltf.parser.associations;
    const nodesOf = (o: THREE.Object3D) => {      // il nodo dell'oggetto e i suoi antenati, dal più vicino
      const out: number[] = [];
      for (let x: THREE.Object3D | null = o; x; x = x.parent) {
        const n = assoc.get(x)?.nodes;
        if (n !== undefined && !isPart(this.json.nodes?.[n])) out.push(n);
      }
      return out;
    };
    const meshes: THREE.Mesh[] = [];
    gltf.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    meshes.forEach((m, i) => {
      const chain = nodesOf(m);
      if (!chain.length) return;
      const id = chain[0];
      const material = Array.isArray(m.material) ? m.material[0] : m.material;
      const matrices = m instanceof THREE.InstancedMesh
        ? Array.from({ length: m.count }, (_, k) => { const t = new THREE.Matrix4(); m.getMatrixAt(k, t); return m.matrixWorld.clone().multiply(t); })
        : [m.matrixWorld.clone()];
      m.geometry.computeBoundingBox();
      for (const matrix of matrices) {
        add(id, m.geometry, material, matrix);
        const box = m.geometry.boundingBox!.clone().applyMatrix4(matrix);
        for (const n of chain) this.boxes.set(n, (this.boxes.get(n) ?? new THREE.Box3()).union(box));
      }
      const tris = (m.geometry.index?.count ?? m.geometry.getAttribute("position").count) / 3;
      this.triangles.set(id, (this.triangles.get(id) ?? 0) + tris * matrices.length);
      if (i % 50 === 0 || i === meshes.length - 1) onProgress((i + 1) / meshes.length);
    });
    // chiave per le annotazioni: il nome dell'oggetto (in Blender è unico); se manca o si ripete, anche l'indice
    const nodes = this.json.nodes ?? [];
    const seen = new Map<string, number>();
    for (const n of nodes) if (n.name) seen.set(n.name, (seen.get(n.name) ?? 0) + 1);
    for (const id of this.triangles.keys()) {
      const name = nodes[id]?.name ?? "";
      const guid = ifcOf(nodes[id])?.guid;
      if (guid) { this.refs.set(id, guid); continue; }                 // derivato IFC: le annotazioni restano sul GUID
      this.refs.set(id, name && seen.get(name) === 1 ? name.slice(0, 120) : `${name.slice(0, 100) || "nodo"}#${id}`);
    }
  }

  refOf(id: number) { return this.refs.get(id); }

  nameOf(id: number): string {
    if (id < 0) return this.json.scenes?.[this.json.scene ?? 0]?.name ?? "";
    return this.json.nodes?.[id]?.name ?? "";
  }

  elevationOf(id: number): number {
    const elevation = this.json.nodes?.[id]?.extras?.Elevation;
    if (typeof elevation === "number") return elevation;
    const box = this.boxes.get(id);
    return box && !box.isEmpty() ? box.min.y : 0;
  }

  async properties(id: number): Promise<ElementProps | null> {
    const node = this.json.nodes?.[id];
    if (!node) return null;
    const owner = node.mesh !== undefined ? node
      : (node.children ?? []).map((c) => this.json.nodes?.[c]).find((c) => isPart(c) && c?.mesh !== undefined);
    const mesh = owner?.mesh !== undefined ? this.json.meshes?.[owner.mesh] : undefined;
    const materials = [...new Set((mesh?.primitives ?? []).map((p) => (p.material !== undefined ? this.json.materials?.[p.material]?.name : undefined))
      .filter((n): n is string => !!n))];
    const ifc = ifcOf(node);
    const text = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
    const extras = Object.entries(node.extras ?? {}).filter(([k]) => !ifc || !["GlobalId", "type", "Psets"].includes(k))
      .map(([k, v]) => [k, text(v)] as [string, string]);
    const psets = ifc ? Object.entries((node.extras?.Psets ?? {}) as Record<string, Record<string, unknown>>)
      .map(([name, props]) => ({ name, props: Object.entries(props).map(([k, v]) => [k, text(v)] as [string, string]) })) : [];
    const geometry: [string, string][] = [];
    if (mesh?.name) geometry.push(["Mesh", mesh.name]);
    if (materials.length) geometry.push([materials.length > 1 ? "Materiali" : "Materiale", materials.join(", ")]);
    geometry.push(["Triangoli", Math.round(this.triangles.get(id) ?? 0).toLocaleString("it-IT")]);
    return {
      name: node.name ?? "", guid: ifc?.guid ?? "", ref: this.refs.get(id) ?? `nodo#${id}`, type: ifc?.type ?? "Oggetto glTF",
      psets: [...psets, { name: ifc ? "Altro" : "Proprietà personalizzate", props: extras }, { name: "Geometria", props: geometry }]
        .filter((p) => p.props.length),
    };
  }

  async spatial(): Promise<SpatialNode | null> {
    const nodes = this.json.nodes ?? [];
    const build = (i: number, depth: number): SpatialNode | null => {
      const n = nodes[i];
      if (!n || depth > 64 || isPart(n)) return null;
      const children = (n.children ?? []).map((c) => build(c, depth + 1)).filter((c): c is SpatialNode => !!c);
      const ownsGeometry = n.mesh !== undefined || (n.children ?? []).some((c) => isPart(nodes[c]));
      if (!ownsGeometry && !children.length && !ifcOf(n)) return null;     // camere, luci, vuoti senza geometria
      const type = ifcOf(n)?.type ?? (ownsGeometry ? "MESH" : LEVEL.test(n.name ?? "") ? "LEVEL" : "GROUP");
      return { expressID: i, type, children };
    };
    const roots = this.json.scenes?.[this.json.scene ?? 0]?.nodes ?? [];
    const top = roots.map((i) => build(i, 0)).filter((c): c is SpatialNode => !!c);
    if (top.length === 1 && top[0].type.toUpperCase() === "IFCPROJECT") return top[0];   // come l'albero di web-ifc
    return { expressID: -1, type: "SCENE", children: roots.map((i) => build(i, 0)).filter((c): c is SpatialNode => !!c) };
  }

  dispose() {
    this.scene?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const v of Object.values(mat)) if (v instanceof THREE.Texture) v.dispose();
        mat.dispose();
      }
    });
  }
}

function checkExtensions(json: GltfJson) {
  const missing = (json.extensionsRequired ?? []).filter((e) => UNSUPPORTED[e]).map((e) => UNSUPPORTED[e]);
  if (missing.length) {
    throw new Error(`il modello usa ${missing.join(" e ")}, non supportata nel browser: riesporta da Blender senza compressione`);
  }
}

/** JSON di un .glb: intestazione di 12 byte, poi il blocco JSON (lunghezza, tipo, contenuto). */
export function glbJson(glb: Uint8Array): GltfJson {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  if (glb.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error("non è un file glTF binario (.glb)");
  if (view.getUint32(16, true) !== 0x4e4f534a) throw new Error("file .glb senza blocco JSON");
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + view.getUint32(12, true))));
}

/** Un .gltf autonomo (buffer in data: URI) ricomposto in .glb con un solo blocco binario. */
export function textToGlb(data: Uint8Array): Uint8Array {
  const json = JSON.parse(new TextDecoder().decode(data)) as GltfJson;
  const external = [...(json.buffers ?? []), ...(json.images ?? [])]
    .map((x) => x.uri).filter((u): u is string => !!u && !u.startsWith("data:"));
  if (external.length) {
    throw new Error(`il file .gltf rimanda a file esterni (${external.slice(0, 3).join(", ")}): esporta da Blender come «glTF Binary (.glb)»`);
  }
  const parts = (json.buffers ?? []).map((b) => (b.uri ? decodeDataUri(b.uri) : new Uint8Array(b.byteLength)));
  const offsets: number[] = [];
  let total = 0;
  for (const p of parts) { offsets.push(total); total += Math.ceil(p.byteLength / 4) * 4; }
  const bin = new Uint8Array(total);
  parts.forEach((p, i) => bin.set(p, offsets[i]));
  for (const v of json.bufferViews ?? []) { v.byteOffset = (v.byteOffset ?? 0) + offsets[v.buffer]; v.buffer = 0; }
  json.buffers = total ? [{ byteLength: total }] : [];
  return makeGlb(json, bin);
}

function decodeDataUri(uri: string): Uint8Array {
  const comma = uri.indexOf(",");
  if (!uri.slice(0, comma).endsWith(";base64")) return new TextEncoder().encode(decodeURIComponent(uri.slice(comma + 1)));
  const raw = atob(uri.slice(comma + 1));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function makeGlb(json: GltfJson, bin: Uint8Array): Uint8Array {
  let text = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (text.byteLength % 4)) % 4;
  if (pad) { const t = new Uint8Array(text.byteLength + pad).fill(0x20); t.set(text); text = t; }
  const total = 12 + 8 + text.byteLength + (bin.byteLength ? 8 + bin.byteLength : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, text.byteLength, true); view.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  if (bin.byteLength) {
    const at = 20 + text.byteLength;
    view.setUint32(at, bin.byteLength, true); view.setUint32(at + 4, 0x004e4942, true);
    out.set(bin, at + 8);
  }
  return out;
}
