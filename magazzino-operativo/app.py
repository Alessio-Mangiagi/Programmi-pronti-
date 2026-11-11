# "><(((º> sabusabu <º)))><"
"""Magazzino Operativo Cosedil — server Flask.

Dove sta il materiale e quanto ce n'è, dove stanno i mezzi: si scansiona il
codice a barre e si vede. Il materiale entra dai DDT del Lettore DDT, i mezzi
a nolo dalle pratiche di VFP Transfer; il resto (scarichi, trasferimenti,
rettifiche, mezzi propri) si registra a mano o dalla pagina di scansione.

Avvio: python app.py (o avvia.bat). API JSON sotto /api, pagina unica in /.
Dal 09/11/2026 è una parte del programma unico "DDT e Magazzino": lo avvia il Lettore DDT e
gli utenti lo vedono sotto <Lettore DDT>/magazzino/ (proxy, prefisso.py; CONTRATTI § 11).
"""
import json
import logging
import os
import sqlite3
import sys
import threading
import time
import traceback
from datetime import date, timedelta

from flask import Flask, Response, g, jsonify, render_template, request, send_file, redirect
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

import codici
import config
import database
import foto
import importa_ddt
import importa_mezzi
import backup
import prefisso
import riepilogo
import statistiche

# Codice condiviso della suite (cartelle sorelle, non pacchetti installati).
_SHARED = os.path.join(config.SUITE_DIR, "shared")
sys.path.insert(0, os.path.join(_SHARED, "sso"))
sys.path.insert(0, os.path.join(_SHARED, "avvisi"))
import avvisi  # noqa: E402
import cosedil_sso  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("magazzino")

app = Flask(__name__, template_folder="templates", static_folder="static")
app.config["MAX_CONTENT_LENGTH"] = config.UPLOAD_MAX_BYTE
avvisi.collega_log("magazzino")
# /api/suite/: rotte per le altre app della suite, protette dal token di servizio (suite_rotte.py), non dal cookie.
# /health: il Lettore DDT la interroga per sapere se deve avviare il Magazzino (CONTRATTI § 11, C1).
# Due id: il Magazzino si apre dentro il programma unico "DDT e Magazzino" (09/11/2026) e lo usa
# chi nel portale è abilitato a "magazzino" O a "ddt" (cosedil_sso, più id provati in ordine).
cosedil_sso.init(app, app_id=("magazzino", "ddt"), percorsi_liberi=("/api/suite/", "/health"))
if not cosedil_sso.ENABLED:
    # senza gate ogni richiesta è "sviluppo" e admin: va bene sul PC di chi sviluppa, mai su un server
    log.warning("COSEDIL_SSO=off: Magazzino senza login, tutti amministratori. Solo per sviluppo locale.")
if os.environ.get("SUITE_DOMINIO", "").strip():
    # dietro il Caddy della suite l'IP vero del client sta in X-Forwarded-For (un solo proxy davanti);
    # senza proxy l'header lo scriverebbe il client e non va creduto, quindi il ProxyFix resta spento
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
# Dentro il programma unico il Lettore DDT inoltra /magazzino/* qui (prefisso.py): il prefisso, la
# commessa di sessione e l'IP vero arrivano in intestazioni, credute solo da loopback. Va FUORI dal
# ProxyFix (montato per ultimo = eseguito per primo): deve vedere l'indirizzo vero del socket.
app.wsgi_app = prefisso.Prefisso(app.wsgi_app)

TIPI_UBICAZIONE = ("deposito", "cantiere", "officina", "fornitore", "altro")
STATI_MEZZO = ("disponibile", "in_uso", "manutenzione", "fermo", "restituito")
TIPI_MOVIMENTO = ("carico", "scarico", "trasferimento", "rettifica", "inventario")


# --------------------------------------------------------------------------- utente e permessi

def utente_corrente():
    v = g.get("cosedil")
    if v:
        return v
    if not cosedil_sso.ENABLED:
        return {"username": "sviluppo", "nome": "Sviluppo locale", "admin": True}
    return None


def nome_utente():
    u = utente_corrente() or {}
    return u.get("username") or u.get("nome") or "?"


def registra(azione, oggetto=None, oggetto_id=None, descrizione=""):
    """Una riga nel registro attività: chi (utente del portale, IP) ha fatto cosa.
    Il commit lo fa chi chiama, dentro la stessa transazione dell'azione."""
    db().execute(
        "INSERT INTO attivita (utente, ip, azione, oggetto, oggetto_id, descrizione) VALUES (?, ?, ?, ?, ?, ?)",
        (nome_utente(), (request.remote_addr or "")[:45], azione, oggetto, oggetto_id, (descrizione or "")[:300]))


# Chi è collegato adesso: la pagina manda un battito ogni 30 s con la vista aperta.
# In memoria e non su disco: vale solo finché il server gira.
_presenze = {}
_lock_presenze = threading.Lock()


def e_admin():
    """Admin del Magazzino. Con SSO spento (sviluppo) si è sempre admin.

    - Amministratore del portale (ruolo "admin" in utenti.json, letto fresco da /api/verify): admin anche
      qui, sempre, anche se MAGAZZINO_ADMIN è impostata e non lo nomina. Regola della suite del
      09/11/2026 ("le mie credenziali valgono come admin ovunque"), ribadita l'11/11/2026 (il profilo
      del portale vale in ogni programma; gli admin li crea e li toglie solo il proprietario, nel
      portale). Prima l'elenco MAGAZZINO_ADMIN escludeva anche lui; lo Scadenzario aveva già l'eccezione.
    - Admin dell'app concesso dal portale in altro modo (regole IP di data/ip-admin.json): admin solo se
      compare in config.ADMIN_UTENTI, quando l'elenco è impostato (come prima)."""
    if not cosedil_sso.ENABLED:
        return True
    u = utente_corrente()
    if not u or not u.get("admin"):
        return False
    if u.get("ruolo") == "admin":
        return True
    return not config.ADMIN_UTENTI or (u.get("username") or "").lower() in config.ADMIN_UTENTI


@app.before_request
def gate_admin():
    if not request.path.startswith("/api"):
        return None
    # l'upload di un JSON di importazione riscrive giacenze e anagrafiche: solo l'amministratore
    riservata = (request.method == "DELETE" or request.path.startswith("/api/admin")
                 or request.path == "/api/importazioni/upload")
    if riservata and not e_admin():
        return jsonify({"errore": "Operazione riservata all'amministratore del magazzino"}), 403
    return None


# --------------------------------------------------------------------------- errori e db

class ApiError(Exception):
    def __init__(self, messaggio, status=400):
        super().__init__(messaggio)
        self.messaggio, self.status = messaggio, status


@app.errorhandler(ApiError)
def _err_api(e):
    return jsonify({"errore": e.messaggio}), e.status


@app.errorhandler(RequestEntityTooLarge)
def _err_grande(_e):
    return jsonify({"errore": "File troppo grande"}), 413


@app.errorhandler(HTTPException)
def _err_http(e):
    if request.path.startswith("/api"):
        return jsonify({"errore": e.description}), e.code
    return e


# Nomi leggibili dei campi che possono collidere (vincoli UNIQUE di database.py), per il messaggio all'utente.
CAMPI_UNICI = {"codice": "codice", "codice_esterno": "codice esterno (EAN)", "targa": "targa", "matricola": "matricola",
               "nome": "nome"}


def messaggio_integrita(e):
    """Testo per l'utente da un errore di vincolo SQLite (il testo grezzo, es. "UNIQUE constraint failed:
    articoli.codice_esterno", resta nel log: la guida del 04/11 lo aveva trovato a vista)."""
    testo = str(e)
    if "UNIQUE" in testo:
        campo = testo.rsplit(".", 1)[-1].strip() if "." in testo else ""
        return f"Esiste già un elemento con lo stesso {CAMPI_UNICI.get(campo, 'valore')}: controlla e cambialo."
    if "FOREIGN KEY" in testo:
        return "L'elemento collegato non esiste più (articolo, mezzo o ubicazione): ricarica la pagina e riprova."
    if "NOT NULL" in testo:
        return "Manca un dato obbligatorio: compila tutti i campi richiesti."
    return "Dato non accettato dal database: controlla i valori e riprova."


@app.errorhandler(sqlite3.IntegrityError)
def _err_integrita(e):
    log.warning("vincolo del database su %s: %s", request.path, e)
    return jsonify({"errore": messaggio_integrita(e)}), 409


@app.errorhandler(Exception)
def _err_generico(e):
    log.error("errore non gestito su %s: %s\n%s", request.path, e, traceback.format_exc())
    return jsonify({"errore": "Errore interno"}), 500


def db():
    if "db" not in g:
        g.db = database.get_db()
    return g.db


@app.teardown_appcontext
def _chiudi_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def corpo():
    d = request.get_json(silent=True)
    if not isinstance(d, dict):
        raise ApiError("Corpo JSON mancante o non valido")
    return d


def testo(d, campo, obbligatorio=False, maxlen=200):
    v = str(d.get(campo) or "").strip()
    if obbligatorio and not v:
        raise ApiError(f"Campo obbligatorio: {campo}")
    return v[:maxlen] or None


def numero(d, campo, obbligatorio=False, positivo=False):
    v = d.get(campo)
    if v in (None, ""):
        if obbligatorio:
            raise ApiError(f"Campo obbligatorio: {campo}")
        return None
    n = importa_ddt.numero_it(v) if isinstance(v, str) else float(v)
    if n is None:
        raise ApiError(f"Numero non valido: {campo}")
    if positivo and n <= 0:
        raise ApiError(f"{campo} deve essere maggiore di zero")
    return n


def intero(d, campo, obbligatorio=False):
    v = d.get(campo)
    if v in (None, ""):
        if obbligatorio:
            raise ApiError(f"Campo obbligatorio: {campo}")
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        raise ApiError(f"Valore non valido: {campo}")


def scelta(d, campo, valori, default=None):
    v = str(d.get(campo) or default or "").strip()
    if v not in valori:
        raise ApiError(f"{campo} deve essere uno tra: {', '.join(valori)}")
    return v


def righe(cur):
    return [dict(r) for r in cur.fetchall()]


def esiste(tabella, id_):
    if id_ is None:
        return None
    r = db().execute(f"SELECT id FROM {tabella} WHERE id = ?", (id_,)).fetchone()
    if not r:
        raise ApiError(f"{tabella[:-1].capitalize()} {id_} non trovato", 404)
    return id_


# --------------------------------------------------------------------------- info

@app.get("/api/health")
def api_health():
    return jsonify({"ok": True, "app": "magazzino", "data": date.today().isoformat()})


@app.get("/health")
def health():
    """Salute senza login (fuori dal gate): la usa il Lettore DDT per sapere se il Magazzino è acceso
    prima di avviarlo (programma unico, CONTRATTI § 11, C1). Non dice niente dei dati."""
    return jsonify({"ok": True, "app": "magazzino"})


def info_pagina():
    """Dove e come la pagina è aperta: base dei link (prefisso del programma unico, '' alla radice),
    commessa scelta all'accesso nel programma unico (X-Suite-Commessa) e indirizzo della parte DDT."""
    base = prefisso.base(request.environ)
    unico = prefisso.programma_unico(request.environ)
    # la parte DDT del programma unico sta "sopra" il prefisso: /magazzino -> /, /x/magazzino -> /x/
    ddt = (base.rsplit("/", 1)[0] + "/") if unico else ""
    return {"base": base, "unico": unico, "commessa": prefisso.commessa_sessione(request.environ), "ddt": ddt}


@app.get("/api/me")
def api_me():
    u = utente_corrente() or {}
    return jsonify({"username": u.get("username"), "nome": u.get("nome"), "admin": e_admin(),
                    "qr": codici.segno is not None, **info_pagina()})


@app.get("/api/dashboard")
def api_dashboard():
    c = db()
    uno = lambda sql, *p: c.execute(sql, p).fetchone()[0]  # noqa: E731
    sotto_scorta = righe(c.execute(
        "SELECT a.id, a.codice, a.descrizione, a.um, a.scorta_minima, COALESCE(SUM(g.quantita), 0) AS totale "
        "FROM articoli a LEFT JOIN giacenze g ON g.articolo_id = a.id "
        "WHERE a.attivo = 1 AND a.scorta_minima IS NOT NULL GROUP BY a.id HAVING totale < a.scorta_minima "
        "ORDER BY a.descrizione LIMIT 20"))
    ultimi = righe(c.execute(
        "SELECT m.id, m.ts, m.tipo, m.quantita, m.riferimento, m.origine, a.codice, a.descrizione, a.um, "
        "ud.nome AS da_nome, ua.nome AS a_nome FROM movimenti m JOIN articoli a ON a.id = m.articolo_id "
        "LEFT JOIN ubicazioni ud ON ud.id = m.da_ubicazione_id LEFT JOIN ubicazioni ua ON ua.id = m.a_ubicazione_id "
        "ORDER BY m.id DESC LIMIT 10"))
    per_ubicazione = righe(c.execute(
        "SELECT u.id, u.nome, u.tipo, COUNT(DISTINCT CASE WHEN g.quantita > 0 THEN g.articolo_id END) AS articoli, "
        "(SELECT COUNT(*) FROM mezzi m WHERE m.ubicazione_id = u.id AND m.attivo = 1 AND m.stato <> 'restituito') AS mezzi "
        "FROM ubicazioni u LEFT JOIN giacenze g ON g.ubicazione_id = u.id WHERE u.attivo = 1 "
        "GROUP BY u.id ORDER BY u.tipo = 'deposito' DESC, u.nome"))
    ultima = c.execute("SELECT ts, sorgente, esito FROM importazioni ORDER BY id DESC LIMIT 1").fetchone()
    return jsonify({
        "articoli": uno("SELECT COUNT(*) FROM articoli WHERE attivo = 1"),
        "mezzi": uno("SELECT COUNT(*) FROM mezzi WHERE attivo = 1 AND stato <> 'restituito'"),
        "ubicazioni": uno("SELECT COUNT(*) FROM ubicazioni WHERE attivo = 1"),
        "movimenti_oggi": uno("SELECT COUNT(*) FROM movimenti WHERE date(ts) = date('now')"),
        "sotto_scorta": sotto_scorta,
        "ultimi_movimenti": ultimi,
        "per_ubicazione": per_ubicazione,
        "ultima_importazione": dict(ultima) if ultima else None,
    })


# --------------------------------------------------------------------------- scansione

def dettaglio_articolo(c, id_):
    a = c.execute("SELECT * FROM articoli WHERE id = ?", (id_,)).fetchone()
    if not a:
        raise ApiError("Articolo non trovato", 404)
    giac = righe(c.execute(
        "SELECT g.ubicazione_id, u.nome AS ubicazione, u.tipo, u.indirizzo, u.lat, u.lng, g.quantita, g.ultimo_movimento "
        "FROM giacenze g JOIN ubicazioni u ON u.id = g.ubicazione_id WHERE g.articolo_id = ? AND g.quantita <> 0 "
        "ORDER BY g.quantita DESC", (id_,)))
    # codice, descrizione e unità di misura dell'articolo anche qui: la tabella dei movimenti le usa per la quantità
    # ("12 pz"); prima mancavano e la colonna Quantità restava senza unità (guida 04/11)
    mov = righe(c.execute(
        "SELECT m.*, a.codice, a.descrizione, a.um, ud.nome AS da_nome, ua.nome AS a_nome FROM movimenti m "
        "JOIN articoli a ON a.id = m.articolo_id "
        "LEFT JOIN ubicazioni ud ON ud.id = m.da_ubicazione_id LEFT JOIN ubicazioni ua ON ua.id = m.a_ubicazione_id "
        "WHERE m.articolo_id = ? ORDER BY m.id DESC LIMIT 20", (id_,)))
    return {"tipo": "articolo", "articolo": dict(a), "giacenze": giac,
            "totale": sum(r["quantita"] for r in giac), "movimenti": mov}


def dettaglio_mezzo(c, id_):
    m = c.execute(
        "SELECT m.*, u.nome AS ubicazione, u.indirizzo AS ubicazione_indirizzo, u.lat AS ubicazione_lat, "
        "u.lng AS ubicazione_lng, u.commessa AS ubicazione_commessa FROM mezzi m LEFT JOIN ubicazioni u ON u.id = m.ubicazione_id WHERE m.id = ?",
        (id_,)).fetchone()
    if not m:
        raise ApiError("Mezzo non trovato", 404)
    storico = righe(c.execute(
        "SELECT s.*, ud.nome AS da_nome, ua.nome AS a_nome FROM movimenti_mezzi s "
        "LEFT JOIN ubicazioni ud ON ud.id = s.da_ubicazione_id LEFT JOIN ubicazioni ua ON ua.id = s.a_ubicazione_id "
        "WHERE s.mezzo_id = ? ORDER BY s.id DESC LIMIT 20", (id_,)))
    return {"tipo": "mezzo", "mezzo": dict(m), "storico": storico, "foto": _foto_mezzo(c, id_)}


def dettaglio_ubicazione(c, id_):
    u = c.execute("SELECT * FROM ubicazioni WHERE id = ?", (id_,)).fetchone()
    if not u:
        raise ApiError("Ubicazione non trovata", 404)
    giac = righe(c.execute(
        "SELECT g.articolo_id, a.codice, a.descrizione, a.um, g.quantita FROM giacenze g "
        "JOIN articoli a ON a.id = g.articolo_id WHERE g.ubicazione_id = ? AND g.quantita <> 0 ORDER BY a.descrizione",
        (id_,)))
    mezzi = righe(c.execute(
        "SELECT id, codice, tipo_mezzo, marca, modello, targa, stato FROM mezzi WHERE ubicazione_id = ? AND attivo = 1 "
        "ORDER BY tipo_mezzo", (id_,)))
    return {"tipo": "ubicazione", "ubicazione": dict(u), "giacenze": giac, "mezzi": mezzi}


@app.get("/api/scansione")
def api_scansione():
    codice = request.args.get("codice", "")
    c = db()
    esito = codici.risolvi(c, codice)
    if not esito:
        # Ultima spiaggia: ricerca testuale, per chi digita invece di scansionare.
        q = f"%{codice.strip()}%"
        art = righe(c.execute(
            "SELECT id, codice, descrizione, um FROM articoli WHERE attivo = 1 AND (descrizione LIKE ? OR codice LIKE ?) "
            "ORDER BY descrizione LIMIT 8", (q, q)))
        mez = righe(c.execute(
            "SELECT id, codice, tipo_mezzo, marca, modello, targa FROM mezzi WHERE attivo = 1 AND "
            "(tipo_mezzo LIKE ? OR targa LIKE ? OR matricola LIKE ? OR codice LIKE ?) ORDER BY tipo_mezzo LIMIT 8",
            (q, q, q, q)))
        return jsonify({"tipo": None, "codice": codice, "suggerimenti": {"articoli": art, "mezzi": mez}}), 404
    registra("scansione", esito["tipo"], esito["id"], codici.normalizza_codice(codice))
    c.commit()
    if esito["tipo"] == "articolo":
        return jsonify(dettaglio_articolo(c, esito["id"]))
    if esito["tipo"] == "mezzo":
        return jsonify(dettaglio_mezzo(c, esito["id"]))
    return jsonify(dettaglio_ubicazione(c, esito["id"]))


# --------------------------------------------------------------------------- ubicazioni

@app.get("/api/ubicazioni")
def api_ubicazioni():
    tutte = request.args.get("tutte") == "1"
    return jsonify(righe(db().execute(
        "SELECT u.*, (SELECT COUNT(*) FROM giacenze g WHERE g.ubicazione_id = u.id AND g.quantita > 0) AS articoli, "
        "(SELECT COUNT(*) FROM mezzi m WHERE m.ubicazione_id = u.id AND m.attivo = 1) AS mezzi "
        "FROM ubicazioni u " + ("" if tutte else "WHERE u.attivo = 1 ") + "ORDER BY u.tipo = 'deposito' DESC, u.nome")))


def _dati_ubicazione(d):
    lat, lng = numero(d, "lat"), numero(d, "lng")
    if (lat is None) != (lng is None):
        raise ApiError("Latitudine e longitudine vanno insieme")
    if lat is not None and not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ApiError("Coordinate fuori intervallo")
    return {"nome": testo(d, "nome", True, 120), "tipo": scelta(d, "tipo", TIPI_UBICAZIONE, "cantiere"),
            "commessa": testo(d, "commessa", maxlen=80), "indirizzo": testo(d, "indirizzo"),
            "lat": lat, "lng": lng,
            "note": testo(d, "note", maxlen=500), "attivo": 0 if d.get("attivo") in (0, False, "0") else 1}


@app.post("/api/ubicazioni")
def api_ubicazione_crea():
    d = _dati_ubicazione(corpo())
    c = db()
    d["codice"] = codici.prossimo_codice(c, "ubicazioni", config.PREFISSO_UBICAZIONE)
    cur = c.execute("INSERT INTO ubicazioni (codice, nome, tipo, commessa, indirizzo, lat, lng, note, attivo) "
                    "VALUES (:codice, :nome, :tipo, :commessa, :indirizzo, :lat, :lng, :note, :attivo)", d)
    registra("crea", "ubicazione", cur.lastrowid, d["nome"])
    c.commit()
    return jsonify(dict(c.execute("SELECT * FROM ubicazioni WHERE id = ?", (cur.lastrowid,)).fetchone())), 201


@app.put("/api/ubicazioni/<int:id_>")
def api_ubicazione_aggiorna(id_):
    esiste("ubicazioni", id_)
    d = _dati_ubicazione(corpo())
    d["id"] = id_
    c = db()
    c.execute("UPDATE ubicazioni SET nome=:nome, tipo=:tipo, commessa=:commessa, indirizzo=:indirizzo, lat=:lat, "
              "lng=:lng, note=:note, attivo=:attivo WHERE id=:id", d)
    registra("modifica", "ubicazione", id_, d["nome"])
    c.commit()
    return jsonify(dict(c.execute("SELECT * FROM ubicazioni WHERE id = ?", (id_,)).fetchone()))


@app.delete("/api/ubicazioni/<int:id_>")
def api_ubicazione_elimina(id_):
    esiste("ubicazioni", id_)
    c = db()
    usata = c.execute("SELECT 1 FROM movimenti WHERE da_ubicazione_id = ? OR a_ubicazione_id = ? LIMIT 1",
                      (id_, id_)).fetchone() or c.execute("SELECT 1 FROM mezzi WHERE ubicazione_id = ? LIMIT 1",
                                                          (id_,)).fetchone()
    if usata:
        c.execute("UPDATE ubicazioni SET attivo = 0 WHERE id = ?", (id_,))
        registra("disattiva", "ubicazione", id_)
        c.commit()
        return jsonify({"ok": True, "disattivata": True,
                        "messaggio": "Ubicazione con movimenti o mezzi: disattivata, non cancellata"})
    c.execute("DELETE FROM ubicazioni WHERE id = ?", (id_,))
    registra("elimina", "ubicazione", id_)
    c.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- articoli

@app.get("/api/articoli")
def api_articoli():
    q = (request.args.get("q") or "").strip()
    tutti = request.args.get("tutti") == "1"
    sql = ("SELECT a.*, COALESCE((SELECT SUM(quantita) FROM giacenze g WHERE g.articolo_id = a.id), 0) AS totale "
           "FROM articoli a WHERE 1=1 ")
    p = []
    if not tutti:
        sql += "AND a.attivo = 1 "
    if q:
        sql += "AND (a.descrizione LIKE ? OR a.codice LIKE ? OR a.codice_esterno LIKE ? OR a.categoria LIKE ?) "
        p += [f"%{q}%"] * 4
    sql += "ORDER BY a.descrizione LIMIT 500"
    return jsonify(righe(db().execute(sql, p)))


def _dati_articolo(d):
    descr = testo(d, "descrizione", True, 200)
    return {"descrizione": descr, "descrizione_norm": codici.normalizza(descr),
            "um": testo(d, "um", maxlen=10) or "pz", "codice_esterno": codici.normalizza_codice(d.get("codice_esterno")) or None,
            "categoria": testo(d, "categoria", maxlen=60), "fornitore": testo(d, "fornitore", maxlen=120),
            "scorta_minima": numero(d, "scorta_minima"), "note": testo(d, "note", maxlen=500),
            "attivo": 0 if d.get("attivo") in (0, False, "0") else 1}


@app.post("/api/articoli")
def api_articolo_crea():
    d = _dati_articolo(corpo())
    c = db()
    d["codice"] = codici.prossimo_codice(c, "articoli", config.PREFISSO_ARTICOLO)
    cur = c.execute(
        "INSERT INTO articoli (codice, codice_esterno, descrizione, descrizione_norm, um, categoria, fornitore, "
        "scorta_minima, note, attivo) VALUES (:codice, :codice_esterno, :descrizione, :descrizione_norm, :um, "
        ":categoria, :fornitore, :scorta_minima, :note, :attivo)", d)
    registra("crea", "articolo", cur.lastrowid, d["descrizione"])
    c.commit()
    return jsonify(dict(c.execute("SELECT * FROM articoli WHERE id = ?", (cur.lastrowid,)).fetchone())), 201


@app.put("/api/articoli/<int:id_>")
def api_articolo_aggiorna(id_):
    esiste("articoli", id_)
    d = _dati_articolo(corpo())
    d["id"] = id_
    c = db()
    c.execute("UPDATE articoli SET codice_esterno=:codice_esterno, descrizione=:descrizione, "
              "descrizione_norm=:descrizione_norm, um=:um, categoria=:categoria, fornitore=:fornitore, "
              "scorta_minima=:scorta_minima, note=:note, attivo=:attivo WHERE id=:id", d)
    registra("modifica", "articolo", id_, d["descrizione"])
    c.commit()
    return jsonify(dict(c.execute("SELECT * FROM articoli WHERE id = ?", (id_,)).fetchone()))


@app.delete("/api/articoli/<int:id_>")
def api_articolo_elimina(id_):
    esiste("articoli", id_)
    c = db()
    if c.execute("SELECT 1 FROM movimenti WHERE articolo_id = ? LIMIT 1", (id_,)).fetchone():
        c.execute("UPDATE articoli SET attivo = 0 WHERE id = ?", (id_,))
        registra("disattiva", "articolo", id_)
        c.commit()
        return jsonify({"ok": True, "disattivato": True, "messaggio": "Articolo con movimenti: disattivato"})
    c.execute("DELETE FROM articoli WHERE id = ?", (id_,))
    registra("elimina", "articolo", id_)
    c.commit()
    return jsonify({"ok": True})


@app.get("/api/articoli/<int:id_>")
def api_articolo(id_):
    return jsonify(dettaglio_articolo(db(), id_))


# --------------------------------------------------------------------------- giacenze e movimenti

@app.get("/api/giacenze")
def api_giacenze():
    q = (request.args.get("q") or "").strip()
    ubi = request.args.get("ubicazione_id")
    sql = ("SELECT g.articolo_id, g.ubicazione_id, g.quantita, g.ultimo_movimento, a.codice, a.descrizione, a.um, "
           "a.categoria, a.scorta_minima, u.nome AS ubicazione, u.tipo AS ubicazione_tipo "
           "FROM giacenze g JOIN articoli a ON a.id = g.articolo_id JOIN ubicazioni u ON u.id = g.ubicazione_id "
           "WHERE g.quantita <> 0 ")
    p = []
    if q:
        sql += "AND (a.descrizione LIKE ? OR a.codice LIKE ? OR u.nome LIKE ?) "
        p += [f"%{q}%"] * 3
    if ubi:
        sql += "AND g.ubicazione_id = ? "
        p.append(int(ubi))
    sql += "ORDER BY a.descrizione, u.nome LIMIT 1000"
    return jsonify(righe(db().execute(sql, p)))


@app.get("/api/movimenti")
def api_movimenti():
    sql = ("SELECT m.*, a.codice, a.descrizione, a.um, ud.nome AS da_nome, ua.nome AS a_nome FROM movimenti m "
           "JOIN articoli a ON a.id = m.articolo_id LEFT JOIN ubicazioni ud ON ud.id = m.da_ubicazione_id "
           "LEFT JOIN ubicazioni ua ON ua.id = m.a_ubicazione_id WHERE 1=1 ")
    p = []
    for campo, col in (("articolo_id", "m.articolo_id = ?"), ("tipo", "m.tipo = ?"), ("origine", "m.origine = ?"),
                       ("utente", "m.utente = ?"), ("data", "m.data = ?")):
        v = request.args.get(campo)
        if v:
            sql += f"AND {col} "
            p.append(v)
    ubi = request.args.get("ubicazione_id")
    if ubi:
        sql += "AND (m.da_ubicazione_id = ? OR m.a_ubicazione_id = ?) "
        p += [int(ubi), int(ubi)]
    q = (request.args.get("q") or "").strip()
    if q:
        sql += "AND (a.descrizione LIKE ? OR m.riferimento LIKE ? OR m.fornitore LIKE ?) "
        p += [f"%{q}%"] * 3
    sql += "ORDER BY m.id DESC LIMIT ?"
    p.append(min(int(request.args.get("limite") or 200), 2000))
    return jsonify(righe(db().execute(sql, p)))


@app.post("/api/movimenti")
def api_movimento_crea():
    d = corpo()
    c = db()
    tipo = scelta(d, "tipo", TIPI_MOVIMENTO)
    art = esiste("articoli", intero(d, "articolo_id", True))
    da = esiste("ubicazioni", intero(d, "da_ubicazione_id"))
    a = esiste("ubicazioni", intero(d, "a_ubicazione_id"))
    origine = scelta(d, "origine", ("manuale", "scansione"), "manuale")
    if tipo == "carico":
        qta, da = numero(d, "quantita", True, True), None
        if not a:
            raise ApiError("Il carico vuole un'ubicazione di arrivo")
    elif tipo == "scarico":
        qta, a = numero(d, "quantita", True, True), None
        if not da:
            raise ApiError("Lo scarico vuole un'ubicazione di partenza")
    elif tipo == "trasferimento":
        qta = numero(d, "quantita", True, True)
        if not da or not a or da == a:
            raise ApiError("Il trasferimento vuole partenza e arrivo diversi")
    elif tipo == "rettifica":
        # quantità con segno: +5 aggiunge, -5 toglie, nell'ubicazione indicata
        qta = numero(d, "quantita", True)
        ubi = a or da
        if not ubi or qta == 0:
            raise ApiError("La rettifica vuole un'ubicazione e una quantità diversa da zero")
        da, a = (None, ubi) if qta > 0 else (ubi, None)
        qta = abs(qta)
    else:  # inventario: la quantità è il conteggio reale, il movimento è la differenza
        conteggio = numero(d, "quantita", True)
        ubi = a or da
        if not ubi or conteggio < 0:
            raise ApiError("L'inventario vuole un'ubicazione e un conteggio")
        r = c.execute("SELECT quantita FROM giacenze WHERE articolo_id = ? AND ubicazione_id = ?",
                      (art, ubi)).fetchone()
        delta = conteggio - (r["quantita"] if r else 0)
        if abs(delta) < 1e-9:
            return jsonify({"ok": True, "invariato": True, "messaggio": "Giacenza già uguale al conteggio"})
        da, a = (None, ubi) if delta > 0 else (ubi, None)
        qta = abs(delta)
    if tipo in ("scarico", "trasferimento"):
        r = c.execute("SELECT quantita FROM giacenze WHERE articolo_id = ? AND ubicazione_id = ?",
                      (art, da)).fetchone()
        disponibile = r["quantita"] if r else 0
        if qta > disponibile + 1e-9 and not d.get("forza"):
            # messaggio per chi usa la pagina (che chiede "Registrare comunque?" e rimanda con forza=true);
            # la parola "insufficiente" è quella che la pagina riconosce: non cambiarla
            um = c.execute("SELECT um FROM articoli WHERE id = ?", (art,)).fetchone()["um"] or ""
            dove = c.execute("SELECT nome FROM ubicazioni WHERE id = ?", (da,)).fetchone()["nome"]
            raise ApiError(f"Giacenza insufficiente in {dove}: disponibili {disponibile:g} {um}".rstrip()
                           + f", richiesti {qta:g}.")
    cur = c.execute(
        "INSERT INTO movimenti (data, tipo, articolo_id, quantita, da_ubicazione_id, a_ubicazione_id, riferimento, "
        "fornitore, origine, utente, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (testo(d, "data", maxlen=10), tipo, art, qta, da, a, testo(d, "riferimento", maxlen=120),
         testo(d, "fornitore", maxlen=120), origine, nome_utente(), testo(d, "note", maxlen=500)))
    nomi = {u["id"]: u["nome"] for u in c.execute("SELECT id, nome FROM ubicazioni WHERE id IN (?, ?)", (da or 0, a or 0))}
    registra("movimento", "articolo", art,
             f"{tipo} {qta:g} " + " ".join(x for x in (f"da {nomi.get(da)}" if da else "", f"a {nomi.get(a)}" if a else "") if x))
    c.commit()
    return jsonify({"ok": True, "id": cur.lastrowid, **dettaglio_articolo(c, art)}), 201


@app.delete("/api/movimenti/<int:id_>")
def api_movimento_elimina(id_):
    esiste("movimenti", id_)
    c = db()
    m = c.execute("SELECT tipo, quantita, articolo_id FROM movimenti WHERE id = ?", (id_,)).fetchone()
    c.execute("DELETE FROM movimenti WHERE id = ?", (id_,))
    registra("elimina_movimento", "articolo", m["articolo_id"], f"{m['tipo']} {m['quantita']:g} (movimento {id_})")
    c.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- mezzi

@app.get("/api/mezzi")
def api_mezzi():
    q = (request.args.get("q") or "").strip()
    tutti = request.args.get("tutti") == "1"
    sql = ("SELECT m.*, u.nome AS ubicazione, "
           "(SELECT id FROM foto_mezzi f WHERE f.mezzo_id = m.id ORDER BY f.principale DESC, f.id DESC LIMIT 1) AS foto_id, "
           "(SELECT COUNT(*) FROM foto_mezzi f WHERE f.mezzo_id = m.id) AS n_foto "
           "FROM mezzi m LEFT JOIN ubicazioni u ON u.id = m.ubicazione_id WHERE 1=1 ")
    p = []
    if not tutti:
        sql += "AND m.attivo = 1 "
    if q:
        sql += "AND (m.tipo_mezzo LIKE ? OR m.marca LIKE ? OR m.modello LIKE ? OR m.targa LIKE ? OR m.matricola LIKE ? OR m.codice LIKE ? OR m.ditta LIKE ?) "
        p += [f"%{q}%"] * 7
    for campo in ("stato", "proprieta"):
        v = request.args.get(campo)
        if v:
            sql += f"AND m.{campo} = ? "
            p.append(v)
    sql += "ORDER BY m.tipo_mezzo, m.marca LIMIT 500"
    return jsonify(righe(db().execute(sql, p)))


def _dati_mezzo(d):
    return {"tipo_mezzo": testo(d, "tipo_mezzo", True, 80), "marca": testo(d, "marca", maxlen=60),
            "modello": testo(d, "modello", maxlen=60), "targa": codici.normalizza_codice(d.get("targa")) or None,
            "matricola": testo(d, "matricola", maxlen=60), "proprieta": scelta(d, "proprieta", ("proprio", "nolo"), "proprio"),
            "ditta": testo(d, "ditta", maxlen=120), "piva": testo(d, "piva", maxlen=16),
            "nolo_dal": testo(d, "nolo_dal", maxlen=10), "nolo_al": testo(d, "nolo_al", maxlen=10),
            "note": testo(d, "note", maxlen=500), "attivo": 0 if d.get("attivo") in (0, False, "0") else 1}


@app.post("/api/mezzi")
def api_mezzo_crea():
    d0 = corpo()
    d = _dati_mezzo(d0)
    c = db()
    d["codice"] = codici.prossimo_codice(c, "mezzi", config.PREFISSO_MEZZO)
    d["stato"] = scelta(d0, "stato", STATI_MEZZO, "disponibile")
    d["ubicazione_id"] = esiste("ubicazioni", intero(d0, "ubicazione_id"))
    cur = c.execute(
        "INSERT INTO mezzi (codice, tipo_mezzo, marca, modello, targa, matricola, proprieta, ditta, piva, nolo_dal, "
        "nolo_al, stato, ubicazione_id, note, attivo) VALUES (:codice, :tipo_mezzo, :marca, :modello, :targa, "
        ":matricola, :proprieta, :ditta, :piva, :nolo_dal, :nolo_al, :stato, :ubicazione_id, :note, :attivo)", d)
    if d["ubicazione_id"]:
        c.execute("INSERT INTO movimenti_mezzi (mezzo_id, a_ubicazione_id, stato, utente, note) VALUES (?, ?, ?, ?, ?)",
                  (cur.lastrowid, d["ubicazione_id"], d["stato"], nome_utente(), "Registrazione in anagrafica"))
    registra("crea", "mezzo", cur.lastrowid, d["tipo_mezzo"])
    c.commit()
    return jsonify(dettaglio_mezzo(c, cur.lastrowid)), 201


@app.put("/api/mezzi/<int:id_>")
def api_mezzo_aggiorna(id_):
    esiste("mezzi", id_)
    d = _dati_mezzo(corpo())
    d["id"] = id_
    c = db()
    c.execute("UPDATE mezzi SET tipo_mezzo=:tipo_mezzo, marca=:marca, modello=:modello, targa=:targa, "
              "matricola=:matricola, proprieta=:proprieta, ditta=:ditta, piva=:piva, nolo_dal=:nolo_dal, "
              "nolo_al=:nolo_al, note=:note, attivo=:attivo WHERE id=:id", d)
    registra("modifica", "mezzo", id_, d["tipo_mezzo"])
    c.commit()
    return jsonify(dettaglio_mezzo(c, id_))


@app.post("/api/mezzi/<int:id_>/sposta")
def api_mezzo_sposta(id_):
    esiste("mezzi", id_)
    d = corpo()
    c = db()
    m = c.execute("SELECT ubicazione_id, stato, assegnato_a FROM mezzi WHERE id = ?", (id_,)).fetchone()
    a = esiste("ubicazioni", intero(d, "a_ubicazione_id"))
    stato = scelta(d, "stato", STATI_MEZZO, m["stato"])
    # "In uso da": chi ha il mezzo. Si azzera quando il mezzo non è più in uso.
    assegnato = testo(d, "assegnato_a", maxlen=80) if "assegnato_a" in d else m["assegnato_a"]
    if stato != "in_uso":
        assegnato = None
    if a is None and stato == m["stato"] and assegnato == m["assegnato_a"]:
        raise ApiError("Indicare una nuova ubicazione, un nuovo stato o chi lo usa")
    nuova_ubi = a if a is not None else m["ubicazione_id"]
    c.execute("UPDATE mezzi SET ubicazione_id = ?, stato = ?, assegnato_a = ? WHERE id = ?",
              (nuova_ubi, stato, assegnato, id_))
    nota = testo(d, "note", maxlen=500)
    if assegnato and assegnato != m["assegnato_a"]:
        nota = f"in uso da {assegnato}" + (f" · {nota}" if nota else "")
    c.execute(
        "INSERT INTO movimenti_mezzi (mezzo_id, da_ubicazione_id, a_ubicazione_id, stato, origine, utente, note) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (id_, m["ubicazione_id"], nuova_ubi, stato, scelta(d, "origine", ("manuale", "scansione"), "manuale"),
         nome_utente(), nota))
    nome_ubi = c.execute("SELECT nome FROM ubicazioni WHERE id = ?", (nuova_ubi,)).fetchone()
    registra("sposta", "mezzo", id_, f"{stato}" + (f" a {nome_ubi['nome']}" if nome_ubi else "") + (f", in uso da {assegnato}" if assegnato else ""))
    c.commit()
    return jsonify(dettaglio_mezzo(c, id_))


@app.get("/api/mezzi/<int:id_>")
def api_mezzo(id_):
    return jsonify(dettaglio_mezzo(db(), id_))


@app.delete("/api/mezzi/<int:id_>")
def api_mezzo_elimina(id_):
    esiste("mezzi", id_)
    c = db()
    c.execute("DELETE FROM movimenti_mezzi WHERE mezzo_id = ?", (id_,))
    c.execute("DELETE FROM foto_mezzi WHERE mezzo_id = ?", (id_,))
    foto.elimina_tutte(id_)
    c.execute("DELETE FROM mezzi WHERE id = ?", (id_,))
    registra("elimina", "mezzo", id_)
    c.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- foto dei mezzi

def _foto_mezzo(c, mezzo_id):
    return righe(c.execute(
        "SELECT id, mezzo_id, file, nome_originale, larghezza, altezza, byte, principale, nota, utente, caricato_il "
        "FROM foto_mezzi WHERE mezzo_id = ? ORDER BY principale DESC, id DESC", (mezzo_id,)))


@app.get("/api/mezzi/<int:id_>/foto")
def api_mezzo_foto_lista(id_):
    esiste("mezzi", id_)
    return jsonify(_foto_mezzo(db(), id_))


@app.post("/api/mezzi/<int:id_>/foto")
def api_mezzo_foto_carica(id_):
    """Una o più foto (campo multipart `foto`, ripetibile). Opzionale `nota`."""
    esiste("mezzi", id_)
    files = [f for f in request.files.getlist("foto") if f and f.filename]
    if not files:
        raise ApiError("Nessuna foto")
    if len(files) > config.FOTO_MAX_PER_CARICO:
        raise ApiError(f"Al massimo {config.FOTO_MAX_PER_CARICO} foto per volta")
    nota = (request.form.get("nota") or "").strip()[:200] or None
    c = db()
    ha_principale = c.execute("SELECT 1 FROM foto_mezzi WHERE mezzo_id = ? AND principale = 1", (id_,)).fetchone()
    salvate, errori = [], []
    for f in files:
        try:
            info = foto.salva(id_, f.read(), f.filename)
        except foto.FotoError as e:
            errori.append({"file": f.filename, "errore": str(e)})
            continue
        principale = 0 if ha_principale else 1
        ha_principale = True
        cur = c.execute(
            "INSERT INTO foto_mezzi (mezzo_id, file, nome_originale, larghezza, altezza, byte, principale, nota, utente) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (id_, info["file"], os.path.basename(f.filename)[:120], info["larghezza"], info["altezza"], info["byte"],
             principale, nota, nome_utente()))
        salvate.append(cur.lastrowid)
    if salvate:
        registra("foto", "mezzo", id_, f"{len(salvate)} foto caricate")
    c.commit()
    if not salvate:
        raise ApiError("Nessuna foto salvata: " + "; ".join(f"{e['file']}: {e['errore']}" for e in errori))
    return jsonify({"ok": True, "salvate": salvate, "errori": errori, "foto": _foto_mezzo(c, id_)}), 201


@app.get("/api/mezzi/<int:id_>/foto/<int:fid>")
def api_mezzo_foto_file(id_, fid):
    r = db().execute("SELECT file FROM foto_mezzi WHERE id = ? AND mezzo_id = ?", (fid, id_)).fetchone()
    p = r and foto.percorso(id_, r["file"], miniatura=request.args.get("dim") == "min")
    if not p:
        raise ApiError("Foto non trovata", 404)
    return send_file(p, mimetype="image/jpeg", max_age=3600, conditional=True)


@app.post("/api/mezzi/<int:id_>/foto/<int:fid>/principale")
def api_mezzo_foto_principale(id_, fid):
    c = db()
    if not c.execute("SELECT 1 FROM foto_mezzi WHERE id = ? AND mezzo_id = ?", (fid, id_)).fetchone():
        raise ApiError("Foto non trovata", 404)
    c.execute("UPDATE foto_mezzi SET principale = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE mezzo_id = ?", (fid, id_))
    c.commit()
    return jsonify({"ok": True, "foto": _foto_mezzo(c, id_)})


@app.delete("/api/mezzi/<int:id_>/foto/<int:fid>")
def api_mezzo_foto_elimina(id_, fid):
    c = db()
    r = c.execute("SELECT file, principale FROM foto_mezzi WHERE id = ? AND mezzo_id = ?", (fid, id_)).fetchone()
    if not r:
        raise ApiError("Foto non trovata", 404)
    c.execute("DELETE FROM foto_mezzi WHERE id = ?", (fid,))
    foto.elimina(id_, r["file"])
    if r["principale"]:
        c.execute("UPDATE foto_mezzi SET principale = 1 WHERE id = (SELECT MAX(id) FROM foto_mezzi WHERE mezzo_id = ?)",
                  (id_,))
    registra("elimina_foto", "mezzo", id_, r["file"])
    c.commit()
    return jsonify({"ok": True, "foto": _foto_mezzo(c, id_)})


# --------------------------------------------------------------------------- importazioni

_lock_import = threading.Lock()
# Stato del ciclo di importazione, letto dalla pagina Importazioni (polling):
# cosa sta girando adesso, quando è finito l'ultimo giro, quando parte il prossimo.
_stato_import = {"in_corso": None, "ultimo_avvio": None, "ultimo_fine": None, "prossimo": None,
                 "giri": 0, "ultimi_esiti": {}, "ultimo_errore": None}
_lock_stato = threading.Lock()


def _adesso():
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _esegui_import(sorgente, forza=False):
    """Importazione con una connessione propria (gira anche nel thread di sfondo)."""
    with _lock_import:
        with _lock_stato:
            _stato_import["in_corso"] = sorgente
            _stato_import["ultimo_avvio"] = _adesso()
        conn = database.get_db()
        try:
            if sorgente == "ddt":
                esiti = importa_ddt.importa_cartella(conn, forza=forza)
            else:
                esiti = importa_mezzi.importa_cartella(conn, forza=forza)
            with _lock_stato:
                _stato_import["ultimi_esiti"][sorgente] = {"quando": _adesso(), "voci": len(esiti),
                                                           "errori": sum(1 for e in esiti if e.get("esito") == "errore")}
            return esiti
        except Exception as e:
            with _lock_stato:
                _stato_import["ultimo_errore"] = {"sorgente": sorgente, "quando": _adesso(), "testo": str(e)}
            raise
        finally:
            conn.close()
            with _lock_stato:
                _stato_import["in_corso"] = None
                _stato_import["ultimo_fine"] = _adesso()


@app.get("/api/importazioni")
def api_importazioni():
    c = db()
    # i percorsi assoluti del server li vede solo l'amministratore (dicono com'è fatto il disco del server);
    # agli altri basta sapere se la cartella c'è e come si chiama
    admin = e_admin()
    return jsonify({
        "ddt_dir": config.DDT_DATA_DIR if admin else os.path.basename(config.DDT_DATA_DIR.rstrip("\\/")),
        "ddt_dir_ok": os.path.isdir(config.DDT_DATA_DIR),
        "mezzi_dir": config.MEZZI_VFP_DIR if admin else os.path.basename(config.MEZZI_VFP_DIR.rstrip("\\/")),
        "mezzi_dir_ok": os.path.isdir(config.MEZZI_VFP_DIR),
        "intervallo_sec": config.IMPORT_INTERVALLO_SEC,
        "commesse": [n for n in (sorted(os.listdir(config.DDT_DATA_DIR)) if os.path.isdir(config.DDT_DATA_DIR) else [])
                     if n not in config.COMMESSE_IGNORATE
                     and os.path.isfile(os.path.join(config.DDT_DATA_DIR, n, "consegne.json"))],
        "storico": righe(c.execute("SELECT * FROM importazioni ORDER BY id DESC LIMIT 100")),
    })


@app.post("/api/importazioni/<sorgente>")
def api_importa(sorgente):
    if sorgente not in ("ddt", "mezzi"):
        raise ApiError("Sorgente sconosciuta", 404)
    forza = bool((request.get_json(silent=True) or {}).get("forza"))
    esiti = _esegui_import(sorgente, forza=forza)
    registra("importazione", sorgente, None, f"{'rilettura completa' if forza else 'lettura'}: {len(esiti)} voci")
    db().commit()
    return jsonify({"ok": True, "esiti": esiti, "totale": len(esiti)})


@app.post("/api/importazioni/upload")
def api_importa_upload():
    f = request.files.get("file")
    if not f or not f.filename:
        raise ApiError("Nessun file")
    try:
        parsed = json.load(f.stream)
    except (ValueError, UnicodeDecodeError) as e:
        log.info("upload %s: JSON non leggibile: %s", f.filename, e)
        raise ApiError("Il file non è un export JSON del Lettore DDT leggibile: scaricalo di nuovo e riprova.")
    commessa = (request.form.get("commessa") or "").strip()[:80]
    try:
        with _lock_import:
            esiti = importa_ddt.importa_json_caricato(db(), parsed, f.filename, commessa)
    except importa_ddt.ImportError_ as e:
        raise ApiError(str(e))
    registra("importazione", "upload", None, f"{f.filename}: {sum(e.get('righe', 0) for e in esiti)} righe")
    db().commit()
    return jsonify({"ok": True, "esiti": esiti})


@app.get("/api/importazioni/stato")
def api_importazioni_stato():
    """Quadro vivo delle importazioni: ciclo di sfondo, export per commessa con il
    loro stato (letto / da leggere / errore), pratiche mezzi, righe per giorno."""
    c = db()
    with _lock_stato:
        ciclo = dict(_stato_import)
        ciclo["ultimi_esiti"] = dict(ciclo["ultimi_esiti"])
    ciclo["intervallo_sec"] = config.IMPORT_INTERVALLO_SEC
    ciclo["attivo"] = config.IMPORT_INTERVALLO_SEC > 0
    return jsonify({
        "ciclo": ciclo,
        "ddt": statistiche.stato_ddt(c),
        "mezzi": statistiche.stato_mezzi(c),
        "per_giorno": statistiche.importazioni_per_giorno(c, 14),
        "errori": righe(c.execute(
            "SELECT ts, sorgente, chiave, dettaglio FROM importazioni WHERE esito <> 'ok' ORDER BY id DESC LIMIT 10")),
    })


def _thread_importazioni():
    time.sleep(5)
    while True:
        with _lock_stato:
            _stato_import["giri"] += 1
        for sorgente in ("ddt", "mezzi"):
            try:
                esiti = _esegui_import(sorgente)
                if esiti:
                    log.info("importazione %s: %d voci", sorgente, len(esiti))
            except Exception as e:  # il thread non deve morire
                log.error("importazione automatica %s fallita: %s", sorgente, e)
        with _lock_stato:
            _stato_import["prossimo"] = time.strftime(
                "%Y-%m-%d %H:%M:%S", time.localtime(time.time() + config.IMPORT_INTERVALLO_SEC))
        time.sleep(config.IMPORT_INTERVALLO_SEC)


# --------------------------------------------------------------------------- statistiche (grafici)

def _periodo():
    giorni = request.args.get("giorni", "30")
    try:
        giorni = max(1, min(int(giorni), 730))
    except ValueError:
        raise ApiError("giorni non valido")
    ubi = request.args.get("ubicazione_id") or None
    return giorni, (int(ubi) if ubi and str(ubi).isdigit() else None)


@app.get("/api/statistiche")
def api_statistiche():
    giorni, ubi = _periodo()
    c = db()
    return jsonify({
        "giorni": giorni, "ubicazione_id": ubi,
        "totali": statistiche.totali_periodo(c, giorni, ubi),
        "per_giorno": statistiche.movimenti_per_giorno(c, giorni, ubi),
        "flussi": statistiche.flussi(c, giorni, ubi),
        "ubicazioni": statistiche.ubicazioni_attive(c, giorni),
    })


@app.get("/api/articoli/<int:id_>/andamento")
def api_articolo_andamento(id_):
    esiste("articoli", id_)
    giorni, _ = _periodo()
    return jsonify(statistiche.andamento_articolo(db(), id_, giorni))


def avvia_importazioni_di_sfondo():
    if config.IMPORT_INTERVALLO_SEC > 0:
        threading.Thread(target=_thread_importazioni, daemon=True, name="importazioni").start()
    backup.avvia_di_sfondo()          # copie del database ogni MAGAZZINO_BACKUP_ORE (backup.py)
    riepilogo.avvia_di_sfondo()       # riepilogo giornaliero in SkyTower dopo MAGAZZINO_RIEPILOGO_ORA (riepilogo.py)


# --------------------------------------------------------------------------- backup del database (solo admin)

@app.get("/api/admin/backup")
def api_backup_stato():
    """Ultime copie, cartella e intervallo per la pagina Amministrazione (le rotte /api/admin sono riservate)."""
    return jsonify(backup.stato())


@app.post("/api/admin/backup")
def api_backup_adesso():
    """"Fai un backup adesso": una copia subito, con la stessa rotazione di quelle automatiche."""
    try:
        fatta = backup.esegui()
    except (OSError, sqlite3.Error) as e:
        log.error("backup a mano non riuscito: %s", e)
        raise ApiError("Backup non riuscito: la cartella delle copie non è scrivibile o il disco è pieno "
                       "(dettagli nel log del Magazzino).", 500)
    registra("backup", "database", None, f"{fatta['nome']} ({fatta['byte']} byte)")
    db().commit()
    return jsonify({"ok": True, "copia": fatta, "stato": backup.stato()})


# --------------------------------------------------------------------------- presenze e amministrazione

PRESENZA_TIMEOUT_SEC = 120


@app.post("/api/presenza")
def api_presenza():
    """Battito della pagina: chi è collegato e su quale vista."""
    d = request.get_json(silent=True) or {}
    u = utente_corrente() or {}
    with _lock_presenze:
        _presenze[nome_utente()] = {
            "utente": nome_utente(), "nome": u.get("nome") or nome_utente(), "admin": bool(u.get("admin")),
            "vista": str(d.get("vista") or "")[:40], "ip": (request.remote_addr or "")[:45],
            "dal": _presenze.get(nome_utente(), {}).get("dal") or _adesso(), "ultimo": _adesso(),
            "t": time.monotonic()}
    return jsonify({"ok": True})


def _presenze_attive():
    adesso = time.monotonic()
    with _lock_presenze:
        for k in [k for k, v in _presenze.items() if adesso - v["t"] > PRESENZA_TIMEOUT_SEC]:
            del _presenze[k]
        return sorted(({k2: v2 for k2, v2 in v.items() if k2 != "t"} for v in _presenze.values()),
                      key=lambda p: p["ultimo"], reverse=True)


@app.get("/api/admin/riepilogo")
def api_admin_riepilogo():
    """Chi ha fatto cosa nel periodo: per utente, movimenti per tipo, scansioni,
    importazioni, modifiche alle anagrafiche, ultima attività. Più i mezzi in uso."""
    giorni, _ = _periodo()
    dal = (date.today() - timedelta(days=giorni - 1)).isoformat()
    c = db()
    per_utente = {}
    for r in c.execute(
            "SELECT utente, tipo, origine, COUNT(*) AS n, MAX(ts) AS ultimo FROM movimenti "
            "WHERE date(COALESCE(data, ts)) >= ? GROUP BY utente, tipo, origine", (dal,)):
        u = per_utente.setdefault(r["utente"] or "?", {"utente": r["utente"] or "?", "carico": 0, "scarico": 0, "trasferimento": 0,
                                                       "rettifica": 0, "movimenti": 0, "scansioni": 0, "importazioni": 0,
                                                       "anagrafiche": 0, "ultima": None})
        chiave = "rettifica" if r["tipo"] in ("rettifica", "inventario") else r["tipo"]
        u[chiave] += r["n"]
        u["movimenti"] += r["n"]
        u["ultima"] = max(u["ultima"] or "", r["ultimo"])
    for r in c.execute(
            "SELECT utente, azione, COUNT(*) AS n, MAX(ts) AS ultimo FROM attivita WHERE date(ts) >= ? "
            "GROUP BY utente, azione", (dal,)):
        u = per_utente.setdefault(r["utente"] or "?", {"utente": r["utente"] or "?", "carico": 0, "scarico": 0, "trasferimento": 0,
                                                       "rettifica": 0, "movimenti": 0, "scansioni": 0, "importazioni": 0,
                                                       "anagrafiche": 0, "ultima": None})
        if r["azione"] == "scansione":
            u["scansioni"] += r["n"]
        elif r["azione"] == "importazione":
            u["importazioni"] += r["n"]
        elif r["azione"] in ("crea", "modifica", "elimina", "disattiva", "sposta"):
            u["anagrafiche"] += r["n"]
        u["ultima"] = max(u["ultima"] or "", r["ultimo"])
    utenti = sorted(per_utente.values(), key=lambda u: (u["ultima"] or ""), reverse=True)
    mezzi_in_uso = righe(c.execute(
        "SELECT m.id, m.codice, m.tipo_mezzo, m.marca, m.modello, m.targa, m.assegnato_a, m.stato, u.nome AS ubicazione, "
        "(SELECT MAX(ts) FROM movimenti_mezzi s WHERE s.mezzo_id = m.id) AS dal, "
        "(SELECT utente FROM movimenti_mezzi s WHERE s.mezzo_id = m.id ORDER BY s.id DESC LIMIT 1) AS registrato_da "
        "FROM mezzi m LEFT JOIN ubicazioni u ON u.id = m.ubicazione_id WHERE m.attivo = 1 AND m.stato = 'in_uso' "
        "ORDER BY m.assegnato_a IS NULL, m.assegnato_a, m.tipo_mezzo"))
    per_giorno = {}
    for r in c.execute(
            "SELECT date(ts) AS g, utente, COUNT(*) AS n FROM attivita WHERE date(ts) >= ? GROUP BY g, utente", (dal,)):
        per_giorno.setdefault(r["g"], {})[r["utente"]] = r["n"]
    return jsonify({
        "giorni": giorni, "utenti": utenti, "mezzi_in_uso": mezzi_in_uso, "collegati": _presenze_attive(),
        "attivita_oggi": c.execute("SELECT COUNT(*) FROM attivita WHERE date(ts) = date('now', 'localtime')").fetchone()[0],
        "utenti_attivi": len(utenti), "per_giorno": [{"data": g, "utenti": v} for g, v in sorted(per_giorno.items())],
    })


@app.get("/api/admin/attivita")
def api_admin_attivita():
    """Registro attività filtrabile: utente, azione, oggetto, periodo."""
    sql = ("SELECT a.*, CASE a.oggetto WHEN 'articolo' THEN (SELECT descrizione FROM articoli x WHERE x.id = a.oggetto_id) "
           "WHEN 'mezzo' THEN (SELECT tipo_mezzo || ' ' || COALESCE(marca, '') || ' ' || COALESCE(targa, '') FROM mezzi x WHERE x.id = a.oggetto_id) "
           "WHEN 'ubicazione' THEN (SELECT nome FROM ubicazioni x WHERE x.id = a.oggetto_id) END AS oggetto_nome, "
           "CASE a.oggetto WHEN 'articolo' THEN (SELECT codice FROM articoli x WHERE x.id = a.oggetto_id) "
           "WHEN 'mezzo' THEN (SELECT codice FROM mezzi x WHERE x.id = a.oggetto_id) "
           "WHEN 'ubicazione' THEN (SELECT codice FROM ubicazioni x WHERE x.id = a.oggetto_id) END AS oggetto_codice "
           "FROM attivita a WHERE 1=1 ")
    p = []
    giorni, _ = _periodo()
    sql += "AND date(a.ts) >= ? "
    p.append((date.today() - timedelta(days=giorni - 1)).isoformat())
    for campo in ("utente", "azione", "oggetto"):
        v = (request.args.get(campo) or "").strip()
        if v:
            sql += f"AND a.{campo} = ? "
            p.append(v)
    q = (request.args.get("q") or "").strip()
    if q:
        sql += "AND (a.descrizione LIKE ? OR a.utente LIKE ? OR a.ip LIKE ?) "
        p += [f"%{q}%"] * 3
    sql += "ORDER BY a.id DESC LIMIT ?"
    p.append(min(int(request.args.get("limite") or 300), 5000))
    return jsonify(righe(db().execute(sql, p)))


@app.get("/api/admin/utenti")
def api_admin_utenti():
    """Gli utenti visti finora (per i filtri)."""
    c = db()
    nomi = {r[0] for r in c.execute("SELECT DISTINCT utente FROM attivita")} | \
        {r[0] for r in c.execute("SELECT DISTINCT utente FROM movimenti WHERE utente IS NOT NULL")}
    return jsonify(sorted(n for n in nomi if n))


# --------------------------------------------------------------------------- codici a barre ed etichette

@app.get("/api/codici/<string:testo_codice>.svg")
def api_codice_svg(testo_codice):
    formato = request.args.get("formato", "code128")
    try:
        svg = codici.qr_svg(testo_codice) if formato == "qr" else codici.code128_svg(testo_codice)
    except codici.CodiceError as e:
        raise ApiError(str(e))
    if not svg:
        raise ApiError("QR non disponibile: installare il pacchetto segno", 501)
    return Response(svg, mimetype="image/svg+xml")


@app.get("/etichette")
def etichette_vecchia():
    """Vecchio indirizzo del foglio etichette: rimanda a /api/etichette. Stava fuori da /api e il gate SSO
    lo lasciava passare a chi mandava un Accept diverso da text/html (revisione di sicurezza del 03/11/2026):
    l'elenco completo di articoli, mezzi (targhe, matricole) e ubicazioni usciva senza login."""
    # request.script_root: dentro il programma unico il foglio sta sotto /magazzino
    return redirect(request.script_root + "/api/etichette"
                    + ("?" + request.query_string.decode() if request.query_string else ""), 302)


@app.get("/api/etichette")
def etichette():
    """Foglio etichette da stampare: ?tipo=articoli|mezzi|ubicazioni&ids=1,2,3 (senza ids: tutti gli attivi).
    Sta sotto /api perché il gate SSO protegge sempre quel prefisso, qualunque sia l'Accept del client."""
    tipo = request.args.get("tipo", "articoli")
    if tipo not in ("articoli", "mezzi", "ubicazioni"):
        raise ApiError("tipo non valido")
    ids = [int(x) for x in (request.args.get("ids") or "").split(",") if x.strip().isdigit()]
    c = db()
    sql = f"SELECT * FROM {tipo} WHERE attivo = 1"
    p = []
    if ids:
        sql += f" AND id IN ({','.join('?' * len(ids))})"
        p = ids
    voci = []
    for r in c.execute(sql + " ORDER BY id", p):
        r = dict(r)
        if tipo == "articoli":
            titolo, sotto = r["descrizione"], f"UM: {r['um']}" + (f" · {r['categoria']}" if r.get("categoria") else "")
        elif tipo == "mezzi":
            titolo = " ".join(x for x in (r["tipo_mezzo"], r.get("marca"), r.get("modello")) if x)
            sotto = " · ".join(x for x in (f"Targa {r['targa']}" if r.get("targa") else "",
                                           f"Matr. {r['matricola']}" if r.get("matricola") else "") if x)
        else:
            titolo, sotto = r["nome"], r["tipo"]
        voci.append({"codice": r["codice"], "titolo": titolo, "sotto": sotto,
                     "code128": codici.code128_svg(r["codice"], altezza=40, modulo=1, quiet=4),
                     "qr": codici.qr_svg(r["codice"], scala=2)})
    return render_template("etichette.html", voci=voci, tipo=tipo, formato=request.args.get("formato", "a4"))


# --------------------------------------------------------------------------- pagina

@app.get("/")
def index():
    # cfg arriva alla pagina come window.MAGAZZINO (base dei link, programma unico, commessa di sessione)
    cfg = info_pagina()
    return render_template("index.html", cfg=cfg, base=cfg["base"])


# Installazione sul telefono (PWA): manifest e service worker vanno serviti dalla
# radice, altrimenti il browser limita l'app alla cartella /static.
@app.get("/manifest.webmanifest")
def manifest():
    r = send_file(os.path.join(config.BASE_DIR, "static", "manifest.webmanifest"), mimetype="application/manifest+json")
    r.headers["Cache-Control"] = "no-cache"
    return r


@app.get("/sw.js")
def service_worker():
    r = send_file(os.path.join(config.BASE_DIR, "static", "js", "sw.js"), mimetype="text/javascript")
    r.headers["Cache-Control"] = "no-cache"
    # il service worker governa solo la sua cartella: "/" da solo, "/magazzino/" nel programma unico
    r.headers["Service-Worker-Allowed"] = (request.script_root or "") + "/"
    return r


# Avviato come script il modulo si chiama __main__: suite_rotte fa "from app import app" e
# senza questa riga importerebbe una SECONDA copia di app.py (rotte su un'app mai servita).
sys.modules.setdefault("app", sys.modules[__name__])
import suite_rotte  # noqa: E402, F401  (dialogo con InCampo e SkyTower: usa le funzioni definite qui sopra)

database.init_db()

if __name__ == "__main__":
    visibile = "localhost" if config.HOST == "0.0.0.0" else config.HOST
    indirizzo = f"http://{visibile}:{config.PORT}" + (" (e in LAN)" if config.HOST == "0.0.0.0" else "")
    avvia_importazioni_di_sfondo()
    try:
        from waitress import serve
        print(f"Magazzino Operativo Cosedil — waitress su {indirizzo}")
        serve(app, host=config.HOST, port=config.PORT, threads=8)
    except ImportError:
        print(f"waitress non disponibile — dev server Flask su {indirizzo}")
        app.run(host=config.HOST, port=config.PORT, debug=False)
