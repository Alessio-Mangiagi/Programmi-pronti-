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


# ---------- import da Excel / CSV ----------

def _xlsx(rows):
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _import(client, pid, content, name, dry_run=False):
    return client.post(f"/projects/{pid}/wbs/import", params={"dry_run": dry_run},
                       files={"file": (name, content, "application/octet-stream")})


def test_wbs_import_xlsx_dotted_codes_and_reimport(client, project, users):
    pid = project["project"]["id"]
    xlsx = _xlsx([["Codice", "Nome"], ["01", "Strutture"], ["01.01", "Fondazioni"], ["01.02", "Solai"],
                  ["01.02.01", "Solaio piano 1"], ["02", "Finiture"], ["", "Senza codice"], ["02", "Doppione"],
                  ["03", ""]])
    # anteprima: niente scritto
    r = _import(client, pid, xlsx, "wbs.xlsx", dry_run=True)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["dry_run"] and (body["created"], body["updated"], body["errors"]) == (6, 0, 2)
    assert [x["action"] for x in body["rows"]] == ["create"] * 6 + ["error", "error"]
    assert "codice duplicato" in body["rows"][6]["error"] and "nome mancante" in body["rows"][7]["error"]
    assert client.get(f"/projects/{pid}/wbs").json() == []

    r = _import(client, pid, xlsx, "wbs.xlsx")
    assert r.status_code == 200 and r.json()["created"] == 6
    nodes = client.get(f"/projects/{pid}/wbs").json()
    by_code = {n["code"]: n for n in nodes if n["code"]}
    assert by_code["01.01"]["parent_id"] == by_code["01"]["id"]
    assert by_code["01.02.01"]["parent_id"] == by_code["01.02"]["id"]
    assert by_code["02"]["parent_id"] is None and by_code["02"]["position"] == 2
    assert next(n for n in nodes if n["name"] == "Senza codice")["parent_id"] is None

    # secondo import: rinomina per codice, sposta con colonna padre, aggiunge; le voci non citate restano
    csv2 = "codice;nome;padre\n01.02;Solai e coperture;01\n01.02.01;Solaio piano primo;02\n04;Impianti;\n"
    r = _import(client, pid, csv2.encode("utf-8"), "wbs.csv")
    assert r.status_code == 200, r.text
    assert (r.json()["created"], r.json()["updated"]) == (1, 2)
    nodes = client.get(f"/projects/{pid}/wbs").json()
    by_code = {n["code"]: n for n in nodes if n["code"]}
    assert len(nodes) == 7 and by_code["01.02"]["name"] == "Solai e coperture"
    assert by_code["01.02.01"]["parent_id"] == by_code["02"]["id"]
    assert by_code["04"]["position"] == 4  # dopo 01, 02, "Senza codice"

    # padre inesistente e ciclo: righe in errore, il resto passa
    csv3 = "codice;nome;padre\n01;Strutture;01.02\n05;Nuova;99\n"
    r = _import(client, pid, csv3.encode("utf-8"), "wbs.csv")
    rows = r.json()["rows"]
    assert "ciclo" in rows[0]["error"] and "non trovato" in rows[1]["error"] and r.json()["created"] == 0

    # solo manager
    assert _import(client, pid, xlsx, "wbs.xlsx").status_code == 200
    r = client.post(f"/projects/{pid}/wbs/import", headers=users["field"]["headers"],
                    files={"file": ("wbs.xlsx", xlsx, "application/octet-stream")})
    assert r.status_code == 403


def test_wbs_import_csv_levels_and_headerless(client, project):
    pid = project["project"]["id"]
    csv_levels = "\ufeffLivello,Codice,Descrizione\n1,A,Alfa\n2,A1,Alfa uno\n3,A1a,Alfa uno a\n2,A2,Alfa due\n1,B,Beta\n"
    r = _import(client, pid, csv_levels.encode("utf-8"), "livelli.csv")
    assert r.status_code == 200, r.text
    by_code = {n["code"]: n for n in client.get(f"/projects/{pid}/wbs").json()}
    assert by_code["A1"]["parent_id"] == by_code["A"]["id"]
    assert by_code["A1a"]["parent_id"] == by_code["A1"]["id"]
    assert by_code["A2"]["parent_id"] == by_code["A"]["id"] and by_code["B"]["parent_id"] is None

    # senza intestazione: prima colonna codice, seconda nome
    other = client.post("/projects", json={"name": "Cantiere C"}).json()
    r = _import(client, other["id"], "10;Dieci\n10-1;Dieci uno\n".encode("cp1252"), "x.csv")
    assert r.status_code == 200, r.text
    by_code = {n["code"]: n for n in client.get(f"/projects/{other['id']}/wbs").json()}
    assert by_code["10-1"]["parent_id"] == by_code["10"]["id"]

    assert _import(client, pid, b"", "vuoto.csv").status_code == 422
    assert _import(client, pid, b"PK\x03\x04garbage", "rotto.xlsx").status_code == 422
