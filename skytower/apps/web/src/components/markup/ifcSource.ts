// "><(((º> sabusabu <º)))><"
// Modello IFC letto con web-ifc (WASM): geometria per elemento, proprietà e Pset, struttura spaziale.
// Senza stili nel file gli elementi si colorano per tipo, per distinguerli a colpo d'occhio.
import * as THREE from "three";
import { IfcAPI } from "web-ifc";
import wasmUrl from "../../../node_modules/web-ifc/web-ifc.wasm?url";   // fuori dall'export map del pacchetto
import { str, type AddMesh, type ElementProps, type ModelSource, type SpatialNode } from "./model3d";

const TYPE_COLOR: Record<string, string> = {
  IFCWALL: "#e6dccb", IFCWALLSTANDARDCASE: "#e6dccb", IFCSLAB: "#aeb7c0", IFCROOF: "#b5654f", IFCBEAM: "#c2a27c",
  IFCCOLUMN: "#c2a27c", IFCMEMBER: "#c2a27c", IFCWINDOW: "#9fd0ee", IFCDOOR: "#a77b52", IFCSTAIR: "#cfc6b8",
  IFCRAILING: "#7d8790", IFCCOVERING: "#ddd5c8", IFCFURNISHINGELEMENT: "#d8b98c",
};

export class IfcSource implements ModelSource {
  private ifc = new IfcAPI();
  private model = -1;
  private guids = new Map<number, string>();

  async load(data: Uint8Array, onProgress: (p: number) => void, add: AddMesh) {
    await this.ifc.Init((path) => (path.endsWith(".wasm") ? wasmUrl : path));
    this.model = this.ifc.OpenModel(data, { COORDINATE_TO_ORIGIN: true });
    const materials = new Map<string, THREE.MeshLambertMaterial>();
    const ids = new Set<number>();
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
        // senza stili nel file (grigio uniforme) si colora per tipo di elemento
        const unstyled = pg.color.x === pg.color.y && pg.color.y === pg.color.z && pg.color.w === 1;
        const byType = unstyled ? TYPE_COLOR[this.typeOf(mesh.expressID)] : undefined;
        const key = byType ?? `${pg.color.x},${pg.color.y},${pg.color.z},${pg.color.w}`;
        let mat = materials.get(key);
        if (!mat) {
          mat = new THREE.MeshLambertMaterial({
            color: byType ? new THREE.Color(byType) : new THREE.Color(pg.color.x, pg.color.y, pg.color.z), side: THREE.DoubleSide,
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
            transparent: pg.color.w < 1, opacity: pg.color.w,
          });
          materials.set(key, mat);
        }
        add(mesh.expressID, geom, mat, new THREE.Matrix4().fromArray(pg.flatTransformation));
        ids.add(mesh.expressID);
      }
      if (index - last > 50 || index === total - 1) { last = index; onProgress((index + 1) / total); }
    });
    for (const id of ids) {
      const guid = this.ifc.GetGuidFromExpressId(this.model, id);
      if (typeof guid === "string") this.guids.set(id, guid);
    }
  }

  refOf(id: number) { return this.guids.get(id); }

  private typeOf(id: number): string {
    try { return (this.ifc.GetNameFromTypeCode(this.ifc.GetLineType(this.model, id)) ?? "").toUpperCase(); } catch { return ""; }
  }

  elevationOf(id: number): number {
    try { return Number(str(this.ifc.GetLine(this.model, id)?.Elevation)) || 0; } catch { return 0; }
  }

  nameOf(id: number): string {
    try { return str(this.ifc.GetLine(this.model, id)?.Name); } catch { return ""; }
  }

  async properties(id: number): Promise<ElementProps | null> {
    try {
      const item = await this.ifc.properties.getItemProperties(this.model, id);
      const psets = await this.ifc.properties.getPropertySets(this.model, id, true);
      const guid = str(item?.GlobalId);
      return {
        name: str(item?.Name), guid, ref: guid, type: this.ifc.GetNameFromTypeCode(item?.type) ?? "",
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
    try { if (this.model >= 0) this.ifc.CloseModel(this.model); } catch { /* già chiuso */ }
  }
}
