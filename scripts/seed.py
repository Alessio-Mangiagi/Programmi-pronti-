"""
Dati demo per sviluppo e test manuali. Idempotente: rilanciarlo non duplica nulla.

    alembic upgrade head
    python -m scripts.seed

Crea:
- 3 utenti (admin / manager / field), password "demo1234"
- 1 progetto "Cantiere demo" con i 3 utenti membri
- 1 planimetria "Piano terra" con un PNG generato (griglia 2000x1400)
- 3 template: ispezione sicurezza, punch list, diario giornaliero
- 3 pin con una submission e un task ciascuno
"""
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw

from app import auth, models, storage as st
from app.database import SessionLocal
from app.forms import validate_schema

PASSWORD = "demo1234"
USERS = [
    ("admin@fieldview.local", "Admin", "admin"),
    ("manager@fieldview.local", "Maria Manager", "manager"),
    ("field@fieldview.local", "Franco Field", "field"),
]

ROOT = Path(__file__).resolve().parent.parent

PUNCH_LIST = {
    "name": "Punch list (difetto)",
    "category": "quality",
    "schema_def": {"fields": [
        {"id": "descrizione", "type": "textarea", "label": "Descrizione del difetto", "required": True},
        {"id": "categoria", "type": "select", "label": "Categoria", "required": True,
         "options": ["Strutture", "Impianti", "Finiture", "Serramenti", "Esterni", "Altro"]},
        {"id": "gravita", "type": "select", "label": "Gravità", "required": True,
         "options": ["Bassa", "Media", "Alta"], "default": "Media"},
        {"id": "impresa", "type": "text", "label": "Impresa responsabile", "max_length": 120},
        {"id": "foto", "type": "photo", "label": "Foto", "multiple": True, "required": True},
        {"id": "scadenza", "type": "date", "label": "Da risolvere entro"},
    ]},
}

DIARIO = {
    "name": "Diario giornaliero",
    "category": "daily",
    "schema_def": {"fields": [
        {"id": "data", "type": "date", "label": "Data", "required": True, "default": "today"},
        {"id": "meteo", "type": "select", "label": "Meteo", "required": True,
         "options": ["Sereno", "Nuvoloso", "Pioggia", "Neve", "Vento forte"]},
        {"id": "operai_presenti", "type": "number", "label": "Operai presenti", "integer": True, "min": 0,
         "required": True},
        {"id": "imprese", "type": "multiselect", "label": "Imprese in cantiere",
         "options": ["Impresa principale", "Elettricista", "Idraulico", "Cartongessista", "Serramentista", "Altro"]},
        {"id": "lavorazioni", "type": "textarea", "label": "Lavorazioni eseguite", "required": True},
        {"id": "mezzi", "type": "textarea", "label": "Mezzi e attrezzature"},
        {"id": "note", "type": "textarea", "label": "Note / eventi"},
        {"id": "foto", "type": "photo", "label": "Foto avanzamento", "multiple": True},
        {"id": "firma", "type": "signature", "label": "Firma capocantiere", "required": True},
    ]},
}


def plan_png(w=2000, h=1400) -> bytes:
    """Planimetria segnaposto: griglia + qualche 'stanza'."""
    im = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(im)
    for x in range(0, w, 100):
        d.line([(x, 0), (x, h)], fill=(235, 235, 235))
    for y in range(0, h, 100):
        d.line([(0, y), (w, y)], fill=(235, 235, 235))
    for box in [(100, 100, 900, 700), (900, 100, 1900, 700), (100, 700, 1900, 1300)]:
        d.rectangle(box, outline=(40, 40, 40), width=6)
    d.text((120, 120), "Ufficio", fill=(40, 40, 40))
    d.text((920, 120), "Magazzino", fill=(40, 40, 40))
    d.text((120, 720), "Capannone", fill=(40, 40, 40))
    out = io.BytesIO()
    im.save(out, format="PNG", optimize=True)
    return out.getvalue()


def get_or_create(db, model, defaults=None, **lookup):
    obj = db.query(model).filter_by(**lookup).first()
    if obj is None:
        obj = model(**lookup, **(defaults or {}))
        db.add(obj)
        db.flush()
        return obj, True
    return obj, False


def main():
    db = SessionLocal()
    try:
        users = {}
        for email, name, role in USERS:
            u, created = get_or_create(db, models.User, email=email, defaults={
                "name": name, "role": models.UserRole(role), "password_hash": auth.hash_password(PASSWORD)})
            users[role] = u
            print(("creato " if created else "esiste ") + f"utente {email} ({role})")

        project, _ = get_or_create(db, models.Project, name="Cantiere demo",
                                   defaults={"address": "Via del Cantiere 1, Milano"})
        for u in users.values():
            get_or_create(db, models.ProjectMember, project_id=project.id, user_id=u.id)

        plan, created = get_or_create(db, models.Plan, project_id=project.id, name="Piano terra")
        if created or not plan.file_url:
            png = plan_png()
            plan.file_url = st.storage.save(f"plans/{plan.id}.png", png)
            plan.width_px, plan.height_px = (float(v) for v in st.image_size(png))
            print(f"planimetria salvata in {st.storage.path(f'plans/{plan.id}.png')}")

        example = json.loads((ROOT / "form_schema_example.json").read_text(encoding="utf-8"))
        templates = {}
        for tpl in (example, PUNCH_LIST, DIARIO):
            assert validate_schema(tpl["schema_def"]) == [], tpl["name"]
            t, created = get_or_create(db, models.FormTemplate, name=tpl["name"],
                                       defaults={"category": tpl["category"], "schema_def": tpl["schema_def"]})
            templates[tpl["name"]] = t
            print(("creato " if created else "esiste ") + f"template {tpl['name']}")

        demo_pins = [
            (0.25, 0.28, "Quadro elettrico", "Ispezione sicurezza",
             {"area": "Ufficio", "esito": "Non conforme", "rischi": ["Elettrico"], "persone_presenti": 2,
              "dpi_indossati": True, "note": "Quadro aperto senza protezione", "firma_ispettore": "seed",
              "data_ispezione": "2026-09-14"},
             ("Chiudere quadro elettrico", "field")),
            (0.70, 0.30, "Serramento", "Punch list (difetto)",
             {"descrizione": "Finestra non chiude", "categoria": "Serramenti", "gravita": "Media",
              "foto": ["seed"], "scadenza": "2026-09-30"},
             ("Regolare serramento magazzino", None)),
            (0.50, 0.72, "Capannone", "Diario giornaliero",
             {"data": "2026-09-14", "meteo": "Sereno", "operai_presenti": 8,
              "imprese": ["Impresa principale", "Elettricista"],
              "lavorazioni": "Getto platea zona B", "firma": "seed"},
             ("Verificare maturazione getto", "manager")),
        ]
        for x, y, label, tpl_name, data, (task_title, assignee) in demo_pins:
            pin, created = get_or_create(db, models.Pin, plan_id=plan.id, label=label,
                                         defaults={"x": x, "y": y, "created_by": users["field"].id})
            if not created:
                continue
            db.add(models.FormSubmission(template_id=templates[tpl_name].id, pin_id=pin.id,
                                         data_json=data, submitted_by=users["field"].id))
            assigned = users[assignee].id if assignee else None
            db.add(models.Task(pin_id=pin.id, title=task_title, created_by=users["manager"].id,
                               assigned_to=assigned,
                               status=models.TaskStatus.assigned if assigned else models.TaskStatus.open))
            print(f"creato pin {label} con submission e task")

        db.commit()
        print(f"\nProgetto: {project.id}\nLogin: <email> / {PASSWORD}  ->  " +
              ", ".join(email for email, _, _ in USERS))
    finally:
        db.close()


if __name__ == "__main__":
    main()
