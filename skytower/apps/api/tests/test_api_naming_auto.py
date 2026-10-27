# "><(((º> sabusabu <º)))><"
"""Rinomina automatica in caricamento: progressivo deciso dal Project Admin, nome originale nelle note."""
from __future__ import annotations

import hashlib
import os

import pytest
from test_api_documents import PDF, put_parts

from cde_api.tooling.demo_seed import DEMO_PASSWORD

ORIGINAL = "Pianta piano terra DEF (copia).pdf"


@pytest.fixture
def as_user(client, api_world):
    _, w = api_world
    tokens: dict[str, str] = {}

    def headers(user: str) -> dict:
        if user not in tokens:
            client.app.state.services.limiter.reset()
            r = client.post("/auth/login", json={"email": w.emails[user], "password": DEMO_PASSWORD})
            assert r.status_code == 200, r.text
            tokens[user] = r.json()["access_token"]
        return {"Authorization": f"Bearer {tokens[user]}"}
    return headers


@pytest.fixture
def volume():
    """Volume casuale: ogni test ha la sua serie (il DB di test è condiviso tra i moduli)."""
    return "Q" + os.urandom(2).hex().upper()[:2]


@pytest.fixture
def auto_settings(client, api_world, as_user):
    _, w = api_world
    url = f"/projects/{w.project_id}/document-settings"
    admin = as_user("com_admin")
    before = client.get(url, headers=admin).json()

    def configure(**auto):
        r = client.put(url, headers=admin, json={"naming_scheme": None, "metadata_schema": before["metadata_schema"],
                                                  "auto_number": auto})
        assert r.status_code == 200, r.text
        return r.json()
    yield configure
    client.put(url, headers=admin, json={"naming_scheme": None, "metadata_schema": before["metadata_schema"],
                                         "auto_number": None})


def _propose(client, w, headers, fields, filename=ORIGINAL):
    return client.post(f"/projects/{w.project_id}/naming/propose", headers=headers,
                       json={"filename": filename, "fields": fields})


def _upload_auto(client, headers, container_id, fields, *, title="Pianta piano terra", filename=ORIGINAL,
                 comment=None):
    body = {"container_id": str(container_id), "filename": filename, "size_bytes": len(PDF),
            "sha256": hashlib.sha256(PDF).hexdigest(), "content_type": "application/pdf", "title": title,
            "comment": comment, "auto_name": {"fields": fields}}
    r = client.post("/uploads/initiate", headers=headers, json=body)
    if r.status_code != 201:
        return r
    up = r.json()
    put_parts(client, headers, up, PDF)
    done = client.post(f"/uploads/{up['upload_id']}/complete", headers=headers)
    assert done.status_code == 200, done.text
    return done


def test_configurazione_solo_admin_e_validata(client, api_world, as_user, auto_settings):
    _, w = api_world
    url = f"/projects/{w.project_id}/document-settings"
    body = {"naming_scheme": None, "metadata_schema": {"type": "object"}, "auto_number": {"start": 1}}
    assert client.put(url, headers=as_user("des_lead"), json=body).status_code == 403
    bad = {**body, "auto_number": {"field": "type"}}
    r = client.put(url, headers=as_user("com_admin"), json=bad)
    assert r.status_code == 422 and "non accetta numeri progressivi" in r.text
    bad = {**body, "auto_number": {"defaults": {"type": "QQ"}}}
    assert client.put(url, headers=as_user("com_admin"), json=bad).status_code == 422
    s = auto_settings(start=1, series=["volume"], defaults={"level": "00", "type": "DR", "role": "A"})
    assert s["auto_number"]["series"] == ["volume"]


def test_rinomina_spenta_409(client, api_world, as_user):
    _, w = api_world
    r = _propose(client, w, as_user("des_lead"), {"volume": "ZZ"})
    assert r.status_code == 409 and r.json()["error"]["code"] == "auto_number_off"


def test_proposta_e_caricamento_rinominato(client, api_world, as_user, auto_settings, volume):
    _, w = api_world
    auto_settings(start=5, defaults={"level": "00", "type": "DR", "role": "A"})
    h = as_user("des_lead")

    p = _propose(client, w, h, {"volume": volume, "originator": "SUB1"}).json()
    assert p["valid"], p
    assert p["name"] == f"PRJ01-DES-{volume}-00-DR-A-0005.pdf"     # originatore = propria organizzazione
    assert p["source_filename"] == ORIGINAL

    rev = _upload_auto(client, h, w.containers["des_arch"], {"volume": volume}, comment="Emissione per coordinamento").json()
    assert rev["original_filename"] == f"PRJ01-DES-{volume}-00-DR-A-0005.pdf"
    assert rev["source_filename"] == ORIGINAL
    assert rev["comment"] == f"Emissione per coordinamento\n\nNome originale del file: {ORIGINAL}"
    doc = client.get(f"/documents/{rev['document_id']}", headers=h).json()
    assert doc["identifier"] == f"PRJ01-DES-{volume}-00-DR-A-0005"

    # il successivo prosegue la serie; un'altra combinazione (tipo diverso) ha la sua serie
    assert _propose(client, w, h, {"volume": volume}).json()["number"] == 6
    assert _propose(client, w, h, {"volume": volume, "type": "M3"}).json()["number"] == 5


def test_numerazione_conta_i_documenti_non_visibili(client, api_world, as_user, auto_settings, volume):
    """Serie per solo volume: SUB1 non vede il WIP di DES ma non ne riusa il numero."""
    _, w = api_world
    auto_settings(start=1, series=["volume"], defaults={"level": "00", "type": "DR", "role": "E"})
    des, sub1 = as_user("des_lead"), as_user("sub1_user")
    _upload_auto(client, des, w.containers["des_arch"], {"volume": volume, "role": "A"})
    r = client.get(f"/projects/{w.project_id}/documents?q={volume}", headers=sub1)
    assert r.status_code == 200 and volume not in r.text
    p = _propose(client, w, sub1, {"volume": volume}).json()
    assert p["name"] == f"PRJ01-SUB1-{volume}-00-DR-E-0002.pdf"
    rev = _upload_auto(client, sub1, w.containers["sub1_root"], {"volume": volume}).json()
    assert rev["original_filename"].endswith("-0002.pdf")


def test_caricamento_fallito_non_consuma_il_numero(client, api_world, as_user, auto_settings, volume):
    _, w = api_world
    auto_settings(start=1, defaults={"level": "00", "type": "DR", "role": "A"})
    h = as_user("des_lead")
    r = _upload_auto(client, h, w.containers["des_arch"], {"volume": volume}, title=None)
    assert r.status_code == 422 and r.json()["error"]["code"] == "title_required"
    assert _propose(client, w, h, {"volume": volume}).json()["number"] == 1


def test_valori_non_validi_rifiutati(client, api_world, as_user, auto_settings, volume):
    _, w = api_world
    auto_settings(start=1, defaults={"level": "00", "type": "DR", "role": "A"})
    h = as_user("des_lead")
    p = _propose(client, w, h, {"volume": volume, "type": "XX"}).json()
    assert not p["valid"] and {e["field"] for e in p["errors"]} == {"type"}
    r = _upload_auto(client, h, w.containers["des_arch"], {"volume": volume, "type": "XX"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_name"
    assert _propose(client, w, h, {"volume": volume}).json()["number"] == 1


def test_file_senza_estensione(client, api_world, as_user, auto_settings, volume):
    _, w = api_world
    auto_settings(start=1, defaults={"level": "00", "type": "DR", "role": "A"})
    p = _propose(client, w, as_user("des_lead"), {"volume": volume}, filename="LEGGIMI").json()
    assert p["valid"] and p["name"] == f"PRJ01-DES-{volume}-00-DR-A-0001"


def test_anteprima_di_piu_file_numeri_consecutivi(client, api_world, as_user, auto_settings, volume):
    _, w = api_world
    auto_settings(start=1, defaults={"level": "00", "type": "DR", "role": "A"})
    h = as_user("des_lead")
    items = [{"filename": "a.pdf", "fields": {"volume": volume}},
             {"filename": "b.dwg", "fields": {"volume": volume, "type": "M3"}},
             {"filename": "c.pdf", "fields": {"volume": volume}}]
    r = client.post(f"/projects/{w.project_id}/naming/propose-batch", headers=h, json={"items": items})
    assert r.status_code == 200, r.text
    assert [p["name"] for p in r.json()] == [f"PRJ01-DES-{volume}-00-DR-A-0001.pdf",
                                             f"PRJ01-DES-{volume}-00-M3-A-0001.dwg",
                                             f"PRJ01-DES-{volume}-00-DR-A-0002.pdf"]
    # caricati nello stesso ordine, i numeri riservati coincidono con l'anteprima
    for it, p in zip(items, r.json(), strict=True):
        rev = _upload_auto(client, h, w.containers["des_arch"], it["fields"], filename=it["filename"]).json()
        assert rev["original_filename"] == p["name"]


def test_schema_personalizzato_con_progressivo(client, api_world, as_user, auto_settings):
    """Lo schema scritto dall'admin (separatore, campi, codici) vale anche per la rinomina."""
    _, w = api_world
    auto_settings(start=1)                      # registra il ripristino a fine test
    url = f"/projects/{w.project_id}/document-settings"
    disc = "D" + os.urandom(1).hex().upper()[:1]
    scheme = {"separator": "_", "fields": [
        {"key": "project", "label": "Progetto", "kind": "fixed", "value": "PRJ01", "min_length": 5, "max_length": 5},
        {"key": "originator", "label": "Originatore", "kind": "list", "min_length": 3, "max_length": 4,
         "codes": {"DES": "Progettista", "SUB1": "Impianti"}},
        {"key": "disc", "label": "Disciplina", "kind": "list", "min_length": 2, "max_length": 2,
         "codes": {disc: "Prova", "AR": "Architettonico"}},
        {"key": "seq", "label": "Progressivo", "kind": "regex", "pattern": r"\d{3}", "min_length": 3, "max_length": 3},
    ]}
    body = {"naming_scheme": scheme, "metadata_schema": {"type": "object"},
            "auto_number": {"field": "seq", "start": 10, "series": ["disc"], "defaults": {"disc": disc}}}
    r = client.put(url, headers=as_user("com_admin"), json=body)
    assert r.status_code == 200, r.text
    assert r.json()["custom_naming"] and r.json()["auto_number"]["field"] == "seq"
    p = _propose(client, w, as_user("des_lead"), {}, filename="relazione.docx").json()
    assert p["valid"] and p["name"] == f"PRJ01_DES_{disc}_010.docx"
    # il progressivo deve stare nello schema inviato
    bad = {**body, "auto_number": {"field": "number"}}
    assert client.put(url, headers=as_user("com_admin"), json=bad).status_code == 422
