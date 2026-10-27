# "><(((º> sabusabu <º)))><"
"""Amministrazione database: Postgres embedded per sviluppo/test, bootstrap ruoli, migrazioni.

In AWS (RDS) il database e i ruoli li crea `cde bootstrap-db` con l'utente master, che scrive i DSN
in Secrets Manager (bootstrap_to_secrets): le password non passano mai da terminale o log.
"""
from __future__ import annotations

import secrets
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import psycopg
from psycopg import sql
from yoyo import get_backend, read_migrations

REPO_ROOT = Path(__file__).resolve().parents[4]
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"

DB_ROLES = ("cde_owner", "cde_app", "cde_auth", "cde_worker")


@dataclass(frozen=True)
class DbUrls:
    owner: str
    app: str
    auth: str
    worker: str


def start_embedded(data_dir: Path, cleanup_mode: str | None = "stop") -> str:
    """Avvia (o riaggancia) un Postgres 16 embedded e restituisce l'URI superuser."""
    import pgserver  # dipendenza solo di sviluppo

    data_dir.parent.mkdir(parents=True, exist_ok=True)
    server = pgserver.get_server(str(data_dir), cleanup_mode=cleanup_mode)
    return server.get_uri()


def with_credentials(uri: str, user: str, password: str, dbname: str) -> str:
    parts = urlsplit(uri)
    host = parts.hostname or "127.0.0.1"
    netloc = f"{quote(user)}:{quote(password)}@{host}" + (f":{parts.port}" if parts.port else "")
    return urlunsplit((parts.scheme, netloc, f"/{dbname}", parts.query, ""))


def bootstrap(superuser_uri: str, dbname: str, passwords: dict[str, str], *, recreate: bool = False) -> DbUrls:
    """Crea i ruoli applicativi e il database di proprietà di cde_owner (idempotente)."""
    with psycopg.connect(superuser_uri, autocommit=True) as conn:
        for role in DB_ROLES:
            exists = conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [role]).fetchone()
            stmt = "ALTER ROLE {} WITH LOGIN PASSWORD {}" if exists else "CREATE ROLE {} WITH LOGIN PASSWORD {}"
            conn.execute(sql.SQL(stmt).format(sql.Identifier(role), sql.Literal(passwords[role])))
        # RDS: il master non è superuser e per creare il database di cde_owner deve poterne assumere il ruolo
        if not conn.execute("SELECT rolsuper FROM pg_roles WHERE rolname = current_user").fetchone()[0]:
            conn.execute("GRANT cde_owner TO CURRENT_USER")
        # cde_owner esegue le migrazioni ma non è superuser: la RLS resta significativa per gli altri
        conn.execute("ALTER ROLE cde_app SET search_path = cde, public")
        conn.execute("ALTER ROLE cde_auth SET search_path = cde, public")
        conn.execute("ALTER ROLE cde_worker SET search_path = jobs, cde, public")

        if recreate:
            conn.execute(sql.SQL("DROP DATABASE IF EXISTS {} WITH (FORCE)").format(sql.Identifier(dbname)))
        if not conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", [dbname]).fetchone():
            conn.execute(sql.SQL("CREATE DATABASE {} OWNER cde_owner").format(sql.Identifier(dbname)))
        conn.execute(sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(sql.Identifier(dbname)))
        conn.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO cde_app, cde_auth, cde_worker").format(sql.Identifier(dbname)))

    return DbUrls(
        owner=with_credentials(superuser_uri, "cde_owner", passwords["cde_owner"], dbname),
        app=with_credentials(superuser_uri, "cde_app", passwords["cde_app"], dbname),
        auth=with_credentials(superuser_uri, "cde_auth", passwords["cde_auth"], dbname),
        worker=with_credentials(superuser_uri, "cde_worker", passwords["cde_worker"], dbname),
    )


def bootstrap_to_secrets(superuser_uri: str, dbname: str, secret_prefix: str, secretsmanager) -> list[str]:
    """Bootstrap con password casuali nuove e DSN salvati nei segreti `<prefix>/<ruolo>`.

    Rieseguirlo ruota le password: i task in esecuzione vanno riavviati per leggere i nuovi DSN.
    Restituisce i nomi dei segreti aggiornati (mai i valori)."""
    passwords = {role: secrets.token_urlsafe(32) for role in DB_ROLES}
    urls = bootstrap(superuser_uri, dbname, passwords)
    updated = []
    for role in DB_ROLES:
        name = f"{secret_prefix}/{role}"
        secretsmanager.put_secret_value(SecretId=name, SecretString=getattr(urls, role.removeprefix("cde_")))
        updated.append(name)
    return updated


def ensure_job_queue_schema(owner_uri: str) -> bool:
    """Crea lo schema della coda Procrastinate in `jobs` (una volta). True se creato ora.

    Gli aggiornamenti di versione di Procrastinate richiedono le sue migrazioni dedicate
    (`procrastinate schema --migrations-path`): da applicare come migrazione yoyo quando si aggiorna.
    """
    from procrastinate.schema import SchemaManager

    with psycopg.connect(owner_uri, autocommit=True) as conn:
        conn.execute("CREATE SCHEMA IF NOT EXISTS jobs")
        created = conn.execute("SELECT to_regclass('jobs.procrastinate_jobs') IS NULL").fetchone()[0]
        if created:
            with conn.transaction():
                conn.execute("SET LOCAL search_path = jobs")
                conn.execute(SchemaManager.get_schema())
        conn.execute("REVOKE ALL ON SCHEMA jobs FROM PUBLIC")
        conn.execute("GRANT USAGE ON SCHEMA jobs TO cde_worker")
        conn.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA jobs TO cde_worker")
        conn.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA jobs TO cde_worker")
        conn.execute("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA jobs TO cde_worker")
    return created


def migrate(owner_uri: str, migrations_dir: Path = MIGRATIONS_DIR) -> list[str]:
    """Applica le migrazioni mancanti come cde_owner. Restituisce gli id applicati."""
    ensure_job_queue_schema(owner_uri)
    backend = get_backend(owner_uri.replace("postgresql://", "postgresql+psycopg://", 1))
    migrations = read_migrations(str(migrations_dir))
    with backend.lock():
        pending = backend.to_apply(migrations)
        backend.apply_migrations(pending)
    return [m.id for m in pending]


def rollback_all(owner_uri: str, migrations_dir: Path = MIGRATIONS_DIR) -> None:
    backend = get_backend(owner_uri.replace("postgresql://", "postgresql+psycopg://", 1))
    migrations = read_migrations(str(migrations_dir))
    with backend.lock():
        backend.rollback_migrations(backend.to_rollback(migrations))
