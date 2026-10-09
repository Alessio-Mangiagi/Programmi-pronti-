import os
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def _load_dotenv(path: Path = Path(".env")) -> None:
    """Carica .env senza dipendenze: KEY=VALUE per riga, le variabili già
    presenti nell'ambiente vincono."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


_load_dotenv()

# Sviluppo: sqlite locale. Produzione (vedi docker-compose.yml / .env.example):
#   DATABASE_URL="postgresql+psycopg://user:password@localhost/fieldview"
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./fieldview.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
