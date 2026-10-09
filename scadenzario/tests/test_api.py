# "><(((º> sabusabu <º)))><"
"""Test delle API con il client di Flask su un database temporaneo (conftest.py)."""
import io
import zipfile
from datetime import date, timedelta

import pytest

import app as modulo_app
import notifiche


@pytest.fixture()
def client():
    modulo_app.app.config["TESTING"] = True
    with modulo_app.app.test_client() as c:
        yield c


def _tipo(client, nome, soggetto="dipendente", validita=12, preavviso=30):
    r = client.post("/api/tipi", json={"nome": nome, "categoria": "formazione",
                                      "soggetto": soggetto, "validita_mesi": validita,
                                      "preavviso_giorni": preavviso})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def _dipendente(client, nome, cognome, **extra):
    r = client.post("/api/dipendenti", json={"nome": nome, "cognome": cognome, **extra})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


def _scadenza(client, tipo_id, soggetto_id, data_scadenza):
    r = client.post("/api/scadenze", json={"tipo_id": tipo_id, "soggetto_tipo": "dipendente",
                                          "soggetto_id": soggetto_id,
                                          "data_scadenza": data_scadenza})
    assert r.status_code == 201, r.get_json()
    return r.get_json()


# ----- nome del soggetto calcolato in SQL -----

def test_soggetto_dipendente_unisce_nome_e_cognome(client):
    t = _tipo(client, "Test nome soggetto")
    d = _dipendente(client, "Mario", "Rossi", cantiere="Catania")
    s = _scadenza(client, t["id"], d["id"], "2030-01-01")
    assert s["soggetto_nome"] == "Mario Rossi"
    assert s["cantiere"] == "Catania"


def test_soggetto_attrezzatura_mette_la_matricola_fra_parentesi(client):
    tipo = _tipo(client, "Test attrezzatura", soggetto="attrezzatura")
    a = client.post("/api/attrezzature", json={"descrizione": "Gru a torre",
                                               "matricola": "GR-07"}).get_json()
    s = client.post("/api/scadenze", json={"tipo_id": tipo["id"], "soggetto_tipo": "attrezzatura",
                                          "soggetto_id": a["id"],
                                          "data_scadenza": "2030-01-01"}).get_json()
    assert s["soggetto_nome"] == "Gru a torre (GR-07)"


# ----- permessi admin -----

def test_me_con_sso_spento_e_admin(client):
    assert client.get("/api/me").get_json()["admin"] is True


def test_delete_e_area_admin_negati_ai_non_admin(client, monkeypatch):
    monkeypatch.setattr(modulo_app, "e_admin", lambda: False)
    assert client.delete("/api/scadenze/999").status_code == 403
    assert client.get("/api/admin/riepilogo").status_code == 403
    # Le letture restano libere
    assert client.get("/api/scadenze").status_code == 200


def test_admin_riepilogo(client):
    dati = client.get("/api/admin/riepilogo").get_json()
    assert "conteggi" in dati and "scadenze" in dati["conteggi"]


def test_utenze_senza_portale_danno_503(client):
    r = client.get("/api/admin/utenti")
    assert r.status_code == 503


# ----- eliminazioni -----

def test_elimina_dipendente_con_scadenze_bloccato_senza_forza(client):
    t = _tipo(client, "Test forza")
    d = _dipendente(client, "Gino", "Forza")
    _scadenza(client, t["id"], d["id"], "2030-01-01")
    assert client.delete(f"/api/dipendenti/{d['id']}").status_code == 409
    r = client.delete(f"/api/dipendenti/{d['id']}?forza=1")
    assert r.status_code == 200 and r.get_json()["scadenze_eliminate"] == 1


def test_errore_integrita_non_espone_sqlite(client):
    _dipendente(client, "A", "B", codice_fiscale="DUPLCF00A00A000A")
    r = client.post("/api/dipendenti", json={"nome": "C", "cognome": "D",
                                             "codice_fiscale": "DUPLCF00A00A000A"})
    assert r.status_code == 409
    assert "UNIQUE" not in r.get_json()["errore"]


# ----- import scadenze: niente doppioni -----

def test_import_scadenze_salta_i_duplicati(client):
    _tipo(client, "Test import dup")
    _dipendente(client, "Ugo", "Import")
    csv = ("Tipo scadenza (nome esatto);Soggetto;Data scadenza\n"
           "Test import dup;Ugo Import;31/12/2030\n").encode("utf-8")

    def carica():
        return client.post("/api/scadenze/import",
                           data={"file": (io.BytesIO(csv), "s.csv")},
                           content_type="multipart/form-data").get_json()

    primo = carica()
    assert primo["importati"] == 1, primo
    secondo = carica()
    assert secondo["importati"] == 0 and secondo["saltati"] == 1


# ----- notifiche: soggetti disattivati esclusi -----

def test_notifiche_escludono_soggetti_non_attivi(client):
    t = _tipo(client, "Test inattivo", preavviso=60)
    d = _dipendente(client, "Pino", "Inattivo")
    vicina = (date.today() + timedelta(days=5)).isoformat()
    s = _scadenza(client, t["id"], d["id"], vicina)
    ids = {x["id"] for x in notifiche.scadenze_da_notificare()}
    assert s["id"] in ids
    client.put(f"/api/dipendenti/{d['id']}", json={"attivo": 0})
    ids = {x["id"] for x in notifiche.scadenze_da_notificare()}
    assert s["id"] not in ids


def test_esegui_notifiche_registra_ultimo_giro(client):
    esito = notifiche.esegui_notifiche()
    assert "inviate" in esito
    assert notifiche.ultimo_giro() is not None


# ----- export e backup -----

def test_export_ics(client):
    t = _tipo(client, "Test ics")
    d = _dipendente(client, "Ivo", "Calendario")
    _scadenza(client, t["id"], d["id"], "2030-05-04")
    r = client.get("/api/export/scadenze.ics")
    testo = r.get_data(as_text=True)
    assert r.status_code == 200
    assert "BEGIN:VCALENDAR" in testo and "DTSTART;VALUE=DATE:20300504" in testo


def test_backup_zip_contiene_il_db(client):
    r = client.get("/api/admin/backup.zip")
    assert r.status_code == 200
    with zipfile.ZipFile(io.BytesIO(r.data)) as zf:
        assert "scadenzario.db" in zf.namelist()


def test_allegato_troppo_grande_rifiutato(client, monkeypatch):
    monkeypatch.setitem(modulo_app.app.config, "MAX_CONTENT_LENGTH", 1024)
    r = client.post("/api/scadenze/1/allegati",
                    data={"file": (io.BytesIO(b"x" * 4096), "a.pdf")},
                    content_type="multipart/form-data")
    assert r.status_code == 413
