# "><(((º> sabusabu <º)))><"
"""
Ponte verso i gestionali CPM e Alyante, in sola lettura: dati delle ditte (per partita IVA) e delle commesse (per
codice) letti dal loro database SQL Server, per compilare le maschere senza riscriverli a mano.

Ogni gestionale ha le sue impostazioni (prefisso CPM_ oppure ALYANTE_): SERVER, DATABASE, DRIVER, AUTH, USER,
PASSWORD, TRUST_CERT e una vista per elenco preparata dall'IT:
  VISTA_FORNITORI   una riga per ditta; colonna obbligatoria "piva" (11 cifre, senza IT)
  VISTA_COMMESSE    una riga per commessa; colonna obbligatoria "commessa" (codice, es. 150-110), "descrizione" facoltativa
Le altre colonne si chiamano come i campi della maschera (ragione_sociale, sede, pec, banca, iban_dedicato, cup, cig,
committente, oggetto_appalto...) e li compilano; quelle che non corrispondono a un campo vengono ignorate.
Una vista vuota = quel gestionale non fornisce quell'elenco. Se tutti e due lo forniscono, per le ditte vale prima
Alyante (contabilita') e per le commesse prima CPM; l'altro completa i campi rimasti vuoti.

Sola lettura come sorgente_sql.py (stessa connessione ODBC): solo SELECT costruite qui su viste con nome validato,
valori cercati con formato chiuso (partita IVA, codice commessa), connessione in sola lettura, utente SQL con solo
db_datareader.

Uso:  python ponte.py prova                          collegamento e colonne delle viste di CPM e Alyante
      python ponte.py ditta --piva 01234567890       dati della ditta nei gestionali
      python ponte.py commessa --codice 150-110      dati della commessa
"""

import argparse
import logging
import re
import sys

import env_config
import sorgente_sql as sq

log = logging.getLogger("ponte")

SISTEMI = {"cpm": "CPM", "alyante": "Alyante"}
# elenco -> (impostazione della vista, colonna chiave, ordine dei gestionali)
ELENCHI = {
    "fornitori": ("VISTA_FORNITORI", "piva", ("alyante", "cpm")),
    "commesse": ("VISTA_COMMESSE", "commessa", ("cpm", "alyante")),
}
CAMPI_SQL = ("SERVER", "DATABASE", "DRIVER", "AUTH", "USER", "PASSWORD", "TRUST_CERT")
MAX_COMMESSE = 2000

_PIVA_RE = re.compile(r"^\d{11}$")
_CODICE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$")
_COLONNA_RE = re.compile(r"^[a-z0-9][a-z0-9_]{0,63}$")
_DATA_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})[ T]00:00:00(\.0+)?$")


class PonteError(Exception):
    pass


def chiave(sistema, nome):
    return f"{sistema.upper()}_{nome}"


def impostazioni_sql(s, sistema):
    """Le impostazioni del gestionale con i nomi di sorgente_sql (SQL_SERVER, ...): stessa connessione e controlli."""
    return {f"SQL_{k}": s.get(chiave(sistema, k), "") for k in CAMPI_SQL}


def problemi(s, sistema):
    """Campi ancora da compilare per quel gestionale; vuoto = si puo' usare."""
    if not s.get(chiave(sistema, "SERVER")):
        return ["non configurato"]
    sql = impostazioni_sql(s, sistema)
    out = [f"{chiave(sistema, 'DATABASE')} non impostato"] if not sql["SQL_DATABASE"] else []
    auth = sql["SQL_AUTH"] or "sql"
    if auth not in sq.AUTH_MODES:
        out.append(f"{chiave(sistema, 'AUTH')}: {' / '.join(sq.AUTH_MODES)}")
    elif auth != "windows" and not (sql["SQL_USER"] and sql["SQL_PASSWORD"]):
        out.append("utente e password del database non impostati")
    if not any(s.get(chiave(sistema, v)) for v, _, _ in ELENCHI.values()):
        out.append("nessuna vista impostata (VISTA_FORNITORI, VISTA_COMMESSE)")
    return out


def stato(s):
    """Per la pagina e per 'prova': quali gestionali sono collegati e con quali elenchi."""
    return {sistema: {"nome": nome, "problemi": problemi(s, sistema),
                      "elenchi": [e for e, (v, _, _) in ELENCHI.items() if s.get(chiave(sistema, v))]}
            for sistema, nome in SISTEMI.items()}


def collegati(s):
    """{elenco: [nomi dei gestionali pronti che lo forniscono]}, senza collegarsi."""
    return {e: [SISTEMI[x] for x in _fonti(s, e)] for e in ELENCHI}


def _fonti(s, elenco):
    """Gestionali pronti che forniscono l'elenco, nell'ordine di precedenza."""
    vista, _, ordine = ELENCHI[elenco]
    return [x for x in ordine if s.get(chiave(x, vista)) and not problemi(s, x)]


def apri(s, sistema):
    return sq.open_connection(impostazioni_sql(s, sistema))


def _valore(v):
    v = (v or "").strip()
    m = _DATA_RE.match(v)  # le date arrivano come '2026-10-30 00:00:00.000'
    return m.group(1) if m else v


def _colonne(conn, vista):
    """{nome minuscolo: nome reale} delle colonne della vista."""
    return {c.lower(): c for c in conn.columns(f"SELECT * FROM {sq.quote_view(vista)} WHERE 1=0")}


def _cerca(conn, vista, col, valore):
    """La riga della vista con col = valore (valore gia' validato), con le colonne in minuscolo; None se non c'e'."""
    disponibili = _colonne(conn, vista)
    if col not in disponibili:
        raise PonteError(f"nella vista {vista} manca la colonna '{col}'")
    letterale = "N'" + valore.replace("'", "''") + "'"
    righe = list(conn.rows(f"SELECT TOP 2 * FROM {sq.quote_view(vista)} "
                           f"WHERE {sq._quote_col(disponibili[col])} = {letterale}"))
    if len(righe) > 1:
        log.warning("Vista %s: piu' righe con %s = %s, usata la prima", vista, col, valore)
    if not righe:
        return None
    return {k.lower(): _valore(v) for k, v in righe[0].items() if _COLONNA_RE.match(k.lower())}


def leggi(s, elenco, valore, connetti=None):
    """
    Cerca valore nell'elenco di tutti i gestionali collegati. Restituisce {"trovato", "valori", "fonti": {campo:
    gestionale}, "errori"}: il primo gestionale (ELENCHI) vince, gli altri completano i campi vuoti. Un gestionale
    irraggiungibile finisce in "errori" e non ferma gli altri.
    """
    vista, col, _ = ELENCHI[elenco]
    out = {"trovato": False, "valori": {}, "fonti": {}, "errori": []}
    for sistema in _fonti(s, elenco):
        try:
            with (connetti or apri)(s, sistema) as conn:
                riga = _cerca(conn, s[chiave(sistema, vista)], col, valore)
        except (sq.SqlError, PonteError, ValueError, OSError) as e:
            out["errori"].append(f"{SISTEMI[sistema]}: {e}")
            continue
        if riga is None:
            continue
        out["trovato"] = True
        for k, v in riga.items():
            if v and not out["valori"].get(k):
                out["valori"][k] = v
                out["fonti"][k] = SISTEMI[sistema]
    return out


def ditta(s, piva, connetti=None):
    piva = re.sub(r"\s", "", piva or "").upper().removeprefix("IT")
    if not _PIVA_RE.match(piva):
        raise PonteError("partita IVA non valida: servono 11 cifre")
    return leggi(s, "fornitori", piva, connetti)


def commessa(s, codice, connetti=None):
    codice = (codice or "").strip()
    if not _CODICE_RE.match(codice):
        raise PonteError("codice della commessa non valido")
    return leggi(s, "commesse", codice, connetti)


def commesse(s, connetti=None):
    """Elenco delle commesse (codice e descrizione) da tutti i gestionali collegati, senza doppioni."""
    vista_k, col, _ = ELENCHI["commesse"]
    visti, out, errori = set(), [], []
    for sistema in _fonti(s, "commesse"):
        vista = s[chiave(sistema, vista_k)]
        try:
            with (connetti or apri)(s, sistema) as conn:
                disp = _colonne(conn, vista)
                if col not in disp:
                    raise PonteError(f"nella vista {vista} manca la colonna '{col}'")
                cols = f"{sq._quote_col(disp[col])} AS [commessa]"
                if "descrizione" in disp:
                    cols += f", {sq._quote_col(disp['descrizione'])} AS [descrizione]"
                righe = list(conn.rows(f"SELECT TOP {MAX_COMMESSE} {cols} FROM {sq.quote_view(vista)} "
                                       f"ORDER BY {sq._quote_col(disp[col])}"))
        except (sq.SqlError, PonteError, ValueError, OSError) as e:
            errori.append(f"{SISTEMI[sistema]}: {e}")
            continue
        for r in righe:
            cod = _valore(r.get("commessa"))
            if cod and cod not in visti:
                visti.add(cod)
                out.append({"codice": cod, "descrizione": _valore(r.get("descrizione")), "fonte": SISTEMI[sistema]})
    return {"commesse": out, "errori": errori}


def solo_campi(risultato, campi):
    """Tiene solo i valori dei campi indicati (quelli della maschera che il gestionale puo' compilare)."""
    tieni = set(campi)
    return {**risultato, "valori": {k: v for k, v in risultato["valori"].items() if k in tieni},
            "fonti": {k: v for k, v in risultato["fonti"].items() if k in tieni}}


# --------------------------------------------------------------------------- main

def cmd_prova(s):
    for sistema, st in stato(s).items():
        if st["problemi"]:
            print(f"{st['nome']}: {'; '.join(st['problemi'])}")
            continue
        try:
            with apri(s, sistema) as conn:
                for elenco in st["elenchi"]:
                    vista_k, col, _ = ELENCHI[elenco]
                    vista = s[chiave(sistema, vista_k)]
                    cols = _colonne(conn, vista)
                    manca = "" if col in cols else f"  MANCA la colonna '{col}'"
                    n = next(conn.rows(f"SELECT COUNT(*) AS [n] FROM {sq.quote_view(vista)}"))["n"]
                    print(f"{st['nome']} / {elenco} ({vista}): {n} righe; colonne {', '.join(cols.values())}{manca}")
        except (sq.SqlError, ValueError, OSError) as e:
            print(f"{st['nome']}: {e}")


def main():
    parser = argparse.ArgumentParser(description="Ponte in sola lettura verso CPM e Alyante (ditte e commesse).")
    parser.add_argument("--env", default=None, help="file .env (predefinito: .env accanto al programma)")
    sub = parser.add_subparsers(dest="comando", required=True)
    sub.add_parser("prova", help="collegamento e colonne delle viste")
    sub.add_parser("ditta", help="dati di una ditta").add_argument("--piva", required=True)
    sub.add_parser("commessa", help="dati di una commessa").add_argument("--codice", required=True)
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    s = env_config.load_settings(args.env or env_config.ENV_PATH)
    try:
        if args.comando == "prova":
            cmd_prova(s)
            return
        r = ditta(s, args.piva) if args.comando == "ditta" else commessa(s, args.codice)
    except PonteError as e:
        sys.exit(f"Errore: {e}")
    for err in r["errori"]:
        print(f"Errore {err}")
    if not r["trovato"]:
        print("Non trovata nei gestionali collegati.")
    for k, v in r["valori"].items():
        print(f"{k:24} {v}   ({r['fonti'][k]})")


if __name__ == "__main__":
    main()
