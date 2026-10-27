# "><(((º> sabusabu <º)))><"
"""Comandi di sviluppo e operativi.

  cde dev            Postgres embedded + S3 emulato + migrazioni + dati demo + worker + API su :8100
  cde worker         worker Procrastinate (verifica file) — CDE_DATABASE_URL_WORKER
  cde migrate        applica le migrazioni (CDE_DATABASE_URL_OWNER)
  cde bootstrap-db   RDS: crea database e ruoli, DSN in Secrets Manager (CDE_DB_MASTER_USER/_PASSWORD)
  cde seed-demo      carica il dataset dimostrativo (CDE_DATABASE_URL_OWNER)
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
from urllib.parse import quote

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


def cmd_bootstrap_db(args) -> None:
    import boto3

    user, password = os.environ.get("CDE_DB_MASTER_USER"), os.environ.get("CDE_DB_MASTER_PASSWORD")
    if not (user and password):
        sys.exit("Impostare CDE_DB_MASTER_USER e CDE_DB_MASTER_PASSWORD")
    superuser = (f"postgresql://{quote(user)}:{quote(password)}@{args.host}:{args.port}/postgres"
                 f"?sslmode={args.sslmode}")
    sm = boto3.client("secretsmanager", region_name=os.environ.get("CDE_AWS_REGION", "eu-south-1"))
    for name in dbadmin.bootstrap_to_secrets(superuser, args.dbname, args.secret_prefix, sm):
        print("segreto aggiornato:", name)
    print("Migrazioni:", dbadmin.migrate(_dsn_from(sm, f"{args.secret_prefix}/cde_owner")) or "nessuna")


def _dsn_from(sm, secret_id: str) -> str:
    return sm.get_secret_value(SecretId=secret_id)["SecretString"]


def cmd_seed(_args) -> None:
    world = demo_seed.seed(_owner_url())
    print(f"Progetto demo {world.project_id}; password {demo_seed.DEMO_PASSWORD}")


def cmd_demo_content(args) -> None:
    from .tooling import demo_content

    sys.stdout.reconfigure(errors="replace")         # console Windows: caratteri fuori codepage
    out = demo_content.populate(args.api, args.password)
    print(f"Commessa {out['project_id']}: {out['documents']} documenti caricati")
    for err in out["errors"]:
        print("  attenzione:", err)


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
    boot = sub.add_parser("bootstrap-db", help="RDS: database, ruoli e DSN in Secrets Manager (ruota le password)")
    boot.add_argument("--host", required=True)
    boot.add_argument("--port", type=int, default=5432)
    boot.add_argument("--dbname", default="cde")
    boot.add_argument("--secret-prefix", required=True, help="es. cde-prod/db")
    boot.add_argument("--sslmode", default="verify-full")
    boot.set_defaults(func=cmd_bootstrap_db)
    sub.add_parser("seed-demo").set_defaults(func=cmd_seed)
    demo = sub.add_parser("demo-contenuti", help="cartelle e documenti demo realistici, caricati via API")
    demo.add_argument("--api", default="http://127.0.0.1:8100")
    demo.add_argument("--password", default="Cantiere-2026!", help="password degli utenti demo")
    demo.set_defaults(func=cmd_demo_content)
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
