# -*- coding: utf-8 -*-
"""
rendi_pagine.py — Rasterizza le pagine di un PDF in PNG per batchOllama.ts.

Ollama non accetta PDF: i modelli vision leggono immagini. Questo script fa il
solo rendering, una riga di stdout per ogni PNG creato (in ordine di pagina).

Uso: python rendi_pagine.py "<pdf>" "<out_dir>" [dpi]

Prova pypdfium2 (presente nell'ambiente del progetto OCR, lo stesso di
pulisci_ddt.py) e ripiega su PyMuPDF (fitz), cosi' funziona sia col Python del
venv OCR sia con un Python di sistema qualunque dei due abbia installato.
"""
import os
import sys


def main():
    if len(sys.argv) < 3:
        sys.exit('Uso: python rendi_pagine.py "<pdf>" "<out_dir>" [dpi]')
    pdf = sys.argv[1]
    out_dir = sys.argv[2]
    dpi = int(sys.argv[3]) if len(sys.argv) > 3 else 150
    if not os.path.isfile(pdf):
        sys.exit(f"PDF non trovato: {pdf}")
    os.makedirs(out_dir, exist_ok=True)

    try:
        import pypdfium2 as pdfium

        doc = pdfium.PdfDocument(pdf)
        try:
            for i in range(len(doc)):
                png = os.path.join(out_dir, f"pagina_{i + 1:03d}.png")
                doc[i].render(scale=dpi / 72).to_pil().save(png)
                print(png, flush=True)
        finally:
            doc.close()
        return
    except ImportError:
        pass

    try:
        import fitz  # PyMuPDF
    except ImportError:
        sys.exit(
            "Ne' pypdfium2 ne' PyMuPDF installati in questo Python. "
            "Usa il Python del progetto OCR (ocr-webapp-paddleocr/.venv-gpu) "
            "oppure: pip install pymupdf"
        )
    with fitz.open(pdf) as doc:
        for i, page in enumerate(doc):
            png = os.path.join(out_dir, f"pagina_{i + 1:03d}.png")
            page.get_pixmap(dpi=dpi).save(png)
            print(png, flush=True)


if __name__ == "__main__":
    main()
