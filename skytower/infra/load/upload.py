# "><(((º> sabusabu <º)))><"
"""Test di carico degli upload (G56): N caricamenti multipart paralleli di file grandi, diretti su S3.

Ogni upload segue il percorso del browser: impronta SHA-256, /uploads/initiate, URL presigned per parte
(vincolati al checksum), PUT diretto su S3, /complete. I dati sono generati in modo deterministico parte per
parte: nessun file su disco e in memoria solo le parti in volo (--parti-in-volo × dimensione parte).

    python infra/load/upload.py --api https://staging.example --upload 50 --mb 1024 --parti-in-volo 32

Carica come sub2.user nel container del subappaltatore SUB2: i documenti restano in WIP, visibili solo a SUB2.
Alla fine stampa tempi di initiate/complete, throughput per upload e aggregato; codice 1 se ci sono errori.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import random
import statistics
import sys
import time

import httpx

USER = "sub2.user@sub2.example"


BLOCK = 1024 ** 2   # i dati si generano a blocchi da 1 MiB: le parti S3 (multiple di 1 MiB) li raggruppano


def data(seed: int, offset: int, length: int) -> bytes:
    """Byte [offset, offset+length) del file di prova ``seed`` (offset allineato a 1 MiB)."""
    out = bytearray()
    for k in range(offset // BLOCK, -(-(offset + length) // BLOCK)):
        out += random.Random(seed * 1_000_003 + k).randbytes(BLOCK)  # noqa: S311 - dati di prova, non segreti
    return bytes(out[:length])


async def one_upload(client: httpx.AsyncClient, s3: httpx.AsyncClient, headers: dict, container_id: str, seed: int,
                     size: int, gate: asyncio.Semaphore, stats: dict) -> None:
    name = f"PRJ01-SUB2-ZZ-01-DR-E-{900000 + seed % 99999:06d}.bin"
    t0 = time.perf_counter()
    try:
        # l'impronta richiede di generare i dati due volte: costa CPU, non memoria
        h = hashlib.sha256()
        for offset in range(0, size, 64 * BLOCK):
            h.update(data(seed, offset, min(64 * BLOCK, size - offset)))
            await asyncio.sleep(0)
        t_init = time.perf_counter()
        r = await client.post("/uploads/initiate", headers=headers, json={
            "container_id": container_id, "filename": name, "size_bytes": size, "sha256": h.hexdigest(),
            "content_type": "application/octet-stream", "title": "Carico di prova", "comment": "infra/load/upload.py"})
        if r.status_code != 201:
            raise RuntimeError(f"initiate HTTP {r.status_code}: {r.text[:200]}")
        up = r.json()
        part_size = up["part_size"]
        sizes = [min(part_size, size - o) for o in range(0, size, part_size)]
        stats["initiate"].append((time.perf_counter() - t_init) * 1000)

        async def send(i: int, n: int) -> None:
            async with gate:
                body = data(seed, (i - 1) * part_size, n)
                checksum = base64.b64encode(hashlib.sha256(body).digest()).decode()
                pr = await client.post(f"/uploads/{up['upload_id']}/parts", headers=headers,
                                       json={"parts": [{"part_number": i, "checksum_sha256": checksum}]})
                if pr.status_code != 200:
                    raise RuntimeError(f"parts HTTP {pr.status_code}")
                p = pr.json()["parts"][0]
                put = await s3.put(p["url"], content=body, headers=p["headers"])
                if put.status_code != 200:
                    raise RuntimeError(f"S3 PUT HTTP {put.status_code}")

        t_up = time.perf_counter()
        await asyncio.gather(*(send(i, n) for i, n in enumerate(sizes, start=1)))
        stats["throughput"].append(size / 1024 ** 2 / (time.perf_counter() - t_up))
        t_c = time.perf_counter()
        c = await client.post(f"/uploads/{up['upload_id']}/complete", headers=headers)
        if c.status_code != 200:
            raise RuntimeError(f"complete HTTP {c.status_code}: {c.text[:200]}")
        stats["complete"].append((time.perf_counter() - t_c) * 1000)
        stats["total"].append(time.perf_counter() - t0)
    except Exception as e:  # noqa: BLE001 - si conta e si riporta, il test prosegue
        stats["errors"].append(f"upload {seed}: {type(e).__name__}: {e}")


async def run(args) -> int:
    async with httpx.AsyncClient(base_url=args.api, timeout=120) as client, \
            httpx.AsyncClient(timeout=600, limits=httpx.Limits(max_connections=args.parti_in_volo)) as s3:
        r = await client.post("/auth/login", json={"email": USER, "password": args.password})
        if r.status_code != 200:
            print(f"login {USER} non riuscito: HTTP {r.status_code}")
            return 1
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
        projects = (await client.get("/projects", headers=headers)).json()
        pid = next(p["id"] for p in projects if p["code"] == "PRJ01")
        containers = (await client.get(f"/projects/{pid}/containers", headers=headers)).json()
        container_id = args.container or next(c["id"] for c in containers if c["name"].startswith("SUB2"))

        stats: dict[str, list] = {"initiate": [], "complete": [], "throughput": [], "total": [], "errors": []}
        gate = asyncio.Semaphore(args.parti_in_volo)
        base = random.randrange(10_000, 99_999)  # noqa: S311
        size = int(args.mb * 1024 ** 2)
        t0 = time.perf_counter()
        await asyncio.gather(*(one_upload(client, s3, headers, container_id, base + k, size, gate, stats)
                               for k in range(args.upload)))
        elapsed = time.perf_counter() - t0

    ok = len(stats["total"])
    print(f"\n{ok}/{args.upload} upload da {args.mb:g} MB in {elapsed:.1f} s, "
          f"aggregato {ok * args.mb / elapsed:.1f} MB/s, {args.parti_in_volo} parti in volo")
    for key, unit in (("initiate", "ms"), ("complete", "ms"), ("throughput", "MB/s"), ("total", "s")):
        v = sorted(stats[key])
        if v:
            print(f"  {key:<11} p50 {statistics.median(v):8.1f} {unit:<5} max {v[-1]:8.1f} {unit}")
    for e in stats["errors"][:20]:
        print("  ERRORE", e)
    return 1 if stats["errors"] else 0


def main() -> int:
    sys.stdout.reconfigure(errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--api", default="http://127.0.0.1:8100")
    ap.add_argument("--upload", type=int, default=5, help="upload paralleli")
    ap.add_argument("--mb", type=float, default=20, help="dimensione di ogni file in MB")
    ap.add_argument("--parti-in-volo", type=int, default=8, help="parti trasferite contemporaneamente (memoria)")
    ap.add_argument("--container", help="id del container (default: quello di SUB2)")
    ap.add_argument("--password", default="Cantiere-2026!")
    return asyncio.run(run(ap.parse_args()))


if __name__ == "__main__":
    sys.exit(main())
