import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Per iniziare: sqlite locale. In produzione, impostate la variabile d'ambiente:
#   DATABASE_URL="postgresql://user:password@localhost/fieldview"
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
