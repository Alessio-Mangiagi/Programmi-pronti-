# "><(((º> sabusabu <º)))><"
"""Dal modello BIM alle tavole: documenti che citano l'elemento selezionato e tavole del suo piano."""
from __future__ import annotations

from test_api_documents import des_name, upload, worker  # noqa: F401 - fixture riusata
from test_api_naming_auto import as_user  # noqa: F401 - fixture riusata
from test_api_watermark import real_pdf


def _lookup(client, w, headers, **params):
    r = client.get(f"/projects/{w.project_id}/model-element/documents", headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_documenti_che_citano_l_elemento(client, api_world, as_user, worker):  # noqa: F811
    _, w = api_world
    lead, im = as_user("des_lead"), as_user("com_im")
    plan = upload(client, lead, w.containers["des_arch"], des_name(),
                  real_pdf(1, "Legenda: Muro perimetrale sud Vombato P0 sp. 30 cm"), title="Pianta vombato").json()
    other = upload(client, lead, w.containers["des_arch"], des_name(),
                   real_pdf(1, "Legenda: Muro perimetrale sud Vombato P1"), title="Pianta vombato primo").json()
    guid_doc = upload(client, lead, w.containers["des_arch"], des_name(),
                      real_pdf(1, "Rif. elemento 2O2Fr8t4X7Zf8NOew3FLOH"), title="Dettaglio vombato").json()
    model = upload(client, lead, w.containers["des_arch"], des_name().replace("-DR-", "-M3-"),
                   real_pdf(1, "Muro perimetrale sud Vombato P0"), title="Altro modello vombato").json()
    worker()

    found = _lookup(client, w, lead, name="Muro perimetrale sud Vombato P0", guid="2O2Fr8t4X7Zf8NOew3FLOH")
    ids = {d["id"] for d in found["cited"]}
    assert ids == {plan["document_id"], guid_doc["document_id"]}       # frase esatta: la P1 non c'è
    assert model["document_id"] not in ids                                # gli altri modelli non sono tavole
    hit = next(d for d in found["cited"] if d["id"] == plan["document_id"])
    assert "⟦Vombato⟧" in hit["match_snippet"] and hit["match_revision"] == plan["revision_code"]
    # il modello stesso si esclude
    assert _lookup(client, w, lead, name="Muro perimetrale sud Vombato P1",
                   exclude=other["document_id"])["cited"] == []
    # WIP di DES: il committente non vede né i documenti né il loro testo
    assert _lookup(client, w, im, name="Muro perimetrale sud Vombato P0")["cited"] == []


def test_tavole_dello_stesso_piano(client, api_world, as_user, worker):  # noqa: F811
    _, w = api_world
    lead = as_user("des_lead")
    doc = upload(client, lead, w.containers["des_arch"], des_name(), real_pdf(1, "Pianta"), title="Pianta livello 01").json()
    same = _lookup(client, w, lead, level="01")
    assert same["level"] == "01" and doc["document_id"] in {d["id"] for d in same["same_level"]}
    assert all(d["naming_fields"]["level"] == "01" and d["naming_fields"]["type"] == "DR" for d in same["same_level"])
    assert _lookup(client, w, lead, level="0;") == {"cited": [], "same_level": [], "level": None}
    assert _lookup(client, w, lead) == {"cited": [], "same_level": [], "level": None}


def test_progetto_non_visibile(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    r = client.get(f"/projects/{w.project_id}/model-element/documents", headers=as_user("out_user"), params={"name": "x"})
    assert r.status_code == 404
