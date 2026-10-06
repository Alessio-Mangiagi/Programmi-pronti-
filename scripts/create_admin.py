"""
Crea il primo amministratore su un DB di produzione (vuoto, SEED_DEMO=0).

    docker compose -f docker-compose.prod.yml exec app python -m scripts.create_admin admin@azienda.it "Nome Cognome"

La password si digita a terminale (non resta nella history della shell); per
gli script si può passare con la variabile ADMIN_PASSWORD. Se l'email esiste
già non tocca nulla ed esce con codice 1.
"""
import argparse
import getpass
import os
import sys

from app import auth, models
from app.database import SessionLocal

MIN_PASSWORD = 12  # più lungo del minimo degli utenti normali: è l'account più potente


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Crea un utente admin")
    parser.add_argument("email")
    parser.add_argument("name")
    args = parser.parse_args(argv)
    email = args.email.lower().strip()

    password = os.getenv("ADMIN_PASSWORD")
    if not password:
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Ripeti password: "):
            print("Le password non coincidono", file=sys.stderr)
            return 2
    if len(password) < MIN_PASSWORD:
        print(f"Password troppo corta: almeno {MIN_PASSWORD} caratteri", file=sys.stderr)
        return 2

    with SessionLocal() as db:
        if db.query(models.User).filter(models.User.email == email).first():
            print(f"Esiste già un utente {email}: nessuna modifica", file=sys.stderr)
            return 1
        db.add(models.User(email=email, name=args.name.strip(), role=models.UserRole.admin,
                           password_hash=auth.hash_password(password)))
        db.commit()
    print(f"Admin creato: {email}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
