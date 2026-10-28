# "><(((º> sabusabu <º)))><"
"""Download di più documenti in un unico ZIP (cartella intera o selezione), con elenco.csv di identificativi,
revisioni, stati e impronte SHA-256 per il controllo di chi riceve.

Ogni revisione passa dagli stessi controlli del download singolo (permessi, verifica antivirus e impronta) e i
PDF negli stati con filigrana entrano nello ZIP già timbrati. Lo ZIP si scrive in streaming mentre si leggono gli
oggetti da S3: in memoria resta un blocco alla volta (salvo i PDF da filigranare, entro il loro limite).
"""
from __future__ import annotations

import csv
import io
import uuid
import zipfile
from collections.abc import Iterator
from datetime import UTC, datetime
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..deps import Ctx, client_ip, ctx, require_project
from ..errors import ApiError
from ..events import security_event
from ..watermark import WatermarkError, stamp
from .documents import _downloadable, _watermarked

router = APIRouter(tags=["documents"])


class ZipIn(BaseModel):
    revision_ids: list[uuid.UUID] = Field(min_length=1, max_length=500)


class _Pipe(io.RawIOBase):
    """Flusso non riposizionabile: zipfile ci scrive, il generatore svuota quello che c'è dopo ogni blocco."""

    def __init__(self):
        self._chunks: list[bytes] = []

    def writable(self) -> bool:
        return True

    def write(self, b) -> int:
        self._chunks.append(bytes(b))
        return len(b)

    def take(self) -> bytes:
        out, self._chunks = b"".join(self._chunks), []
        return out


def _unique(name: str, used: set[str]) -> str:
    stem, dot, ext = name.rpartition(".")
    base, n, candidate = (stem, ext) if dot else (name, ""), 2, name
    while candidate.lower() in used:
        candidate = f"{base[0]} ({n}).{base[1]}" if base[1] else f"{base[0]} ({n})"
        n += 1
    used.add(candidate.lower())
    return candidate


@router.post("/projects/{project_id}/zip")
def download_zip(project_id: uuid.UUID, body: ZipIn, request: Request, c: Ctx = Depends(ctx)):
    settings = c.svc.settings
    ids = list(dict.fromkeys(body.revision_ids))
    with c.tx() as conn:
        project = require_project(conn, project_id)
        items = []
        for rid in ids:
            rev = _downloadable(conn, rid)                      # 404/403/409/423 come il download singolo
            if rev["project_id"] != project_id:
                raise ApiError(422, "wrong_project", "Le revisioni devono essere della stessa commessa")
            items.append((rev, _watermarked(conn, rev)))
        total = sum(r["size_bytes"] for r, _ in items)
        if total > settings.zip_max_bytes:
            raise ApiError(413, "zip_too_large", f"Selezione troppo grande per uno ZIP ({total // 1024 ** 2} MB, "
                           f"limite {settings.zip_max_bytes // 1024 ** 2} MB): scaricare in più parti")
        if any(wm and r["size_bytes"] > settings.watermark_max_bytes for r, wm in items):
            raise ApiError(413, "watermark_too_large", "Un PDF da filigranare supera il limite: scaricarlo da solo")
        meta = {r["id"]: r for r in conn.execute(
            """SELECT r.id, d.title, r.suitability, encode(f.sha256, 'hex') AS sha256, r.created_at
               FROM cde.document_revisions r JOIN cde.documents d ON d.id = r.document_id
               JOIN cde.file_objects f ON f.id = r.file_object_id WHERE r.id = ANY(%s)""", [ids]).fetchall()}
        who = conn.execute(
            """SELECT u.first_name || ' ' || u.last_name AS name, u.email, o.code AS org FROM cde.users u
               JOIN cde.organizations o ON o.id = u.organization_id WHERE u.id = %s""", [c.user_id]).fetchone()
        security_event(conn, "ZIP_DOWNLOADED", user_id=c.user_id, project_id=project_id, ip=c.ip,
                       revisions=[str(r["id"]) for r, _ in items], files=len(items),
                       watermarked=sum(1 for _, wm in items if wm), bytes=total)
    storage = c.svc.storage
    when = datetime.now(UTC)
    ip = client_ip(request) or "n/d"

    def chunks() -> Iterator[bytes]:
        pipe, used = _Pipe(), {"elenco.csv"}
        manifest = io.StringIO()
        out = csv.writer(manifest, delimiter=";")
        out.writerow(["file", "identificativo", "titolo", "revisione", "stato", "idoneita", "byte", "sha256",
                      "filigrana"])
        with zipfile.ZipFile(pipe, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zf:
            for rev, wm in items:
                m = meta[rev["id"]]
                name = _unique(rev["original_filename"], used)
                info = zipfile.ZipInfo(name, date_time=m["created_at"].timetuple()[:6])   # data della revisione
                data = storage.iter_object(rev["storage_key"], rev["storage_version_id"])
                if wm:
                    footer = [f"Scaricato da {who['name']} <{who['email']}> - {who['org']} - "
                              f"{when:%d/%m/%Y %H:%M} UTC - IP {ip}",
                              f"{rev['identifier']} rev. {rev['revision_code']} - stato {rev['state']}"
                              + (f" - {wm.text}" if wm.text else "")]
                    try:
                        data = [stamp(b"".join(data), f"{who['name']} - {who['org']} - {when:%d/%m/%Y}", footer)]
                    except WatermarkError:
                        name = name + ".non-filigranabile.txt"
                        data = [b"PDF non leggibile o protetto: la filigrana richiesta non si puo' applicare.\n"]
                        info = zipfile.ZipInfo(name, date_time=when.timetuple()[:6])
                with zf.open(info, "w", force_zip64=rev["size_bytes"] > 1024 ** 3) as f:
                    for chunk in data:
                        f.write(chunk)
                        yield pipe.take()
                out.writerow([name, rev["identifier"], m["title"], rev["revision_code"], rev["state"],
                              m["suitability"], rev["size_bytes"], m["sha256"], "si" if wm else "no"])
                yield pipe.take()
            zf.writestr(zipfile.ZipInfo("elenco.csv", date_time=when.timetuple()[:6]),
                        "﻿" + manifest.getvalue())         # BOM: Excel legge gli accenti
        yield pipe.take()

    filename = f"{project['code']}-documenti-{when:%Y%m%d-%H%M}.zip"
    return StreamingResponse(chunks(), media_type="application/zip", headers={
        "Content-Disposition": f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(filename)}",
        "Cache-Control": "private, no-store"})
