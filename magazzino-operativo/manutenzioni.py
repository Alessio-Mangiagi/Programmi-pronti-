# "><(((º> sabusabu <º)))><"
"""Manutenzioni dei mezzi: registro degli interventi, scadenze e caricamento da Excel.

Perché esiste (19/11/2026): ogni mezzo della sezione Mezzi deve poter segnare le manutenzioni fatte
(tagliandi, riparazioni, revisioni...) e ricevere quelle passate da un file Excel compilato a mano, per
poi scaricare lo stato del mezzo e della flotta (stato_mezzi.py). Le rotte stanno in app.py
(/api/mezzi/<id>/manutenzioni, /api/mezzi/manutenzioni/importa); qui c'è la logica, provata in
tests/test_manutenzioni.py senza passare dal server.

Regole:
- una manutenzione ha data, tipo (TIPI), descrizione e, se si sanno, contaore/km, officina, chi l'ha
  fatta, costo e la prossima scadenza (data e/o ore e/o km: vale quella che arriva prima);
- la scadenza aperta di un tipo è la "prossima" scritta sull'ultimo intervento di quel tipo: registrare un
  nuovo tagliando chiude quella del tagliando precedente (scadenze());
- ore e km si confrontano con la lettura più alta nota (scheda del mezzo o manutenzioni registrate);
- una riga uguale (stesso mezzo, data, tipo, descrizione, ore, km e costo) non entra due volte: lo stesso
  Excel caricato di nuovo non crea doppioni (colonna `chiave`, UNIQUE in database.py).
"""
import csv
import hashlib
import io
import re
import unicodedata
from datetime import date, datetime

import config
import messaggi
import xlsx_semplice

# Tipi di intervento: chiave nel database → nome mostrato. L'ordine è quello dei menu.
TIPI = {
    "ordinaria": "Tagliando / ordinaria",
    "straordinaria": "Riparazione / straordinaria",
    "revisione": "Revisione / collaudo",
    "verifica": "Verifica periodica",
    "gomme": "Gomme / cingoli",
    "altro": "Altro",
}
# Nomi corti per le colonne strette dei PDF (stato_mezzi.py).
TIPI_BREVI = {"ordinaria": "Tagliando", "straordinaria": "Riparazione", "revisione": "Revisione",
              "verifica": "Verifica", "gomme": "Gomme/cingoli", "altro": "Altro"}
# Parole che chi compila l'Excel scrive davvero nella colonna Tipo, normalizzate con _norm().
# Si confronta prima la cella intera, poi la prima parola (così "Tagliando 500 ore" è ordinaria).
SINONIMI_TIPO = {
    "ordinaria": "ordinaria", "manutenzione ordinaria": "ordinaria", "tagliando": "ordinaria",
    "tagliando ordinaria": "ordinaria", "programmata": "ordinaria", "periodica": "ordinaria",
    "straordinaria": "straordinaria", "manutenzione straordinaria": "straordinaria", "riparazione": "straordinaria",
    "riparazione straordinaria": "straordinaria", "guasto": "straordinaria", "intervento": "straordinaria",
    "revisione": "revisione", "revisione collaudo": "revisione", "collaudo": "revisione",
    "verifica": "verifica", "verifica periodica": "verifica", "verifiche": "verifica", "controllo": "verifica",
    "ispezione": "verifica",
    "gomme": "gomme", "gomme cingoli": "gomme", "pneumatici": "gomme", "cingoli": "gomme", "gomma": "gomme",
    "altro": "altro", "varie": "altro",
}
GRAVITA = {"scaduta": 3, "in_scadenza": 2, "ok": 1}

# Colonne del modello Excel, nell'ordine del file: (campo, intestazione del modello, altre intestazioni
# accettate). Le intestazioni si confrontano normalizzate (_norm): maiuscole, accenti, € e punteggiatura
# non contano. Lo stesso elenco fa le intestazioni del foglio "Manutenzioni" scaricato con lo stato del
# mezzo/flotta, così quel foglio si può correggere e ricaricare.
COLONNE = [
    ("mezzo", "Mezzo (codice, targa o matricola)",
     ("mezzo", "codice mezzo", "codice", "targa", "matricola", "targa matricola", "targa o matricola",
      "codice o targa", "mezzo codice targa o matricola")),
    ("data", "Data", ("data", "data intervento", "data manutenzione", "data lavori", "giorno")),
    ("tipo", "Tipo", ("tipo", "tipo intervento", "tipo manutenzione", "tipologia", "categoria")),
    ("descrizione", "Descrizione lavori",
     ("descrizione", "descrizione lavori", "lavori", "lavori eseguiti", "intervento", "descrizione intervento",
      "operazioni", "operazioni eseguite")),
    ("ore", "Ore motore", ("ore", "ore motore", "contaore", "ore lavoro", "ore di lavoro", "ore macchina")),
    ("km", "Km", ("km", "chilometri", "contachilometri", "contakm", "km percorsi")),
    ("officina", "Officina / fornitore", ("officina", "fornitore", "officina fornitore", "ditta", "officina ditta")),
    ("eseguita_da", "Eseguita da", ("eseguita da", "eseguito da", "meccanico", "tecnico", "operatore")),
    ("costo", "Costo €", ("costo", "costo euro", "importo", "spesa", "prezzo", "costo totale", "totale")),
    ("prossima_data", "Prossima data",
     ("prossima data", "prossima manutenzione", "prossima scadenza", "scadenza", "prossimo intervento")),
    ("prossime_ore", "Prossime ore", ("prossime ore", "prossima ore", "ore prossima", "scadenza ore")),
    ("prossimi_km", "Prossimi km", ("prossimi km", "prossima km", "km prossima", "scadenza km")),
    ("note", "Note", ("note", "annotazioni", "osservazioni")),
]
INTESTAZIONI = [c[1] for c in COLONNE]
CAMPI_NUMERO = ("ore", "km", "costo", "prossime_ore", "prossimi_km")
MAXLEN = {"descrizione": 500, "officina": 120, "eseguita_da": 80, "note": 500}


class DatiNonValidi(messaggi.ErroreParlante):
    """Dato di una manutenzione non accettabile: il testo dice all'utente cosa correggere."""


# --------------------------------------------------------------------------- conversioni tolleranti

def _norm(testo):
    """Testo per i confronti: minuscolo, senza accenti, solo lettere/cifre separate da uno spazio."""
    t = unicodedata.normalize("NFKD", str(testo or "")).encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", t.lower()).split())


def _testo(v):
    """Valore di una cella come testo pulito (i numeri interi senza ",0", le date gg/mm/aaaa)."""
    if v is None:
        return ""
    if isinstance(v, bool):
        return "sì" if v else "no"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    if isinstance(v, date):
        return v.strftime("%d/%m/%Y")
    return str(v).strip()


def data_iso(v, campo="Data"):
    """Una data scritta in qualunque modo sensato → "AAAA-MM-GG"; vuota → None.

    Accetta date di Excel (date/datetime o il loro numero di serie), gg/mm/aaaa, gg-mm-aaaa, gg.mm.aaaa,
    gg/mm/aa e aaaa-mm-gg (anche con l'ora dietro). Anni fuori da 1950–2100 sono quasi sempre un errore
    di battitura (o un numero finito nella colonna sbagliata) e si rifiutano."""
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        d = v.date()
    elif isinstance(v, date):
        d = v
    elif isinstance(v, (int, float)) and not isinstance(v, bool):
        d = xlsx_semplice.seriale_in_data(v)
    else:
        t = str(v).strip()
        if not t:
            return None
        d = None
        pezzo = t.split()[0] if " " in t else t
        for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%d/%m/%y", "%d-%m-%y", "%Y/%m/%d"):
            try:
                d = datetime.strptime(pezzo.replace("T", " ").split()[0], fmt).date()
                break
            except ValueError:
                continue
    if d is None or not 1950 <= d.year <= 2100:
        raise DatiNonValidi(f"{campo} non valida: «{_testo(v)}». Scrivila come gg/mm/aaaa.")
    return d.isoformat()


def numero(v, campo):
    """Un numero scritto all'italiana o all'inglese → float; vuoto → None; negativo → errore.

    Regole per il testo (le celle numeriche di Excel arrivano già come numeri):
    - "1.234,50" e "1,234.50": l'ultimo separatore è quello dei decimali;
    - "12,5" → 12,5; "1.500" (un punto e tre cifre) → 1500, come lo intende chi scrive in italiano;
    - "€ 300", "300 €", "1.200 h", "80000 km": simboli e unità si ignorano."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        raise DatiNonValidi(f"{campo}: serve un numero, non «{_testo(v)}».")
    if isinstance(v, (int, float)):
        n = float(v)
    else:
        t = re.sub(r"[^0-9,.\-]", "", str(v).replace(" ", ""))
        if not t or t in ("-", ".", ","):
            if not str(v).strip():
                return None
            raise DatiNonValidi(f"{campo}: serve un numero, non «{_testo(v)}».")
        if "," in t and "." in t:
            decimali = "," if t.rfind(",") > t.rfind(".") else "."
            t = t.replace("." if decimali == "," else ",", "").replace(",", ".")
        elif "," in t:
            t = t.replace(".", "").replace(",", ".") if t.count(",") == 1 else t.replace(",", "")
        elif t.count(".") > 1 or re.fullmatch(r"-?\d{1,3}\.\d{3}", t):
            t = t.replace(".", "")
        try:
            n = float(t)
        except ValueError:
            raise DatiNonValidi(f"{campo}: serve un numero, non «{_testo(v)}».")
    if n != n or n in (float("inf"), float("-inf")):
        raise DatiNonValidi(f"{campo}: numero non valido.")
    if n < 0:
        raise DatiNonValidi(f"{campo}: non può essere negativo.")
    return n


def tipo_da_testo(v):
    """Chiave di TIPI da un testo libero ("Tagliando 500h", "REVISIONE", "riparazione"). Vuoto → altro."""
    t = _norm(_testo(v))
    if not t:
        return "altro"
    if t in TIPI:
        return t
    for chiave, nome in TIPI.items():
        if t == _norm(nome):
            return chiave
    if t in SINONIMI_TIPO:
        return SINONIMI_TIPO[t]
    primo = t.split()[0]
    if primo in SINONIMI_TIPO:
        return SINONIMI_TIPO[primo]
    raise DatiNonValidi(f"Tipo «{_testo(v)}» non riconosciuto. Usa uno di: {', '.join(TIPI.values())}.")


# --------------------------------------------------------------------------- validazione e impronta

def valida(d):
    """Dati di una manutenzione (dal form JSON o da una riga Excel già mappata sui campi) → dict pulito.

    Obbligatori: data e descrizione (se manca la descrizione ma c'è il tipo, si usa il nome del tipo:
    nei registri vecchi capita "Tagliando" e basta). Solleva DatiNonValidi con il primo problema."""
    data = data_iso(d.get("data"), "Data")
    if not data:
        raise DatiNonValidi("Manca la data dell'intervento.")
    tipo = tipo_da_testo(d.get("tipo"))
    descrizione = _testo(d.get("descrizione"))
    if not descrizione:
        if not _testo(d.get("tipo")):
            raise DatiNonValidi("Manca la descrizione dei lavori.")
        descrizione = TIPI[tipo]
    out = {"data": data, "tipo": tipo, "descrizione": descrizione[:MAXLEN["descrizione"]]}
    nomi = {"ore": "Ore motore", "km": "Km", "costo": "Costo", "prossime_ore": "Prossime ore", "prossimi_km": "Prossimi km"}
    for campo in CAMPI_NUMERO:
        out[campo] = numero(d.get(campo), nomi[campo])
    for campo in ("officina", "eseguita_da", "note"):
        out[campo] = _testo(d.get(campo))[:MAXLEN[campo]] or None
    out["prossima_data"] = data_iso(d.get("prossima_data"), "Prossima data")
    if out["prossima_data"] and out["prossima_data"] <= data:
        raise DatiNonValidi("La prossima data deve venire dopo la data dell'intervento.")
    if out["prossime_ore"] is not None and out["ore"] is not None and out["prossime_ore"] <= out["ore"]:
        raise DatiNonValidi("Le prossime ore devono essere più delle ore motore di questo intervento.")
    if out["prossimi_km"] is not None and out["km"] is not None and out["prossimi_km"] <= out["km"]:
        raise DatiNonValidi("I prossimi km devono essere più dei km di questo intervento.")
    return out


def chiave(mezzo_id, dati):
    """Impronta di una manutenzione per riconoscere i doppioni (stesso Excel caricato due volte, stessa
    riga scritta a mano due volte). Officina, note e scadenze non contano: correggerle non fa un
    intervento nuovo."""
    pezzi = [str(mezzo_id), dati["data"], dati["tipo"], _norm(dati["descrizione"]),
             *("" if dati.get(c) is None else f"{float(dati[c]):.2f}" for c in ("ore", "km", "costo"))]
    return hashlib.sha1("|".join(pezzi).encode("utf-8")).hexdigest()


# --------------------------------------------------------------------------- scrittura

def inserisci(conn, mezzo_id, dati, utente, origine="manuale", file_origine=None, fermo=False):
    """Salva una manutenzione già validata e aggiorna le letture del mezzo. Ritorna l'id.
    Solleva DatiNonValidi se esiste già la stessa manutenzione. Il commit lo fa chi chiama."""
    k = chiave(mezzo_id, dati)
    if conn.execute("SELECT 1 FROM manutenzioni_mezzi WHERE chiave = ?", (k,)).fetchone():
        raise DatiNonValidi("Questa manutenzione è già registrata (stesso mezzo, data, tipo, descrizione, ore, km e costo).")
    cur = conn.execute(
        "INSERT INTO manutenzioni_mezzi (mezzo_id, data, tipo, descrizione, ore, km, officina, eseguita_da, costo, "
        "prossima_data, prossime_ore, prossimi_km, fermo, note, origine, file_origine, chiave, utente) "
        "VALUES (:mezzo_id, :data, :tipo, :descrizione, :ore, :km, :officina, :eseguita_da, :costo, :prossima_data, "
        ":prossime_ore, :prossimi_km, :fermo, :note, :origine, :file_origine, :chiave, :utente)",
        {**dati, "mezzo_id": mezzo_id, "fermo": 1 if fermo else 0, "origine": origine,
         "file_origine": file_origine, "chiave": k, "utente": utente})
    aggiorna_letture(conn, mezzo_id, dati.get("ore"), dati.get("km"), dati["data"])
    return cur.lastrowid


def modifica(conn, manutenzione_id, mezzo_id, dati):
    """Corregge una manutenzione (stessi controlli dell'inserimento). Solleva DatiNonValidi se dopo la
    correzione diventa uguale a un'altra già registrata."""
    k = chiave(mezzo_id, dati)
    if conn.execute("SELECT 1 FROM manutenzioni_mezzi WHERE chiave = ? AND id <> ?", (k, manutenzione_id)).fetchone():
        raise DatiNonValidi("Esiste già un'altra manutenzione uguale a questa: correggi data, descrizione o importi.")
    conn.execute(
        "UPDATE manutenzioni_mezzi SET data=:data, tipo=:tipo, descrizione=:descrizione, ore=:ore, km=:km, "
        "officina=:officina, eseguita_da=:eseguita_da, costo=:costo, prossima_data=:prossima_data, "
        "prossime_ore=:prossime_ore, prossimi_km=:prossimi_km, note=:note, chiave=:chiave, "
        "modificato_il=datetime('now') WHERE id=:id",
        {**dati, "chiave": k, "id": manutenzione_id})
    aggiorna_letture(conn, mezzo_id, dati.get("ore"), dati.get("km"), dati["data"])


def aggiorna_letture(conn, mezzo_id, ore=None, km=None, quando=None):
    """Porta contaore e contachilometri del mezzo al valore più alto fra quello noto e quello nuovo
    (i contatori vanno solo avanti: una manutenzione vecchia caricata da Excel non li fa tornare indietro)."""
    m = conn.execute("SELECT ore_lettura, km_lettura FROM mezzi WHERE id = ?", (mezzo_id,)).fetchone()
    if not m:
        return
    nuove_ore = ore if ore is not None and (m["ore_lettura"] is None or ore > m["ore_lettura"]) else None
    nuovi_km = km if km is not None and (m["km_lettura"] is None or km > m["km_lettura"]) else None
    if nuove_ore is None and nuovi_km is None:
        return
    conn.execute(
        "UPDATE mezzi SET ore_lettura = COALESCE(?, ore_lettura), km_lettura = COALESCE(?, km_lettura), "
        "lettura_il = ? WHERE id = ?", (nuove_ore, nuovi_km, quando or date.today().isoformat(), mezzo_id))


def segna_fermo(conn, mezzo_id, descrizione, utente):
    """Mezzo fermo in officina: stato "manutenzione" e una riga nello storico spostamenti (resta dove
    sta; lo si sposta in officina o lo si rimette disponibile con "Sposta / cambia stato").
    Ritorna False se era già in manutenzione (nessuna riga doppia nello storico)."""
    m = conn.execute("SELECT stato, ubicazione_id FROM mezzi WHERE id = ?", (mezzo_id,)).fetchone()
    if not m or m["stato"] == "manutenzione":
        return False
    conn.execute("UPDATE mezzi SET stato = 'manutenzione', assegnato_a = NULL WHERE id = ?", (mezzo_id,))
    conn.execute(
        "INSERT INTO movimenti_mezzi (mezzo_id, da_ubicazione_id, a_ubicazione_id, stato, origine, utente, note) "
        "VALUES (?, ?, ?, 'manutenzione', 'manuale', ?, ?)",
        (mezzo_id, m["ubicazione_id"], m["ubicazione_id"], utente, f"Fermo per manutenzione: {descrizione}"[:500]))
    return True


# --------------------------------------------------------------------------- lettura e scadenze

def elenco(conn, mezzo_id):
    """Manutenzioni di un mezzo, la più recente per prima."""
    return [dict(r) for r in conn.execute(
        "SELECT * FROM manutenzioni_mezzi WHERE mezzo_id = ? ORDER BY data DESC, id DESC", (mezzo_id,))]


def scadenze(manutenzioni, ore_attuali=None, km_attuali=None, oggi=None):
    """Scadenze aperte, la più urgente per prima: una per tipo, dall'ultimo intervento di quel tipo che
    indica una "prossima". Stato: scaduta, in_scadenza (entro i preavvisi di config) o ok; con più
    criteri (data, ore, km) vale il peggiore, cioè quello che arriva prima."""
    oggi = oggi or date.today()
    ultime = {}
    for m in sorted(manutenzioni, key=lambda r: (r["data"], r["id"])):
        ultime[m["tipo"]] = m
    out = []
    for tipo, m in ultime.items():
        if not m.get("prossima_data") and m.get("prossime_ore") is None and m.get("prossimi_km") is None:
            continue
        stati, giorni, ore_mancanti, km_mancanti = [], None, None, None
        if m.get("prossima_data"):
            giorni = (date.fromisoformat(m["prossima_data"]) - oggi).days
            stati.append("scaduta" if giorni < 0 else "in_scadenza" if giorni <= config.MANUT_PREAVVISO_GIORNI else "ok")
        # senza una lettura del contaore non si può dire quanto manca: quel criterio non decide lo stato
        if m.get("prossime_ore") is not None and ore_attuali is not None:
            ore_mancanti = m["prossime_ore"] - ore_attuali
            stati.append("scaduta" if ore_mancanti <= 0 else "in_scadenza" if ore_mancanti <= config.MANUT_PREAVVISO_ORE else "ok")
        if m.get("prossimi_km") is not None and km_attuali is not None:
            km_mancanti = m["prossimi_km"] - km_attuali
            stati.append("scaduta" if km_mancanti <= 0 else "in_scadenza" if km_mancanti <= config.MANUT_PREAVVISO_KM else "ok")
        out.append({
            "tipo": tipo, "tipo_nome": TIPI.get(tipo, tipo), "manutenzione_id": m["id"], "data_intervento": m["data"],
            "descrizione": m["descrizione"], "prossima_data": m.get("prossima_data"), "prossime_ore": m.get("prossime_ore"),
            "prossimi_km": m.get("prossimi_km"), "giorni": giorni, "ore_mancanti": ore_mancanti,
            "km_mancanti": km_mancanti, "stato": max(stati, key=GRAVITA.get) if stati else "ok"})
    grande = 10 ** 9
    out.sort(key=lambda s: (-GRAVITA[s["stato"]], s["giorni"] if s["giorni"] is not None else grande,
                            s["ore_mancanti"] if s["ore_mancanti"] is not None else grande,
                            s["km_mancanti"] if s["km_mancanti"] is not None else grande))
    return out


def riepilogo(mezzo, manutenzioni, oggi=None):
    """Quadro manutenzioni di un mezzo per la lista Mezzi, la scheda e gli stati scaricati:
    letture attuali, scadenze, stato peggiore, ultima manutenzione, costi (totale e anno in corso)."""
    oggi = oggi or date.today()
    ore = [x for x in [mezzo["ore_lettura"], *(m["ore"] for m in manutenzioni)] if x is not None]
    km = [x for x in [mezzo["km_lettura"], *(m["km"] for m in manutenzioni)] if x is not None]
    ore_attuali, km_attuali = (max(ore) if ore else None), (max(km) if km else None)
    sc = scadenze(manutenzioni, ore_attuali, km_attuali, oggi)
    ultima = max(manutenzioni, key=lambda r: (r["data"], r["id"])) if manutenzioni else None
    anno = str(oggi.year)
    return {
        "ore_attuali": ore_attuali, "km_attuali": km_attuali, "scadenze": sc,
        "stato": sc[0]["stato"] if sc else None, "prossima": sc[0] if sc else None,
        "ultima": {"id": ultima["id"], "data": ultima["data"], "tipo": ultima["tipo"],
                   "tipo_nome": TIPI.get(ultima["tipo"]), "descrizione": ultima["descrizione"]} if ultima else None,
        "n": len(manutenzioni),
        "costo_totale": round(sum(m["costo"] or 0 for m in manutenzioni), 2),
        "costo_anno": round(sum(m["costo"] or 0 for m in manutenzioni if m["data"].startswith(anno)), 2),
        "anno": oggi.year,
    }


def riepiloghi(conn, mezzi, oggi=None):
    """{id mezzo: riepilogo} per una lista di mezzi (righe con id, ore_lettura, km_lettura), leggendo le
    manutenzioni con una sola query invece di una per mezzo (la lista Mezzi arriva a 500 righe)."""
    per_mezzo = {m["id"]: [] for m in mezzi}
    if per_mezzo:
        segnaposto = ",".join("?" * len(per_mezzo))
        for r in conn.execute(f"SELECT * FROM manutenzioni_mezzi WHERE mezzo_id IN ({segnaposto})", list(per_mezzo)):
            per_mezzo[r["mezzo_id"]].append(dict(r))
    return {m["id"]: riepilogo(m, per_mezzo[m["id"]], oggi) for m in mezzi}


# --------------------------------------------------------------------------- formattazione per PDF ed Excel

def fmt_numero(n, decimali=0):
    """1500 → "1.500"; 1234.5 con 2 decimali → "1.234,50" (all'italiana, per PDF e testi)."""
    if n is None:
        return ""
    s = f"{n:,.{decimali}f}"
    return s.replace(",", "§").replace(".", ",").replace("§", ".")


def fmt_data(iso):
    """"2026-11-19" → "19/11/2026"; vuoto resta vuoto."""
    if not iso:
        return ""
    try:
        return date.fromisoformat(str(iso)[:10]).strftime("%d/%m/%Y")
    except ValueError:
        return str(iso)


def testo_scadenza(s):
    """"entro 15/12/2026 o a 1.500 h": i criteri della prossima manutenzione in una riga."""
    pezzi = []
    if s.get("prossima_data"):
        pezzi.append(f"entro {fmt_data(s['prossima_data'])}")
    if s.get("prossime_ore") is not None:
        pezzi.append(f"a {fmt_numero(s['prossime_ore'])} h")
    if s.get("prossimi_km") is not None:
        pezzi.append(f"a {fmt_numero(s['prossimi_km'])} km")
    return " o ".join(pezzi)


NOMI_STATO = {"scaduta": "Scaduta", "in_scadenza": "In scadenza", "ok": "In regola", None: "Nessuna scadenza"}


# --------------------------------------------------------------------------- caricamento da Excel

class _CsvItaliano(csv.excel):
    delimiter = ";"


def righe_da_file(nome_file, dati):
    """Il file caricato → righe di celle. .xlsx con xlsx_semplice (foglio "Manutenzioni" se c'è, altrimenti
    il primo che ha le intestazioni), .csv con ; , o tabulazione. Solleva DatiNonValidi con un testo
    per l'utente se il formato non va."""
    nome = (nome_file or "").lower()
    if nome.endswith(".xls"):
        raise DatiNonValidi("I file .xls (Excel 97-2003) non si leggono: aprilo in Excel e salvalo come .xlsx.")
    if nome.endswith(".csv") or nome.endswith(".txt"):
        try:
            testo = dati.decode("utf-8-sig")
        except UnicodeDecodeError:
            testo = dati.decode("cp1252", errors="replace")   # CSV salvato da Excel italiano
        try:
            dialetto = csv.Sniffer().sniff(testo[:4096], delimiters=";,\t")
        except csv.Error:
            dialetto = _CsvItaliano      # il ; è il separatore dei CSV dell'Excel italiano
        return [list(r) for r in csv.reader(io.StringIO(testo), dialetto)]
    try:
        fogli = xlsx_semplice.leggi_xlsx(dati)
    except xlsx_semplice.XlsxNonLeggibile as e:
        raise DatiNonValidi(str(e))
    if not fogli:
        raise DatiNonValidi("Il file Excel non contiene fogli con dati.")
    preferito = [righe for nome_f, righe in fogli.items() if _norm(nome_f) == "manutenzioni"]
    for righe in preferito + list(fogli.values()):
        if trova_intestazioni(righe)[0] is not None:
            return righe
    return preferito[0] if preferito else next(iter(fogli.values()))


_ALIAS = {_norm(a): campo for campo, intest, altri in COLONNE for a in (intest, *altri)}


def trova_intestazioni(righe):
    """(indice della riga delle intestazioni, {indice colonna: campo}, [intestazioni ignorate]).
    È la prima riga, fra le prime 15, con almeno due colonne riconosciute fra cui la data o la
    descrizione (sopra possono esserci titoli o righe vuote). (None, {}, []) se non c'è."""
    for i, riga in enumerate(righe[:15]):
        mappa, ignorate = {}, []
        for j, cella in enumerate(riga):
            campo = _ALIAS.get(_norm(_testo(cella)))
            if campo and campo not in mappa.values():
                mappa[j] = campo
            elif _testo(cella):
                ignorate.append(_testo(cella))
        if len(mappa) >= 2 and ({"data", "descrizione"} & set(mappa.values())):
            return i, mappa, ignorate
    return None, {}, []


def _norm_id(v):
    """Codice, targa o matricola per il confronto: maiuscolo, senza spazi, trattini, punti e barre."""
    return re.sub(r"[\s\-./]", "", _testo(v)).upper()


def _indice_mezzi(conn):
    """{codice/targa/matricola normalizzati: [mezzi]} per riconoscere il mezzo di ogni riga."""
    indice = {}
    for m in conn.execute("SELECT id, codice, tipo_mezzo, marca, modello, targa, matricola, attivo FROM mezzi"):
        voce = {"id": m["id"], "codice": m["codice"], "targa": m["targa"],
                "nome": " ".join(x for x in (m["tipo_mezzo"], m["marca"], m["modello"]) if x)}
        for k in {_norm_id(m["codice"]), _norm_id(m["targa"]), _norm_id(m["matricola"])} - {""}:
            indice.setdefault(k, []).append(voce)
    return indice


def analizza(conn, righe, mezzo_predefinito=None):
    """Controlla le righe di un file di manutenzioni senza salvare niente (anteprima) e le prepara al
    salvataggio. `mezzo_predefinito` (id) vale per le righe con la colonna Mezzo vuota: è il caso del
    file caricato dalla scheda di un mezzo.

    Ritorna {"righe": [{"riga": n del file, "mezzo": {...}|None, "dati": {...}|None, "esito": "ok" |
    "doppione" | "errore", "errore": testo, "grezzi": {mezzo, data, tipo, descrizione, costo come testo}}],
    "valide", "doppioni", "errori", "colonne": {"riconosciute", "ignorate"}}. Le righe vuote e quelle con il solo mezzo (il modello della scheda ha il codice già
    scritto in colonna A) si saltano senza dirlo."""
    i_int, mappa, ignorate = trova_intestazioni(righe)
    if i_int is None:
        raise DatiNonValidi(
            "Non trovo la riga delle intestazioni (Data, Tipo, Descrizione lavori...): scarica il modello "
            "Excel dalla pagina Mezzi e copia lì le manutenzioni.")
    if "mezzo" not in mappa.values() and not mezzo_predefinito:
        raise DatiNonValidi(
            "Nel file manca la colonna «Mezzo (codice, targa o matricola)»: aggiungila oppure carica il file "
            "dalla scheda del mezzo, così vale per quel mezzo.")
    corpo = righe[i_int + 1:]
    if len(corpo) > config.MANUT_IMPORT_MAX_RIGHE:
        raise DatiNonValidi(f"Troppe righe ({len(corpo)}): al massimo {config.MANUT_IMPORT_MAX_RIGHE} per file, dividilo.")
    predefinito = None
    if mezzo_predefinito:
        m = conn.execute("SELECT id, codice, tipo_mezzo, marca, modello, targa FROM mezzi WHERE id = ?",
                         (mezzo_predefinito,)).fetchone()
        if m:
            predefinito = {"id": m["id"], "codice": m["codice"], "targa": m["targa"],
                           "nome": " ".join(x for x in (m["tipo_mezzo"], m["marca"], m["modello"]) if x)}
    indice = _indice_mezzi(conn)
    gia = {r["chiave"] for r in conn.execute("SELECT chiave FROM manutenzioni_mezzi WHERE chiave IS NOT NULL")}
    visti = set()
    esiti = []
    for k, riga in enumerate(corpo):
        valori = {campo: (riga[j] if j < len(riga) else None) for j, campo in mappa.items()}
        pieni = {c for c, v in valori.items() if _testo(v)}
        if not pieni or pieni == {"mezzo"}:
            continue
        # "grezzi" = quello che c'è scritto nel file: l'anteprima lo mostra sulle righe con errori, dove
        # i dati puliti non ci sono, così si ritrova subito la riga da correggere
        voce = {"riga": i_int + k + 2, "mezzo": None, "dati": None, "esito": "ok", "errore": None,
                "grezzi": {c: _testo(valori.get(c)) for c in ("mezzo", "data", "tipo", "descrizione", "costo")}}
        try:
            id_mezzo = _testo(valori.get("mezzo"))
            if id_mezzo:
                trovati = indice.get(_norm_id(id_mezzo), [])
                if not trovati:
                    raise DatiNonValidi(f"Mezzo «{id_mezzo}» non trovato: usa il codice MEZ-…, la targa o la matricola.")
                if len({t["id"] for t in trovati}) > 1:
                    raise DatiNonValidi(f"«{id_mezzo}» corrisponde a più mezzi: usa il codice MEZ-… del mezzo.")
                voce["mezzo"] = trovati[0]
            elif predefinito:
                voce["mezzo"] = predefinito
            else:
                raise DatiNonValidi("Manca il mezzo (codice, targa o matricola).")
            voce["dati"] = valida(valori)
            impronta = chiave(voce["mezzo"]["id"], voce["dati"])
            if impronta in gia:
                voce["esito"], voce["errore"] = "doppione", "Già registrata"
            elif impronta in visti:
                voce["esito"], voce["errore"] = "doppione", "Ripetuta nel file"
            visti.add(impronta)
        except DatiNonValidi as e:
            voce["esito"], voce["errore"] = "errore", str(e)
        esiti.append(voce)
    return {
        "righe": esiti,
        "valide": sum(1 for e in esiti if e["esito"] == "ok"),
        "doppioni": sum(1 for e in esiti if e["esito"] == "doppione"),
        "errori": sum(1 for e in esiti if e["esito"] == "errore"),
        "colonne": {"riconosciute": [INTESTAZIONI[[c[0] for c in COLONNE].index(c)] for c in mappa.values()],
                    "ignorate": ignorate},
    }


def salva_analisi(conn, analisi, utente, file_origine):
    """Salva le righe valide di un'analisi (dopo la conferma dell'utente). Ritorna quante ne sono entrate.
    INSERT OR IGNORE sulla chiave: se nel frattempo qualcuno ha registrato la stessa manutenzione, la
    riga si salta invece di far fallire tutto il file. Il commit lo fa chi chiama."""
    salvate = 0
    for voce in analisi["righe"]:
        if voce["esito"] != "ok":
            continue
        mezzo_id, dati = voce["mezzo"]["id"], voce["dati"]
        cur = conn.execute(
            "INSERT OR IGNORE INTO manutenzioni_mezzi (mezzo_id, data, tipo, descrizione, ore, km, officina, "
            "eseguita_da, costo, prossima_data, prossime_ore, prossimi_km, note, origine, file_origine, chiave, utente) "
            "VALUES (:mezzo_id, :data, :tipo, :descrizione, :ore, :km, :officina, :eseguita_da, :costo, "
            ":prossima_data, :prossime_ore, :prossimi_km, :note, 'excel', :file_origine, :chiave, :utente)",
            {**dati, "mezzo_id": mezzo_id, "file_origine": (file_origine or "")[:200] or None,
             "chiave": chiave(mezzo_id, dati), "utente": utente})
        if cur.rowcount:
            salvate += 1
            aggiorna_letture(conn, mezzo_id, dati.get("ore"), dati.get("km"), dati["data"])
    return salvate
