# "><(((º> sabusabu <º)))><"
"""Segui documento: notifiche alle nuove revisioni e ai cambi di stato, solo per ciò che il follower può vedere."""
from __future__ import annotations

import psycopg
from test_api_documents import PDF, des_name, upload, worker  # noqa: F401 - fixture riusata
from test_api_naming_auto import as_user  # noqa: F401 - fixture riusata
from test_api_states import transition


def _followed(client, headers, document_id) -> list[dict]:
    items = client.get("/notifications", headers=headers).json()["items"]
    return [n for n in items if n["kind"] == "DOCUMENT_FOLLOWED" and n["data"].get("document_id") == str(document_id)]


def _transition_job(urls, revision_id, to_state) -> int:
    """Quello che fa il job cde.notify_state_changed del worker."""
    with psycopg.connect(urls.worker, autocommit=True) as conn:
        return conn.execute("SELECT cde.notify_followers_of_transition(%s, %s)", [revision_id, to_state]).fetchone()[0]


def test_segui_documento(client, api_world, as_user, worker):  # noqa: F811
    urls, w = api_world
    lead, designer, im = as_user("des_lead"), as_user("des_designer"), as_user("com_im")
    name = des_name()
    first = upload(client, lead, w.containers["des_arch"], name, PDF, title="Prospetto nord").json()
    worker()
    doc_id = first["document_id"]
    # il WIP di DES non lo vede il committente: non può nemmeno seguirlo
    assert client.put(f"/documents/{doc_id}/follow", headers=im).status_code == 404
    shared = transition(client, lead, first["id"], "SHARED", "S2").json()
    for h in (designer, im, lead):
        assert client.put(f"/documents/{doc_id}/follow", headers=h).status_code == 204
    assert client.put(f"/documents/{doc_id}/follow", headers=im).status_code == 204      # idempotente
    assert client.get(f"/documents/{doc_id}", headers=im).json()["following"] is True

    # nuova WIP: la vede il collega di DES, non il committente; l'autore non avvisa se stesso
    r2 = upload(client, lead, w.containers["des_arch"], name, PDF + b"v2", expected=shared["revision_code"])
    assert r2.status_code == 200, r2.text
    worker()
    [n] = _followed(client, designer, doc_id)
    assert n["title"] == f"Nuova revisione {r2.json()['revision_code']}: {name.removesuffix('.pdf')}"
    assert n["link"] == f"/progetti/{w.project_id}/documenti?doc={doc_id}"
    assert _followed(client, im, doc_id) == [] and _followed(client, lead, doc_id) == []

    # condivisione: ora lo vede anche il committente
    shared2 = transition(client, lead, r2.json()["id"], "SHARED", "S2").json()
    assert _transition_job(urls, shared2["id"], "SHARED") == 2                   # designer + committente
    [n] = _followed(client, im, doc_id)
    assert n["title"].startswith("Condiviso: ") and "S" in n["body"]
    assert _followed(client, lead, doc_id) == []

    # chi smette di seguire non riceve più nulla
    assert client.delete(f"/documents/{doc_id}/follow", headers=im).status_code == 204
    assert client.get(f"/documents/{doc_id}", headers=im).json()["following"] is False
    assert _transition_job(urls, shared2["id"], "SHARED") == 1
    with psycopg.connect(urls.owner) as conn:
        rows = conn.execute("SELECT count(*) FROM cde.document_followers WHERE document_id = %s", [doc_id]).fetchone()[0]
    assert rows == 2
