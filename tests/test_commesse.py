"""Commesse (raggruppano i cantieri) e parametri personalizzati a scelta multipla."""


def test_params_crud_validation_and_realignment(client, users):
    r = client.post("/commessa-params", json={"name": "Tipologia lavori", "options": ["Edilizia", "Stradale", "Impianti"]})
    assert r.status_code == 201, r.text
    tip = r.json()
    assert tip["multi"] is True and tip["position"] == 1 and tip["used_by"] == 0
    r = client.post("/commessa-params", json={"name": "Procedura", "options": ["Pubblico", "Privato"], "multi": False})
    proc = r.json()
    assert proc["position"] == 2
    # validazioni definizione
    assert client.post("/commessa-params", json={"name": " ", "options": ["a"]}).status_code == 422
    assert client.post("/commessa-params", json={"name": "x", "options": []}).status_code == 422
    assert client.post("/commessa-params", json={"name": "x", "options": ["a", "a"]}).status_code == 422
    assert client.post("/commessa-params", json={"name": "x", "options": ["a", " "]}).status_code == 422
    # solo admin definisce, tutti leggono
    assert client.post("/commessa-params", json={"name": "x", "options": ["a"]}, headers=users["manager"]["headers"]).status_code == 403
    assert [p["name"] for p in client.get("/commessa-params", headers=users["field"]["headers"]).json()] == ["Tipologia lavori", "Procedura"]

    # commessa con valori
    r = client.post("/commesse", json={"code": "C-1", "name": "Scuola", "client": "Comune",
                                       "params": {tip["id"]: ["Edilizia", "Impianti", "Edilizia"], proc["id"]: ["Pubblico"]}})
    assert r.status_code == 201, r.text
    c = r.json()
    assert c["params"] == {tip["id"]: ["Edilizia", "Impianti"], proc["id"]: ["Pubblico"]}   # doppioni tolti
    # valori non validi
    assert client.post("/commesse", json={"code": "C-2", "name": "x", "params": {tip["id"]: ["Ferroviario"]}}).status_code == 422
    assert client.post("/commesse", json={"code": "C-2", "name": "x", "params": {proc["id"]: ["Pubblico", "Privato"]}}).status_code == 422
    assert client.post("/commesse", json={"code": "C-2", "name": "x", "params": {"nope": ["a"]}}).status_code == 422
    assert client.post("/commesse", json={"code": "C-1", "name": "dup"}).status_code == 409
    assert client.get("/commessa-params").json()[0]["used_by"] == 1

    # rinomino un'opzione e passo a scelta singola: i valori delle commesse si riallineano
    r = client.patch(f"/commessa-params/{tip['id']}", json={"options": ["Edilizia civile", "Stradale", "Impianti"], "multi": False})
    assert r.status_code == 200
    c = client.get(f"/commesse/{c['id']}").json()
    assert c["params"][tip["id"]] == ["Impianti"]   # "Edilizia" sparita, una sola tenuta
    # elimino: i valori vanno via da tutte le commesse
    assert client.delete(f"/commessa-params/{proc['id']}").status_code == 204
    assert proc["id"] not in client.get(f"/commesse/{c['id']}").json()["params"]
    assert client.delete(f"/commessa-params/{proc['id']}").status_code == 404
    # audit
    got = [i["action"] for i in client.get("/audit", params={"action": ["param.created", "param.updated", "param.deleted", "commessa.created"]}).json()["items"]]
    assert got == ["param.deleted", "param.updated", "commessa.created", "param.created", "param.created"]


def test_commesse_group_projects_by_access(client, project, users):
    pid = project["project"]["id"]
    c1 = client.post("/commesse", json={"code": "C-A", "name": "Alfa"}).json()
    c2 = client.post("/commesse", json={"code": "C-B", "name": "Beta"}).json()
    # assegno il progetto esistente ad Alfa e creo un cantiere in Beta di cui field non è membro
    r = client.patch(f"/projects/{pid}", json={"commessa_id": c1["id"]})
    assert r.status_code == 200 and r.json()["commessa_id"] == c1["id"]
    p2 = client.post("/projects", json={"name": "Solo ufficio", "commessa_id": c2["id"]}).json()
    assert p2["commessa_id"] == c2["id"]
    assert client.post("/projects", json={"name": "x", "commessa_id": "nope"}).status_code == 404
    assert client.patch(f"/projects/{pid}", json={"commessa_id": "nope"}).status_code == 404

    # admin: tutte, con tutti i cantieri
    lst = {c["code"]: c for c in client.get("/commesse").json()}
    assert [p["name"] for p in lst["C-A"]["projects"]] == ["Cantiere A"]
    assert [p["name"] for p in lst["C-B"]["projects"]] == ["Solo ufficio"]
    # field: solo le commesse dove ha un cantiere
    lst_f = client.get("/commesse", headers=users["field"]["headers"]).json()
    assert [c["code"] for c in lst_f] == ["C-A"]
    assert client.get(f"/commesse/{c2['id']}", headers=users["field"]["headers"]).status_code == 403
    assert client.get(f"/commesse/{c1['id']}", headers=users["field"]["headers"]).status_code == 200
    # manager (non membro di Beta): vede Beta ma senza cantieri
    lst_m = {c["code"]: c for c in client.get("/commesse", headers=users["manager"]["headers"]).json()}
    assert lst_m["C-B"]["projects"] == [] and [p["id"] for p in lst_m["C-A"]["projects"]] == [pid]
    # filtro progetti per commessa / senza commessa
    assert [p["id"] for p in client.get("/projects", params={"commessa_id": c1["id"]}).json()] == [pid]
    assert client.patch(f"/projects/{p2['id']}", json={"commessa_id": ""}).json()["commessa_id"] is None
    assert [p["id"] for p in client.get("/projects", params={"commessa_id": ""}).json()] == [p2["id"]]

    # modifica + archiviazione
    r = client.patch(f"/commesse/{c2['id']}", json={"name": "Beta 2", "client": " Ente ", "code": "C-A"})
    assert r.status_code == 409
    r = client.patch(f"/commesse/{c2['id']}", json={"name": "Beta 2", "client": " Ente ", "archived": True})
    assert r.status_code == 200 and r.json()["client"] == "Ente" and r.json()["archived_at"]
    assert [c["code"] for c in client.get("/commesse").json()] == ["C-A"]
    assert [c["code"] for c in client.get("/commesse", params={"include_archived": True}).json()] == ["C-A", "C-B"]
    assert client.patch(f"/commesse/{c2['id']}", json={"name": " "}).status_code == 422
    assert client.post("/commesse", json={"code": "C-C", "name": "x"}, headers=users["field"]["headers"]).status_code == 403
    assert client.patch(f"/projects/{pid}", json={"name": "Rinominato"}, headers=users["field"]["headers"]).status_code == 403
    assert client.get("/audit", params={"entity_id": pid, "action": ["project.updated"]}).json()["total"] == 1
