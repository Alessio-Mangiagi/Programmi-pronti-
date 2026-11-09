# "><(((º> sabusabu <º)))><"
"""Dialogo con le altre app della suite (InCampo, SkyTower, Lettore DDT).

Tre famiglie di rotte:
  * ``/api/suite/...``: quello che il Magazzino offre alle altre app, protetto dal
    token di servizio (``shared/suite/suite_link.py``), fuori dal gate SSO.
    Oggi: le giacenze e i mezzi di una commessa (le vede InCampo nella scheda cantiere).
  * ``/api/incampo/...`` e ``/api/skytower/...``: quello che l'utente del Magazzino
    chiede alle altre app (task e non conformità del cantiere, segnalazione di un
    mezzo, cantieri da importare, documenti pubblicati, invio del report giacenze).
    Passano dal gate SSO come tutte le altre API.
  * programma unico "DDT e Magazzino" (09/11/2026, CONTRATTI § 11): il carico immediato che il
    Lettore DDT manda appena salva un export (``/api/suite/ddt/consegne``, token di servizio) e il
    riepilogo giornaliero dei movimenti verso SkyTower (``/api/riepiloghi``, riepilogo.py).

La chiave è il codice commessa aziendale scritto sull'ubicazione.
Importato in fondo ad app.py: usa le sue funzioni (db, registra, ...).
"""
import json
import logging
import os
import sys
import urllib.parse
from datetime import datetime

import config
import importa_ddt
import pdf_semplice
import prefisso
import riepilogo
from app import (
    ApiError,
    _dati_ubicazione,
    _lock_import,
    app,
    corpo,
    db,
    e_admin,
    nome_utente,
    registra,
    righe,
    testo,
    utente_corrente,
)
from flask import g, jsonify, request

sys.path.insert(0, os.path.join(config.SUITE_DIR, "shared", "suite"))
import codici
import suite_link

log = logging.getLogger("magazzino.suite")

# --------------------------------------------------------------------------- utilità

def url_magazzino():
    """Indirizzo del Magazzino da mostrare fuori (da fare del portale, InCampo, task).

    Programma unico "DDT e Magazzino" (09/11/2026): gli utenti lo aprono dentro il Lettore DDT, a
    <Lettore DDT>/magazzino, e la porta propria (5200) ascolta solo sulla macchina (CONTRATTI § 11, C1).
    Ordine: MAGAZZINO_URL_PUBBLICO → SUITE_URL_PUBBLICO_MAGAZZINO (indirizzo forzato della suite) →
    Lettore DDT + /magazzino; con MAGAZZINO_PROGRAMMA_UNICO=0 l'indirizzo proprio, come prima."""
    if config.URL_PUBBLICO:
        return config.URL_PUBBLICO
    # la regola "dentro il Lettore DDT a /magazzino" sta in suite_link.url_pubblico (la usano anche InCampo e
    # Analista); qui le si passa la configurazione del Magazzino, che può valere MAGAZZINO_PROGRAMMA_UNICO=0
    return suite_link.url_pubblico("magazzino", magazzino_dentro_ddt=config.PROGRAMMA_UNICO)


def _richiede_token():
    if not suite_link.verifica(request.headers.get(suite_link.HEADER_TOKEN)):
        raise ApiError("Token di servizio della suite non valido", 403)
    # L'azione resta attribuita all'utente dell'altra app, non a un anonimo.
    utente = request.headers.get(suite_link.HEADER_UTENTE) or "suite"
    g.cosedil = {"username": utente, "nome": request.headers.get(suite_link.HEADER_NOME) or utente, "admin": False}


def _ubicazioni_commessa(c, codice):
    """Ubicazioni attive con quel codice commessa (confronto senza spazi, maiuscolo)."""
    chiave = suite_link.normalizza_commessa(codice)
    if not chiave:
        return []
    tutte = righe(c.execute("SELECT * FROM ubicazioni WHERE attivo = 1 AND commessa IS NOT NULL AND commessa != ''"))
    return [u for u in tutte if suite_link.normalizza_commessa(u["commessa"]) == chiave]


def _giacenze_commessa(c, codice):
    ubi = _ubicazioni_commessa(c, codice)
    if not ubi:
        return None
    ids = [u["id"] for u in ubi]
    segna = ",".join("?" * len(ids))
    articoli = righe(c.execute(
        f"SELECT g.articolo_id, a.codice, a.descrizione, a.um, a.categoria, g.quantita, g.ultimo_movimento, "
        f"u.nome AS ubicazione, u.id AS ubicazione_id FROM giacenze g JOIN articoli a ON a.id = g.articolo_id "
        f"JOIN ubicazioni u ON u.id = g.ubicazione_id WHERE g.ubicazione_id IN ({segna}) AND g.quantita != 0 "
        f"ORDER BY a.descrizione, u.nome", ids))
    mezzi = righe(c.execute(
        f"SELECT m.id, m.codice, m.tipo_mezzo, m.marca, m.modello, m.targa, m.matricola, m.stato, m.assegnato_a, "
        f"m.proprieta, m.ditta, m.nolo_al, u.nome AS ubicazione FROM mezzi m JOIN ubicazioni u ON u.id = m.ubicazione_id "
        f"WHERE m.ubicazione_id IN ({segna}) AND m.attivo = 1 ORDER BY m.tipo_mezzo, m.marca", ids))
    base = url_magazzino()
    for u in ubi:
        u["url"] = f"{base}/#scansione/{u['codice']}"
    for a in articoli:
        a["url"] = f"{base}/#scansione/{a['codice']}"
    for m in mezzi:
        m["url"] = f"{base}/#scansione/{m['codice']}"
    return {"commessa": ubi[0]["commessa"], "ubicazioni": ubi, "articoli": articoli, "mezzi": mezzi,
            "totali": {"articoli": len({a["articolo_id"] for a in articoli}), "mezzi": len(mezzi),
                       "mezzi_in_uso": sum(1 for m in mezzi if m["stato"] == "in_uso")},
            "url": f"{base}/#giacenze", "aggiornato_il": datetime.now().isoformat(timespec="seconds")}


def _chi():
    u = utente_corrente() or {}
    return {"utente": u.get("username") or nome_utente(), "nome": u.get("nome")}


def _chiama(app_id, metodo, percorso, **kw):
    try:
        return suite_link.chiama(app_id, metodo, percorso, **_chi(), **kw)
    except suite_link.SuiteError as e:
        if e.stato == 503:
            # app spenta o irraggiungibile: il testo di shared/suite contiene l'errore di rete grezzo
            # ("[WinError 10061] …", guida 04/11); all'utente basta sapere cosa fare, il resto va nel log
            log.warning("chiamata a %s non riuscita: %s", app_id, e.messaggio)
            nome = suite_link.NOMI.get(app_id, app_id)
            raise ApiError(f"{nome} non risponde: probabilmente è spenta. Aprila dal portale e riprova.", 503)
        raise ApiError(e.messaggio, e.stato if e.stato in (400, 403, 404, 409, 422) else 502)


def _q(codice):
    """Il codice commessa può avere spazi ("101-003 SEDE"): nel percorso va codificato."""
    return urllib.parse.quote(str(codice or "").strip(), safe="")


# --------------------------------------------------------------------------- offerto alle altre app

@app.get("/api/suite/commesse")
def suite_commesse():
    """Le commesse che il Magazzino conosce (ubicazioni con codice commessa), con i conteggi."""
    _richiede_token()
    c = db()
    tutte = righe(c.execute(
        "SELECT u.*, (SELECT COUNT(*) FROM giacenze g WHERE g.ubicazione_id = u.id AND g.quantita != 0) AS articoli, "
        "(SELECT COUNT(*) FROM mezzi m WHERE m.ubicazione_id = u.id AND m.attivo = 1) AS mezzi "
        "FROM ubicazioni u WHERE u.attivo = 1 AND u.commessa IS NOT NULL AND u.commessa != '' ORDER BY u.commessa, u.nome"))
    per = {}
    for u in tutte:
        k = suite_link.normalizza_commessa(u["commessa"])
        voce = per.setdefault(k, {"commessa": u["commessa"], "ubicazioni": [], "articoli": 0, "mezzi": 0})
        voce["ubicazioni"].append({"id": u["id"], "codice": u["codice"], "nome": u["nome"], "tipo": u["tipo"],
                                   "indirizzo": u["indirizzo"], "lat": u["lat"], "lng": u["lng"]})
        voce["articoli"] += u["articoli"]
        voce["mezzi"] += u["mezzi"]
    return jsonify(list(per.values()))


@app.get("/api/suite/commesse/<codice>/giacenze")
def suite_giacenze(codice):
    """Materiale e mezzi presenti nelle ubicazioni di una commessa: lo mostra InCampo nella scheda cantiere."""
    _richiede_token()
    d = _giacenze_commessa(db(), codice)
    if d is None:
        raise ApiError(f"Nessuna ubicazione del Magazzino ha il codice commessa {codice}", 404)
    return jsonify(d)


ETICH_STATO_MEZZO = {"fermo": "Mezzo fermo", "manutenzione": "Mezzo in manutenzione"}


def _carichi_ddt_fuori_registro(c, base):
    """Voce del "da fare" (admin) per i carichi del Lettore DDT finiti in cantieri la cui commessa non è
    nel registro della suite: di solito il nome di una cartella del Lettore DDT ("demo-augusta") perché
    l'utente che converte non ha il codice commessa. Quei cantieri non si collegano a InCampo, SkyTower e
    portale. Si calcola a ogni richiesta (nessuno stato salvato): sparisce da sola quando il codice viene
    impostato e l'importazione successiva allinea il cantiere (importa_ddt.allinea_ubicazioni). Con il
    registro vuoto (Magazzino usato senza suite) non c'è niente da segnalare."""
    if not suite_link.commesse():
        return []
    fuori = [r for r in righe(c.execute(
        "SELECT u.commessa, COUNT(*) AS carichi FROM movimenti m JOIN ubicazioni u ON u.id = m.a_ubicazione_id "
        "WHERE m.origine = 'ddt' AND u.commessa IS NOT NULL AND u.commessa <> '' "
        "GROUP BY u.commessa ORDER BY u.commessa")) if not suite_link.trova_commessa(r["commessa"])]
    if not fuori:
        return []
    nomi = ", ".join(r["commessa"] for r in fuori[:4]) + (f" e altre {len(fuori) - 4}" if len(fuori) > 4 else "")
    carichi = sum(r["carichi"] for r in fuori)
    return [{"id": "ddt-commessa-fuori-registro", "titolo": f"Carichi DDT su commessa non nel registro: {nomi}",
             "testo": f"{carichi} {'carico' if carichi == 1 else 'carichi'}: imposta il codice commessa sull'utente del Lettore DDT o aggiungi "
                      "la commessa nel registro del portale",
             "url": f"{base}/#ubicazioni", "tipo": "avviso", "priorita": 3, "data": None}]


def _da_fare(c, admin):
    """Cose da fare nel Magazzino per la home del portale (shared/suite/CONTRATTI.md § 4)."""
    base = url_magazzino()
    voci = []
    for m in righe(c.execute(
            "SELECT m.id, m.codice, m.tipo_mezzo, m.marca, m.modello, m.targa, m.stato, u.nome AS ubicazione, "
            "(SELECT MAX(ts) FROM movimenti_mezzi mm WHERE mm.mezzo_id = m.id) AS dal "
            "FROM mezzi m LEFT JOIN ubicazioni u ON u.id = m.ubicazione_id "
            "WHERE m.attivo = 1 AND m.stato IN ('fermo', 'manutenzione') ORDER BY m.stato, dal")):
        nome = " ".join(x for x in (m["tipo_mezzo"], m["marca"], m["modello"]) if x)
        dettagli = [m["ubicazione"] or "ubicazione non registrata"]
        if m["targa"]:
            dettagli.insert(0, m["targa"])
        if m["dal"]:
            dettagli.append("dal " + str(m["dal"])[:10])
        voci.append({"id": f"mezzo:{m['id']}", "titolo": f"{ETICH_STATO_MEZZO[m['stato']]}: {nome}",
                     "testo": " · ".join(dettagli), "url": f"{base}/#scansione/{m['codice']}", "tipo": "magazzino",
                     "priorita": 2 if m["stato"] == "fermo" else 3, "data": (m["dal"] or "")[:10] or None})
    if admin:
        for i in righe(c.execute(
                "SELECT sorgente, chiave, MAX(ts) AS ts, dettaglio FROM importazioni WHERE esito = 'errore' "
                "AND ts >= datetime('now', '-7 days') GROUP BY sorgente, chiave ORDER BY ts DESC LIMIT 10")):
            cosa = "DDT" if i["sorgente"] == "ddt" else "pratica mezzi"
            voci.append({"id": f"import:{i['sorgente']}:{i['chiave']}", "titolo": f"Importazione {cosa} fallita: {i['chiave']}",
                         "testo": (i["dettaglio"] or "")[:160], "url": f"{base}/#importazioni", "tipo": "avviso",
                         "priorita": 2, "data": (i["ts"] or "")[:10] or None})
        senza = righe(c.execute(
            "SELECT id, codice, nome FROM ubicazioni WHERE attivo = 1 AND tipo = 'cantiere' "
            "AND (commessa IS NULL OR commessa = '') ORDER BY nome"))
        if senza:
            nomi = ", ".join(u["nome"] for u in senza[:4]) + (f" e altre {len(senza) - 4}" if len(senza) > 4 else "")
            voci.append({"id": "ubicazioni-senza-commessa", "titolo": f"{len(senza)} cantieri senza codice commessa",
                         "testo": f"{nomi}: senza codice non si collegano a InCampo e SkyTower",
                         "url": f"{base}/#ubicazioni", "tipo": "avviso", "priorita": 3, "data": None})
        voci.extend(_carichi_ddt_fuori_registro(c, base))
    voci.sort(key=lambda v: (v["priorita"], v["data"] or "9999"))
    return voci[:50]


@app.get("/api/suite/da-fare")
def suite_da_fare():
    """Le cose da fare per l'utente del portale (home del portale, sezione "Da fare oggi")."""
    _richiede_token()
    admin = request.args.get("admin") in ("1", "true")
    return jsonify({"voci": _da_fare(db(), admin)})


# --------------------------------------------------------------------------- registro commesse (per la pagina)

@app.get("/api/commesse")
def api_commesse():
    """Il registro unico delle commesse della suite (shared/suite/commesse.json, lo cura il portale):
    la pagina lo usa come menu a tendina del codice commessa dell'ubicazione."""
    solo_attive = request.args.get("tutte") not in ("1", "true")
    return jsonify(suite_link.commesse(solo_attive=solo_attive))


# --------------------------------------------------------------------------- stato dei collegamenti

@app.get("/api/collegamenti")
def api_collegamenti():
    """Per la pagina: quali app rispondono e a che indirizzo aprirle. L'indirizzo usa l'host con cui il browser
    sta usando il Magazzino (request.host: dietro il Lettore DDT è quello di X-Forwarded-Host, vedi prefisso.py),
    perché il cookie del portale vale per l'host e un link "localhost" farebbe ricomparire il login."""
    return jsonify({a: {"nome": suite_link.NOMI[a], "attiva": suite_link.raggiungibile(a),
                        "url": suite_link.url_pubblico(a, host=request.host)}
                    for a in ("incampo", "skytower")})


# --------------------------------------------------------------------------- InCampo

@app.get("/api/incampo/commessa/<codice>")
def incampo_commessa(codice):
    """Cantieri, task aperti e non conformità della commessa, da InCampo."""
    return jsonify(_chiama("incampo", "GET", f"/suite/commesse/{_q(codice)}/riepilogo"))


@app.post("/api/incampo/commessa/<codice>/task")
def incampo_task(codice):
    """Apre un task in InCampo sul cantiere della commessa (es. mezzo fermo, materiale mancante)."""
    d = corpo()
    titolo = testo(d, "titolo", True, 200)
    dati = {"title": titolo, "description": testo(d, "descrizione", maxlen=2000),
            "project_id": testo(d, "project_id", maxlen=60) or None}
    if d.get("mezzo_id"):
        m = db().execute("SELECT * FROM mezzi WHERE id = ?", (int(d["mezzo_id"]),)).fetchone()
        if m:
            riga = " ".join(x for x in (m["tipo_mezzo"], m["marca"], m["modello"]) if x)
            dati["description"] = (dati["description"] or "") + f"\n\nMezzo: {riga} ({m['targa'] or m['codice']}) — {url_magazzino()}/#scansione/{m['codice']}"
    r = _chiama("incampo", "POST", f"/suite/commesse/{_q(codice)}/task", dati=dati)
    registra("segnalazione_incampo", "mezzo" if d.get("mezzo_id") else "ubicazione", d.get("mezzo_id") or d.get("ubicazione_id"),
             f"{codice}: {titolo}")
    db().commit()
    return jsonify(r), 201


@app.post("/api/incampo/importa-cantieri")
def incampo_importa_cantieri():
    """Crea (o aggiorna indirizzo e nome) un'ubicazione di tipo cantiere per ogni cantiere di InCampo."""
    commesse = _chiama("incampo", "GET", "/suite/commesse")
    c = db()
    esistenti = righe(c.execute("SELECT * FROM ubicazioni"))
    nuove = aggiornate = 0
    for com in commesse:
        for cant in com.get("cantieri") or []:
            nome = cant.get("name") or com.get("name") or com["code"]
            chiave = suite_link.normalizza_commessa(com["code"])
            trovata = next((u for u in esistenti if suite_link.normalizza_commessa(u["commessa"]) == chiave
                            and codici.normalizza(u["nome"]) == codici.normalizza(nome)), None)
            if trovata is None and len(com.get("cantieri") or []) == 1:
                # un solo cantiere: basta che la commessa coincida
                trovata = next((u for u in esistenti if suite_link.normalizza_commessa(u["commessa"]) == chiave
                                and u["tipo"] == "cantiere"), None)
            if trovata:
                if (cant.get("address") and cant["address"] != trovata["indirizzo"]) or trovata["nome"] != nome:
                    c.execute("UPDATE ubicazioni SET nome = ?, indirizzo = COALESCE(?, indirizzo) WHERE id = ?",
                              (nome, cant.get("address"), trovata["id"]))
                    aggiornate += 1
                continue
            d = _dati_ubicazione({"nome": nome, "tipo": "cantiere", "commessa": com["code"], "indirizzo": cant.get("address") or "",
                                  "note": f"Da InCampo ({com.get('name') or ''})".strip()})
            d["codice"] = codici.prossimo_codice(c, "ubicazioni", config.PREFISSO_UBICAZIONE)
            cur = c.execute("INSERT INTO ubicazioni (codice, nome, tipo, commessa, indirizzo, lat, lng, note, attivo) "
                            "VALUES (:codice, :nome, :tipo, :commessa, :indirizzo, :lat, :lng, :note, :attivo)", d)
            esistenti.append(dict(d, id=cur.lastrowid))
            nuove += 1
    registra("importa_cantieri", "ubicazione", None, f"InCampo: {nuove} nuove, {aggiornate} aggiornate")
    c.commit()
    return jsonify({"nuove": nuove, "aggiornate": aggiornate, "commesse": len(commesse)})


# --------------------------------------------------------------------------- SkyTower

@app.get("/api/skytower/commessa/<codice>/documenti")
def skytower_documenti(codice):
    """Documenti pubblicati su SkyTower per la commessa."""
    return jsonify(_chiama("skytower", "GET", f"/suite/commesse/{_q(codice)}/documenti",
                           parametri={"area": request.args.get("area", "PUBLISHED"), "q": request.args.get("q", "")}))


@app.post("/api/skytower/commessa/<codice>/report")
def skytower_report(codice):
    """Report PDF di giacenze e mezzi della commessa, caricato su SkyTower come documento (WIP)."""
    c = db()
    d = _giacenze_commessa(c, codice)
    if d is None:
        raise ApiError(f"Nessuna ubicazione con il codice commessa {codice}", 404)
    oggi = datetime.now()
    righe_art = [[a["codice"], a["descrizione"], a["ubicazione"], f"{a['quantita']:g} {a['um']}"] for a in d["articoli"]]
    righe_mezzi = [[m["codice"], " ".join(x for x in (m["tipo_mezzo"], m["marca"], m["modello"]) if x), m["targa"] or m["matricola"] or "",
                    m["ubicazione"], m["stato"].replace("_", " "), m["assegnato_a"] or ""] for m in d["mezzi"]]
    sotto = f"Magazzino Operativo Cosedil · {pdf_semplice.data_it(oggi)} · {', '.join(u['nome'] for u in d['ubicazioni'])}"
    # Un PDF solo con due sezioni: materiale e mezzi (due documenti su SkyTower sarebbero rumore).
    pdf = pdf_semplice.documento_pdf([
        {"titolo": f"Giacenze di materiale — commessa {d['commessa']}", "sottotitolo": sotto,
         "intestazioni": ["Codice", "Articolo", "Ubicazione", "Quantità"], "righe": righe_art,
         "numeriche": (3,), "larghezze": (1.1, 3.2, 2.2, 1.2)},
        {"titolo": f"Mezzi presenti — commessa {d['commessa']}", "sottotitolo": sotto,
         "intestazioni": ["Codice", "Mezzo", "Targa/matricola", "Ubicazione", "Stato", "In uso da"], "righe": righe_mezzi,
         "larghezze": (1.1, 2.6, 1.4, 2, 1.1, 1.6)},
    ], piede=f"Generato da {nome_utente()}")
    titolo = f"Giacenze e mezzi {d['commessa']} {oggi:%d-%m-%Y}"
    r = _chiama("skytower", "POST", f"/suite/commesse/{_q(codice)}/documenti",
                parametri={"title": titolo, "description": f"Report automatico del Magazzino Operativo: {len(righe_art)} righe di materiale, {len(righe_mezzi)} mezzi.",
                           "tipo": "RP", "attributes": json.dumps({"origine": "magazzino", "commessa": d["commessa"], "generato_il": oggi.isoformat(timespec="seconds")})},
                corpo_file=(pdf, "application/pdf", f"giacenze-{suite_link.normalizza_commessa(codice).lower()}-{oggi:%Y%m%d-%H%M}.pdf"),
                timeout=60)
    registra("report_skytower", "ubicazione", d["ubicazioni"][0]["id"], f"{d['commessa']}: {r.get('identifier', '')}")
    c.commit()
    return jsonify(r), 201


# --------------------------------------------------------------------------- programma unico "DDT e Magazzino"

# Tetti del carico immediato: un export del Lettore DDT ha decine di righe, un lotto grande qualche
# centinaio. Oltre, qualcosa non va: meglio un 413 che un database riempito per sbaglio.
CONSEGNE_MAX_RIGHE = 5000
CAMPI_CONSEGNA = ("commessa", "export", "fornitore", "piva", "ddt", "data", "dataIso", "materiale", "quantita",
                  "um", "destinazione", "targa", "codiceCommessa")


def _testo_corto(v, maxlen):
    v = "" if v is None else str(v).strip()
    if any(ord(c) < 32 for c in v):
        raise ApiError("Caratteri di controllo non ammessi")
    return v[:maxlen]


@app.post("/api/suite/ddt/consegne")
def suite_ddt_consegne():
    """Carico immediato dal Lettore DDT (CONTRATTI § 11, C3): appena salva un export, il DDT manda le righe
    appena scritte in data/<cartella>/consegne.json. Corpo: {cartella, export, codiceCommessa, salvatoIl,
    righe:[Consegna]}. Le righe entrano come carichi con le stesse chiavi dell'importazione periodica
    (importa_ddt.importa_consegne_inviate): il giro di sfondo non le duplica. Risposta: {righe, nuove,
    scartate, commessa, ubicazione, avvisi}. Token di servizio della suite (X-Suite-Token)."""
    _richiede_token()
    d = corpo()
    cartella = _testo_corto(d.get("cartella"), 120)
    nome_export = _testo_corto(d.get("export"), 200)
    if not cartella or not nome_export:
        raise ApiError("Servono cartella ed export (il nome dell'export salvato dal Lettore DDT)")
    if "/" in cartella or "\\" in cartella or cartella in (".", ".."):
        raise ApiError("Cartella non valida")
    lista = d.get("righe")
    if not isinstance(lista, list) or not all(isinstance(r, dict) for r in lista):
        raise ApiError("righe deve essere un elenco di consegne")
    if len(lista) > CONSEGNE_MAX_RIGHE:
        raise ApiError(f"Troppe righe in un export ({len(lista)}, massimo {CONSEGNE_MAX_RIGHE})", 413)
    # solo i campi del contratto, testi accorciati: il resto del corpo non entra nel database
    pulite = [{k: (r[k] if k == "quantita" and isinstance(r[k], (int, float)) and not isinstance(r[k], bool)
                   else _testo_corto(r[k], 300))
               for k in CAMPI_CONSEGNA if r.get(k) is not None} for r in lista]
    codice = _testo_corto(d.get("codiceCommessa"), 80)
    salvato_il = _testo_corto(d.get("salvatoIl"), 60)
    with _lock_import:                       # mai insieme al giro di sfondo sulle stesse chiavi
        esito = importa_ddt.importa_consegne_inviate(db(), cartella, nome_export, pulite, codice=codice,
                                                     salvato_il=salvato_il, utente=nome_utente())
    if not esito["gia_importato"]:
        registra("importazione", "ddt", None,
                 f"Lettore DDT {cartella}/{nome_export}: {esito['nuove']} carichi nuovi "
                 f"({esito['ubicazione'] or 'nessuna ubicazione'})")
        db().commit()
    return jsonify(esito)


def _puo_inviare_riepilogo(commessa):
    """Riepilogo a richiesta: l'amministratore per ogni commessa, gli altri solo per quella su cui lavorano
    nel programma unico (scelta all'accesso, X-Suite-Commessa)."""
    if e_admin():
        return True
    di_sessione = prefisso.commessa_sessione(request.environ)
    return bool(di_sessione) and suite_link.normalizza_commessa(di_sessione) == suite_link.normalizza_commessa(commessa)


@app.get("/api/riepiloghi")
def api_riepiloghi():
    """Per la pagina: riepiloghi già mandati a SkyTower, commesse con movimenti oggi, ora del giro automatico
    e le commesse per cui chi guarda può mandarlo a mano."""
    c = db()
    commessa = (request.args.get("commessa") or "").strip() or None
    oggi = riepilogo.commesse_del_giorno(c, datetime.now().date().isoformat())
    di_sessione = prefisso.commessa_sessione(request.environ)
    possibili = list(oggi) if e_admin() else []
    if di_sessione and not any(suite_link.normalizza_commessa(x) == suite_link.normalizza_commessa(di_sessione)
                               for x in possibili):
        possibili.insert(0, di_sessione)
    ora = riepilogo.ora_automatica()
    try:
        limite = int(request.args.get("limite") or 20)
    except ValueError:
        raise ApiError("limite non valido")
    return jsonify({"automatico": f"{ora[0]:02d}:{ora[1]:02d}" if ora else None, "oggi": oggi,
                    "puo_inviare": possibili, "voci": riepilogo.elenco(c, commessa, limite)})


@app.post("/api/riepiloghi/invia")
def api_riepiloghi_invia():
    """Manda subito il riepilogo di una commessa (default oggi) a SkyTower. Risponde 200 con l'esito
    (ok, gia_inviato, vuoto, errore, rimandato) e il messaggio da mostrare: SkyTower spenta non è un errore
    della pagina. forza=true rimanda anche se niente è cambiato (nuovo documento "aggiornamento")."""
    d = corpo()
    commessa = testo(d, "commessa", True, 80)
    giorno = testo(d, "giorno", maxlen=10) or None
    if giorno:
        try:
            datetime.strptime(giorno, "%Y-%m-%d")
        except ValueError:
            raise ApiError("giorno deve essere AAAA-MM-GG")
    if not _puo_inviare_riepilogo(commessa):
        raise ApiError("Il riepilogo a richiesta lo manda l'amministratore, o chi lavora in quella commessa", 403)
    esito = riepilogo.invia(db(), commessa, giorno, utente=nome_utente(), forza=bool(d.get("forza")))
    if esito["esito"] in ("ok", "errore"):
        registra("riepilogo_skytower", "commessa", None, f"{commessa} {giorno or 'oggi'}: {esito['messaggio']}"[:300])
        db().commit()
    return jsonify(esito)
