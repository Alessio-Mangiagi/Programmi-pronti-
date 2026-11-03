# "><(((º> sabusabu <º)))><"
"""
Demo parlante: due commesse complete con tutto quello che InCampo sa fare.

    .venv\\Scripts\\python -m scripts.crea_demo            # crea (idempotente: rilanciarlo non duplica)
    .venv\\Scripts\\python -m scripts.crea_demo --rimuovi  # toglie solo la demo, lascia i dati veri

Passa dalle API dell'app (client in-process sullo stesso database e storage
dell'istanza in esecuzione), così eventi, notifiche, audit, validazioni e
transizioni dei task sono quelli veri. Tutto è riconoscibile:

- utenti demo con email ``@demo.cosedil.local`` (password unica, vedi PASSWORD);
- commesse con i codici del registro della suite (101-003, C-2024-015), così i
  collegamenti con Magazzino e SkyTower si vedono subito;
- modelli di modulo, etichette d'invito e parametri commessa con nomi fissi
  (tolti dal ``--rimuovi`` solo se non li usa nient'altro).

Cosa crea per ogni commessa: parametri, 2 cantieri con indirizzo, membri,
planimetrie disegnate (PNG), albero WBS, pin con moduli compilati (foto, firma,
GPS), non conformità aperte, task in tutti gli stati (alcuni scaduti),
inviti in attesa, una richiesta di supporto. Se SkyTower risponde e conosce la
commessa: una planimetria presa da SkyTower e un modulo inviato a SkyTower.
"""
import argparse
import io
import json
import os
import secrets
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from app import auth, models
from app import storage as st
from app.database import SessionLocal
from app.forms import validate_schema

ROOT = Path(__file__).resolve().parent.parent
DOMINIO = "demo.cosedil.local"
# Password degli utenti demo. In sviluppo è quella scritta qui (comoda, pubblica nel repository).
# Con APP_ENV=production, dove l'istanza può essere raggiunta da altri PC, vale INCAMPO_DEMO_PASSWORD
# se impostata, altrimenti una password casuale stampata una sola volta a fine caricamento: così la
# demo sull'istanza vera non apre un account admin con password nota a chiunque legga il repository.
PASSWORD = "Cantiere-2026!"
if os.getenv("APP_ENV", "dev").lower() == "production":
    PASSWORD = os.getenv("INCAMPO_DEMO_PASSWORD") or (secrets.token_urlsafe(9) + "!")
MARCA = "[DEMO]"

# (email, nome, ruolo)
UTENTI = [
    ("marta.colombo@" + DOMINIO, "Ing. Marta Colombo", "admin"),
    ("fabio.restivo@" + DOMINIO, "Geom. Fabio Restivo", "manager"),
    ("lucia.patane@" + DOMINIO, "Arch. Lucia Patanè", "manager"),
    ("salvatore.grasso@" + DOMINIO, "Salvatore Grasso", "field"),
    ("giuseppe.lopresti@" + DOMINIO, "Giuseppe Lo Presti", "field"),
]
ADMIN = UTENTI[0][0]
MANAGER = UTENTI[1][0]
DL = UTENTI[2][0]
CAPO = UTENTI[3][0]
OPERAIO = UTENTI[4][0]

PARAMETRI = [
    ("Tipologia lavori", ["Edilizia civile", "Ristrutturazione", "Nuova costruzione", "Stradale", "Impianti", "Restauro"], True),
    ("Procedura", ["Appalto pubblico", "Privato", "Subappalto"], False),
    ("Fase", ["Progettazione", "Esecuzione", "Collaudo", "Chiusa"], False),
]

COMMESSE = [
    {
        "code": "101-003", "name": "Sede Acireale", "client": "Cosedil S.p.A.",
        "params": {"Tipologia lavori": ["Edilizia civile", "Ristrutturazione", "Impianti"], "Procedura": ["Privato"], "Fase": ["Esecuzione"]},
        "cantieri": [
            {"name": "Sede Acireale - Uffici", "address": "Via Nazionale 120, 95024 Acireale (CT)", "lat": 37.6126, "lng": 15.1656,
             "plans": ["Piano terra", "Piano primo"], "wbs": "ristrutturazione"},
            {"name": "Sede Acireale - Deposito e officina", "address": "Via Nazionale 122, 95024 Acireale (CT)", "lat": 37.6128, "lng": 15.1660,
             "plans": ["Capannone"], "wbs": "deposito"},
        ],
    },
    {
        "code": "C-2024-015", "name": "Scuola Via Roma", "client": "Comune di Catania",
        "params": {"Tipologia lavori": ["Edilizia civile", "Nuova costruzione"], "Procedura": ["Appalto pubblico"], "Fase": ["Esecuzione"]},
        "cantieri": [
            {"name": "Scuola Via Roma - Corpo aule", "address": "Via Roma 45, 95124 Catania", "lat": 37.5079, "lng": 15.0830,
             "plans": ["Fondazioni", "Piano terra"], "wbs": "scuola"},
            {"name": "Scuola Via Roma - Palestra", "address": "Via Roma 45, 95124 Catania", "lat": 37.5083, "lng": 15.0835,
             "plans": ["Pianta palestra"], "wbs": "palestra"},
        ],
    },
]

# Stanze disegnate sulle planimetrie: (x0, y0, x1, y1, etichetta) in frazione del foglio
STANZE = {
    "Piano terra": [(.05, .08, .35, .45, "Reception"), (.35, .08, .65, .45, "Open space"), (.65, .08, .95, .45, "Sala riunioni"),
                    (.05, .45, .30, .92, "Archivio"), (.30, .45, .60, .92, "Uffici tecnici"), (.60, .45, .95, .92, "Servizi e locale tecnico")],
    "Piano primo": [(.05, .08, .45, .50, "Direzione"), (.45, .08, .95, .50, "Amministrazione"), (.05, .50, .55, .92, "Ufficio gare"),
                    (.55, .50, .95, .92, "Sala server")],
    "Capannone": [(.05, .08, .60, .92, "Deposito materiali"), (.60, .08, .95, .50, "Officina mezzi"), (.60, .50, .95, .92, "Carburanti e oli")],
    "Fondazioni": [(.05, .08, .95, .30, "Plinti fila A"), (.05, .35, .95, .57, "Plinti fila B"), (.05, .62, .95, .92, "Platea vano scala")],
    "Pianta palestra": [(.05, .08, .75, .92, "Campo da gioco"), (.75, .08, .95, .50, "Spogliatoi"), (.75, .50, .95, .92, "Deposito attrezzi")],
}
STANZE_SCUOLA_PT = [(.05, .08, .30, .45, "Aula 1A"), (.30, .08, .55, .45, "Aula 1B"), (.55, .08, .80, .45, "Aula 2A"), (.80, .08, .95, .45, "Bidelleria"),
                    (.05, .45, .40, .92, "Mensa"), (.40, .45, .70, .92, "Corridoio e scala"), (.70, .45, .95, .92, "Servizi")]

WBS = {
    "ristrutturazione": [("01", "Demolizioni e rimozioni", [("01.01", "Rimozione pavimenti"), ("01.02", "Demolizione tramezzi")]),
                         ("02", "Opere edili", [("02.01", "Nuovi tramezzi"), ("02.02", "Massetti e pavimenti"), ("02.03", "Controsoffitti")]),
                         ("03", "Impianti", [("03.01", "Elettrico e dati"), ("03.02", "Climatizzazione"), ("03.03", "Antincendio")]),
                         ("04", "Finiture", [("04.01", "Tinteggiature"), ("04.02", "Serramenti interni")])],
    "deposito": [("01", "Scaffalature e pavimentazione", [("01.01", "Pavimento industriale"), ("01.02", "Scaffalature")]),
                 ("02", "Impianti officina", [("02.01", "Aria compressa"), ("02.02", "Elettrico")])],
    "scuola": [("01", "Opere strutturali", [("01.01", "Scavi e fondazioni"), ("01.02", "Pilastri e travi piano terra"), ("01.03", "Solaio primo piano")]),
               ("02", "Opere architettoniche", [("02.01", "Tamponature"), ("02.02", "Intonaci"), ("02.03", "Pavimenti aule")]),
               ("03", "Impianti", [("03.01", "Elettrico"), ("03.02", "Idrico-sanitario"), ("03.03", "Riscaldamento")])],
    "palestra": [("01", "Strutture", [("01.01", "Fondazioni"), ("01.02", "Struttura in acciaio")]),
                 ("02", "Finiture sportive", [("02.01", "Pavimento sportivo"), ("02.02", "Attrezzature")])],
}

VERIFICA_GETTO = {
    "name": "Verifica getto calcestruzzo", "category": "quality",
    "schema_def": {"fields": [
        {"id": "elemento", "type": "text", "label": "Elemento gettato", "required": True, "max_length": 120},
        {"id": "data_getto", "type": "date", "label": "Data del getto", "required": True, "default": "today"},
        {"id": "classe", "type": "select", "label": "Classe calcestruzzo", "required": True, "options": ["C25/30", "C28/35", "C32/40"]},
        {"id": "consistenza", "type": "select", "label": "Classe di consistenza", "options": ["S3", "S4", "S5"], "default": "S4"},
        {"id": "mc", "type": "number", "label": "Metri cubi", "min": 0, "required": True},
        {"id": "provini", "type": "number", "label": "Provini prelevati", "integer": True, "min": 0},
        {"id": "temperatura", "type": "number", "label": "Temperatura aria (°C)", "min": -10, "max": 50},
        {"id": "esito", "type": "select", "label": "Esito", "required": True, "options": ["Conforme", "Non conforme", "Da verificare"]},
        {"id": "note", "type": "textarea", "label": "Note"},
        {"id": "foto", "type": "photo", "label": "Foto getto", "multiple": True},
        {"id": "posizione", "type": "geolocation", "label": "Posizione GPS"},
        {"id": "firma", "type": "signature", "label": "Firma DL / assistente", "required": True},
    ]},
}
NON_CONFORMITA = {
    "name": "Segnalazione non conformità", "category": "quality",
    "schema_def": {"fields": [
        {"id": "descrizione", "type": "textarea", "label": "Cosa non va", "required": True},
        {"id": "stato", "type": "select", "label": "Stato", "required": True, "options": ["Non conforme", "In correzione", "Chiusa"], "default": "Non conforme"},
        {"id": "gravita", "type": "select", "label": "Gravità", "required": True, "options": ["Bassa", "Media", "Alta"], "default": "Media"},
        {"id": "impresa", "type": "text", "label": "Impresa responsabile", "max_length": 120},
        {"id": "azione", "type": "textarea", "label": "Azione correttiva proposta"},
        {"id": "entro", "type": "date", "label": "Da risolvere entro"},
        {"id": "foto", "type": "photo", "label": "Foto", "multiple": True, "required": True},
        {"id": "firma", "type": "signature", "label": "Firma di chi segnala", "required": True},
    ]},
}
DIARIO = {
    "name": "Diario giornaliero", "category": "diary",
    "schema_def": {"fields": [
        {"id": "data", "type": "date", "label": "Data", "required": True, "default": "today"},
        {"id": "meteo", "type": "select", "label": "Meteo", "required": True, "options": ["Sereno", "Nuvoloso", "Pioggia", "Neve", "Vento forte"]},
        {"id": "operai_presenti", "type": "number", "label": "Operai presenti", "integer": True, "min": 0, "required": True},
        {"id": "imprese", "type": "multiselect", "label": "Imprese in cantiere",
         "options": ["Impresa principale", "Elettricista", "Idraulico", "Cartongessista", "Serramentista", "Altro"]},
        {"id": "lavorazioni", "type": "textarea", "label": "Lavorazioni eseguite", "required": True},
        {"id": "mezzi", "type": "textarea", "label": "Mezzi e attrezzature"},
        {"id": "note", "type": "textarea", "label": "Note / eventi"},
        {"id": "foto", "type": "photo", "label": "Foto avanzamento", "multiple": True},
        {"id": "firma", "type": "signature", "label": "Firma capocantiere", "required": True},
    ]},
}
PUNCH_LIST = {
    "name": "Punch list (difetto)", "category": "quality",
    "schema_def": {"fields": [
        {"id": "descrizione", "type": "textarea", "label": "Descrizione del difetto", "required": True},
        {"id": "categoria", "type": "select", "label": "Categoria", "required": True,
         "options": ["Strutture", "Impianti", "Finiture", "Serramenti", "Esterni", "Altro"]},
        {"id": "gravita", "type": "select", "label": "Gravità", "required": True, "options": ["Bassa", "Media", "Alta"], "default": "Media"},
        {"id": "impresa", "type": "text", "label": "Impresa responsabile", "max_length": 120},
        {"id": "foto", "type": "photo", "label": "Foto", "multiple": True, "required": True},
        {"id": "scadenza", "type": "date", "label": "Da risolvere entro"},
    ]},
}
TEMPLATE_NOMI = ("Ispezione sicurezza", VERIFICA_GETTO["name"], NON_CONFORMITA["name"], DIARIO["name"], PUNCH_LIST["name"])
ETICHETTE_INVITO = ("Direzione lavori", "Capocantiere", "Operaio di cantiere")


# --------------------------------------------------------------------------- immagini

def _font(size):
    for nome in ("arial.ttf", "DejaVuSans.ttf", "segoeui.ttf"):
        try:
            return ImageFont.truetype(nome, size)
        except OSError:
            continue
    return ImageFont.load_default()


def planimetria_png(titolo: str, stanze, w=2400, h=1600) -> bytes:
    """Planimetria disegnata: griglia, muri, nomi delle stanze, quote e cartiglio."""
    im = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(im)
    for x in range(0, w, 100):
        d.line([(x, 0), (x, h)], fill=(236, 240, 244))
    for y in range(0, h, 100):
        d.line([(0, y), (w, y)], fill=(236, 240, 244))
    f_big, f_small = _font(40), _font(26)
    for x0, y0, x1, y1, nome in stanze:
        box = (int(x0 * w), int(y0 * h), int(x1 * w), int(y1 * h))
        d.rectangle(box, outline=(30, 30, 30), width=8, fill=(250, 250, 248))
        d.text((box[0] + 24, box[1] + 20), nome, fill=(30, 30, 30), font=f_big)
        lung = round((x1 - x0) * 30, 1)   # scala finta: il foglio è 30 m
        d.text((box[0] + 24, box[3] - 50), f"{lung} m", fill=(120, 120, 120), font=f_small)
        # porta: un varco sul lato basso
        px = (box[0] + box[2]) // 2
        d.line([(px - 40, box[3]), (px + 40, box[3])], fill=(250, 250, 248), width=10)
        d.arc([px - 40, box[3] - 80, px + 40, box[3]], 180, 270, fill=(30, 30, 30), width=4)
    # cartiglio
    d.rectangle((w - 720, h - 170, w - 30, h - 30), outline=(12, 69, 119), width=5, fill="white")
    d.text((w - 700, h - 155), "COSEDIL S.p.A.", fill=(12, 69, 119), font=f_big)
    d.text((w - 700, h - 105), titolo, fill=(30, 30, 30), font=f_small)
    d.text((w - 700, h - 70), f"{MARCA} planimetria di esempio - scala 1:100", fill=(120, 120, 120), font=f_small)
    out = io.BytesIO()
    im.save(out, format="PNG", optimize=True)
    return out.getvalue()


def foto_jpeg(testo: str, seme: int = 0) -> bytes:
    """Una "foto" di cantiere: sfondo sfumato, soggetto stilizzato e didascalia."""
    w, h = 960, 720
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    base = [(120, 140, 160), (150, 130, 100), (110, 120, 110)][seme % 3]
    for y in range(h):
        k = y / h
        d.line([(0, y), (w, y)], fill=tuple(int(c * (1 - 0.5 * k) + 40 * k) for c in base))
    d.rectangle((120, 260, 840, 620), fill=(90, 90, 95), outline=(40, 40, 40), width=6)       # un muro / una struttura
    d.polygon([(120, 260), (480, 120), (840, 260)], fill=(70, 70, 75), outline=(40, 40, 40))   # una copertura
    d.rectangle((0, h - 70, w, h), fill=(0, 0, 0))
    d.text((20, h - 58), f"{testo}  ·  {MARCA}", fill="white", font=_font(30))
    out = io.BytesIO()
    im.save(out, format="JPEG", quality=70)
    return out.getvalue()


def firma_png(nome: str) -> bytes:
    """Una firma: uno scarabocchio continuo più il nome in piccolo."""
    w, h = 700, 220
    im = Image.new("RGBA", (w, h), (255, 255, 255, 0))
    d = ImageDraw.Draw(im)
    import math
    punti = []
    for i in range(0, 520, 4):
        x = 60 + i
        y = 110 + 45 * math.sin(i / 28) * math.cos(i / 90) + (hash(nome) % 17 - 8) * math.sin(i / 160)
        punti.append((x, y))
    d.line(punti, fill=(20, 30, 90, 255), width=5, joint="curve")
    d.text((60, 170), nome, fill=(90, 90, 90, 255), font=_font(22))
    out = io.BytesIO()
    im.save(out, format="PNG")
    return out.getvalue()


# --------------------------------------------------------------------------- client

class Api:
    """Il client di test di FastAPI usato come client vero: stessa app, stesso DB, stesso storage."""

    def __init__(self, client, log=print):
        self.c = client
        self.log = log
        self.token = {}

    def _h(self, email, extra=None):
        if email not in self.token:
            r = self.c.post("/auth/login", json={"email": email, "password": PASSWORD})
            if r.status_code != 200:
                raise RuntimeError(f"login {email}: {r.status_code} {r.text}")
            self.token[email] = {"Authorization": f"Bearer {r.json()['access_token']}"}
        h = dict(self.token[email])
        if extra:
            h.update(extra)
        return h

    def chiama(self, email, metodo, percorso, ok=(200, 201), **kw):
        r = getattr(self.c, metodo)(percorso, headers=self._h(email), **kw)
        if r.status_code not in ok:
            raise RuntimeError(f"{metodo.upper()} {percorso} come {email}: {r.status_code} {r.text[:400]}")
        return r.json() if r.content else None

    def get(self, email, percorso, **kw):
        return self.chiama(email, "get", percorso, **kw)

    def post(self, email, percorso, **kw):
        return self.chiama(email, "post", percorso, **kw)

    def patch(self, email, percorso, **kw):
        return self.chiama(email, "patch", percorso, **kw)


# --------------------------------------------------------------------------- creazione

def _bootstrap_admin(session_factory, log) -> None:
    """Il primo utente demo (admin) nasce direttamente nel DB: serve per fare tutto il resto dalle API."""
    with session_factory() as db:
        u = db.query(models.User).filter(models.User.email == ADMIN).first()
        if u is None:
            db.add(models.User(email=ADMIN, name=UTENTI[0][1], role=models.UserRole.admin,
                               password_hash=auth.hash_password(PASSWORD)))
            db.commit()
            log(f"creato utente admin demo {ADMIN}")
        elif not auth.verify_password(PASSWORD, u.password_hash):
            u.password_hash = auth.hash_password(PASSWORD)   # password cambiata a mano: la demo la rimette
            db.commit()


def _oggi() -> date:
    return datetime.now(timezone.utc).date()


def _iso(giorni: int) -> str:
    return (_oggi() + timedelta(days=giorni)).isoformat()


def _dt(giorni: int, ora: int = 17) -> str:
    return (datetime.combine(_oggi() + timedelta(days=giorni), datetime.min.time()) + timedelta(hours=ora)).isoformat()


def _allega(api, email, submission_id, foto: list[str] = (), firma: str | None = None, seme: int = 0, nome_firma: str = ""):
    """Crea i record degli allegati di un modulo e ne carica i byte (come fa il web)."""
    for i, (att_id, didascalia) in enumerate(foto):
        api.post(email, "/attachments", json={"id": att_id, "submission_id": submission_id, "file_type": "photo"})
        api.post(email, f"/attachments/{att_id}/upload",
                 files={"file": (f"foto-{i + 1}.jpg", foto_jpeg(didascalia, seme + i), "image/jpeg")})
    if firma:
        api.post(email, "/attachments", json={"id": firma, "submission_id": submission_id, "file_type": "signature"})
        api.post(email, f"/attachments/{firma}/upload", files={"file": ("firma.png", firma_png(nome_firma), "image/png")})


def _modulo(api, email, template_id, dati, *, pin_id=None, wbs_node_id=None, project_id=None, foto_didascalie=(), firma_di=None,
            campo_firma="firma", seme=0):
    """Compila un modulo: gli id delle foto/firma vanno nei dati, poi si caricano i file."""
    foto = [(str(uuid.uuid4()), d) for d in foto_didascalie]
    firma = str(uuid.uuid4()) if firma_di else None
    dati = dict(dati)
    if foto:
        dati["foto"] = [a for a, _ in foto]
    if firma:
        dati[campo_firma] = firma
    corpo = {"template_id": template_id, "data_json": dati}
    if pin_id:
        corpo["pin_id"] = pin_id
    elif wbs_node_id:
        corpo["wbs_node_id"] = wbs_node_id
    else:
        corpo["project_id"] = project_id
    sub = api.post(email, "/submissions", json=corpo)
    _allega(api, email, sub["id"], foto, firma, seme, firma_di or "")
    return sub


def _task(api, email, titolo, *, pin_id=None, project_id=None, submission_id=None, descrizione=None, assegna=None, scadenza=None,
          risolve=None, verifica=None):
    """Task con la storia giusta: creato (open/assigned), eventualmente risolto dall'assegnatario e verificato da un manager."""
    corpo = {"title": titolo, "description": descrizione, "assigned_to": assegna, "due_date": _dt(scadenza) if scadenza is not None else None}
    if pin_id:
        corpo["pin_id"] = pin_id
    else:
        corpo["project_id"] = project_id
    if submission_id:
        corpo["submission_id"] = submission_id
    t = api.post(email, "/tasks", json={k: v for k, v in corpo.items() if v is not None})
    if risolve:
        t = api.patch(risolve, f"/tasks/{t['id']}", json={"status": "resolved"})
    if verifica:
        t = api.patch(verifica, f"/tasks/{t['id']}", json={"status": "verified"})
    return t


def crea(client, session_factory, log=print, skytower=True) -> dict:
    """Crea la demo (idempotente). Ritorna i conteggi di quello che c'è alla fine."""
    _bootstrap_admin(session_factory, log)
    api = Api(client, log)
    esito = {"creati": {}, "esistenti": {}}

    def conta(chiave, creato):
        esito["creati" if creato else "esistenti"][chiave] = esito["creati" if creato else "esistenti"].get(chiave, 0) + 1

    # ---- utenti
    utenti = {u["email"]: u for u in api.get(ADMIN, "/users?include_inactive=true")}
    for email, nome, ruolo in UTENTI:
        if email in utenti:
            conta("utenti", False)
            continue
        utenti[email] = api.post(ADMIN, "/users", json={"email": email, "name": nome, "password": PASSWORD, "role": ruolo})
        conta("utenti", True)
    uid = {email: utenti[email]["id"] for email, _, _ in UTENTI}

    # ---- parametri commessa
    params = {p["name"]: p for p in api.get(ADMIN, "/commessa-params")}
    for nome, opzioni, multi in PARAMETRI:
        if nome not in params:
            params[nome] = api.post(ADMIN, "/commessa-params", json={"name": nome, "options": opzioni, "multi": multi})
            conta("parametri", True)
        else:
            mancanti = [o for o in opzioni if o not in params[nome]["options"]]
            if mancanti:   # un parametro già esistente (es. del seed) riceve le opzioni che usiamo
                params[nome] = api.patch(ADMIN, f"/commessa-params/{params[nome]['id']}", json={"options": params[nome]["options"] + mancanti})
            conta("parametri", False)

    # ---- modelli di modulo
    esempio = json.loads((ROOT / "form_schema_example.json").read_text(encoding="utf-8"))
    templates = {t["name"]: t for t in api.get(ADMIN, "/form-templates?include_archived=true")}
    for tpl in (esempio, VERIFICA_GETTO, NON_CONFORMITA, DIARIO, PUNCH_LIST):
        assert validate_schema(tpl["schema_def"]) == [], tpl["name"]
        if tpl["name"] not in templates:
            templates[tpl["name"]] = api.post(ADMIN, "/form-templates", json={"name": tpl["name"], "category": tpl.get("category"), "schema_def": tpl["schema_def"]})
            conta("modelli", True)
        else:
            conta("modelli", False)
    T = {n: templates[n]["id"] for n in TEMPLATE_NOMI}

    # ---- commesse e cantieri
    commesse = {c["code"]: c for c in api.get(ADMIN, "/commesse?include_archived=true")}
    for cm in COMMESSE:
        if cm["code"] not in commesse:
            commesse[cm["code"]] = api.post(ADMIN, "/commesse", json={
                "code": cm["code"], "name": cm["name"], "client": cm["client"],
                "params": {params[k]["id"]: v for k, v in cm["params"].items()}})
            conta("commesse", True)
        else:
            conta("commesse", False)
        cid = commesse[cm["code"]]["id"]
        progetti = {p["name"]: p for p in api.get(ADMIN, f"/projects?commessa_id={cid}")}
        for i, ca in enumerate(cm["cantieri"]):
            nuovo = ca["name"] not in progetti
            if nuovo:
                progetti[ca["name"]] = api.post(ADMIN, "/projects", json={"name": ca["name"], "address": ca["address"], "commessa_id": cid})
            conta("cantieri", nuovo)
            pid = progetti[ca["name"]]["id"]
            for user_id in uid.values():
                api.post(ADMIN, f"/projects/{pid}/members", json={"user_id": user_id})
            _cantiere(api, uid, T, cm, ca, pid, nuovo, conta, log)

    # ---- etichette d'invito e inviti in attesa
    etichette = {e["name"]: e for e in api.get(ADMIN, "/invite-labels?include_archived=true")}
    cids = [commesse[c["code"]]["id"] for c in COMMESSE]
    for nome, ruolo, descr in (("Direzione lavori", "manager", "DL e assistenti: vedono tutte le commesse, verificano i task"),
                               ("Capocantiere", "manager", "Responsabile di cantiere: moduli, task, diario"),
                               ("Operaio di cantiere", "field", "Compila moduli e chiude i task dei cantieri assegnati")):
        if nome not in etichette:
            etichette[nome] = api.post(ADMIN, "/invite-labels", json={"name": nome, "description": descr, "role": ruolo, "commessa_ids": cids,
                                                                      "notify_email": True, "notify_push": ruolo == "field"})
            conta("etichette invito", True)
        else:
            conta("etichette invito", False)
    inviti = {i["email"] for i in api.get(ADMIN, "/invites?include_done=true")}
    for email, nome, etichetta in (("rosario.nicolosi@" + DOMINIO, "Rosario Nicolosi", "Operaio di cantiere"),
                                   ("carmela.di.stefano@" + DOMINIO, "Carmela Di Stefano", "Direzione lavori")):
        if email not in inviti:
            api.post(ADMIN, "/invites", json={"email": email, "name": nome, "label_id": etichette[etichetta]["id"]})
            conta("inviti", True)
        else:
            conta("inviti", False)

    # ---- una richiesta di supporto dall'operaio
    if not any(m["user_id"] == uid[OPERAIO] for m in api.get(ADMIN, "/support/messages")):
        api.post(OPERAIO, "/support/messages", json={"message": f"{MARCA} Dal telefono non riesco ad allegare la seconda foto al diario: resta in attesa di sincronizzazione.",
                                                     "page": "/projects"})
        conta("richieste supporto", True)

    # ---- SkyTower, se c'è e conosce la commessa
    if skytower:
        _skytower(api, uid, T, commesse, log, conta)
    return esito


def _cantiere(api, uid, T, cm, ca, pid, nuovo, conta, log):
    """Riempie un cantiere: WBS, planimetrie con pin, moduli, non conformità, task in ogni stato."""
    # WBS
    if not api.get(ADMIN, f"/projects/{pid}/wbs"):
        for code, name, figli in WBS[ca["wbs"]]:
            radice = api.post(MANAGER, f"/projects/{pid}/wbs", json={"code": code, "name": name})
            for ccode, cname in figli:
                api.post(MANAGER, f"/projects/{pid}/wbs", json={"code": ccode, "name": cname, "parent_id": radice["id"]})
        conta("voci WBS", True)
    wbs = {n["code"]: n for n in api.get(ADMIN, f"/projects/{pid}/wbs")}

    # planimetrie
    piani = {p["name"]: p for p in api.get(ADMIN, f"/projects/{pid}/plans")}
    for nome in ca["plans"]:
        if nome in piani and piani[nome].get("file_url"):
            conta("planimetrie", False)
            continue
        if nome not in piani:
            piani[nome] = api.post(MANAGER, "/plans", json={"project_id": pid, "name": nome})
        stanze = STANZE_SCUOLA_PT if (nome == "Piano terra" and ca["wbs"] == "scuola") else STANZE[nome]
        png = planimetria_png(f"{ca['name']} - {nome}", stanze)
        piani[nome] = api.post(MANAGER, f"/plans/{piani[nome]['id']}/file", files={"file": (f"{nome}.png", png, "image/png")})
        conta("planimetrie", True)

    gps = {"lat": ca["lat"], "lng": ca["lng"], "accuracy": 8}
    prima = piani[ca["plans"][0]]
    pins = {p["label"]: p for piano in piani.values() for p in api.get(ADMIN, f"/plans/{piano['id']}/pins")}

    def pin(label, x, y, chi=CAPO, piano=None):
        piano = piano or prima
        if label in pins:
            return pins[label], False
        pins[label] = api.post(chi, "/pins", json={"plan_id": piano["id"], "x": x, "y": y, "label": label})
        conta("pin", True)
        return pins[label], True

    nomi = {e: n for e, n, _ in UTENTI}
    if ca["wbs"] in ("ristrutturazione", "deposito"):
        _cantiere_acireale(api, uid, T, ca, pid, pin, piani, wbs, gps, nomi, conta)
    else:
        _cantiere_scuola(api, uid, T, ca, pid, pin, piani, wbs, gps, nomi, conta)


def _cantiere_acireale(api, uid, T, ca, pid, pin, piani, wbs, gps, nomi, conta):
    if ca["wbs"] == "ristrutturazione":
        # 1) ispezione sicurezza non conforme sul quadro elettrico -> task assegnato all'operaio, scaduto
        p, nuovo = pin("Quadro elettrico reception", 0.20, 0.30)
        if nuovo:
            sub = _modulo(api, CAPO, T["Ispezione sicurezza"], {
                "area": "Reception, quadro elettrico generale", "esito": "Non conforme", "rischi": ["Elettrico"], "persone_presenti": 3,
                "dpi_indossati": True, "note": "Sportello del quadro aperto e cavi volanti verso la postazione provvisoria. Sospesa l'alimentazione della linea.",
                "posizione": gps, "data_ispezione": _iso(-6)}, pin_id=p["id"], foto_didascalie=["Quadro elettrico aperto"], firma_di=nomi[CAPO], campo_firma="firma_ispettore", seme=1)
            _task(api, CAPO, "Chiudere e segregare il quadro elettrico della reception", pin_id=p["id"], submission_id=sub["id"],
                  descrizione="Rimettere lo sportello, canalizzare i cavi, cartello di pericolo. Foto a fine lavoro.", assegna=uid[OPERAIO], scadenza=-2)
            conta("moduli", True)
            conta("task", True)
        # 2) verifica getto massetto: conforme, task risolto e verificato
        p, nuovo = pin("Massetto uffici tecnici", 0.45, 0.70)
        if nuovo:
            sub = _modulo(api, DL, T["Verifica getto calcestruzzo"], {
                "elemento": "Massetto alleggerito uffici tecnici, zona B", "data_getto": _iso(-12), "classe": "C25/30", "consistenza": "S4",
                "mc": 18.5, "provini": 2, "temperatura": 21, "esito": "Conforme", "note": "Getto regolare, superficie staggiata. Provini in laboratorio il " + _iso(-11) + ".",
                "posizione": gps}, pin_id=p["id"], foto_didascalie=["Getto massetto zona B", "Provini prelevati"], firma_di=nomi[DL], seme=2)
            _task(api, DL, "Ritirare i certificati dei provini del massetto", pin_id=p["id"], submission_id=sub["id"],
                  assegna=uid[CAPO], scadenza=-3, risolve=CAPO, verifica=DL)
            conta("moduli", True)
            conta("task", True)
        # 3) punch list serramento: task assegnato, risolto, in attesa di verifica
        p, nuovo = pin("Serramento sala riunioni", 0.80, 0.25)
        if nuovo:
            sub = _modulo(api, OPERAIO, T["Punch list (difetto)"], {
                "descrizione": "La finestra a nastro della sala riunioni non chiude: guarnizione fuori sede e maniglia lenta.",
                "categoria": "Serramenti", "gravita": "Media", "impresa": "Serramenti Etnea s.r.l.", "scadenza": _iso(5)},
                pin_id=p["id"], foto_didascalie=["Finestra sala riunioni"], seme=3)
            _task(api, CAPO, "Far regolare la finestra della sala riunioni al serramentista", pin_id=p["id"], submission_id=sub["id"],
                  assegna=uid[OPERAIO], scadenza=5, risolve=OPERAIO)
            conta("moduli", True)
            conta("task", True)
        # 4) non conformità aperta sul controsoffitto (piano primo) + task aperto non assegnato
        secondo = piani.get("Piano primo")
        if secondo:
            p, nuovo = pin("Controsoffitto direzione", 0.25, 0.30, piano=secondo)
            if nuovo:
                sub = _modulo(api, DL, T["Segnalazione non conformità"], {
                    "descrizione": "Pannelli del controsoffitto montati senza la struttura antisismica prevista dal capitolato (voce 02.03).",
                    "stato": "Non conforme", "gravita": "Alta", "impresa": "Cartongessi Jonica s.n.c.",
                    "azione": "Smontare i pannelli e posare la struttura sismica; nuova verifica DL prima della chiusura.", "entro": _iso(10)},
                    pin_id=p["id"], foto_didascalie=["Controsoffitto senza struttura", "Dettaglio pendini"], firma_di=nomi[DL], seme=4)
                _task(api, DL, "Rifare la struttura del controsoffitto della direzione", pin_id=p["id"], submission_id=sub["id"],
                      descrizione="Non conformità alta: fermare la posa dei pannelli fino al ripristino.", scadenza=10)
                conta("moduli", True)
                conta("task", True)
        # 5) diario giornaliero sulla voce WBS 02.01 e task di cantiere
        n = wbs.get("02.01")
        if n and not any(s["template_id"] == T["Diario giornaliero"] and s.get("wbs_node_id") == n["id"]
                         for s in api.get(ADMIN, f"/projects/{pid}/submissions")):
            _modulo(api, CAPO, T["Diario giornaliero"], {
                "data": _iso(-1), "meteo": "Sereno", "operai_presenti": 7, "imprese": ["Impresa principale", "Cartongessista", "Elettricista"],
                "lavorazioni": "Tramezzi in cartongesso uffici tecnici (lato corridoio), tracce impianto dati, rimozione pavimento archivio.",
                "mezzi": "Piattaforma aerea 12 m (nolo), 2 avvitatori, levigatrice", "note": "Consegna lastre in ritardo di un giorno, DDT 4471."},
                wbs_node_id=n["id"], foto_didascalie=["Tramezzi uffici tecnici"], firma_di=nomi[CAPO], seme=5)
            _task(api, MANAGER, "Sollecitare la consegna delle lastre in cartongesso", project_id=pid, assegna=uid[CAPO], scadenza=1)
            _task(api, MANAGER, "Programmare lo spostamento degli archivi al piano primo", project_id=pid, scadenza=14)
            conta("moduli", True)
            conta("task", True)
            conta("task", True)
    else:   # deposito e officina
        p, nuovo = pin("Scaffalatura corsia 2", 0.30, 0.50)
        if nuovo:
            sub = _modulo(api, CAPO, T["Ispezione sicurezza"], {
                "area": "Deposito materiali, corsia 2", "esito": "Conforme", "rischi": ["Movimentazione carichi"], "persone_presenti": 2,
                "dpi_indossati": True, "note": "Scaffalature ancorate, portate esposte. Carrello elevatore con revisione in regola.",
                "posizione": gps, "data_ispezione": _iso(-3)}, pin_id=p["id"], foto_didascalie=["Scaffalature corsia 2"], firma_di=nomi[CAPO],
                campo_firma="firma_ispettore", seme=6)
            conta("moduli", True)
        p, nuovo = pin("Officina - compressore", 0.78, 0.30)
        if nuovo:
            sub = _modulo(api, OPERAIO, T["Segnalazione non conformità"], {
                "descrizione": "Compressore senza valvola di sicurezza tarata; manca il libretto in officina.",
                "stato": "Non conforme", "gravita": "Media", "impresa": "Impresa principale",
                "azione": "Fermare il compressore, far tarare la valvola e ritrovare il libretto.", "entro": _iso(7)},
                pin_id=p["id"], foto_didascalie=["Compressore officina"], firma_di=nomi[OPERAIO], seme=7)
            _task(api, CAPO, "Taratura valvola compressore e libretto in officina", pin_id=p["id"], submission_id=sub["id"], assegna=uid[OPERAIO], scadenza=7)
            conta("moduli", True)
            conta("task", True)
def _cantiere_scuola(api, uid, T, ca, pid, pin, piani, wbs, gps, nomi, conta):
    if ca["wbs"] == "scuola":
        p, nuovo = pin("Plinto A3", 0.22, 0.20)
        if nuovo:
            sub = _modulo(api, DL, T["Verifica getto calcestruzzo"], {
                "elemento": "Plinto A3 fila A", "data_getto": _iso(-20), "classe": "C28/35", "consistenza": "S4", "mc": 6.2, "provini": 4,
                "temperatura": 24, "esito": "Conforme", "note": "Armatura verificata prima del getto, copriferro 4 cm.", "posizione": gps},
                pin_id=p["id"], foto_didascalie=["Getto plinto A3", "Armatura plinto A3"], firma_di=nomi[DL], seme=8)
            _task(api, DL, "Scasserare il plinto A3 e verificare le superfici", pin_id=p["id"], submission_id=sub["id"],
                  assegna=uid[CAPO], scadenza=-15, risolve=CAPO, verifica=DL)
            conta("moduli", True)
            conta("task", True)
        p, nuovo = pin("Plinto B5", 0.62, 0.46)
        if nuovo:
            sub = _modulo(api, DL, T["Verifica getto calcestruzzo"], {
                "elemento": "Plinto B5 fila B", "data_getto": _iso(-4), "classe": "C28/35", "consistenza": "S3", "mc": 6.0, "provini": 2,
                "temperatura": 19, "esito": "Non conforme", "note": "Nido di ghiaia sul lato nord, altezza 30 cm. Da ripristinare con malta a ritiro compensato.",
                "posizione": gps}, pin_id=p["id"], foto_didascalie=["Nido di ghiaia plinto B5"], firma_di=nomi[DL], seme=9)
            _task(api, DL, "Ripristino nido di ghiaia plinto B5", pin_id=p["id"], submission_id=sub["id"],
                  descrizione="Scalpellare la parte ammalorata, malta tixotropica a ritiro compensato, foto prima/dopo.", assegna=uid[CAPO], scadenza=3)
            conta("moduli", True)
            conta("task", True)
        p, nuovo = pin("Scavo vano scala", 0.50, 0.78)
        if nuovo:
            _modulo(api, CAPO, T["Ispezione sicurezza"], {
                "area": "Scavo vano scala, lato mensa", "esito": "Non conforme", "rischi": ["Scavi", "Caduta dall'alto"], "persone_presenti": 4,
                "dpi_indossati": False, "note": "Parapetto di sponda assente sul lato corto; un operaio senza casco.", "posizione": gps,
                "data_ispezione": _iso(-1)}, pin_id=p["id"], foto_didascalie=["Scavo vano scala senza parapetto"], firma_di=nomi[CAPO],
                campo_firma="firma_ispettore", seme=10)
            _task(api, CAPO, "Montare il parapetto sullo scavo del vano scala", pin_id=p["id"], assegna=uid[OPERAIO], scadenza=0)
            conta("moduli", True)
            conta("task", True)
        pt = piani.get("Piano terra")
        if pt:
            p, nuovo = pin("Aula 1B - tamponatura", 0.42, 0.25, piano=pt)
            if nuovo:
                _modulo(api, OPERAIO, T["Punch list (difetto)"], {
                    "descrizione": "Tamponatura aula 1B fuori piombo di 2 cm sul lato finestra.", "categoria": "Strutture", "gravita": "Bassa",
                    "impresa": "Impresa principale", "scadenza": _iso(12)}, pin_id=p["id"], foto_didascalie=["Tamponatura aula 1B"], seme=11)
                _task(api, MANAGER, "Rasare e riallineare la tamponatura dell'aula 1B", pin_id=p["id"], scadenza=12)
                conta("moduli", True)
                conta("task", True)
        n = wbs.get("01.02")
        if n and not any(s["template_id"] == T["Diario giornaliero"] and s.get("wbs_node_id") == n["id"]
                         for s in api.get(ADMIN, f"/projects/{pid}/submissions")):
            _modulo(api, CAPO, T["Diario giornaliero"], {
                "data": _iso(-1), "meteo": "Nuvoloso", "operai_presenti": 11, "imprese": ["Impresa principale"],
                "lavorazioni": "Casseratura pilastri P7-P12 piano terra, posa armatura travi asse 3, getto plinti fila B completato.",
                "mezzi": "Autogru 40 t (nolo), autobetoniera, pompa calcestruzzo", "note": "Pioggia prevista domani: coperti i ferri."},
                wbs_node_id=n["id"], foto_didascalie=["Casseri pilastri piano terra", "Armatura travi asse 3"], firma_di=nomi[CAPO], seme=12)
            _task(api, DL, "Convocare il collaudatore per le prove sui plinti fila A", project_id=pid, assegna=uid[DL], scadenza=6)
            conta("moduli", True)
            conta("task", True)
    else:   # palestra
        p, nuovo = pin("Platea palestra", 0.40, 0.50)
        if nuovo:
            _modulo(api, DL, T["Verifica getto calcestruzzo"], {
                "elemento": "Platea di fondazione palestra", "data_getto": _iso(-9), "classe": "C32/40", "consistenza": "S5", "mc": 85, "provini": 6,
                "temperatura": 22, "esito": "Conforme", "note": "Getto in due fasi, giunto trattato.", "posizione": gps},
                pin_id=p["id"], foto_didascalie=["Getto platea palestra"], firma_di=nomi[DL], seme=13)
            conta("moduli", True)
        _task_se_manca(api, pid, "Ordinare la struttura in acciaio della palestra (consegna in 6 settimane)", MANAGER, assegna=uid[MANAGER], scadenza=-1, conta=conta)
        _task_se_manca(api, pid, "Verificare le quote degli ancoraggi sulla platea", DL, assegna=uid[CAPO], scadenza=4, conta=conta)


def _task_se_manca(api, pid, titolo, chi, conta, **kw):
    if any(t["title"] == titolo for t in api.get(ADMIN, f"/projects/{pid}/tasks")):
        return
    _task(api, chi, titolo, project_id=pid, **kw)
    conta("task", True)


def _skytower(api, uid, T, commesse, log, conta):
    """Se SkyTower è acceso e ha un progetto con lo stesso codice: planimetria da SkyTower e modulo inviato a SkyTower."""
    sys.path.insert(0, str(ROOT.parent / "shared" / "suite"))
    try:
        import suite_link
    except ImportError:
        return
    if not suite_link.raggiungibile("skytower"):
        log("SkyTower spento: salto planimetria e modulo verso SkyTower")
        return
    try:
        note = suite_link.chiama("skytower", "GET", "/suite/commesse", timeout=5)
    except suite_link.SuiteError as e:
        log(f"SkyTower: {e.messaggio}")
        return
    codici = {suite_link.normalizza_commessa(x.get("commessa") or x.get("code") or "") for x in (note or [])}
    for cm in COMMESSE:
        if suite_link.normalizza_commessa(cm["code"]) not in codici:
            log(f"SkyTower non ha un progetto con commessa {cm['code']}: salto")
            continue
        cid = commesse[cm["code"]]["id"]
        progetti = api.get(ADMIN, f"/projects?commessa_id={cid}")
        if not progetti:
            continue
        pid = progetti[0]["id"]
        try:
            docs = api.get(ADMIN, f"/projects/{pid}/skytower/documenti")
            items = docs.get("items") if isinstance(docs, dict) else docs
            nomi = {p["name"] for p in api.get(ADMIN, f"/projects/{pid}/plans")}
            for d in items or []:
                nome = f"Da SkyTower: {d.get('title') or d.get('identifier')}"[:200]
                if nome in nomi:
                    break
                if str(d.get("content_type") or "").lower() in ("application/pdf", "image/png", "image/jpeg"):
                    api.post(ADMIN, "/plans/da-skytower", json={"project_id": pid, "revision_id": d["revision_id"], "name": nome})
                    conta("planimetrie da SkyTower", True)
                    log(f"planimetria presa da SkyTower: {nome}")
                    break
        except Exception as e:   # noqa: BLE001 - la demo non deve fermarsi per SkyTower
            log(f"planimetria da SkyTower non riuscita: {e}")
        try:
            subs = api.get(ADMIN, f"/projects/{pid}/submissions")
            sub = next((s for s in subs if s["template_id"] == T["Verifica getto calcestruzzo"]), None)
            if sub:
                r = api.post(ADMIN, f"/submissions/{sub['id']}/skytower", json={"title": f"Verifica getto - {cm['name']}"})
                conta("moduli inviati a SkyTower", True)
                log(f"modulo inviato a SkyTower: {r.get('identifier') if isinstance(r, dict) else r}")
        except Exception as e:   # noqa: BLE001
            log(f"invio modulo a SkyTower non riuscito: {e}")


# --------------------------------------------------------------------------- rimozione

def rimuovi(session_factory, storage=None, log=print) -> dict:
    """Toglie solo la demo: utenti @demo, commesse coi codici demo e tutto quello che pende da loro."""
    storage = storage or st.storage
    n = {}

    def cnt(k, v):
        n[k] = n.get(k, 0) + v

    def togli_file(url):
        if not url or not url.startswith("/files/"):
            return
        try:
            p = storage.path(url[len("/files/"):])
            if p.is_file():
                p.unlink()
        except Exception:   # noqa: BLE001
            pass

    with session_factory() as db:
        utenti = db.query(models.User).filter(models.User.email.like("%@" + DOMINIO)).all()
        uids = [u.id for u in utenti]
        commesse = db.query(models.Commessa).filter(models.Commessa.code.in_([c["code"] for c in COMMESSE])).all()
        cids = [c.id for c in commesse]
        progetti = db.query(models.Project).filter(models.Project.commessa_id.in_(cids)).all() if cids else []
        pids = [p.id for p in progetti]
        piani = db.query(models.Plan).filter(models.Plan.project_id.in_(pids)).all() if pids else []
        plan_ids = [p.id for p in piani]
        pins = db.query(models.Pin).filter(models.Pin.plan_id.in_(plan_ids)).all() if plan_ids else []
        pin_ids = [p.id for p in pins]
        wbs = db.query(models.WbsNode).filter(models.WbsNode.project_id.in_(pids)).all() if pids else []
        wbs_ids = [w.id for w in wbs]

        def q_sub():
            q = db.query(models.FormSubmission)
            cond = []
            if pin_ids:
                cond.append(models.FormSubmission.pin_id.in_(pin_ids))
            if wbs_ids:
                cond.append(models.FormSubmission.wbs_node_id.in_(wbs_ids))
            if pids:
                cond.append(models.FormSubmission.project_id.in_(pids))
            if uids:
                cond.append(models.FormSubmission.submitted_by.in_(uids))
            if not cond:
                return []
            from sqlalchemy import or_
            return q.filter(or_(*cond)).all()

        subs = q_sub()
        sub_ids = [s.id for s in subs]
        from sqlalchemy import or_
        cond_t = []
        if pin_ids:
            cond_t.append(models.Task.pin_id.in_(pin_ids))
        if pids:
            cond_t.append(models.Task.project_id.in_(pids))
        if sub_ids:
            cond_t.append(models.Task.submission_id.in_(sub_ids))
        tasks = db.query(models.Task).filter(or_(*cond_t)).all() if cond_t else []
        task_ids = [t.id for t in tasks]

        atts = []
        if sub_ids:
            atts += db.query(models.Attachment).filter(models.Attachment.submission_id.in_(sub_ids)).all()
        if task_ids:
            atts += db.query(models.Attachment).filter(models.Attachment.task_id.in_(task_ids)).all()
        for a in atts:
            togli_file(a.file_url)
            db.delete(a)
        cnt("allegati", len(atts))
        for t in tasks:
            db.delete(t)
        cnt("task", len(tasks))
        for s in subs:
            db.delete(s)
        cnt("moduli", len(subs))
        for p in pins:
            db.delete(p)
        cnt("pin", len(pins))
        for p in piani:
            togli_file(p.file_url)
            db.delete(p)
        cnt("planimetrie", len(piani))
        # WBS: prima le foglie (vincolo parent_id)
        for w in sorted(wbs, key=lambda w: 0 if w.parent_id else 1):
            db.delete(w)
        cnt("voci WBS", len(wbs))
        db.flush()

        # eventi, notifiche, audit e supporto dei cantieri demo o fatti dagli utenti demo
        ev_q = db.query(models.Event)
        cond_e = []
        if pids:
            cond_e.append(models.Event.project_id.in_(pids))
        if uids:
            cond_e.append(models.Event.actor_id.in_(uids))
        eventi = ev_q.filter(or_(*cond_e)).all() if cond_e else []
        ev_ids = [e.id for e in eventi]
        if ev_ids:
            cnt("notifiche", db.query(models.Notification).filter(models.Notification.event_id.in_(ev_ids)).delete(synchronize_session=False))
        if uids:
            cnt("notifiche", db.query(models.Notification).filter(models.Notification.user_id.in_(uids)).delete(synchronize_session=False))
        for e in eventi:
            db.delete(e)
        cnt("eventi", len(eventi))
        cond_a = []
        if pids:
            cond_a.append(models.AuditLog.project_id.in_(pids))
        if uids:
            cond_a.append(models.AuditLog.actor_id.in_(uids))
        if cond_a:
            cnt("audit", db.query(models.AuditLog).filter(or_(*cond_a)).delete(synchronize_session=False))
        if uids:
            cnt("richieste supporto", db.query(models.SupportMessage).filter(
                or_(models.SupportMessage.user_id.in_(uids), models.SupportMessage.closed_by_id.in_(uids))).delete(synchronize_session=False))
            db.query(models.PushToken).filter(models.PushToken.user_id.in_(uids)).delete(synchronize_session=False)
        if pids:
            cnt("richieste supporto", db.query(models.SupportMessage).filter(models.SupportMessage.project_id.in_(pids)).delete(synchronize_session=False))
            db.query(models.ProjectMember).filter(models.ProjectMember.project_id.in_(pids)).delete(synchronize_session=False)
        if uids:
            db.query(models.ProjectMember).filter(models.ProjectMember.user_id.in_(uids)).delete(synchronize_session=False)
        db.flush()

        # inviti ed etichette
        inviti = db.query(models.Invite).filter(models.Invite.email.like("%@" + DOMINIO)).all()
        if uids:
            inviti += [i for i in db.query(models.Invite).filter(models.Invite.invited_by_id.in_(uids)).all() if i not in inviti]
        for i in inviti:
            db.delete(i)
        cnt("inviti", len(inviti))
        db.flush()
        for nome in ETICHETTE_INVITO:
            et = db.query(models.InviteLabel).filter(models.InviteLabel.name == nome).first()
            if et is not None and not db.query(models.Invite).filter(models.Invite.label_id == et.id).first():
                db.delete(et)
                cnt("etichette invito", 1)
        for p in progetti:
            db.delete(p)
        cnt("cantieri", len(progetti))
        for c in commesse:
            db.delete(c)
        cnt("commesse", len(commesse))
        db.flush()
        # modelli e parametri: solo se non li usa più nessuno
        for nome in TEMPLATE_NOMI:
            t = db.query(models.FormTemplate).filter(models.FormTemplate.name == nome).first()
            if t is not None and not db.query(models.FormSubmission).filter(models.FormSubmission.template_id == t.id).first():
                db.delete(t)
                cnt("modelli", 1)
        for nome, _, _ in PARAMETRI:
            p = db.query(models.CommessaParam).filter(models.CommessaParam.name == nome).first()
            if p is not None and not any(p.id in (c.params or {}) for c in db.query(models.Commessa).all()):
                db.delete(p)
                cnt("parametri", 1)
        for u in utenti:
            db.delete(u)
        cnt("utenti", len(utenti))
        db.commit()
    log("rimossa la demo: " + ", ".join(f"{v} {k}" for k, v in n.items()))
    return n


# --------------------------------------------------------------------------- main

def refuse_in_production() -> None:
    if os.getenv("APP_ENV", "dev").lower() == "production" and os.getenv("SEED_ALLOW_PRODUCTION") != "1":
        raise SystemExit("APP_ENV=production: la demo crea account con password note e non parte "
                         "(SEED_ALLOW_PRODUCTION=1 per forzare).")


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Demo parlante di InCampo: crea o toglie due commesse complete")
    parser.add_argument("--rimuovi", action="store_true", help="toglie solo la demo e lascia tutto il resto")
    args = parser.parse_args(argv)
    refuse_in_production()
    if args.rimuovi:
        rimuovi(SessionLocal)
        return 0
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as client:
        esito = crea(client, SessionLocal)
    print("\nDemo pronta.")
    for k in ("creati", "esistenti"):
        if esito[k]:
            print(f"  {k}: " + ", ".join(f"{v} {n}" for n, v in esito[k].items()))
    print(f"\nLogin (password {PASSWORD}):")
    for email, nome, ruolo in UTENTI:
        print(f"  {email:40} {nome:24} {ruolo}")
    print("\nCommesse: " + ", ".join(f"{c['code']} {c['name']}" for c in COMMESSE))
    print("Per toglierla: python -m scripts.crea_demo --rimuovi")
    return 0


if __name__ == "__main__":
    sys.exit(main())
