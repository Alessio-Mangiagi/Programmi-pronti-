# "><(((º> sabusabu <º)))><"
import tempfile
import unittest
from pathlib import Path

from tests import ROOT  # noqa: F401
import env_config
import sorgente_sql as sq

COLS = {c: c.upper() for c in ("id", "nome_file", "cartella", "nome", "revisione", "descrizione", "modificato",
                                "contenuto", "percorso")}


class FakeConnection:
    """Al posto del database: righe in memoria, "contenuto" sono i byte del file."""

    def __init__(self, rows, columns=None):
        self.data = rows
        self.cols = columns or list(COLS.values())
        self.queries = []

    def columns(self, sql):
        self.queries.append(sql)
        return self.cols

    def rows(self, sql, blob_to=None):
        self.queries.append(sql)
        for r in self.data:
            row = {k: v for k, v in r.items() if k != "contenuto"}
            if blob_to:
                data = r.get("contenuto")
                row["_file"] = sq._write_file(blob_to(row), lambda write: data is not None and (write(data) or True))
            yield row


class QueryTest(unittest.TestCase):
    def test_colonne_rinominate_e_file_per_ultimo(self):
        sql = sq.build_query("dbo.vfp_documenti", COLS, "contenuto")
        self.assertTrue(sql.startswith("SELECT [ID] AS [id], [NOME_FILE] AS [nome_file]"))
        self.assertIn("[CONTENUTO] AS [contenuto] FROM [dbo].[vfp_documenti]", sql)
        self.assertNotIn("WHERE", sql)
        self.assertTrue(sql.endswith("ORDER BY [MODIFICATO], [ID]"))

    def test_solo_novita(self):
        sql = sq.build_query("v", COLS, "percorso", "2026-10-21 08:00:00")
        self.assertIn("WHERE [MODIFICATO] >= {ts '2026-10-21 08:00:00'}", sql)
        with self.assertRaises(ValueError):
            sq.build_query("v", COLS, "percorso", "2026-10-21'; DROP TABLE x--")

    def test_colonne_obbligatorie(self):
        with self.assertRaises(ValueError):
            sq.build_query("v", {"id": "id", "nome_file": "nome_file"}, "contenuto")

    def test_nome_vista_validato(self):
        for bad in ("dbo.v; DELETE FROM t", "[dbo].[v]", "a.b.c.d", "v--", ""):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                sq.quote_view(bad)
        self.assertEqual(sq.quote_view("db.dbo.v_1"), "[db].[dbo].[v_1]")

    def test_nome_colonna_con_parentesi(self):
        self.assertEqual(sq._quote_col("a]b"), "[a]]b]")


class FetchTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.s = dict(env_config.DEFAULTS, SQL_VIEW="dbo.vfp_documenti", SQL_CACHE_DIR=str(self.dir / "cache"))

    def tearDown(self):
        self.tmp.cleanup()

    def test_contenuto_scaricato_per_documento_e_revisione(self):
        conn = FakeConnection([
            {"id": "7", "nome_file": "PL-001.pdf", "cartella": "Commessa 12/Tavole", "nome": "PL-001 Pianta",
             "revisione": "A", "descrizione": "Prima", "modificato": "2026-10-20 10:00:00.000", "contenuto": b"rev A"},
            {"id": "7", "nome_file": "PL-001.pdf", "cartella": "Commessa 12/Tavole", "nome": "PL-001 Pianta",
             "revisione": "B", "descrizione": "", "modificato": "2026-10-21 09:30:00.000", "contenuto": b"rev B"},
            {"id": "8", "nome_file": "vuoto.pdf", "revisione": None, "modificato": None, "contenuto": None},
        ])
        items, newest = sq.fetch_items(conn, self.s, "1")
        self.assertEqual(len(items), 2)  # quello senza file viene saltato
        a, b = items
        self.assertEqual(a.folder, ("Commessa 12", "Tavole"))
        self.assertEqual((a.name, a.revision, a.description), ("PL-001 Pianta", "A", "Prima"))
        self.assertEqual(a.file.read_bytes(), b"rev A")
        self.assertEqual(b.file.read_bytes(), b"rev B")
        self.assertNotEqual(a.key, b.key)
        self.assertEqual(newest, "2026-10-21 09:30:00")
        self.assertFalse(list((self.dir / "cache").rglob("*.tmp")))

    def test_nomi_pericolosi_restano_nella_cache(self):
        conn = FakeConnection([{"id": "..\\..", "nome_file": "..\\..\\evil.exe", "revisione": "../x", "contenuto": b"x"}])
        items, _ = sq.fetch_items(conn, self.s, "1")
        cache = (self.dir / "cache").resolve()
        self.assertTrue(items[0].file.resolve().is_relative_to(cache))
        self.assertEqual(items[0].name, "evil")  # il nome in VFP e' solo un'etichetta: basta togliere il percorso

    def test_percorso_solo_sotto_la_radice(self):
        root = self.dir / "archivio"
        (root / "sub").mkdir(parents=True)
        (root / "sub" / "ok.pdf").write_bytes(b"x")
        self.s.update(SQL_FILE_MODE="percorso", SQL_PATH_ROOT=str(root))
        conn = FakeConnection([
            {"id": "1", "nome_file": "ok.pdf", "percorso": str(root / "sub" / "ok.pdf")},
            {"id": "2", "nome_file": "cassaforte.dat", "percorso": str(self.dir / "cassaforte.dat")},
            {"id": "3", "nome_file": "fuga.pdf", "percorso": str(root / ".." / "fuga.pdf")},
        ])
        items, newest = sq.fetch_items(conn, self.s, "0")
        self.assertEqual([i.file.name for i in items], ["ok.pdf"])
        self.assertEqual((items[0].name, items[0].revision, items[0].folder), ("ok", "0", ()))
        self.assertEqual(newest, "")

    def test_data_ultimo_giro_nella_query(self):
        conn = FakeConnection([])
        sq.fetch_items(conn, self.s, "1", "2026-10-01 00:00:00")
        self.assertIn("WHERE [MODIFICATO] >= {ts '2026-10-01 00:00:00'}", conn.queries[-1])

    def test_stato(self):
        path = self.dir / "stato_sql.json"
        self.assertEqual(sq.load_sql_state(path), {})
        sq.save_sql_state({"ultima_modifica": "2026-10-21 09:30:00"}, path)
        self.assertEqual(sq.load_sql_state(path)["ultima_modifica"], "2026-10-21 09:30:00")


class ConnessioneTest(unittest.TestCase):
    def setUp(self):
        self.s = dict(env_config.DEFAULTS, SQL_SERVER="srv-sql", SQL_DATABASE="ALYANTE", SQL_USER="lettura",
                      SQL_PASSWORD="p;w}d", SQL_VIEW="dbo.v")

    def test_driver_18_sola_lettura_e_tls(self):
        cs = sq.connection_string(self.s, "ODBC Driver 18 for SQL Server")
        self.assertIn("ApplicationIntent={ReadOnly}", cs)
        self.assertIn("Encrypt={yes}", cs)
        self.assertIn("TrustServerCertificate={no}", cs)
        self.assertIn("PWD={p;w}}d}", cs)  # ; e } nella password non spezzano la stringa

    def test_vecchio_driver_e_windows(self):
        self.s["SQL_AUTH"] = "windows"
        cs = sq.connection_string(self.s, "SQL Server")
        self.assertIn("Trusted_Connection={yes}", cs)
        self.assertNotIn("PWD", cs)
        self.assertNotIn("ApplicationIntent", cs)

    def test_scelta_driver(self):
        self.assertEqual(sq.pick_driver({}, ["SQL Server", "ODBC Driver 18 for SQL Server"]), "ODBC Driver 18 for SQL Server")
        self.assertEqual(sq.pick_driver({"SQL_DRIVER": "X"}, []), "X")
        with self.assertRaises(sq.SqlError):
            sq.pick_driver({}, ["Microsoft Access Driver (*.mdb, *.accdb)"])

    def test_campi_mancanti(self):
        self.assertEqual(sq.sql_problems(self.s), [])
        self.assertTrue(sq.sql_problems(dict(self.s, SQL_PASSWORD="")))
        self.assertEqual(sq.sql_problems(dict(self.s, SQL_AUTH="windows", SQL_USER="", SQL_PASSWORD="")), [])
        self.assertTrue(sq.sql_problems(dict(self.s, SQL_FILE_MODE="percorso")))

    def test_driver_inesistente(self):
        with self.assertRaises(sq.SqlError) as e:
            sq.OdbcConnection("Driver={Driver che non esiste};Server=x;PWD={segreta}")
        self.assertNotIn("segreta", str(e.exception))


class ValidazioneTest(unittest.TestCase):
    def check(self, **values):
        env_config.validate_settings({k: str(v) for k, v in values.items()}, dict(env_config.DEFAULTS))

    def test_valori_ammessi(self):
        self.check(SQL_SERVER="srv-sql\\ALYANTE,1433", SQL_DATABASE="ALYANTE 2026", SQL_VIEW="dbo.vfp_documenti",
                   SQL_DRIVER="ODBC Driver 18 for SQL Server", SQL_AUTH="entra", SQL_FILE_MODE="percorso")

    def test_valori_rifiutati(self):
        for k, v in (("SQL_SERVER", "srv;Trusted_Connection=yes"), ("SQL_DATABASE", "db};PWD={x"),
                     ("SQL_VIEW", "v; DROP TABLE t"), ("SQL_AUTH", "admin"), ("SQL_FILE_MODE", "tutto"),
                     ("SQL_DRIVER", "x};Server={evil")):
            with self.subTest(k=k), self.assertRaises(ValueError):
                self.check(**{k: v})

    def test_password_legata_al_server(self):
        self.assertIn("SQL_SERVER", env_config.SECRET_BINDINGS["SQL_PASSWORD"])
        self.assertIn("SQL_USER", env_config.VAULT_KEYS)


if __name__ == "__main__":
    unittest.main()
