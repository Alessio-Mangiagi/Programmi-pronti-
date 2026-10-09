# -*- coding: utf-8 -*-
"""Render pagine PDF → PNG, IDENTICO al rendering del frontend (src/App.tsx).

Serve all'harness offline (tools/harness.ts): senza questo le pagine andrebbero
rigenerate dal browser a ogni prova di parser.

Deve produrre gli STESSI pixel di `renderPdfPage` + `canvasToPng`, altrimenti il
banco di prova misura un OCR diverso da quello di produzione:
  - scala = min(4.0, 3300 / lato_lungo_in_punti)      (≈300 DPI su A4)
  - sfondo bianco, poi filtro CSS `contrast(1.35) grayscale(1) brightness(1.08)`
    applicato NELL'ORDINE (i filtri CSS sono una pipeline sinistra→destra)
  - PNG lossless

Uso:
  python tools/render_pdf.py <file.pdf> <dir_output> [pagina_da] [pagina_a]
Stampa su stdout un JSON: {"pages": ["<path>.png", ...], "n": <totale pagine>}
"""
import json
import os
import sys

import numpy as np
import pypdfium2 as pdfium
from PIL import Image

MAX_PX = 3300          # stesso cap del frontend
MAX_SCALE = 4.0
CONTRAST = 1.35
BRIGHTNESS = 1.08
# coefficienti di luminanza di CSS `grayscale()` (Filter Effects §grayscale, sRGB)
LUMA = (0.2126, 0.7152, 0.0722)


def applica_filtri(img: Image.Image) -> Image.Image:
    """contrast(1.35) → grayscale(1) → brightness(1.08), formule CSS esatte."""
    a = np.asarray(img.convert("RGB"), dtype=np.float32)
    a = (a - 127.5) * CONTRAST + 127.5          # contrast: pivot 0.5
    a = a @ np.array(LUMA, dtype=np.float32)    # grayscale: luminanza pesata
    a = a * BRIGHTNESS                          # brightness: moltiplicativo
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), mode="L")


def main() -> None:
    pdf_path, out_dir = sys.argv[1], sys.argv[2]
    da = int(sys.argv[3]) if len(sys.argv) > 3 else 1
    a = int(sys.argv[4]) if len(sys.argv) > 4 else 0

    os.makedirs(out_dir, exist_ok=True)
    pdf = pdfium.PdfDocument(pdf_path)
    n = len(pdf)
    a = n if a <= 0 else min(a, n)
    base = os.path.splitext(os.path.basename(pdf_path))[0]

    out = []
    for i in range(da - 1, a):
        page = pdf[i]
        w, h = page.get_size()                  # in punti (72 dpi), come pdfjs scale 1.0
        scale = min(MAX_SCALE, MAX_PX / max(w, h))
        img = page.render(scale=scale).to_pil()
        # il frontend disegna su canvas bianco: appiattisce l'alpha su bianco
        if img.mode in ("RGBA", "LA"):
            fondo = Image.new("RGB", img.size, (255, 255, 255))
            fondo.paste(img, mask=img.split()[-1])
            img = fondo
        p = os.path.join(out_dir, f"{base}__p{i + 1:03d}.png")
        applica_filtri(img).save(p, "PNG", optimize=False)
        out.append(p)
        page.close()
    pdf.close()
    print(json.dumps({"pages": out, "n": n}, ensure_ascii=False))


if __name__ == "__main__":
    main()
