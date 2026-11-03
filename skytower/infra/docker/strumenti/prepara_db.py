# "><(((º> sabusabu <º)))><"
"""Prima installazione di SkyTower sul server aziendale (gira DENTRO il container "prepara").

Fa, in ordine e in modo idempotente (rilanciarlo non rompe niente):
  1. ruoli applicativi (cde_owner, cde_app, cde_auth, cde_worker) con le password del .env e database `cde`;
  2. migrazioni yoyo (db/migrations) e schema della coda Procrastinate;
  3. organizzazione dell'azienda (ORG_CODICE/ORG_NOME) se manca;
  4. primo platform admin (ADMIN_EMAIL) e, se indicato, l'account personale dell'utente: password da
     CDE_NUOVA_PWD e CDE_PWD_PERSONALE, variabili passate da installa.* dopo averle chieste a video
     (mai nel .env, mai nei log: nel DB finisce solo l'impronta argon2);
  5. volume dei segreti (/segreti: chiave master Fernet e chiave JWT, create dall'API al primo avvio)
     intestato all'utente 10001 con cui girano API e worker.

Si appoggia agli stessi strumenti del comando `cde` (tooling.dbadmin, tooling.personal_accounts), così
non duplica la logica di bootstrap usata in sviluppo e in AWS.
"""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

import psycopg
from argon2 import PasswordHasher
from cde_api.errors import ApiError
from cde_api.modules.auth import validate_password
from cde_api.tooling import dbadmin, personal_accounts

SEGRETI = Path(os.environ.get("CDE_LOCAL_SECRETS_DIR", "/segreti"))
UID_CONTAINER = 10001


def _env(nome: str, default: str = "") -> str:
    return (os.environ.get(nome) or default).strip()


def _obbligatoria(nome: str) -> str:
    v = _env(nome)
    if not v:
        sys.exit(f"Manca la variabile {nome} nel .env")
    return v


def _password_valida(password: str, email: str) -> str:
    """Stesse regole della registrazione (lunghezza minima, non uguale all'email)."""
    try:
        validate_password(password, email, int(_env("CDE_PASSWORD_MIN_LENGTH", "12")))
    except ApiError as exc:
        sys.exit(f"Password di {email} non accettata: {exc.message}")
    return PasswordHasher().hash(password)


def _organizzazione(conn: psycopg.Connection, codice: str, nome: str):
    riga = conn.execute("SELECT id FROM cde.organizations WHERE code = %s", [codice]).fetchone()
    if riga:
        return riga[0]
    org = conn.execute(
        "INSERT INTO cde.organizations (legal_name, code, mfa_required) VALUES (%s, %s, false) RETURNING id",
        [nome, codice]).fetchone()[0]
    print(f"Organizzazione {codice} ({nome}) creata")
    return org


def _account(conn: psycopg.Connection, org_id, email: str, nome: str, cognome: str, password: str) -> None:
    """Platform admin + admin dell'organizzazione: se la password manca e l'utente esiste già, non lo tocca."""
    esiste = conn.execute("SELECT 1 FROM cde.users WHERE email = %s", [email]).fetchone()
    if not password:
        print(f"{email}: {'già presente, lasciato com''è' if esiste else 'NON creato: password non fornita'}")
        return
    creato = personal_accounts.upsert(conn, org_id, email, nome, cognome, _password_valida(password, email))
    print(f"Account {email} {'creato' if creato else 'aggiornato'} (platform admin, admin di {org_id})")


def main() -> None:
    superuser = _obbligatoria("CDE_DB_SUPERUSER_URL")
    password = {ruolo: _obbligatoria(f"DB_PWD_{ruolo.split('_')[1].upper()}") for ruolo in dbadmin.DB_ROLES}

    print("1/5 ruoli e database")
    urls = dbadmin.bootstrap(superuser, "cde", password, recreate=False)

    print("2/5 migrazioni")
    applicate = dbadmin.migrate(urls.owner)
    print("   applicate:", ", ".join(applicate) if applicate else "nessuna (già aggiornato)")

    print("3/5 organizzazione e account")
    with psycopg.connect(urls.owner) as conn, conn.transaction():
        org = _organizzazione(conn, _env("ORG_CODICE", "COS"), _env("ORG_NOME", "Cosedil S.p.A."))
        _account(conn, org, _obbligatoria("ADMIN_EMAIL").lower(), _env("ADMIN_NOME", "Amministratore"),
                 _env("ADMIN_COGNOME", "SkyTower"), _env("CDE_NUOVA_PWD"))
        personale = _env("ACCOUNT_PERSONALE_EMAIL").lower()
        if personale:
            _account(conn, org, personale, _env("ACCOUNT_PERSONALE_NOME", "Utente"),
                     _env("ACCOUNT_PERSONALE_COGNOME", "Personale"), _env("CDE_PWD_PERSONALE"))

    print("4/5 cartella dei segreti")
    SEGRETI.mkdir(parents=True, exist_ok=True)
    # Il container dell'API gira come 10001 e deve poter creare master.key e jwt.pem al primo avvio
    shutil.chown(SEGRETI, user=UID_CONTAINER, group=UID_CONTAINER)
    os.chmod(SEGRETI, 0o700)
    for f in SEGRETI.iterdir():
        shutil.chown(f, user=UID_CONTAINER, group=UID_CONTAINER)
        os.chmod(f, 0o600)

    print("5/5 fatto: avvia il resto con  docker compose up -d")


if __name__ == "__main__":
    main()
