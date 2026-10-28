# "><(((º> sabusabu <º)))><"
"""Comandi di sviluppo e operativi.

  cde dev            Postgres embedded + S3 emulato (salvato su disco) + migrazioni + dati demo + worker + API :8100
  cde worker         worker Procrastinate (verifica file) — CDE_DATABASE_URL_WORKER
  cde migrate        applica le migrazioni (CDE_DATABASE_URL_OWNER)
  cde bootstrap-db   RDS: crea database e ruoli, DSN in Secrets Manager (CDE_DB_MASTER_USER/_PASSWORD)
  cde seed-demo      carica il dataset dimostrativo (CDE_DATABASE_URL_OWNER)
  cde utente-dev     account personale nell'ambiente dev (password da CDE_NUOVA_PWD, mai su file)
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
from pathlib import Path
from urllib.parse import quote

from .tooling import dbadmin, demo_seed, dev_s3

DEV_DIR = dbadmin.REPO_ROOT / ".devdata"
DEV_PASSWORDS = {"cde_owner": "dev-owner", "cde_app": "dev-app", "cde_auth": "dev-auth", "cde_worker": "dev-worker"}
DEV_S3_PORT = 9100


def _owner_url() -> str:
    url = os.environ.get("CDE_DATABASE_URL_OWNER")
    if not url:
        sys.exit("Impostare CDE_DATABASE_URL_OWNER")
    return url


def cmd_dev(args) -> None:
    import psycopg
    import uvicorn

    data_dir = args.data_dir
    s3_state = data_dir / "s3-state.pkl"          # file dell'S3 emulato: vanno e vengono con il database
    if args.reset:
        s3_state.unlink(missing_ok=True)
    superuser = dbadmin.start_embedded(data_dir / "pg", cleanup_mode=None)
    urls = dbadmin.bootstrap(superuser, "cde", DEV_PASSWORDS, recreate=args.reset)
    applied = dbadmin.migrate(urls.owner)
    print(f"Migrazioni applicate: {applied or 'nessuna (schema aggiornato)'}")
    with psycopg.connect(urls.owner) as conn:
        empty = conn.execute("SELECT count(*) FROM cde.organizations").fetchone()[0] == 0
        orphans = not s3_state.exists() and conn.execute("SELECT EXISTS (SELECT 1 FROM cde.file_objects)").fetchone()[0]
    if orphans:
        print("ATTENZIONE: documenti nel database ma file dell'S3 emulato non salvati (versione precedente): "
              "non si apriranno. Ripartire con 'cde dev --reset'.")
    if empty:
        world = demo_seed.seed(urls.owner)
        print(f"Dati demo caricati — password per tutti: {demo_seed.DEMO_PASSWORD}")
        for key, email in world.emails.items():
            print(f"  {key:<14} {email}")

    s3 = dev_s3.start(args.s3_port, s3_state)
    os.environ.update({
        "CDE_ENV": "dev",
        "CDE_DATABASE_URL_APP": urls.app,
        "CDE_DATABASE_URL_AUTH": urls.auth,
        "CDE_DATABASE_URL_WORKER": urls.worker,
        "CDE_LOCAL_SECRETS_DIR": str(data_dir / "secrets"),
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


def cmd_dev_user(args) -> None:
    """Crea o aggiorna un account amministratore nell'ambiente `cde dev` (dopo un --reset sparisce).

    La password arriva solo da CDE_NUOVA_PWD: non compare su file, nella riga di comando né nei log.
    """
    import psycopg
    from argon2 import PasswordHasher

    from .config import get_settings
    from .errors import ApiError
    from .modules.auth import validate_password

    password, email = os.environ.get("CDE_NUOVA_PWD", ""), args.email.lower()
    if not password:
        sys.exit("Impostare CDE_NUOVA_PWD con la password dell'account")
    try:
        validate_password(password, email, get_settings().password_min_length)
    except ApiError as exc:
        sys.exit(f"Password non accettata: {exc.message}")
    if args.solo_verifica:                       # il lanciatore controlla la password prima di avviare tutto
        print("Password accettata")
        return
    superuser = dbadmin.start_embedded(args.data_dir / "pg", cleanup_mode=None)
    urls = dbadmin.bootstrap(superuser, "cde", DEV_PASSWORDS, recreate=False)
    pwd_hash = PasswordHasher().hash(password)
    with psycopg.connect(urls.owner) as conn, conn.transaction():
        org = conn.execute("SELECT id FROM cde.organizations WHERE code = %s", [args.org]).fetchone()
        if org is None:
            sys.exit(f"Organizzazione {args.org} non trovata")
        row = conn.execute("SELECT id FROM cde.users WHERE email = %s", [email]).fetchone()
        if row:
            user_id = row[0]
            conn.execute("""UPDATE cde.users SET password_hash = %s, status = 'ACTIVE', is_org_admin = true,
                                is_platform_admin = true, failed_login_count = 0, locked_until = NULL,
                                password_changed_at = now() WHERE id = %s""", [pwd_hash, user_id])
        else:
            user_id = conn.execute(
                """INSERT INTO cde.users (organization_id, email, first_name, last_name, password_hash, status,
                                          is_org_admin, is_platform_admin, password_changed_at)
                   VALUES (%s, %s, %s, %s, %s, 'ACTIVE', true, true, now()) RETURNING id""",
                [org[0], email, args.nome, args.cognome, pwd_hash]).fetchone()[0]
        # Project Admin sulle commesse dell'organizzazione
        added = conn.execute(
            """INSERT INTO cde.project_memberships (project_id, user_id, role_id)
               SELECT p.id, %s, r.id FROM cde.projects p
               JOIN cde.roles r ON r.project_id IS NULL AND r.code = 'PROJECT_ADMIN'
               WHERE p.owner_organization_id = %s
                 AND NOT EXISTS (SELECT 1 FROM cde.project_memberships m WHERE m.project_id = p.id AND m.user_id = %s)""",
            [user_id, org[0], user_id]).rowcount
    print(f"Account {email} pronto ({'aggiornato' if row else 'creato'}; Project Admin su {added} commesse nuove)")


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
    dev.add_argument("--data-dir", type=Path, default=DEV_DIR,
                     help="database e segreti (default .devdata; i test e2e ne usano uno proprio)")
    dev.add_argument("--s3-port", type=int, default=DEV_S3_PORT)
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
    user = sub.add_parser("utente-dev", help="account personale nell'ambiente dev (password da CDE_NUOVA_PWD)")
    user.add_argument("--email", required=True)
    user.add_argument("--nome", default="Utente")
    user.add_argument("--cognome", default="Personale")
    user.add_argument("--org", default="COM", help="codice dell'organizzazione")
    user.add_argument("--data-dir", type=Path, default=DEV_DIR)
    user.add_argument("--solo-verifica", action="store_true", help="controlla solo la policy della password")
    user.set_defaults(func=cmd_dev_user)
    demo = sub.add_parser("demo-contenuti", help="cartelle e documenti demo realistici, caricati via API")
    demo.add_argument("--api", default="http://127.0.0.1:8100")
    demo.add_argument("--password", default="Cantiere-2026!", help="password degli utenti demo")
    demo.set_defaults(func=cmd_demo_content)
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
