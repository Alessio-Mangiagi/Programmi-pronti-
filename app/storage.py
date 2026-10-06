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

Con S3 e `direct` attivo (default; STORAGE_S3_DIRECT=0 per spegnerlo) i byte non
passano dall'API: GET /file-links/{key} dà un URL firmato per il download e
POST /attachments/presign un presigned POST per l'upload dal device.
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

# Validità degli URL firmati S3 (download e upload diretti).
PRESIGN_SECONDS = int(os.getenv("STORAGE_S3_PRESIGN_SECONDS", "900"))


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
    S3-compatible (AWS S3, MinIO, ...). I file restano privati nel bucket. Gli URL
    salvati nel DB restano "/files/<key>" come con il filesystem; l'API decide chi
    può leggere e, con `direct`, risponde con URL firmati a scadenza così i byte
    viaggiano tra client e bucket senza passare dall'API.
    """
    direct = True

    def __init__(self, bucket: str, endpoint_url: str | None = None, region: str | None = None, prefix: str = "",
                 direct: bool = True):
        import boto3  # dipendenza opzionale: serve solo con STORAGE_S3_BUCKET
        from botocore.config import Config
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.direct = direct
        if region and not endpoint_url:
            # AWS: gli URL firmati sull'endpoint globale vengono rediretti (e invalidati) fuori da us-east-1
            endpoint_url = f"https://s3.{region}.amazonaws.com"
        # firma v4: richiesta per i presigned POST con condizioni e dalle regioni recenti
        self.client = boto3.client("s3", endpoint_url=endpoint_url or None, region_name=region or None,
                                   config=Config(signature_version="s3v4"))

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

    def read_head(self, key: str, n: int = 16) -> bytes:
        """Primi n byte (magic bytes) senza scaricare il file."""
        return self.client.get_object(Bucket=self.bucket, Key=self._k(key), Range=f"bytes=0-{n - 1}")["Body"].read()

    def size(self, key: str) -> int:
        return int(self.client.head_object(Bucket=self.bucket, Key=self._k(key))["ContentLength"])

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._k(key))

    def presign_get(self, key: str, expires: int = PRESIGN_SECONDS) -> str:
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": self._k(key)}, ExpiresIn=expires)

    def presign_post(self, key: str, mime: str, max_bytes: int, expires: int = PRESIGN_SECONDS) -> dict:
        """
        Presigned POST (multipart): a differenza del PUT, S3 fa rispettare tipo e
        dimensione massima. Ritorna {"url", "fields"}: i fields vanno nel form
        PRIMA del campo `file`.
        """
        return self.client.generate_presigned_post(
            Bucket=self.bucket, Key=self._k(key), Fields={"Content-Type": mime},
            Conditions=[{"Content-Type": mime}, ["content-length-range", 1, max_bytes]], ExpiresIn=expires)


def storage_from_env():
    """
    STORAGE_S3_BUCKET attiva S3 (con STORAGE_S3_ENDPOINT per MinIO/altri, STORAGE_S3_REGION,
    STORAGE_S3_PREFIX). STORAGE_S3_DIRECT=0 fa passare di nuovo tutti i byte dall'API.
    """
    bucket = os.getenv("STORAGE_S3_BUCKET")
    if bucket:
        return S3Storage(bucket, os.getenv("STORAGE_S3_ENDPOINT"), os.getenv("STORAGE_S3_REGION"),
                         os.getenv("STORAGE_S3_PREFIX", ""), direct=os.getenv("STORAGE_S3_DIRECT", "1") != "0")
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
