// "><(((º> sabusabu <º)))><"
// Contratto tra il viewer 3D (scena three.js, sezioni, misure, selezione) e chi legge il file del modello: IFC con
// web-ifc, glTF/GLB con il GLTFLoader di three.js. Il viewer conosce solo id numerici, mesh e queste domande.
import type * as THREE from "three";

export interface SpatialNode { expressID: number; type: string; children: SpatialNode[] }

export interface ElementProps {
  name: string;
  /** GlobalId IFC (vuoto per i modelli glTF): serve a trovare le tavole che lo citano */
  guid: string;
  /** chiave stabile dell'elemento per le annotazioni: il GUID IFC o il nome dell'oggetto glTF */
  ref: string;
  type: string;
  psets: { name: string; props: [string, string][] }[];
}

export type AddMesh = (id: number, geometry: THREE.BufferGeometry, material: THREE.Material, matrix: THREE.Matrix4) => void;

/** Piano di un derivato IFC diviso per piano (ADR-36): un .glb da caricare dopo l'indice. */
export interface ModelPart { name: string; url: string; elements: number; size_bytes: number }

/** Avanzamento del caricamento a piani: un piano è appena entrato nella scena. */
export type OnPart = (done: number, total: number, name: string) => void;

export interface ModelSource {
  /** legge il file e consegna le mesh già posizionate (coordinate della scena: Y in alto, metri); con i piani
   *  `data` è l'indice e `onPart` segnala ogni piano aggiunto, mentre gli altri arrivano */
  load(data: Uint8Array, onProgress: (p: number) => void, add: AddMesh, onPart?: OnPart): Promise<void>;
  refOf(id: number): string | undefined;
  nameOf(id: number): string;
  elevationOf(id: number): number;
  properties(id: number): Promise<ElementProps | null>;
  spatial(): Promise<SpatialNode | null>;
  dispose(): void;
}

/** Tipi dei nodi che raggruppano elementi per piano: IFC e gruppi glTF dal nome di un piano ("Piano terra", ...). */
export const STOREY_TYPES = new Set(["IFCBUILDINGSTOREY", "LEVEL"]);

export const str = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "value" in (v as Record<string, unknown>)) return String((v as { value: unknown }).value);
  return String(v);
};
