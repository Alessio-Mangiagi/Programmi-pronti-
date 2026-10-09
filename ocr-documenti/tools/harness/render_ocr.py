# -*- coding: utf-8 -*-
"""Fase A del banco di prova: PDF -> pagine PNG (come il frontend) -> /api/ocr format=md
-> testo OCR salvato in cache, una pagina per file. Si lancia una volta sola;
poi run_pipeline.mjs rigioca il testo dai file, senza rifare l'OCR."""
import base64, glob, io, json, os, re, sys, time, urllib.request
import pypdfium2 as pdfium
from PIL import Image, ImageEnhance

API = os.environ.get("OCR_API", "http://127.0.0.1:5178/api/ocr")
MAX_PX = 3300           # stesso cap del frontend (canvasToPng)
ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "cache")
SRC = os.path.join(ROOT, "..", "..", "contratti")

def slug(nome):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", nome)[:80]

def png_pagina(page):
    nat = page.get_size()
    scale = min(4.0, MAX_PX / max(nat))
    img = page.render(scale=scale).to_pil().convert("RGB")
    if img.width > MAX_PX:
        img = img.resize((MAX_PX, round(img.height * MAX_PX / img.width)), Image.LANCZOS)
    # stesso preprocessing del canvas: grayscale + contrasto 1.35 + luminosita 1.08
    img = img.convert("L")
    img = ImageEnhance.Contrast(img).enhance(1.35)
    img = ImageEnhance.Brightness(img).enhance(1.08)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()

def ocr(b64, dump_id):
    req = urllib.request.Request(API, method="POST",
        data=json.dumps({"images": [b64], "format": "md", "dumpId": dump_id}).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode())["result"]

def lavora(job):
    nome, dst, b64, i, n = job
    t0 = time.time()
    testo = ocr(b64, f"{slug(nome)}__p{i:03d}")
    with open(dst, "w", encoding="utf-8") as fh:
        fh.write(testo)
    print(f"{nome[:45]:45} p{i:>3}/{n:<3} {len(testo):>6}ch {time.time()-t0:5.1f}s", flush=True)

def main():
    from concurrent.futures import ThreadPoolExecutor
    pdfs = sorted(glob.glob(os.path.join(SRC, "*.pdf")))
    solo = sys.argv[1] if len(sys.argv) > 1 else None
    # il rendering resta seriale (PDFium non e thread-safe), l'OCR va a 3 come i worker del server
    with ThreadPoolExecutor(max_workers=3) as pool:
        for f in pdfs:
            nome = os.path.basename(f)
            if solo and solo.lower() not in nome.lower():
                continue
            out = os.path.join(CACHE, slug(nome))
            os.makedirs(out, exist_ok=True)
            doc = pdfium.PdfDocument(f)
            for i in range(len(doc)):
                dst = os.path.join(out, f"p{i+1:03d}.txt")
                if os.path.exists(dst):
                    continue
                # "><(((º> sabusabu <º)))><"
                pool.submit(lavora, (nome, dst, png_pagina(doc[i]), i + 1, len(doc)))

if __name__ == "__main__":
    main()
