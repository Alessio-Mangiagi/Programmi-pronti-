# "><(((º> sabusabu <º)))><"
"""Magazzino Operativo Cosedil — server Flask.

Dove sta il materiale e quanto ce n'è, dove stanno i mezzi: si scansiona il
codice a barre e si vede. Il materiale entra dai DDT del Lettore DDT, i mezzi
a nolo dalle pratiche di VFP Transfer; il resto (scarichi, trasferimenti,
rettifiche, mezzi propri) si registra a mano o dalla pagina di scansione.

Avvio: python app.py (o avvia.bat). API JSON sotto /api, pagina unica in /.
"""
import json
import logging
import os
import sqlite3
import sys
import threading
import time
import traceback
from datetime import date

from flask import Flask, Response, g, jsonify, render_template, request
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

import codici
import config
import database
import importa_ddt
import importa_mezzi

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
cosedil_sso.init(app, app_id="magazzino")

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


def e_admin():
    if not cosedil_sso.ENABLED:
        return True
    u = utente_corrente()
    if not u or not u.get("admin"):
        return False
    return not config.ADMIN_UTENTI or (u.get("username") or "").lower() in config.ADMIN_UTENTI


@app.before_request
def gate_admin():
    if request.path.startswith("/api") and request.method == "DELETE" and not e_admin():
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


@app.errorhandler(sqlite3.IntegrityError)
def _err_integrita(e):
    return jsonify({"errore": f"Dato duplicato o riferimento mancante: {e}"}), 409


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


@app.get("/api/me")
def api_me():
    u = utente_corrente() or {}
    return jsonify({"username": u.get("username"), "nome": u.get("nome"), "admin": e_admin(),
                    "qr": codici.segno is not None})


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
        "SELECT g.ubicazione_id, u.nome AS ubicazione, u.tipo, g.quantita, g.ultimo_movimento "
        "FROM giacenze g JOIN ubicazioni u ON u.id = g.ubicazione_id WHERE g.articolo_id = ? AND g.quantita <> 0 "
        "ORDER BY g.quantita DESC", (id_,)))
    mov = righe(c.execute(
        "SELECT m.*, ud.nome AS da_nome, ua.nome AS a_nome FROM movimenti m "
        "LEFT JOIN ubicazioni ud ON ud.id = m.da_ubicazione_id LEFT JOIN ubicazioni ua ON ua.id = m.a_ubicazione_id "
        "WHERE m.articolo_id = ? ORDER BY m.id DESC LIMIT 20", (id_,)))
    return {"tipo": "articolo", "articolo": dict(a), "giacenze": giac,
            "totale": sum(r["quantita"] for r in giac), "movimenti": mov}


def dettaglio_mezzo(c, id_):
    m = c.execute(
        "SELECT m.*, u.nome AS ubicazione FROM mezzi m LEFT JOIN ubicazioni u ON u.id = m.ubicazione_id WHERE m.id = ?",
        (id_,)).fetchone()
    if not m:
        raise ApiError("Mezzo non trovato", 404)
    storico = righe(c.execute(
        "SELECT s.*, ud.nome AS da_nome, ua.nome AS a_nome FROM movimenti_mezzi s "
        "LEFT JOIN ubicazioni ud ON ud.id = s.da_ubicazione_id LEFT JOIN ubicazioni ua ON ua.id = s.a_ubicazione_id "
        "WHERE s.mezzo_id = ? ORDER BY s.id DESC LIMIT 20", (id_,)))
    return {"tipo": "mezzo", "mezzo": dict(m), "storico": storico}


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
    return {"nome": testo(d, "nome", True, 120), "tipo": scelta(d, "tipo", TIPI_UBICAZIONE, "cantiere"),
            "commessa": testo(d, "commessa", maxlen=80), "indirizzo": testo(d, "indirizzo"),
            "note": testo(d, "note", maxlen=500), "attivo": 0 if d.get("attivo") in (0, False, "0") else 1}


@app.post("/api/ubicazioni")
def api_ubicazione_crea():
    d = _dati_ubicazione(corpo())
    c = db()
    d["codice"] = codici.prossimo_codice(c, "ubicazioni", config.PREFISSO_UBICAZIONE)
    cur = c.execute("INSERT INTO ubicazioni (codice, nome, tipo, commessa, indirizzo, note, attivo) "
                    "VALUES (:codice, :nome, :tipo, :commessa, :indirizzo, :note, :attivo)", d)
    c.commit()
    return jsonify(dict(c.execute("SELECT * FROM ubicazioni WHERE id = ?", (cur.lastrowid,)).fetchone())), 201


@app.put("/api/ubicazioni/<int:id_>")
def api_ubicazione_aggiorna(id_):
    esiste("ubicazioni", id_)
    d = _dati_ubicazione(corpo())
    d["id"] = id_
    c = db()
    c.execute("UPDATE ubicazioni SET nome=:nome, tipo=:tipo, commessa=:commessa, indirizzo=:indirizzo, note=:note, "
              "attivo=:attivo WHERE id=:id", d)
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
        c.commit()
        return jsonify({"ok": True, "disattivata": True,
                        "messaggio": "Ubicazione con movimenti o mezzi: disattivata, non cancellata"})
    c.execute("DELETE FROM ubicazioni WHERE id = ?", (id_,))
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
    c.commit()
    return jsonify(dict(c.execute("SELECT * FROM articoli WHERE id = ?", (id_,)).fetchone()))


@app.delete("/api/articoli/<int:id_>")
def api_articolo_elimina(id_):
    esiste("articoli", id_)
    c = db()
    if c.execute("SELECT 1 FROM movimenti WHERE articolo_id = ? LIMIT 1", (id_,)).fetchone():
        c.execute("UPDATE articoli SET attivo = 0 WHERE id = ?", (id_,))
        c.commit()
        return jsonify({"ok": True, "disattivato": True, "messaggio": "Articolo con movimenti: disattivato"})
    c.execute("DELETE FROM articoli WHERE id = ?", (id_,))
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
    for campo, col in (("articolo_id", "m.articolo_id = ?"), ("tipo", "m.tipo = ?"), ("origine", "m.origine = ?")):
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
            raise ApiError(f"Giacenza insufficiente: disponibili {disponibile:g} (invia forza=true per registrare comunque)")
    cur = c.execute(
        "INSERT INTO movimenti (data, tipo, articolo_id, quantita, da_ubicazione_id, a_ubicazione_id, riferimento, "
        "fornitore, origine, utente, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (testo(d, "data", maxlen=10), tipo, art, qta, da, a, testo(d, "riferimento", maxlen=120),
         testo(d, "fornitore", maxlen=120), origine, nome_utente(), testo(d, "note", maxlen=500)))
    c.commit()
    return jsonify({"ok": True, "id": cur.lastrowid, **dettaglio_articolo(c, art)}), 201


@app.delete("/api/movimenti/<int:id_>")
def api_movimento_elimina(id_):
    esiste("movimenti", id_)
    c = db()
    c.execute("DELETE FROM movimenti WHERE id = ?", (id_,))
    c.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- mezzi

@app.get("/api/mezzi")
def api_mezzi():
    q = (request.args.get("q") or "").strip()
    tutti = request.args.get("tutti") == "1"
    sql = "SELECT m.*, u.nome AS ubicazione FROM mezzi m LEFT JOIN ubicazioni u ON u.id = m.ubicazione_id WHERE 1=1 "
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
    c.commit()
    return jsonify(dettaglio_mezzo(c, id_))


@app.post("/api/mezzi/<int:id_>/sposta")
def api_mezzo_sposta(id_):
    esiste("mezzi", id_)
    d = corpo()
    c = db()
    m = c.execute("SELECT ubicazione_id, stato FROM mezzi WHERE id = ?", (id_,)).fetchone()
    a = esiste("ubicazioni", intero(d, "a_ubicazione_id"))
    stato = scelta(d, "stato", STATI_MEZZO, m["stato"])
    if a is None and stato == m["stato"]:
        raise ApiError("Indicare una nuova ubicazione o un nuovo stato")
    nuova_ubi = a if a is not None else m["ubicazione_id"]
    c.execute("UPDATE mezzi SET ubicazione_id = ?, stato = ? WHERE id = ?", (nuova_ubi, stato, id_))
    c.execute(
        "INSERT INTO movimenti_mezzi (mezzo_id, da_ubicazione_id, a_ubicazione_id, stato, origine, utente, note) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (id_, m["ubicazione_id"], nuova_ubi, stato, scelta(d, "origine", ("manuale", "scansione"), "manuale"),
         nome_utente(), testo(d, "note", maxlen=500)))
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
    c.execute("DELETE FROM mezzi WHERE id = ?", (id_,))
    c.commit()
    return jsonify({"ok": True})


# --------------------------------------------------------------------------- importazioni

_lock_import = threading.Lock()


def _esegui_import(sorgente, forza=False):
    """Importazione con una connessione propria (gira anche nel thread di sfondo)."""
    with _lock_import:
        conn = database.get_db()
        try:
            if sorgente == "ddt":
                return importa_ddt.importa_cartella(conn, forza=forza)
            return importa_mezzi.importa_cartella(conn, forza=forza)
        finally:
            conn.close()


@app.get("/api/importazioni")
def api_importazioni():
    c = db()
    return jsonify({
        "ddt_dir": config.DDT_DATA_DIR, "ddt_dir_ok": os.path.isdir(config.DDT_DATA_DIR),
        "mezzi_dir": config.MEZZI_VFP_DIR, "mezzi_dir_ok": os.path.isdir(config.MEZZI_VFP_DIR),
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
    return jsonify({"ok": True, "esiti": esiti, "totale": len(esiti)})


@app.post("/api/importazioni/upload")
def api_importa_upload():
    f = request.files.get("file")
    if not f or not f.filename:
        raise ApiError("Nessun file")
    try:
        parsed = json.load(f.stream)
    except (ValueError, UnicodeDecodeError) as e:
        raise ApiError(f"JSON non valido: {e}")
    commessa = (request.form.get("commessa") or "").strip()[:80]
    try:
        with _lock_import:
            esiti = importa_ddt.importa_json_caricato(db(), parsed, f.filename, commessa)
    except importa_ddt.ImportError_ as e:
        raise ApiError(str(e))
    return jsonify({"ok": True, "esiti": esiti})


def _thread_importazioni():
    time.sleep(5)
    while True:
        for sorgente in ("ddt", "mezzi"):
            try:
                esiti = _esegui_import(sorgente)
                if esiti:
                    log.info("importazione %s: %d voci", sorgente, len(esiti))
            except Exception as e:  # il thread non deve morire
                log.error("importazione automatica %s fallita: %s", sorgente, e)
        time.sleep(config.IMPORT_INTERVALLO_SEC)


def avvia_importazioni_di_sfondo():
    if config.IMPORT_INTERVALLO_SEC > 0:
        threading.Thread(target=_thread_importazioni, daemon=True, name="importazioni").start()


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
def etichette():
    """Foglio etichette da stampare: ?tipo=articoli|mezzi|ubicazioni&ids=1,2,3 (senza ids: tutti gli attivi)."""
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
    return render_template("index.html")


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
