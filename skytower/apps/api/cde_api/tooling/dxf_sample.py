# "><(((º> sabusabu <º)))><"
"""Pianta DXF di prova per il viewer DWG (G44): muri, porte, finestre a blocco, pilastri, quote e testi su
layer separati (ARCH, STRUT, QUOTE, TESTI, ARREDI). Serve ai test, alla demo delle commesse e al comando
``cde genera-dxf``. Generata con ezdxf, in millimetri ($INSUNITS = 4), così le misure nel viewer sono vere."""
from __future__ import annotations

import io
import random

LAYERS = {
    "ARCH": 7,      # muri e aperture (nero)
    "STRUT": 1,     # pilastri (rosso)
    "QUOTE": 3,     # quote (verde)
    "TESTI": 5,     # nomi dei locali (blu)
    "ARREDI": 8,    # arredi a blocco (grigio)
}


def build(seed: int = 0, titolo: str = "Pianta piano terra", locali: list[str] | None = None,
          larghezza: float = 18000.0, profondita: float = 12000.0) -> bytes:
    """Il DXF (testo, R2010) di una pianta con ``len(locali)`` stanze in fila lungo il lato lungo."""
    import ezdxf
    from ezdxf.enums import TextEntityAlignment

    rnd = random.Random(seed)
    locali = locali or ["Ingresso", "Ufficio 1", "Ufficio 2", "Sala riunioni", "Archivio"]
    doc = ezdxf.new("R2010", setup=True)
    doc.header["$INSUNITS"] = 4
    for name, color in LAYERS.items():
        doc.layers.add(name, color=color)
    doc.layers.add("NASCOSTO", color=2).off()        # un layer spento: il viewer lo mostra non spuntato
    msp = doc.modelspace()

    # blocco finestra: due linee parallele dentro lo spessore del muro
    finestra = doc.blocks.new(name="FINESTRA")
    finestra.add_line((0, 0), (1200, 0), dxfattribs={"layer": "ARCH"})
    finestra.add_line((0, 300), (1200, 300), dxfattribs={"layer": "ARCH"})
    finestra.add_line((0, 150), (1200, 150), dxfattribs={"layer": "ARCH", "color": 8})
    scrivania = doc.blocks.new(name="SCRIVANIA")
    scrivania.add_lwpolyline([(0, 0), (1600, 0), (1600, 800), (0, 800)], close=True, dxfattribs={"layer": "ARREDI"})
    scrivania.add_circle((800, 1100), 250, dxfattribs={"layer": "ARREDI"})

    sp = 300.0                                       # spessore dei muri perimetrali
    # muro perimetrale: due polilinee chiuse (esterno e interno)
    msp.add_lwpolyline([(0, 0), (larghezza, 0), (larghezza, profondita), (0, profondita)], close=True,
                       dxfattribs={"layer": "ARCH"})
    msp.add_lwpolyline([(sp, sp), (larghezza - sp, sp), (larghezza - sp, profondita - sp), (sp, profondita - sp)],
                       close=True, dxfattribs={"layer": "ARCH"})
    # tramezzi fra i locali, con una porta (vano + arco di apertura) ciascuno
    n = len(locali)
    passo = (larghezza - 2 * sp) / n
    for i in range(1, n):
        x = sp + i * passo
        msp.add_line((x, sp), (x, profondita / 2 - 450), dxfattribs={"layer": "ARCH"})
        msp.add_line((x, profondita / 2 + 450), (x, profondita - sp), dxfattribs={"layer": "ARCH"})
        msp.add_arc((x, profondita / 2 + 450), 900, 180, 270, dxfattribs={"layer": "ARCH"})          # battuta
        msp.add_line((x, profondita / 2 + 450), (x - 900, profondita / 2 + 450), dxfattribs={"layer": "ARCH"})
    # finestre sul lato nord, una per locale; arredo in ogni ufficio
    for i, nome in enumerate(locali):
        cx = sp + i * passo + passo / 2
        msp.add_blockref("FINESTRA", (cx - 600, profondita - sp), dxfattribs={"layer": "ARCH"})
        msp.add_text(nome, height=350, dxfattribs={"layer": "TESTI"}).set_placement(
            (cx, profondita / 2), align=TextEntityAlignment.MIDDLE_CENTER)
        msp.add_text(f"{passo / 1000:.2f} x {(profondita - 2 * sp) / 1000:.2f} m", height=200,
                     dxfattribs={"layer": "TESTI"}).set_placement((cx, profondita / 2 - 500), align=TextEntityAlignment.MIDDLE_CENTER)
        if "Ufficio" in nome or "Sala" in nome:
            msp.add_blockref("SCRIVANIA", (cx - 800, sp + 600 + rnd.randint(0, 300)), dxfattribs={"layer": "ARREDI"})
    # pilastri 40 x 40 agli angoli e lungo i lati lunghi (hatch pieno = riempimento nel viewer)
    for px in (0, larghezza / 2 - 200, larghezza - 400):
        for py in (0, profondita - 400):
            h = msp.add_hatch(color=1, dxfattribs={"layer": "STRUT"})
            h.paths.add_polyline_path([(px, py), (px + 400, py), (px + 400, py + 400), (px, py + 400)], is_closed=True)
    # quote: lunghezza totale e un locale
    dim = msp.add_linear_dim(base=(0, -1200), p1=(0, 0), p2=(larghezza, 0), dxfattribs={"layer": "QUOTE"})
    dim.render()
    dim2 = msp.add_linear_dim(base=(-1200, 0), p1=(0, 0), p2=(0, profondita), angle=90, dxfattribs={"layer": "QUOTE"})
    dim2.render()
    # cartiglio: testo multilinea in basso a destra e una linea sul layer spento
    msp.add_mtext(f"{titolo}\nScala 1:100 - quote in mm\nCosedil S.p.A.", dxfattribs={"layer": "TESTI", "char_height": 250}
                  ).set_location((larghezza - 4000, -2200))
    msp.add_line((0, -3000), (larghezza, -3000), dxfattribs={"layer": "NASCOSTO"})

    out = io.StringIO()
    doc.write(out)
    return out.getvalue().encode("utf-8")
