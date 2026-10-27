# "><(((º> sabusabu <º)))><"
"""Storage oggetti su S3 (boto3). Il backend non fa mai da proxy ai file: upload e download
avvengono con URL presigned direttamente tra browser e S3.

In sviluppo e nei test lo stesso codice parla con moto (S3 emulato) tramite `s3_endpoint_url`.
"""
from __future__ import annotations

import math
from collections.abc import Iterator
from dataclasses import dataclass
from urllib.parse import quote

import boto3
from botocore.config import Config

from .config import Settings

MIN_PART = 5 * 1024 * 1024          # minimo S3 per le parti non finali
MAX_PARTS = 10_000


@dataclass(frozen=True)
class UploadedPart:
    part_number: int
    etag: str
    size: int
    checksum_sha256: str | None


def plan_parts(size: int, preferred_part_size: int) -> tuple[int, int]:
    """(part_size, part_count) rispettando i limiti S3 (≥5 MB, ≤10.000 parti)."""
    part_size = max(preferred_part_size, MIN_PART, math.ceil(size / MAX_PARTS))
    return part_size, max(1, math.ceil(size / part_size))


class Storage:
    def __init__(self, settings: Settings):
        self.bucket = settings.s3_bucket
        self.presign_ttl = settings.presign_ttl_s
        self.client = boto3.client(
            "s3",
            region_name=settings.aws_region,
            endpoint_url=settings.s3_endpoint_url,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"},
                          retries={"max_attempts": 5, "mode": "standard"}),
        )

    # -------------------------------------------------------------- upload
    def create_multipart(self, key: str, content_type: str) -> str:
        r = self.client.create_multipart_upload(Bucket=self.bucket, Key=key, ContentType=content_type,
                                                ChecksumAlgorithm="SHA256")
        return r["UploadId"]

    def presign_part(self, key: str, upload_id: str, part_number: int, checksum_sha256: str) -> str:
        """URL valido 15' per una parte, vincolato al checksum SHA-256 (base64) dichiarato."""
        return self.client.generate_presigned_url(
            "upload_part",
            Params={"Bucket": self.bucket, "Key": key, "UploadId": upload_id, "PartNumber": part_number,
                    "ChecksumSHA256": checksum_sha256, "ChecksumAlgorithm": "SHA256"},
            ExpiresIn=self.presign_ttl,
        )

    def list_parts(self, key: str, upload_id: str) -> list[UploadedPart]:
        parts: list[UploadedPart] = []
        paginator = self.client.get_paginator("list_parts")
        for page in paginator.paginate(Bucket=self.bucket, Key=key, UploadId=upload_id):
            for p in page.get("Parts", []):
                parts.append(UploadedPart(p["PartNumber"], p["ETag"], p["Size"], p.get("ChecksumSHA256")))
        return parts

    def complete_multipart(self, key: str, upload_id: str, parts: list[UploadedPart]) -> str | None:
        r = self.client.complete_multipart_upload(
            Bucket=self.bucket, Key=key, UploadId=upload_id,
            MultipartUpload={"Parts": [
                {"PartNumber": p.part_number, "ETag": p.etag,
                 **({"ChecksumSHA256": p.checksum_sha256} if p.checksum_sha256 else {})}
                for p in sorted(parts, key=lambda x: x.part_number)
            ]},
        )
        return r.get("VersionId")

    def abort_multipart(self, key: str, upload_id: str) -> None:
        self.client.abort_multipart_upload(Bucket=self.bucket, Key=key, UploadId=upload_id)

    # ------------------------------------------------------------ download
    def presign_get(self, key: str, version_id: str | None, filename: str, ttl: int = 300, *,
                    inline_type: str | None = None) -> str:
        """URL firmato per scaricare; con inline_type il browser lo mostra (visualizzatore in piattaforma)."""
        disposition = "inline" if inline_type else "attachment"
        params = {"Bucket": self.bucket, "Key": key,
                  "ResponseContentDisposition": f"{disposition}; filename*=UTF-8''{quote(filename)}"}
        if inline_type:
            params["ResponseContentType"] = inline_type
        if version_id:
            params["VersionId"] = version_id
        return self.client.generate_presigned_url("get_object", Params=params, ExpiresIn=ttl)

    def iter_object(self, key: str, version_id: str | None, chunk: int = 8 * 1024 * 1024) -> Iterator[bytes]:
        params = {"Bucket": self.bucket, "Key": key, **({"VersionId": version_id} if version_id else {})}
        body = self.client.get_object(**params)["Body"]
        yield from body.iter_chunks(chunk)

    def tag_object(self, key: str, version_id: str | None, tags: dict[str, str]) -> None:
        self.client.put_object_tagging(
            Bucket=self.bucket, Key=key, **({"VersionId": version_id} if version_id else {}),
            Tagging={"TagSet": [{"Key": k, "Value": v} for k, v in tags.items()]},
        )

    # ------------------------------------------------------------ sviluppo
    def ensure_bucket(self, object_lock_days: int = 1) -> None:
        """Solo dev/test: in AWS il bucket lo crea Terraform."""
        existing = {b["Name"] for b in self.client.list_buckets().get("Buckets", [])}
        if self.bucket in existing:
            return
        self.client.create_bucket(Bucket=self.bucket, ObjectLockEnabledForBucket=True,
                                  CreateBucketConfiguration={"LocationConstraint": self.client.meta.region_name})
        self.client.put_object_lock_configuration(Bucket=self.bucket, ObjectLockConfiguration={
            "ObjectLockEnabled": "Enabled",
            "Rule": {"DefaultRetention": {"Mode": "GOVERNANCE", "Days": object_lock_days}},
        })
        self.client.put_bucket_cors(Bucket=self.bucket, CORSConfiguration={"CORSRules": [{
            "AllowedMethods": ["PUT", "GET", "HEAD"], "AllowedOrigins": ["*"], "AllowedHeaders": ["*"],
            "ExposeHeaders": ["ETag"], "MaxAgeSeconds": 3000,
        }]})
