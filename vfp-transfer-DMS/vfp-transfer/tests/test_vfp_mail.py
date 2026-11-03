# "><(((º> sabusabu <º)))><"
import csv
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

from tests import ROOT  # noqa: F401
import env_config
import protocollo
import vfp_mail
import vfp_transfer as vt


class MittentiTest(unittest.TestCase):
    def test_elenco_vuoto_ammette_tutti(self):
        self.assertTrue(vfp_mail.sender_allowed("chiunque@x.it", {"MAIL_ALLOWED_SENDERS": ""}))

    def test_indirizzi_e_domini(self):
        s = {"MAIL_ALLOWED_SENDERS": "progettista@studio.it, @fornitore.it; comune.it"}
        for sender, ok in (("progettista@studio.it", True), ("altro@studio.it", False), ("a@fornitore.it", True),
                           ("a@uff.fornitore.it", True), ("a@fornitore.it.falso.com", False), ("a@comune.it", True),
                           ("a@notcomune.it", False), ("", False)):
            with self.subTest(sender=sender):
                self.assertEqual(vfp_mail.sender_allowed(sender, s), ok)


class ControlliTest(unittest.TestCase):
    def msg(self, **kw):
        return vfp_mail.MailMessage(ref="1", raw_id="1", sender=kw.get("sender", "a@b.it"), subject="x",
                                    received=datetime(2026, 10, 13), attachments=[], rejected=kw.get("rejected", []))

    def test_spf_dkim_dmarc(self):
        self.assertEqual(vfp_mail.auth_failed("spf=pass dkim=pass dmarc=pass"), "")
        self.assertEqual(vfp_mail.auth_failed("spf=fail; dmarc=fail"), "dmarc=fail")
        self.assertEqual(vfp_mail.auth_failed(""), "")

    def test_quarantena(self):
        s = dict(env_config.DEFAULTS, MAIL_MAX_MB="1", MAIL_ALLOWED_SENDERS="@b.it", MAIL_REQUIRE_AUTH="true")
        self.assertIn("oltre il limite", vfp_mail.screen(self.msg(), "", 2 * 1024 * 1024, s, False))
        self.assertIn("pericoloso", vfp_mail.screen(self.msg(rejected=[("x.exe", "pericoloso")]), "", 10, s, False))
        self.assertIn("non autorizzato", vfp_mail.screen(self.msg(sender="a@c.it"), "", 10, s, False))
        self.assertIn("falsificazione", vfp_mail.screen(self.msg(), "dmarc=fail", 10, s, False))
        self.assertEqual(vfp_mail.screen(self.msg(), "dmarc=fail", 10, s, True), "")  # la PEC ha la sua firma
        self.assertEqual(vfp_mail.screen(self.msg(), "dmarc=pass", 10, s, False), "")

    def test_nomi_file(self):
        self.assertEqual(vfp_mail._safe_name('..\\..\\a:b?.pdf'), "_.._a_b_.pdf")
        self.assertEqual(vfp_mail._safe_name("CON.txt"), "_CON.txt")
        self.assertEqual(vfp_mail._classify("x.docm", {"pdf"}), "pericoloso")
        # gli archivi sono bloccati come gli eseguibili (contenuto non ispezionabile se cifrati)
        self.assertEqual(vfp_mail._classify("x.zip", {"pdf"}), "pericoloso")
        self.assertEqual(vfp_mail._classify("x.dwg", {"pdf"}), "estensione non ammessa")


class RegistroTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.p = mock.patch.object(protocollo, "OVERRIDES_PATH", self.dir / "manuali.json")
        self.p.start()

    def tearDown(self):
        self.p.stop()
        self.tmp.cleanup()

    def watcher(self):
        return vfp_mail.MailWatcher(lambda cfg: None, None, self.dir / "stato.json", self.dir / "report.csv",
                                    self.dir / "stato_posta.json", self.dir / "registro_posta.csv")

    def test_registro_vecchio_aggiornato(self):
        old = ["data", "casella", "tipo_casella", "indirizzo_casella", "mittente", "oggetto", "ricevuta",
               "allegati", "esito", "dettaglio", "chiave"]
        path = self.dir / "registro_posta.csv"
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(old)
            w.writerow(["2026-10-01T10:00:00", "PEC x", "pec", "x@pec.it", "a@b.it", "POSTA CERTIFICATA: 001 - x",
                        "2026-10-01T10:00", "a.pdf", "trasferita", "ok", "aaaaaaaaaa"])
        mw = self.watcher()
        msg = vfp_mail.MailMessage(ref="2", raw_id="2", sender="c@d.it", subject="POSTA CERTIFICATA: 002 - y",
                                   received=datetime(2026, 10, 2, 9), attachments=[], msg_id="<m2@x>",
                                   pec={"tipo": "posta-certificata", "identificativo": "id2", "firma": "valida"})
        mbx = mock.Mock(label="PEC x", kind="pec", address="x@pec.it", key="pec:x")
        mw._log_message(mbx, msg, "trasferita", "ok", "bbbbbbbbbb", [{"name": "b.pdf", "doc_id": "D1"}])
        with open(path, newline="", encoding="utf-8") as f:
            self.assertEqual(next(csv.reader(f, delimiter=";")), vfp_mail.MAIL_LOG_FIELDS)
        rows = vfp_mail.read_mail_log(path, dict(env_config.DEFAULTS))
        self.assertEqual([r["protocollo"] for r in rows], ["001/2026", "002/2026"])
        self.assertEqual(rows[1]["documenti"], "b.pdf=D1")
        self.assertEqual(rows[1]["pec_id"], "id2")
        self.assertEqual(rows[0]["pec_id"], "")  # le righe vecchie restano leggibili

    def test_valori_pericolosi_per_excel(self):
        mw = self.watcher()
        msg = vfp_mail.MailMessage(ref="3", raw_id="3", sender="a@b.it", subject="=HYPERLINK(\"x\")",
                                   received=datetime(2026, 10, 3), attachments=[])
        mw._log_message(mock.Mock(label="IMAP", kind="imap", address="a", key="imap:a"), msg, "ignorata", "", "cccccccccc")
        raw = (self.dir / "registro_posta.csv").read_text(encoding="utf-8")
        self.assertIn("'=HYPERLINK", raw)
        self.assertEqual(vfp_mail.read_mail_log(self.dir / "registro_posta.csv", {})[0]["oggetto"], '=HYPERLINK("x")')

    def test_riprova_solo_errori(self):
        mw = self.watcher()
        st = mw.load_state()
        st["history"] = [{"key": "k1", "outcome": "trasferita"}, {"key": "k2", "outcome": "errore"},
                         {"key": "k3", "outcome": "errore", "msg_id": "<a@b>", "mbx": "pec:x"}, {"key": "k4", "outcome": "riprovo"}]
        mw._save_state(st)
        with self.assertRaises(ValueError):
            mw.request_retry("k1", "admin")
        with self.assertRaises(ValueError):  # versione precedente: manca il Message-ID
            mw.request_retry("k2", "admin")
        self.assertIn("rimessa in coda", mw.request_retry("k3", "admin"))
        self.assertEqual(mw.retries, {"k3": "admin"})
        self.assertIn("ritentata", mw.request_retry("k4", "admin"))

    def test_cartella_allegati(self):
        s = dict(env_config.DEFAULTS, MAIL_ARCHIVE_DIR=str(self.dir / "arch"))
        (self.dir / "arch" / "20261001_100000_aaaaaaaaaa").mkdir(parents=True)
        self.assertIsNotNone(vfp_mail.archived_files(s, "aaaaaaaaaa"))
        self.assertIsNone(vfp_mail.archived_files(s, "bbbbbbbbbb"))
        self.assertIsNone(vfp_mail.archived_files(s, "../../x"))


class CsvTest(unittest.TestCase):
    def test_andata_e_ritorno(self):
        for v in ("=1+1", "+3", "-x", "@a", "normale", "", "'già"):
            with self.subTest(v=v):
                self.assertEqual(vt.csv_plain(vt.csv_cell(v)), v)


if __name__ == "__main__":
    unittest.main()


class SkyTowerPostaTest(unittest.TestCase):
    """MAIL_SKYTOWER: gli allegati vanno su SkyTower se l'oggetto cita una commessa del registro della suite."""

    def setUp(self):
        import suite_cosedil
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.chiamate = []

        def chiama(app, metodo, percorso, parametri=None, corpo_file=None, **kw):
            self.chiamate.append((percorso, parametri, corpo_file))
            if corpo_file[2] == "rotto.pdf":
                raise suite_cosedil.suite_link.SuiteError("skytower", 422, "File vuoto")
            return {"identifier": "PRJ-COS-ZZ-ZZ-RP-Z-0007", "url": "http://localhost:5195/documenti/x"}
        self.patch = [mock.patch.object(suite_cosedil.suite_link, "chiama", chiama),
                      mock.patch.object(suite_cosedil.suite_link, "FILE_COMMESSE", self.dir / "commesse.json")]
        for p in self.patch:
            p.start()
        suite_cosedil.suite_link.salva_commesse([{"code": "101-003", "nome": "Porto di Augusta"}])

    def tearDown(self):
        for p in self.patch:
            p.stop()
        self.tmp.cleanup()

    def messaggio(self, oggetto, allegati):
        return vfp_mail.MailMessage("1:2", "2", "fornitore@esempio.it", oggetto, datetime(2026, 11, 3, 9, 30),
                                    [vfp_mail.Attachment(n, d) for n, d in allegati], msg_id="<abc@esempio.it>")

    def test_allegati_su_skytower(self):
        (self.dir / "polizza.pdf").write_bytes(b"%PDF-1.4 polizza")
        m = self.messaggio("Re: 101-003 SEDE ACIREALE - polizza mezzo", [("polizza.pdf", b"x"), ("daticert.xml", b"<x/>"), ("rotto.pdf", b"")])
        esito = vfp_mail.invia_a_skytower({}, m, self.dir, utente="mrossi")
        self.assertEqual(esito["commessa"], "101-003")
        self.assertEqual([(v["nome"], v["esito"]) for v in esito["esiti"]], [("polizza.pdf", "creato"), ("rotto.pdf", "errore")])
        percorso, parametri, corpo = self.chiamate[0]
        self.assertEqual(percorso, "/suite/commesse/101-003/documenti")
        self.assertEqual(corpo, (b"%PDF-1.4 polizza", "application/pdf", "polizza.pdf"))   # la copia su disco, non l'allegato grezzo
        self.assertEqual(parametri["title"], "polizza")
        import json
        attr = json.loads(parametri["attributes"])
        self.assertEqual((attr["origine"], attr["mittente"], attr["message_id"]), ("posta", "fornitore@esempio.it", "<abc@esempio.it>"))
        self.assertIn("SkyTower 101-003: 1 documenti, 1 errori (rotto.pdf: File vuoto)", vfp_mail.riassunto_skytower(esito))

    def test_senza_commessa_niente(self):
        m = self.messaggio("Fattura di ottobre", [("fattura.pdf", b"x")])
        self.assertIsNone(vfp_mail.invia_a_skytower({}, m, self.dir))
        self.assertEqual(self.chiamate, [])
        self.assertEqual(vfp_mail.riassunto_skytower(None), "")
