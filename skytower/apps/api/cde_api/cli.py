# "><(((º> sabusabu <º)))><"
"""Comandi di sviluppo e operativi.

  cde dev            Postgres embedded + S3 emulato + migrazioni + dati demo + worker + API su :8100
  cde worker         worker Procrastinate (verifica file) — CDE_DATABASE_URL_WORKER
  cde migrate        applica le migrazioni (CDE_DATABASE_URL_OWNER)
  cde seed-demo      carica il dataset dimostrativo (CDE_DATABASE_URL_OWNER)
"""
from __future__ import annotations

import argparse
import os
import sys
import threading

from .tooling import dbadmin, demo_seed

DEV_DIR = dbadmin.REPO_ROOT / ".devdata"
DEV_PASSWORDS = {"cde_owner": "dev-owner", "cde_app": "dev-app", "cde_auth": "dev-auth", "cde_worker": "dev-worker"}
DEV_S3_PORT = 9100


def _owner_url() -> str:
    url = os.environ.get("CDE_DATABASE_URL_OWNER")
    if not url:
        sys.exit("Impostare CDE_DATABASE_URL_OWNER")
    return url


def _start_dev_s3() -> str:
    """S3 emulato (moto) in memoria: i file spariscono al riavvio, il database no (usare --reset)."""
    from moto.server import ThreadedMotoServer

    for k, v in {"AWS_ACCESS_KEY_ID": "dev", "AWS_SECRET_ACCESS_KEY": "dev", "AWS_DEFAULT_REGION": "eu-south-1"}.items():
        os.environ.setdefault(k, v)
    ThreadedMotoServer(ip_address="127.0.0.1", port=DEV_S3_PORT, verbose=False).start()
    return f"http://127.0.0.1:{DEV_S3_PORT}"


def cmd_dev(args) -> None:
    import psycopg
    import uvicorn

    superuser = dbadmin.start_embedded(DEV_DIR / "pg", cleanup_mode=None)
    urls = dbadmin.bootstrap(superuser, "cde", DEV_PASSWORDS, recreate=args.reset)
    applied = dbadmin.migrate(urls.owner)
    print(f"Migrazioni applicate: {applied or 'nessuna (schema aggiornato)'}")
    with psycopg.connect(urls.owner) as conn:
        empty = conn.execute("SELECT count(*) FROM cde.organizations").fetchone()[0] == 0
    if empty:
        world = demo_seed.seed(urls.owner)
        print(f"Dati demo caricati — password per tutti: {demo_seed.DEMO_PASSWORD}")
        for key, email in world.emails.items():
            print(f"  {key:<14} {email}")

    s3 = _start_dev_s3()
    os.environ.update({
        "CDE_ENV": "dev",
        "CDE_DATABASE_URL_APP": urls.app,
        "CDE_DATABASE_URL_AUTH": urls.auth,
        "CDE_DATABASE_URL_WORKER": urls.worker,
        "CDE_LOCAL_SECRETS_DIR": str(DEV_DIR / "secrets"),
        "CDE_COOKIE_SECURE": "false",
        "CDE_REFRESH_COOKIE_PATH": "/api/auth",
        "CDE_S3_ENDPOINT_URL": s3,
    })
    from .config import get_settings
    from .storage import Storage

    get_settings.cache_clear()
    Storage(get_settings()).ensure_bucket()
    print(f"S3 emulato su {s3} (bucket {get_settings().s3_bucket})")

    if not args.no_worker:
        from .worker import run_worker

        threading.Thread(target=run_worker, name="cde-worker", daemon=True).start()
    uvicorn.run("cde_api.main:create_app", factory=True, host=args.host, port=args.port, reload=False)


def cmd_worker(_args) -> None:
    from .worker import run_worker

    run_worker()


def cmd_migrate(_args) -> None:
    print(dbadmin.migrate(_owner_url()))


def cmd_seed(_args) -> None:
    world = demo_seed.seed(_owner_url())
    print(f"Progetto demo {world.project_id}; password {demo_seed.DEMO_PASSWORD}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="cde")
    sub = parser.add_subparsers(required=True)
    dev = sub.add_parser("dev", help="ambiente locale completo")
    dev.add_argument("--host", default="127.0.0.1")
    dev.add_argument("--port", type=int, default=8100)
    dev.add_argument("--reset", action="store_true", help="ricrea il database da zero")
    dev.add_argument("--no-worker", action="store_true", help="non avviare il worker nel processo")
    dev.set_defaults(func=cmd_dev)
    sub.add_parser("worker", help="worker asincrono").set_defaults(func=cmd_worker)
    sub.add_parser("migrate").set_defaults(func=cmd_migrate)
    sub.add_parser("seed-demo").set_defaults(func=cmd_seed)
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
