"""
Storage dei file (planimetrie, foto, firme).

Interfaccia minima così che in produzione si possa sostituire il filesystem
con S3-compatible senza toccare gli endpoint:

    save(key, data) -> url      salva i byte e ritorna l'URL pubblico
    path(key)       -> Path     (solo FS) percorso locale per servire il file

Le chiavi sono relative, es. "plans/<plan_id>.png", "attachments/<id>.jpg".
Con FileSystemStorage l'URL è "/files/<key>", servito da GET /files/{key}.
"""
import io
import os
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image

MAX_UPLOAD_BYTES = 20 * 1024 * 1024

# MIME riconosciuti dal contenuto (magic bytes), non dall'header del client.
ALLOWED_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
}

# Lato lungo massimo del PNG generato da un PDF: abbastanza per zoomare su
# una planimetria A1, senza produrre file da decine di MB.
PDF_RENDER_MAX_SIDE = 4000


class FileSystemStorage:
    def __init__(self, root: Path):
        self.root = Path(root)

    def path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root.resolve() not in p.parents:
            raise ValueError("invalid key")
        return p

    def save(self, key: str, data: bytes) -> str:
        p = self.path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return f"/files/{key}"

    def exists(self, key: str) -> bool:
        try:
            return self.path(key).is_file()
        except ValueError:
            return False


storage = FileSystemStorage(Path(os.getenv("STORAGE_DIR", "storage")))


# ---------- Ispezione contenuto ----------

def sniff_mime(data: bytes) -> str | None:
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    return None


def image_size(data: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(data)) as im:
        return im.size


def pdf_first_page_to_png(data: bytes) -> bytes:
    """Renderizza la prima pagina del PDF a PNG, lato lungo <= PDF_RENDER_MAX_SIDE."""
    pdf = pdfium.PdfDocument(data)
    try:
        page = pdf[0]
        w, h = page.get_size()  # punti (1/72")
        scale = min(PDF_RENDER_MAX_SIDE / max(w, h), 4.0)  # 4x = 288 dpi max
        bitmap = page.render(scale=scale)
        im = bitmap.to_pil()
        out = io.BytesIO()
        im.save(out, format="PNG", optimize=True)
        return out.getvalue()
    finally:
        pdf.close()
