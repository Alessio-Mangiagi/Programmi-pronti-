"""app/server.py: API sotto /api e frontend statico con fallback SPA."""
import os

import pytest
from fastapi.testclient import TestClient

from app.server import create_app, gate_suite


def test_serves_api_under_prefix_and_spa_fallback(client, tmp_path):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")

    with TestClient(create_app(dist)) as c:
        assert c.get("/").text.startswith("<!doctype html>")
        assert c.get("/projects/abc/plans/def").text.startswith("<!doctype html>")   # route React
        assert c.get("/assets/app.js").text == "console.log(1)"
        assert c.get("/assets/missing.js").status_code == 404                       # file veri: niente fallback
        assert c.get("/api/auth/login").status_code == 405                           # l'API risponde sotto /api
        r = c.post("/api/auth/login", json={"email": "admin@test.local", "password": "password123"})
        assert r.status_code == 200 and "access_token" in r.json()
        assert c.get("/api/docs").status_code == 200
        assert c.get("/docs").text.startswith("<!doctype html>")                     # nessuno Swagger alla radice


def test_without_dist_root_explains(client, tmp_path):
    with TestClient(create_app(tmp_path / "nope")) as c:
        assert "npm run build" in c.get("/").json()["detail"]
        assert c.post("/api/auth/login", json={"email": "admin@test.local", "password": "password123"}).status_code == 200


def test_gate_suite_fuori_dalla_suite_lascia_app_com_e(tmp_path):
    app = create_app(tmp_path / "nope")
    assert gate_suite(app, sso_dir=tmp_path / "manca") is app


@pytest.mark.skipif(os.getenv("COSEDIL_SSO", "on").lower() == "off", reason="gate spento da ambiente")
def test_gate_suite_pagine_al_portale_api_al_jwt(client, tmp_path, monkeypatch):
    # "><(((º> sabusabu <º)))><"
    from pathlib import Path

    sso = Path(__file__).resolve().parents[2] / "shared" / "sso"
    if not (sso / "cosedil_sso.py").is_file():
        pytest.skip("repo usata da sola: shared/sso non c'è")
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><div id=root></div>", encoding="utf-8")
    gated = gate_suite(create_app(dist), sso_dir=sso)
    import cosedil_sso

    # Portale finto: la verifica risponde "non loggato" per ogni cookie.
    monkeypatch.setattr(cosedil_sso, "verifica_sessione", lambda cookie, app_id="": {
        "ok": False, "reachable": True, "admin": False, "vietato": False})
    with TestClient(gated) as c:
        r = c.get("/progetti", headers={"Accept": "text/html"}, follow_redirects=False)
        assert r.status_code == 302 and r.headers["location"].endswith("/")
        assert c.get("/invito/tok", headers={"Accept": "text/html"}).status_code == 200  # pubblico
        # API senza cookie del portale: decide il JWT di InCampo (come per l'app mobile)
        assert c.get("/api/projects").status_code == 401
        r = c.post("/api/auth/login", json={"email": "admin@test.local", "password": "password123"})
        assert r.status_code == 200 and "access_token" in r.json()
