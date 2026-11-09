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

Commessa del cantiere: il codice del registro della suite (shared/suite/commesse.json,
es. 101-003), così il cantiere combacia con InCampo, SkyTower e il portale. Si prende,
in ordine: il `codiceCommessa` scritto dal Lettore DDT sulla riga (account di chi ha
convertito), quello delle altre righe della stessa cartella, il nome della cartella se
è (o contiene) un codice del registro; altrimenti resta il nome della cartella, come
prima, e il "da fare" del Magazzino lo segnala. Vedi `risolvi_commessa`.

Chiavi:
- `chiave_import` = "<cartella>/<export>": quando il Lettore DDT risalva lo
  stesso export, le righe vecchie vengono sostituite da quelle nuove. Resta il
  nome della cartella del Lettore DDT anche quando il cantiere prende il codice
  del registro: cambiarla duplicherebbe i movimenti già importati.
- `chiave_riga` = chiave_import + piva + n. DDT + indice: la stessa riga non
  entra due volte.
"""
import json
import logging
import os
import re
import sys
from datetime import datetime

import config
import messaggi
from codici import normalizza, prossimo_codice

sys.path.insert(0, os.path.join(config.SUITE_DIR, "shared", "suite"))
import suite_link  # registro commesse della suite (shared/suite), come in importa_mezzi

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


# --------------------------------------------------------------------------- commessa del registro

def codice_registro(testo, registro=None):
    """Il codice del registro della suite che corrisponde a `testo`, o '' se nessuno.

    `testo` è il nome della cartella del Lettore DDT ("101-003", "demo-augusta") o il
    codiceCommessa scritto a mano sull'account ("101-003 SEDE"). Vale l'uguaglianza
    normalizzata (spazi e maiuscole, suite_link.normalizza_commessa); altrimenti un codice
    contenuto come pezzo intero, il più lungo ("101-003 SEDE" → 101-003, ma "101-0031" non
    è 101-003: a differenza di importa_mezzi.codice_commessa qui il confine conta, perché il
    risultato decide in quale cantiere vanno i carichi). `registro` = lista già letta
    (suite_link.commesse()), per non rileggere il file a ogni riga.
    """
    k = suite_link.normalizza_commessa(testo)
    if not k:
        return ""
    registro = suite_link.commesse() if registro is None else registro
    codici = [c["code"] for c in registro if suite_link.normalizza_commessa(c.get("code"))]
    for c in codici:
        if suite_link.normalizza_commessa(c) == k:
            return c
    pezzi = re.sub(r"\s+", " ", str(testo)).upper()
    trovati = [c for c in codici
               if re.search(r"(?<![A-Z0-9])" + re.escape(re.sub(r"\s+", " ", c).upper()) + r"(?![A-Z0-9])", pezzi)]
    return max(trovati, key=len) if trovati else ""


def codice_della_cartella(per_export):
    """Il codiceCommessa più recente scritto dal Lettore DDT nelle righe di un consegne.json
    ({export: {salvatoIl, righe}}), o ''. Vale per tutta la cartella: le righe salvate prima
    che l'account avesse il codice (o prima di questa versione) non lo portano, ma sono della
    stessa commessa e devono finire nello stesso cantiere."""
    for _nome, blocco in sorted(per_export.items(), key=lambda kv: kv[1].get("salvatoIl") or "", reverse=True):
        for r in blocco.get("righe") or []:
            c = str((r or {}).get("codiceCommessa") or "").strip()
            if c:
                return c
    return ""


def risolvi_commessa(scritto, cartella, codice_cartella="", registro=None):
    """(commessa del cantiere, nel_registro).

    Ordine: codice scritto sulla riga dal Lettore DDT → codice della cartella (altre righe
    dello stesso consegne.json) → nome della cartella ricondotto al registro → nome della
    cartella com'è (comportamento di prima). Un codice scritto ma assente dal registro si
    usa lo stesso (l'ha impostato l'admin del Lettore DDT, ed è lo stesso con cui il PDF va
    in SkyTower), però nel_registro=False: lo segnala l'esito dell'importazione.
    """
    registro = suite_link.commesse() if registro is None else registro
    for testo in (scritto, codice_cartella):
        testo = str(testo or "").strip()
        if testo:
            codice = codice_registro(testo, registro)
            return (codice, True) if codice else (testo, False)
    codice = codice_registro(cartella, registro)
    return (codice, True) if codice else (cartella, False)


def allinea_ubicazioni(conn, vecchia, codice):
    """Porta al codice del registro i cantieri nati con il nome della cartella del Lettore DDT.

    Prima di questa correzione l'importazione creava "Cantiere <cartella>" con commessa =
    nome della cartella. Si aggiorna la commessa (i movimenti seguono l'ubicazione: nessun
    movimento si tocca né si duplica) e, se il nome è ancora quello automatico, lo si
    rinomina in "Cantiere <codice>" quando quel nome è libero. Ritorna quante ubicazioni ha
    aggiornato."""
    if not vecchia or not codice or vecchia == codice:
        return 0
    vecchie = conn.execute("SELECT id, nome FROM ubicazioni WHERE commessa = ?", (vecchia,)).fetchall()
    for u in vecchie:
        conn.execute("UPDATE ubicazioni SET commessa = ? WHERE id = ?", (codice, u["id"]))
        nuovo_nome = f"Cantiere {codice}"
        if u["nome"] == f"Cantiere {vecchia}" and not conn.execute(
                "SELECT 1 FROM ubicazioni WHERE lower(nome) = lower(?)", (nuovo_nome,)).fetchone():
            conn.execute("UPDATE ubicazioni SET nome = ? WHERE id = ?", (nuovo_nome, u["id"]))
        log.info("ubicazione %s: commessa %s → %s (codice del registro della suite)", u["nome"], vecchia, codice)
    return len(vecchie)


def avviso_commessa(commessa):
    """Testo per l'esito dell'importazione quando la commessa non è nel registro della suite."""
    return (f"commessa «{commessa}» non nel registro della suite: imposta il codice commessa sull'utente "
            "del Lettore DDT o aggiungi la commessa nel portale")


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
        # più cantieri con la stessa commessa (es. uno creato a mano e uno dall'importazione): il più vecchio
        r = conn.execute("SELECT id FROM ubicazioni WHERE commessa = ? ORDER BY id", (commessa,)).fetchone()
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


def importa_righe(conn, righe, commessa, nome_export, utente="importazione", codice_cartella="",
                  fuori_registro=None):
    """Sostituisce i movimenti dell'export con le righe date. Ritorna (righe, nuove, scartate).

    `commessa` è la cartella del Lettore DDT (chiave dell'importazione); il cantiere prende il
    codice del registro (risolvi_commessa, con `codice_cartella` come ripiego per le righe senza
    codice). Le commesse rimaste fuori dal registro finiscono nell'insieme `fuori_registro`, se dato
    (solo quando il registro ha almeno una commessa: un Magazzino senza suite non ha niente da allineare)."""
    chiave_import = f"{commessa}/{nome_export}"
    presenti = {r["chiave_riga"] for r in conn.execute(
        "SELECT chiave_riga FROM movimenti WHERE chiave_import = ?", (chiave_import,))}
    conn.execute("DELETE FROM movimenti WHERE chiave_import = ?", (chiave_import,))
    nuove = scartate = 0
    registro = suite_link.commesse()          # letto una volta per export, non a ogni riga
    risolte = {}                              # (codice scritto, cartella) -> commessa del cantiere
    for i, riga in enumerate(righe):
        materiale = str(riga.get("materiale") or "").strip()
        quantita = riga.get("quantita")
        if isinstance(quantita, bool) or not isinstance(quantita, (int, float)):
            # dal consegne.json arriva un numero; dal carico immediato (POST /api/suite/ddt/consegne) o da un
            # file scritto a mano può arrivare "14" o "1.234,5": un testo confrontato con 0 farebbe TypeError
            quantita = numero_it(quantita if not isinstance(quantita, bool) else None)
        if not materiale or quantita is None or quantita <= 0:
            scartate += 1
            continue
        chiave_riga = f"{chiave_import}#{riga.get('piva') or ''}#{riga.get('ddt') or ''}#{i}"
        art = articolo_per(conn, materiale, riga.get("um"), riga.get("fornitore"))
        cartella = riga.get("commessa") or commessa
        k = (str(riga.get("codiceCommessa") or "").strip(), cartella)
        if k not in risolte:
            codice, nel_registro = risolvi_commessa(k[0], cartella, codice_cartella, registro)
            allinea_ubicazioni(conn, cartella, codice)     # "Cantiere <cartella>" di prima → codice
            if not nel_registro and registro and fuori_registro is not None:
                fuori_registro.add(codice)
            risolte[k] = codice
        ubi = ubicazione_per(conn, risolte[k], riga.get("destinazione"))
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
    per_export = leggi_consegne(parsed)
    codice_cartella = codice_della_cartella(per_export)
    # Anche se nessun export è cambiato (impronte uguali, niente da reimportare): i cantieri
    # creati prima con il nome della cartella passano al codice del registro appena lo si conosce
    # (codice impostato sull'utente del Lettore DDT, o commessa aggiunta al registro).
    codice, _nel_registro = risolvi_commessa("", commessa, codice_cartella)
    if allinea_ubicazioni(conn, commessa, codice):
        conn.commit()
    esiti = []
    for nome_export, blocco in per_export.items():
        chiave = f"{commessa}/{nome_export}"
        impronta = blocco["salvatoIl"] or ""
        if not forza and _gia_importato(conn, chiave, impronta):
            continue
        try:
            fuori = set()
            n, nuove, scartate = importa_righe(conn, blocco["righe"], commessa, nome_export,
                                               codice_cartella=codice_cartella, fuori_registro=fuori)
            note = [f"{scartate} righe senza materiale o quantità"] if scartate else []
            note += [avviso_commessa(c) for c in sorted(fuori)]
            _registra(conn, percorso, chiave, impronta, n, nuove, dettaglio="; ".join(note) or None)
            esito = {"export": nome_export, "commessa": commessa, "righe": n, "nuove": nuove,
                     "scartate": scartate, "esito": "ok"}
            if fuori:
                esito["avviso"] = "; ".join(avviso_commessa(c) for c in sorted(fuori))
            esiti.append(esito)
        except Exception as e:  # una riga rotta non deve fermare le altre commesse
            # nel registro e nella pagina il testo per l'utente; il dettaglio tecnico resta nel log
            log.exception("import %s", chiave)
            testo = messaggi.per_utente(e)
            _registra(conn, percorso, chiave, impronta, 0, 0, esito="errore", dettaglio=testo)
            esiti.append({"export": nome_export, "commessa": commessa, "esito": "errore", "dettaglio": testo})
    conn.commit()
    return esiti


def importa_consegne_inviate(conn, cartella, nome_export, righe, codice="", salvato_il="", utente="importazione"):
    """Carico immediato dal Lettore DDT (programma unico "DDT e Magazzino", CONTRATTI § 11, C3).

    Il Lettore DDT, appena salvato un export, manda qui le stesse righe che ha scritto in
    data/<cartella>/consegne.json, con lo stesso `salvatoIl`. Si importa con le stesse chiavi
    dell'importazione periodica (chiave_import "<cartella>/<export>", impronta = salvatoIl,
    chiave_riga per indice): quando il thread di sfondo rilegge consegne.json trova l'impronta
    già importata e salta; se anche la rileggesse, sostituirebbe le righe di quella chiave
    (DELETE + INSERT), quindi un doppione non può nascere in nessun ordine.
    Un secondo invio con lo stesso salvatoIl non rifà niente (risponde con quello di prima).

    `codice` = commessa della sessione del programma unico (codiceCommessa): vale per le righe
    che non lo portano. Ritorna il dict della risposta: righe, nuove, scartate, commessa,
    ubicazione (nomi delle ubicazioni di arrivo), avvisi, gia_importato.
    """
    chiave = f"{cartella}/{nome_export}"
    impronta = str(salvato_il or "")
    codice = str(codice or "").strip()
    gia = impronta and _gia_importato(conn, chiave, impronta)
    if not gia:
        righe = [dict(r, codiceCommessa=r.get("codiceCommessa") or codice) if codice else dict(r) for r in righe]
        commessa_risolta, _ = risolvi_commessa("", cartella, codice)
        allinea_ubicazioni(conn, cartella, commessa_risolta)     # come importa_consegne_file
        fuori = set()
        n, nuove, scartate = importa_righe(conn, righe, cartella, nome_export, utente=utente,
                                           codice_cartella=codice, fuori_registro=fuori)
        note = [f"{scartate} righe senza materiale o quantità"] if scartate else []
        note += [avviso_commessa(c) for c in sorted(fuori)]
        _registra(conn, f"Lettore DDT (invio immediato): {chiave}", chiave, impronta, n, nuove,
                  dettaglio="; ".join(note) or None)
        conn.commit()
        avvisi = [avviso_commessa(c) for c in sorted(fuori)]
    else:
        r = conn.execute("SELECT righe, dettaglio FROM importazioni WHERE sorgente = 'ddt' AND chiave = ? AND esito = 'ok' "
                         "ORDER BY id DESC LIMIT 1", (chiave,)).fetchone()
        n, nuove, scartate = (r["righe"] if r else len(righe)), 0, 0
        avvisi = []
    dove = conn.execute(
        "SELECT u.nome, u.commessa, COUNT(*) AS n FROM movimenti m JOIN ubicazioni u ON u.id = m.a_ubicazione_id "
        "WHERE m.chiave_import = ? GROUP BY u.id ORDER BY n DESC, u.nome", (chiave,)).fetchall()
    commessa = next((d["commessa"] for d in dove if d["commessa"]), "") or risolvi_commessa("", cartella, codice)[0]
    return {"righe": n, "nuove": nuove, "scartate": scartate, "commessa": commessa,
            "ubicazione": ", ".join(d["nome"] for d in dove), "avvisi": avvisi, "gia_importato": bool(gia)}


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
        per_export = leggi_consegne(parsed)
        codice_cartella = codice_della_cartella(per_export)
        for nome_export, blocco in per_export.items():
            com = commessa or (blocco["righe"][0].get("commessa") if blocco["righe"] else "") or "manuale"
            n, nuove, scartate = importa_righe(conn, blocco["righe"], com, nome_export,
                                               codice_cartella=codice_cartella)
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
