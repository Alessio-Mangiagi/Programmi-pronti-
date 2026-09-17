"""
Server per gli smoke test Playwright (web/e2e): DB SQLite e storage usa-e-getta
in web/.e2e/, migrazioni + seed demo, poi app.server (API sotto /api + web/dist).

    python -m scripts.e2e_server [--port 8001]

Lo lancia playwright.config.ts come webServer; si può usare anche a mano per
provare la build di produzione in locale senza Postgres né Docker.
"""
import argparse
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
E2E_DIR = ROOT / "web" / ".e2e"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8001)
    parser.add_argument("--keep", action="store_true", help="non azzerare DB e storage")
    args = parser.parse_args()

    if not args.keep and E2E_DIR.exists():
        shutil.rmtree(E2E_DIR)
    E2E_DIR.mkdir(parents=True, exist_ok=True)
    # Prima di importare app.*: database.py legge l'ambiente all'import.
    os.environ["DATABASE_URL"] = f"sqlite:///{(E2E_DIR / 'e2e.db').as_posix()}"
    os.environ["STORAGE_DIR"] = str(E2E_DIR / "storage")
    os.environ.setdefault("SECRET_KEY", "e2e-secret-key-not-for-production-0000000000")

    from alembic import command
    from alembic.config import Config

    cfg = Config(str(ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(ROOT / "alembic"))
    command.upgrade(cfg, "head")

    from scripts import seed
    seed.main()

    import uvicorn
    from app.server import app, DIST

    if not DIST.is_dir():
        raise SystemExit(f"manca {DIST}: esegui `npm run build` in web/")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
