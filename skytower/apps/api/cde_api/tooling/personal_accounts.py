# "><(((º> sabusabu <º)))><"
"""Account personali dell'ambiente `cde dev`: sopravvivono a ogni ricreazione del database.

Sono gli utenti con email vera (non `*.example` dei dati demo). A ogni avvio si copiano dal database a
`.devdata/account-personali.json` (così una password cambiata dall'app vale anche dopo) e, dopo migrazioni
e dati demo, si rimettono nel database: un `--reset` non li cancella più.

Nel file c'è l'impronta argon2 della password, la stessa che sta nel database, mai la password. La cartella
dati è locale ed esclusa da git. Solo sviluppo.
"""
from __future__ import annotations

import json
import os
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

FILENAME = "account-personali.json"


def export(owner_url: str, path: Path) -> int:
    """Database → file. Gli account già nel file e assenti dal database (database appena ricreato) restano."""
    try:
        with psycopg.connect(owner_url, row_factory=dict_row) as conn:
            rows = conn.execute(
                """SELECT u.email, u.first_name, u.last_name, o.code AS org, u.password_hash,
                          u.is_org_admin, u.is_platform_admin
                   FROM cde.users u JOIN cde.organizations o ON o.id = u.organization_id
                   WHERE u.email NOT LIKE '%%.example' AND u.password_hash IS NOT NULL AND u.status = 'ACTIVE'""").fetchall()
    except psycopg.errors.UndefinedTable:          # database vuoto: niente da salvare
        return 0
    if not rows:
        return 0
    accounts = {a["email"]: a for a in _read(path)}
    accounts.update({r["email"]: r for r in rows})
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(list(accounts.values()), indent=2, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    return len(rows)


def restore(owner_url: str, path: Path) -> list[str]:
    """File → database: crea o riallinea ogni account e lo rende Project Admin delle commesse della sua org."""
    done = []
    with psycopg.connect(owner_url) as conn, conn.transaction():
        for a in _read(path):
            org = conn.execute("SELECT id FROM cde.organizations WHERE code = %s", [a["org"]]).fetchone()
            if org is None:
                continue
            upsert(conn, org[0], a["email"], a["first_name"], a["last_name"], a["password_hash"],
                   org_admin=a.get("is_org_admin", True), platform_admin=a.get("is_platform_admin", True))
            done.append(a["email"])
    return done


def upsert(conn: psycopg.Connection, org_id, email: str, first_name: str, last_name: str, password_hash: str, *,
           org_admin: bool = True, platform_admin: bool = True) -> bool:
    """Crea o aggiorna l'utente (attivo, sbloccato); True se creato."""
    row = conn.execute("SELECT id FROM cde.users WHERE email = %s", [email]).fetchone()
    if row:
        user_id = row[0]
        conn.execute("""UPDATE cde.users SET password_hash = %s, status = 'ACTIVE', is_org_admin = %s,
                            is_platform_admin = %s, failed_login_count = 0, locked_until = NULL WHERE id = %s""",
                     [password_hash, org_admin, platform_admin, user_id])
    else:
        user_id = conn.execute(
            """INSERT INTO cde.users (organization_id, email, first_name, last_name, password_hash, status,
                                      is_org_admin, is_platform_admin, password_changed_at)
               VALUES (%s, %s, %s, %s, %s, 'ACTIVE', %s, %s, now()) RETURNING id""",
            [org_id, email, first_name, last_name, password_hash, org_admin, platform_admin]).fetchone()[0]
    conn.execute(
        """INSERT INTO cde.project_memberships (project_id, user_id, role_id)
           SELECT p.id, %s, r.id FROM cde.projects p
           JOIN cde.roles r ON r.project_id IS NULL AND r.code = 'PROJECT_ADMIN'
           WHERE p.owner_organization_id = %s
             AND NOT EXISTS (SELECT 1 FROM cde.project_memberships m WHERE m.project_id = p.id AND m.user_id = %s)""",
        [user_id, org_id, user_id])
    return row is None


def _read(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
