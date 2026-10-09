"""app/server.py: API sotto /api e frontend statico con fallback SPA."""
from fastapi.testclient import TestClient

from app.server import create_app


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
