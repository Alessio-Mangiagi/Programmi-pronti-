# "><(((º> sabusabu <º)))><"
"""Profilo personale: l'utente modifica i propri dati, non quelli degli altri né email/ruoli."""
from __future__ import annotations

import pytest

from test_api_admin import as_user  # noqa: F401 - fixture riusata


@pytest.fixture
def profile(client, as_user):  # noqa: F811
    """Headers di un utente e ripristino del suo profilo: il database dei test HTTP è condiviso."""
    restore: list[tuple[dict, dict]] = []

    def headers(user: str) -> dict:
        h = as_user(user)
        me = client.get("/me", headers=h).json()
        restore.append((h, {k: me[k] for k in ("first_name", "last_name", "phone", "job_title")}))
        return h
    yield headers
    for h, body in restore:
        client.patch("/me", headers=h, json=body)


def test_utente_non_admin_modifica_il_proprio_profilo(client, profile):
    h = profile("sub1_user")
    before = client.get("/me", headers=h).json()
    assert not before["is_org_admin"]
    r = client.patch("/me", headers=h, json={"first_name": "  Lucia ", "last_name": "Neri",
                                             "phone": "+39 095 123456", "job_title": "Capocantiere"})
    assert r.status_code == 200, r.text
    me = r.json()
    assert (me["first_name"], me["last_name"], me["phone"], me["job_title"]) == \
        ("Lucia", "Neri", "+39 095 123456", "Capocantiere")
    assert me["email"] == before["email"] and me["organization_id"] == before["organization_id"]
    # campi facoltativi vuoti tornano NULL
    r = client.patch("/me", headers=h, json={"first_name": "Lucia", "last_name": "Neri", "phone": "", "job_title": ""})
    assert r.status_code == 200 and r.json()["phone"] is None and r.json()["job_title"] is None


def test_profilo_validazioni(client, profile):
    h = profile("des_lead")
    assert client.patch("/me", headers=h, json={"first_name": "", "last_name": "X"}).status_code == 422
    assert client.patch("/me", headers=h, json={"first_name": "A", "last_name": "B",
                                                "phone": "chiamami"}).status_code == 422
    # campi non previsti (email, ruoli) sono ignorati
    r = client.patch("/me", headers=h, json={"first_name": "A", "last_name": "B", "is_org_admin": True,
                                             "email": "altro@des.example"})
    assert r.status_code == 200 and not r.json()["is_org_admin"] and r.json()["email"] != "altro@des.example"


def test_profilo_richiede_autenticazione(client):
    assert client.patch("/me", json={"first_name": "A", "last_name": "B"}).status_code == 401
