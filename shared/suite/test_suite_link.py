# "><(((º> sabusabu <º)))><"
"""Test del modulo condiviso: token, verifica, chiamate (con un server HTTP finto)."""
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import suite_link  # noqa: E402


@pytest.fixture
def token_tmp(tmp_path, monkeypatch):
    monkeypatch.delenv("SUITE_TOKEN", raising=False)
    monkeypatch.setattr(suite_link, "FILE_TOKEN", tmp_path / ".token")
    return tmp_path / ".token"


def test_token_creato_e_riletto(token_tmp):
    t1 = suite_link.token()
    assert len(t1) >= 32 and token_tmp.read_text().strip() == t1
    assert suite_link.token() == t1
    assert suite_link.verifica(t1) and not suite_link.verifica("altro") and not suite_link.verifica(None)


def test_token_da_ambiente(token_tmp, monkeypatch):
    monkeypatch.setenv("SUITE_TOKEN", "segreto-di-prova")
    assert suite_link.token() == "segreto-di-prova"
    assert not token_tmp.exists()


def test_normalizza_commessa():
    assert suite_link.normalizza_commessa(" 101-003 ") == "101-003"
    assert suite_link.normalizza_commessa("c-2026 014") == "C-2026014"
    assert suite_link.normalizza_commessa(None) == ""


def test_url_pubblico(monkeypatch):
    monkeypatch.delenv("SUITE_DOMINIO", raising=False)
    monkeypatch.delenv("SUITE_URL_PUBBLICO_INCAMPO", raising=False)
    monkeypatch.delenv("SUITE_URL_PUBBLICO_MAGAZZINO", raising=False)
    monkeypatch.delenv("MAGAZZINO_PROGRAMMA_UNICO", raising=False)
    assert suite_link.url_pubblico("incampo") == "http://localhost:5190"
    # programma unico "DDT e Magazzino": il Magazzino si apre dentro il Lettore DDT
    assert suite_link.url_pubblico("magazzino") == "http://localhost:5050/magazzino"
    monkeypatch.setenv("SUITE_DOMINIO", "cosedil.it")
    assert suite_link.url_pubblico("magazzino") == "https://lettore-ddt.cosedil.it/magazzino"
    monkeypatch.setenv("MAGAZZINO_PROGRAMMA_UNICO", "0")             # Magazzino da solo: indirizzo proprio
    assert suite_link.url_pubblico("magazzino") == "https://magazzino-operativo.cosedil.it"


class _Finto(BaseHTTPRequestHandler):
    ricevute = []

    def _rispondi(self, stato, corpo, tipo="application/json"):
        dati = json.dumps(corpo).encode() if not isinstance(corpo, bytes) else corpo
        self.send_response(stato)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(dati)))
        self.end_headers()
        self.wfile.write(dati)

    def do_GET(self):
        _Finto.ricevute.append(("GET", self.path, dict(self.headers), None))
        if self.path.startswith("/api/suite/vietato"):
            return self._rispondi(403, {"errore": "Token non valido"})
        if self.path.startswith("/api/suite/file"):
            return self._rispondi(200, b"PDFBYTES", "application/pdf")
        self._rispondi(200, {"ok": True, "path": self.path})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        corpo = self.rfile.read(n)
        _Finto.ricevute.append(("POST", self.path, dict(self.headers), corpo))
        if self.path.startswith("/api/suite/dettaglio"):
            return self._rispondi(422, {"detail": [{"msg": "campo mancante"}]})
        self._rispondi(201, {"creato": True})

    def log_message(self, *a):
        pass


@pytest.fixture
def server(monkeypatch, token_tmp):
    srv = HTTPServer(("127.0.0.1", 0), _Finto)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    monkeypatch.setitem(suite_link.URL_API, "magazzino", f"http://127.0.0.1:{srv.server_port}/api")
    _Finto.ricevute.clear()
    yield srv
    srv.shutdown()


def test_chiama_get_con_token_e_utente(server):
    r = suite_link.chiama("magazzino", "GET", "/suite/commesse/101-003/giacenze", parametri={"q": "sabbia"},
                          utente="mrossi", nome="Mario Rossi")
    assert r["ok"] and r["path"] == "/api/suite/commesse/101-003/giacenze?q=sabbia"
    _, _, testata, _ = _Finto.ricevute[0]
    assert testata["X-Suite-Token"] == suite_link.token()
    assert testata["X-Suite-Utente"] == "mrossi" and testata["X-Suite-Nome"] == "Mario Rossi"


def test_chiama_post_json_e_multipart(server):
    r = suite_link.chiama("magazzino", "POST", "/suite/task", dati={"titolo": "Gru ferma"})
    assert r["creato"]
    _, _, testata, corpo = _Finto.ricevute[0]
    assert testata["Content-Type"] == "application/json" and json.loads(corpo)["titolo"] == "Gru ferma"
    suite_link.chiama("magazzino", "POST", "/suite/documenti", dati={"titolo": "Report", "extra": {"a": 1}},
                      file=("file", "report.pdf", b"%PDF-1.4", "application/pdf"))
    _, _, testata, corpo = _Finto.ricevute[1]
    assert testata["Content-Type"].startswith("multipart/form-data; boundary=")
    assert b'name="file"; filename="report.pdf"' in corpo and b"%PDF-1.4" in corpo and b'{"a": 1}' in corpo


def test_chiama_corpo_file(server):
    suite_link.chiama("magazzino", "POST", "/suite/documenti", parametri={"title": "Report à", "tipo": "RP"},
                      corpo_file=(b"%PDF-1.4 x", "application/pdf", "giacenze 101.pdf"))
    _, path, testata, corpo = _Finto.ricevute[0]
    assert path == "/api/suite/documenti?title=Report+%C3%A0&tipo=RP"
    assert testata["Content-Type"] == "application/pdf" and corpo == b"%PDF-1.4 x"
    assert testata["X-Suite-Nome-File"] == "giacenze%20101.pdf"


def test_chiama_errori(server):
    with pytest.raises(suite_link.SuiteError) as e:
        suite_link.chiama("magazzino", "GET", "/suite/vietato")
    assert e.value.stato == 403 and "Token non valido" in e.value.messaggio
    with pytest.raises(suite_link.SuiteError) as e:
        suite_link.chiama("magazzino", "POST", "/suite/dettaglio", dati={})
    assert e.value.stato == 422 and "campo mancante" in e.value.messaggio


def test_chiama_grezzo(server):
    dati, tipo = suite_link.chiama("magazzino", "GET", "/suite/file", grezzo=True)
    assert dati == b"PDFBYTES" and tipo == "application/pdf"


def test_app_spenta(monkeypatch, token_tmp):
    monkeypatch.setitem(suite_link.URL_API, "incampo", "http://127.0.0.1:1/api")
    with pytest.raises(suite_link.SuiteError) as e:
        suite_link.chiama("incampo", "GET", "/suite/commesse", timeout=1)
    assert e.value.stato == 503 and "InCampo non raggiungibile" in e.value.messaggio
    assert suite_link.raggiungibile("incampo", timeout=1) is False


def test_token_solo_in_memoria_se_cartella_non_scrivibile(monkeypatch, tmp_path):
    monkeypatch.delenv("SUITE_TOKEN", raising=False)
    monkeypatch.setattr(suite_link, "FILE_TOKEN", tmp_path / "non-esiste" / ".token")
    t = suite_link.token()
    assert os.environ.get("SUITE_TOKEN") == t
    monkeypatch.delenv("SUITE_TOKEN", raising=False)


# --------------------------------------------------------------------------- registro commesse

@pytest.fixture
def registro_tmp(tmp_path, monkeypatch):
    f = tmp_path / "commesse.json"
    monkeypatch.setattr(suite_link, "FILE_COMMESSE", f)
    return f


def test_registro_commesse_salva_unisce_trova(registro_tmp):
    out = suite_link.salva_commesse([
        {"code": "101-003", "nome": "Porto di Augusta", "stato": "attiva"},
        {"codice": " 101-003 ", "cliente": "Autorità portuale"},   # stesso codice (spazi attorno): si unisce
        {"code": "C-2026-014", "nome": "Scuola Messina", "stato": "chiusa"},
        {"code": "", "nome": "senza codice"},
        {"code": "X-1", "stato": "boh"},                            # stato sconosciuto → attiva
    ])
    assert [c["code"] for c in out] == ["101-003", "C-2026-014", "X-1"]
    assert out[0] == {"code": "101-003", "nome": "Porto di Augusta", "stato": "attiva", "cliente": "Autorità portuale", "indirizzo": "", "note": ""}
    assert out[2]["stato"] == "attiva"
    assert registro_tmp.exists() and json.loads(registro_tmp.read_text(encoding="utf-8"))["fonte"] == "manuale"
    assert [c["code"] for c in suite_link.commesse(solo_attive=True)] == ["101-003", "X-1"]
    assert suite_link.trova_commessa(" c-2026-014 ")["nome"] == "Scuola Messina"
    assert suite_link.trova_commessa("999") is None and suite_link.trova_commessa("") is None


def test_registro_assente_o_rotto(registro_tmp):
    assert suite_link.commesse() == []
    registro_tmp.write_text("{non json", encoding="utf-8")
    assert suite_link.commesse() == []


def test_url_api_tutte_le_app():
    for app in suite_link.NOMI:
        assert app in suite_link.URL_API and app in suite_link.SALUTE
        assert suite_link.url_pubblico(app).startswith("http")
