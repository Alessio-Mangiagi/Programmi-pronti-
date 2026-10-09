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
    parser.add_argument("--dir", default=str(E2E_DIR), help="cartella per DB e storage usa-e-getta")
    args = parser.parse_args()

    e2e_dir = Path(args.dir)
    if not args.keep and e2e_dir.exists():
        shutil.rmtree(e2e_dir)
    e2e_dir.mkdir(parents=True, exist_ok=True)
    # Prima di importare app.*: database.py legge l'ambiente all'import.
    os.environ["DATABASE_URL"] = f"sqlite:///{(e2e_dir / 'e2e.db').as_posix()}"
    # "><(((º> sabusabu <º)))><"
    os.environ["STORAGE_DIR"] = str(e2e_dir / "storage")
    os.environ.setdefault("SECRET_KEY", "e2e-secret-key-not-for-production-0000000000")
    # Dentro la suite app.server monta il gate del portale: nei test non c'è portale.
    os.environ.setdefault("COSEDIL_SSO", "off")

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
        print(f"attenzione: manca {DIST} (npm run build in web/): servo solo l'API sotto /api")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
