# "><(((º> sabusabu <º)))><"
"""Modello glTF binario (.glb) di prova, come lo esporta Blender: padiglione di due piani più copertura.

Ogni piano è un nodo vuoto ("Piano terra", "Piano 1", "Copertura") con dentro solaio, muri perimetrali, tramezzo,
pilastri e finestre in vetro trasparente; all'ingresso una pensilina ruotata di 15° (8 × 4,5 × 0,25 m) e una porta
in legno con texture PNG incorporata. Come in Blender, la geometria è un cubo unitario per materiale e le dimensioni
stanno nella scala del nodo; le proprietà personalizzate dell'oggetto finiscono in `extras`. I nomi dei muri e dei
solai sono quelli citati dalle tavole demo ("Citato in" nel viewer).

Uscita deterministica: rigenerare dà lo stesso file.
"""
from __future__ import annotations

import json
import math
import struct
import zlib

FLOORS = [("Piano terra", "P0", 0.0), ("Piano 1", "P1", 3.2)]
WIDTH, DEPTH, HEIGHT = 24.0, 12.0, 3.2          # X, Z (glTF: Y in alto), altezza di piano
WALL = 0.3


def _cube() -> tuple[bytes, bytes, bytes, bytes, int]:
    """Cubo unitario centrato: 24 vertici (normali per faccia), UV, 36 indici."""
    pos, nor, uv, idx = [], [], [], []
    for axis in range(3):
        for sign in (1.0, -1.0):
            n = [0.0, 0.0, 0.0]
            n[axis] = sign
            u, v = (a for a in range(3) if a != axis)
            base = len(pos)
            for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                p = [0.0, 0.0, 0.0]
                p[axis], p[u], p[v] = 0.5 * sign, 0.5 * du, 0.5 * dv
                pos.append(p)
                nor.append(n)
                uv.append([(du + 1) / 2, (dv + 1) / 2])
            # verso antiorario visto dall'esterno: e_u × e_v è +n per le facce X e Z, -n per quelle Y
            quad = [0, 1, 2, 0, 2, 3] if sign * (-1 if axis == 1 else 1) > 0 else [0, 2, 1, 0, 3, 2]
            idx += [base + k for k in quad]
    f = lambda rows: b"".join(struct.pack(f"<{len(r)}f", *r) for r in rows)  # noqa: E731
    return f(pos), f(nor), f(uv), struct.pack(f"<{len(idx)}H", *idx), len(idx)


def _png(size: int = 64) -> bytes:
    """Texture "legno" a venature: PNG RGB scritto a mano (zlib), niente dipendenze."""
    rows = b""
    for y in range(size):
        rows += b"\x00"
        for x in range(size):
            g = int(18 * math.sin(x * 0.45 + 3 * math.sin(y * 0.12)))
            rows += bytes((150 + g, 100 + g, 60 + g // 2))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))  # noqa: E731
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def _quat_y(deg: float) -> list[float]:
    a = math.radians(deg) / 2
    return [0.0, round(math.sin(a), 6), 0.0, round(math.cos(a), 6)]


def build() -> bytes:
    pos, nor, uv, idx, count = _cube()
    png = _png()
    blob = bytearray()
    views = []

    def view(data: bytes, target: int | None = None) -> int:
        while len(blob) % 4:
            blob.append(0)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), **({"target": target} if target else {})})
        blob.extend(data)
        return len(views) - 1

    accessors = [
        {"bufferView": view(pos, 34962), "componentType": 5126, "count": 24, "type": "VEC3",
         "min": [-0.5, -0.5, -0.5], "max": [0.5, 0.5, 0.5]},
        {"bufferView": view(nor, 34962), "componentType": 5126, "count": 24, "type": "VEC3"},
        {"bufferView": view(uv, 34962), "componentType": 5126, "count": 24, "type": "VEC2"},
        {"bufferView": view(idx, 34963), "componentType": 5123, "count": count, "type": "SCALAR"},
    ]
    image_view = view(png)
    materials = [
        {"name": "Calcestruzzo", "pbrMetallicRoughness": {"baseColorFactor": [0.68, 0.7, 0.72, 1], "metallicFactor": 0, "roughnessFactor": 0.9}},
        {"name": "Intonaco", "pbrMetallicRoughness": {"baseColorFactor": [0.9, 0.86, 0.79, 1], "metallicFactor": 0, "roughnessFactor": 0.8}},
        {"name": "Vetro", "alphaMode": "BLEND", "pbrMetallicRoughness": {"baseColorFactor": [0.6, 0.8, 0.93, 0.35], "metallicFactor": 0, "roughnessFactor": 0.1}},
        {"name": "Legno", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 0.7}},
        {"name": "Acciaio", "pbrMetallicRoughness": {"baseColorFactor": [0.45, 0.48, 0.5, 1], "metallicFactor": 0.6, "roughnessFactor": 0.4}},
    ]
    attrs = {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}
    meshes = [{"name": f"Cubo.{m['name']}", "primitives": [{"attributes": attrs, "indices": 3, "material": i}]}
              for i, m in enumerate(materials)]
    mesh_of = {m["name"]: i for i, m in enumerate(materials)}
    nodes: list[dict] = []

    def obj(name: str, material: str, center: tuple[float, float, float], size: tuple[float, float, float],
            extras: dict | None = None, rotation: list[float] | None = None) -> int:
        nodes.append({"name": name, "mesh": mesh_of[material], "translation": [round(c, 4) for c in center],
                      "scale": [round(s, 4) for s in size], **({"rotation": rotation} if rotation else {}),
                      "extras": {"Materiale": material, **(extras or {})}})
        return len(nodes) - 1

    def group(name: str, children: list[int], extras: dict) -> int:
        nodes.append({"name": name, "children": children, "extras": extras})
        return len(nodes) - 1

    roots = []
    for floor, tag, y in FLOORS:
        kids = [obj(f"Solaio {tag}", "Calcestruzzo", (0, y - 0.15, 0), (WIDTH, 0.3, DEPTH),
                    {"Codice": f"SOL-{tag}", "Spessore": "30 cm", "Classe": "C30/37"})]
        mid = y + HEIGHT / 2
        for name, center, size in (
                ("Muro perimetrale sud", (0, mid, DEPTH / 2 - WALL / 2), (WIDTH, HEIGHT, WALL)),
                ("Muro perimetrale nord", (0, mid, -DEPTH / 2 + WALL / 2), (WIDTH, HEIGHT, WALL)),
                ("Muro perimetrale ovest", (-WIDTH / 2 + WALL / 2, mid, 0), (WALL, HEIGHT, DEPTH - 2 * WALL)),
                ("Muro perimetrale est", (WIDTH / 2 - WALL / 2, mid, 0), (WALL, HEIGHT, DEPTH - 2 * WALL)),
                ("Tramezzo interno", (0, mid, 0), (0.12, HEIGHT, DEPTH - 2 * WALL))):
            kids.append(obj(f"{name} {tag}", "Intonaco", center, size,
                            {"Codice": f"MUR-{tag}-{len(kids):02d}", "Trasmittanza": "0,28 W/m²K"}))
        for k, x in enumerate((-8.0, -4.0, 4.0, 8.0)):
            kids.append(obj(f"Pilastro {tag}-{k + 1:02d}", "Calcestruzzo", (x, mid, -2.0), (0.4, HEIGHT, 0.4),
                            {"Codice": f"PIL-{tag}-{k + 1:02d}", "Classe": "C30/37"}))
        for k, x in enumerate((-9.0, -3.0, 3.0, 9.0)):
            kids.append(obj(f"Finestra sud {tag}-{k + 1:02d}", "Vetro", (x, y + 1.6, DEPTH / 2 + 0.02), (1.6, 1.4, 0.05),
                            {"Codice": f"FIN-{tag}-{k + 1:02d}", "Uw": "1,1 W/m²K"}))
        roots.append(group(floor, kids, {"Quota": f"{y:.2f} m"}))
    top = FLOORS[-1][2] + HEIGHT
    roots.append(group("Copertura", [
        obj("Solaio copertura", "Calcestruzzo", (0, top + 0.15, 0), (WIDTH, 0.3, DEPTH), {"Codice": "SOL-RF"}),
        obj("Locale tecnico", "Intonaco", (6, top + 1.55, -2), (5, 2.5, 4), {"Codice": "LT-01"}),
    ], {"Quota": f"{top:.2f} m"}))
    roots.append(obj("Pensilina ingresso", "Acciaio", (-4, 3.0, DEPTH / 2 + 2.6), (8, 0.25, 4.5),
                     {"Codice": "PEN-01", "Rotazione": "15°"}, rotation=_quat_y(15)))
    roots.append(obj("Porta ingresso", "Legno", (-4, 1.1, DEPTH / 2 + 0.03), (1.8, 2.2, 0.06), {"Codice": "POR-01"}))

    gltf = {
        "asset": {"version": "2.0", "generator": "Khronos glTF Blender I/O (demo CDE)"},
        "scene": 0, "scenes": [{"name": "Padiglione C", "nodes": roots}],
        "nodes": nodes, "meshes": meshes, "materials": materials, "accessors": accessors,
        "bufferViews": views,
        "images": [{"name": "legno", "mimeType": "image/png", "bufferView": image_view}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
        "textures": [{"sampler": 0, "source": 0}],
    }
    while len(blob) % 4:
        blob.append(0)
    gltf["buffers"] = [{"byteLength": len(blob)}]
    text = json.dumps(gltf, ensure_ascii=False, separators=(",", ":")).encode()
    text += b" " * (-len(text) % 4)
    total = 12 + 8 + len(text) + 8 + len(blob)
    return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(text), b"JSON") + text
            + struct.pack("<I4s", len(blob), b"BIN\x00") + bytes(blob))


def parse(data: bytes) -> tuple[dict, bytes]:
    """JSON e blocco binario di un .glb (per i test)."""
    magic, version, total = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or total != len(data):
        raise ValueError("non è un glTF binario 2.0")
    n, kind = struct.unpack_from("<I4s", data, 12)
    if kind != b"JSON":
        raise ValueError("manca il blocco JSON")
    doc = json.loads(data[20:20 + n])
    rest = 20 + n
    if rest + 8 > len(data):                       # senza blocco binario (es. l'indice di un derivato a piani)
        return doc, b""
    bn, bkind = struct.unpack_from("<I4s", data, rest)
    return doc, data[rest + 8:rest + 8 + bn] if bkind == b"BIN\x00" else b""
