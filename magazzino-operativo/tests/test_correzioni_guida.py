# "><(((º> sabusabu <º)))><"
"""Correzioni emerse scrivendo la guida del Magazzino (04/11/2026), verificate qui:
- scheda articolo: i movimenti portano codice, descrizione e unità di misura (prima colonna vuota, "12" senza "pz");
- messaggi per l'utente al posto dei testi tecnici (forza=true, WinError 10061, vincoli SQLite, Pillow, JSON);
- backup automatico del database: copia coerente, rotazione, nessun file a metà, rotte solo per l'admin."""
import json
import os
import sqlite3
from datetime import datetime, timedelta

import pytest

import backup
import config
import importa_ddt
import importa_mezzi
import messaggi


def riga(**kw):
    """Una riga del registro consegne del Lettore DDT (stesso formato di test_magazzino.riga)."""
    base = {"commessa": "demo", "export": "Cava Etna marzo.json", "fornitore": "Cave Etna S.r.l.", "piva": "02988140873",
            "ddt": "118", "data": "03/03/2026", "dataIso": "2026-03-03", "materiale": "Misto stabilizzato",
            "quantita": 14, "um": "m³", "destinazione": "Cantiere Augusta", "targa": "CT884AB"}
    base.update(kw)
    return base


# --------------------------------------------------------------------------- punto 1: scheda articolo

def test_scheda_articolo_movimenti_con_articolo_e_unita(client, conn):
    importa_ddt.importa_righe(conn, [riga()], "demo", "e.json")
    conn.commit()
    d = client.get("/api/scansione?codice=MAG-00001").json
    assert d["tipo"] == "articolo" and d["movimenti"]
    mov = d["movimenti"][0]
    assert mov["um"] == d["articolo"]["um"] == "m³"
    assert mov["codice"] == "MAG-00001" and mov["descrizione"] == d["articolo"]["descrizione"]


# --------------------------------------------------------------------------- punto 2: messaggi per l'utente

def test_giacenza_insufficiente_senza_testi_tecnici(client, conn):
    importa_ddt.importa_righe(conn, [riga()], "demo", "e.json")
    conn.commit()
    giacenza = client.get("/api/scansione?codice=MAG-00001").json["giacenze"][0]
    cantiere = giacenza["ubicazione_id"]
    r = client.post("/api/movimenti", json={"tipo": "scarico", "articolo_id": 1, "quantita": 50, "da_ubicazione_id": cantiere})
    assert r.status_code == 400
    testo = r.json["errore"]
    # "insufficiente" è la parola che la pagina riconosce per chiedere "Registrare comunque?"
    assert "insufficiente" in testo and giacenza["ubicazione"] in testo and "14 m³" in testo and "richiesti 50" in testo
    assert "forza" not in testo
    # chi conferma manda forza=true e il movimento passa
    r = client.post("/api/movimenti", json={"tipo": "scarico", "articolo_id": 1, "quantita": 50, "da_ubicazione_id": cantiere,
                                            "forza": True})
    assert r.status_code == 201


def test_vincolo_del_database_in_italiano(client):
    from app import messaggio_integrita
    assert "codice esterno (EAN)" in messaggio_integrita(sqlite3.IntegrityError("UNIQUE constraint failed: articoli.codice_esterno"))
    assert "non esiste più" in messaggio_integrita(sqlite3.IntegrityError("FOREIGN KEY constraint failed"))
    assert "obbligatorio" in messaggio_integrita(sqlite3.IntegrityError("NOT NULL constraint failed: mezzi.tipo_mezzo"))
    # dal vivo: due articoli con lo stesso EAN
    assert client.post("/api/articoli", json={"descrizione": "Sabbia", "um": "ton", "codice_esterno": "8001234567890"}).status_code == 201
    r = client.post("/api/articoli", json={"descrizione": "Sabbia 2", "um": "ton", "codice_esterno": "8001234567890"})
    if r.status_code == 409:                      # se l'API non controlla prima, decide il vincolo del database
        assert "constraint" not in r.json["errore"] and "UNIQUE" not in r.json["errore"]


def test_messaggi_per_utente():
    assert "non trovato" in messaggi.per_utente(FileNotFoundError(2, "[WinError 2] Impossibile trovare il file"))
    assert "aperto in un altro programma" in messaggi.per_utente(PermissionError(13, "[WinError 32]"))
    assert "non leggibile" in messaggi.per_utente(OSError(10061, "[WinError 10061] connessione rifiutata"))
    try:
        json.loads("")
    except json.JSONDecodeError as e:
        testo = messaggi.per_utente(e)
    assert "JSON" in testo and "Expecting" not in testo
    assert messaggi.per_utente(importa_ddt.ImportError_("JSON senza 'perExport'")) == "JSON senza 'perExport'"


def test_pratica_mezzi_rotta_messaggio_parlante(conn):
    cartella = os.path.join(config.MEZZI_VFP_DIR, "pratica-rotta")
    os.makedirs(cartella, exist_ok=True)
    with open(os.path.join(cartella, "record.json"), "w", encoding="utf-8") as f:
        f.write('{"id": "pratica-rotta", "valori": ')          # file salvato a metà
    try:
        esiti = importa_mezzi.importa_cartella(conn, forza=True)
    finally:
        os.remove(os.path.join(cartella, "record.json"))
        os.rmdir(cartella)
    rotta = next(e for e in esiti if e["pratica"] == "pratica-rotta")
    assert rotta["esito"] == "errore" and "Expecting" not in rotta["dettaglio"] and "JSON" in rotta["dettaglio"]


def test_foto_non_leggibile_messaggio_parlante():
    import foto
    with pytest.raises(foto.FotoError) as e:
        foto._apri(b"questo non e' un'immagine")
    assert "JPG o PNG" in str(e.value) and "BytesIO" not in str(e.value)


def test_app_della_suite_spenta_messaggio_parlante(client, monkeypatch):
    import suite_rotte

    def spenta(app, *a, **k):
        raise suite_rotte.suite_link.SuiteError(app, 503, "InCampo non raggiungibile ([WinError 10061] Impossibile "
                                                           "stabilire la connessione): è spenta? Aprila dal portale.")
    monkeypatch.setattr(suite_rotte.suite_link, "chiama", spenta)
    r = client.get("/api/incampo/commessa/101-003")
    assert r.status_code == 503
    assert "WinError" not in r.json["errore"] and "non risponde" in r.json["errore"] and "portale" in r.json["errore"]


def test_upload_json_rotto_messaggio_parlante(client):
    import io
    r = client.post("/api/importazioni/upload", data={"file": (io.BytesIO(b"{non json"), "rotto.json")},
                    content_type="multipart/form-data")
    assert r.status_code == 400 and "Expecting" not in r.json["errore"] and "Lettore DDT" in r.json["errore"]


# --------------------------------------------------------------------------- punto 4: backup del database

def test_backup_copia_coerente_e_rotazione(conn, tmp_path):
    importa_ddt.importa_righe(conn, [riga()], "demo", "e.json")
    conn.commit()
    cartella = tmp_path / "copie"
    t0 = datetime(2026, 11, 6, 8, 0, 0)
    fatte = [backup.esegui(cartella=str(cartella), tenere=3, adesso=t0 + timedelta(hours=i)) for i in range(5)]
    rimaste = backup.copie(str(cartella))
    # restano le 3 più recenti, dalla più nuova
    assert [c["nome"] for c in rimaste] == [f["nome"] for f in reversed(fatte[2:])]
    # la copia è un database integro con i dati di partenza
    copia = sqlite3.connect(rimaste[0]["percorso"])
    try:
        assert copia.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert copia.execute("SELECT COUNT(*) FROM articoli").fetchone()[0] == 1
        assert copia.execute("SELECT COUNT(*) FROM movimenti").fetchone()[0] == 1
    finally:
        copia.close()            # su Windows un file aperto non si cancella: la rotazione qui sotto lo toglie
    # i file che non sono copie non vengono toccati dalla rotazione
    (cartella / "leggimi.txt").write_text("nota")
    backup.esegui(cartella=str(cartella), tenere=1, adesso=t0 + timedelta(days=1))
    assert (cartella / "leggimi.txt").exists() and len(backup.copie(str(cartella))) == 1


def test_backup_non_riuscito_non_lascia_file_a_meta(conn, tmp_path):
    cartella = tmp_path / "copie"
    backup.esegui(cartella=str(cartella), tenere=5)
    with pytest.raises(sqlite3.Error):
        backup.esegui(db_path=str(tmp_path / "manca" / "nessuno.db"), cartella=str(cartella), tenere=5,
                      adesso=datetime(2030, 1, 1))
    assert len(backup.copie(str(cartella))) == 1                      # la copia buona resta
    assert not [n for n in os.listdir(cartella) if n.endswith(".parziale")]
    assert backup.stato()["ultimo_errore"]


def test_backup_serve_copia(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "BACKUP_DIR", str(tmp_path / "vuota"))
    assert backup.serve_copia(24)                                    # nessuna copia: serve
    backup.esegui(tenere=2)
    assert not backup.serve_copia(24) and backup.serve_copia(0)


def test_rotte_backup_solo_admin(client, monkeypatch, tmp_path):
    import app as modulo_app
    monkeypatch.setattr(config, "BACKUP_DIR", str(tmp_path / "copie"))
    r = client.post("/api/admin/backup")
    assert r.status_code == 200 and r.json["copia"]["nome"].startswith("magazzino-")
    stato = client.get("/api/admin/backup").json
    assert stato["totale_copie"] == 1 and stato["ultima"]["nome"] == r.json["copia"]["nome"]
    assert client.get("/api/admin/attivita?giorni=1&azione=backup").json        # resta nel registro attività
    monkeypatch.setattr(modulo_app, "e_admin", lambda: False)
    assert client.post("/api/admin/backup").status_code == 403
    assert client.get("/api/admin/backup").status_code == 403
