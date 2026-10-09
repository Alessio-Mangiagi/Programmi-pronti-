# "><(((º> sabusabu <º)))><"
"""Scadenzario Cosedil — Flask app.

Espone tutte le API REST della SPEC, calcola stato/giorni_rimanenti
server-side, serve la SPA (templates/index.html + static/) e avvia il
server con waitress se disponibile, altrimenti con il dev server Flask.
"""
import calendar
import io
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import traceback
import uuid
from datetime import date, datetime, timedelta

from flask import Flask, g, jsonify, render_template, request, send_file
from werkzeug.exceptions import HTTPException
from werkzeug.utils import secure_filename

import config
import database
import importer
import notifiche

# Gate SSO condiviso con le altre app della suite: sta in shared/sso, cartella
# sorella del progetto, e ci si arriva aggiungendola al sys.path (l'app non è un
# pacchetto installato). Vedi shared/sso/cosedil_sso.py.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "shared", "sso"))
import cosedil_sso  # noqa: E402  (import dopo il sys.path: è l'unico modo di trovarlo)

app = Flask(__name__, template_folder="templates", static_folder="static")

# Qui ci sono dati personali dei dipendenti (codici fiscali, visite mediche):
# senza login non entra nessuno. COSEDIL_SSO=off solo per lo sviluppo in locale.
cosedil_sso.init(app, app_id="scadenzario")

# ---------------------------------------------------------------------------
# Costanti di validazione (enum della SPEC)
# ---------------------------------------------------------------------------

CATEGORIE = (
    "formazione", "visita_medica", "patentino", "durc",
    "attrezzatura", "assicurazione", "certificazione", "ai_act", "altro",
)
SOGGETTI = ("dipendente", "subappaltatore", "attrezzatura", "sistema_ia", "azienda")
STATI = ("scaduta", "in_scadenza", "valida", "chiusa")

# Enum dei campi del registro Sistemi IA (AI Act).
# Il PRIMO valore di ogni tupla è il default (allineato al DEFAULT della colonna).
CLASSI_RISCHIO = ("da_valutare", "vietato", "alto_rischio", "limitato", "minimo", "gpai")
RUOLI_IA = ("deployer", "provider", "importatore", "distributore")
STATI_CONFORMITA = ("da_valutare", "in_corso", "conforme", "non_conforme", "dismesso")

# Configurazione delle tre anagrafiche (pattern CRUD identico)
ANAGRAFICHE = {
    "dipendenti": {
        "tabella": "dipendenti",
        "soggetto_tipo": "dipendente",
        "campi": ["nome", "cognome", "codice_fiscale", "mansione",
                  "cantiere", "telefono", "email", "attivo", "note"],
        "obbligatori": ["nome", "cognome"],
        "campi_ricerca": ["nome", "cognome", "cantiere"],
        "errore_duplicato": "Codice fiscale già presente in anagrafica",
        "singolare": "Dipendente",
        # (campo, intestazione modello, valore d'esempio) per maschera e import massivo
        "import_campi": [
            ("nome", "Nome", "Mario"),
            ("cognome", "Cognome", "Rossi"),
            ("codice_fiscale", "Codice fiscale", "RSSMRA80A01H501U"),
            ("mansione", "Mansione", "Operaio"),
            ("cantiere", "Cantiere", "Ponte Agrò"),
            ("telefono", "Telefono", "333 1234567"),
            ("email", "Email", "m.rossi@example.it"),
            ("note", "Note", ""),
            ("attivo", "Attivo (1/0)", 1),
        ],
        "import_chiavi": [("codice_fiscale",), ("nome", "cognome")],
    },
    "subappaltatori": {
        "tabella": "subappaltatori",
        "soggetto_tipo": "subappaltatore",
        "campi": ["ragione_sociale", "partita_iva", "referente",
                  "telefono", "email", "attivo", "note"],
        "obbligatori": ["ragione_sociale"],
        "campi_ricerca": ["ragione_sociale", "referente"],
        "errore_duplicato": "Partita IVA già presente in anagrafica",
        "singolare": "Subappaltatore",
        "import_campi": [
            ("ragione_sociale", "Ragione sociale", "Edil Sud S.r.l."),
            ("partita_iva", "Partita IVA", "01234567890"),
            ("referente", "Referente", "Gino Verdi"),
            ("telefono", "Telefono", "06 1234567"),
            ("email", "Email", "info@edilsud.it"),
            ("note", "Note", ""),
            ("attivo", "Attivo (1/0)", 1),
        ],
        "import_chiavi": [("partita_iva",), ("ragione_sociale",)],
    },
    "attrezzature": {
        "tabella": "attrezzature",
        "soggetto_tipo": "attrezzatura",
        "campi": ["descrizione", "matricola", "cantiere", "attivo", "note"],
        "obbligatori": ["descrizione"],
        "campi_ricerca": ["descrizione", "matricola", "cantiere"],
        "errore_duplicato": "Attrezzatura duplicata",
        "singolare": "Attrezzatura",
        "import_campi": [
            ("descrizione", "Descrizione", "Gru a torre"),
            ("matricola", "Matricola", "GR-001"),
            ("cantiere", "Cantiere", "Ponte Agrò"),
            ("note", "Note", ""),
            ("attivo", "Attiva (1/0)", 1),
        ],
        "import_chiavi": [("descrizione", "matricola")],
    },
    "sistemi_ia": {
        "tabella": "sistemi_ia",
        "soggetto_tipo": "sistema_ia",
        "campi": ["nome", "fornitore", "finalita", "classe_rischio", "ruolo",
                  "stato_conformita", "referente", "cantiere", "attivo", "note"],
        "obbligatori": ["nome"],
        "campi_ricerca": ["nome", "fornitore", "finalita", "referente"],
        "errore_duplicato": "Sistema IA duplicato",
        "singolare": "Sistema IA",
        # Campi enum: validati server-side sui valori ammessi
        "enum": {
            "classe_rischio": CLASSI_RISCHIO,
            "ruolo": RUOLI_IA,
            "stato_conformita": STATI_CONFORMITA,
        },
        "import_campi": [
            ("nome", "Nome del sistema", "CV Screening AI"),
            ("fornitore", "Fornitore", "ACME"),
            ("finalita", "Finalità", "Selezione del personale"),
            ("classe_rischio", "Classe di rischio [" + "/".join(CLASSI_RISCHIO) + "]", "alto_rischio"),
            ("ruolo", "Ruolo [" + "/".join(RUOLI_IA) + "]", "deployer"),
            ("stato_conformita", "Stato conformità [" + "/".join(STATI_CONFORMITA) + "]", "da_valutare"),
            ("referente", "Referente", "DPO"),
            ("cantiere", "Cantiere/reparto", ""),
            ("note", "Note", ""),
            ("attivo", "In uso (1/0)", 1),
        ],
        "import_chiavi": [("nome", "fornitore")],
    },
}

# Tabella di appartenenza dei soggetti delle scadenze
TABELLE_SOGGETTO = {
    "dipendente": "dipendenti",
    "subappaltatore": "subappaltatori",
    "attrezzatura": "attrezzature",
    "sistema_ia": "sistemi_ia",
}


# ---------------------------------------------------------------------------
# Errori e utilità
# ---------------------------------------------------------------------------

class ErroreApi(Exception):
    """Errore applicativo con messaggio in italiano e status HTTP."""

    def __init__(self, messaggio: str, status: int = 400):
        super().__init__(messaggio)
        self.messaggio = messaggio
        self.status = status


@app.errorhandler(ErroreApi)
def gestisci_errore_api(err):
    return jsonify({"errore": err.messaggio}), err.status


@app.errorhandler(HTTPException)
def gestisci_errore_http(err):
    if request.path.startswith("/api"):
        return jsonify({"errore": err.description}), err.code
    return err


@app.errorhandler(sqlite3.IntegrityError)
def gestisci_errore_integrita(err):
    return jsonify({"errore": f"Vincolo di integrità violato: {err}"}), 409


@app.errorhandler(Exception)
def gestisci_errore_generico(err):
    traceback.print_exc()
    return jsonify({"errore": "Errore interno del server"}), 500


def _lower_unicode(testo):
    """LOWER Unicode-aware per SQLite (gestisce anche i caratteri accentati)."""
    return testo.lower() if isinstance(testo, str) else testo


def db() -> sqlite3.Connection:
    """Connessione SQLite legata alla richiesta corrente."""
    if "db" not in g:
        g.db = database.get_db()
        # LOWER() di SQLite abbassa solo i caratteri ASCII: per una ricerca
        # davvero case-insensitive anche con gli accentati (es. "AGRÒ" → "agrò")
        # registriamo una LOWER Unicode-aware implementata in Python.
        g.db.create_function("LOWER_IT", 1, _lower_unicode, deterministic=True)
    return g.db


@app.teardown_appcontext
def chiudi_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def corpo_json() -> dict:
    """Corpo JSON della richiesta; 400 se assente o malformato."""
    dati = request.get_json(silent=True)
    if not isinstance(dati, dict):
        raise ErroreApi("Corpo della richiesta mancante o non è un oggetto JSON valido")
    return dati


def valida_data_iso(valore, campo: str) -> str:
    """Valida una data ISO YYYY-MM-DD; ritorna la stringa normalizzata."""
    if not isinstance(valore, str):
        raise ErroreApi(f"Il campo '{campo}' deve essere una data ISO (YYYY-MM-DD)")
    try:
        return date.fromisoformat(valore.strip()).isoformat()
    except ValueError:
        raise ErroreApi(f"Il campo '{campo}' non è una data ISO valida (YYYY-MM-DD): {valore!r}")


def valida_intero(valore, campo: str, minimo=None):
    """Valida un intero (accetta anche stringhe numeriche)."""
    try:
        n = int(valore)
    except (TypeError, ValueError):
        raise ErroreApi(f"Il campo '{campo}' deve essere un numero intero")
    if minimo is not None and n < minimo:
        raise ErroreApi(f"Il campo '{campo}' deve essere >= {minimo}")
    return n


def valida_flag(valore, campo: str) -> int:
    """Valida un flag 0/1."""
    if valore in (0, 1, "0", "1", True, False):
        return int(valore)
    raise ErroreApi(f"Il campo '{campo}' deve essere 0 o 1")


def aggiungi_mesi(data_iso: str, mesi: int) -> str:
    """Somma mesi di calendario a una data ISO (clamp sul fine mese).

    Es. 2026-01-31 + 1 mese = 2026-02-28.
    """
    d = date.fromisoformat(data_iso)
    tot = d.month - 1 + mesi
    anno = d.year + tot // 12
    mese = tot % 12 + 1
    giorno = min(d.day, calendar.monthrange(anno, mese)[1])
    return date(anno, mese, giorno).isoformat()


# ---------------------------------------------------------------------------
# Scadenze arricchite (stato e giorni_rimanenti MAI salvati, sempre calcolati)
# ---------------------------------------------------------------------------

SQL_SCADENZE_ARRICCHITE = """
SELECT
  s.id, s.tipo_id, t.nome AS tipo_nome, t.categoria,
  s.soggetto_tipo, s.soggetto_id,
  CASE s.soggetto_tipo
    WHEN 'dipendente'     THEN COALESCE(d.nome || ' ' || d.cognome, '(dipendente eliminato)')
    WHEN 'subappaltatore' THEN COALESCE(sub.ragione_sociale, '(subappaltatore eliminato)')
    WHEN 'attrezzatura'   THEN COALESCE(
        a.descrizione || CASE
          WHEN a.matricola IS NOT NULL AND a.matricola <> '' THEN ' (' || a.matricola || ')'
          ELSE '' END,
        '(attrezzatura eliminata)')
    WHEN 'sistema_ia'     THEN COALESCE(si.nome, '(sistema IA eliminato)')
    ELSE 'Cosedil S.p.A.'
  END AS soggetto_nome,
  CASE s.soggetto_tipo
    WHEN 'dipendente'   THEN d.cantiere
    WHEN 'attrezzatura' THEN a.cantiere
    WHEN 'sistema_ia'   THEN si.cantiere
    ELSE NULL
  END AS cantiere,
  s.data_rilascio, s.data_scadenza, s.documento_rif, s.referente, s.note, s.chiusa,
  t.preavviso_giorni,
  (SELECT COUNT(*) FROM adempimenti ad WHERE ad.scadenza_id = s.id) AS adempimenti_totali,
  (SELECT COUNT(*) FROM adempimenti ad WHERE ad.scadenza_id = s.id AND ad.fatto = 1) AS adempimenti_fatti,
  (SELECT COUNT(*) FROM allegati al WHERE al.scadenza_id = s.id) AS allegati_totali
FROM scadenze s
JOIN tipi_scadenza t ON t.id = s.tipo_id
LEFT JOIN dipendenti d     ON s.soggetto_tipo = 'dipendente'     AND d.id  = s.soggetto_id
LEFT JOIN subappaltatori sub ON s.soggetto_tipo = 'subappaltatore' AND sub.id = s.soggetto_id
LEFT JOIN attrezzature a   ON s.soggetto_tipo = 'attrezzatura'   AND a.id  = s.soggetto_id
LEFT JOIN sistemi_ia si     ON s.soggetto_tipo = 'sistema_ia'     AND si.id = s.soggetto_id
"""


def arricchisci_riga(riga: sqlite3.Row, oggi: date) -> dict:
    """Trasforma una riga della query arricchita in dict con stato e giorni_rimanenti."""
    s = dict(riga)
    scad = date.fromisoformat(s["data_scadenza"])
    s["giorni_rimanenti"] = (scad - oggi).days
    if s["chiusa"]:
        s["stato"] = "chiusa"
    elif scad < oggi:
        s["stato"] = "scaduta"
    elif scad <= oggi + timedelta(days=s["preavviso_giorni"] or 0):
        s["stato"] = "in_scadenza"
    else:
        s["stato"] = "valida"
    return s


def carica_scadenze_arricchite(where: str = "", parametri: tuple = ()) -> list[dict]:
    """Carica scadenze arricchite (ordinamento default data_scadenza ASC)."""
    sql = SQL_SCADENZE_ARRICCHITE
    if where:
        sql += f" WHERE {where}"
    sql += " ORDER BY s.data_scadenza ASC, s.id ASC"
    oggi = date.today()
    righe = db().execute(sql, parametri).fetchall()
    return [arricchisci_riga(r, oggi) for r in righe]


def carica_scadenza_arricchita(scadenza_id: int) -> dict:
    risultati = carica_scadenze_arricchite("s.id = ?", (scadenza_id,))
    if not risultati:
        raise ErroreApi("Scadenza non trovata", 404)
    return risultati[0]


def filtra_scadenze(scadenze: list[dict], stato=None, q=None) -> list[dict]:
    """Filtri post-calcolo: stato (calcolato) e ricerca testuale."""
    if stato:
        scadenze = [s for s in scadenze if s["stato"] == stato]
    if q:
        testo = q.strip().lower()
        scadenze = [
            s for s in scadenze
            if testo in (s["soggetto_nome"] or "").lower()
            or testo in (s["tipo_nome"] or "").lower()
            or testo in (s["cantiere"] or "").lower()
            or testo in (s["documento_rif"] or "").lower()
            or testo in (s["note"] or "").lower()
        ]
    return scadenze


# ---------------------------------------------------------------------------
# Health & dashboard
# ---------------------------------------------------------------------------

@app.get("/api/health")
def api_health():
    return jsonify({"stato": "ok", "versione": config.VERSIONE})


@app.get("/api/dashboard")
def api_dashboard():
    tutte = carica_scadenze_arricchite()

    contatori = {"scadute": 0, "in_scadenza": 0, "valide": 0, "chiuse": 0}
    chiave_stato = {"scaduta": "scadute", "in_scadenza": "in_scadenza",
                    "valida": "valide", "chiusa": "chiuse"}
    per_categoria = {}
    for s in tutte:
        contatori[chiave_stato[s["stato"]]] += 1
        if s["stato"] != "chiusa":
            cat = per_categoria.setdefault(
                s["categoria"], {"categoria": s["categoria"],
                                 "scadute": 0, "in_scadenza": 0, "valide": 0})
            cat[chiave_stato[s["stato"]]] += 1

    prossime = [s for s in tutte if s["stato"] != "chiusa"][:15]

    conn = db()
    totali = {
        "dipendenti": conn.execute(
            "SELECT COUNT(*) FROM dipendenti WHERE attivo = 1").fetchone()[0],
        "subappaltatori": conn.execute(
            "SELECT COUNT(*) FROM subappaltatori WHERE attivo = 1").fetchone()[0],
        "attrezzature": conn.execute(
            "SELECT COUNT(*) FROM attrezzature WHERE attivo = 1").fetchone()[0],
    }

    return jsonify({
        "contatori": contatori,
        "per_categoria": sorted(per_categoria.values(), key=lambda c: c["categoria"]),
        "prossime": prossime,
        "totali": totali,
    })


# ---------------------------------------------------------------------------
# CRUD anagrafiche (dipendenti / subappaltatori / attrezzature)
# ---------------------------------------------------------------------------

def normalizza_anagrafica(risorsa: str, dati: dict, parziale: bool) -> dict:
    """Valida i campi di un'anagrafica; ritorna solo i campi noti."""
    cfg = ANAGRAFICHE[risorsa]
    # Default di colonna per gli enum NOT NULL: se il campo arriva vuoto/assente
    # si usa il primo valore ammesso, così non si viola mai il vincolo NOT NULL.
    default_enum = {c: valori_ammessi[0] for c, valori_ammessi in cfg.get("enum", {}).items()}
    valori = {}
    for campo in cfg["campi"]:
        enum_campo = cfg.get("enum", {}).get(campo)
        if campo not in dati:
            if not parziale:
                if campo == "attivo":
                    valori[campo] = 1
                elif enum_campo is not None:
                    valori[campo] = default_enum[campo]
                else:
                    valori[campo] = None
            continue
        valore = dati[campo]
        if campo == "attivo":
            valori[campo] = valida_flag(valore if valore is not None else 1, "attivo")
        elif enum_campo is not None:
            # Campo enum (es. classe_rischio): colonna NOT NULL → vuoto = default
            if valore in (None, ""):
                valori[campo] = default_enum[campo]
            elif str(valore).strip() in enum_campo:
                valori[campo] = str(valore).strip()
            else:
                raise ErroreApi(
                    f"Valore non valido per '{campo}'. Ammessi: {', '.join(enum_campo)}")
        elif valore is None:
            valori[campo] = None
        else:
            testo = str(valore).strip()
            if campo == "codice_fiscale":
                testo = testo.upper()
            valori[campo] = testo or None
    for campo in cfg["obbligatori"]:
        presente = campo in valori if parziale else True
        if presente and not valori.get(campo):
            if not parziale or campo in dati:
                raise ErroreApi(f"Il campo '{campo}' è obbligatorio")
            valori.pop(campo, None)
    return valori


def leggi_riga(tabella: str, riga_id: int, nome_singolare: str) -> dict:
    riga = db().execute(f"SELECT * FROM {tabella} WHERE id = ?", (riga_id,)).fetchone()
    if riga is None:
        raise ErroreApi(f"{nome_singolare} non trovato", 404)
    return dict(riga)


def registra_crud_anagrafica(risorsa: str):
    """Registra le route CRUD per una delle tre anagrafiche (pattern identico)."""
    cfg = ANAGRAFICHE[risorsa]
    tabella = cfg["tabella"]

    def lista():
        clausole, parametri = [], []
        q = request.args.get("q", "").strip()
        if q:
            like = f"%{q.lower()}%"
            ricerca = " OR ".join(
                f"LOWER_IT(COALESCE({c}, '')) LIKE ?" for c in cfg["campi_ricerca"])
            clausole.append(f"({ricerca})")
            parametri.extend([like] * len(cfg["campi_ricerca"]))
        attivo = request.args.get("attivo")
        if attivo is not None and attivo != "":
            clausole.append("attivo = ?")
            parametri.append(valida_flag(attivo, "attivo"))
        sql = f"SELECT * FROM {tabella}"
        if clausole:
            sql += " WHERE " + " AND ".join(clausole)
        sql += " ORDER BY id ASC"
        righe = db().execute(sql, parametri).fetchall()
        return jsonify([dict(r) for r in righe])

    def crea():
        valori = normalizza_anagrafica(risorsa, corpo_json(), parziale=False)
        colonne = list(valori.keys())
        sql = (f"INSERT INTO {tabella} ({', '.join(colonne)}) "
               f"VALUES ({', '.join('?' * len(colonne))})")
        conn = db()
        try:
            cur = conn.execute(sql, [valori[c] for c in colonne])
            conn.commit()
        except sqlite3.IntegrityError:
            raise ErroreApi(cfg["errore_duplicato"], 409)
        return jsonify(leggi_riga(tabella, cur.lastrowid, cfg["singolare"])), 201

    def aggiorna(riga_id: int):
        leggi_riga(tabella, riga_id, cfg["singolare"])
        valori = normalizza_anagrafica(risorsa, corpo_json(), parziale=True)
        if not valori:
            raise ErroreApi("Nessun campo da aggiornare")
        set_sql = ", ".join(f"{c} = ?" for c in valori)
        conn = db()
        try:
            conn.execute(f"UPDATE {tabella} SET {set_sql} WHERE id = ?",
                         [*valori.values(), riga_id])
            conn.commit()
        except sqlite3.IntegrityError:
            raise ErroreApi(cfg["errore_duplicato"], 409)
        return jsonify(leggi_riga(tabella, riga_id, cfg["singolare"]))

    def elimina(riga_id: int):
        leggi_riga(tabella, riga_id, cfg["singolare"])
        conn = db()
        n_scadenze = conn.execute(
            "SELECT COUNT(*) FROM scadenze WHERE soggetto_tipo = ? AND soggetto_id = ?",
            (cfg["soggetto_tipo"], riga_id)).fetchone()[0]
        if n_scadenze:
            raise ErroreApi(
                f"Impossibile eliminare: {n_scadenze} scadenze collegate. "
                "Eliminare prima le scadenze o disattivare il soggetto.", 409)
        conn.execute(f"DELETE FROM {tabella} WHERE id = ?", (riga_id,))
        conn.commit()
        return jsonify({"ok": True})

    def modello():
        return invia_modello_anagrafica(risorsa)

    def importa():
        return importa_anagrafica_massivo(risorsa)

    app.add_url_rule(f"/api/{risorsa}", f"{risorsa}_lista", lista, methods=["GET"])
    app.add_url_rule(f"/api/{risorsa}", f"{risorsa}_crea", crea, methods=["POST"])
    app.add_url_rule(f"/api/{risorsa}/modello.xlsx", f"{risorsa}_modello",
                     modello, methods=["GET"])
    app.add_url_rule(f"/api/{risorsa}/import", f"{risorsa}_import",
                     importa, methods=["POST"])
    app.add_url_rule(f"/api/{risorsa}/<int:riga_id>", f"{risorsa}_aggiorna",
                     aggiorna, methods=["PUT"])
    app.add_url_rule(f"/api/{risorsa}/<int:riga_id>", f"{risorsa}_elimina",
                     elimina, methods=["DELETE"])


def costruisci_modello_xlsx(intestazioni: list, esempi: list, titolo: str,
                            guida: str, download_name: str):
    """Genera una 'maschera' Excel generica (titolo, guida, header, righe d'esempio)
    e la restituisce come download. Usata per anagrafiche, tipi e scadenze."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    ncol = len(intestazioni)
    wb = Workbook()
    ws = wb.active
    ws.title = "Modello"

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ncol)
    cella_tit = ws.cell(row=1, column=1, value=titolo)
    cella_tit.font = Font(bold=True, size=14, color="0C4577")
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ncol)
    cella_guida = ws.cell(row=2, column=1, value=guida)
    cella_guida.font = Font(italic=True, size=10, color="66707A")
    cella_guida.alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[2].height = 30

    riga_header = 4
    font_h = Font(bold=True, color="FFFFFF")
    navy = PatternFill("solid", fgColor="0C4577")
    for col, nome in enumerate(intestazioni, start=1):
        cella = ws.cell(row=riga_header, column=col, value=nome)
        cella.font = font_h
        cella.fill = navy
        cella.alignment = Alignment(horizontal="center", wrap_text=True)
    ws.row_dimensions[riga_header].height = 28

    for i, riga in enumerate(esempi):
        for col, valore in enumerate(riga, start=1):
            ws.cell(row=riga_header + 1 + i, column=col, value=valore)

    for col, nome in enumerate(intestazioni, start=1):
        larghezza = max([len(str(nome))] + [len(str(r[col - 1])) for r in esempi if col - 1 < len(r)] + [10])
        ws.column_dimensions[ws.cell(row=riga_header, column=col).column_letter].width = min(larghezza + 4, 40)
    ws.freeze_panes = f"A{riga_header + 1}"

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return send_file(
        buffer,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=download_name)


TITOLI_MODELLO = {
    "dipendenti": "Dipendenti", "subappaltatori": "Subappaltatori",
    "attrezzature": "Attrezzature", "sistemi_ia": "Registro Sistemi IA",
}


def invia_modello_anagrafica(risorsa: str):
    cfg = ANAGRAFICHE[risorsa]
    intestazioni = [h for (_, h, _) in cfg["import_campi"]]
    esempi = [[e for (_, _, e) in cfg["import_campi"]]]
    guida = ("Compila una riga per ogni elemento; sostituisci la riga d'esempio. "
             "Non modificare la riga di intestazione. Le colonne (1/0) valgono 1=sì, 0=no. "
             "Puoi caricare questo file (o un .csv con le stesse intestazioni) dal pulsante «Importa».")
    return costruisci_modello_xlsx(
        intestazioni, esempi, f"Modello import — {TITOLI_MODELLO.get(risorsa, risorsa)}", guida,
        f"modello_{risorsa}.xlsx")


def _mappa_import_campi(import_campi: list) -> dict:
    """Accoppia le colonne del file ai campi accettando: l'intestazione completa
    del modello, la stessa senza il suggerimento tra parentesi tonde/quadre, e il
    nome del campo. Es. 'Classe di rischio [..]', 'Classe di rischio' e
    'classe_rischio' → classe_rischio. Chiave = intestazione normalizzata."""
    import re as _re
    mappa = {}
    for campo, header, _ in import_campi:
        header_pulito = _re.sub(r"[\[(].*?[\])]", "", str(header)).strip()
        for variante in (header, header_pulito, campo):
            chiave = importer.chiave_intestazione(variante)
            if chiave:
                mappa[chiave] = campo
    return mappa


def _mappa_colonne_import(cfg: dict) -> dict:
    return _mappa_import_campi(cfg["import_campi"])


def _reverse_enum(cfg: dict) -> dict:
    """{campo_enum: {valore_lower: chiave}} accettando in import sia la chiave sia l'etichetta IT."""
    etichette = {"classe_rischio": ETICHETTE_RISCHIO, "ruolo": ETICHETTE_RUOLO,
                 "stato_conformita": ETICHETTE_CONFORMITA}
    rev = {}
    for campo, ammessi in cfg.get("enum", {}).items():
        d = {str(v).lower(): v for v in ammessi}
        for chiave, etichetta in etichette.get(campo, {}).items():
            d[str(etichetta).strip().lower()] = chiave
        rev[campo] = d
    return rev


def _chiave_dedup(valori: dict, campi: tuple):
    parti = [str(valori.get(c) or "").strip().lower() for c in campi]
    return tuple(parti) if any(parti) else None


def _indice_dedup(conn, cfg: dict) -> dict:
    idx = {tuple(k): set() for k in cfg["import_chiavi"]}
    for r in conn.execute(f"SELECT * FROM {cfg['tabella']}").fetchall():
        rd = dict(r)
        for k in cfg["import_chiavi"]:
            chiave = _chiave_dedup(rd, k)
            if chiave:
                idx[tuple(k)].add(chiave)
    return idx


def _e_duplicato(valori: dict, cfg: dict, idx: dict) -> bool:
    for k in cfg["import_chiavi"]:
        chiave = _chiave_dedup(valori, k)
        if chiave and chiave in idx[tuple(k)]:
            return True
    return False


def _registra_dedup(valori: dict, cfg: dict, idx: dict) -> None:
    for k in cfg["import_chiavi"]:
        chiave = _chiave_dedup(valori, k)
        if chiave:
            idx[tuple(k)].add(chiave)


def importa_anagrafica_massivo(risorsa: str):
    """Import massivo di un'anagrafica da xlsx/csv (stesse intestazioni della maschera).
    Ritorna {importati, saltati, errori}. Dedup per le chiavi naturali della risorsa."""
    cfg = ANAGRAFICHE[risorsa]
    percorso = salva_file_caricato((".xlsx", ".csv", ".txt"))
    try:
        righe = importer.leggi_righe_tabellari(percorso)
    except ValueError as err:
        raise ErroreApi(str(err), 400)
    finally:
        try:
            os.unlink(percorso)
        except OSError:
            pass

    if not righe:
        raise ErroreApi("Nessuna riga trovata nel file (serve l'intestazione + almeno una riga).", 400)

    mappa = _mappa_colonne_import(cfg)
    rev_enum = _reverse_enum(cfg)
    conn = db()
    idx = _indice_dedup(conn, cfg)

    importati = saltati = 0
    errori = []
    for numero, riga in enumerate(righe, start=2):  # riga 1 = intestazione
        dati = {}
        for chiave, valore in riga.items():
            campo = mappa.get(chiave)
            if campo is not None and valore is not None and str(valore).strip() != "":
                dati[campo] = valore
        # Traduzione enum (chiave o etichetta italiana)
        for campo, d in rev_enum.items():
            if dati.get(campo) is not None:
                dati[campo] = d.get(str(dati[campo]).strip().lower(), dati[campo])
        if not dati:
            continue  # riga vuota
        try:
            valori = normalizza_anagrafica(risorsa, dati, parziale=False)
        except ErroreApi as e:
            errori.append(f"Riga {numero}: {e.messaggio}")
            continue
        if _e_duplicato(valori, cfg, idx):
            saltati += 1
            continue
        colonne = list(valori.keys())
        try:
            conn.execute(
                f"INSERT INTO {cfg['tabella']} ({', '.join(colonne)}) "
                f"VALUES ({', '.join('?' * len(colonne))})",
                [valori[c] for c in colonne])
        except sqlite3.IntegrityError:
            saltati += 1
            continue
        _registra_dedup(valori, cfg, idx)
        importati += 1

    conn.commit()
    return jsonify({"importati": importati, "saltati": saltati, "errori": errori})


for _risorsa in ANAGRAFICHE:
    registra_crud_anagrafica(_risorsa)


# ---------------------------------------------------------------------------
# Tipi scadenza
# ---------------------------------------------------------------------------

def normalizza_tipo(dati: dict, esistente: dict | None = None) -> dict:
    """Valida i campi di un tipo scadenza (merge con l'esistente per la PUT)."""
    base = dict(esistente) if esistente else {
        "nome": None, "categoria": None, "soggetto": None,
        "validita_mesi": None, "preavviso_giorni": config.DEFAULT_PREAVVISO_GIORNI,
    }
    for campo in ("nome", "categoria", "soggetto", "validita_mesi", "preavviso_giorni"):
        if campo in dati:
            base[campo] = dati[campo]

    nome = (str(base["nome"]).strip() if base["nome"] is not None else "")
    if not nome:
        raise ErroreApi("Il campo 'nome' è obbligatorio")
    if base["categoria"] not in CATEGORIE:
        raise ErroreApi(f"Categoria non valida. Valori ammessi: {', '.join(CATEGORIE)}")
    if base["soggetto"] not in SOGGETTI:
        raise ErroreApi(f"Soggetto non valido. Valori ammessi: {', '.join(SOGGETTI)}")
    validita = base["validita_mesi"]
    if validita is not None and validita != "":
        validita = valida_intero(validita, "validita_mesi", minimo=1)
    else:
        validita = None
    preavviso = base["preavviso_giorni"]
    if preavviso is None or preavviso == "":
        preavviso = config.DEFAULT_PREAVVISO_GIORNI
    preavviso = valida_intero(preavviso, "preavviso_giorni", minimo=0)
    return {"nome": nome, "categoria": base["categoria"], "soggetto": base["soggetto"],
            "validita_mesi": validita, "preavviso_giorni": preavviso}


def leggi_tipo(tipo_id: int) -> dict:
    riga = db().execute("SELECT * FROM tipi_scadenza WHERE id = ?", (tipo_id,)).fetchone()
    if riga is None:
        raise ErroreApi("Tipo scadenza non trovato", 404)
    return dict(riga)


@app.get("/api/tipi")
def tipi_lista():
    righe = db().execute(
        "SELECT * FROM tipi_scadenza ORDER BY categoria, nome").fetchall()
    return jsonify([dict(r) for r in righe])


@app.post("/api/tipi")
def tipi_crea():
    valori = normalizza_tipo(corpo_json())
    conn = db()
    try:
        cur = conn.execute(
            "INSERT INTO tipi_scadenza (nome, categoria, soggetto, validita_mesi, preavviso_giorni) "
            "VALUES (?, ?, ?, ?, ?)",
            (valori["nome"], valori["categoria"], valori["soggetto"],
             valori["validita_mesi"], valori["preavviso_giorni"]))
        conn.commit()
    except sqlite3.IntegrityError:
        raise ErroreApi("Esiste già un tipo scadenza con questo nome", 409)
    return jsonify(leggi_tipo(cur.lastrowid)), 201


@app.put("/api/tipi/<int:tipo_id>")
def tipi_aggiorna(tipo_id: int):
    esistente = leggi_tipo(tipo_id)
    valori = normalizza_tipo(corpo_json(), esistente)
    conn = db()
    try:
        conn.execute(
            "UPDATE tipi_scadenza SET nome = ?, categoria = ?, soggetto = ?, "
            "validita_mesi = ?, preavviso_giorni = ? WHERE id = ?",
            (valori["nome"], valori["categoria"], valori["soggetto"],
             valori["validita_mesi"], valori["preavviso_giorni"], tipo_id))
        conn.commit()
    except sqlite3.IntegrityError:
        raise ErroreApi("Esiste già un tipo scadenza con questo nome", 409)
    return jsonify(leggi_tipo(tipo_id))


IMPORT_CAMPI_TIPI = [
    ("nome", "Nome", "Visita medica idoneità"),
    ("categoria", "Categoria [" + "/".join(CATEGORIE) + "]", "visita_medica"),
    ("soggetto", "Soggetto [" + "/".join(SOGGETTI) + "]", "dipendente"),
    ("validita_mesi", "Validità (mesi, vuoto = manuale)", 12),
    ("preavviso_giorni", "Preavviso (giorni)", 45),
]


@app.get("/api/tipi/modello.xlsx")
def tipi_modello():
    intestazioni = [h for (_, h, _) in IMPORT_CAMPI_TIPI]
    esempi = [[e for (_, _, e) in IMPORT_CAMPI_TIPI]]
    guida = ("Un tipo per riga. Categoria e Soggetto devono essere uno dei valori tra parentesi. "
             "Validità in mesi vuota = data scadenza sempre manuale. Non modificare l'intestazione.")
    return costruisci_modello_xlsx(intestazioni, esempi, "Modello import — Tipi di scadenza",
                                   guida, "modello_tipi.xlsx")


@app.post("/api/tipi/import")
def tipi_import():
    percorso = salva_file_caricato((".xlsx", ".csv", ".txt"))
    try:
        righe = importer.leggi_righe_tabellari(percorso)
    except ValueError as err:
        raise ErroreApi(str(err), 400)
    finally:
        try:
            os.unlink(percorso)
        except OSError:
            pass
    if not righe:
        raise ErroreApi("Nessuna riga trovata nel file.", 400)

    mappa = _mappa_import_campi(IMPORT_CAMPI_TIPI)
    conn = db()
    importati = saltati = 0
    errori = []
    for numero, riga in enumerate(righe, start=2):
        dati = {}
        for chiave, valore in riga.items():
            campo = mappa.get(chiave)
            if campo is not None and valore is not None and str(valore).strip() != "":
                dati[campo] = valore
        if not dati.get("nome"):
            continue
        try:
            valori = normalizza_tipo(dati)
            conn.execute(
                "INSERT INTO tipi_scadenza (nome, categoria, soggetto, validita_mesi, preavviso_giorni) "
                "VALUES (?, ?, ?, ?, ?)",
                (valori["nome"], valori["categoria"], valori["soggetto"],
                 valori["validita_mesi"], valori["preavviso_giorni"]))
            importati += 1
        except sqlite3.IntegrityError:
            saltati += 1  # nome già esistente
        except ErroreApi as e:
            errori.append(f"Riga {numero}: {e.messaggio}")
    conn.commit()
    return jsonify({"importati": importati, "saltati": saltati, "errori": errori})


@app.delete("/api/tipi/<int:tipo_id>")
def tipi_elimina(tipo_id: int):
    leggi_tipo(tipo_id)
    conn = db()
    n_usi = conn.execute(
        "SELECT COUNT(*) FROM scadenze WHERE tipo_id = ?", (tipo_id,)).fetchone()[0]
    if n_usi:
        raise ErroreApi(
            f"Impossibile eliminare: il tipo è usato da {n_usi} scadenze.", 409)
    conn.execute("DELETE FROM tipi_scadenza WHERE id = ?", (tipo_id,))
    conn.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Scadenze
# ---------------------------------------------------------------------------

def valida_soggetto(soggetto_tipo, soggetto_id, tipo: dict):
    """Valida coerenza soggetto_tipo/soggetto_id/tipo; ritorna (soggetto_tipo, soggetto_id)."""
    if soggetto_tipo not in SOGGETTI:
        raise ErroreApi(f"soggetto_tipo non valido. Valori ammessi: {', '.join(SOGGETTI)}")
    if soggetto_tipo != tipo["soggetto"]:
        raise ErroreApi(
            f"Il tipo '{tipo['nome']}' si applica a soggetto '{tipo['soggetto']}', "
            f"non a '{soggetto_tipo}'")
    if soggetto_tipo == "azienda":
        return soggetto_tipo, None
    if soggetto_id is None:
        raise ErroreApi("Il campo 'soggetto_id' è obbligatorio (salvo soggetto_tipo='azienda')")
    soggetto_id = valida_intero(soggetto_id, "soggetto_id", minimo=1)
    tabella = TABELLE_SOGGETTO[soggetto_tipo]
    esiste = db().execute(
        f"SELECT 1 FROM {tabella} WHERE id = ?", (soggetto_id,)).fetchone()
    if not esiste:
        raise ErroreApi(f"Soggetto {soggetto_tipo} con id {soggetto_id} non trovato")
    return soggetto_tipo, soggetto_id


def risolvi_date_scadenza(dati: dict, tipo: dict, esistente: dict | None = None) -> tuple:
    """Valida data_rilascio/data_scadenza; autocalcola data_scadenza se possibile.

    data_scadenza = data_rilascio + validita_mesi (mesi di calendario).
    """
    if "data_rilascio" in dati:
        rilascio = dati["data_rilascio"]
        rilascio = valida_data_iso(rilascio, "data_rilascio") if rilascio else None
    else:
        rilascio = esistente["data_rilascio"] if esistente else None

    if "data_scadenza" in dati and dati["data_scadenza"]:
        scadenza = valida_data_iso(dati["data_scadenza"], "data_scadenza")
    elif esistente and "data_scadenza" not in dati:
        scadenza = esistente["data_scadenza"]
    elif rilascio and tipo["validita_mesi"]:
        scadenza = aggiungi_mesi(rilascio, tipo["validita_mesi"])
    elif rilascio:
        raise ErroreApi(
            f"Il tipo '{tipo['nome']}' non ha una validità in mesi: "
            "indicare esplicitamente 'data_scadenza'")
    else:
        raise ErroreApi("Indicare 'data_scadenza' oppure 'data_rilascio' "
                        "(con un tipo che abbia validita_mesi)")
    return rilascio, scadenza


def testo_o_none(valore):
    if valore is None:
        return None
    testo = str(valore).strip()
    return testo or None


def leggi_filtri_scadenze() -> tuple:
    """Legge e valida dalla query string i filtri comuni a GET /api/scadenze
    e a GET /api/export/scadenze.xlsx (l'export riflette la vista).

    Ritorna (stato, q, where_sql, parametri). Le chiuse sono escluse di
    default: entrano solo con includi_chiuse=1 o con filtro stato=chiusa.
    """
    stato = request.args.get("stato", "").strip() or None
    if stato and stato not in STATI:
        raise ErroreApi(f"Stato non valido. Valori ammessi: {', '.join(STATI)}")
    categoria = request.args.get("categoria", "").strip() or None
    if categoria and categoria not in CATEGORIE:
        raise ErroreApi(f"Categoria non valida. Valori ammessi: {', '.join(CATEGORIE)}")
    soggetto_tipo = request.args.get("soggetto_tipo", "").strip() or None
    if soggetto_tipo and soggetto_tipo not in SOGGETTI:
        raise ErroreApi(f"soggetto_tipo non valido. Valori ammessi: {', '.join(SOGGETTI)}")
    soggetto_id = request.args.get("soggetto_id", "").strip() or None
    if soggetto_id:
        soggetto_id = valida_intero(soggetto_id, "soggetto_id")
    includi_chiuse = request.args.get("includi_chiuse", "0").strip() in ("1", "true")

    clausole, parametri = [], []
    if categoria:
        clausole.append("t.categoria = ?")
        parametri.append(categoria)
    if soggetto_tipo:
        clausole.append("s.soggetto_tipo = ?")
        parametri.append(soggetto_tipo)
    if soggetto_id:
        clausole.append("s.soggetto_id = ?")
        parametri.append(soggetto_id)
    # Le chiuse sono incluse solo su richiesta esplicita (o se filtro stato=chiusa)
    if not includi_chiuse and stato != "chiusa":
        clausole.append("s.chiusa = 0")
    return stato, request.args.get("q"), " AND ".join(clausole), tuple(parametri)


@app.get("/api/scadenze")
def scadenze_lista():
    stato, q, where, parametri = leggi_filtri_scadenze()
    scadenze = carica_scadenze_arricchite(where, parametri)
    scadenze = filtra_scadenze(scadenze, stato=stato, q=q)
    return jsonify(scadenze)


@app.post("/api/scadenze")
def scadenze_crea():
    dati = corpo_json()
    if "tipo_id" not in dati:
        raise ErroreApi("Il campo 'tipo_id' è obbligatorio")
    tipo_id = valida_intero(dati["tipo_id"], "tipo_id", minimo=1)
    tipo = leggi_tipo_per_scadenza(tipo_id)
    soggetto_tipo, soggetto_id = valida_soggetto(
        dati.get("soggetto_tipo"), dati.get("soggetto_id"), tipo)
    rilascio, scadenza = risolvi_date_scadenza(dati, tipo)

    conn = db()
    cur = conn.execute(
        "INSERT INTO scadenze (tipo_id, soggetto_tipo, soggetto_id, data_rilascio, "
        "data_scadenza, documento_rif, referente, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (tipo_id, soggetto_tipo, soggetto_id, rilascio, scadenza,
         testo_o_none(dati.get("documento_rif")), testo_o_none(dati.get("referente")),
         testo_o_none(dati.get("note"))))
    conn.commit()
    return jsonify(carica_scadenza_arricchita(cur.lastrowid)), 201


def leggi_tipo_per_scadenza(tipo_id: int) -> dict:
    riga = db().execute("SELECT * FROM tipi_scadenza WHERE id = ?", (tipo_id,)).fetchone()
    if riga is None:
        raise ErroreApi(f"Tipo scadenza con id {tipo_id} non trovato")
    return dict(riga)


def leggi_scadenza_grezza(scadenza_id: int) -> dict:
    riga = db().execute("SELECT * FROM scadenze WHERE id = ?", (scadenza_id,)).fetchone()
    if riga is None:
        raise ErroreApi("Scadenza non trovata", 404)
    return dict(riga)


@app.put("/api/scadenze/<int:scadenza_id>")
def scadenze_aggiorna(scadenza_id: int):
    esistente = leggi_scadenza_grezza(scadenza_id)
    dati = corpo_json()

    tipo_id = esistente["tipo_id"]
    if "tipo_id" in dati:
        tipo_id = valida_intero(dati["tipo_id"], "tipo_id", minimo=1)
    tipo = leggi_tipo_per_scadenza(tipo_id)

    soggetto_tipo = dati.get("soggetto_tipo", esistente["soggetto_tipo"])
    soggetto_id = dati["soggetto_id"] if "soggetto_id" in dati else esistente["soggetto_id"]
    soggetto_tipo, soggetto_id = valida_soggetto(soggetto_tipo, soggetto_id, tipo)

    rilascio, scadenza = risolvi_date_scadenza(dati, tipo, esistente)

    documento_rif = (testo_o_none(dati.get("documento_rif"))
                     if "documento_rif" in dati else esistente["documento_rif"])
    referente = (testo_o_none(dati.get("referente"))
                 if "referente" in dati else esistente["referente"])
    note = testo_o_none(dati.get("note")) if "note" in dati else esistente["note"]
    chiusa = (valida_flag(dati["chiusa"], "chiusa")
              if "chiusa" in dati else esistente["chiusa"])

    conn = db()
    conn.execute(
        "UPDATE scadenze SET tipo_id = ?, soggetto_tipo = ?, soggetto_id = ?, "
        "data_rilascio = ?, data_scadenza = ?, documento_rif = ?, referente = ?, note = ?, chiusa = ? "
        "WHERE id = ?",
        (tipo_id, soggetto_tipo, soggetto_id, rilascio, scadenza,
         documento_rif, referente, note, chiusa, scadenza_id))
    conn.commit()
    return jsonify(carica_scadenza_arricchita(scadenza_id))


@app.post("/api/scadenze/<int:scadenza_id>/rinnova")
def scadenze_rinnova(scadenza_id: int):
    corrente = leggi_scadenza_grezza(scadenza_id)
    if corrente["chiusa"]:
        # Evita i duplicati da doppio click/doppia POST: una scadenza già
        # chiusa è già stata rinnovata (o archiviata) e non si rinnova di nuovo.
        raise ErroreApi("La scadenza è già chiusa: rinnovo non consentito. "
                        "Rinnovare la scadenza attiva corrispondente.", 409)
    dati = corpo_json()
    if not dati.get("data_rilascio"):
        raise ErroreApi("Il campo 'data_rilascio' è obbligatorio per il rinnovo")
    rilascio = valida_data_iso(dati["data_rilascio"], "data_rilascio")
    tipo = leggi_tipo_per_scadenza(corrente["tipo_id"])

    if dati.get("data_scadenza"):
        scadenza = valida_data_iso(dati["data_scadenza"], "data_scadenza")
    elif tipo["validita_mesi"]:
        scadenza = aggiungi_mesi(rilascio, tipo["validita_mesi"])
    else:
        raise ErroreApi(
            f"Il tipo '{tipo['nome']}' non ha una validità in mesi: "
            "indicare esplicitamente 'data_scadenza'")

    conn = db()
    conn.execute("UPDATE scadenze SET chiusa = 1 WHERE id = ?", (scadenza_id,))
    cur = conn.execute(
        "INSERT INTO scadenze (tipo_id, soggetto_tipo, soggetto_id, data_rilascio, "
        "data_scadenza, documento_rif, referente, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (corrente["tipo_id"], corrente["soggetto_tipo"], corrente["soggetto_id"],
         rilascio, scadenza, testo_o_none(dati.get("documento_rif")),
         corrente["referente"], testo_o_none(dati.get("note"))))
    conn.commit()
    return jsonify(carica_scadenza_arricchita(cur.lastrowid)), 201


@app.delete("/api/scadenze/<int:scadenza_id>")
def scadenze_elimina(scadenza_id: int):
    leggi_scadenza_grezza(scadenza_id)
    conn = db()
    # I file allegati vanno rimossi dal disco prima di cancellare le righe
    # (adempimenti e allegati spariscono via ON DELETE CASCADE).
    for riga in conn.execute(
            "SELECT percorso FROM allegati WHERE scadenza_id = ?", (scadenza_id,)).fetchall():
        _rimuovi_file_allegato(riga["percorso"])
    conn.execute("DELETE FROM notifiche_log WHERE scadenza_id = ?", (scadenza_id,))
    conn.execute("DELETE FROM scadenze WHERE id = ?", (scadenza_id,))
    conn.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Import massivo scadenze (con risoluzione tipo/soggetto per nome)
# ---------------------------------------------------------------------------

IMPORT_CAMPI_SCADENZE = [
    ("tipo_nome", "Tipo scadenza (nome esatto)", "Visita medica idoneità"),
    ("soggetto", "Soggetto (nome; vuoto se azienda)", "Mario Rossi"),
    ("data_rilascio", "Data rilascio (gg/mm/aaaa)", "01/07/2026"),
    ("data_scadenza", "Data scadenza (gg/mm/aaaa, vuoto = calcolata)", ""),
    ("documento_rif", "Documento rif.", ""),
    ("referente", "Referente", ""),
    ("note", "Note", ""),
]


def _parse_data_import(valore):
    """Accetta ISO o gg/mm/aaaa (le celle-data xlsx arrivano già in ISO dal lettore)."""
    if valore is None or str(valore).strip() == "":
        return None
    testo = str(valore).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(testo, fmt).date().isoformat()
        except ValueError:
            continue
    raise ErroreApi(f"Data non valida: {valore!r} (usa il formato gg/mm/aaaa)")


def _risolvi_soggetto_import(conn, soggetto_tipo, nome):
    """Risolve l'id del soggetto dal nome (case-insensitive, unicode). Errore se
    assente o ambiguo."""
    config_tab = {
        "dipendente": ("dipendenti", lambda r: f"{r['nome']} {r['cognome']}"),
        "subappaltatore": ("subappaltatori", lambda r: r["ragione_sociale"]),
        "attrezzatura": ("attrezzature", lambda r: r["descrizione"]),
        "sistema_ia": ("sistemi_ia", lambda r: r["nome"]),
    }[soggetto_tipo]
    tabella, etichetta = config_tab
    bersaglio = nome.strip().lower()
    trovati = [r["id"] for r in conn.execute(f"SELECT * FROM {tabella}")
               if (etichetta(r) or "").strip().lower() == bersaglio]
    if not trovati:
        raise ErroreApi(f"{soggetto_tipo} «{nome}» non trovato in anagrafica")
    if len(trovati) > 1:
        raise ErroreApi(f"{soggetto_tipo} «{nome}» ambiguo ({len(trovati)} corrispondenze): "
                        "disambigua o inserisci la scadenza manualmente")
    return trovati[0]


@app.get("/api/scadenze/modello.xlsx")
def scadenze_modello():
    intestazioni = [h for (_, h, _) in IMPORT_CAMPI_SCADENZE]
    esempi = [[e for (_, _, e) in IMPORT_CAMPI_SCADENZE]]
    guida = ("Una scadenza per riga. «Tipo scadenza» deve corrispondere esattamente al nome di un "
             "tipo esistente (vedi Impostazioni); «Soggetto» è il nome del dipendente/subappaltatore/"
             "attrezzatura/sistema IA (lascia vuoto per le scadenze aziendali). Se la data di scadenza "
             "è vuota e il tipo ha una validità, viene calcolata dalla data di rilascio.")
    return costruisci_modello_xlsx(intestazioni, esempi, "Modello import — Scadenze",
                                   guida, "modello_scadenze.xlsx")


@app.post("/api/scadenze/import")
def scadenze_import():
    percorso = salva_file_caricato((".xlsx", ".csv", ".txt"))
    try:
        righe = importer.leggi_righe_tabellari(percorso)
    except ValueError as err:
        raise ErroreApi(str(err), 400)
    finally:
        try:
            os.unlink(percorso)
        except OSError:
            pass
    if not righe:
        raise ErroreApi("Nessuna riga trovata nel file.", 400)

    mappa = _mappa_import_campi(IMPORT_CAMPI_SCADENZE)

    conn = db()
    tipi = {r["nome"].strip().lower(): dict(r)
            for r in conn.execute("SELECT id, nome, soggetto, validita_mesi FROM tipi_scadenza")}

    importati = saltati = 0
    errori = []
    for numero, riga in enumerate(righe, start=2):
        dati = {}
        for chiave, valore in riga.items():
            campo = mappa.get(chiave)
            if campo is not None and valore is not None and str(valore).strip() != "":
                dati[campo] = valore
        if not dati.get("tipo_nome"):
            continue
        tipo = tipi.get(str(dati["tipo_nome"]).strip().lower())
        if tipo is None:
            errori.append(f"Riga {numero}: tipo «{dati['tipo_nome']}» non trovato")
            continue
        try:
            soggetto_tipo = tipo["soggetto"]
            if soggetto_tipo == "azienda":
                soggetto_id = None
            else:
                nome_sogg = dati.get("soggetto")
                if not nome_sogg:
                    raise ErroreApi(f"soggetto obbligatorio per il tipo «{tipo['nome']}»")
                soggetto_id = _risolvi_soggetto_import(conn, soggetto_tipo, str(nome_sogg))

            rilascio = _parse_data_import(dati.get("data_rilascio"))
            scadenza = _parse_data_import(dati.get("data_scadenza"))
            if not scadenza:
                if rilascio and tipo["validita_mesi"]:
                    scadenza = aggiungi_mesi(rilascio, tipo["validita_mesi"])
                else:
                    raise ErroreApi("indicare la data di scadenza (o una data di rilascio con tipo a validità)")
        except ErroreApi as e:
            errori.append(f"Riga {numero}: {e.messaggio}")
            continue

        conn.execute(
            "INSERT INTO scadenze (tipo_id, soggetto_tipo, soggetto_id, data_rilascio, "
            "data_scadenza, documento_rif, referente, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (tipo["id"], soggetto_tipo, soggetto_id, rilascio, scadenza,
             testo_o_none(dati.get("documento_rif")), testo_o_none(dati.get("referente")),
             testo_o_none(dati.get("note"))))
        importati += 1

    conn.commit()
    return jsonify({"importati": importati, "saltati": saltati, "errori": errori})


# ---------------------------------------------------------------------------
# Checklist adempimenti (sotto-attività di una scadenza)
# ---------------------------------------------------------------------------

def _adempimento_dict(riga: sqlite3.Row) -> dict:
    return dict(riga)


def leggi_adempimento(adempimento_id: int) -> dict:
    riga = db().execute(
        "SELECT * FROM adempimenti WHERE id = ?", (adempimento_id,)).fetchone()
    if riga is None:
        raise ErroreApi("Adempimento non trovato", 404)
    return dict(riga)


@app.get("/api/scadenze/<int:scadenza_id>/adempimenti")
def adempimenti_lista(scadenza_id: int):
    leggi_scadenza_grezza(scadenza_id)
    righe = db().execute(
        "SELECT * FROM adempimenti WHERE scadenza_id = ? ORDER BY ordine ASC, id ASC",
        (scadenza_id,)).fetchall()
    return jsonify([_adempimento_dict(r) for r in righe])


@app.post("/api/scadenze/<int:scadenza_id>/adempimenti")
def adempimenti_crea(scadenza_id: int):
    leggi_scadenza_grezza(scadenza_id)
    dati = corpo_json()
    descrizione = testo_o_none(dati.get("descrizione"))
    if not descrizione:
        raise ErroreApi("Il campo 'descrizione' è obbligatorio")
    conn = db()
    ordine = conn.execute(
        "SELECT COALESCE(MAX(ordine), -1) + 1 FROM adempimenti WHERE scadenza_id = ?",
        (scadenza_id,)).fetchone()[0]
    fatto = valida_flag(dati.get("fatto", 0), "fatto")
    fatto_il = datetime.now().isoformat(" ", "seconds") if fatto else None
    cur = conn.execute(
        "INSERT INTO adempimenti (scadenza_id, descrizione, fatto, fatto_il, ordine, note) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (scadenza_id, descrizione, fatto, fatto_il, ordine, testo_o_none(dati.get("note"))))
    conn.commit()
    return jsonify(leggi_adempimento(cur.lastrowid)), 201


@app.put("/api/adempimenti/<int:adempimento_id>")
def adempimenti_aggiorna(adempimento_id: int):
    esistente = leggi_adempimento(adempimento_id)
    dati = corpo_json()

    descrizione = esistente["descrizione"]
    if "descrizione" in dati:
        descrizione = testo_o_none(dati["descrizione"])
        if not descrizione:
            raise ErroreApi("Il campo 'descrizione' non può essere vuoto")

    fatto = esistente["fatto"]
    fatto_il = esistente["fatto_il"]
    if "fatto" in dati:
        nuovo_fatto = valida_flag(dati["fatto"], "fatto")
        if nuovo_fatto and not esistente["fatto"]:
            fatto_il = datetime.now().isoformat(" ", "seconds")
        elif not nuovo_fatto:
            fatto_il = None
        fatto = nuovo_fatto

    note = testo_o_none(dati.get("note")) if "note" in dati else esistente["note"]

    conn = db()
    conn.execute(
        "UPDATE adempimenti SET descrizione = ?, fatto = ?, fatto_il = ?, note = ? WHERE id = ?",
        (descrizione, fatto, fatto_il, note, adempimento_id))
    conn.commit()
    return jsonify(leggi_adempimento(adempimento_id))


@app.delete("/api/adempimenti/<int:adempimento_id>")
def adempimenti_elimina(adempimento_id: int):
    leggi_adempimento(adempimento_id)
    conn = db()
    conn.execute("DELETE FROM adempimenti WHERE id = ?", (adempimento_id,))
    conn.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Allegati (evidenze/documenti di una scadenza)
# ---------------------------------------------------------------------------

def _assicura_allegati_dir() -> str:
    os.makedirs(config.ALLEGATI_DIR, exist_ok=True)
    return config.ALLEGATI_DIR


def _rimuovi_file_allegato(percorso: str) -> None:
    """Rimuove dal disco un file allegato (percorso = nome file dentro ALLEGATI_DIR)."""
    if not percorso:
        return
    try:
        os.remove(os.path.join(config.ALLEGATI_DIR, percorso))
    except OSError:
        pass


def leggi_allegato(allegato_id: int) -> dict:
    riga = db().execute("SELECT * FROM allegati WHERE id = ?", (allegato_id,)).fetchone()
    if riga is None:
        raise ErroreApi("Allegato non trovato", 404)
    return dict(riga)


@app.get("/api/scadenze/<int:scadenza_id>/allegati")
def allegati_lista(scadenza_id: int):
    leggi_scadenza_grezza(scadenza_id)
    righe = db().execute(
        "SELECT id, scadenza_id, nome_file, dimensione, caricato_il "
        "FROM allegati WHERE scadenza_id = ? ORDER BY caricato_il DESC, id DESC",
        (scadenza_id,)).fetchall()
    return jsonify([dict(r) for r in righe])


@app.post("/api/scadenze/<int:scadenza_id>/allegati")
def allegati_carica(scadenza_id: int):
    leggi_scadenza_grezza(scadenza_id)
    if "file" not in request.files or not request.files["file"].filename:
        raise ErroreApi("Nessun file caricato (campo multipart 'file' mancante)")
    caricato = request.files["file"]
    nome_originale = caricato.filename
    estensione = os.path.splitext(nome_originale)[1].lower()
    if estensione not in config.ALLEGATI_ESTENSIONI:
        raise ErroreApi(
            f"Estensione non consentita. Ammesse: {', '.join(config.ALLEGATI_ESTENSIONI)}")

    _assicura_allegati_dir()
    nome_salvato = f"{uuid.uuid4().hex}{estensione}"
    percorso_completo = os.path.join(config.ALLEGATI_DIR, nome_salvato)
    caricato.save(percorso_completo)

    dimensione = os.path.getsize(percorso_completo)
    if dimensione > config.ALLEGATI_MAX_BYTE:
        _rimuovi_file_allegato(nome_salvato)
        raise ErroreApi(
            f"File troppo grande (max {config.ALLEGATI_MAX_BYTE // (1024 * 1024)} MB)")

    conn = db()
    cur = conn.execute(
        "INSERT INTO allegati (scadenza_id, nome_file, percorso, dimensione) "
        "VALUES (?, ?, ?, ?)",
        (scadenza_id, secure_filename(nome_originale) or nome_salvato, nome_salvato, dimensione))
    conn.commit()
    riga = leggi_allegato(cur.lastrowid)
    riga.pop("percorso", None)  # il path interno non esce dall'API
    return jsonify(riga), 201


@app.get("/api/allegati/<int:allegato_id>/download")
def allegati_download(allegato_id: int):
    allegato = leggi_allegato(allegato_id)
    percorso_completo = os.path.join(config.ALLEGATI_DIR, allegato["percorso"])
    if not os.path.exists(percorso_completo):
        raise ErroreApi("File allegato non presente su disco", 404)
    return send_file(percorso_completo, as_attachment=True,
                     download_name=allegato["nome_file"])


@app.delete("/api/allegati/<int:allegato_id>")
def allegati_elimina(allegato_id: int):
    allegato = leggi_allegato(allegato_id)
    _rimuovi_file_allegato(allegato["percorso"])
    conn = db()
    conn.execute("DELETE FROM allegati WHERE id = ?", (allegato_id,))
    conn.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Sessioni corso
# ---------------------------------------------------------------------------

@app.get("/api/sessioni")
def sessioni_lista():
    righe = db().execute(
        "SELECT * FROM sessioni_corso ORDER BY data_inizio ASC, id ASC").fetchall()
    risultato = []
    for r in righe:
        s = dict(r)
        try:
            s["lezioni"] = json.loads(s.pop("lezioni_json") or "[]")
        except (ValueError, TypeError):
            s["lezioni"] = []
        risultato.append(s)
    return jsonify(risultato)


@app.delete("/api/sessioni/<int:sessione_id>")
def sessioni_elimina(sessione_id: int):
    conn = db()
    riga = conn.execute(
        "SELECT id FROM sessioni_corso WHERE id = ?", (sessione_id,)).fetchone()
    if riga is None:
        raise ErroreApi("Sessione corso non trovata", 404)
    conn.execute("DELETE FROM sessioni_corso WHERE id = ?", (sessione_id,))
    conn.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Import / export
# ---------------------------------------------------------------------------

def salva_file_caricato(estensioni: tuple[str, ...]) -> str:
    """Salva il file multipart 'file' in un percorso temporaneo; ritorna il path."""
    if "file" not in request.files or not request.files["file"].filename:
        raise ErroreApi("Nessun file caricato (campo multipart 'file' mancante)")
    caricato = request.files["file"]
    estensione = os.path.splitext(caricato.filename)[1].lower()
    if estensione not in estensioni:
        raise ErroreApi(
            f"Formato file non valido: atteso {' o '.join(estensioni)}")
    fd, percorso = tempfile.mkstemp(suffix=estensione)
    os.close(fd)
    caricato.save(percorso)
    return percorso


@app.get("/api/export/calendario_modello.xlsx")
def export_calendario_modello():
    """Genera la 'maschera' Excel vuota del Calendario Corsi, con la struttura
    esatta attesa dall'import (foglio 'Calendario Corsi', intestazione a riga 4:
    AULA | CICLO | N° PERS. | GIORNO | LEZ. 1..6 | DOCENTE | SEDE) e due righe
    d'esempio da sostituire."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill

    intestazioni = ["AULA", "CICLO", "N° PERS.", "GIORNO",
                    "LEZ. 1", "LEZ. 2", "LEZ. 3", "LEZ. 4", "LEZ. 5", "LEZ. 6",
                    "DOCENTE", "SEDE"]
    ultima_col = len(intestazioni)  # 12 → colonna L

    wb = Workbook()
    ws = wb.active
    ws.title = importer.NOME_FOGLIO_CALENDARIO  # deve essere "Calendario Corsi"

    # Riga 1: titolo · Riga 2: istruzioni · Riga 4: intestazione (come nel file reale)
    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=ultima_col)
    titolo = ws.cell(row=1, column=1, value="Calendario Corsi — modello di importazione")
    titolo.font = Font(bold=True, size=14, color="0C4577")
    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=ultima_col)
    guida = ws.cell(
        row=2, column=1,
        value=("Compila una riga per aula. La cella AULA deve iniziare con «AULA» (es. AULA 1). "
               "Le celle LEZ. sono date (gg/mm/aaaa). Non modificare né spostare la riga di "
               "intestazione (riga 4). Sostituisci le righe d'esempio con i tuoi dati."))
    guida.font = Font(italic=True, size=10, color="66707A")
    guida.alignment = Alignment(wrap_text=True, vertical="center")
    ws.row_dimensions[2].height = 30

    riga_header = 4
    intestazione_font = Font(bold=True, color="FFFFFF")
    sfondo_navy = PatternFill("solid", fgColor="0C4577")
    for col, nome in enumerate(intestazioni, start=1):
        cella = ws.cell(row=riga_header, column=col, value=nome)
        cella.font = intestazione_font
        cella.fill = sfondo_navy
        cella.alignment = Alignment(horizontal="center")

    # Due righe d'esempio (date coerenti, formato italiano) da sostituire
    esempi = [
        ["AULA 1", "Ciclo 1", 12, "Lunedì",
         date(2026, 9, 7), date(2026, 9, 14), date(2026, 9, 21),
         date(2026, 9, 28), date(2026, 10, 5), date(2026, 10, 12),
         "Mario Rossi", "Sede Centrale"],
        ["AULA 2", "Ciclo 1", 10, "Martedì",
         date(2026, 9, 8), date(2026, 9, 15), date(2026, 9, 22),
         date(2026, 9, 29), date(2026, 10, 6), date(2026, 10, 13),
         "Laura Bianchi", "Cantiere Nord"],
    ]
    for i, riga in enumerate(esempi):
        r = riga_header + 1 + i
        for col, valore in enumerate(riga, start=1):
            cella = ws.cell(row=r, column=col, value=valore)
            if isinstance(valore, date):
                cella.number_format = "DD/MM/YYYY"

    larghezze = [10, 10, 9, 11, 12, 12, 12, 12, 12, 12, 18, 18]
    for col, larghezza in enumerate(larghezze, start=1):
        ws.column_dimensions[ws.cell(row=riga_header, column=col).column_letter].width = larghezza
    ws.freeze_panes = f"A{riga_header + 1}"

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return send_file(
        buffer,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name="modello_calendario_corsi.xlsx",
    )


@app.post("/api/import/calendario")
def import_calendario():
    percorso = salva_file_caricato((".xlsx",))
    try:
        risultato = importer.importa_calendario_corsi(percorso)
    except ValueError as err:
        # File formalmente valido ma contenuto non conforme (foglio mancante,
        # header assente, nessuna riga dati): errore chiaro all'utente → 400.
        raise ErroreApi(str(err), 400)
    finally:
        try:
            os.unlink(percorso)
        except OSError:
            pass
    return jsonify(risultato)


@app.post("/api/import/dipendenti")
def import_dipendenti():
    percorso = salva_file_caricato((".csv", ".txt"))
    try:
        risultato = importer.importa_dipendenti_csv(percorso)
    except ValueError as err:
        # CSV vuoto o senza colonne nome/cognome: messaggio esplicativo → 400.
        raise ErroreApi(str(err), 400)
    finally:
        try:
            os.unlink(percorso)
        except OSError:
            pass
    return jsonify(risultato)


# Colonne export xlsx: stesse della scadenza arricchita
COLONNE_EXPORT = [
    ("id", "ID"),
    ("tipo_nome", "Tipo"),
    ("categoria", "Categoria"),
    ("soggetto_tipo", "Tipo soggetto"),
    ("soggetto_nome", "Soggetto"),
    ("cantiere", "Cantiere"),
    ("data_rilascio", "Data rilascio"),
    ("data_scadenza", "Data scadenza"),
    ("documento_rif", "Documento rif."),
    ("referente", "Referente"),
    ("note", "Note"),
    ("chiusa", "Chiusa"),
    ("stato", "Stato"),
    ("giorni_rimanenti", "Giorni rimanenti"),
    ("preavviso_giorni", "Preavviso (gg)"),
]


ETICHETTE_RISCHIO = {
    "vietato": "Vietato (art. 5)", "alto_rischio": "Alto rischio", "limitato": "Rischio limitato",
    "minimo": "Rischio minimo", "gpai": "GPAI (finalità generali)", "da_valutare": "Da valutare",
}
ETICHETTE_RUOLO = {
    "deployer": "Deployer (utilizzatore)", "provider": "Provider (fornitore)",
    "importatore": "Importatore", "distributore": "Distributore",
}
ETICHETTE_CONFORMITA = {
    "da_valutare": "Da valutare", "in_corso": "In corso", "conforme": "Conforme",
    "non_conforme": "Non conforme", "dismesso": "Dismesso",
}


@app.get("/api/export/ai_act.xlsx")
def export_ai_act():
    """Dossier AI Act: scadenze normative, registro sistemi IA e checklist adempimenti,
    su tre fogli, pronto per audit interno o richiesta dell'autorità."""
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    intestazione = Font(bold=True, color="FFFFFF")
    sfondo_navy = PatternFill("solid", fgColor="0C4577")

    def scrivi_foglio(ws, colonne, righe):
        for col, (_, etichetta) in enumerate(colonne, start=1):
            cella = ws.cell(row=1, column=col, value=etichetta)
            cella.font = intestazione
            cella.fill = sfondo_navy
        for r, dati_riga in enumerate(righe, start=2):
            for col, (campo, _) in enumerate(colonne, start=1):
                ws.cell(row=r, column=col, value=dati_riga.get(campo))
        for col, (campo, etichetta) in enumerate(colonne, start=1):
            larghezza = max([len(str(etichetta))] +
                            [len(str(dr.get(campo) or "")) for dr in righe] + [8])
            ws.column_dimensions[ws.cell(row=1, column=col).column_letter].width = \
                min(larghezza + 3, 60)
        ws.freeze_panes = "A2"

    conn = db()

    # Foglio 1 — Scadenze AI Act (categoria ai_act, incluse le chiuse)
    scadenze = carica_scadenze_arricchite("t.categoria = 'ai_act'")
    for s in scadenze:
        s["stato_it"] = {"scaduta": "Scaduta", "in_scadenza": "In scadenza",
                         "valida": "Valida", "chiusa": "Chiusa"}.get(s["stato"], s["stato"])
        tot = s.get("adempimenti_totali") or 0
        s["checklist"] = f"{s.get('adempimenti_fatti') or 0}/{tot}" if tot else "—"
    col_scad = [
        ("tipo_nome", "Adempimento"), ("soggetto_nome", "Soggetto"),
        ("data_scadenza", "Scadenza"), ("stato_it", "Stato"),
        ("giorni_rimanenti", "Giorni"), ("referente", "Referente"),
        ("checklist", "Checklist"), ("allegati_totali", "Allegati"), ("note", "Note"),
    ]

    # Foglio 2 — Registro Sistemi IA
    sistemi = [dict(r) for r in conn.execute(
        "SELECT * FROM sistemi_ia ORDER BY nome").fetchall()]
    for si in sistemi:
        si["classe_it"] = ETICHETTE_RISCHIO.get(si["classe_rischio"], si["classe_rischio"])
        si["ruolo_it"] = ETICHETTE_RUOLO.get(si["ruolo"], si["ruolo"])
        si["conf_it"] = ETICHETTE_CONFORMITA.get(si["stato_conformita"], si["stato_conformita"])
        si["attivo_it"] = "Sì" if si["attivo"] else "No"
    col_sist = [
        ("nome", "Sistema IA"), ("fornitore", "Fornitore"), ("finalita", "Finalità"),
        ("classe_it", "Classe di rischio"), ("ruolo_it", "Ruolo"),
        ("conf_it", "Stato conformità"), ("referente", "Referente"),
        ("cantiere", "Cantiere"), ("attivo_it", "Attivo"), ("note", "Note"),
    ]

    # Foglio 3 — Checklist adempimenti delle scadenze AI Act
    voci = [dict(r) for r in conn.execute(
        """SELECT t.nome AS adempimento, ad.descrizione, ad.fatto, ad.fatto_il, ad.note
           FROM adempimenti ad
           JOIN scadenze s ON s.id = ad.scadenza_id
           JOIN tipi_scadenza t ON t.id = s.tipo_id
           WHERE t.categoria = 'ai_act'
           ORDER BY t.nome, ad.ordine, ad.id""").fetchall()]
    for v in voci:
        v["fatto_it"] = "Fatto" if v["fatto"] else "Da fare"
    col_voci = [
        ("adempimento", "Adempimento"), ("descrizione", "Voce checklist"),
        ("fatto_it", "Stato"), ("fatto_il", "Completato il"), ("note", "Note"),
    ]

    wb = Workbook()
    scrivi_foglio(wb.active, col_scad, scadenze)
    wb.active.title = "Scadenze AI Act"
    scrivi_foglio(wb.create_sheet("Registro Sistemi IA"), col_sist, sistemi)
    scrivi_foglio(wb.create_sheet("Checklist"), col_voci, voci)

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return send_file(
        buffer,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name="dossier_ai_act.xlsx",
    )


@app.get("/api/export/scadenze.xlsx")
def export_scadenze():
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill

    # Stessi filtri (e stessa esclusione di default delle chiuse) della lista:
    # il file esportato corrisponde a ciò che la tabella mostra.
    stato, q, where, parametri = leggi_filtri_scadenze()
    scadenze = carica_scadenze_arricchite(where, parametri)
    scadenze = filtra_scadenze(scadenze, stato=stato, q=q)

    wb = Workbook()
    ws = wb.active
    ws.title = "Scadenze"
    intestazione = Font(bold=True, color="FFFFFF")
    sfondo_navy = PatternFill("solid", fgColor="0C4577")
    for colonna, (_, etichetta) in enumerate(COLONNE_EXPORT, start=1):
        cella = ws.cell(row=1, column=colonna, value=etichetta)
        cella.font = intestazione
        cella.fill = sfondo_navy
    for riga, s in enumerate(scadenze, start=2):
        for colonna, (campo, _) in enumerate(COLONNE_EXPORT, start=1):
            ws.cell(row=riga, column=colonna, value=s.get(campo))
    for colonna, (campo, etichetta) in enumerate(COLONNE_EXPORT, start=1):
        larghezza = max([len(etichetta)] +
                        [len(str(s.get(campo) or "")) for s in scadenze])
        ws.column_dimensions[ws.cell(row=1, column=colonna).column_letter].width = \
            min(larghezza + 3, 45)
    ws.freeze_panes = "A2"

    buffer = io.BytesIO()
    wb.save(buffer)
    buffer.seek(0)
    return send_file(
        buffer,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name="scadenze.xlsx",
    )


# ---------------------------------------------------------------------------
# Notifiche
# ---------------------------------------------------------------------------

@app.get("/api/notifiche/riepilogo")
def notifiche_riepilogo():
    return jsonify({"da_notificare": notifiche.scadenze_da_notificare()})


@app.post("/api/notifiche/esegui")
def notifiche_esegui():
    return jsonify(notifiche.esegui_notifiche())


@app.get("/api/notifiche/log")
def notifiche_log():
    limite = valida_intero(request.args.get("limit", 50), "limit", minimo=1)
    limite = min(limite, 500)
    righe = db().execute(
        """
        SELECT nl.id, nl.scadenza_id, nl.canale, nl.messaggio, nl.esito, nl.inviata_il,
               t.nome AS tipo_nome, s.data_scadenza
        FROM notifiche_log nl
        LEFT JOIN scadenze s ON s.id = nl.scadenza_id
        LEFT JOIN tipi_scadenza t ON t.id = s.tipo_id
        ORDER BY nl.inviata_il DESC, nl.id DESC
        LIMIT ?
        """,
        (limite,)).fetchall()
    return jsonify([dict(r) for r in righe])


# ---------------------------------------------------------------------------
# Spegnimento automatico alla chiusura della pagina
# ---------------------------------------------------------------------------

# La SPA invia un heartbeat periodico finché almeno una scheda è aperta; quando
# gli heartbeat cessano il watchdog spegne il server. Il watchdog si arma solo
# dopo il primo heartbeat: prima che il browser apra la pagina il server non
# deve spegnersi da solo.
_ultimo_heartbeat = None
_lock_heartbeat = threading.Lock()


@app.post("/api/heartbeat")
def api_heartbeat():
    global _ultimo_heartbeat
    with _lock_heartbeat:
        _ultimo_heartbeat = time.monotonic()
    return jsonify({"ok": True})


def _watchdog_heartbeat():
    while True:
        time.sleep(config.HEARTBEAT_CONTROLLO_SECONDI)
        with _lock_heartbeat:
            ultimo = _ultimo_heartbeat
        if ultimo is None:
            continue
        if time.monotonic() - ultimo > config.HEARTBEAT_TIMEOUT_SECONDI:
            print("Nessuna scheda aperta: spegnimento del server.", flush=True)
            # os._exit evita di dover fermare waitress dall'interno: le
            # connessioni SQLite sono per-richiesta e già chiuse dal teardown.
            os._exit(0)


def avvia_watchdog_heartbeat():
    threading.Thread(target=_watchdog_heartbeat, daemon=True).start()


# ---------------------------------------------------------------------------
# Frontend (SPA)
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    return render_template("index.html")


# ---------------------------------------------------------------------------
# Avvio
# ---------------------------------------------------------------------------

# Il DB viene creato/aggiornato anche quando l'app è importata da un runner esterno
database.init_db()

if __name__ == "__main__":
    visibile = "localhost" if config.HOST == "0.0.0.0" else config.HOST
    indirizzo = f"http://{visibile}:{config.PORT}"
    if config.HOST == "0.0.0.0":
        indirizzo += " (e in LAN)"
    avvia_watchdog_heartbeat()
    try:
        from waitress import serve
        print(f"Scadenzario Cosedil — waitress su {indirizzo}")
        serve(app, host=config.HOST, port=config.PORT, threads=8)
    except ImportError:
        print(f"waitress non disponibile — dev server Flask su {indirizzo}")
        app.run(host=config.HOST, port=config.PORT, debug=False)
