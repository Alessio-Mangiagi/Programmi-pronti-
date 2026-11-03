# "><(((º> sabusabu <º)))><"
"""La demo parlante (scripts/crea_demo.py): crea tutto su un DB vuoto, è idempotente, si toglie senza lasciare tracce."""
import os

from app import models
from app import storage as st
from scripts import crea_demo

os.environ.setdefault("SUITE_TOKEN", "token-di-prova")
TOKEN = {"X-Suite-Token": os.environ["SUITE_TOKEN"]}


def _conta(session_factory, model, **filtri):
    with session_factory() as s:
        q = s.query(model)
        for k, v in filtri.items():
            q = q.filter(getattr(model, k) == v)
        return q.count()


def test_demo_crea_idempotente_e_rimuove(client):
    sf = client.session_factory
    esito = crea_demo.crea(client, sf, log=lambda *a: None, skytower=False)
    c = esito["creati"]
    assert c["utenti"] == len(crea_demo.UTENTI) - 1          # l'admin demo nasce prima, nel DB
    assert c["commesse"] == 2 and c["cantieri"] == 4 and c["planimetrie"] == 6
    assert c["modelli"] == 5 and c["pin"] >= 10 and c["moduli"] >= 12 and c["task"] >= 12
    assert c["inviti"] == 2 and c["etichette invito"] == 3 and c["richieste supporto"] == 1

    # tutti gli stati dei task, con qualche scadenza passata
    with sf() as s:
        stati = {t.status.value for t in s.query(models.Task).all()}
        assert stati == {"open", "assigned", "resolved", "verified"}
        assert s.query(models.Task).filter(models.Task.due_date < models.utcnow(), models.Task.status.in_(
            [models.TaskStatus.open, models.TaskStatus.assigned])).count() >= 2
        # foto e firme caricate davvero nello storage
        atts = s.query(models.Attachment).all()
        assert atts and all(a.file_url and st.storage.exists(a.file_url[len("/files/"):]) for a in atts)
        assert {a.file_type for a in atts} == {"photo", "signature"}
        # le planimetrie hanno il file e le dimensioni
        assert all(p.file_url and p.width_px for p in s.query(models.Plan).all())
        # eventi e notifiche generati dalle API vere
        assert s.query(models.Event).count() > 10 and s.query(models.Notification).count() > 0

    # le rotte della suite vedono la demo: riepilogo con task aperti e NC, da fare per l'operaio
    r = client.get("/suite/commesse/101-003/riepilogo", headers=TOKEN)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["commessa"]["name"] == "Sede Acireale" and len(d["cantieri"]) == 2
    assert d["task"] and d["nc"]
    r = client.get("/suite/da-fare", headers={**TOKEN, "X-Suite-Email": crea_demo.OPERAIO})
    assert r.status_code == 200 and r.json()["voci"]
    assert any(v["priorita"] == 1 for v in r.json()["voci"])   # task scaduto

    # login degli utenti demo con la password dichiarata
    r = client.post("/auth/login", json={"email": crea_demo.CAPO, "password": crea_demo.PASSWORD})
    assert r.status_code == 200 and r.json()["user"]["role"] == "field"

    # seconda esecuzione: niente doppioni
    prima = _conta(sf, models.Task), _conta(sf, models.FormSubmission), _conta(sf, models.Pin)
    esito2 = crea_demo.crea(client, sf, log=lambda *a: None, skytower=False)
    assert "commesse" not in esito2["creati"] and "pin" not in esito2["creati"] and "task" not in esito2["creati"]
    assert (_conta(sf, models.Task), _conta(sf, models.FormSubmission), _conta(sf, models.Pin)) == prima

    # rimozione: sparisce la demo, resta l'admin dei test
    n = crea_demo.rimuovi(sf, storage=st.storage, log=lambda *a: None)
    assert n["commesse"] == 2 and n["utenti"] == len(crea_demo.UTENTI) and n["task"] == prima[0]
    for model in (models.Commessa, models.Project, models.Plan, models.Pin, models.Task, models.FormSubmission,
                  models.Attachment, models.WbsNode, models.Event, models.Notification, models.Invite, models.InviteLabel,
                  models.SupportMessage, models.FormTemplate, models.CommessaParam):
        assert _conta(sf, model) == 0, model.__name__
    assert _conta(sf, models.User) == 1 and _conta(sf, models.User, email="admin@test.local") == 1
    assert not list(st.storage.root.rglob("*.png")) and not list(st.storage.root.rglob("*.jpg"))
