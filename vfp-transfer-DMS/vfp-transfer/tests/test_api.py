# "><(((º> sabusabu <º)))><"
"""Interfaccia: server HTTP vero su una porta libera, con file e sessioni finti in una cartella temporanea."""

import csv
import json
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from tests import ROOT  # noqa: F401
import api_posta
import auth
import env_config
import protocollo
import vfp_gui
import vfp_mail


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        cls.settings = dict(env_config.DEFAULTS, MAIL_ARCHIVE_DIR=str(d / "arch"))
        arch = d / "arch" / "20261005_100000_aaaaaaaaaa"
        arch.mkdir(parents=True)
        (arch / "verbale.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")
        (d / "segreto.txt").write_text("non leggibile")
        log = d / "registro_posta.csv"
        with open(log, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=vfp_mail.MAIL_LOG_FIELDS, delimiter=";")
            w.writeheader()
            for i, n in enumerate(("001", "002", "004")):
                w.writerow({"data": f"2026-10-0{i + 1}T10:00:00", "casella": "PEC x", "tipo_casella": "pec",
                            "mittente": "ente@pec.it", "oggetto": f"POSTA CERTIFICATA: {n} - verbale",
                            "ricevuta": f"2026-10-0{i + 1}T10:00", "allegati": "verbale.pdf", "esito": "trasferita",
                            "chiave": "aaaaaaaaaa" if i == 0 else f"{i}bbbbbbbbb"})
        report = d / "report.csv"
        report.write_text("data;file;cartella;nome;revisione;esito;id_documento;messaggio\n"
                          "2026-10-01T10:00:00;C:\\x\\verbale.pdf;Posta;verbale;1;caricato;DOC-1;documento creato\n", encoding="utf-8")
        cls.patches = [
            mock.patch.object(api_posta, "PATHS", {"mail_log": log, "report": report}),
            mock.patch.object(env_config, "load_settings", lambda *a, **k: dict(cls.settings)),
            mock.patch.object(protocollo, "OVERRIDES_PATH", d / "manuali.json"),
            mock.patch.object(auth, "session", lambda token: {
                "ok": {"user": "prova", "role": "admin", "area": "documenti"},
                "doc": {"user": "ufficio", "role": "utente", "area": "documenti"},
                "posta": {"user": "segreteria", "role": "utente", "area": "posta"},
            }.get(token)),
            mock.patch.object(auth, "get_user", lambda name: {"email": ""}),
            mock.patch.object(vfp_gui.attivita, "record", lambda *a, **k: None),
        ]
        for p in cls.patches:
            p.start()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), vfp_gui.Handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        for p in cls.patches:
            p.stop()
        cls.tmp.cleanup()

    def call(self, path, body=None, cookie="ok", headers=None):
        h = {"Cookie": f"{vfp_gui.SESSION_COOKIE}={cookie}", **(headers or {})}
        if body is not None:
            h.update({"Content-Type": "application/json", "X-VFP-UI": "1"})
        req = Request(f"http://127.0.0.1:{self.port}{path}", data=None if body is None else json.dumps(body).encode(),
                      headers=h, method="POST" if body is not None else "GET")
        try:
            with urlopen(req, timeout=10) as r:
                return r.status, r.read(), dict(r.headers)
        except HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def test_senza_sessione(self):
        code, _, _ = self.call("/api/mail/log", cookie="no")
        self.assertEqual(code, 401)

    def test_aree_degli_utenti(self):
        # l'amministratore vede entrambe le aree
        self.assertEqual(self.call("/api/report")[0], 200)
        self.assertEqual(self.call("/api/mail")[0], 200)
        # l'utente dell'area documenti non riceve i dati della posta, e viceversa
        self.assertEqual(self.call("/api/report", cookie="doc")[0], 200)
        self.assertEqual(self.call("/api/mail", cookie="doc")[0], 403)
        self.assertEqual(self.call("/api/mail", cookie="posta")[0], 200)
        self.assertEqual(self.call("/api/report", cookie="posta")[0], 403)
        # nessuno dei due accede alle funzioni dell'amministratore
        for cookie in ("doc", "posta"):
            self.assertEqual(self.call("/api/mail/log", cookie=cookie)[0], 403)
        _, body, _ = self.call("/api/session", cookie="posta")
        info = json.loads(body)
        self.assertEqual((info["role"], info["area"]), ("utente", "posta"))
        self.assertEqual(set(info["areas"]), {"documenti", "posta"})

    def test_report_per_area(self):
        import report_excel
        p = api_posta.PATHS
        tutto = report_excel.build_report(p["mail_log"], p["report"], self.settings["MAIL_ARCHIVE_DIR"])
        solo_doc = report_excel.build_report(p["mail_log"], p["report"], self.settings["MAIL_ARCHIVE_DIR"], area="documenti")
        solo_posta = report_excel.build_report(p["mail_log"], p["report"], self.settings["MAIL_ARCHIVE_DIR"], area="posta")
        import io
        import zipfile

        def testo(xlsx):
            with zipfile.ZipFile(io.BytesIO(xlsx)) as z:
                return " ".join(z.read(n).decode("utf-8", "replace") for n in z.namelist() if n.endswith(".xml"))
        self.assertIn("ente@pec.it", testo(tutto))
        self.assertIn("DOC-1", testo(tutto))
        self.assertNotIn("ente@pec.it", testo(solo_doc))
        self.assertIn("DOC-1", testo(solo_doc))
        self.assertIn("ente@pec.it", testo(solo_posta))
        self.assertNotIn("DOC-1", testo(solo_posta))

    def test_area_utente_valida(self):
        self.assertEqual(auth.area_di({"area": "posta"}), "posta")
        self.assertEqual(auth.area_di({}), "documenti")  # utenti creati prima delle aree
        self.assertEqual(auth.area_di({"area": "tutte"}), "documenti")
        with self.assertRaises(ValueError):
            auth._check_area("amministrazione")

    def test_host_estraneo(self):
        code, _, _ = self.call("/api/salute", headers={"Host": "attaccante.example"})
        self.assertEqual(code, 403)

    def test_post_senza_intestazione_csrf(self):
        req = Request(f"http://127.0.0.1:{self.port}/api/protocol/set", data=b"{}", method="POST",
                      headers={"Cookie": f"{vfp_gui.SESSION_COOKIE}=ok", "Content-Type": "application/json"})
        with self.assertRaises(HTTPError) as e:
            urlopen(req, timeout=10)
        self.assertEqual(e.exception.code, 403)

    def test_salute(self):
        code, body, _ = self.call("/api/salute", cookie="no")
        self.assertIn(code, (200, 503))
        self.assertIn("stato", json.loads(body))

    def test_controllo_protocolli(self):
        code, body, _ = self.call("/api/protocol/check")
        self.assertEqual(code, 200)
        [y] = json.loads(body)["years"]
        self.assertEqual((y["ultimo"], y["mancanti"]), (4, [3]))

    def test_correzione_protocollo(self):
        code, body, _ = self.call("/api/protocol/set", {"key": "1bbbbbbbbb", "protocol": "003"})
        self.assertEqual((code, json.loads(body)["protocol"]), (200, "003"))
        [y] = json.loads(self.call("/api/protocol/check")[1])["years"]
        self.assertEqual(y["mancanti"], [2])  # 002 diventato 003: ora manca 002
        self.call("/api/protocol/set", {"key": "1bbbbbbbbb", "protocol": ""})

    def test_prova_regola(self):
        code, body, _ = self.call("/api/protocol/test", {"rule": r"RIF(\d+)", "subject": "Invio RIF55"})
        self.assertEqual(code, 200)
        self.assertTrue(json.loads(body)["subject"]["protocollo"].startswith("55/"))
        code, _, _ = self.call("/api/protocol/test", {"rule": "(", "subject": "x"})
        self.assertEqual(code, 400)

    def test_ricerca(self):
        d = json.loads(self.call("/api/search?q=004")[1])
        self.assertEqual(d["emails_total"], 1)
        d = json.loads(self.call("/api/search?q=DOC-1")[1])
        self.assertEqual(d["documents_total"], 1)

    def test_anteprima_allegato(self):
        code, body, headers = self.call("/api/mail/file?key=aaaaaaaaaa&name=verbale.pdf")
        self.assertEqual((code, headers["Content-Type"]), (200, "application/pdf"))
        self.assertTrue(body.startswith(b"%PDF"))
        code, _, headers = self.call("/api/mail/file?key=aaaaaaaaaa&name=verbale.pdf&download=1")
        self.assertIn("attachment", headers["Content-Disposition"])

    def test_anteprima_niente_percorsi(self):
        for q in ("key=aaaaaaaaaa&name=..%5C..%5Csegreto.txt", "key=..%5C..&name=segreto.txt", "key=aaaaaaaaaa&name="):
            with self.subTest(q=q):
                self.assertEqual(self.call(f"/api/mail/file?{q}")[0], 404)

    def test_registro_protocolli_excel(self):
        code, body, headers = self.call("/api/protocolli.xlsx?anno=2026")
        self.assertEqual(code, 200)
        self.assertTrue(body.startswith(b"PK"))
        self.assertEqual(self.call("/api/protocolli.xlsx?anno=abc")[0], 400)


if __name__ == "__main__":
    unittest.main()
