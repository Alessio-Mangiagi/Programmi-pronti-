# "><(((º> sabusabu <º)))><"
"""Scadenze automatiche dalle pratiche dei mezzi a nolo di VFP Transfer.

Ogni pratica è una cartella ``<MEZZI_VFP_DIR>/<id>/record.json`` (vedi
vfp-transfer/mezzi.py). Da lì si ricavano, senza inserimento a mano:

* fine del nolo (``valori.data_fine``);
* scadenza dell'assicurazione e delle verifiche periodiche (``documenti[].scadenza``);
* white list antimafia del noleggiatore (``valori.white_list_dal`` + 12 mesi).

Il mezzo diventa un'attrezzatura (descrizione = tipo marca modello, matricola o
targa, cantiere = commessa), il noleggiatore un subappaltatore (per P.IVA). Ogni
scadenza porta in ``documento_rif`` la chiave ``VFP:<id pratica>:<tipo>``: alla
rilettura si aggiorna la data se è cambiata, mai doppioni; una scadenza chiusa a
mano resta chiusa. Contratto in shared/suite/CONTRATTI.md § 6.
"""
import json
import os
from datetime import date

import config

# (chiave, nome tipo, categoria, soggetto, validita_mesi, preavviso_giorni)
TIPI = {
    "fine_nolo": ("Fine nolo mezzo", "altro", "attrezzatura", None, 30),
    "assicurazione": ("Assicurazione mezzo a nolo", "assicurazione", "attrezzatura", 12, 30),
    "verifiche": ("Verifica periodica mezzo a nolo", "attrezzatura", "attrezzatura", 12, 30),
    "white_list": ("White list antimafia noleggiatore", "certificazione", "subappaltatore", 12, 30),
}
MARCA = "VFP:"


def _data(v):
    """Data ISO valida (AAAA-MM-GG) o None."""
    s = str(v or "").strip()[:10]
    try:
        return date.fromisoformat(s).isoformat()
    except ValueError:
        return None


def _piu_mesi(iso, mesi):
    d = date.fromisoformat(iso)
    m = d.month - 1 + mesi
    anno, mese = d.year + m // 12, m % 12 + 1
    ultimo = [31, 29 if anno % 4 == 0 and (anno % 100 != 0 or anno % 400 == 0) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mese - 1]
    return date(anno, mese, min(d.day, ultimo)).isoformat()


def leggi_pratiche(radice):
    """[(id, record)] delle pratiche leggibili; le cartelle senza record.json o rotte si saltano (con motivo)."""
    pratiche, errori = [], []
    if not radice or not os.path.isdir(radice):
        return pratiche, errori
    for nome in sorted(os.listdir(radice)):
        p = os.path.join(radice, nome, "record.json")
        if not os.path.isfile(p):
            continue
        try:
            with open(p, encoding="utf-8") as f:
                rec = json.load(f)
            if not isinstance(rec, dict) or not isinstance(rec.get("valori"), dict):
                raise TypeError("record senza 'valori'")
            pratiche.append((str(rec.get("id") or nome), rec))
        except (OSError, ValueError, TypeError) as e:
            errori.append(f"{nome}: {e}")
    return pratiche, errori


def scadenze_della_pratica(pid, rec):
    """[(tipo, data_scadenza, soggetto, note)] ricavate da una pratica. soggetto = 'mezzo' | 'ditta'."""
    v = rec.get("valori") or {}
    commessa = str(v.get("commessa") or "").strip()
    ditta = str(v.get("ragione_sociale") or "").strip()
    base = " · ".join(x for x in (f"commessa {commessa}" if commessa else "", f"noleggiatore {ditta}" if ditta else "", f"pratica {pid}") if x)
    out = []
    fine = _data(v.get("data_fine"))
    if fine:
        out.append(("fine_nolo", fine, "mezzo", f"Fine del nolo {v.get('tipo_nolo') or ''}".strip() + " · " + base))
    per_tipo = {}
    for d in rec.get("documenti") or []:
        if not isinstance(d, dict) or d.get("tipo") not in ("assicurazione", "verifiche"):
            continue
        sc = _data(d.get("scadenza"))
        if sc and sc > per_tipo.get(d["tipo"], ("", ""))[0]:
            per_tipo[d["tipo"]] = (sc, str(d.get("nome_file") or d.get("file") or ""))
    for tipo, (sc, nome_file) in per_tipo.items():
        out.append((tipo, sc, "mezzo", (f"Documento {nome_file} · " if nome_file else "") + base))
    wl = _data(v.get("white_list_dal"))
    if wl and ditta:
        # Nota senza il numero di pratica: la scadenza è della ditta, condivisa fra i suoi noli.
        out.append(("white_list", _piu_mesi(wl, 12), "ditta", f"Iscrizione white list dal {wl}"
                    + (f" ({v.get('white_list_prefettura')})" if v.get("white_list_prefettura") else "") + f" · noleggiatore {ditta}"))
    return out


def _tipo_id(conn, chiave):
    nome, categoria, soggetto, validita, preavviso = TIPI[chiave]
    r = conn.execute("SELECT id FROM tipi_scadenza WHERE nome = ?", (nome,)).fetchone()
    if r:
        return r[0]
    return conn.execute(
        "INSERT INTO tipi_scadenza (nome, categoria, soggetto, validita_mesi, preavviso_giorni) VALUES (?, ?, ?, ?, ?)",
        (nome, categoria, soggetto, validita, preavviso)).lastrowid


def _attrezzatura(conn, pid, v):
    """L'attrezzatura della pratica (creata se manca), riconosciuta dal marcatore [VFP:id] nelle note."""
    marcatore = f"[{MARCA}{pid}]"
    descrizione = " ".join(str(v.get(k) or "").strip() for k in ("tipo_mezzo", "marca", "modello")).strip() or f"Mezzo a nolo {pid}"
    matricola = str(v.get("matricola") or v.get("targa") or "").strip() or None
    cantiere = str(v.get("commessa") or "").strip() or None
    note = f"{marcatore} noleggiatore {v.get('ragione_sociale') or '?'}" + (f", targa {v['targa']}" if v.get("targa") else "")
    r = conn.execute("SELECT id FROM attrezzature WHERE note LIKE ?", (f"%{marcatore}%",)).fetchone()
    if r:
        conn.execute("UPDATE attrezzature SET descrizione = ?, matricola = ?, cantiere = ?, note = ? WHERE id = ?",
                     (descrizione, matricola, cantiere, note, r[0]))
        return r[0]
    return conn.execute("INSERT INTO attrezzature (descrizione, matricola, cantiere, note) VALUES (?, ?, ?, ?)",
                        (descrizione, matricola, cantiere, note)).lastrowid


def _subappaltatore(conn, v):
    ragione = str(v.get("ragione_sociale") or "").strip()
    piva = str(v.get("piva") or "").strip() or None
    if piva:
        r = conn.execute("SELECT id FROM subappaltatori WHERE partita_iva = ?", (piva,)).fetchone()
    else:
        r = conn.execute("SELECT id FROM subappaltatori WHERE ragione_sociale = ?", (ragione,)).fetchone()
    if r:
        return r[0]
    return conn.execute("INSERT INTO subappaltatori (ragione_sociale, partita_iva, referente, email) VALUES (?, ?, ?, ?)",
                        (ragione, piva, str(v.get("rappresentante") or "").strip() or None, str(v.get("pec") or "").strip() or None)).lastrowid


def importa(conn, radice=None):
    """Legge tutte le pratiche e allinea le scadenze. Ritorna il riepilogo (numeri e errori)."""
    radice = radice if radice is not None else config.MEZZI_VFP_DIR
    esito = {"cartella": radice, "pratiche": 0, "nuove": 0, "aggiornate": 0, "invariate": 0, "chiuse": 0, "errori": []}
    pratiche, esito["errori"] = leggi_pratiche(radice)
    for pid, rec in pratiche:
        try:
            voci = scadenze_della_pratica(pid, rec)
            if not voci:
                continue
            esito["pratiche"] += 1
            v = rec["valori"]
            soggetti = {}
            for chiave, data_scadenza, chi, note in voci:
                if chi == "mezzo":
                    soggetti.setdefault("mezzo", ("attrezzatura", _attrezzatura(conn, pid, v)))
                else:
                    soggetti.setdefault("ditta", ("subappaltatore", _subappaltatore(conn, v)))
                soggetto_tipo, soggetto_id = soggetti[chi]
                # La white list è della ditta, non della pratica: due noli dello stesso
                # noleggiatore danno una scadenza sola.
                rif = f"{MARCA}ditta:{v.get('piva') or v.get('ragione_sociale')}:{chiave}" if chi == "ditta" else f"{MARCA}{pid}:{chiave}"
                tipo_id = _tipo_id(conn, chiave)
                r = conn.execute("SELECT id, data_scadenza, chiusa, note FROM scadenze WHERE documento_rif = ?", (rif,)).fetchone()
                if r is None:
                    conn.execute(
                        "INSERT INTO scadenze (tipo_id, soggetto_tipo, soggetto_id, data_scadenza, documento_rif, referente, note) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?)", (tipo_id, soggetto_tipo, soggetto_id, data_scadenza, rif, "Ufficio mezzi", note))
                    esito["nuove"] += 1
                elif r["chiusa"]:
                    esito["chiuse"] += 1
                elif r["data_scadenza"] != data_scadenza or (r["note"] or "") != note:
                    conn.execute("UPDATE scadenze SET data_scadenza = ?, note = ?, soggetto_tipo = ?, soggetto_id = ? WHERE id = ?",
                                 (data_scadenza, note, soggetto_tipo, soggetto_id, r["id"]))
                    esito["aggiornate"] += 1
                else:
                    esito["invariate"] += 1
            conn.commit()
        except Exception as e:   # noqa: BLE001 - una pratica rotta non ferma le altre
            conn.rollback()
            esito["errori"].append(f"{pid}: {e}")
    return esito
