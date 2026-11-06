# "><(((º> sabusabu <º)))><"
"""Importazione dei DDT dal Lettore DDT.

Due formati accettati, entrambi prodotti dal Lettore DDT:

1. `consegne.json` (data/<commessa>/consegne.json): il registro delle consegne,
   già normalizzato riga per riga (fornitore, piva, ddt, data, materiale,
   quantita, um, destinazione, targa). È la fonte preferita.
2. L'export grezzo (`json_exports/<nome>.json`): fogli con `headers` e `rows`.
   Le colonne si riconoscono per nome come fa il Lettore DDT (alias per i
   diversi prompt: calcestruzzo, inerti, cava).

Ogni riga DDT diventa un movimento di `carico` nell'ubicazione di destinazione
(un cantiere con il nome della commessa, o la destinazione scritta sul DDT se
riconosciuta come ubicazione) dell'articolo con quella descrizione. Articoli e
ubicazioni che non esistono vengono creati.

Chiavi:
- `chiave_import` = "<commessa>/<export>": quando il Lettore DDT risalva lo
  stesso export, le righe vecchie vengono sostituite da quelle nuove.
- `chiave_riga` = chiave_import + piva + n. DDT + indice: la stessa riga non
  entra due volte.
"""
import json
import logging
import os
import re
from datetime import datetime

import config
import messaggi
from codici import normalizza, prossimo_codice

log = logging.getLogger("magazzino.ddt")

# Alias delle colonne negli export grezzi (stessi del Lettore DDT)
COL_FORNITORE = ("Fornitore", "Cedente")
COL_PIVA = ("P.IVA Fornitore", "P.IVA Cedente", "P.IVA", "Partita IVA")
COL_DDT = ("N°DDT", "N. DDT", "NDDT", "DDT")
COL_DATA = ("Data", "Data DDT")
COL_MATERIALE = ("Descrizione", "Descrizione materiale", "Tipo Materiale", "TipoCls", "ClRes")
COL_DESTINAZIONE = ("Destinazione/WBS", "WBS", "Luogo Destinazione", "Destinazione")
COL_TARGA = ("Targa",)
COL_UM = ("u.m.", "U.M.", "UM", "Unità")
COL_QUANTITA = (("m³", "m³"), ("Quantità Mc", "m³"), ("Quantità", None), ("Peso Kg", "kg"), ("N. Colli", "colli"))
VALORI_VUOTI = re.compile(r"^(mancante|\(illeggibile\)|illeggibile|n\.?d\.?|-+|\?)$", re.IGNORECASE)


class ImportError_(messaggi.ErroreParlante):
    """Export non riconosciuto: il testo è già scritto per l'utente (pagina Importazioni)."""


# --------------------------------------------------------------------------- lettura formati

def _cella(row, headers, nomi):
    for n in nomi:
        if n in headers:
            v = str(row[headers.index(n)] if headers.index(n) < len(row) else "").strip()
            if v and not VALORI_VUOTI.match(v):
                return v
    return ""


def numero_it(testo):
    """'1.234,5' -> 1234.5; '14' -> 14.0; non numerico -> None."""
    if testo is None:
        return None
    if isinstance(testo, (int, float)):
        return float(testo)
    t = str(testo).strip().replace(" ", "")
    if not t:
        return None
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    elif t.count(".") > 1:
        t = t.replace(".", "")
    t = re.sub(r"[^0-9.\-]", "", t)
    try:
        return float(t)
    except ValueError:
        return None


def data_iso(testo):
    """'03/03/2026' -> '2026-03-03'; già ISO resta; altro -> ''."""
    t = str(testo or "").strip()
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%d/%m/%y"):
        try:
            return datetime.strptime(t, fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return ""


def righe_da_export(parsed, commessa="", nome_export=""):
    """Righe normalizzate (come consegne.json) da un export grezzo del Lettore DDT."""
    fogli = parsed.get("sheets") if isinstance(parsed, dict) else None
    if not isinstance(fogli, list):
        raise ImportError_("JSON senza 'sheets': non è un export del Lettore DDT")
    foglio = None
    for s in fogli:
        h = s.get("headers") if isinstance(s, dict) else None
        if isinstance(h, list) and any(c in h for c in COL_DDT) and any(c in h for c in COL_FORNITORE):
            foglio = s
            break
    if not foglio:
        raise ImportError_("nessun foglio con N°DDT e Fornitore/Cedente")
    headers = [str(h) for h in foglio["headers"]]
    righe = []
    for row in foglio.get("rows") or []:
        if not isinstance(row, list):
            continue
        quantita, um = None, ""
        for col, um_col in COL_QUANTITA:
            v = _cella(row, headers, (col,))
            if v and numero_it(v) is not None:
                quantita = numero_it(v)
                um = um_col or _cella(row, headers, COL_UM) or "pz"
                break
        data = _cella(row, headers, COL_DATA)
        righe.append({
            "commessa": commessa,
            "export": nome_export,
            "fornitore": _cella(row, headers, COL_FORNITORE),
            "piva": re.sub(r"\D", "", _cella(row, headers, COL_PIVA)),
            "ddt": _cella(row, headers, COL_DDT),
            "data": data,
            "dataIso": data_iso(data),
            "materiale": _cella(row, headers, COL_MATERIALE),
            "quantita": quantita,
            "um": um,
            "destinazione": _cella(row, headers, COL_DESTINAZIONE),
            "targa": _cella(row, headers, COL_TARGA),
        })
    return righe


def leggi_consegne(parsed):
    """Dal registro consegne.json: {export: {salvatoIl, righe}}."""
    per_export = parsed.get("perExport") if isinstance(parsed, dict) else None
    if not isinstance(per_export, dict):
        raise ImportError_("JSON senza 'perExport': non è un consegne.json")
    out = {}
    for nome, blocco in per_export.items():
        righe = blocco.get("righe") if isinstance(blocco, dict) else None
        out[nome] = {"salvatoIl": (blocco or {}).get("salvatoIl", ""), "righe": righe or []}
    return out


# --------------------------------------------------------------------------- scrittura

def ubicazione_per(conn, commessa, destinazione):
    """Ubicazione di destinazione: se la destinazione del DDT corrisponde a
    un'ubicazione esistente la usa; altrimenti il cantiere della commessa (creato
    se manca); senza niente, il deposito predefinito."""
    dest = (destinazione or "").strip()
    if dest:
        r = conn.execute("SELECT id FROM ubicazioni WHERE lower(nome) = lower(?)", (dest,)).fetchone()
        if r:
            return r["id"]
    if commessa:
        r = conn.execute("SELECT id FROM ubicazioni WHERE commessa = ?", (commessa,)).fetchone()
        if r:
            return r["id"]
        nome = f"Cantiere {commessa}"
        r = conn.execute("SELECT id FROM ubicazioni WHERE lower(nome) = lower(?)", (nome,)).fetchone()
        if r:
            conn.execute("UPDATE ubicazioni SET commessa = ? WHERE id = ?", (commessa, r["id"]))
            return r["id"]
        codice = prossimo_codice(conn, "ubicazioni", config.PREFISSO_UBICAZIONE)
        cur = conn.execute(
            "INSERT INTO ubicazioni (codice, nome, tipo, commessa, note) VALUES (?, ?, 'cantiere', ?, ?)",
            (codice, nome, commessa, "Creata dall'importazione DDT"))
        return cur.lastrowid
    if dest:
        codice = prossimo_codice(conn, "ubicazioni", config.PREFISSO_UBICAZIONE)
        cur = conn.execute(
            "INSERT INTO ubicazioni (codice, nome, tipo, note) VALUES (?, ?, 'cantiere', ?)",
            (codice, dest, "Creata dall'importazione DDT"))
        return cur.lastrowid
    r = conn.execute("SELECT id FROM ubicazioni WHERE nome = ?", (config.UBICAZIONE_DEFAULT,)).fetchone()
    return r["id"]


def articolo_per(conn, descrizione, um, fornitore=""):
    norm = normalizza(descrizione)
    um = (um or "pz").strip() or "pz"
    r = conn.execute("SELECT id FROM articoli WHERE descrizione_norm = ? AND um = ?", (norm, um)).fetchone()
    if r:
        return r["id"]
    codice = prossimo_codice(conn, "articoli", config.PREFISSO_ARTICOLO)
    cur = conn.execute(
        "INSERT INTO articoli (codice, descrizione, descrizione_norm, um, fornitore, note) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (codice, descrizione.strip(), norm, um, fornitore or None, "Creato dall'importazione DDT"))
    return cur.lastrowid


def importa_righe(conn, righe, commessa, nome_export, utente="importazione"):
    """Sostituisce i movimenti dell'export con le righe date. Ritorna (righe, nuove, scartate)."""
    chiave_import = f"{commessa}/{nome_export}"
    presenti = {r["chiave_riga"] for r in conn.execute(
        "SELECT chiave_riga FROM movimenti WHERE chiave_import = ?", (chiave_import,))}
    conn.execute("DELETE FROM movimenti WHERE chiave_import = ?", (chiave_import,))
    nuove = scartate = 0
    for i, riga in enumerate(righe):
        materiale = (riga.get("materiale") or "").strip()
        quantita = riga.get("quantita")
        if quantita is None:
            quantita = numero_it(riga.get("quantita"))
        if not materiale or quantita is None or quantita <= 0:
            scartate += 1
            continue
        chiave_riga = f"{chiave_import}#{riga.get('piva') or ''}#{riga.get('ddt') or ''}#{i}"
        art = articolo_per(conn, materiale, riga.get("um"), riga.get("fornitore"))
        ubi = ubicazione_per(conn, riga.get("commessa") or commessa, riga.get("destinazione"))
        ddt = riga.get("ddt") or "?"
        data = riga.get("dataIso") or data_iso(riga.get("data"))
        rif = f"DDT {ddt}" + (f" del {riga.get('data')}" if riga.get("data") else "")
        note = " ".join(x for x in (
            f"targa {riga['targa']}" if riga.get("targa") else "",
            f"destinazione {riga['destinazione']}" if riga.get("destinazione") else "") if x) or None
        conn.execute(
            "INSERT INTO movimenti (ts, data, tipo, articolo_id, quantita, a_ubicazione_id, riferimento, "
            "fornitore, origine, chiave_import, chiave_riga, utente, note) "
            "VALUES (datetime('now'), ?, 'carico', ?, ?, ?, ?, ?, 'ddt', ?, ?, ?, ?)",
            (data or None, art, float(quantita), ubi, rif, riga.get("fornitore") or None,
             chiave_import, chiave_riga, utente, note))
        if chiave_riga not in presenti:
            nuove += 1
    return len(righe), nuove, scartate


def _registra(conn, file, chiave, impronta, righe, nuove, esito="ok", dettaglio=None):
    conn.execute(
        "INSERT INTO importazioni (sorgente, file, chiave, impronta, righe, nuove, esito, dettaglio) "
        "VALUES ('ddt', ?, ?, ?, ?, ?, ?, ?)",
        (file, chiave, impronta, righe, nuove, esito, dettaglio))


def _gia_importato(conn, chiave, impronta):
    r = conn.execute(
        "SELECT impronta FROM importazioni WHERE sorgente = 'ddt' AND chiave = ? AND esito = 'ok' "
        "ORDER BY id DESC LIMIT 1", (chiave,)).fetchone()
    return bool(r and impronta and r["impronta"] == impronta)


def importa_consegne_file(conn, percorso, commessa, forza=False):
    """Un consegne.json intero. Ritorna lista di esiti per export."""
    with open(percorso, encoding="utf-8") as f:
        parsed = json.load(f)
    esiti = []
    for nome_export, blocco in leggi_consegne(parsed).items():
        chiave = f"{commessa}/{nome_export}"
        impronta = blocco["salvatoIl"] or ""
        if not forza and _gia_importato(conn, chiave, impronta):
            continue
        try:
            n, nuove, scartate = importa_righe(conn, blocco["righe"], commessa, nome_export)
            _registra(conn, percorso, chiave, impronta, n, nuove,
                      dettaglio=f"{scartate} righe senza materiale o quantità" if scartate else None)
            esiti.append({"export": nome_export, "commessa": commessa, "righe": n, "nuove": nuove,
                          "scartate": scartate, "esito": "ok"})
        except Exception as e:  # una riga rotta non deve fermare le altre commesse
            # nel registro e nella pagina il testo per l'utente; il dettaglio tecnico resta nel log
            log.exception("import %s", chiave)
            testo = messaggi.per_utente(e)
            _registra(conn, percorso, chiave, impronta, 0, 0, esito="errore", dettaglio=testo)
            esiti.append({"export": nome_export, "commessa": commessa, "esito": "errore", "dettaglio": testo})
    conn.commit()
    return esiti


def importa_cartella(conn, radice=None, forza=False):
    """Tutte le commesse del Lettore DDT: data/<commessa>/consegne.json."""
    radice = radice or config.DDT_DATA_DIR
    esiti = []
    if not os.path.isdir(radice):
        return esiti
    for nome in sorted(os.listdir(radice)):
        if nome in config.COMMESSE_IGNORATE:
            continue
        p = os.path.join(radice, nome, "consegne.json")
        if os.path.isfile(p):
            try:
                esiti.extend(importa_consegne_file(conn, p, nome, forza=forza))
            except (OSError, ValueError, ImportError_) as e:
                log.warning("consegne.json di %s non leggibile: %s", nome, e)
                testo = messaggi.per_utente(e)
                _registra(conn, p, nome, "", 0, 0, esito="errore", dettaglio=testo)
                conn.commit()
                esiti.append({"commessa": nome, "esito": "errore", "dettaglio": testo})
    return esiti


def importa_json_caricato(conn, parsed, nome_file, commessa=""):
    """Upload manuale: consegne.json o export grezzo. Ritorna lista di esiti."""
    nome_file = os.path.basename(nome_file or "upload.json")
    esiti = []
    if isinstance(parsed, dict) and "perExport" in parsed:
        for nome_export, blocco in leggi_consegne(parsed).items():
            com = commessa or (blocco["righe"][0].get("commessa") if blocco["righe"] else "") or "manuale"
            n, nuove, scartate = importa_righe(conn, blocco["righe"], com, nome_export)
            _registra(conn, nome_file, f"{com}/{nome_export}", blocco["salvatoIl"], n, nuove)
            esiti.append({"export": nome_export, "commessa": com, "righe": n, "nuove": nuove, "scartate": scartate,
                          "esito": "ok"})
    else:
        com = commessa or "manuale"
        righe = righe_da_export(parsed, com, nome_file)
        n, nuove, scartate = importa_righe(conn, righe, com, nome_file)
        _registra(conn, nome_file, f"{com}/{nome_file}", "", n, nuove)
        esiti.append({"export": nome_file, "commessa": com, "righe": n, "nuove": nuove, "scartate": scartate,
                      "esito": "ok"})
    conn.commit()
    return esiti
