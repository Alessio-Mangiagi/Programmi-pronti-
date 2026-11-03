# "><(((º> sabusabu <º)))><"
"""Viewer DWG senza licenza (G44, ADR-41): DWG → DXF → SVG.

Perché: il piano prevedeva Autodesk APS (licenza a consumo) per vedere i DWG nel browser. La strada scelta
dall'utente il 03/11/2026 è gratuita e offline: il worker converte il DWG in DXF con ODA File Converter
(programma gratuito dell'Open Design Alliance, non ridistribuibile: va installato sul server) e poi disegna il
DXF in SVG con ``ezdxf`` (MIT). Un DXF caricato direttamente salta il primo passo e funziona anche senza ODA.

Come si inserisce: stesso meccanismo del derivato .glb degli IFC (``cde.file_derivatives``, kind ``SVG``,
migrazione 0035): il worker chiama :func:`convert` dopo la verifica antivirus, l'API offre l'SVG firmato al
viewer con l'elenco dei layer. L'SVG è nostro (non arriva dall'utente): niente script, solo path, text e gruppi.

Formato dell'SVG prodotto:
  * ``viewBox`` nelle unità del disegno con l'asse Y già invertito (nel DXF l'Y sale, nell'SVG scende);
  * un ``<g data-layer="NOME" data-color="#rrggbb">`` per layer, con ``display:none`` se il layer è spento o
    congelato nel DXF: il viewer accende e spegne i layer mostrando/nascondendo il gruppo;
  * ``vector-effect="non-scaling-stroke"``: le linee restano sottili a qualunque zoom;
  * attributi ``data-units`` (unità del DXF, $INSUNITS) e ``data-bbox`` per le misure nel viewer.
Gli INSERT (blocchi), le quote, i leader e gli altri entity compositi vengono scomposti con
``ezdxf.disassemble.recursive_decompose``; i testi diventano ``<text>``; hatch = contorno con riempimento leggero.
"""
from __future__ import annotations

import dataclasses
import glob
import html
import logging
import math
import os
import shutil
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)

# $INSUNITS del DXF → etichetta per il viewer (le più comuni in edilizia)
UNITS = {0: "", 1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m", 7: "km", 14: "dm"}
# Distanza di appiattimento delle curve (archi, spline) in unità del disegno: un centesimo del lato maggiore
# del disegno, con un minimo per non esplodere il numero di vertici sui disegni enormi
FLATTEN_FRACTION = 1e-3
MAX_ENTITIES = 400_000          # oltre, l'SVG diventerebbe ingestibile nel browser: si ferma con errore chiaro
ODA_WINDOWS_GLOB = r"C:\Program Files\ODA\ODAFileConverter*\ODAFileConverter.exe"


class DwgConverterMissing(RuntimeError):
    """ODA File Converter non trovato: i DWG non si possono convertire (i DXF sì)."""


@dataclasses.dataclass
class Layer:
    name: str
    color: str
    visible: bool
    entities: int = 0


@dataclasses.dataclass
class Result:
    size_bytes: int
    entities: int
    layers: list[Layer]
    units: str
    bbox: tuple[float, float, float, float]     # minx, miny, maxx, maxy nelle unità del disegno (Y del DXF)

    def layers_json(self) -> list[dict]:
        return [dataclasses.asdict(layer) for layer in self.layers]


# ----------------------------------------------------------------------------------------------- DWG → DXF
def find_oda_converter(configured: str | None = None) -> str | None:
    """L'eseguibile di ODA File Converter: configurazione, PATH, cartella predefinita su Windows."""
    candidates = [configured, shutil.which("ODAFileConverter")]
    if os.name == "nt":
        candidates += sorted(glob.glob(ODA_WINDOWS_GLOB), reverse=True)     # versione più recente prima
    return next((c for c in candidates if c and Path(c).is_file()), None)


def dwg_to_dxf(src: Path, out_dir: Path, command: str | None = None, timeout: int = 300) -> Path:
    """Converte ``src`` (DWG) in DXF 2018 dentro ``out_dir`` con ODA File Converter (riga di comando:
    cartella di origine, cartella di destinazione, versione, formato, ricorsivo, audit, filtro dei file)."""
    exe = find_oda_converter(command)
    if exe is None:
        raise DwgConverterMissing(
            "ODA File Converter non installato: scaricarlo gratis da https://www.opendesign.com/guestfiles/oda_file_converter "
            "e indicare l'eseguibile in CDE_DWG_CONVERTER_CMD (oppure caricare il disegno in DXF)")
    out_dir.mkdir(parents=True, exist_ok=True)
    # eseguibile scelto dalla configurazione, argomenti nostri: niente shell, niente input dell'utente
    subprocess.run([exe, str(src.parent), str(out_dir), "ACAD2018", "DXF", "0", "1", src.name],  # noqa: S603
                   check=True, timeout=timeout, capture_output=True)
    dxf = out_dir / (src.stem + ".dxf")
    if not dxf.is_file():
        raise RuntimeError("ODA File Converter non ha prodotto il DXF (file DWG danneggiato o protetto?)")
    return dxf


# ----------------------------------------------------------------------------------------------- DXF → SVG
def _rgb(entity, layer_color: str) -> str:
    """Colore dell'entità: true color se c'è, altrimenti ACI; BYLAYER/BYBLOCK = colore del layer."""
    import ezdxf.colors as colors

    true_color = entity.dxf.get("true_color")
    if true_color is not None:
        return "#{:02x}{:02x}{:02x}".format(*colors.int2rgb(true_color))
    aci = entity.dxf.get("color", 256)
    return _aci(aci, layer_color)


def _aci(aci: int, fallback: str = "#000000") -> str:
    import ezdxf.colors as colors

    if aci in (0, 256) or aci < 0:          # BYBLOCK, BYLAYER, layer spento (ACI negativo)
        return fallback
    if aci == 7:                            # bianco/nero: dipende dallo sfondo, il nostro è bianco
        return "#000000"
    try:
        return "#{:02x}{:02x}{:02x}".format(*colors.aci2rgb(aci))
    except (IndexError, ValueError):
        return fallback


def _fmt(v: float) -> str:
    return f"{v:.4f}".rstrip("0").rstrip(".") if abs(v) >= 1e-4 else "0"


def _text_svg(entity, color: str) -> tuple[str, list[tuple[float, float]]]:
    """TEXT/MTEXT → <text>: l'SVG ha l'Y invertito, quindi il testo si specchia di nuovo attorno al suo punto."""
    kind = entity.dxftype()
    if kind == "MTEXT":
        insert, height = entity.dxf.insert, entity.dxf.char_height
        rotation = entity.get_rotation() if hasattr(entity, "get_rotation") else entity.dxf.get("rotation", 0.0)
        text = entity.plain_text(split=True)
        lines = text if isinstance(text, list) else str(text).splitlines()
    else:
        insert, height, rotation = entity.dxf.insert, entity.dxf.height, entity.dxf.get("rotation", 0.0)
        lines = [entity.plain_text()]
    x, y = float(insert.x), float(insert.y)
    out = []
    points = []
    for k, line in enumerate(lines[:50]):
        if not line.strip():
            continue
        dy = -k * height * 1.4          # righe successive sotto la prima (nel sistema del DXF l'Y scende)
        lx, ly = x - dy * math.sin(math.radians(rotation)), y + dy * math.cos(math.radians(rotation))
        out.append(f'<text x="0" y="0" font-size="{_fmt(height)}" fill="{color}" '
                   f'transform="translate({_fmt(lx)} {_fmt(-ly)}) rotate({_fmt(-rotation)}) scale(1 1)">'
                   f"{html.escape(line, quote=False)}</text>")
        points.append((lx, ly))
        points.append((lx + height * 0.6 * len(line), ly + height))
    return "".join(out), points


def _paths(entity, flatten: float):
    """I tracciati di un'entità geometrica (LINE, polilinee, cerchi, archi, ellissi, spline, solidi, hatch)."""
    import ezdxf.path as epath
    from ezdxf.entities import Hatch

    if isinstance(entity, Hatch):
        try:
            return list(epath.from_hatch(entity)), True
        except Exception:      # noqa: BLE001 - hatch con contorni strani: si salta il riempimento
            return [], True
    try:
        p = epath.make_path(entity)
    except (TypeError, ValueError, AttributeError):
        return [], False
    return ([p] if len(p) else []), entity.dxftype() in ("SOLID", "TRACE", "3DFACE")


def convert(src: Path, dst: Path, *, converter: str | None = None) -> Result:
    """Disegna il DWG/DXF ``src`` nell'SVG ``dst``. Per i DWG passa da ODA File Converter (cartella temporanea
    accanto a ``dst``). Solleva ``DwgConverterMissing`` se serve ODA e non c'è."""
    import ezdxf

    if src.suffix.lower() == ".dwg":
        src = dwg_to_dxf(src, dst.parent / "dxf", converter)
    doc = ezdxf.readfile(str(src))
    msp = doc.modelspace()
    units = UNITS.get(int(doc.header.get("$INSUNITS", 0) or 0), "")

    layers: dict[str, Layer] = {}
    for layer in doc.layers:
        # Defpoints: layer di servizio delle quote, in AutoCAD non si stampa mai
        visible = layer.is_on() and not layer.is_frozen() and layer.dxf.name.lower() != "defpoints"
        layers[layer.dxf.name] = Layer(layer.dxf.name, _aci(abs(layer.color), "#000000"), visible)

    # primo giro: dimensione del disegno (serve per decidere quanto appiattire le curve)
    entities = list(_flatten(msp))
    if len(entities) > MAX_ENTITIES:
        raise RuntimeError(f"disegno con {len(entities)} entità: troppo grande per il viewer (massimo {MAX_ENTITIES})")
    extent = _extent(entities)
    flatten = max((extent or 1.0) * FLATTEN_FRACTION, 1e-6)

    groups: dict[str, list[str]] = {}
    pts: list[tuple[float, float]] = []
    drawn = 0
    for e in entities:
        name = e.dxf.get("layer", "0") or "0"
        layer = layers.setdefault(name, Layer(name, "#000000", True))
        color = _rgb(e, layer.color)
        kind = e.dxftype()
        pieces: list[str] = []
        if kind in ("TEXT", "MTEXT"):
            svg, p = _text_svg(e, color)
            if svg:
                pieces.append(svg)
                pts.extend(p)
        elif kind in ("POINT",):
            x, y = float(e.dxf.location.x), float(e.dxf.location.y)
            pieces.append(f'<circle cx="{_fmt(x)}" cy="{_fmt(-y)}" r="{_fmt(flatten * 2)}" fill="{color}"/>')
            pts.append((x, y))
        else:
            paths, filled = _paths(e, flatten)
            for p in paths:
                d, p_pts = _path_d(p, flatten)
                if not d:
                    continue
                pts.extend(p_pts)
                fill = f'{color}" fill-opacity="0.25' if filled else "none"
                pieces.append(f'<path d="{d}" fill="{fill}" stroke="{color}" stroke-width="1" vector-effect="non-scaling-stroke"/>')
        if pieces:
            groups.setdefault(name, []).extend(pieces)
            layer.entities += 1
            drawn += 1

    if not pts:
        raise RuntimeError("disegno vuoto: nessuna entità disegnabile nel modello")
    minx, miny = min(p[0] for p in pts), min(p[1] for p in pts)
    maxx, maxy = max(p[0] for p in pts), max(p[1] for p in pts)
    pad = max(maxx - minx, maxy - miny, 1.0) * 0.02
    vb = (minx - pad, -(maxy + pad), (maxx - minx) + 2 * pad, (maxy - miny) + 2 * pad)
    used = [layer for layer in layers.values() if layer.entities]
    body = []
    for layer in used:
        style = "" if layer.visible else ' style="display:none"'
        body.append(f'<g data-layer="{html.escape(layer.name)}" data-color="{layer.color}"{style}>'
                    + "".join(groups[layer.name]) + "</g>")
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{_fmt(vb[0])} {_fmt(vb[1])} {_fmt(vb[2])} {_fmt(vb[3])}" '
           f'data-units="{units}" data-bbox="{_fmt(minx)} {_fmt(miny)} {_fmt(maxx)} {_fmt(maxy)}" '
           'font-family="Arial, Helvetica, sans-serif" stroke-linecap="round" stroke-linejoin="round">'
           '<rect x="-1e9" y="-1e9" width="2e9" height="2e9" fill="#ffffff"/>' + "".join(body) + "</svg>")
    data = svg.encode("utf-8")
    dst.write_bytes(data)
    return Result(len(data), drawn, used, units, (minx, miny, maxx, maxy))


def _flatten(entities, parent_layer: str | None = None, depth: int = 0):
    """Scompone blocchi (INSERT), quote, leader e simili nelle entità elementari. Regola di AutoCAD: ciò che
    dentro un blocco sta sul layer "0" prende il layer dell'INSERT che lo usa (così le quote restano sul layer
    QUOTE e non finiscono tutte su "0")."""
    for e in entities:
        layer = e.dxf.get("layer", "0") or "0"
        if parent_layer and layer == "0":
            layer = parent_layer
            try:
                e.dxf.layer = layer
            except Exception:      # noqa: BLE001, S110 - entità virtuale non modificabile: resta su "0", non è un errore
                pass
        if depth < 8 and hasattr(e, "virtual_entities") and e.dxftype() not in ("HATCH", "LWPOLYLINE", "POLYLINE", "MTEXT"):
            try:
                children = list(e.virtual_entities())
            except Exception:      # noqa: BLE001 - blocco rotto: si disegna quel che si può
                children = []
            if children:
                yield from _flatten(children, layer, depth + 1)
                continue
        yield e


def _path_d(path, flatten: float) -> tuple[str, list[tuple[float, float]]]:
    """Un tracciato ezdxf (segmenti e curve) → attributo ``d`` con l'Y invertito, più i vertici per il bbox."""
    verts = [(float(v.x), float(v.y)) for v in path.flattening(flatten)]
    if len(verts) < 2:
        return "", verts
    d = "M" + " L".join(f"{_fmt(x)} {_fmt(-y)}" for x, y in verts)
    if path.is_closed:
        d += " Z"
    return d, verts


def _extent(entities) -> float:
    """Lato maggiore del disegno, stimato dai punti di controllo (veloce: niente appiattimento)."""
    import ezdxf.path as epath

    xs: list[float] = []
    ys: list[float] = []
    for e in entities[:20_000]:
        try:
            p = epath.make_path(e)
        except Exception:      # noqa: BLE001, S112 - testi e altro: non contano per l'estensione
            continue
        for v in p.control_vertices():
            xs.append(float(v.x))
            ys.append(float(v.y))
    if not xs:
        return 0.0
    return max(max(xs) - min(xs), max(ys) - min(ys))
