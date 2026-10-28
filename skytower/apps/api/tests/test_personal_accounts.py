# "><(((º> sabusabu <º)))><"
"""Account personali di `cde dev`: salvati dal database su file e rimessi dopo che il database è stato
ricreato, con la stessa password; gli utenti demo (*.example) restano fuori."""
from __future__ import annotations

import json

import psycopg
from argon2 import PasswordHasher
from test_api_auth import login

from cde_api.tooling import personal_accounts

EMAIL = "persona.vera@studio-prova.it"
PASSWORD = "Sempre-la-stessa-42"  # noqa: S105 - password di prova del test


def test_account_personale_sopravvive_al_reset(client, api_world, tmp_path):
    urls, w = api_world
    path = tmp_path / personal_accounts.FILENAME
    with psycopg.connect(urls.owner, autocommit=True) as conn:
        assert personal_accounts.upsert(conn, w.orgs["COM"], EMAIL, "Persona", "Vera", PasswordHasher().hash(PASSWORD))
    try:
        assert login(client, EMAIL, PASSWORD).json()["status"] == "ok"
        assert personal_accounts.export(urls.owner, path) >= 1
        saved = json.loads(path.read_text(encoding="utf-8"))
        assert [a["email"] for a in saved] == [EMAIL]                  # niente utenti demo
        assert saved[0]["password_hash"].startswith("$argon2") and PASSWORD not in path.read_text(encoding="utf-8")

        # "reset": l'utente sparisce dal database (qui lo si rende irriconoscibile: gli eventi sono append-only)
        with psycopg.connect(urls.owner, autocommit=True) as conn:
            conn.execute("UPDATE cde.users SET email = 'sparito-' || id || '@x.example', status = 'DISABLED' "
                         "WHERE email = %s", [EMAIL])
        assert login(client, EMAIL, PASSWORD).status_code == 401
        assert personal_accounts.restore(urls.owner, path) == [EMAIL]
        assert login(client, EMAIL, PASSWORD).json()["status"] == "ok"   # stessa password di prima
        with psycopg.connect(urls.owner) as conn:
            assert conn.execute(
                """SELECT count(*) FROM cde.project_memberships m JOIN cde.users u ON u.id = m.user_id
                   JOIN cde.roles r ON r.id = m.role_id WHERE u.email = %s AND r.code = 'PROJECT_ADMIN'""",
                [EMAIL]).fetchone()[0] >= 1
        assert personal_accounts.restore(urls.owner, path) == [EMAIL]     # idempotente
    finally:
        with psycopg.connect(urls.owner, autocommit=True) as conn:
            conn.execute("UPDATE cde.users SET status = 'DISABLED' WHERE email = %s", [EMAIL])


def test_file_assente_o_rovinato(api_world, tmp_path):
    urls, _ = api_world
    assert personal_accounts.restore(urls.owner, tmp_path / "manca.json") == []
    broken = tmp_path / "rotto.json"
    broken.write_text("{non json", encoding="utf-8")
    assert personal_accounts.restore(urls.owner, broken) == []
