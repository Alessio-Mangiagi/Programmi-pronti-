# -*- coding: utf-8 -*-
"""
importer.py — Import file esterni per Scadenzario Cosedil.

Funzioni (firme vincolate dalla SPEC):
  - importa_calendario_corsi(xlsx_path) : import del foglio "Calendario Corsi"
    (header a riga 4: AULA | CICLO | N° PERS. | GIORNO | LEZ. 1..6 | DOCENTE | SEDE).
    Svuota e ricarica la tabella sessioni_corso.
  - importa_dipendenti_csv(csv_path)    : import CSV dipendenti (separatore ; o ,),
    dedup su codice_fiscale (se presente) oppure su nome+cognome.
"""

import csv
import json
import re
import unicodedata
from datetime import datetime, date

import openpyxl

import database

# Nome del foglio Excel atteso nel file Calendario Corsi
NOME_FOGLIO_CALENDARIO = "Calendario Corsi"

# Colonne CSV accettate per l'import dipendenti (header case-insensitive)
COLONNE_DIPENDENTI = ("nome", "cognome", "codice_fiscale", "mansione",
                      "cantiere", "telefono", "email")


# ---------------------------------------------------------------------------
# Utilità interne
# ---------------------------------------------------------------------------

def _normalizza_header(valore):
    """Normalizza un'intestazione di colonna: str, senza a-capo, spazi compressi, maiuscolo."""
    if valore is None:
        return ""
    testo = str(valore).replace("\n", " ").replace("\r", " ")
    testo = re.sub(r"\s+", " ", testo).strip().upper()
    return testo


def _cella_a_data_iso(valore):
    """Converte una cella lezione in data ISO 'YYYY-MM-DD'. Ritorna None se vuota/non valida."""
    if valore is None or valore == "":
        return None
    if isinstance(valore, datetime):
        return valore.date().isoformat()
    if isinstance(valore, date):
        return valore.isoformat()
    # Fallback: stringhe tipo "08/04/2026" o "2026-04-08"
    testo = str(valore).strip()
    for formato in ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(testo, formato).date().isoformat()
        except ValueError:
            continue
    return None


def chiave_intestazione(valore):
    """Normalizza un'intestazione a chiave stabile: minuscolo, senza accenti,
    caratteri non alfanumerici → '_'. Es. 'Codice fiscale' → 'codice_fiscale',
    'Classe di rischio' → 'classe_di_rischio'. Usata sia per generare i modelli
    sia per rileggerli, così l'accoppiamento colonna→campo è sempre coerente."""
    if valore is None:
        return ""
    testo = unicodedata.normalize("NFKD", str(valore))
    testo = "".join(c for c in testo if not unicodedata.combining(c))
    testo = re.sub(r"[^a-z0-9]+", "_", testo.lower()).strip("_")
    return testo


def _cella_a_valore(valore):
    """Converte una cella xlsx in un valore semplice per l'import massivo:
    date/datetime → ISO 'YYYY-MM-DD', interi float 'puliti' → int, altro → str."""
    if valore is None:
        return None
    if isinstance(valore, datetime):
        return valore.date().isoformat()
    if isinstance(valore, date):
        return valore.isoformat()
    if isinstance(valore, float) and valore.is_integer():
        return str(int(valore))
    testo = str(valore).strip()
    return testo or None


def _conta_non_vuote(cells) -> int:
    return sum(1 for c in cells if c is not None and str(c).strip() != "")


def leggi_righe_tabellari(percorso: str) -> list:
    """Legge un file tabellare (.xlsx primo foglio, oppure .csv/.txt) e ritorna
    una lista di dict con chiavi = intestazioni normalizzate (chiave_intestazione)
    e valori stringa/ISO.

    L'intestazione è la prima riga con almeno 2 celle non vuote: così eventuali
    righe decorative di titolo/istruzioni (una sola cella, come nelle maschere)
    vengono ignorate. Le righe totalmente vuote sono saltate. Base comune per gli
    import massivi."""
    estensione = percorso.lower().rsplit(".", 1)[-1]
    righe = []

    if estensione in ("csv", "txt"):
        try:
            with open(percorso, "r", encoding="utf-8-sig", newline="") as f:
                contenuto = f.read()
        except UnicodeDecodeError:
            with open(percorso, "r", encoding="cp1252", newline="") as f:
                contenuto = f.read()
        linee = contenuto.splitlines()
        if not linee:
            return []
        separatore = ";" if ";" in linee[0] else ","
        lettore = csv.reader(linee, delimiter=separatore)
        intestazioni = None
        for cells in lettore:
            if intestazioni is None:
                if _conta_non_vuote(cells) >= 2:
                    intestazioni = [chiave_intestazione(c) for c in cells]
                continue
            if not _conta_non_vuote(cells):
                continue
            riga = {}
            for i, chiave in enumerate(intestazioni):
                if chiave:
                    val = (cells[i].strip() if i < len(cells) and cells[i] is not None else "")
                    riga[chiave] = val or None
            righe.append(riga)
        return righe

    # xlsx
    try:
        wb = openpyxl.load_workbook(percorso, data_only=True)
    except Exception as exc:
        raise ValueError(f"Impossibile aprire il file Excel: {exc}") from exc
    ws = wb.active
    intestazioni = None
    for riga_cells in ws.iter_rows(values_only=True):
        if intestazioni is None:
            if _conta_non_vuote(riga_cells) >= 2:
                intestazioni = [chiave_intestazione(c) for c in riga_cells]
            continue
        if not _conta_non_vuote(riga_cells):
            continue
        riga = {}
        for i, chiave in enumerate(intestazioni):
            if chiave:
                riga[chiave] = _cella_a_valore(riga_cells[i] if i < len(riga_cells) else None)
        righe.append(riga)
    wb.close()
    return righe


def _trova_riga_header(ws):
    """Trova la riga di intestazione: prima riga con cella in colonna A uguale a 'AULA'.

    Nel file reale è la riga 4 (index 3), ma la ricerca rende l'import
    robusto a piccole variazioni di layout.
    """
    for riga in range(1, min(ws.max_row, 20) + 1):
        if _normalizza_header(ws.cell(riga, 1).value) == "AULA":
            return riga
    return None


# ---------------------------------------------------------------------------
# Import Calendario Corsi (xlsx)
# ---------------------------------------------------------------------------

def importa_calendario_corsi(xlsx_path: str) -> dict:
    """Importa il foglio "Calendario Corsi" dal file xlsx indicato.

    - Header a riga 4 (index 3): AULA | CICLO | N° PERS. | GIORNO | LEZ. 1..6 | DOCENTE | SEDE
    - Righe dati = quelle con cella AULA che inizia per "AULA" (es. "AULA 1");
      le righe separatore (es. "▸ AULE 1-3 — …"), vuote o di totale vengono ignorate.
    - Le celle LEZ.* sono datetime Excel e vengono convertite in date ISO.
    - Re-import: SVUOTA e ricarica la tabella sessioni_corso.

    Ritorna: {"importate": N, "sessioni": [ {...riga sessioni_corso, "lezioni": [...]}, ... ]}
    """
    try:
        wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    except Exception as exc:
        raise ValueError(f"Impossibile aprire il file Excel: {exc}") from exc

    if NOME_FOGLIO_CALENDARIO not in wb.sheetnames:
        wb.close()
        raise ValueError(
            f'Foglio "{NOME_FOGLIO_CALENDARIO}" non trovato nel file. '
            f"Fogli presenti: {', '.join(wb.sheetnames)}"
        )
    ws = wb[NOME_FOGLIO_CALENDARIO]

    riga_header = _trova_riga_header(ws)
    if riga_header is None:
        wb.close()
        raise ValueError('Intestazione non trovata: nessuna riga con cella "AULA" in colonna A.')

    # Mappa colonne per nome (tollerante a varianti tipo "N° PERS."/"N. PERS." e "LEZ. 1\n(8h)")
    col_aula = col_ciclo = col_pers = col_giorno = col_docente = col_sede = None
    colonne_lezioni = []  # in ordine di apparizione
    for col in range(1, ws.max_column + 1):
        nome = _normalizza_header(ws.cell(riga_header, col).value)
        if not nome:
            continue
        if nome == "AULA":
            col_aula = col
        elif nome == "CICLO":
            col_ciclo = col
        elif nome.startswith("N") and "PERS" in nome:
            col_pers = col
        elif nome == "GIORNO":
            col_giorno = col
        elif nome.startswith("LEZ"):
            colonne_lezioni.append(col)
        elif nome == "DOCENTE":
            col_docente = col
        elif nome == "SEDE":
            col_sede = col

    if col_aula is None or not colonne_lezioni:
        wb.close()
        raise ValueError("Intestazione incompleta: attese almeno le colonne AULA e LEZ. 1..6.")

    def _testo(riga, col):
        if col is None:
            return None
        val = ws.cell(riga, col).value
        # "><(((º> sabusabu <º)))><"
        if val is None:
            return None
        testo = str(val).strip()
        return testo or None

    sessioni = []
    for riga in range(riga_header + 1, ws.max_row + 1):
        aula = _testo(riga, col_aula)
        # Righe dati = cella AULA che inizia per "AULA" (esclude separatori "▸ AULE 1-3 —",
        # righe vuote e righe di totale come "TOTALE PARTECIPANTI")
        if not aula or not aula.upper().startswith("AULA"):
            continue

        lezioni = []
        for col in colonne_lezioni:
            iso = _cella_a_data_iso(ws.cell(riga, col).value)
            if iso:
                lezioni.append(iso)

        n_persone = None
        val_pers = ws.cell(riga, col_pers).value if col_pers else None
        if val_pers is not None:
            try:
                n_persone = int(val_pers)
            except (TypeError, ValueError):
                n_persone = None

        lezioni_ordinate = sorted(lezioni)
        sessioni.append({
            "titolo": f"Corso 45h — {aula}",
            "aula": aula,
            "ciclo": _testo(riga, col_ciclo),
            "n_persone": n_persone,
            "giorno_settimana": _testo(riga, col_giorno),
            "docente": _testo(riga, col_docente),
            "sede": _testo(riga, col_sede),
            "data_inizio": lezioni_ordinate[0] if lezioni_ordinate else None,
            "data_fine": lezioni_ordinate[-1] if lezioni_ordinate else None,
            "lezioni": lezioni_ordinate,
        })
    wb.close()

    if not sessioni:
        raise ValueError("Nessuna riga AULA trovata nel foglio: file vuoto o formato non riconosciuto.")

    # Re-import: svuota e ricarica sessioni_corso
    con = database.get_db()
    cur = con.cursor()
    cur.execute("DELETE FROM sessioni_corso")
    for sessione in sessioni:
        cur.execute(
            """INSERT INTO sessioni_corso
               (titolo, aula, ciclo, n_persone, giorno_settimana, docente, sede,
                data_inizio, data_fine, lezioni_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (sessione["titolo"], sessione["aula"], sessione["ciclo"],
             sessione["n_persone"], sessione["giorno_settimana"],
             sessione["docente"], sessione["sede"],
             sessione["data_inizio"], sessione["data_fine"],
             json.dumps(sessione["lezioni"])),
        )
        sessione["id"] = cur.lastrowid
    con.commit()

    return {"importate": len(sessioni), "sessioni": sessioni}


# ---------------------------------------------------------------------------
# Import dipendenti (csv)
# ---------------------------------------------------------------------------

def importa_dipendenti_csv(csv_path: str) -> dict:
    """Importa dipendenti da CSV.

    Colonne accettate (header, separatore ; o ,):
      nome;cognome;codice_fiscale;mansione;cantiere;telefono;email
    Solo nome e cognome sono obbligatori. Dedup su codice_fiscale (se presente,
    confronto maiuscolo) oppure su nome+cognome (case-insensitive).

    Ritorna: {"importati": N, "saltati": M, "errori": [...]}
    """
    try:
        with open(csv_path, "r", encoding="utf-8-sig", newline="") as f:
            contenuto = f.read()
    except UnicodeDecodeError:
        # Fallback per file salvati da Excel in codifica Windows
        with open(csv_path, "r", encoding="cp1252", newline="") as f:
            contenuto = f.read()
    except Exception as exc:
        raise ValueError(f"Impossibile leggere il file CSV: {exc}") from exc

    righe = contenuto.splitlines()
    if not righe:
        raise ValueError("File CSV vuoto.")

    # Separatore: ';' se presente nell'header, altrimenti ','
    separatore = ";" if ";" in righe[0] else ","
    lettore = csv.DictReader(righe, delimiter=separatore)
    if not lettore.fieldnames:
        raise ValueError("Intestazione CSV mancante.")

    # Header normalizzati (minuscolo, senza spazi) → nome campo originale del file
    mappa_header = {}
    for campo in lettore.fieldnames:
        chiave = (campo or "").strip().lower().replace(" ", "_")
        if chiave in COLONNE_DIPENDENTI:
            mappa_header[chiave] = campo

    if "nome" not in mappa_header or "cognome" not in mappa_header:
        raise ValueError(
            "Intestazione CSV non valida: servono almeno le colonne 'nome' e 'cognome'. "
            f"Colonne accettate: {', '.join(COLONNE_DIPENDENTI)}"
        )

    con = database.get_db()
    cur = con.cursor()

    # Chiavi già presenti nel DB per il dedup
    cf_esistenti = set()
    nomi_esistenti = set()
    for r in cur.execute("SELECT nome, cognome, codice_fiscale FROM dipendenti"):
        nome_db, cognome_db, cf_db = r[0], r[1], r[2]
        if cf_db:
            cf_esistenti.add(str(cf_db).strip().upper())
        nomi_esistenti.add((str(nome_db).strip().lower(), str(cognome_db).strip().lower()))

    importati = 0
    saltati = 0
    errori = []

    for indice, riga in enumerate(lettore, start=2):  # riga 1 = header
        def _valore(chiave):
            campo = mappa_header.get(chiave)
            if campo is None:
                return None
            val = (riga.get(campo) or "").strip()
            return val or None

        nome = _valore("nome")
        cognome = _valore("cognome")
        if not nome or not cognome:
            # Riga completamente vuota → ignorata in silenzio, altrimenti errore
            if any((riga.get(c) or "").strip() for c in (lettore.fieldnames or [])):
                errori.append(f"Riga {indice}: nome o cognome mancante, riga scartata.")
            continue

        codice_fiscale = _valore("codice_fiscale")
        if codice_fiscale:
            codice_fiscale = codice_fiscale.upper()

        # Dedup: codice_fiscale se presente, altrimenti nome+cognome
        chiave_nome = (nome.lower(), cognome.lower())
        if codice_fiscale:
            duplicato = codice_fiscale in cf_esistenti
        else:
            duplicato = chiave_nome in nomi_esistenti
        if duplicato:
            saltati += 1
            continue

        try:
            cur.execute(
                """INSERT INTO dipendenti
                   (nome, cognome, codice_fiscale, mansione, cantiere, telefono, email)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (nome, cognome, codice_fiscale, _valore("mansione"),
                 _valore("cantiere"), _valore("telefono"), _valore("email")),
            )
        except Exception as exc:  # es. violazione UNIQUE su codice_fiscale
            errori.append(f"Riga {indice}: errore inserimento ({exc}).")
            continue

        importati += 1
        if codice_fiscale:
            cf_esistenti.add(codice_fiscale)
        nomi_esistenti.add(chiave_nome)

    con.commit()
    return {"importati": importati, "saltati": saltati, "errori": errori}


if __name__ == "__main__":
    # Test manuale: python importer.py <file.xlsx|file.csv>
    import sys
    if len(sys.argv) != 2:
        print("Uso: python importer.py <calendario.xlsx | dipendenti.csv>")
        sys.exit(1)
    percorso = sys.argv[1]
    if percorso.lower().endswith(".csv"):
        print(json.dumps(importa_dipendenti_csv(percorso), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(importa_calendario_corsi(percorso), ensure_ascii=False, indent=2))
