# "><(((º> sabusabu <º)))><"
"""Confronto documenti: vfp_gui davanti a un motore finto (stesse rotte di confronto-documenti/server.py)."""

import json
import re
import tempfile
import threading
import unittest
import uuid
from base64 import b64encode
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from tests import ROOT  # noqa: F401
import auth
import confronto
import env_config
import vfp_gui

SEGRETO = "segreto-di-prova"


class MotoreFinto(BaseHTTPRequestHandler):
    jobs = {}
    ricevute = []  # (metodo, path, corpo)

    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if ctype == "application/pdf":
            self.send_header("Content-Disposition", 'attachment; filename="report_confronto.pdf"')
        self.end_headers()
        self.wfile.write(data)

    def _ok(self):
        atteso = "Basic " + b64encode(f"{confronto.UTENTE_MOTORE}:{SEGRETO}".encode()).decode()
        if self.headers.get("Authorization") != atteso:
            self._send(401, {"error": "password"})
            return False
        return True

    def _corpo(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_GET(self):
        if not self._ok():
            return
        self.ricevute.append(("GET", self.path, b""))
        if self.path == "/healthz":
            return self._send(200, {"ok": True})
        if self.path == "/api/models":
            return self._send(200, {"models": ["tesseract"]})
        if self.path.startswith("/api/storico"):
            ids = self.path.split("ids=", 1)[1].split(",")
            return self._send(200, {"confronti": [self.jobs[i] for i in ids if self.jobs.get(i, {}).get("status") == "done"]})
        m = re.fullmatch(r"/api/jobs/(\w+)(/report\.pdf|/page/\d+/[ab](\?v=proc)?)?", self.path)
        if m and m[1] in self.jobs:
            if m[2] == "/report.pdf":
                return self._send(200, b"%PDF-finto", "application/pdf")
            if m[2]:
                return self._send(200, b"\xff\xd8jpeg", "image/jpeg")
            return self._send(200, self.jobs[m[1]])
        self._send(404, {"error": "Confronto non trovato"})

    def do_POST(self):
        if not self._ok():
            return
        corpo = self._corpo()
        self.ricevute.append(("POST", self.path, corpo))
        if self.path == "/api/compare":
            nomi = re.findall(rb'filename="([^"]+)"', corpo)
            job_id = uuid.uuid4().hex[:12]
            self.jobs[job_id] = {"id": job_id, "status": "done", "name_a": nomi[0].decode(), "name_b": nomi[1].decode(),
                                 "message": "Differenze in 1 pagina/e.", "diff_count": 1, "results": []}
            return self._send(200, {"job_id": job_id})
        self._send(200, {"ok": True})

    def do_PUT(self):
        if self._ok():
            self.ricevute.append(("PUT", self.path, self._corpo()))
            self._send(200, {"ok": True, "revisione": {}})

    def do_DELETE(self):
        if self._ok():
            self.ricevute.append(("DELETE", self.path, b""))
            self.jobs.pop(self.path.rsplit("/", 1)[1], None)
            self._send(200, {"ok": True})


def multipart(nome_a="vecchio.pdf", nome_b="nuovo.pdf"):
    confine = "----confine"
    parti = []
    for campo, nome in (("pdf1", nome_a), ("pdf2", nome_b)):
        parti.append(f'--{confine}\r\nContent-Disposition: form-data; name="{campo}"; filename="{nome}"\r\n'
                     f"Content-Type: application/pdf\r\n\r\n%PDF-1.4 {nome}\r\n")
    parti.append(f'--{confine}\r\nContent-Disposition: form-data; name="dpi"\r\n\r\n200\r\n--{confine}--\r\n')
    return "".join(parti).encode(), f"multipart/form-data; boundary={confine}"


class ConfrontoTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        d = Path(cls.tmp.name)
        cls.motore = ThreadingHTTPServer(("127.0.0.1", 0), MotoreFinto)
        threading.Thread(target=cls.motore.serve_forever, daemon=True).start()
        cls.eventi = []
        cls.patches = [
            mock.patch.object(confronto, "REGISTRO", d / "registro.json"),
            mock.patch.object(env_config, "load_settings", lambda *a, **k: dict(env_config.DEFAULTS)),
            mock.patch.object(auth, "session", lambda token: {
                "admin": {"user": "capo", "role": "admin", "area": "documenti"},
                "mario": {"user": "mario", "role": "utente", "area": "documenti"},
                "anna": {"user": "anna", "role": "utente", "area": "posta"},
            }.get(token)),
            mock.patch.object(vfp_gui.attivita, "record", lambda *a, **k: cls.eventi.append(a)),
        ]
        for p in cls.patches:
            p.start()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), vfp_gui.Handler)
        cls.port = cls.server.server_address[1]
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        for s in (cls.server, cls.motore):
            s.shutdown()
            s.server_close()
        for p in cls.patches:
            p.stop()
        confronto.MOTORE.porta = None
        cls.tmp.cleanup()

    def setUp(self):
        confronto.MOTORE.collega(self.motore.server_address[1], SEGRETO)
        MotoreFinto.ricevute.clear()

    def call(self, path, cookie="mario", body=None, data=None, ctype=None, csrf=True):
        h = {"Cookie": f"{vfp_gui.SESSION_COOKIE}={cookie}"}
        if body is not None:
            data, ctype = json.dumps(body).encode(), "application/json"
        if data is not None:
            h["Content-Type"] = ctype
            if csrf:
                h["X-VFP-UI"] = "1"
        req = Request(f"http://127.0.0.1:{self.port}{path}", data=data, headers=h, method="POST" if data is not None else "GET")
        try:
            with urlopen(req, timeout=10) as r:
                return r.status, r.read(), dict(r.headers)
        except HTTPError as e:
            return e.code, e.read(), dict(e.headers)

    def avvia(self, cookie="mario", **nomi):
        data, ctype = multipart(**nomi)
        code, body, _ = self.call("/api/confronto/compare", cookie, data=data, ctype=ctype)
        self.assertEqual(code, 200, body)
        return json.loads(body)["job_id"]

    def test_utente_confronta_e_vede_solo_i_suoi(self):
        job = self.avvia("mario")
        self.assertEqual(confronto.proprietario(job), "mario")
        self.assertIn(("mario", "confronto", "Confronto avviato", "vecchio.pdf ↔ nuovo.pdf"), self.eventi)
        # il file arriva intero al motore, con la password del processo (il motore finto la controlla)
        self.assertIn(b"%PDF-1.4 nuovo.pdf", [c for m, p, c in MotoreFinto.ricevute if p == "/api/compare"][0])
        self.assertEqual(self.call(f"/api/confronto/jobs/{job}", "mario")[0], 200)
        self.assertEqual(self.call(f"/api/confronto/jobs/{job}/page/1/a?v=proc", "mario")[2]["Content-Type"], "image/jpeg")
        code, pdf, h = self.call(f"/api/confronto/jobs/{job}/report.pdf", "mario")
        self.assertEqual((code, pdf), (200, b"%PDF-finto"))
        self.assertIn("attachment", h["Content-Disposition"])
        # un altro utente non lo vede nemmeno (come se non esistesse), l'amministratore si'
        for path in (f"/api/confronto/jobs/{job}", f"/api/confronto/jobs/{job}/report.pdf", f"/api/confronto/jobs/{job}/page/1/a"):
            self.assertEqual(self.call(path, "anna")[0], 404)
        self.assertEqual(self.call(f"/api/confronto/jobs/{job}/delete", "anna", body={})[0], 404)
        self.assertEqual(self.call(f"/api/confronto/jobs/{job}", "admin")[0], 200)
        mine = json.loads(self.call("/api/confronto/storico", "mario")[1])["confronti"]
        self.assertIn(job, [c["id"] for c in mine])
        self.assertNotIn(job, [c["id"] for c in json.loads(self.call("/api/confronto/storico", "anna")[1])["confronti"]])
        self.assertIn(job, [c["id"] for c in json.loads(self.call("/api/confronto/storico", "admin")[1])["confronti"]])

    def test_tutte_e_due_le_aree_confrontano(self):
        # ognuno vede solo il traffico della sua area (documenti o posta), ma il confronto e' per tutti
        self.assertEqual(self.call("/api/mail", "mario")[0], 403)
        self.assertEqual(self.call("/api/report", "anna")[0], 403)
        for chi in ("mario", "anna"):
            job = self.avvia(chi)
            self.assertEqual(confronto.proprietario(job), chi)
            self.assertEqual(self.call(f"/api/confronto/jobs/{job}", chi)[0], 200)
            self.assertEqual(self.call("/api/confronto/stato", chi)[0], 200)

    def test_revisione_ed_eliminazione(self):
        job = self.avvia("mario")
        code, _, _ = self.call(f"/api/confronto/jobs/{job}/revisione", body={"chiave": "0:1", "stato": "ok", "nota": "visto", "x": 1})
        self.assertEqual(code, 200)
        metodo, path, corpo = MotoreFinto.ricevute[-1]
        self.assertEqual((metodo, path), ("PUT", f"/api/jobs/{job}/revisione"))
        self.assertEqual(json.loads(corpo), {"chiave": "0:1", "stato": "ok", "nota": "visto"})  # niente campi in piu'
        self.assertEqual(self.call(f"/api/confronto/jobs/{job}/delete", body={})[0], 200)
        self.assertIsNone(confronto.proprietario(job))
        self.assertEqual(self.call(f"/api/confronto/jobs/{job}")[0], 404)

    def test_richieste_rifiutate(self):
        data, ctype = multipart()
        self.assertEqual(self.call("/api/confronto/compare", "nessuno", data=data, ctype=ctype)[0], 401)
        self.assertEqual(self.call("/api/confronto/compare", data=data, ctype=ctype, csrf=False)[0], 403)
        self.assertEqual(self.call("/api/confronto/compare", body={"pdf1": "x"})[0], 400)
        with mock.patch.object(confronto, "MAX_UPLOAD", 10):
            self.assertEqual(self.call("/api/confronto/compare", data=data, ctype=ctype)[0], 413)
        for path in ("/api/confronto/jobs/../../healthz", "/api/confronto/jobs/ABC", "/api/confronto/jobs/0123456789ab/page/1/c"):
            self.assertEqual(self.call(path)[0], 404)
        self.assertFalse([p for _, p, _ in MotoreFinto.ricevute if p == "/api/compare"])

    def test_motore_spento(self):
        with mock.patch.object(confronto.MOTORE, "porta", 1):  # nessuno in ascolto: niente da riavviare nei test
            code, body, _ = self.call("/api/confronto/stato")
        self.assertEqual(code, 503)
        self.assertIn("non disponibile", json.loads(body)["error"])

    def test_motore_assente_spiegato(self):
        confronto.MOTORE.porta = None
        with mock.patch.object(confronto, "cartella_motore", lambda s=None: Path(self.tmp.name) / "manca"):
            code, body, _ = self.call("/api/confronto/stato")
        self.assertEqual(code, 503)
        self.assertIn("non trovato", json.loads(body)["error"])

    def test_impostazioni_solo_da_env(self):
        self.assertLessEqual({"CONFRONTO_DIR", "CONFRONTO_PYTHON"}, env_config.SOLO_SVILUPPATORI)


if __name__ == "__main__":
    unittest.main()
