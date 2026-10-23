# "><(((º> sabusabu <º)))><"
"""
Sorgente SQL in sola lettura: legge i documenti da un archivio SQL Server (database di Alyante, data lake con
endpoint SQL, ...) e li passa al trasferimento verso VFP come SourceItem, senza export manuali.

Il database si legge da una vista preparata dall'IT (SQL_VIEW) con queste colonne (nomi esatti, maiuscole libere):
  id            identificativo del documento                                  obbligatoria
  nome_file     nome del file con estensione                                  obbligatoria
  contenuto     il file (varbinary)                  } una delle due, secondo SQL_FILE_MODE
  percorso      percorso completo del file (UNC)     }
  cartella      cartella di destinazione in VFP, separata da "/"             facoltativa
  nome          nome del documento in VFP (vuota = nome_file senza estensione) facoltativa
  revisione     revisione (vuota = VFP_DEFAULT_REVISION)                     facoltativa
  descrizione                                                                facoltativa
  modificato    data di modifica: a ogni giro si leggono solo le novita'      facoltativa

Sola lettura garantita tre volte: il programma esegue solo le SELECT costruite qui (il nome della vista e'
validato), la connessione e' aperta in sola lettura (SQL_ATTR_ACCESS_MODE, ApplicationIntent=ReadOnly) e
l'utente SQL deve avere solo db_datareader.
Con SQL_FILE_MODE=percorso i file devono stare sotto SQL_PATH_ROOT: un percorso scritto nel database non puo'
far caricare in VFP file qualsiasi di questo PC.

ODBC via ctypes (odbc32.dll), senza librerie esterne: funziona con il driver "SQL Server" di Windows, meglio
"ODBC Driver 18 for SQL Server" (TLS moderno, Azure SQL / Entra ID).

Uso:  python sorgente_sql.py prova                    collegamento, colonne della vista, numero di documenti
      python sorgente_sql.py trasferisci [--dry-run]  scarica le novita' e le carica in VFP
"""

import argparse
import ctypes
import json
import logging
import os
import re
import sys
from datetime import datetime
from pathlib import Path

import env_config
import vfp_transfer as vt
from vfp_mail import _safe_name

log = logging.getLogger("sorgente_sql")

BASE_DIR = Path(__file__).resolve().parent
STATE_PATH = BASE_DIR / "stato_sql.json"
TRANSFER_STATE_PATH = BASE_DIR / "stato_trasferimento.json"  # lo stesso della GUI: niente doppi caricamenti
REPORT_PATH = BASE_DIR / "report_trasferimento.csv"

REQUIRED_COLS = ("id", "nome_file")
OPTIONAL_COLS = ("cartella", "nome", "revisione", "descrizione", "modificato")
FILE_COLS = {"contenuto": "contenuto", "percorso": "percorso"}  # SQL_FILE_MODE -> colonna del file
PREFERRED_DRIVERS = ("ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server", "SQL Server")
AUTH_MODES = ("sql", "windows", "entra")

_VIEW_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*){0,2}$")
_TS_RE = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")
_SERVER_RE = re.compile(r"^(tcp:)?[A-Za-z0-9._-]{1,253}(\\[A-Za-z0-9_$-]{1,64})?(,\d{1,5})?$")
_DATABASE_RE = re.compile(r"^[^\[\]{};=\x00-\x1f]{1,128}$")
_DRIVER_RE = re.compile(r"^[A-Za-z0-9 ._-]{0,80}$")


class SqlError(Exception):
    pass


# --------------------------------------------------------------------------- ODBC

SQL_SUCCESS, SQL_SUCCESS_WITH_INFO, SQL_NO_DATA = 0, 1, 100
SQL_HANDLE_ENV, SQL_HANDLE_DBC, SQL_HANDLE_STMT = 1, 2, 3
SQL_NULL_DATA, SQL_NO_TOTAL, SQL_NTS = -1, -4, -3
SQL_C_WCHAR, SQL_C_BINARY = -8, -2
SQL_ATTR_ODBC_VERSION, SQL_OV_ODBC3 = 200, 3
SQL_ATTR_ACCESS_MODE, SQL_MODE_READ_ONLY = 101, 1
SQL_ATTR_LOGIN_TIMEOUT = 103
SQL_DRIVER_NOPROMPT = 0
CHUNK = 1 << 20  # lettura a blocchi da 1 MB: i file grandi non passano mai interi dalla memoria


def _odbc():
    from ctypes import POINTER, c_int, c_short, c_ssize_t, c_size_t, c_ushort, c_void_p, c_wchar_p

    f = ctypes.WinDLL("odbc32")
    protos = {
        "SQLAllocHandle": (c_short, c_void_p, POINTER(c_void_p)),
        "SQLSetEnvAttr": (c_void_p, c_int, c_void_p, c_int),
        "SQLSetConnectAttrW": (c_void_p, c_int, c_void_p, c_int),
        "SQLDriverConnectW": (c_void_p, c_void_p, c_wchar_p, c_short, c_wchar_p, c_short, POINTER(c_short), c_ushort),
        "SQLExecDirectW": (c_void_p, c_wchar_p, c_int),
        "SQLNumResultCols": (c_void_p, POINTER(c_short)),
        "SQLDescribeColW": (c_void_p, c_ushort, c_wchar_p, c_short, POINTER(c_short), POINTER(c_short),
                            POINTER(c_size_t), POINTER(c_short), POINTER(c_short)),
        "SQLFetch": (c_void_p,),
        "SQLGetData": (c_void_p, c_ushort, c_short, c_void_p, c_ssize_t, POINTER(c_ssize_t)),
        "SQLGetDiagRecW": (c_short, c_void_p, c_short, c_wchar_p, POINTER(c_int), c_wchar_p, c_short, POINTER(c_short)),
        "SQLDisconnect": (c_void_p,),
        "SQLFreeHandle": (c_short, c_void_p),
    }
    for name, args in protos.items():
        fn = getattr(f, name)
        fn.argtypes, fn.restype = args, c_short
    return f


class OdbcConnection:
    """Connessione ODBC minima, solo lettura. Si usa con with: alla fine chiude sempre la connessione."""

    def __init__(self, connstr, timeout=15):
        self._f = _odbc()
        self._env = self._alloc(SQL_HANDLE_ENV, None)
        self._f.SQLSetEnvAttr(self._env, SQL_ATTR_ODBC_VERSION, SQL_OV_ODBC3, 0)
        self._dbc = self._alloc(SQL_HANDLE_DBC, self._env)
        self._f.SQLSetConnectAttrW(self._dbc, SQL_ATTR_LOGIN_TIMEOUT, timeout, 0)
        self._f.SQLSetConnectAttrW(self._dbc, SQL_ATTR_ACCESS_MODE, SQL_MODE_READ_ONLY, 0)
        out = ctypes.create_unicode_buffer(1024)
        out_len = ctypes.c_short()
        rc = self._f.SQLDriverConnectW(self._dbc, None, connstr, SQL_NTS, out, 1024, ctypes.byref(out_len),
                                       SQL_DRIVER_NOPROMPT)
        if rc not in (SQL_SUCCESS, SQL_SUCCESS_WITH_INFO):  # il messaggio non contiene mai la stringa di connessione
            msg = self._diag(SQL_HANDLE_DBC, self._dbc)
            self._free()
            raise SqlError(f"collegamento al database non riuscito: {msg}")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def close(self):
        if self._dbc:
            self._f.SQLDisconnect(self._dbc)
        self._free()

    def _free(self):
        for kind, attr in ((SQL_HANDLE_DBC, "_dbc"), (SQL_HANDLE_ENV, "_env")):
            if getattr(self, attr, None):
                self._f.SQLFreeHandle(kind, getattr(self, attr))
                setattr(self, attr, None)

    def _alloc(self, kind, parent):
        h = ctypes.c_void_p()
        if self._f.SQLAllocHandle(kind, parent, ctypes.byref(h)) not in (SQL_SUCCESS, SQL_SUCCESS_WITH_INFO):
            raise SqlError("ODBC non disponibile su questo PC")
        return h

    def _diag(self, kind, handle):
        msgs = []
        state, text = ctypes.create_unicode_buffer(6), ctypes.create_unicode_buffer(1024)
        native, length = ctypes.c_int(), ctypes.c_short()
        rec = 1
        while self._f.SQLGetDiagRecW(kind, handle, rec, state, ctypes.byref(native), text, 1024,
                                     ctypes.byref(length)) in (SQL_SUCCESS, SQL_SUCCESS_WITH_INFO):
            msgs.append(f"[{state.value}] {text.value}")
            rec += 1
        return "; ".join(msgs) or "errore ODBC sconosciuto"

    def _check(self, rc, stmt):
        if rc not in (SQL_SUCCESS, SQL_SUCCESS_WITH_INFO):
            raise SqlError(self._diag(SQL_HANDLE_STMT, stmt))

    def _execute(self, sql):
        stmt = self._alloc(SQL_HANDLE_STMT, self._dbc)
        try:
            self._check(self._f.SQLExecDirectW(stmt, sql, SQL_NTS), stmt)
        except SqlError:
            self._f.SQLFreeHandle(SQL_HANDLE_STMT, stmt)
            raise
        return stmt

    def _names(self, stmt):
        count = ctypes.c_short()
        self._check(self._f.SQLNumResultCols(stmt, ctypes.byref(count)), stmt)
        names = []
        buf = ctypes.create_unicode_buffer(256)
        length, dtype, nullable, digits = ctypes.c_short(), ctypes.c_short(), ctypes.c_short(), ctypes.c_short()
        size = ctypes.c_size_t()
        for i in range(1, count.value + 1):
            self._check(self._f.SQLDescribeColW(stmt, i, buf, 256, ctypes.byref(length), ctypes.byref(dtype),
                                                ctypes.byref(size), ctypes.byref(digits), ctypes.byref(nullable)), stmt)
            names.append(buf.value)
        return names

    def _get_data(self, stmt, col, binary, write):
        """
        Legge una colonna a blocchi passando i byte a write(). False se il valore e' NULL. Se il driver si ferma
        prima della lunghezza che aveva annunciato solleva SqlError: mai un file troncato senza avviso.
        """
        buf = ctypes.create_string_buffer(CHUNK)
        ind = ctypes.c_ssize_t()
        room = CHUNK if binary else CHUNK - 2  # il testo termina con uno zero (2 byte in UTF-16)
        total, done = None, 0
        while True:
            rc = self._f.SQLGetData(stmt, col, SQL_C_BINARY if binary else SQL_C_WCHAR, buf, CHUNK, ctypes.byref(ind))
            if rc == SQL_NO_DATA:
                break
            self._check(rc, stmt)
            if ind.value == SQL_NULL_DATA:
                return False
            if total is None and ind.value != SQL_NO_TOTAL:
                total = ind.value
            n = room if ind.value == SQL_NO_TOTAL or ind.value > room else ind.value
            write(buf.raw[:n])
            done += n
            if rc == SQL_SUCCESS:
                break
        if total is not None and done < total:
            raise SqlError(f"il driver ODBC ha restituito {done} byte su {total} della colonna {col}")
        return True

    def _text(self, stmt, col):
        parts = []
        if not self._get_data(stmt, col, False, parts.append):
            return None
        return b"".join(parts).decode("utf-16-le")

    def columns(self, sql):
        stmt = self._execute(sql)
        try:
            return self._names(stmt)
        finally:
            self._f.SQLFreeHandle(SQL_HANDLE_STMT, stmt)

    def rows(self, sql, blob_to=None):
        """
        Righe come dizionari di testo. Con blob_to l'ultima colonna e' un file: blob_to(riga) restituisce il
        percorso dove scriverlo e la riga riceve "_file" (None se NULL). Va letta per ultima: alcuni driver lo esigono.
        """
        stmt = self._execute(sql)
        try:
            names = self._names(stmt)
            text_cols = names[:-1] if blob_to else names
            while True:
                rc = self._f.SQLFetch(stmt)
                if rc == SQL_NO_DATA:
                    break
                self._check(rc, stmt)
                row = {n: self._text(stmt, i) for i, n in enumerate(text_cols, 1)}
                if blob_to:
                    row["_file"] = _write_file(blob_to(row), lambda write: self._get_data(stmt, len(names), True, write))
                yield row
        finally:
            self._f.SQLFreeHandle(SQL_HANDLE_STMT, stmt)


def _write_file(path, read):
    """Scrive un file passando da .tmp: un file a meta' non resta mai con il nome buono."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    try:
        with open(tmp, "wb") as f:
            present = read(f.write)
        if not present:
            tmp.unlink()
            return None
        os.replace(tmp, path)
        return path
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise


# --------------------------------------------------------------------------- impostazioni

def installed_drivers():
    import winreg

    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\ODBC\ODBCINST.INI\ODBC Drivers") as key:
            return [winreg.EnumValue(key, i)[0] for i in range(winreg.QueryInfoKey(key)[1])]
    except OSError:
        return []


def pick_driver(s, available=None):
    if s.get("SQL_DRIVER"):
        return s["SQL_DRIVER"]
    available = installed_drivers() if available is None else available
    for d in PREFERRED_DRIVERS:
        if d in available:
            return d
    raise SqlError("nessun driver ODBC per SQL Server installato (chiedere all'IT 'ODBC Driver 18 for SQL Server')")


def _odbc_value(v):
    return "{" + str(v).replace("}", "}}") + "}"


def connection_string(s, driver):
    parts = {"Driver": driver, "Server": s["SQL_SERVER"], "Database": s["SQL_DATABASE"]}
    auth = s.get("SQL_AUTH") or "sql"
    if auth == "windows":
        parts["Trusted_Connection"] = "yes"
    else:
        parts["UID"], parts["PWD"] = s["SQL_USER"], s["SQL_PASSWORD"]
        if auth == "entra":  # app registrata in Entra ID: UID = client ID, PWD = client secret
            parts["Authentication"] = "ActiveDirectoryServicePrincipal"
    if driver.startswith("ODBC Driver"):  # il vecchio driver "SQL Server" non conosce queste voci
        parts["Encrypt"] = "yes"
        parts["TrustServerCertificate"] = "yes" if env_config.as_bool(s.get("SQL_TRUST_CERT")) else "no"
        parts["ApplicationIntent"] = "ReadOnly"
    return ";".join(f"{k}={_odbc_value(v)}" for k, v in parts.items())


def sql_problems(s):
    """Campi ancora da compilare: finche' ce ne sono, la sorgente SQL non si usa."""
    problems = [f"{k} non impostato" for k in ("SQL_SERVER", "SQL_DATABASE", "SQL_VIEW") if not s.get(k)]
    auth = s.get("SQL_AUTH") or "sql"
    if auth not in AUTH_MODES:
        problems.append(f"SQL_AUTH: {' / '.join(AUTH_MODES)}")
    elif auth != "windows" and not (s.get("SQL_USER") and s.get("SQL_PASSWORD")):
        problems.append("utente e password SQL non impostati")
    mode = s.get("SQL_FILE_MODE") or "contenuto"
    if mode not in FILE_COLS:
        problems.append("SQL_FILE_MODE: contenuto oppure percorso")
    elif mode == "percorso" and not s.get("SQL_PATH_ROOT"):
        problems.append("con SQL_FILE_MODE=percorso serve SQL_PATH_ROOT (cartella che contiene i file)")
    return problems


def open_connection(s):
    driver = pick_driver(s)
    if (s.get("SQL_AUTH") or "sql") == "entra" and not driver.startswith("ODBC Driver"):
        raise SqlError(f"l'accesso Entra ID richiede 'ODBC Driver 18 for SQL Server' (installato: {driver})")
    log.info("Collegamento a %s / %s con il driver %s", s["SQL_SERVER"], s["SQL_DATABASE"], driver)
    return OdbcConnection(connection_string(s, driver))


# --------------------------------------------------------------------------- lettura dei documenti

def quote_view(name):
    if not _VIEW_RE.match(name or ""):
        raise ValueError("SQL_VIEW: nome della vista non valido (es. dbo.vfp_documenti)")
    return ".".join(f"[{p}]" for p in name.split("."))


def _quote_col(name):
    return "[" + name.replace("]", "]]") + "]"


def build_query(view, available, mode, since=""):
    """
    SELECT sulla vista con le colonne presenti, rinominate con i nomi canonici; la colonna del file per ultima.
    available: {nome minuscolo: nome reale} delle colonne della vista. since: 'AAAA-MM-GG hh:mm:ss' o vuoto.
    """
    missing = [c for c in REQUIRED_COLS + (FILE_COLS[mode],) if c not in available]
    if missing:
        raise ValueError(f"nella vista {view} mancano le colonne: {', '.join(missing)}")
    cols = [c for c in REQUIRED_COLS + OPTIONAL_COLS if c in available] + [FILE_COLS[mode]]
    sql = "SELECT " + ", ".join(f"{_quote_col(available[c])} AS [{c}]" for c in cols) + f" FROM {quote_view(view)}"
    if "modificato" in available:
        if since:
            if not _TS_RE.match(since):
                raise ValueError(f"data dell'ultimo giro non valida: {since!r}")
            sql += f" WHERE {_quote_col(available['modificato'])} >= {{ts '{since}'}}"
        sql += f" ORDER BY {_quote_col(available['modificato'])}, {_quote_col(available['id'])}"
    else:
        sql += f" ORDER BY {_quote_col(available['id'])}"
    return sql


def _timestamp(value):
    """'2026-10-21 08:30:00.123' (formato ODBC) -> '2026-10-21 08:30:00'; vuoto se non e' una data."""
    value = (value or "").strip().replace("T", " ")[:19]
    return value if _TS_RE.match(value) else ""


def _inside(path, root):
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def fetch_items(conn, s, default_revision, since=""):
    """Documenti nuovi o modificati da since. Restituisce (SourceItem, data di modifica piu' recente)."""
    mode = s.get("SQL_FILE_MODE") or "contenuto"
    view = quote_view(s["SQL_VIEW"])
    available = {c.lower(): c for c in conn.columns(f"SELECT * FROM {view} WHERE 1=0")}
    sql = build_query(s["SQL_VIEW"], available, mode, since)
    cache = env_config.resolve_path(s.get("SQL_CACHE_DIR") or "specchio_sql")
    root = Path(s["SQL_PATH_ROOT"]) if mode == "percorso" else None

    def revision(row):
        return (row.get("revisione") or "").strip() or default_revision

    def target(row):  # una cartella per documento e revisione: le revisioni non si sovrascrivono
        return cache / _safe_name(row["id"] or "") / _safe_name(revision(row)) / _safe_name(row["nome_file"] or "")

    items, newest = [], since
    for row in conn.rows(sql, blob_to=target if mode == "contenuto" else None):
        doc = row["id"]
        if mode == "contenuto":
            file = row["_file"]
        else:
            file = Path(row["percorso"]) if row.get("percorso") else None
            if file and not _inside(file, root):
                log.warning("Documento %s: %s e' fuori da SQL_PATH_ROOT, saltato", doc, file)
                continue
        if file is None:
            log.warning("Documento %s senza file, saltato", doc)
            continue
        folder = tuple(p for p in (row.get("cartella") or "").replace("\\", "/").split("/") if p.strip())
        name = (row.get("nome") or "").strip() or Path(row["nome_file"] or file.name).stem
        items.append(vt.SourceItem(file, folder, name, revision(row), (row.get("descrizione") or "").strip()))
        newest = max(newest, _timestamp(row.get("modificato")))
    return items, newest


def load_sql_state(path=STATE_PATH):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_sql_state(state, path=STATE_PATH):
    Path(path).write_text(json.dumps(state, indent=1), encoding="utf-8")


# --------------------------------------------------------------------------- main

def cmd_prova(s):
    with open_connection(s) as conn:
        view = quote_view(s["SQL_VIEW"])
        cols = conn.columns(f"SELECT * FROM {view} WHERE 1=0")
        print(f"Collegamento riuscito. Colonne di {s['SQL_VIEW']}: {', '.join(cols)}")
        available = {c.lower(): c for c in cols}
        build_query(s["SQL_VIEW"], available, s.get("SQL_FILE_MODE") or "contenuto")  # segnala colonne mancanti
        count = next(conn.rows(f"SELECT COUNT(*) AS [n] FROM {view}"))["n"]
        print(f"Documenti nella vista: {count}")


def cmd_trasferisci(s, dry_run):
    cfg = env_config.vfp_config(s)
    if not dry_run and env_config.vfp_problems(s):
        sys.exit("Completare il file .env: " + "; ".join(env_config.vfp_problems(s)))
    state = load_sql_state()
    since = state.get("ultima_modifica", "")
    with open_connection(s) as conn:
        items, newest = fetch_items(conn, s, cfg.get("default_revision", "1"), since)
    log.info("%s documenti %s", len(items), f"modificati dal {since}" if since else "nella vista")

    tokens = vt.TokenManager(cfg["auth"], cfg["token_cache"])
    transfer = vt.Transfer(vt.VfpClient(cfg["base_url"], tokens), cfg, TRANSFER_STATE_PATH, REPORT_PATH, dry_run)
    try:
        counts = transfer.run(items)
    except vt.LoginError as e:
        sys.exit(str(e))
    finally:
        transfer.close()
    # la data avanza solo se e' andato tutto bene: altrimenti al prossimo giro si riprova (i caricati vengono saltati)
    if not dry_run and not counts["errore"] and not counts["interrotto"] and newest:
        save_sql_state({**state, "ultima_modifica": newest, "ultimo_giro": datetime.now().isoformat(timespec="seconds")})
    if dry_run:
        log.info("Fine prova: %s documenti pronti, %s gia' trasferiti, %s errori.",
                 counts["prova"], counts["saltato"], counts["errore"])
    else:
        log.info("Fine: %s caricati, %s saltati, %s errori. Report: %s",
                 counts["caricato"], counts["saltato"], counts["errore"], REPORT_PATH)
    return counts


def main():
    parser = argparse.ArgumentParser(description="Trasferisce in VFP i documenti di un archivio SQL (sola lettura).")
    parser.add_argument("--env", default=None, help="file .env (predefinito: .env accanto al programma)")
    sub = parser.add_subparsers(dest="comando", required=True)
    sub.add_parser("prova", help="verifica collegamento e colonne della vista, senza scaricare nulla")
    t = sub.add_parser("trasferisci", help="scarica i documenti nuovi o modificati e li carica in VFP")
    t.add_argument("--dry-run", action="store_true", help="scarica e mostra cosa verrebbe fatto senza chiamare VFP")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    s = env_config.load_settings(args.env or env_config.ENV_PATH)
    problems = sql_problems(s)
    if problems:
        sys.exit("Completare le impostazioni SQL nel file .env: " + "; ".join(problems))
    try:
        if args.comando == "prova":
            cmd_prova(s)
        else:
            cmd_trasferisci(s, args.dry_run)
    except (SqlError, ValueError, OSError) as e:
        sys.exit(f"Errore: {e}")


if __name__ == "__main__":
    main()
