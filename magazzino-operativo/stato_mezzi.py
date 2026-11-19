# "><(((º> sabusabu <º)))><"
"""Stato dei mezzi da scaricare (PDF ed Excel) e modello Excel delle manutenzioni.

Perché esiste (19/11/2026): dalla scheda di un mezzo e dalla pagina Mezzi si scarica lo stato generale
del singolo mezzo o di tutta la flotta (anagrafica, posizione, chi lo usa, contaore, manutenzioni,
scadenze, costi, spostamenti), da stampare (PDF) o da rielaborare (Excel). Usa i generatori senza
dipendenze pdf_semplice e xlsx_semplice e i conti di manutenzioni.py. Rotte in app.py:
/api/mezzi/<id>/stato, /api/mezzi/flotta, /api/mezzi/manutenzioni/modello.

Il foglio "Manutenzioni" degli Excel scaricati ha le stesse prime colonne del modello: si può
correggere e ricaricare (le righe già presenti vengono riconosciute come doppioni e saltate).
"""
from datetime import date

import manutenzioni as mt
import pdf_semplice
import xlsx_semplice

NOMI_STATO_MEZZO = {"disponibile": "Disponibile", "in_uso": "In uso", "manutenzione": "In manutenzione",
                    "fermo": "Fermo", "restituito": "Restituito"}
ORIGINI = {"manuale": "a mano", "excel": "da Excel"}
MIME = {"pdf": "application/pdf",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}


def _nome(m):
    return " ".join(x for x in (m["tipo_mezzo"], m["marca"], m["modello"]) if x)


def _data(iso):
    """Testo AAAA-MM-GG → date (cella data vera in Excel); vuoto → None; altro resta testo."""
    if not iso:
        return None
    try:
        return date.fromisoformat(str(iso)[:10])
    except ValueError:
        return str(iso)


def _euro(n):
    return f"€ {mt.fmt_numero(n, 2)}" if n is not None else ""


def _ore_km(r):
    pezzi = []
    if r.get("ore") is not None:
        pezzi.append(f"{mt.fmt_numero(r['ore'])} h")
    if r.get("km") is not None:
        pezzi.append(f"{mt.fmt_numero(r['km'])} km")
    return " · ".join(pezzi)


def _mancano(s):
    """Quanto manca alla scadenza, in parole: "35 gg · 120 h" o "scaduta da 5 gg"."""
    pezzi = []
    if s["giorni"] is not None:
        pezzi.append(f"scaduta da {-s['giorni']} gg" if s["giorni"] < 0 else f"{s['giorni']} gg")
    if s["ore_mancanti"] is not None:
        pezzi.append(f"oltre di {mt.fmt_numero(-s['ore_mancanti'])} h" if s["ore_mancanti"] <= 0
                     else f"{mt.fmt_numero(s['ore_mancanti'])} h")
    if s["km_mancanti"] is not None:
        pezzi.append(f"oltre di {mt.fmt_numero(-s['km_mancanti'])} km" if s["km_mancanti"] <= 0
                     else f"{mt.fmt_numero(s['km_mancanti'])} km")
    return " · ".join(pezzi)


def _mezzo(conn, mezzo_id):
    return conn.execute(
        "SELECT m.*, u.nome AS ubicazione, u.commessa AS ubicazione_commessa FROM mezzi m "
        "LEFT JOIN ubicazioni u ON u.id = m.ubicazione_id WHERE m.id = ?", (mezzo_id,)).fetchone()


def _storico(conn, mezzo_id):
    return [dict(r) for r in conn.execute(
        "SELECT s.ts, s.stato, s.utente, s.note, ud.nome AS da_nome, ua.nome AS a_nome FROM movimenti_mezzi s "
        "LEFT JOIN ubicazioni ud ON ud.id = s.da_ubicazione_id LEFT JOIN ubicazioni ua ON ua.id = s.a_ubicazione_id "
        "WHERE s.mezzo_id = ? ORDER BY s.id DESC", (mezzo_id,))]


def _riga_manutenzione(m, man, con_mezzo=False):
    """Una manutenzione come riga Excel: prime 13 colonne = modello (ricaricabile), poi le informazioni
    di registro. Il tipo si scrive per nome ("Tagliando / ordinaria"): tipo_da_testo lo riconosce."""
    riga = [m["codice"], _data(man["data"]), mt.TIPI.get(man["tipo"], man["tipo"]), man["descrizione"], man["ore"],
            man["km"], man["officina"], man["eseguita_da"], man["costo"], _data(man["prossima_data"]),
            man["prossime_ore"], man["prossimi_km"], man["note"]]
    if con_mezzo:
        riga.append(_nome(m))
    return riga + [man["utente"], ORIGINI.get(man["origine"], man["origine"]), man["creato_il"]]


LARGHEZZE_MANUTENZIONI = [22, 12, 24, 44, 11, 11, 26, 18, 12, 13, 12, 12, 30]


# --------------------------------------------------------------------------- modello da compilare

def modello_xlsx(conn, mezzo=None):
    """Modello Excel delle manutenzioni passate → (bytes, nome file).

    Dalla scheda di un mezzo (`mezzo` = riga del mezzo) il codice è già scritto nelle prime righe della
    colonna Mezzo; dalla pagina Mezzi è vuoto e vale per tutta la flotta (foglio "Mezzi" con i codici)."""
    righe_dati = [[mezzo["codice"]] for _ in range(30)] if mezzo else []
    tipi = "; ".join(mt.TIPI.values())
    istruzioni = [
        ["Mezzo (codice, targa o matricola)",
         "Il codice MEZ-… dell'etichetta, la targa o la matricola (foglio «Mezzi»). Dal modello della scheda "
         "di un mezzo è già scritto; se lo lasci vuoto vale il mezzo da cui carichi il file."],
        ["Data", "Obbligatoria. Giorno dell'intervento, gg/mm/aaaa."],
        ["Tipo", f"Uno di: {tipi}. Valgono anche parole come tagliando, riparazione, collaudo, pneumatici. "
                 "Vuoto = Altro."],
        ["Descrizione lavori", "Obbligatoria (se manca si usa il tipo). Cosa è stato fatto, ricambi."],
        ["Ore motore", "Contaore del mezzo al momento dell'intervento (facoltativo)."],
        ["Km", "Contachilometri al momento dell'intervento (facoltativo)."],
        ["Officina / fornitore", "Chi ha fatto il lavoro (facoltativo)."],
        ["Eseguita da", "Persona: meccanico, operatore (facoltativo)."],
        ["Costo €", "Importo in euro, solo il numero (facoltativo). Scrivilo sempre allo stesso modo, "
                    "per esempio IVA esclusa, così i totali si confrontano."],
        ["Prossima data", "Entro quando va rifatto lo stesso tipo di intervento (facoltativo)."],
        ["Prossime ore", "A quante ore di contaore va rifatto (facoltativo)."],
        ["Prossimi km", "A quanti km va rifatto (facoltativo). Fra data, ore e km vale quello che arriva prima."],
        ["Note", "Qualsiasi altra informazione (facoltativo)."],
        ["", ""],
        ["Doppioni", "Una riga uguale a una già registrata (stesso mezzo, data, tipo, descrizione, ore, km e "
                     "costo) viene saltata: puoi ricaricare lo stesso file senza creare doppioni."],
        ["Anteprima", "Prima di salvare il Magazzino mostra le righe valide, i doppioni e gli errori riga per "
                      "riga: si salva solo dopo la conferma."],
    ]
    elenco = [[m["codice"], _nome(m), m["targa"] or "", m["matricola"] or "", m["ubicazione"] or "",
               "sì" if m["attivo"] else "no"]
              for m in conn.execute("SELECT m.*, u.nome AS ubicazione FROM mezzi m LEFT JOIN ubicazioni u "
                                    "ON u.id = m.ubicazione_id ORDER BY m.attivo DESC, m.codice")]
    dati = xlsx_semplice.documento_xlsx([
        {"nome": "Manutenzioni", "intestazioni": mt.INTESTAZIONI, "righe": righe_dati,
         "larghezze": LARGHEZZE_MANUTENZIONI},
        {"nome": "Istruzioni", "intestazioni": ["Colonna", "Cosa scrivere"], "righe": istruzioni, "larghezze": [32, 110]},
        {"nome": "Mezzi", "intestazioni": ["Codice", "Mezzo", "Targa", "Matricola", "Ubicazione", "Attivo"],
         "righe": elenco, "larghezze": [12, 40, 12, 18, 30, 8]},
    ])
    nome = f"Modello manutenzioni {mezzo['codice']}.xlsx" if mezzo else "Modello manutenzioni mezzi.xlsx"
    return dati, nome


# --------------------------------------------------------------------------- stato di un mezzo

def _voci_mezzo(m, r):
    """Anagrafica e quadro del mezzo come coppie (voce, dato); le voci senza dato si saltano."""
    lettura = f" (lettura del {mt.fmt_data(m['lettura_il'])})" if m["lettura_il"] else ""
    ultima = r["ultima"]
    prossima = r["prossima"]
    voci = [
        ("Codice", m["codice"]), ("Mezzo", _nome(m)), ("Targa", m["targa"]), ("Matricola", m["matricola"]),
        ("Proprietà", "A nolo" if m["proprieta"] == "nolo" else "Di proprietà"),
        ("Ditta proprietaria", " · ".join(x for x in (m["ditta"], f"P.IVA {m['piva']}" if m["piva"] else "") if x)),
        ("Nolo", f"dal {mt.fmt_data(m['nolo_dal'])} al {mt.fmt_data(m['nolo_al'])}" if m["nolo_dal"] or m["nolo_al"] else ""),
        ("Stato", NOMI_STATO_MEZZO.get(m["stato"], m["stato"])), ("In uso da", m["assegnato_a"]),
        ("Ubicazione", " · ".join(x for x in (m["ubicazione"], f"commessa {m['ubicazione_commessa']}" if m["ubicazione_commessa"] else "") if x)
         or "non registrata"),
        ("Contaore", f"{mt.fmt_numero(r['ore_attuali'])} h{lettura}" if r["ore_attuali"] is not None else ""),
        ("Contachilometri", f"{mt.fmt_numero(r['km_attuali'])} km{lettura}" if r["km_attuali"] is not None else ""),
        ("Manutenzioni registrate", str(r["n"])),
        ("Costo manutenzioni", f"{_euro(r['costo_totale'])} in totale · {_euro(r['costo_anno'])} nel {r['anno']}" if r["n"] else ""),
        ("Ultima manutenzione", f"{mt.fmt_data(ultima['data'])} · {ultima['tipo_nome']} · {ultima['descrizione']}" if ultima else ""),
        ("Prossima manutenzione", f"{prossima['tipo_nome']} {mt.testo_scadenza(prossima)} · {mt.NOMI_STATO[prossima['stato']]}"
         if prossima else "nessuna scadenza indicata"),
        ("Attivo", "sì" if m["attivo"] else "no, dismesso"), ("Note", m["note"]),
    ]
    return [(v, d) for v, d in voci if d]


def stato_mezzo(conn, mezzo_id, formato="pdf", oggi=None):
    """Stato generale di un mezzo → (bytes, nome file). None se il mezzo non esiste."""
    oggi = oggi or date.today()
    m = _mezzo(conn, mezzo_id)
    if not m:
        return None
    man = mt.elenco(conn, mezzo_id)
    r = mt.riepilogo(m, man, oggi)
    storico = _storico(conn, mezzo_id)
    voci = _voci_mezzo(m, r)
    nome_file = f"Stato mezzo {m['codice']} {oggi.isoformat()}.{formato}"
    if formato == "xlsx":
        return xlsx_semplice.documento_xlsx([
            {"nome": "Mezzo", "intestazioni": ["Voce", "Dato"], "righe": [list(v) for v in voci], "larghezze": [26, 90]},
            {"nome": "Scadenze", "intestazioni": ["Tipo", "Ultimo intervento", "Descrizione", "Prossima data", "Prossime ore",
                                                  "Prossimi km", "Giorni mancanti", "Ore mancanti", "Km mancanti", "Stato"],
             "righe": [[s["tipo_nome"], _data(s["data_intervento"]), s["descrizione"], _data(s["prossima_data"]),
                        s["prossime_ore"], s["prossimi_km"], s["giorni"], s["ore_mancanti"], s["km_mancanti"],
                        mt.NOMI_STATO[s["stato"]]] for s in r["scadenze"]],
             "larghezze": [24, 14, 40, 14, 12, 12, 14, 12, 12, 14]},
            {"nome": "Manutenzioni", "intestazioni": mt.INTESTAZIONI + ["Registrata da", "Origine", "Registrata il"],
             "righe": [_riga_manutenzione(m, x) for x in man], "larghezze": LARGHEZZE_MANUTENZIONI + [16, 10, 18]},
            {"nome": "Spostamenti", "intestazioni": ["Data", "Da", "A", "Stato", "Chi", "Note"],
             "righe": [[s["ts"], s["da_nome"], s["a_nome"], NOMI_STATO_MEZZO.get(s["stato"], s["stato"] or ""),
                        s["utente"], s["note"]] for s in storico],
             "larghezze": [18, 28, 28, 16, 16, 50]},
        ]), nome_file
    sotto = " · ".join(x for x in (_nome(m), m["targa"], f"Magazzino Operativo Cosedil · {pdf_semplice.data_it()}") if x)
    # Larghezze in punti sui 515 utili dell'A4 verticale: una data gg/mm/aaaa ne vuole ~60, "€ 3.200,00" ~62.
    # Intestazioni corte ("Fatto il", "Costo") perché pdf_semplice le scrive in maiuscolo e le stima strette.
    return pdf_semplice.documento_pdf([
        {"titolo": f"Stato del mezzo {m['codice']}", "sottotitolo": sotto, "intestazioni": ["Voce", "Dato"],
         "righe": [list(v) for v in voci], "larghezze": [125, 390]},
        {"titolo": "Scadenze delle manutenzioni", "stessa_pagina": True,
         "intestazioni": ["Tipo", "Fatto il", "Prossima", "Mancano", "Stato"],
         "righe": [[s["tipo_nome"], mt.fmt_data(s["data_intervento"]), mt.testo_scadenza(s), _mancano(s),
                    mt.NOMI_STATO[s["stato"]]] for s in r["scadenze"]],
         "larghezze": [118, 62, 160, 105, 70]},
        {"titolo": f"Manutenzioni ({r['n']})", "stessa_pagina": True,
         "intestazioni": ["Data", "Tipo", "Lavori", "Ore / km", "Officina", "Costo"], "numeriche": (5,),
         "righe": [[mt.fmt_data(x["data"]), mt.TIPI_BREVI.get(x["tipo"], x["tipo"]), x["descrizione"], _ore_km(x),
                    x["officina"] or x["eseguita_da"] or "", _euro(x["costo"])] for x in man],
         "larghezze": [62, 70, 175, 62, 80, 66]},
        {"titolo": "Spostamenti e cambi di stato", "stessa_pagina": True,
         "intestazioni": ["Data", "Da", "A", "Stato", "Chi"],
         "righe": [[mt.fmt_data(s["ts"]), s["da_nome"] or "—", s["a_nome"] or "—",
                    NOMI_STATO_MEZZO.get(s["stato"], s["stato"] or ""), s["utente"] or ""] for s in storico],
         "larghezze": [62, 140, 140, 85, 88]},
    ], piede=f"Magazzino Operativo Cosedil · stato del mezzo {m['codice']}"), nome_file


# --------------------------------------------------------------------------- stato della flotta

def stato_flotta(conn, formato="pdf", tutti=False, oggi=None):
    """Stato di tutti i mezzi (attivi; `tutti` = anche i dismessi) → (bytes, nome file)."""
    oggi = oggi or date.today()
    mezzi = conn.execute(
        "SELECT m.*, u.nome AS ubicazione, u.commessa AS ubicazione_commessa FROM mezzi m "
        "LEFT JOIN ubicazioni u ON u.id = m.ubicazione_id " + ("" if tutti else "WHERE m.attivo = 1 ")
        + "ORDER BY m.tipo_mezzo, m.marca, m.codice").fetchall()
    rie = mt.riepiloghi(conn, mezzi, oggi)
    nome_file = f"Stato flotta mezzi {oggi.isoformat()}.{formato}"
    scadute = sum(1 for m in mezzi if rie[m["id"]]["stato"] == "scaduta")
    in_scadenza = sum(1 for m in mezzi if rie[m["id"]]["stato"] == "in_scadenza")
    costo_anno = sum(rie[m["id"]]["costo_anno"] for m in mezzi)
    # scadenze da guardare (scadute e in scadenza) di tutta la flotta, le più urgenti per prime
    urgenti = sorted(((m, s) for m in mezzi for s in rie[m["id"]]["scadenze"] if s["stato"] != "ok"),
                     key=lambda x: (-mt.GRAVITA[x[1]["stato"]], x[1]["giorni"] if x[1]["giorni"] is not None else 10 ** 9))
    if formato == "xlsx":
        righe_flotta = []
        for m in mezzi:
            r = rie[m["id"]]
            p, u = r["prossima"], r["ultima"]
            righe_flotta.append([
                m["codice"], m["tipo_mezzo"], m["marca"], m["modello"], m["targa"], m["matricola"],
                "nolo" if m["proprieta"] == "nolo" else "proprio", m["ditta"], _data(m["nolo_dal"]), _data(m["nolo_al"]),
                NOMI_STATO_MEZZO.get(m["stato"], m["stato"]), m["assegnato_a"], m["ubicazione"], m["ubicazione_commessa"],
                r["ore_attuali"], r["km_attuali"], _data(m["lettura_il"]), r["n"], r["costo_totale"], r["costo_anno"],
                _data(u["data"]) if u else None, f"{u['tipo_nome']} · {u['descrizione']}" if u else "",
                f"{p['tipo_nome']} {mt.testo_scadenza(p)}" if p else "", mt.NOMI_STATO[r["stato"]],
                "sì" if m["attivo"] else "no"])
        tutte_scadenze = [[m["codice"], _nome(m), s["tipo_nome"], _data(s["data_intervento"]), _data(s["prossima_data"]),
                           s["prossime_ore"], s["prossimi_km"], s["giorni"], s["ore_mancanti"], s["km_mancanti"],
                           mt.NOMI_STATO[s["stato"]]]
                          for m in mezzi for s in rie[m["id"]]["scadenze"]]
        per_id = {m["id"]: m for m in mezzi}
        segnaposto = ",".join("?" * len(per_id)) or "NULL"
        tutte_man = [_riga_manutenzione(per_id[x["mezzo_id"]], dict(x), con_mezzo=True) for x in conn.execute(
            f"SELECT * FROM manutenzioni_mezzi WHERE mezzo_id IN ({segnaposto}) ORDER BY data DESC, id DESC", list(per_id))]
        return xlsx_semplice.documento_xlsx([
            {"nome": "Flotta", "intestazioni": [
                "Codice", "Tipo", "Marca", "Modello", "Targa", "Matricola", "Proprietà", "Ditta (nolo)", "Nolo dal",
                "Nolo al", "Stato", "In uso da", "Ubicazione", "Commessa", "Contaore", "Contachilometri", "Lettura del",
                "Manutenzioni", "Costo totale €", f"Costo {oggi.year} €", "Ultima manutenzione", "Ultimo intervento",
                "Prossima manutenzione", "Stato manutenzioni", "Attivo"],
             "righe": righe_flotta,
             "larghezze": [12, 20, 14, 16, 11, 16, 9, 24, 11, 11, 15, 16, 24, 12, 10, 14, 11, 13, 14, 12, 18, 40, 36, 17, 7]},
            {"nome": "Scadenze", "intestazioni": ["Codice", "Mezzo", "Tipo", "Ultimo intervento", "Prossima data",
                                                  "Prossime ore", "Prossimi km", "Giorni mancanti", "Ore mancanti",
                                                  "Km mancanti", "Stato"],
             "righe": tutte_scadenze, "larghezze": [12, 34, 24, 14, 14, 12, 12, 14, 12, 12, 14]},
            {"nome": "Manutenzioni", "intestazioni": mt.INTESTAZIONI + ["Descrizione mezzo", "Registrata da", "Origine",
                                                                        "Registrata il"],
             "righe": tutte_man, "larghezze": LARGHEZZE_MANUTENZIONI + [34, 16, 10, 18]},
        ]), nome_file
    sotto = (f"{len(mezzi)} mezzi · {scadute} con manutenzioni scadute · {in_scadenza} in scadenza · "
             f"costo manutenzioni {oggi.year}: {_euro(costo_anno)} · {pdf_semplice.data_it()}")
    righe_pdf = []
    for m in mezzi:
        r = rie[m["id"]]
        p = r["prossima"]
        righe_pdf.append([
            m["codice"], _nome(m), m["targa"] or m["matricola"] or "", NOMI_STATO_MEZZO.get(m["stato"], m["stato"]),
            m["ubicazione"] or "—", mt.fmt_data(r["ultima"]["data"]) if r["ultima"] else "",
            mt.NOMI_STATO[r["stato"]] if r["n"] else "", f"{mt.TIPI_BREVI[p['tipo']]} {mt.testo_scadenza(p)}" if p else "",
            _euro(r["costo_totale"]) if r["n"] else ""])
    # A4 orizzontale: nove colonne in verticale tagliavano anche i codici. Larghezze in punti sui 762 utili.
    return pdf_semplice.documento_pdf([
        {"titolo": "Stato della flotta mezzi", "sottotitolo": sotto,
         "intestazioni": ["Codice", "Mezzo", "Targa / matr.", "Stato", "Ubicazione", "Ultima man.", "Manutenzioni",
                          "Prossima", "Costo"],
         "numeriche": (8,), "righe": righe_pdf, "larghezze": [60, 127, 85, 82, 90, 60, 66, 130, 62]},
        {"titolo": "Manutenzioni scadute e in scadenza", "stessa_pagina": True,
         "intestazioni": ["Codice", "Mezzo", "Targa / matricola", "Tipo", "Prossima", "Mancano", "Stato"],
         "righe": [[m["codice"], _nome(m), m["targa"] or m["matricola"] or "", s["tipo_nome"], mt.testo_scadenza(s),
                    _mancano(s), mt.NOMI_STATO[s["stato"]]] for m, s in urgenti],
         "larghezze": [60, 170, 92, 120, 130, 110, 80]},
    ], piede="Magazzino Operativo Cosedil · stato della flotta mezzi", orizzontale=True), nome_file
