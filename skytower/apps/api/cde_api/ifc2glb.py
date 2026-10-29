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

Con ``parts_dir`` (ADR-36) la geometria si divide per piano: ``dst`` diventa l'indice (albero, nomi, Pset, nessuna
mesh) e in ``parts_dir`` c'è un .glb per piano (più uno per gli elementi fuori dai piani) con i soli nodi "part";
``extras.owner`` è il nodo dell'elemento nell'indice. Il viewer apre l'indice e aggiunge i piani uno alla volta, dal
più basso: il modello compare subito e si completa mentre arriva il resto. L'elenco dei pezzi, in ordine di quota,
è in ``scenes[0].extras.parts``.
"""
from __future__ import annotations

import json
import math
import multiprocessing
import struct
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

SPATIAL = ("IfcProject", "IfcSite", "IfcBuilding", "IfcBuildingStorey", "IfcSpace", "IfcFacility", "IfcFacilityPart")
EXCLUDE = ["IfcOpeningElement", "IfcSpace"]          # aperture: solo vuoti; spazi: volumi d'aria che coprono tutto


@dataclass
class Part:
    name: str
    path: Path
    elements: int
    triangles: int
    size_bytes: int


@dataclass
class Result:
    elements: int
    triangles: int
    size_bytes: int                              # con i pezzi: indice + pezzi
    parts: list[Part] = field(default_factory=list)


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
        self.path = path
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

    def close(self) -> int:
        pad = -self.size % 4
        self.f.write(b"\0" * pad)
        self.f.close()
        return self.size + pad


class _Chunk:
    """Geometria di un .glb: tutta (modello unico) o quella di un piano."""

    def __init__(self, blob: _Bin, nodes: list[dict], meshes: list[dict], name: str = "", storey: int | None = None,
                 elevation: float = math.inf):
        self.blob, self.nodes, self.meshes = blob, nodes, meshes
        self.name, self.storey, self.elevation = name, storey, elevation
        self.mesh_of: dict[str, int] = {}          # geometria IfcOpenShell → mesh (riusata dalle ripetizioni)
        self.elements = 0
        self.triangles = 0


def _write_glb(dst: Path, gltf: dict, bin_path: Path | None, bin_size: int) -> int:
    text = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    total = 12 + 8 + len(text) + (8 + bin_size if bin_size else 0)
    with dst.open("wb") as out:
        out.write(struct.pack("<4sII", b"glTF", 2, total))
        out.write(struct.pack("<I4s", len(text), b"JSON") + text)
        if bin_size and bin_path:
            out.write(struct.pack("<I4s", bin_size, b"BIN\x00"))
            with bin_path.open("rb") as src_bin:
                while chunk := src_bin.read(8 * 1024 * 1024):
                    out.write(chunk)
    return total


def convert(src: Path, dst: Path, *, threads: int | None = None, parts_dir: Path | None = None) -> Result:
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
    parts: dict[int, int] = {}                   # nodo dell'elemento → nodo con la sua geometria (modello unico)
    storey_cache: dict[int, object] = {}
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

    def parent_of(entity):
        parent = ue.get_container(entity) if not entity.is_a("IfcSpatialElement") and not entity.is_a("IfcProject") else None
        return parent if parent is not None else ue.get_aggregate(entity)

    def storey_of(entity):
        """Il piano che contiene l'elemento, risalendo contenitori e aggregati (None: fuori dai piani)."""
        if entity.id() in storey_cache:
            return storey_cache[entity.id()]
        found, e = None, entity
        for _ in range(32):
            if e is None or e.is_a("IfcBuildingStorey"):
                found = e
                break
            nxt = parent_of(e)
            e = nxt if nxt is not None and nxt.id() != e.id() else None
        storey_cache[entity.id()] = found
        return found

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
        single = _Chunk(_Bin(Path(tmp) / "bin"), nodes, meshes) if parts_dir is None else None
        chunks: dict[int | None, _Chunk] = {}

        def chunk_for(entity) -> _Chunk:
            if single is not None:
                return single
            storey = storey_of(entity)
            key = storey.id() if storey is not None else None
            if key not in chunks:
                elevation = math.inf
                if storey is not None and storey.Elevation is not None:
                    elevation = float(storey.Elevation)
                chunks[key] = _Chunk(_Bin(Path(tmp) / f"bin-{len(chunks)}"), [], [],
                                     name=(storey.Name or "Piano") if storey is not None else "Fuori dai piani",
                                     storey=node_for(storey) if storey is not None else None, elevation=elevation)
            return chunks[key]

        if iterator.initialize():
            while True:
                shape = iterator.get()
                g = shape.geometry
                faces = np.asarray(g.faces, dtype=np.int64).reshape(-1, 3)
                if len(faces):
                    entity = model.by_id(shape.id)
                    ck = chunk_for(entity)
                    if g.id not in ck.mesh_of:
                        verts = np.asarray(g.verts, dtype=np.float64).reshape(-1, 3)
                        position = ck.blob.positions(verts)
                        mat_ids = np.asarray(g.material_ids, dtype=np.int64)
                        primitives = []
                        for mid in np.unique(mat_ids):
                            tri = faces[mat_ids == mid].reshape(-1)
                            prim = {"attributes": {"POSITION": position}, "indices": ck.blob.indices(tri)}
                            if 0 <= mid < len(g.materials):
                                prim["material"] = material(g.materials[int(mid)])
                            primitives.append(prim)
                        ck.meshes.append({"primitives": primitives})
                        ck.mesh_of[g.id] = len(ck.meshes) - 1
                    triangles += len(faces)
                    ck.triangles += len(faces)
                    ck.elements += 1
                    matrix = np.asarray(us.get_shape_matrix(shape), dtype=np.float64)
                    if offset is None:
                        offset = np.floor(matrix[:3, 3])
                    placed = matrix.copy()
                    placed[:3, 3] -= offset
                    world = y_up @ placed
                    index = node_for(entity)
                    part = {"mesh": ck.mesh_of[g.id], "matrix": [round(v, 9) for v in world.T.reshape(-1).tolist()],
                            "extras": {"part": True}}
                    if single is None:
                        part["extras"]["owner"] = index
                    ck.nodes.append(part)
                    if single is not None:
                        parts[index] = len(nodes) - 1
                if not iterator.next():
                    break

        # albero: elementi sotto il loro contenitore spaziale, spaziali sotto il genitore (IfcRelAggregates)
        children: dict[int, list[int]] = {index: [part] for index, part in parts.items()}

        def attach(entity) -> int:
            index = node_for(entity)
            parent = parent_of(entity)
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

        asset = {"version": "2.0", "generator": f"CDE ifc2glb (IfcOpenShell {ifcopenshell.version})"}
        mats = materials or [{"name": "default"}]
        projects = model.by_type("IfcProject")
        scene_extras: dict = {"source": "ifc", "schema": model.schema,
                              "origin_offset": (offset.tolist() if offset is not None else [0, 0, 0])}
        scene = {"name": projects[0].Name if projects else "Modello", "nodes": roots, "extras": scene_extras}

        def geometry(ck: _Chunk) -> tuple[dict, int]:
            size = ck.blob.close()
            return {"meshes": ck.meshes, "accessors": ck.blob.accessors, "bufferViews": ck.blob.views,
                    "buffers": [{"byteLength": size}] if size else []}, size

        if single is not None:
            body, size = geometry(single)
            total = _write_glb(dst, {"asset": asset, "scene": 0, "scenes": [scene], "nodes": nodes, "materials": mats,
                                     **body}, single.blob.path, size)
            return Result(elements=len(parts), triangles=triangles, size_bytes=total)

        # pezzi dal piano più basso; gli elementi fuori dai piani per ultimi
        parts_dir.mkdir(parents=True, exist_ok=True)
        out: list[Part] = []
        listed: list[dict] = []
        for k, ck in enumerate(sorted(chunks.values(), key=lambda c: (c.storey is None, c.elevation))):
            body, size = geometry(ck)
            path = parts_dir / f"part-{k}.glb"
            piece = {"asset": asset, "scene": 0, "scenes": [{"name": ck.name, "nodes": list(range(len(ck.nodes)))}],
                     "nodes": ck.nodes, "materials": mats, **body}
            out.append(Part(ck.name, path, ck.elements, ck.triangles, _write_glb(path, piece, ck.blob.path, size)))
            listed.append({"name": ck.name, "storey": ck.storey, "elements": ck.elements, "triangles": ck.triangles,
                           "size_bytes": out[-1].size_bytes})
        scene_extras["parts"] = listed
        # indice: solo albero e proprietà (glTF valido anche senza mesh)
        total = _write_glb(dst, {"asset": asset, "scene": 0, "scenes": [scene], "nodes": nodes, "materials": mats}, None, 0)
    return Result(elements=sum(p.elements for p in out), triangles=triangles,
                  size_bytes=total + sum(p.size_bytes for p in out), parts=out)
