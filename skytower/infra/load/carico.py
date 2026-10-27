# "><(((º> sabusabu <º)))><"
"""Test di carico (G56): utenti virtuali concorrenti con un mix realistico di richieste verso l'API.

Ogni utente virtuale riusa la sessione di un utente demo e, in ciclo, apre la lista commesse, la lista
documenti (anche con ricerca), un documento, l'URL firmato per leggerlo, le proprie notifiche e compiti;
il Project Admin apre anche il cruscotto. Alla fine stampa, per ogni endpoint, richieste, errori e
latenze p50/p95/p99, e termina con codice 1 se p95 o tasso d'errore superano le soglie.

    python infra/load/carico.py --api http://127.0.0.1:8100 --utenti 200 --durata 60 --processi 4

Un solo processo Python genera al massimo ~200 richieste/s: oltre, il limite è il generatore e non l'API.
Con --processi gli utenti si dividono su più processi e le statistiche si sommano.

Gli utenti demo esistono solo in sviluppo/staging (password in --password, default quella del seed demo).
"""
from __future__ import annotations

import argparse
import asyncio
import multiprocessing
import random
import statistics
import sys
import time
from collections import defaultdict

import httpx

DEMO_USERS = ["com.admin@com.example", "com.im@com.example", "com.dl@com.example", "des.lead@des.example",
              "des.designer@des.example", "gc.admin@gco.example", "sub1.user@sub1.example", "sub2.user@sub2.example"]
WORDS = ["pianta", "sezione", "prospetto", "tavola", "dettaglio", "relazione"]


class Stats:
    def __init__(self):
        self.lat: dict[str, list[float]] = defaultdict(list)
        self.err: dict[str, int] = defaultdict(int)
        self.kinds: dict[str, int] = defaultdict(int)

    def add(self, name: str, ms: float, ok: bool, kind: str = ""):
        self.lat[name].append(ms)
        if not ok:
            self.err[name] += 1
            self.kinds[f"{name}: {kind}"] += 1


async def call(client: httpx.AsyncClient, stats: Stats, name: str, method: str, url: str, **kw):
    t = time.perf_counter()
    try:
        r = await client.request(method, url, **kw)
        ok = r.status_code < 400 or r.status_code in (403, 404, 415)    # negazioni attese per permessi/formato
        stats.add(name, (time.perf_counter() - t) * 1000, ok, f"HTTP {r.status_code}")
        return r if r.status_code < 400 else None
    except httpx.HTTPError as e:
        stats.add(name, (time.perf_counter() - t) * 1000, False, type(e).__name__)
        return None


def login_all(api: str, password: str) -> dict[str, dict]:
    """Un login per utente, nel processo principale: il limite anti-forzatura sul login resta lontano."""
    sessions = {}
    with httpx.Client(base_url=api, timeout=30) as client:
        for email in DEMO_USERS:
            r = client.post("/auth/login", json={"email": email, "password": password})
            if r.status_code != 200 or "access_token" not in r.json():
                sys.exit(f"{email}: login non riuscito ({r.status_code}); con MFA o troppi tentativi riprovare più tardi")
            sessions[email] = {"Authorization": f"Bearer {r.json()['access_token']}"}
    return sessions


async def virtual_user(client, stats, headers, is_admin: bool, deadline: float):
    rnd = random.Random()
    while time.monotonic() < deadline:
        r = await call(client, stats, "GET /projects", "GET", "/projects", headers=headers)
        projects = (r.json() if r else [])
        projects = projects.get("items", projects) if isinstance(projects, dict) else projects
        if not projects:
            await asyncio.sleep(1)
            continue
        pid = rnd.choice(projects)["id"]
        q = f"&q={rnd.choice(WORDS)}" if rnd.random() < 0.3 else ""
        area = rnd.choice(["", "&area=SHARED", "&area=PUBLISHED"])
        r = await call(client, stats, "GET /documents (lista)", "GET", f"/projects/{pid}/documents?limit=50{area}{q}",
                       headers=headers)
        items = r.json()["items"] if r else []
        if items:
            doc = rnd.choice(items)
            await call(client, stats, "GET /documents/{id}", "GET", f"/documents/{doc['id']}", headers=headers)
            if doc.get("current_revision_id"):
                await call(client, stats, "GET /revisions/{id}/download", "GET",
                           f"/revisions/{doc['current_revision_id']}/download?disposition=inline", headers=headers)
                await call(client, stats, "GET /revisions/{id}/markups", "GET",
                           f"/revisions/{doc['current_revision_id']}/markups", headers=headers)
        await call(client, stats, "GET /notifications", "GET", "/notifications?limit=30", headers=headers)
        await call(client, stats, "GET /me/tasks", "GET", "/me/tasks?status=OPEN", headers=headers)
        if is_admin and rnd.random() < 0.2:
            await call(client, stats, "GET /dashboard", "GET", f"/projects/{pid}/dashboard", headers=headers)
        await asyncio.sleep(rnd.uniform(0.2, 1.0))          # tempo di lettura dell'utente


def pct(values: list[float], p: float) -> float:
    return statistics.quantiles(values, n=100, method="inclusive")[int(p) - 1] if len(values) > 1 else values[0]


async def run(api: str, users: int, offset: int, duration: int, sessions: dict) -> tuple[dict, dict, dict, float]:
    stats = Stats()
    limits = httpx.Limits(max_connections=users * 2, max_keepalive_connections=users)
    async with httpx.AsyncClient(base_url=api, timeout=30, limits=limits) as client:
        deadline = time.monotonic() + duration
        t0 = time.perf_counter()
        who = [DEMO_USERS[(offset + i) % len(DEMO_USERS)] for i in range(users)]
        await asyncio.gather(*(virtual_user(client, stats, sessions[u], u.startswith("com.admin"), deadline) for u in who))
        return dict(stats.lat), dict(stats.err), dict(stats.kinds), time.perf_counter() - t0


def _process(args: tuple) -> tuple[dict, dict, dict, float]:
    try:
        return asyncio.run(run(*args))
    except Exception as e:      # le eccezioni httpx non passano tra processi: si riportano come testo
        raise RuntimeError(f"{type(e).__name__}: {e}") from None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--api", default="http://127.0.0.1:8100")
    ap.add_argument("--utenti", type=int, default=50)
    ap.add_argument("--durata", type=int, default=60, help="secondi")
    ap.add_argument("--password", default="Cantiere-2026!")
    ap.add_argument("--p95-max", type=float, default=500, help="ms, soglia per endpoint")
    ap.add_argument("--errori-max", type=float, default=1.0, help="percentuale massima di errori")
    ap.add_argument("--processi", type=int, default=1, help="processi generatori (utenti divisi tra loro)")
    args = ap.parse_args()

    n = max(1, args.processi)
    shares = [args.utenti // n + (1 if i < args.utenti % n else 0) for i in range(n)]
    sessions = login_all(args.api, args.password)
    jobs = [(args.api, k, sum(shares[:i]), args.durata, sessions) for i, k in enumerate(shares) if k]
    with multiprocessing.Pool(len(jobs)) as pool:
        results = pool.map(_process, jobs)
    stats = Stats()
    for lat, err, kinds, _ in results:
        for name, values in lat.items():
            stats.lat[name].extend(values)
        for name, count in err.items():
            stats.err[name] += count
        for kind, count in kinds.items():
            stats.kinds[kind] += count
    elapsed = max(r[3] for r in results)

    total = sum(len(v) for v in stats.lat.values())
    errors = sum(stats.err.values())
    print(f"\n{args.utenti} utenti per {elapsed:.0f} s: {total} richieste ({total / elapsed:.0f}/s), errori {errors}")
    print(f"{'endpoint':<34}{'n':>7}{'err':>6}{'p50':>9}{'p95':>9}{'p99':>9}")
    failed = False
    for name, values in sorted(stats.lat.items()):
        p95 = pct(values, 95)
        failed |= p95 > args.p95_max
        print(f"{name:<34}{len(values):>7}{stats.err[name]:>6}{pct(values, 50):>8.0f}ms{p95:>7.0f}ms{pct(values, 99):>7.0f}ms"
              + ("  << oltre soglia" if p95 > args.p95_max else ""))
    for kind, count in sorted(stats.kinds.items()):
        print(f"  errore {kind} x{count}")
    rate = 100 * errors / max(total, 1)
    failed |= rate > args.errori_max
    print(f"tasso d'errore {rate:.2f}% (soglia {args.errori_max}%), p95 massimo ammesso {args.p95_max:.0f} ms")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
