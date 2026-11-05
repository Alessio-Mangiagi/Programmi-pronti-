# -*- coding: utf-8 -*-
# "><(((º> sabusabu <º)))><"
"""PDF stampato dal computer → PDF "scansionato": solo immagini, nessun layer di testo.

Serve a tools/modulo_in_pdf.ts per provare il MODULO CONTRATTO nella forma in cui arriva
più spesso: stampato, firmato e ripassato dallo scanner. Le pagine vengono rasterizzate
(200 DPI, scala di grigi), sporcate con un filo di sfocatura e di rumore come una
scansione d'ufficio, e salvate in JPEG dentro il PDF. Il programma non trova testo
nativo e deve passare dall'OCR (PaddleOCR), esattamente come con un contratto vero.

Niente rotazione: la misura deve dire quanto legge l'OCR, non quanto regge un foglio
storto (quello si prova a parte, con una scansione reale).

Uso:
  python tools/pdf_come_scansione.py <in.pdf> <out.pdf> [dpi]
"""
import sys

import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageFilter

RUMORE = 6.0      # deviazione standard del rumore gaussiano, in livelli di grigio
SFOCATURA = 0.6   # raggio della sfocatura gaussiana, in pixel
QUALITA = 80      # qualità JPEG delle pagine


def pagina_scansionata(page, dpi: int, rng: np.random.Generator) -> Image.Image:
    """Una pagina PDF → immagine in scala di grigi con sfocatura e rumore da scanner."""
    img = page.render(scale=dpi / 72).to_pil().convert("L").filter(ImageFilter.GaussianBlur(SFOCATURA))
    a = np.asarray(img, dtype=np.float32) + rng.normal(0, RUMORE, (img.height, img.width))
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), mode="L")


def main() -> None:
    src, dst = sys.argv[1], sys.argv[2]
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 200
    rng = np.random.default_rng(7)          # seme fisso: la stessa "scansione" a ogni giro
    pdf = pdfium.PdfDocument(src)
    pagine = [pagina_scansionata(pdf[i], dpi, rng) for i in range(len(pdf))]
    pagine[0].save(dst, "PDF", resolution=dpi, save_all=True, append_images=pagine[1:], quality=QUALITA)
    print(f"{dst}: {len(pagine)} pagine a {dpi} DPI")


if __name__ == "__main__":
    main()
