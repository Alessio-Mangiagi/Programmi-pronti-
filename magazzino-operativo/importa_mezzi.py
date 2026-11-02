# "><(((º> sabusabu <º)))><"
"""Importazione dei mezzi a nolo dalle pratiche di VFP Transfer.

Ogni pratica è una cartella `<MEZZI_VFP_DIR>/<id>/record.json` con i `valori`
della maschera mezzi_nolo (tipo_mezzo, marca, modello, targa, matricola,
ragione_sociale, piva, data_inizio, data_fine, commessa...).

La pratica diventa un mezzo a nolo (upsert per `pratica_vfp`), posizionato nel
cantiere della commessa del contratto. Se il mezzo era già stato spostato a mano
in un'altra ubicazione, l'ubicazione non viene toccata: la pratica dice dove
DOVREBBE stare al primo arrivo, non dove sta oggi.
"""
import json
import logging
import os

import config
from codici import prossimo_codice

log = logging.getLogger("magazzino.mezzi")


def _ubicazione_commessa(conn, commessa):
    commessa = (commessa or "").strip()
    if not commessa:
        return None
    r = conn.execute("SELECT id FROM ubicazioni WHERE commessa = ? OR lower(nome) = lower(?)",
                     (commessa, commessa)).fetchone()
    if r:
        return r["id"]
    codice = prossimo_codice(conn, "ubicazioni", config.PREFISSO_UBICAZIONE)
    cur = conn.execute(
        "INSERT INTO ubicazioni (codice, nome, tipo, commessa, note) VALUES (?, ?, 'cantiere', ?, ?)",
        (codice, commessa, commessa, "Creata dall'importazione mezzi"))
    return cur.lastrowid


def importa_record(conn, record, percorso=""):
    """Un record.json. Ritorna ('nuovo'|'aggiornato'|'invariato', id mezzo)."""
    pratica = str(record.get("id") or "").strip()
    v = record.get("valori") or {}
    if not pratica or not isinstance(v, dict):
        raise ValueError("record senza id o valori")
    tipo = (v.get("tipo_mezzo") or "Mezzo").strip()
    dati = {
        "tipo_mezzo": tipo,
        "marca": (v.get("marca") or "").strip() or None,
        "modello": (v.get("modello") or "").strip() or None,
        "targa": (v.get("targa") or "").strip().upper() or None,
        "matricola": (v.get("matricola") or "").strip() or None,
        "ditta": (v.get("ragione_sociale") or "").strip() or None,
        "piva": (v.get("piva") or "").strip() or None,
        "nolo_dal": (v.get("data_inizio") or "").strip() or None,
        "nolo_al": (v.get("data_fine") or "").strip() or None,
    }
    impronta = json.dumps(dati, sort_keys=True, ensure_ascii=False)
    esistente = conn.execute("SELECT * FROM mezzi WHERE pratica_vfp = ?", (pratica,)).fetchone()
    if esistente:
        attuale = json.dumps({k: esistente[k] for k in dati}, sort_keys=True, ensure_ascii=False)
        if attuale == impronta:
            return "invariato", esistente["id"]
        conn.execute(
            "UPDATE mezzi SET tipo_mezzo=:tipo_mezzo, marca=:marca, modello=:modello, targa=:targa, "
            "matricola=:matricola, ditta=:ditta, piva=:piva, nolo_dal=:nolo_dal, nolo_al=:nolo_al WHERE id=:id",
            {**dati, "id": esistente["id"]})
        return "aggiornato", esistente["id"]
    ubi = _ubicazione_commessa(conn, v.get("commessa"))
    codice = prossimo_codice(conn, "mezzi", config.PREFISSO_MEZZO)
    cur = conn.execute(
        "INSERT INTO mezzi (codice, tipo_mezzo, marca, modello, targa, matricola, proprieta, ditta, piva, "
        "nolo_dal, nolo_al, pratica_vfp, stato, ubicazione_id, note) "
        "VALUES (:codice, :tipo_mezzo, :marca, :modello, :targa, :matricola, 'nolo', :ditta, :piva, "
        ":nolo_dal, :nolo_al, :pratica, 'in_uso', :ubi, :note)",
        {**dati, "codice": codice, "pratica": pratica, "ubi": ubi,
         "note": f"Da pratica VFP {pratica}" + (f" ({v.get('codice_contratto')})" if v.get("codice_contratto") else "")})
    mezzo_id = cur.lastrowid
    conn.execute(
        "INSERT INTO movimenti_mezzi (mezzo_id, a_ubicazione_id, stato, origine, utente, note) "
        "VALUES (?, ?, 'in_uso', 'vfp', 'importazione', ?)",
        (mezzo_id, ubi, f"Arrivo da contratto di nolo {v.get('codice_contratto') or pratica}"))
    return "nuovo", mezzo_id


def importa_cartella(conn, radice=None, forza=False):
    radice = radice or config.MEZZI_VFP_DIR
    esiti = []
    if not os.path.isdir(radice):
        return esiti
    for nome in sorted(os.listdir(radice)):
        p = os.path.join(radice, nome, "record.json")
        if not os.path.isfile(p):
            continue
        impronta = str(int(os.path.getmtime(p)))
        if not forza:
            r = conn.execute(
                "SELECT impronta FROM importazioni WHERE sorgente='mezzi' AND chiave=? AND esito='ok' "
                "ORDER BY id DESC LIMIT 1", (nome,)).fetchone()
            if r and r["impronta"] == impronta:
                continue
        try:
            with open(p, encoding="utf-8") as f:
                record = json.load(f)
            if record.get("maschera") not in (None, "mezzi_nolo"):
                continue
            esito, mezzo_id = importa_record(conn, record, p)
            conn.execute(
                "INSERT INTO importazioni (sorgente, file, chiave, impronta, righe, nuove, esito, dettaglio) "
                "VALUES ('mezzi', ?, ?, ?, 1, ?, 'ok', ?)",
                (p, nome, impronta, 1 if esito == "nuovo" else 0, esito))
            esiti.append({"pratica": nome, "esito": esito, "mezzo_id": mezzo_id})
        except (OSError, ValueError) as e:
            log.warning("pratica %s non leggibile: %s", nome, e)
            conn.execute(
                "INSERT INTO importazioni (sorgente, file, chiave, impronta, esito, dettaglio) "
                "VALUES ('mezzi', ?, ?, ?, 'errore', ?)", (p, nome, impronta, str(e)))
            esiti.append({"pratica": nome, "esito": "errore", "dettaglio": str(e)})
    conn.commit()
    return esiti
