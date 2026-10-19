# "><(((º> sabusabu <º)))><"
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from tests import ROOT  # noqa: F401  (percorso del programma)
import protocollo


class EstrazioneTest(unittest.TestCase):
    CASI = [
        ("POSTA CERTIFICATA: 001 - Trasmissione SAL", "001"),
        ("POSTA CERTIFICATA: 042/2026 Verbale", "042/2026"),
        ("POSTA CERTIFICATA: 1234 consegna lavori", "1234"),
        ("R: POSTA CERTIFICATA: 003 - risposta", "003"),
        ("POSTA CERTIFICATA: Lavori via Roma prot. 007", "007"),
        ("POSTA CERTIFICATA: Invio documenti n. 015", "015"),
        ("POSTA CERTIFICATA: Prot. n. 0012345/2026 del 10/10/2026", "0012345/2026"),
        ("Protocollo N.123 - richiesta", "123"),
        ("Trasmissione nota prot.n.4567/2026", "4567/2026"),
        ("n. prot. 456 del 3/3", "456"),
        ("Comune di X - Prot. N° 2026/0001234", "2026/0001234"),
        ("PG/2026/0123456 invio atti", "PG/2026/0123456"),
        ("m_inf.AOO.REGISTRO UFFICIALE(U).0012345.10-10-2026", "U.0012345"),
        ("Protocollo: AOO_X-2026-0001234", "AOO_X-2026-0001234"),
        ("AVVENUTA CONSEGNA: 001 - verbale", "001"),
    ]
    NESSUNO = ["POSTA CERTIFICATA: SAL n. 3 lavori", "POSTA CERTIFICATA: 10/10/2026 riunione",
               "POSTA CERTIFICATA: Fattura 2026 lotto 12", "POSTA CERTIFICATA: Lotto 3 importo 1.250,00",
               "protezione civile 2026", ""]

    def test_casi_riconosciuti(self):
        for oggetto, atteso in self.CASI:
            with self.subTest(oggetto=oggetto):
                self.assertEqual(protocollo.extract(oggetto), atteso)

    def test_nessun_protocollo(self):
        for oggetto in self.NESSUNO:
            with self.subTest(oggetto=oggetto):
                self.assertEqual(protocollo.extract(oggetto), "")

    def test_anno_aggiunto_solo_se_manca(self):
        self.assertEqual(protocollo.with_year("001", "2026-10-13T10:00"), "001/2026")
        self.assertEqual(protocollo.with_year("042/2025", "2026-01-02"), "042/2025")
        self.assertEqual(protocollo.with_year("", "2026"), "")

    def test_solo_pec(self):
        self.assertEqual(protocollo.for_mail("pec", "001 - x", "2026-01-01"), "001/2026")
        self.assertEqual(protocollo.for_mail("imap", "001 - x", "2026-01-01"), "")

    def test_regola_personalizzata(self):
        regola = r"RIF\.(?P<n>\d+)"
        self.assertEqual(protocollo.extract("Invio RIF.77 documenti", regola), "77")
        self.assertEqual(protocollo.extract("Invio RIF.77 documenti", r"RIF\.(\d+)"), "77")
        # le regole predefinite restano valide come riserva
        self.assertEqual(protocollo.extract("POSTA CERTIFICATA: 001 - x", regola), "001")

    def test_regola_non_valida(self):
        with self.assertRaises(ValueError):
            protocollo.compile_rule("(")
        with self.assertRaises(ValueError):
            protocollo.compile_rule("a" * 400)
        self.assertEqual(protocollo.extract("POSTA CERTIFICATA: 001", "("), "001")  # regola rovinata: predefinite


class CorrezioniTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.p = mock.patch.object(protocollo, "OVERRIDES_PATH", Path(self.tmp.name) / "manuali.json")
        self.p.start()

    def tearDown(self):
        self.p.stop()
        self.tmp.cleanup()

    def test_correzione_e_ritorno_all_automatico(self):
        key = "abcdef1234"
        self.assertEqual(protocollo.resolve("pec", "001 - x", "2026-01-01", key), ("001/2026", "automatico"))
        protocollo.set_override(key, "009", "admin")
        self.assertEqual(protocollo.resolve("pec", "001 - x", "2026-01-01", key), ("009/2026", "manuale"))
        protocollo.set_override(key, "", "admin")
        self.assertEqual(protocollo.resolve("pec", "001 - x", "2026-01-01", key), ("001/2026", "automatico"))

    def test_valori_rifiutati(self):
        for key, n in (("../x", "1"), ("abcdef1234", "<script>"), ("abcdef1234", "x" * 61)):
            with self.subTest(key=key, n=n), self.assertRaises(ValueError):
                protocollo.set_override(key, n, "admin")


class NumerazioneTest(unittest.TestCase):
    def riga(self, n, chiave, esito="trasferita", anno="2026"):
        return {"tipo_casella": "pec", "protocollo": f"{n}/{anno}", "chiave": chiave, "esito": esito,
                "ricevuta": f"{anno}-03-01T10:00", "mittente": "a@b.it", "oggetto": f"{n} - x"}

    def test_split(self):
        self.assertEqual(protocollo.split_number("001/2026"), (1, 2026))
        self.assertEqual(protocollo.split_number("0012345/2026"), (12345, 2026))
        self.assertEqual(protocollo.split_number("2026/0001234"), (1234, 2026))
        self.assertEqual(protocollo.split_number("AOO_X-2026-0001234"), (1234, 2026))
        self.assertEqual(protocollo.split_number("U.0012345"), (12345, None))

    def test_mancanti_e_doppi(self):
        rows = [self.riga("001", "a"), self.riga("002", "b"), self.riga("005", "c"), self.riga("005", "d"),
                self.riga("002", "e", esito="ricevuta")]  # le ricevute non sono doppi
        [y] = protocollo.check(rows)
        self.assertEqual((y["anno"], y["ultimo"], y["mancanti"], y["mancanti_totale"]), (2026, 5, [3, 4], 2))
        self.assertEqual([d["numero"] for d in y["doppi"]], [5])
        self.assertTrue(y["sequenza"])

    def test_anni_separati(self):
        rows = [self.riga("001", "a", anno="2025"), self.riga("001", "b", anno="2026")]
        years = protocollo.check(rows)
        self.assertEqual([y["anno"] for y in years], [2026, 2025])
        self.assertTrue(all(not y["doppi"] and not y["mancanti"] for y in years))

    def test_numeri_di_altri_enti_non_sono_una_sequenza(self):
        rows = [self.riga("0012345", "a"), self.riga("0099999", "b")]
        [y] = protocollo.check(rows)
        self.assertFalse(y["sequenza"])
        self.assertEqual(y["mancanti"], [])

    def test_registro_ordinato(self):
        rows = [self.riga("010", "a"), self.riga("002", "b"), {"tipo_casella": "imap", "protocollo": ""}]
        self.assertEqual([r["progressivo"] for r in protocollo.register_rows(rows)], [2, 10])
        self.assertEqual(protocollo.register_rows(rows, 2025), [])


if __name__ == "__main__":
    unittest.main()
