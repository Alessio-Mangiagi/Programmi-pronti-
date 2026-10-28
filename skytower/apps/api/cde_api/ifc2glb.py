# "><(((º> sabusabu <º)))><"
"""IFC → glTF binario (.glb): derivato per aprire nel browser i modelli pesanti (G43, ADR-31).

La geometria la triangola IfcOpenShell sul worker (più thread), una volta sola; il browser riceve mesh già pronte
invece di eseguire web-ifc su centinaia di MB. Il .glb conserva quello che serve al viewer:

- albero spaziale (progetto, sito, edificio, piani, spazi) come nodi vuoti con il tipo IFC e la quota del piano;
- un nodo per elemento con il nome, in `extras` GlobalId, tipo IFC e Pset/Qto: annotazioni, "Citato in" e
  tavole del piano funzionano come sull'IFC originale;
- la geometria nel sistema locale dell'elemento, in un nodo figlio (`extras.part`) con la matrice di
  posizionamento: le misure di un elemento ruotato restano quelle vere e le geometrie ripetute (tipi, mapped item)
  si scrivono una volta sola;
- una primitiva per materiale (colore e trasparenza dello stile IFC).

Assi: IFC ha Z in alto, glTF Y in alto: la matrice di ogni elemento comprende la rotazione (x, y, z) → (x, z, -y),
come fa web-ifc. Posizioni riportate vicino all'origine (modelli georeferenziati: i float32 perderebbero
precisione); lo spostamento è nella scena.
Il blocco binario si scrive su un file temporaneo mentre si legge l'IFC: la memoria non cresce col modello.
"""
from __future__ import annotations

import json
import math
import multiprocessing
import struct
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SPATIAL = ("IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcSpace", "IfcFacility", "IfcFacilityPart")
EXCLUDE = ["IfcOpeningElement", "IfcSpace"]          # aperture: solo vuoti; spazi: volumi d'aria che coprono tutto


@dataclass
class Result:
    elements: int
    triangles: int
    size_bytes: int


def _value(v):
    if isinstance(v, bool | int | str) or v is None:
        return v
    if isinstance(v, float):
        return round(v, 6) if math.isfinite(v) else None
    if isinstance(v, list | tuple):
        return [_value(x) for x in v][:50]
    return str(v)


def _psets(element) -> dict:
    import ifcopenshell.util.element as ue

    try:
        raw = ue.get_psets(element)
    except Exception:  # noqa: BLE001 - proprietà malformate non fermano la conversione
        return {}
    return {name: {k: _value(v) for k, v in props.items() if k != "id"} for name, props in raw.items()}


class _Bin:
    """Blocco binario del glTF su file, allineato a 4 byte."""

    def __init__(self, path: Path):
        self.f = path.open("wb")
        self.size = 0
        self.views: list[dict] = []
        self.accessors: list[dict] = []

    def add(self, data: bytes, target: int) -> int:
        pad = -self.size % 4
        if pad:
            self.f.write(b"\0" * pad)
            self.size += pad
        self.views.append({"buffer": 0, "byteOffset": self.size, "byteLength": len(data), "target": target})
        self.f.write(data)
        self.size += len(data)
        return len(self.views) - 1

    def positions(self, xyz: np.ndarray) -> int:
        view = self.add(xyz.astype("<f4").tobytes(), 34962)
        self.accessors.append({"bufferView": view, "componentType": 5126, "count": len(xyz), "type": "VEC3",
                               "min": xyz.min(axis=0).tolist(), "max": xyz.max(axis=0).tolist()})
        return len(self.accessors) - 1

    def indices(self, idx: np.ndarray) -> int:
        small = idx.max(initial=0) < 65535
        view = self.add(idx.astype("<u2" if small else "<u4").tobytes(), 34963)
        self.accessors.append({"bufferView": view, "componentType": 5123 if small else 5125, "count": len(idx),
                               "type": "SCALAR"})
        return len(self.accessors) - 1


def convert(src: Path, dst: Path, *, threads: int | None = None) -> Result:
    import ifcopenshell
    import ifcopenshell.geom
    import ifcopenshell.util.element as ue

    model = ifcopenshell.open(str(src))
    import ifcopenshell.util.shape as us

    settings = ifcopenshell.geom.settings()
    iterator = ifcopenshell.geom.iterator(settings, model, threads or max(1, multiprocessing.cpu_count() - 1),
                                          exclude=EXCLUDE)

    nodes: list[dict] = []
    meshes: list[dict] = []
    materials: list[dict] = []
    material_of: dict[tuple, int] = {}
    node_of: dict[int, int] = {}                 # id IFC → indice del nodo
    mesh_of: dict[str, int] = {}                 # geometria IfcOpenShell → mesh (riusata dalle ripetizioni)
    parts: dict[int, int] = {}                   # nodo dell'elemento → nodo con la sua geometria
    y_up = np.array([[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]], dtype=np.float64)
    offset: np.ndarray | None = None
    triangles = 0

    def node_for(entity) -> int:
        if entity.id() in node_of:
            return node_of[entity.id()]
        extras = {"GlobalId": getattr(entity, "GlobalId", None), "type": entity.is_a()}
        if entity.is_a("IfcBuildingStorey") and entity.Elevation is not None:
            extras["Elevation"] = _value(float(entity.Elevation))
        if not entity.is_a("IfcProject"):
            extras["Psets"] = _psets(entity)
        nodes.append({"name": entity.Name or entity.is_a()[3:], "extras": extras})
        node_of[entity.id()] = len(nodes) - 1
        return node_of[entity.id()]

    def material(m) -> int:
        d = m.diffuse
        alpha = 1.0 - (m.transparency if m.transparency == m.transparency else 0.0)   # NaN = opaco
        key = (round(d.r(), 3), round(d.g(), 3), round(d.b(), 3), round(alpha, 3))
        if key not in material_of:
            mat = {"name": m.name, "doubleSided": True, "pbrMetallicRoughness": {
                "baseColorFactor": list(key), "metallicFactor": 0.0, "roughnessFactor": 0.9}}
            if alpha < 1:
                mat["alphaMode"] = "BLEND"
            materials.append(mat)
            material_of[key] = len(materials) - 1
        return material_of[key]

    with tempfile.TemporaryDirectory() as tmp:
        blob = _Bin(Path(tmp) / "bin")
        if iterator.initialize():
            while True:
                shape = iterator.get()
                g = shape.geometry
                faces = np.asarray(g.faces, dtype=np.int64).reshape(-1, 3)
                if len(faces):
                    if g.id not in mesh_of:
                        verts = np.asarray(g.verts, dtype=np.float64).reshape(-1, 3)
                        position = blob.positions(verts)
                        mat_ids = np.asarray(g.material_ids, dtype=np.int64)
                        primitives = []
                        for mid in np.unique(mat_ids):
                            tri = faces[mat_ids == mid].reshape(-1)
                            prim = {"attributes": {"POSITION": position}, "indices": blob.indices(tri)}
                            if 0 <= mid < len(g.materials):
                                prim["material"] = material(g.materials[int(mid)])
                            primitives.append(prim)
                        meshes.append({"primitives": primitives})
                        mesh_of[g.id] = len(meshes) - 1
                    triangles += len(faces)
                    matrix = np.asarray(us.get_shape_matrix(shape), dtype=np.float64)
                    if offset is None:
                        offset = np.floor(matrix[:3, 3])
                    placed = matrix.copy()
                    placed[:3, 3] -= offset
                    world = y_up @ placed
                    index = node_for(model.by_id(shape.id))
                    nodes.append({"mesh": mesh_of[g.id], "matrix": [round(v, 9) for v in world.T.reshape(-1).tolist()],
                                  "extras": {"part": True}})
                    parts[index] = len(nodes) - 1
                if not iterator.next():
                    break

        # albero: elementi sotto il loro contenitore spaziale, spaziali sotto il genitore (IfcRelAggregates)
        children: dict[int, list[int]] = {index: [part] for index, part in parts.items()}

        def attach(entity) -> int:
            index = node_for(entity)
            parent = ue.get_container(entity) if not entity.is_a("IfcSpatialElement") and not entity.is_a("IfcProject") else None
            if parent is None:
                parent = ue.get_aggregate(entity)
            if parent is not None and parent.id() != entity.id():
                p = attach(parent)
                if index not in children.setdefault(p, []):
                    children[p].append(index)
            return index

        for eid in list(node_of):
            attach(model.by_id(eid))
        part_nodes = set(parts.values())
        for project in model.by_type("IfcProject"):
            node_for(project)
        for parent, kids in children.items():
            nodes[parent]["children"] = kids
        has_parent = {k for kids in children.values() for k in kids}
        roots = [i for i in range(len(nodes)) if i not in has_parent and i not in part_nodes]

        elements = len(parts)
        gltf = {
            "asset": {"version": "2.0", "generator": f"CDE ifc2glb (IfcOpenShell {ifcopenshell.version})"},
            "scene": 0,
            "scenes": [{"name": (model.by_type("IfcProject") or [None])[0].Name if model.by_type("IfcProject") else "Modello",
                        "nodes": roots,
                        "extras": {"source": "ifc", "schema": model.schema,
                                   "origin_offset": (offset.tolist() if offset is not None else [0, 0, 0])}}],
            "nodes": nodes, "meshes": meshes, "materials": materials or [{"name": "default"}],
            "accessors": blob.accessors, "bufferViews": blob.views,
            "buffers": [{"byteLength": blob.size}] if blob.size else [],
        }
        pad = -blob.size % 4
        blob.f.write(b"\0" * pad)
        blob.f.close()
        bin_size = blob.size + pad
        text = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode()
        text += b" " * (-len(text) % 4)
        total = 12 + 8 + len(text) + (8 + bin_size if bin_size else 0)
        with dst.open("wb") as out:
            out.write(struct.pack("<4sII", b"glTF", 2, total))
            out.write(struct.pack("<I4s", len(text), b"JSON") + text)
            if bin_size:
                out.write(struct.pack("<I4s", bin_size, b"BIN\x00"))
                with (Path(tmp) / "bin").open("rb") as src_bin:
                    while chunk := src_bin.read(8 * 1024 * 1024):
                        out.write(chunk)
    return Result(elements=elements, triangles=triangles, size_bytes=total)
