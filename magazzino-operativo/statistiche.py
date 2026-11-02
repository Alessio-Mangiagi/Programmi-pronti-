# "><(((º> sabusabu <º)))><"
"""Dati per i grafici: movimenti nel tempo, flussi fra ubicazioni, andamento
della giacenza di un articolo, stato delle importazioni.

Le quantità di articoli diversi NON si sommano (m³ con kg con pezzi): i grafici
d'insieme contano i movimenti; le quantità compaiono solo per un articolo alla
volta (andamento) o riga per riga nelle tabelle.

La data di un movimento è quella del documento (`data`) se c'è, altrimenti il
giorno di registrazione (`ts`).
"""
import json
import os
from datetime import date, datetime, timedelta

import config

TIPI = ("carico", "scarico", "trasferimento", "rettifica", "inventario")
DATA_SQL = "COALESCE(m.data, date(m.ts))"


def _giorni(n):
    """Elenco di date ISO dagli ultimi n giorni a oggi, compresi."""
    oggi = date.today()
    return [(oggi - timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


def _filtro_ubicazione(ubicazione_id):
    if not ubicazione_id:
        return "", []
    return " AND (m.da_ubicazione_id = ? OR m.a_ubicazione_id = ?)", [ubicazione_id, ubicazione_id]


def movimenti_per_giorno(conn, giorni=30, ubicazione_id=None):
    """[{data, carico, scarico, trasferimento, rettifica}] — conteggi, un punto per giorno.
    Rettifica e inventario stanno insieme: sono entrambe correzioni."""
    dal = _giorni(giorni)[0]
    sql_ubi, p = _filtro_ubicazione(ubicazione_id)
    righe = conn.execute(
        f"SELECT {DATA_SQL} AS giorno, m.tipo, COUNT(*) AS n FROM movimenti m "
        f"WHERE {DATA_SQL} >= ?{sql_ubi} GROUP BY giorno, m.tipo", [dal, *p]).fetchall()
    per = {g: {"data": g, "carico": 0, "scarico": 0, "trasferimento": 0, "rettifica": 0} for g in _giorni(giorni)}
    for r in righe:
        if r["giorno"] in per:
            chiave = "rettifica" if r["tipo"] in ("rettifica", "inventario") else r["tipo"]
            per[r["giorno"]][chiave] += r["n"]
    return list(per.values())


def totali_periodo(conn, giorni=30, ubicazione_id=None):
    dal = _giorni(giorni)[0]
    sql_ubi, p = _filtro_ubicazione(ubicazione_id)
    tot = {t: 0 for t in TIPI}
    for r in conn.execute(
            f"SELECT m.tipo, COUNT(*) AS n FROM movimenti m WHERE {DATA_SQL} >= ?{sql_ubi} GROUP BY m.tipo",
            [dal, *p]):
        tot[r["tipo"]] = r["n"]
    tot["totale"] = sum(tot.values())
    tot["articoli_mossi"] = conn.execute(
        f"SELECT COUNT(DISTINCT m.articolo_id) FROM movimenti m WHERE {DATA_SQL} >= ?{sql_ubi}", [dal, *p]).fetchone()[0]
    return tot


def flussi(conn, giorni=30, ubicazione_id=None):
    """Archi del diagramma di flusso: fornitore -> ubicazione (carichi),
    ubicazione -> ubicazione (trasferimenti), ubicazione -> consumo (scarichi).
    Peso = numero di movimenti; porta anche le righe per il tooltip."""
    dal = _giorni(giorni)[0]
    sql_ubi, p = _filtro_ubicazione(ubicazione_id)
    righe = conn.execute(
        f"SELECT m.tipo, m.fornitore, m.quantita, a.um, a.descrizione, "
        f"ud.nome AS da_nome, ua.nome AS a_nome FROM movimenti m JOIN articoli a ON a.id = m.articolo_id "
        f"LEFT JOIN ubicazioni ud ON ud.id = m.da_ubicazione_id LEFT JOIN ubicazioni ua ON ua.id = m.a_ubicazione_id "
        f"WHERE {DATA_SQL} >= ? AND m.tipo IN ('carico','scarico','trasferimento'){sql_ubi}", [dal, *p]).fetchall()
    archi = {}
    for r in righe:
        if r["tipo"] == "carico":
            da, a = ("fornitore", r["fornitore"] or "Fornitore non indicato"), ("ubicazione", r["a_nome"] or "?")
        elif r["tipo"] == "scarico":
            da, a = ("ubicazione", r["da_nome"] or "?"), ("consumo", "Consumato in cantiere")
        else:
            da, a = ("ubicazione", r["da_nome"] or "?"), ("ubicazione", r["a_nome"] or "?")
        k = (da, a)
        arco = archi.setdefault(k, {"da": {"tipo": da[0], "nome": da[1]}, "a": {"tipo": a[0], "nome": a[1]},
                                    "tipo": r["tipo"], "n": 0, "articoli": {}})
        arco["n"] += 1
        art = arco["articoli"].setdefault(f"{r['descrizione']} ({r['um']})", 0.0)
        arco["articoli"][f"{r['descrizione']} ({r['um']})"] = art + (r["quantita"] or 0)
    out = []
    for arco in archi.values():
        arco["articoli"] = [{"nome": k, "quantita": round(v, 3)} for k, v in
                            sorted(arco["articoli"].items(), key=lambda kv: -kv[1])]
        out.append(arco)
    out.sort(key=lambda x: -x["n"])
    return out


def ubicazioni_attive(conn, giorni=30):
    """Per ubicazione: movimenti in entrata e in uscita nel periodo (conteggi)."""
    dal = _giorni(giorni)[0]
    righe = {}
    for r in conn.execute(
            f"SELECT u.id, u.nome, u.tipo, "
            f"SUM(CASE WHEN m.a_ubicazione_id = u.id THEN 1 ELSE 0 END) AS entrate, "
            f"SUM(CASE WHEN m.da_ubicazione_id = u.id THEN 1 ELSE 0 END) AS uscite "
            f"FROM ubicazioni u JOIN movimenti m ON (m.a_ubicazione_id = u.id OR m.da_ubicazione_id = u.id) "
            f"WHERE {DATA_SQL} >= ? GROUP BY u.id ORDER BY (entrate + uscite) DESC, u.nome", [dal]):
        righe[r["id"]] = dict(r)
    return list(righe.values())


def andamento_articolo(conn, articolo_id, giorni=90):
    """Giacenza giorno per giorno, per ubicazione, dell'articolo: saldo cumulato
    dei movimenti (tutto lo storico prima del periodo entra nel punto iniziale)."""
    date_ = _giorni(giorni)
    dal = date_[0]
    ubi = {}
    for r in conn.execute(
            "SELECT u.id, u.nome FROM ubicazioni u WHERE u.id IN "
            "(SELECT a_ubicazione_id FROM movimenti WHERE articolo_id = ? UNION "
            "SELECT da_ubicazione_id FROM movimenti WHERE articolo_id = ?) ORDER BY u.nome",
            (articolo_id, articolo_id)):
        ubi[r["id"]] = {"id": r["id"], "nome": r["nome"], "iniziale": 0.0, "delta": {}}
    for r in conn.execute(
            f"SELECT {DATA_SQL} AS giorno, m.quantita, m.da_ubicazione_id AS da, m.a_ubicazione_id AS a "
            f"FROM movimenti m WHERE m.articolo_id = ?", (articolo_id,)):
        for ubi_id, segno in ((r["a"], 1), (r["da"], -1)):
            if ubi_id is None or ubi_id not in ubi:
                continue
            q = (r["quantita"] or 0) * segno
            if r["giorno"] < dal:
                ubi[ubi_id]["iniziale"] += q
            else:
                ubi[ubi_id]["delta"][r["giorno"]] = ubi[ubi_id]["delta"].get(r["giorno"], 0) + q
    serie = []
    for u in ubi.values():
        saldo = u["iniziale"]
        punti = []
        for g in date_:
            saldo += u["delta"].get(g, 0)
            punti.append(round(saldo, 3))
        serie.append({"ubicazione_id": u["id"], "nome": u["nome"], "valori": punti, "finale": punti[-1] if punti else 0})
    serie.sort(key=lambda s: -abs(s["finale"]))
    return {"date": date_, "serie": serie}


def importazioni_per_giorno(conn, giorni=14):
    date_ = _giorni(giorni)
    per = {g: {"data": g, "righe": 0, "nuove": 0, "errori": 0} for g in date_}
    for r in conn.execute(
            "SELECT date(ts) AS giorno, SUM(righe) AS righe, SUM(nuove) AS nuove, "
            "SUM(CASE WHEN esito <> 'ok' THEN 1 ELSE 0 END) AS errori FROM importazioni "
            "WHERE date(ts) >= ? GROUP BY giorno", (date_[0],)):
        if r["giorno"] in per:
            per[r["giorno"]].update(righe=r["righe"] or 0, nuove=r["nuove"] or 0, errori=r["errori"] or 0)
    return list(per.values())


def _mtime_iso(p):
    try:
        return datetime.fromtimestamp(os.path.getmtime(p)).strftime("%Y-%m-%d %H:%M:%S")
    except OSError:
        return None


def stato_ddt(conn):
    """Per commessa del Lettore DDT: gli export nel registro consegne e lo stato
    della loro importazione (letto / da leggere / errore)."""
    ultime = {}
    for r in conn.execute(
            "SELECT chiave, impronta, ts, righe, nuove, esito, dettaglio FROM importazioni "
            "WHERE sorgente = 'ddt' ORDER BY id"):
        ultime[r["chiave"]] = dict(r)
    commesse = []
    radice = config.DDT_DATA_DIR
    if not os.path.isdir(radice):
        return commesse
    for nome in sorted(os.listdir(radice)):
        if nome in config.COMMESSE_IGNORATE:
            continue
        p = os.path.join(radice, nome, "consegne.json")
        if not os.path.isfile(p):
            continue
        voce = {"commessa": nome, "file": p, "modificato": _mtime_iso(p), "export": [], "errore": None}
        try:
            with open(p, encoding="utf-8") as f:
                per_export = (json.load(f) or {}).get("perExport") or {}
        except (OSError, ValueError) as e:
            voce["errore"] = str(e)
            per_export = {}
        for nome_export, blocco in per_export.items():
            chiave = f"{nome}/{nome_export}"
            salvato = (blocco or {}).get("salvatoIl") or ""
            n_righe = len((blocco or {}).get("righe") or [])
            ult = ultime.get(chiave)
            if not ult:
                stato = "da_leggere"
            elif ult["esito"] != "ok":
                stato = "errore"
            elif ult["impronta"] != salvato:
                stato = "da_leggere"
            else:
                stato = "letto"
            voce["export"].append({"export": nome_export, "salvato_il": salvato, "righe_registro": n_righe,
                                   "stato": stato, "importato_il": ult["ts"] if ult else None,
                                   "righe": ult["righe"] if ult else 0, "nuove": ult["nuove"] if ult else 0,
                                   "dettaglio": ult["dettaglio"] if ult else None})
        voce["ultima_lettura"] = max((e["importato_il"] or "" for e in voce["export"]), default="") or None
        commesse.append(voce)
    return commesse


def stato_mezzi(conn):
    radice = config.MEZZI_VFP_DIR
    out = {"pratiche": 0, "importate": 0, "da_leggere": 0, "errori": 0, "ultima_lettura": None, "voci": []}
    if not os.path.isdir(radice):
        return out
    ultime = {r["chiave"]: dict(r) for r in conn.execute(
        "SELECT chiave, impronta, ts, esito, dettaglio FROM importazioni WHERE sorgente = 'mezzi' ORDER BY id")}
    for nome in sorted(os.listdir(radice)):
        p = os.path.join(radice, nome, "record.json")
        if not os.path.isfile(p):
            continue
        out["pratiche"] += 1
        impronta = str(int(os.path.getmtime(p)))
        ult = ultime.get(nome)
        mezzo = conn.execute("SELECT codice, tipo_mezzo, marca, modello, targa FROM mezzi WHERE pratica_vfp = ?",
                             (nome,)).fetchone()
        if ult and ult["esito"] == "ok" and ult["impronta"] == impronta:
            stato = "letto"
            out["importate"] += 1
        elif ult and ult["esito"] != "ok":
            stato = "errore"
            out["errori"] += 1
        else:
            stato = "da_leggere"
            out["da_leggere"] += 1
        out["voci"].append({"pratica": nome, "stato": stato, "importato_il": ult["ts"] if ult else None,
                            "modificato": _mtime_iso(p), "mezzo": dict(mezzo) if mezzo else None,
                            "dettaglio": ult["dettaglio"] if ult else None})
        if ult and (out["ultima_lettura"] or "") < ult["ts"]:
            out["ultima_lettura"] = ult["ts"]
    return out
