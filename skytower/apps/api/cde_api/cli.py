# "><(((º> sabusabu <º)))><"
"""Comandi di sviluppo e operativi.

  cde dev            Postgres embedded + S3 emulato (salvato su disco) + migrazioni + dati demo + worker + API :8100
  cde worker         worker Procrastinate (verifica file) — CDE_DATABASE_URL_WORKER
  cde migrate        applica le migrazioni (CDE_DATABASE_URL_OWNER)
  cde bootstrap-db   RDS: crea database e ruoli, DSN in Secrets Manager (CDE_DB_MASTER_USER/_PASSWORD)
  cde seed-demo      carica il dataset dimostrativo (CDE_DATABASE_URL_OWNER)
  cde utente-dev     account personale nell'ambiente dev (password da CDE_NUOVA_PWD, mai su file)
  cde genera-ifc     modello IFC4 complesso (padiglione di sei livelli) per provare il viewer BIM
  cde genera-glb     modello glTF binario (come da Blender) per provare il viewer 3D
"""
from __future__ import annotations

import argparse
import os
import sys
import threading
from pathlib import Path
from urllib.parse import quote

from .tooling import dbadmin, demo_seed, dev_s3, personal_accounts

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
    personal = data_dir / personal_accounts.FILENAME
    superuser = dbadmin.start_embedded(data_dir / "pg", cleanup_mode=None)
    urls = dbadmin.bootstrap(superuser, "cde", DEV_PASSWORDS, recreate=False)
    personal_accounts.export(urls.owner, personal)           # anche la password cambiata dall'app
    if args.reset:
        urls = dbadmin.bootstrap(superuser, "cde", DEV_PASSWORDS, recreate=True)
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
    restored = personal_accounts.restore(urls.owner, personal)
    if restored:
        print("Account personali pronti (stessa password di sempre):", ", ".join(restored))

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
    # in sviluppo il derivato .glb si vede già con il modello demo da 4 padiglioni (2,4 MB)
    os.environ.setdefault("CDE_IFC_DERIVATIVE_MIN_BYTES", str(2 * 1024 ** 2))
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
    """Crea un account amministratore nell'ambiente `cde dev` o ne cambia la password; resta anche dopo i reset.

    La password arriva solo da CDE_NUOVA_PWD: non compare su file, nella riga di comando né nei log
    (in .devdata/account-personali.json finisce solo la sua impronta argon2, come nel database).
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
        created = personal_accounts.upsert(conn, org[0], email, args.nome, args.cognome, pwd_hash)
    personal_accounts.export(urls.owner, args.data_dir / personal_accounts.FILENAME)
    print(f"Account {email} pronto ({'creato' if created else 'password aggiornata'}), anche dopo i reset")


def cmd_ifc(args) -> None:
    from .tooling import ifc_complex

    data = ifc_complex.build(padiglioni=args.padiglioni)
    args.file.write_bytes(data)
    elements = sum(data.count(f"={e}(".encode()) for e in ("IFCWALL", "IFCSLAB", "IFCCOLUMN", "IFCBEAM", "IFCWINDOW",
                                                          "IFCDOOR", "IFCSTAIR", "IFCRAILING", "IFCROOF",
                                                          "IFCFURNISHINGELEMENT"))
    print(f"{args.file}: {len(data) / 1e6:.1f} MB, {elements} elementi, {args.padiglioni} padiglione/i")


def cmd_glb(args) -> None:
    from .tooling import glb_model

    data = glb_model.build()
    args.file.write_bytes(data)
    doc, _ = glb_model.parse(data)
    print(f"{args.file}: {len(data) / 1e3:.0f} kB, {sum('mesh' in n for n in doc['nodes'])} oggetti")


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
    ifc = sub.add_parser("genera-ifc", help="modello IFC4 complesso per provare il viewer BIM")
    ifc.add_argument("file", type=Path)
    ifc.add_argument("--padiglioni", type=int, default=1, help="edifici affiancati (prove di carico)")
    ifc.set_defaults(func=cmd_ifc)
    glb = sub.add_parser("genera-glb", help="modello glTF binario di prova (oggetti come da Blender)")
    glb.add_argument("file", type=Path)
    glb.set_defaults(func=cmd_glb)
    demo = sub.add_parser("demo-contenuti", help="cartelle e documenti demo realistici, caricati via API")
    demo.add_argument("--api", default="http://127.0.0.1:8100")
    demo.add_argument("--password", default="Cantiere-2026!", help="password degli utenti demo")
    demo.set_defaults(func=cmd_demo_content)
    args = parser.parse_args(argv)
    args.func(args)


if __name__ == "__main__":
    main()
