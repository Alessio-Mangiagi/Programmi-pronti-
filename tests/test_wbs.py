"""Albero WBS per cantiere: CRUD delle voci, moduli compilati su una voce, permessi, PDF, sync."""
import io

from pypdfium2 import PdfDocument

from tests.conftest import push


def _pdf_text(data: bytes) -> str:
    doc = PdfDocument(io.BytesIO(data))
    return "\n".join(page.get_textpage().get_text_range() for page in doc)


def _tree(client, pid):
    r = client.post(f"/projects/{pid}/wbs", json={"code": "01", "name": "Strutture"})
    assert r.status_code == 201, r.text
    root = r.json()
    r = client.post(f"/projects/{pid}/wbs", json={"code": "01.02", "name": "Solai", "parent_id": root["id"]})
    assert r.status_code == 201, r.text
    return root, r.json()


def test_wbs_crud_and_tree_order(client, project, users):
    pid = project["project"]["id"]
    root, child = _tree(client, pid)
    assert root["parent_id"] is None and root["position"] == 1
    assert child["parent_id"] == root["id"] and child["position"] == 1
    r = client.post(f"/projects/{pid}/wbs", json={"code": "02", "name": " Finiture "})
    assert r.json()["position"] == 2 and r.json()["name"] == "Finiture"

    nodes = client.get(f"/projects/{pid}/wbs").json()
    assert [n["name"] for n in nodes] == ["Strutture", "Solai", "Finiture"]
    assert all(n["submissions_count"] == 0 for n in nodes)

    # rinomina + codice vuoto → null
    r = client.patch(f"/wbs/{child['id']}", json={"name": "Solai piano 1", "code": ""})
    assert r.status_code == 200 and r.json()["name"] == "Solai piano 1" and r.json()["code"] is None

    # non si sposta sotto se stesso o un discendente; parent di un altro cantiere rifiutato
    assert client.patch(f"/wbs/{root['id']}", json={"parent_id": child["id"]}).status_code == 422
    other = client.post("/projects", json={"name": "Cantiere B"}).json()
    foreign = client.post(f"/projects/{other['id']}/wbs", json={"name": "X"}).json()
    assert client.patch(f"/wbs/{child['id']}", json={"parent_id": foreign["id"]}).status_code == 422
    assert client.post(f"/projects/{pid}/wbs", json={"name": "Y", "parent_id": foreign["id"]}).status_code == 422

    # cancellazione: prima i figli
    assert client.delete(f"/wbs/{root['id']}").status_code == 409
    assert client.delete(f"/wbs/{child['id']}").status_code == 204
    assert client.delete(f"/wbs/{root['id']}").status_code == 204
    assert client.get(f"/wbs/{root['id']}").status_code == 404

    # solo manager/admin modificano; field legge
    field = users["field"]["headers"]
    assert client.post(f"/projects/{pid}/wbs", headers=field, json={"name": "Z"}).status_code == 403
    assert client.get(f"/projects/{pid}/wbs", headers=field).status_code == 200
    outsider = users["outsider"]["headers"]
    assert client.get(f"/projects/{pid}/wbs", headers=outsider).status_code == 403


def test_submission_on_wbs_node(client, project, pin, users):
    pid = project["project"]["id"]
    tpl = project["template"]["id"]
    _, leaf = _tree(client, pid)
    field = users["field"]["headers"]

    # esattamente uno tra pin_id e wbs_node_id
    base = {"template_id": tpl, "data_json": {"esito": "Conforme"}}
    assert client.post("/submissions", json=base).status_code == 422
    assert client.post("/submissions", json={**base, "pin_id": pin, "wbs_node_id": leaf["id"]}).status_code == 422
    assert client.post("/submissions", json={**base, "wbs_node_id": "nope"}).status_code == 404

    r = client.post("/submissions", headers=field, json={**base, "wbs_node_id": leaf["id"]})
    assert r.status_code == 201, r.text
    sub = r.json()
    assert sub["pin_id"] is None and sub["wbs_node_id"] == leaf["id"]

    detail = client.get(f"/wbs/{leaf['id']}").json()
    assert detail["submissions_count"] == 1 and detail["submissions"][0]["id"] == sub["id"]
    assert [n["submissions_count"] for n in client.get(f"/projects/{pid}/wbs").json()] == [0, 1]

    # la voce con moduli non si cancella; accesso via progetto anche per lettura/modifica submission
    assert client.delete(f"/wbs/{leaf['id']}").status_code == 409
    assert client.get(f"/submissions/{sub['id']}", headers=users["outsider"]["headers"]).status_code == 403
    r = client.patch(f"/submissions/{sub['id']}", headers=field, json={"data_json": {"esito": "Non conforme"}})
    assert r.status_code == 200 and r.json()["data_json"]["esito"] == "Non conforme"

    # PDF con il percorso WBS al posto di planimetria/pin
    r = client.get(f"/submissions/{sub['id']}/pdf")
    assert r.status_code == 200
    text = _pdf_text(r.content)
    assert "Voce WBS" in text and "01 Strutture › 01.02 Solai" in text and "Planimetria" not in text

    # non fa parte del sync pull (l'app è a pin): il pull vede solo la submission sul pin
    on_pin = client.post("/submissions", json={**base, "pin_id": pin}).json()
    pulled = client.get("/sync/pull", params={"project_id": pid}).json()
    assert {s["id"] for s in pulled["submissions"]} == {on_pin["id"]}

    # allegato via sync push su una submission WBS: il controllo di progetto passa dalla voce
    res = push(client, attachments=[{"submission_id": sub["id"], "file_type": "photo"}])
    assert res["attachments"]["inserted"] == 1, res
