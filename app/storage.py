"""
Storage dei file (planimetrie, foto, firme).

Interfaccia minima così che in produzione si possa sostituire il filesystem
con S3-compatible senza toccare gli endpoint:

    save(key, data) -> url      salva i byte e ritorna l'URL (/files/<key>)
    exists(key)     -> bool
    path(key)       -> Path     (solo FS) percorso locale per servire il file
    read(key)       -> bytes    (solo S3) contenuto, servito dall'API

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


class S3Storage:
    """
    S3-compatible (AWS S3, MinIO, ...). I file restano privati nel bucket e vengono
    serviti dall'API via GET /files/{key} (auth JWT), come con il filesystem: gli URL
    salvati nel DB ("/files/<key>") non cambiano tra i due backend. Presigned URL
    diretti = backlog.
    """
    def __init__(self, bucket: str, endpoint_url: str | None = None, region: str | None = None, prefix: str = ""):
        import boto3  # dipendenza opzionale: serve solo con STORAGE_S3_BUCKET
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.client = boto3.client("s3", endpoint_url=endpoint_url or None, region_name=region or None)

    def _k(self, key: str) -> str:
        if ".." in key.split("/") or key.startswith("/"):
            raise ValueError("invalid key")
        return f"{self.prefix}/{key}" if self.prefix else key

    def save(self, key: str, data: bytes) -> str:
        mime = sniff_mime(data) or "application/octet-stream"
        self.client.put_object(Bucket=self.bucket, Key=self._k(key), Body=data, ContentType=mime)
        return f"/files/{key}"

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=self._k(key))
            return True
        except Exception:
            return False

    def read(self, key: str) -> bytes:
        return self.client.get_object(Bucket=self.bucket, Key=self._k(key))["Body"].read()


def storage_from_env():
    """STORAGE_S3_BUCKET attiva S3 (con STORAGE_S3_ENDPOINT per MinIO/altri, STORAGE_S3_REGION, STORAGE_S3_PREFIX)."""
    bucket = os.getenv("STORAGE_S3_BUCKET")
    if bucket:
        return S3Storage(bucket, os.getenv("STORAGE_S3_ENDPOINT"), os.getenv("STORAGE_S3_REGION"), os.getenv("STORAGE_S3_PREFIX", ""))
    return FileSystemStorage(Path(os.getenv("STORAGE_DIR", "storage")))


storage = storage_from_env()


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
