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
import modelli_protetti
import protocollo
import vfp_gui
import vfp_mail


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        cls.settings = dict(env_config.DEFAULTS, MAIL_ARCHIVE_DIR=str(d / "arch"), MODULI_ARCHIVIO=str(d / "moduli_compilati"))
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
            mock.patch.object(modelli_protetti, "STATO_CONTROLLO", d / "stato_modelli.json"),
            mock.patch.object(auth, "session", lambda token: {
                "ok": {"user": "prova", "role": "admin", "area": "documenti"},
                "doc": {"user": "ufficio", "role": "utente", "area": "documenti"},
                "posta": {"user": "segreteria", "role": "utente", "area": "posta"},
                "mz": {"user": "officina", "role": "utente", "area": "mezzi"},
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

    def test_mezzi_solo_admin(self):
        code, body, _ = self.call("/api/mezzi")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["maschera"]["id"], "mezzi_nolo")
        self.assertEqual(self.call("/api/mezzi", cookie="doc")[0], 403)
        self.assertEqual(self.call("/api/mezzi/salva", {"valori": {}}, cookie="doc")[0], 403)
        self.assertEqual(self.call("/api/mezzi/pratica?id=../../x")[0], 400)
        code, body, _ = self.call("/api/mezzi/contratto.docx?id=20260101-000000-abcdef")
        self.assertEqual(code, 404)

    def test_mezzi_dai_gestionali(self):
        from tests.test_ponte import finto, impostazioni
        import ponte

        self.assertEqual(json.loads(self.call("/api/mezzi")[1])["gestionali"], {"fornitori": [], "commesse": []})
        self.assertIsNone(json.loads(self.call("/api/mezzi/fornitore?piva=01234567897")[1])["gestionale"])
        with mock.patch.dict(self.settings, impostazioni()), mock.patch.object(ponte, "apri", finto()):
            d = json.loads(self.call("/api/mezzi/fornitore?piva=01234567897", cookie="mz")[1])
            g = d["gestionale"]
            self.assertEqual(g["valori"]["iban_dedicato"], "IT60X0542811101000000123456")
            self.assertEqual(g["fonti"]["banca"], "CPM")
            d = json.loads(self.call("/api/mezzi/commessa?codice=150-110", cookie="mz")[1])
            self.assertEqual(d["valori"]["cup"], "J51B21000000001")
            self.assertNotIn("descrizione", d["valori"])  # non e' un campo della maschera
            d = json.loads(self.call("/api/mezzi/commesse", cookie="mz")[1])
            self.assertEqual(len(d["commesse"]), 2)
            code, body, _ = self.call("/api/mezzi/commessa?codice=x'%20OR%201=1--", cookie="mz")
            self.assertEqual(json.loads(body)["errori"], ["codice della commessa non valido"])
            self.assertEqual(self.call("/api/mezzi/commesse", cookie="posta")[0], 403)

    def test_utente_dei_mezzi(self):
        # vede solo i mezzi: niente trasferimenti, posta o funzioni dell'amministratore
        self.assertEqual(self.call("/api/mezzi", cookie="mz")[0], 200)
        for path in ("/api/report", "/api/mail", "/api/browse?path=", "/api/config"):
            self.assertEqual(self.call(path, cookie="mz")[0], 403, path)
        self.assertEqual(self.call("/api/mezzi", cookie="posta")[0], 403)
        self.assertEqual(self.call("/api/mezzi/carica", {"id": "x"}, cookie="mz")[0], 403)  # Viewpoint: solo admin
        valori = {"tipo_mezzo": "Terna", "marca": "JCB", "modello": "3CX", "matricola": "JCB1"}
        # nessun file preso dal disco del PC del programma
        code, body, _ = self.call("/api/mezzi/salva", {"valori": valori, "documenti": [
            {"tipo": "ce", "percorso": r"C:\Windows\win.ini"}]}, cookie="mz")
        self.assertEqual(code, 400)
        self.assertIn("proprio computer", json.loads(body)["error"])
        code, body, _ = self.call("/api/mezzi/salva", {"valori": valori, "documenti": []}, cookie="mz")
        self.assertEqual(code, 200)
        rec_id = json.loads(body)["pratica"]["id"]
        # il documento arriva dal browser: corpo = il file
        def allega(nome, dati, cookie="mz"):
            req = Request(f"http://127.0.0.1:{self.port}/api/mezzi/allega?id={rec_id}&tipo=ce&nome={nome}", data=dati,
                          method="POST", headers={"Cookie": f"{vfp_gui.SESSION_COOKIE}={cookie}", "X-VFP-UI": "1",
                                                  "Content-Type": "application/octet-stream"})
            try:
                with urlopen(req, timeout=10) as r:
                    return r.status, json.loads(r.read())
            except HTTPError as e:
                return e.code, json.loads(e.read())
        code, d = allega("ce.pdf", b"%PDF-1.4 ce\n%%EOF\n")
        self.assertEqual(code, 200)
        self.assertEqual([(x["tipo"], x["nome_file"]) for x in d["pratica"]["documenti"]], [("ce", "ce.pdf")])
        self.assertEqual(allega("virus.exe", b"MZ")[0], 400)
        self.assertEqual(allega("ce.pdf", b"%PDF", cookie="posta")[0], 403)
        # il cambio dei dati gia' registrati di una ditta lo conferma solo l'amministratore
        code, body, _ = self.call("/api/mezzi/salva", {"id": rec_id, "valori": valori, "documenti": [],
                                                        "aggiorna_anagrafica": True}, cookie="mz")
        self.assertEqual(code, 400)

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
        self.assertEqual(set(info["areas"]), {"documenti", "posta", "mezzi"})

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

    def test_cartelle_modelli_solo_nel_env(self):
        _, body, _ = self.call("/api/config")
        self.assertNotIn("MODELLI_SORGENTE", json.loads(body)["env"])
        with mock.patch.object(env_config, "save_settings") as salva:
            code, body, _ = self.call("/api/config", {"env": {"MODELLI_SORGENTE": "C:\altro"}})
            self.assertEqual(code, 400)
            self.assertIn("solo nel file .env", json.loads(body)["error"])
            salva.assert_not_called()

    def test_avvisi_modelli(self):
        stato = modelli_protetti.STATO_CONTROLLO
        stato.write_text(json.dumps({"avvisi": [{"id": "a1", "tipo": "modifiche", "data": "2026-11-01T08:00:00",
                                                 "modificati": ["contratto.docx"], "visto_il": ""}]}), encoding="utf-8")
        self.assertEqual(self.call("/api/modelli/avvisi", cookie="doc")[0], 403)
        _, body, _ = self.call("/api/modelli/avvisi")
        self.assertEqual([a["id"] for a in json.loads(body)["avvisi"]], ["a1"])
        self.assertEqual(self.call("/api/modelli/avvisi/visto", {"id": "a1"}, cookie="doc")[0], 403)
        code, body, _ = self.call("/api/modelli/avvisi/visto", {"id": "a1"})
        self.assertEqual((code, json.loads(body)["avvisi"]), (200, []))
        self.assertEqual(self.call("/api/modelli/avvisi/visto", {"id": "x"})[0], 400)


if __name__ == "__main__":
    unittest.main()
