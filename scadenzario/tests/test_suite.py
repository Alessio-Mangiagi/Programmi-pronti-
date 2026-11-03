# "><(((º> sabusabu <º)))><"
"""Scadenze automatiche dalle pratiche mezzi di VFP Transfer e rotta "da fare" per il portale."""
import json
import os
from datetime import date, timedelta

import pytest

import app as modulo_app
import config
import database
import importa_mezzi

TOKEN = {"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "mrossi"}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Database nuovo per ogni test: i conteggi qui sotto devono valere da soli."""
    monkeypatch.setattr(config, "DB_PATH", str(tmp_path / "test.db"))
    database.init_db()
    modulo_app.app.config["TESTING"] = True
    with modulo_app.app.test_client() as c:
        yield c


def _pratica(radice, pid, **extra):
    v = {"tipo_nolo": "a freddo", "commessa": "101-003 SEDE ACIREALE", "data_inizio": "2026-10-23", "data_fine": "2026-12-22",
         "ragione_sociale": "Edil Nolo Esempio S.r.l.", "piva": "09876543217", "rappresentante": "Gino Verdi", "pec": "nolo@pec.it",
         "white_list_dal": "2024-03-15", "white_list_prefettura": "Prefettura di Catania",
         "tipo_mezzo": "Escavatore cingolato", "marca": "Caterpillar", "modello": "320 GC", "matricola": "ESEMP0320GC00001", "targa": ""}
    v.update(extra)
    rec = {"id": pid, "maschera": "mezzi_nolo", "valori": v, "documenti": [
        {"tipo": "assicurazione", "scadenza": "2027-06-27", "nome_file": "ass.pdf"},
        {"tipo": "assicurazione", "scadenza": "2026-06-27", "nome_file": "ass_vecchia.pdf"},   # vince la più recente
        {"tipo": "ce", "scadenza": "", "nome_file": "ce.pdf"},
        {"tipo": "verifiche", "scadenza": "2027-02-27", "nome_file": "ver.pdf"}]}
    d = os.path.join(radice, pid)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "record.json"), "w", encoding="utf-8") as f:
        json.dump(rec, f)
    return rec


@pytest.fixture()
def pratiche(tmp_path, monkeypatch):
    radice = str(tmp_path / "mezzi")
    monkeypatch.setattr(config, "MEZZI_VFP_DIR", radice)
    _pratica(radice, "20261030-155820-aee65a")
    os.makedirs(os.path.join(radice, "senza-record"))
    with open(os.path.join(radice, "rotta.txt"), "w") as f:   # un file sciolto non dà fastidio
        f.write("x")
    return radice


def test_scadenze_della_pratica():
    voci = importa_mezzi.scadenze_della_pratica("p1", {"valori": {"data_fine": "2026-12-22", "ragione_sociale": "Nolo Srl",
                                                                  "white_list_dal": "2024-03-15", "commessa": "101-003"},
                                                       "documenti": [{"tipo": "verifiche", "scadenza": "2027-02-27"},
                                                                     {"tipo": "assicurazione", "scadenza": "non-una-data"}]})
    assert [(v[0], v[1], v[2]) for v in voci] == [("fine_nolo", "2026-12-22", "mezzo"), ("verifiche", "2027-02-27", "mezzo"),
                                                  ("white_list", "2025-03-15", "ditta")]
    assert "commessa 101-003" in voci[0][3] and "pratica p1" in voci[0][3]
    assert importa_mezzi._piu_mesi("2024-01-31", 1) == "2024-02-29"


def test_importa_crea_anagrafiche_e_scadenze_senza_doppioni(client, pratiche):
    r = client.post("/api/scadenze/importa-mezzi")
    assert r.status_code == 200, r.get_json()
    e = r.get_json()
    assert e["pratiche"] == 1 and e["nuove"] == 4 and e["errori"] == []
    scad = client.get("/api/scadenze?includi_chiuse=1").get_json()
    per_rif = {s["documento_rif"]: s for s in scad if (s["documento_rif"] or "").startswith("VFP:")}   # il seed del DB ha altre scadenze
    assert set(per_rif) == {"VFP:20261030-155820-aee65a:fine_nolo", "VFP:20261030-155820-aee65a:assicurazione",
                            "VFP:20261030-155820-aee65a:verifiche", "VFP:ditta:09876543217:white_list"}
    ass = per_rif["VFP:20261030-155820-aee65a:assicurazione"]
    assert ass["data_scadenza"] == "2027-06-27" and ass["soggetto_nome"] == "Escavatore cingolato Caterpillar 320 GC (ESEMP0320GC00001)"
    assert ass["cantiere"] == "101-003 SEDE ACIREALE" and ass["tipo_nome"] == "Assicurazione mezzo a nolo" and "ass.pdf" in ass["note"]
    wl = per_rif["VFP:ditta:09876543217:white_list"]
    assert wl["soggetto_tipo"] == "subappaltatore" and wl["soggetto_nome"] == "Edil Nolo Esempio S.r.l." and wl["data_scadenza"] == "2025-03-15"
    sub = [x for x in client.get("/api/subappaltatori").get_json() if x["partita_iva"] == "09876543217"]
    assert len(sub) == 1 and sub[0]["email"] == "nolo@pec.it"
    attr = [a for a in client.get("/api/attrezzature").get_json() if "[VFP:20261030-155820-aee65a]" in (a["note"] or "")]
    assert len(attr) == 1 and attr[0]["matricola"] == "ESEMP0320GC00001"
    # seconda lettura: niente doppioni, niente anagrafiche nuove
    n_scad, n_attr, n_sub = (len(client.get(u).get_json()) for u in ("/api/scadenze?includi_chiuse=1", "/api/attrezzature", "/api/subappaltatori"))
    e2 = client.post("/api/scadenze/importa-mezzi").get_json()
    assert e2["nuove"] == 0 and e2["invariate"] == 4
    assert (n_scad, n_attr, n_sub) == tuple(len(client.get(u).get_json()) for u in ("/api/scadenze?includi_chiuse=1", "/api/attrezzature", "/api/subappaltatori"))
    # seconda pratica dello stesso noleggiatore: una white list sola, mezzo nuovo
    _pratica(pratiche, "20261031-090000-bb80f3", matricola="PALA0002", tipo_mezzo="Pala gommata")
    e3 = client.post("/api/scadenze/importa-mezzi").get_json()
    assert e3["pratiche"] == 2 and e3["nuove"] == 3 and e3["invariate"] == 5


def test_importa_aggiorna_date_ma_non_riapre_le_chiuse(client, pratiche):
    client.post("/api/scadenze/importa-mezzi")
    scad = {s["documento_rif"]: s for s in client.get("/api/scadenze").get_json()}
    fine = scad["VFP:20261030-155820-aee65a:fine_nolo"]
    r = client.put(f"/api/scadenze/{fine['id']}", json={"chiusa": 1})
    assert r.status_code == 200, r.get_json()
    # proroga del nolo e nuova polizza
    _pratica(pratiche, "20261030-155820-aee65a", data_fine="2027-03-31")
    e = client.post("/api/scadenze/importa-mezzi").get_json()
    assert e["chiuse"] == 1 and e["nuove"] == 0
    tutte = {s["documento_rif"]: s for s in client.get("/api/scadenze?includi_chiuse=1").get_json()}
    assert tutte["VFP:20261030-155820-aee65a:fine_nolo"]["chiusa"] == 1          # chiusa a mano: resta chiusa
    assert tutte["VFP:20261030-155820-aee65a:fine_nolo"]["data_scadenza"] == "2026-12-22"
    # cambia una data su una aperta → aggiornata
    rec = _pratica(pratiche, "20261030-155820-aee65a")
    rec["documenti"][0]["scadenza"] = "2028-01-01"
    with open(os.path.join(pratiche, "20261030-155820-aee65a", "record.json"), "w", encoding="utf-8") as f:
        json.dump(rec, f)
    e = client.post("/api/scadenze/importa-mezzi").get_json()
    assert e["aggiornate"] == 1
    tutte = {s["documento_rif"]: s for s in client.get("/api/scadenze?includi_chiuse=1").get_json()}
    assert tutte["VFP:20261030-155820-aee65a:assicurazione"]["data_scadenza"] == "2028-01-01"


def test_importa_pratica_rotta_segnalata_e_cartella_assente(client, tmp_path, monkeypatch, pratiche):
    with open(os.path.join(pratiche, "20261030-155820-aee65a", "record.json"), "w") as f:
        f.write("{rotto")
    e = client.post("/api/scadenze/importa-mezzi").get_json()
    assert e["pratiche"] == 0 and e["errori"] and e["errori"][0].startswith("20261030-155820-aee65a:")
    monkeypatch.setattr(config, "MEZZI_VFP_DIR", str(tmp_path / "non-esiste"))
    e = client.post("/api/scadenze/importa-mezzi").get_json()
    assert e == {"cartella": str(tmp_path / "non-esiste"), "pratiche": 0, "nuove": 0, "aggiornate": 0, "invariate": 0, "chiuse": 0, "errori": []}


def test_da_fare_richiede_token_e_ordina_per_urgenza(client, pratiche):
    assert client.get("/api/suite/da-fare").status_code == 403
    assert client.get("/api/suite/da-fare", headers={"X-Suite-Token": "sbagliato"}).status_code == 403
    oggi = date.today()
    t = client.post("/api/tipi", json={"nome": "Visita test", "categoria": "visita_medica", "soggetto": "dipendente",
                                      "validita_mesi": 12, "preavviso_giorni": 30}).get_json()
    d = client.post("/api/dipendenti", json={"nome": "Mario", "cognome": "Rossi", "cantiere": "Augusta"}).get_json()
    for giorni in (-3, 2, 20, 200):
        client.post("/api/scadenze", json={"tipo_id": t["id"], "soggetto_tipo": "dipendente", "soggetto_id": d["id"],
                                           "data_scadenza": (oggi + timedelta(days=giorni)).isoformat()})
    chiusa = client.post("/api/scadenze", json={"tipo_id": t["id"], "soggetto_tipo": "dipendente", "soggetto_id": d["id"],
                                                "data_scadenza": (oggi - timedelta(days=1)).isoformat()}).get_json()
    client.put(f"/api/scadenze/{chiusa['id']}", json={"chiusa": 1})
    r = client.get("/api/suite/da-fare", headers=TOKEN)
    assert r.status_code == 200
    tutte = r.get_json()["voci"]
    assert [v["priorita"] for v in tutte] == sorted(v["priorita"] for v in tutte)
    voci = [v for v in tutte if v["titolo"] == "Visita test"]   # il seed del DB ha altre scadenze
    assert len(voci) == 3   # la valida a 200 giorni e la chiusa non ci sono
    assert [v["priorita"] for v in voci] == [1, 2, 3]
    assert voci[0]["testo"] == "Mario Rossi · Augusta · scaduta da 3 giorni" and voci[0]["tipo"] == "scadenza"
    assert voci[0]["url"].startswith("http://localhost:5180/#/scadenze?stato=scaduta&q=Mario%20Rossi")
    assert voci[1]["titolo"] == "Visita test" and "(2 giorni)" in voci[1]["testo"] and voci[1]["data"] == (oggi + timedelta(days=2)).isoformat()
