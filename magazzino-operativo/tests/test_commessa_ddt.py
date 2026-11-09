# "><(((º> sabusabu <º)))><"
"""Carichi dal Lettore DDT nel cantiere con il codice del registro della suite.

Prima l'importazione usava come commessa il nome della cartella del Lettore DDT ("demo-augusta"),
che non combacia con InCampo, SkyTower e il portale (registro shared/suite/commesse.json, es.
101-003). Qui: codice scritto sulla riga dal Lettore DDT, cartella ricondotta al registro, cantieri
vecchi allineati senza doppioni né movimenti duplicati, commessa sconosciuta segnalata.
Il registro è finto (monkeypatch su suite_link.commesse): i test non leggono quello vero."""
import json
import os

import pytest

import config
import importa_ddt

REGISTRO = [{"code": "101-003", "nome": "Sede Acireale"}, {"code": "101-003-BIS", "nome": "Variante"},
            {"code": "C-2024-015", "nome": "Scuola Via Roma"}]
TOKEN = {"X-Suite-Token": "token-di-prova", "X-Suite-Utente": "mrossi", "X-Suite-Nome": "Mario Rossi"}


@pytest.fixture
def registro(monkeypatch):
    """Registro della suite finto; la lista si può cambiare dentro il test (registro[:] = [...])."""
    lista = list(REGISTRO)
    monkeypatch.setattr(importa_ddt.suite_link, "commesse", lambda **k: list(lista))
    return lista


def riga(**kw):
    base = {"commessa": "demo-augusta", "export": "e.json", "fornitore": "Cave Etna S.r.l.", "piva": "02988140873",
            "ddt": "118", "data": "03/03/2026", "dataIso": "2026-03-03", "materiale": "Misto stabilizzato",
            "quantita": 14, "um": "m³", "destinazione": "", "targa": ""}
    base.update(kw)
    return base


def scrivi_consegne(cartella, blocchi):
    """data/<cartella>/consegne.json come lo scrive il Lettore DDT: blocchi = {export: (salvatoIl, righe)}."""
    d = os.path.join(config.DDT_DATA_DIR, cartella)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "consegne.json"), "w", encoding="utf-8") as f:
        json.dump({"versione": 1, "perExport": {k: {"salvatoIl": s, "righe": r} for k, (s, r) in blocchi.items()}}, f)


@pytest.fixture
def ddt_vuoto():
    """Cartella dati del Lettore DDT vuota a ogni test (è condivisa da tutta la sessione dei test)."""
    import shutil
    shutil.rmtree(config.DDT_DATA_DIR, ignore_errors=True)
    os.makedirs(config.DDT_DATA_DIR)
    yield config.DDT_DATA_DIR
    shutil.rmtree(config.DDT_DATA_DIR, ignore_errors=True)


def cantieri(conn):
    return [(r["nome"], r["commessa"]) for r in conn.execute(
        "SELECT nome, commessa FROM ubicazioni WHERE tipo = 'cantiere' ORDER BY id")]


def test_codice_registro_uguale_contenuto_e_confini(registro):
    assert importa_ddt.codice_registro(" 101-003 ") == "101-003"
    assert importa_ddt.codice_registro("c-2024-015") == "C-2024-015"            # maiuscole/minuscole
    assert importa_ddt.codice_registro("101-003 SEDE ACIREALE") == "101-003"    # testo libero dell'admin
    assert importa_ddt.codice_registro("cantiere_101-003-bis") == "101-003-BIS"  # il più lungo vince
    assert importa_ddt.codice_registro("101-0031") == ""                        # non è 101-003
    assert importa_ddt.codice_registro("demo-augusta") == ""
    assert importa_ddt.codice_registro("") == ""
    assert importa_ddt.codice_registro("101-003", registro=[]) == ""


def test_codice_scritto_dal_lettore_ddt_sulla_riga(conn, registro):
    importa_ddt.importa_righe(conn, [riga(codiceCommessa="101-003 SEDE")], "demo-augusta", "e.json")
    assert cantieri(conn) == [("Cantiere 101-003", "101-003")]
    # la chiave dell'importazione resta la cartella: un nuovo salvataggio sostituisce, non duplica
    m = conn.execute("SELECT chiave_import FROM movimenti").fetchone()
    assert m["chiave_import"] == "demo-augusta/e.json"


def test_cantiere_esistente_con_quel_codice(conn, registro):
    conn.execute("INSERT INTO ubicazioni (codice, nome, tipo, commessa) VALUES ('UBI-00002', 'Sede Acireale', "
                 "'cantiere', '101-003')")
    importa_ddt.importa_righe(conn, [riga(commessa="101-003")], "101-003", "e.json")   # cartella = codice
    assert cantieri(conn) == [("Sede Acireale", "101-003")]


def test_cantiere_vecchio_allineato_senza_doppioni(conn, registro, ddt_vuoto):
    # 1) come prima della correzione: utente DDT senza codice, cartella fuori registro → "Cantiere demo-augusta"
    scrivi_consegne("demo-augusta", {"e.json": ("2026-10-01T00:00:00Z", [riga(), riga(ddt="119", quantita=6)])})
    importa_ddt.importa_cartella(conn)
    assert cantieri(conn) == [("Cantiere demo-augusta", "demo-augusta")]
    assert conn.execute("SELECT COUNT(*) FROM movimenti").fetchone()[0] == 2

    # 2) l'admin imposta il codice sull'utente: il prossimo export lo porta sulle sue righe.
    #    L'export vecchio non cambia (stessa impronta, non si reimporta) ma il cantiere passa al codice.
    scrivi_consegne("demo-augusta", {
        "e.json": ("2026-10-01T00:00:00Z", [riga(), riga(ddt="119", quantita=6)]),
        "f.json": ("2026-10-02T00:00:00Z", [riga(export="f.json", ddt="120", quantita=3, codiceCommessa="101-003")]),
    })
    importa_ddt.importa_cartella(conn)
    assert cantieri(conn) == [("Cantiere 101-003", "101-003")]
    assert conn.execute("SELECT COUNT(*) FROM movimenti").fetchone()[0] == 3
    assert conn.execute("SELECT SUM(quantita) FROM giacenze").fetchone()[0] == 23

    # 3) reimportazione forzata di tutto: stessi movimenti, stesso cantiere
    importa_ddt.importa_cartella(conn, forza=True)
    assert cantieri(conn) == [("Cantiere 101-003", "101-003")]
    assert conn.execute("SELECT COUNT(*) FROM movimenti").fetchone()[0] == 3


def test_cantiere_vecchio_allineato_quando_la_commessa_entra_nel_registro(conn, registro, ddt_vuoto):
    registro[:] = [{"code": "101-003"}]
    cartella = "cantiere-102-001"             # cartella del Lettore DDT che contiene il codice
    scrivi_consegne(cartella, {"e.json": ("2026-10-01T00:00:00Z", [riga(commessa=cartella)])})
    esiti = importa_ddt.importa_cartella(conn)
    assert "non nel registro" in esiti[0]["avviso"] and cartella in esiti[0]["avviso"]
    assert cantieri(conn) == [(f"Cantiere {cartella}", cartella)]
    registro.append({"code": "102-001"})      # il portale aggiunge la commessa al registro
    assert importa_ddt.importa_cartella(conn) == []                       # niente da reimportare...
    assert cantieri(conn) == [("Cantiere 102-001", "102-001")]            # ...ma il cantiere ha il codice
    assert conn.execute("SELECT COUNT(*) FROM movimenti").fetchone()[0] == 1


def test_nome_cantiere_cambiato_a_mano_resta(conn, registro):
    conn.execute("INSERT INTO ubicazioni (codice, nome, tipo, commessa) VALUES ('UBI-00002', 'Augusta porto', "
                 "'cantiere', 'demo-augusta')")
    importa_ddt.importa_righe(conn, [riga(codiceCommessa="101-003")], "demo-augusta", "e.json")
    assert cantieri(conn) == [("Augusta porto", "101-003")]


def test_commessa_sconosciuta_segnalata(conn, registro, ddt_vuoto, client):
    scrivi_consegne("demo-messina", {"e.json": ("2026-10-01T00:00:00Z", [riga(commessa="demo-messina")])})
    esiti = importa_ddt.importa_cartella(conn)
    assert esiti[0]["esito"] == "ok" and "«demo-messina» non nel registro" in esiti[0]["avviso"]
    assert cantieri(conn) == [("Cantiere demo-messina", "demo-messina")]       # come prima: niente si perde
    imp = conn.execute("SELECT dettaglio FROM importazioni ORDER BY id DESC").fetchone()
    assert "non nel registro" in imp["dettaglio"]
    voci = client.get("/api/suite/da-fare?admin=1", headers=TOKEN).get_json()["voci"]
    voce = next(v for v in voci if v["id"] == "ddt-commessa-fuori-registro")
    assert "demo-messina" in voce["titolo"] and voce["testo"].startswith("1 carico:")
    # gli utenti normali non la vedono (è un lavoro da admin, come gli altri avvisi d'importazione)
    assert not any(v["id"] == "ddt-commessa-fuori-registro"
                   for v in client.get("/api/suite/da-fare", headers=TOKEN).get_json()["voci"])


def test_registro_vuoto_nessun_avviso(conn, registro, ddt_vuoto, client):
    registro[:] = []                          # Magazzino usato senza la suite: comportamento di prima
    scrivi_consegne("demo-messina", {"e.json": ("2026-10-01T00:00:00Z", [riga(commessa="demo-messina")])})
    esiti = importa_ddt.importa_cartella(conn)
    assert "avviso" not in esiti[0]
    assert cantieri(conn) == [("Cantiere demo-messina", "demo-messina")]
    voci = client.get("/api/suite/da-fare?admin=1", headers=TOKEN).get_json()["voci"]
    assert not any(v["id"] == "ddt-commessa-fuori-registro" for v in voci)


def test_upload_consegne_json_usa_il_codice(conn, registro):
    parsed = {"versione": 1, "perExport": {
        "vecchio.json": {"salvatoIl": "2026-10-01T00:00:00Z", "righe": [riga(export="vecchio.json")]},
        "nuovo.json": {"salvatoIl": "2026-10-02T00:00:00Z",
                       "righe": [riga(export="nuovo.json", ddt="200", codiceCommessa="C-2024-015")]},
    }}
    importa_ddt.importa_json_caricato(conn, parsed, "consegne.json")
    # anche la riga senza codice (export salvato prima) va nel cantiere della commessa della cartella
    assert cantieri(conn) == [("Cantiere C-2024-015", "C-2024-015")]
    assert conn.execute("SELECT COUNT(*) FROM movimenti").fetchone()[0] == 2
