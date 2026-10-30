# "><(((º> sabusabu <º)))><"
import re
import unittest

from tests import ROOT  # noqa: F401
import env_config
import ponte
import sorgente_sql as sq

PIVA = "01234567897"


class FintoGestionale:
    """Al posto del database di CPM o Alyante: viste in memoria {nome: [righe]}, colonne con le maiuscole del DB."""

    def __init__(self, viste, irraggiungibile=False):
        self.viste = viste
        self.irraggiungibile = irraggiungibile
        self.query = []

    def __call__(self, s, sistema):
        if self.irraggiungibile:
            raise sq.SqlError("collegamento al database non riuscito: [08001] server non trovato")
        return self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        pass

    def _vista(self, sql):
        nome = re.search(r"FROM \[([^\]]+)\]\.\[([^\]]+)\]", sql).groups()
        return self.viste[".".join(nome)]

    def columns(self, sql):
        self.query.append(sql)
        return list(self._vista(sql)[0])

    def rows(self, sql, blob_to=None):
        self.query.append(sql)
        righe = self._vista(sql)
        m = re.search(r"WHERE \[(\w+)\] = N'((?:[^']|'')*)'", sql)
        if m:
            righe = [r for r in righe if str(r[m.group(1)]) == m.group(2).replace("''", "'")]
        m = re.search(r"SELECT TOP \d+ \[(\w+)\] AS \[commessa\](?:, \[(\w+)\] AS \[descrizione\])?", sql)
        if m:
            righe = [{"commessa": r[m.group(1)], **({"descrizione": r[m.group(2)]} if m.group(2) else {})} for r in righe]
        yield from righe


def impostazioni(**extra):
    s = dict(env_config.DEFAULTS)
    s.update(ALYANTE_SERVER="srv-sql", ALYANTE_DATABASE="ALYANTE", ALYANTE_USER="lettura", ALYANTE_PASSWORD="x",
             ALYANTE_VISTA_FORNITORI="dbo.vfp_fornitori",
             CPM_SERVER="srv-cpm", CPM_DATABASE="CPM", CPM_AUTH="windows",
             CPM_VISTA_FORNITORI="dbo.cpm_fornitori", CPM_VISTA_COMMESSE="dbo.cpm_commesse")
    s.update(extra)
    return s


FORNITORI_ALYANTE = [{"PIVA": PIVA, "Ragione_Sociale": "Noli Etna S.r.l.", "SEDE": "Catania (CT)",
                      "IBAN_DEDICATO": "IT60X0542811101000000123456", "Banca": "", "Codice Interno": "F001"}]
FORNITORI_CPM = [{"PIVA": PIVA, "RAGIONE_SOCIALE": "NOLI ETNA SRL", "BANCA": "Banca Agricola", "PEC": "noli@pec.it"}]
COMMESSE = [{"COMMESSA": "150-110", "DESCRIZIONE": "RFI Sottopasso Trapani", "CUP": "J51B21000000001",
             "DATA_APPALTO": "2025-03-12 00:00:00.000", "COMMITTENTE": "RFI S.p.A."},
            {"COMMESSA": "101-003", "DESCRIZIONE": "Ponte Agro", "CUP": "", "DATA_APPALTO": "", "COMMITTENTE": ""}]


def finto(**kw):
    return FintoGestionale({"dbo.vfp_fornitori": FORNITORI_ALYANTE, "dbo.cpm_fornitori": FORNITORI_CPM,
                            "dbo.cpm_commesse": COMMESSE}, **kw)


class PonteTest(unittest.TestCase):
    def test_stato_senza_collegarsi(self):
        self.assertEqual(ponte.collegati(dict(env_config.DEFAULTS)), {"fornitori": [], "commesse": []})
        s = impostazioni()
        self.assertEqual(ponte.collegati(s), {"fornitori": ["Alyante", "CPM"], "commesse": ["CPM"]})
        st = ponte.stato(impostazioni(ALYANTE_PASSWORD=""))
        self.assertIn("utente e password del database non impostati", st["alyante"]["problemi"])
        self.assertEqual(ponte.collegati(impostazioni(ALYANTE_PASSWORD=""))["fornitori"], ["CPM"])
        self.assertIn("nessuna vista", " ".join(ponte.problemi(impostazioni(CPM_VISTA_FORNITORI="", CPM_VISTA_COMMESSE=""), "cpm")))

    def test_ditta_prima_alyante_poi_cpm(self):
        r = ponte.ditta(impostazioni(), f"IT {PIVA}", connetti=finto())
        self.assertTrue(r["trovato"])
        self.assertEqual(r["valori"]["ragione_sociale"], "Noli Etna S.r.l.")  # Alyante vince
        self.assertEqual(r["fonti"]["ragione_sociale"], "Alyante")
        self.assertEqual(r["valori"]["banca"], "Banca Agricola")              # vuota in Alyante: completa CPM
        self.assertEqual(r["fonti"]["banca"], "CPM")
        self.assertEqual(r["valori"]["pec"], "noli@pec.it")
        self.assertNotIn("codice interno", r["valori"])                        # nome che non puo' essere un campo
        self.assertEqual(r["errori"], [])

    def test_ditta_non_trovata(self):
        r = ponte.ditta(impostazioni(), "09876543210", connetti=finto())
        self.assertEqual((r["trovato"], r["valori"]), (False, {}))

    def test_valori_cercati_con_formato_chiuso(self):
        g = finto()
        for bad in ("0123456789'", "1' OR '1'='1", "123", ""):
            with self.subTest(bad=bad), self.assertRaises(ponte.PonteError):
                ponte.ditta(impostazioni(), bad, connetti=g)
        for bad in ("150-110'; DROP TABLE x--", "", "a" * 41, "-x"):
            with self.subTest(bad=bad), self.assertRaises(ponte.PonteError):
                ponte.commessa(impostazioni(), bad, connetti=g)
        self.assertEqual(g.query, [])  # nessuna query partita
        ponte.commessa(impostazioni(), "150-110", connetti=g)
        self.assertTrue(all(q.startswith("SELECT ") for q in g.query))
        self.assertIn("WHERE [COMMESSA] = N'150-110'", g.query[-1])

    def test_commessa_con_date(self):
        r = ponte.commessa(impostazioni(), "150-110", connetti=finto())
        self.assertEqual(r["valori"]["data_appalto"], "2025-03-12")
        self.assertEqual(r["valori"]["cup"], "J51B21000000001")
        self.assertEqual(r["fonti"]["committente"], "CPM")

    def test_elenco_commesse(self):
        r = ponte.commesse(impostazioni(), connetti=finto())
        self.assertEqual([c["codice"] for c in r["commesse"]], ["150-110", "101-003"])
        self.assertEqual(r["commesse"][0]["descrizione"], "RFI Sottopasso Trapani")

    def test_gestionale_irraggiungibile_non_blocca(self):
        r = ponte.ditta(impostazioni(), PIVA, connetti=finto(irraggiungibile=True))
        self.assertFalse(r["trovato"])
        self.assertEqual(len(r["errori"]), 2)
        self.assertTrue(r["errori"][0].startswith("Alyante: collegamento"))

    def test_colonna_chiave_mancante(self):
        g = FintoGestionale({"dbo.vfp_fornitori": [{"PARTITA_IVA": PIVA}], "dbo.cpm_fornitori": FORNITORI_CPM})
        r = ponte.ditta(impostazioni(), PIVA, connetti=g)
        self.assertIn("manca la colonna 'piva'", r["errori"][0])
        self.assertEqual(r["valori"]["ragione_sociale"], "NOLI ETNA SRL")  # CPM risponde lo stesso

    def test_solo_campi_della_maschera(self):
        r = ponte.solo_campi(ponte.ditta(impostazioni(), PIVA, connetti=finto()), ["ragione_sociale", "iban_dedicato"])
        self.assertEqual(set(r["valori"]), {"ragione_sociale", "iban_dedicato"})
        self.assertEqual(set(r["fonti"]), {"ragione_sociale", "iban_dedicato"})

    def test_stessa_connessione_in_sola_lettura(self):
        sql = ponte.impostazioni_sql(impostazioni(), "alyante")
        cs = sq.connection_string(sql, "ODBC Driver 18 for SQL Server")
        self.assertIn("Server={srv-sql}", cs)
        self.assertIn("Database={ALYANTE}", cs)
        self.assertIn("ApplicationIntent={ReadOnly}", cs)

    def test_impostazioni_validate(self):
        for k, v in (("CPM_SERVER", "srv; Driver=x"), ("ALYANTE_VISTA_FORNITORI", "dbo.v; DELETE FROM t"),
                     ("CPM_VISTA_COMMESSE", "[dbo].[v]"), ("ALYANTE_AUTH", "anonimo")):
            with self.subTest(k=k), self.assertRaises(ValueError):
                env_config.validate_sql({k: v})
        env_config.validate_sql({"CPM_SERVER": "srv-sql\\CPM,1433", "ALYANTE_VISTA_COMMESSE": "dbo.vfp_commesse"})
        self.assertIn("CPM_PASSWORD", env_config.SECRET_KEYS)
        self.assertIn("ALYANTE_USER", env_config.VAULT_KEYS)
        self.assertIn("ALYANTE_SERVER", env_config.OTP_KEYS)
        self.assertIn("CPM_SERVER", env_config.SECRET_BINDINGS["CPM_PASSWORD"])


if __name__ == "__main__":
    unittest.main()
