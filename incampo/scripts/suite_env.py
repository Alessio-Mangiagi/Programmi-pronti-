"""
Prepara il .env di InCampo dentro la Suite Cosedil (lo chiamano avvia.bat e installa.bat).

    python -m scripts.suite_env

Se .env esiste non lo tocca: è la configurazione di chi l'ha scritto (anche
Postgres). Se manca lo crea per un PC o un server della suite: SQLite e
storage nella cartella dell'app, chiave JWT casuale, worker notifiche nel
processo. APP_ENV=production fa rifiutare all'app chiavi corte o segnaposto.
"""
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENV = ROOT / ".env"


def contenuto() -> str:
    return "\n".join([
        "# Creato da scripts/suite_env.py (Suite Cosedil). Modificabile a mano.",
        "APP_ENV=production",
        f"SECRET_KEY={secrets.token_hex(32)}",
        "DATABASE_URL=sqlite:///./fieldview.db",
        "STORAGE_DIR=./storage",
        "ACCESS_TOKEN_HOURS=12",
        "# Notifiche: senza SMTP_HOST le email finiscono nel log",
        "NOTIFY_WORKER=thread",
        "NOTIFY_INTERVAL=10",
        "SMTP_HOST=",
        "SMTP_PORT=587",
        "SMTP_FROM=incampo@localhost",
        "INVITE_DAYS=7",
        "# WEB_URL (base dei link in email e inviti) lo imposta avvia.bat",
        "",
    ])


def main() -> int:
    if ENV.exists():
        print(f".env presente: nessuna modifica ({ENV})")
        return 0
    ENV.write_text(contenuto(), encoding="utf-8")
    print(f"Creato {ENV} (SQLite, chiave JWT casuale)")
    return 0


if __name__ == "__main__":
    # "><(((º> sabusabu <º)))><"
    sys.exit(main())
