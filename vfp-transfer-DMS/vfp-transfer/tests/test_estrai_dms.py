# "><(((º> sabusabu <º)))><"
import hashlib
import json
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest import mock

import requests

from tests import ROOT  # noqa: F401  (percorso del programma)
import estrai_dms as ed
import vfp_transfer as vt


class Risposta:
    def __init__(self, status=200, corpo=b"", headers=None, json_data=None):
        self.status_code = status
        self.corpo = corpo
        self.headers = headers or {}
        self._json = json_data
        self.url = "https://dms.example/api/x"
        self.text = corpo.decode("utf-8", "replace")
        self.chiusa = False

    def json(self):
        return self._json

    def iter_content(self, n):
        for i in range(0, len(self.corpo), n):
            yield self.corpo[i:i + n]

    def close(self):
        self.chiusa = True


def client(**kw):
    c = ed.LetturaSicura("https://dms.example/api", richieste_al_secondo=1000, sleep=lambda s: None, **kw)
    c.session = mock.Mock()
    return c


class SolaLetturaTest(unittest.TestCase):
    def test_scritture_bloccate_prima_di_partire(self):
        c = client()
        for metodo, path in [("PUT", "/folder/1/name"), ("DELETE", "/document/3"), ("POST", "/folder/1/document"),
                             ("POST", "/document/3/update"), ("PATCH", "/x")]:
            with self.assertRaises(ed.ScritturaBloccata):
                c.request(metodo, path)
        c.session.request.assert_not_called()

    def test_login_e_letture_ammesse(self):
        c = client()
        c.session.request.return_value = Risposta(json_data={"success": True})
        c.request("POST", "/login", data={})
        c.get("/folder/1")
        self.assertEqual(c.session.request.call_count, 2)

    def test_niente_redirect_seguiti(self):
        c = client()
        c.session.request.return_value = Risposta(302)
        with self.assertRaises(ed.DmsErrore):
            c.get("/folder/1")
        self.assertFalse(c.session.request.call_args.kwargs["allow_redirects"])

    def test_url(self):
        self.assertEqual(ed.controlla_url("https://dms.example/api/"), "https://dms.example/api")
        self.assertEqual(ed.controlla_url("http://127.0.0.1:8780/restapi"), "http://127.0.0.1:8780/restapi")
        for url in ("http://dms.example/api", "ftp://dms.example", "dms.example"):
            with self.assertRaises(ValueError):
                ed.controlla_url(url)


class CaricoTest(unittest.TestCase):
    def test_riprova_su_503_e_rispetta_retry_after(self):
        attese = []
        c = client()
        c._sleep = attese.append
        c.session.request.side_effect = [Risposta(503, headers={"Retry-After": "7"}), Risposta(200, json_data={})]
        c.get("/folder/1")
        self.assertIn(7, attese)
        self.assertEqual(c._errori_di_fila, 0)

    def test_429_rallenta(self):
        c = client()
        prima = c.intervallo
        c.session.request.side_effect = [Risposta(429), Risposta(200)]
        c.get("/folder/1")
        self.assertEqual(c.intervallo, prima * 2)

    def test_si_ferma_dopo_troppi_errori(self):
        c = client(max_errori=3)
        c.session.request.side_effect = requests.ConnectionError("giu'")
        with self.assertRaises(ed.DmsSovraccarico):
            c.get("/folder/1")
        self.assertEqual(c.session.request.call_count, 3)

    def test_errori_4xx_non_ripetuti(self):
        c = client()
        c.session.request.return_value = Risposta(403)
        with self.assertRaises(ed.DmsErrore):
            c.get("/folder/1")
        self.assertEqual(c.session.request.call_count, 1)

    def test_orario_a_cavallo_della_mezzanotte(self):
        o = ed.leggi_orario("20:00-07:00")
        self.assertTrue(ed.in_finestra(o, datetime(2026, 1, 1, 23, 0)))
        self.assertTrue(ed.in_finestra(o, datetime(2026, 1, 1, 6, 59)))
        self.assertFalse(ed.in_finestra(o, datetime(2026, 1, 1, 12, 0)))
        self.assertEqual(ed.secondi_alla_finestra(o, datetime(2026, 1, 1, 19, 0)), 3600)
        for sbagliato in ("20-07", "08:00-08:00", ""):
            with self.assertRaises(ValueError):
                ed.leggi_orario(sbagliato)

    def test_fuori_orario_aspetta(self):
        attese = []
        c = client(orario=ed.leggi_orario("20:00-07:00"), now=lambda: datetime(2026, 1, 1, 19, 30))
        c._sleep = attese.append
        c.session.request.return_value = Risposta(200)
        c.get("/folder/1")
        self.assertEqual(attese[0], 1800)


class SorgenteFinta:
    """Albero: radice 1 -> 'Commessa' (2) -> doc 10 (2 versioni) + 'A/B' (3) -> doc 11; doc 12 nella radice."""

    def __init__(self):
        self.file = {(10, 1): b"prima", (10, 2): b"seconda versione", (11, 1): b"x" * 3000, (12, 1): b"radice"}
        self.dimensioni_sbagliate = set()
        self.download = []

    def figli(self, folder_id):
        return {1: [("folder", 2, "Commessa", ""), ("document", 12, "=SOMMA(A1)", "pericoloso")],
                2: [("document", 10, "PL-001 Pianta", "doc"), ("folder", 3, "A/B", "")],
                3: [("document", 11, "Relazione", "")]}[folder_id]

    def versioni(self, doc_id):
        return [{"versione": v, "commento": f"rev {v}" if doc_id == 10 else "", "nome_file": f"..\\..\\{doc_id}.pdf",
                 "byte": len(c) + (1 if (d, v) in self.dimensioni_sbagliate else 0), "data": "2026-01-01"}
                for (d, v), c in sorted(self.file.items()) if d == doc_id]

    def scarica(self, doc_id, versione):
        self.download.append((doc_id, versione))
        corpo = self.file[(doc_id, versione)]
        return Risposta(200, corpo, {"Content-Length": str(len(corpo))})


class EstrazioneTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dest = Path(self.tmp.name)
        self.src = SorgenteFinta()

    def tearDown(self):
        self.tmp.cleanup()

    def test_estrazione_completa_e_manifest_per_vfp_transfer(self):
        voci = ed.inventario(self.src, 1)
        conti = ed.Estrazione(self.src, self.dest).esegui(voci)
        self.assertEqual(conti, {"scaricato": 4, "presente": 0, "errore": 0})
        items = vt.load_items(self.dest, self.dest / "manifest.csv", "1")
        visti = [(i.folder, i.name, i.revision, i.description) for i in items]
        self.assertIn((("Commessa",), "PL-001 Pianta", "1", "rev 1"), visti)
        self.assertIn((("Commessa",), "PL-001 Pianta", "2", "rev 2"), visti)
        self.assertIn((("Commessa", "A-B"), "Relazione", "1", ""), visti)
        self.assertIn(((), "=SOMMA(A1)", "1", "pericoloso"), visti)  # torna uguale dopo csv_cell/csv_plain
        for i in items:
            self.assertTrue(i.file.is_file())
            self.assertTrue(i.file.resolve().is_relative_to(self.dest.resolve()))  # niente ..\ dal DMS
        stato = json.loads((self.dest / "stato_estrazione.json").read_text(encoding="utf-8"))
        self.assertEqual(stato["scaricati"]["10:2"]["sha256"], hashlib.sha256(b"seconda versione").hexdigest())
        self.assertNotIn("=SOMMA", (self.dest / "manifest.csv").read_text(encoding="utf-8-sig").replace("'=SOMMA", ""))

    def test_ripresa_senza_riscaricare(self):
        voci = ed.inventario(self.src, 1)
        ed.Estrazione(self.src, self.dest).esegui(voci)
        self.src.download.clear()
        self.src.file[(10, 3)] = b"terza"  # nuova versione comparsa nel DMS
        conti = ed.Estrazione(self.src, self.dest).esegui(ed.inventario(self.src, 1))
        self.assertEqual(self.src.download, [(10, 3)])
        self.assertEqual(conti["presente"], 4)

    def test_file_incompleto_scartato_e_non_nel_manifest(self):
        self.src.dimensioni_sbagliate.add((11, 1))
        conti = ed.Estrazione(self.src, self.dest).esegui(ed.inventario(self.src, 1))
        self.assertEqual(conti["errore"], 1)
        self.assertEqual(list(self.dest.rglob("*.part")), [])
        nomi = [i.name for i in vt.load_items(self.dest, self.dest / "manifest.csv", "1")]
        self.assertNotIn("Relazione", nomi)
        self.assertIn("errore", (self.dest / "report_estrazione.csv").read_text(encoding="utf-8-sig"))

    def test_sovraccarico_ferma_tutto_ma_salva_lo_stato(self):
        voci = ed.inventario(self.src, 1)
        originale = self.src.scarica

        def scarica(doc_id, versione):
            if doc_id == 11:
                raise ed.DmsSovraccarico("troppi errori")
            return originale(doc_id, versione)

        self.src.scarica = scarica
        with self.assertRaises(ed.DmsSovraccarico):
            ed.Estrazione(self.src, self.dest).esegui(voci)
        stato = json.loads((self.dest / "stato_estrazione.json").read_text(encoding="utf-8"))
        self.assertTrue(stato["scaricati"])
        self.assertTrue((self.dest / "manifest.csv").exists())

    def test_verifica_trova_file_cambiati_e_vfp_transfer_non_li_carica(self):
        ed.Estrazione(self.src, self.dest).esegui(ed.inventario(self.src, 1))
        stato = json.loads((self.dest / "stato_estrazione.json").read_text(encoding="utf-8"))
        cambiato = self.dest / stato["scaricati"]["10:1"]["file"]
        cambiato.write_bytes(b"PRIMA")  # stessa dimensione, contenuto diverso
        # vfp_transfer legge lo SHA-256 dal manifest e scarta il file anche in prova
        items = vt.load_items(self.dest, self.dest / "manifest.csv", "1")
        eventi = []
        t = vt.Transfer(None, {"target": {"type": "folder", "id": "F"}}, self.dest / "stato_vfp.json", None,
                        dry_run=True, on_event=lambda item, esito, doc, msg: eventi.append((item.file, esito)))
        t.run(items)
        self.assertIn((cambiato, "errore"), eventi)
        # anche la v2 dello stesso documento resta ferma: finirebbe sopra la v1 mancante
        self.assertEqual(sum(1 for _, esito in eventi if esito == "errore"), 2)
        self.assertEqual(sum(1 for _, esito in eventi if esito == "prova"), 2)
        # la verifica lo toglie dallo stato: rilanciando l'estrazione viene riscaricato
        problemi = ed.Estrazione(None, self.dest).verifica()
        self.assertEqual(list(problemi), ["10:1"])
        self.src.download.clear()
        ed.Estrazione(self.src, self.dest).esegui(ed.inventario(self.src, 1))
        self.assertEqual(self.src.download, [(10, 1)])
        self.assertEqual(cambiato.read_bytes(), b"prima")

    def test_stato_modificato_non_porta_fuori_dalla_cartella(self):
        ed.Estrazione(self.src, self.dest).esegui(ed.inventario(self.src, 1))
        path = self.dest / "stato_estrazione.json"
        stato = json.loads(path.read_text(encoding="utf-8"))
        (self.dest / "segreto.dat").write_bytes(b"prima")
        stato["scaricati"]["10:1"]["file"] = "file/../segreto.dat"
        path.write_text(json.dumps(stato), encoding="utf-8")
        e = ed.Estrazione(self.src, self.dest)
        e.scrivi_manifest(ed.inventario(self.src, 1))
        self.assertNotIn("segreto", (self.dest / "manifest.csv").read_text(encoding="utf-8-sig"))
        self.assertIn("10:1", e.verifica())

    def test_download_piu_grande_del_dichiarato_interrotto(self):
        originale = self.src.scarica
        self.src.scarica = lambda d, v: Risposta(200, originale(d, v).corpo + b"altro")
        conti = ed.Estrazione(self.src, self.dest).esegui(ed.inventario(self.src, 1))
        self.assertEqual(conti["errore"], 4)
        self.assertEqual(list(self.dest.rglob("*.part")), [])

    def test_cartelle_circolari_lette_una_volta(self):
        figli = self.src.figli
        self.src.figli = lambda f: figli(f) + ([("folder", 1, "Indietro", "")] if f == 3 else [])
        voci = ed.inventario(self.src, 1)
        self.assertEqual(len(voci), 4)

    def test_nome_sicuro(self):
        self.assertEqual(ed.nome_sicuro("..\\..\\Windows\\evil.pdf"), "evil.pdf")
        self.assertEqual(ed.nome_sicuro("CON.pdf"), "_CON.pdf")
        self.assertEqual(ed.nome_sicuro('a:b*c?.dwg'), "a_b_c_.dwg")
        self.assertEqual(ed.nome_sicuro("", "doc"), "doc")


if __name__ == "__main__":
    unittest.main()


# --------------------------------------------------------------------------- SkyTower (CDE della suite)

class FintoSkyTower:
    """Le rotte /suite di SkyTower in memoria: due commesse, un documento pubblicato ciascuna."""

    def __init__(self):
        self.chiamate = []
        self.docs = {"101-003": [{"id": "d1", "identifier": "PRJ-COS-ZZ-01-DR-A-0001", "title": "Pianta piano terra",
                                  "revision_id": "r1", "revision_code": "C01", "state": "PUBLISHED", "filename": "pianta.pdf",
                                  "size_bytes": 8, "updated_at": "2026-11-02T10:00:00"}],
                     "102-001": [{"id": "d2", "identifier": "PRJ-COS-ZZ-ZZ-RP-Z-0001", "title": "Report", "revision_id": "r2",
                                  "revision_code": "C01", "state": "PUBLISHED", "filename": "report.pdf", "size_bytes": 5,
                                  "updated_at": "2026-11-01T10:00:00"}]}
        self.file = {"r1": b"%PDF-1.4", "r2": b"%PDF-"}

    def chiama(self, app, metodo, percorso, parametri=None, grezzo=False, **kw):
        self.chiamate.append((app, metodo, percorso, parametri))
        assert app == "skytower" and metodo == "GET"
        if percorso == "/suite/commesse":
            return [{"id": "p1", "code": "PRJ", "name": "Porto di Augusta", "commessa": "101-003"},
                    {"id": "p2", "code": "SCU", "name": "Scuola Messina", "commessa": "102-001"}]
        if percorso.startswith("/suite/commesse/"):
            from urllib.parse import unquote
            codice = unquote(percorso.split("/")[3])
            return {"commessa": codice, "items": self.docs[codice]}
        if percorso.startswith("/suite/revisioni/"):
            return self.file[percorso.split("/")[3]], "application/pdf"
        raise AssertionError(percorso)


class SkyTowerTest(unittest.TestCase):
    def setUp(self):
        import suite_cosedil
        self.finto = FintoSkyTower()
        self.p = mock.patch.object(suite_cosedil.suite_link, "chiama", self.finto.chiama)
        self.p.start()
        self.tmp = tempfile.TemporaryDirectory()

    def tearDown(self):
        self.p.stop()
        self.tmp.cleanup()

    def test_inventario_ed_estrazione(self):
        sorgente = ed.SorgenteSkyTower(utente="mrossi")
        sorgente.login("x", "y")  # nessuna credenziale: non chiama niente
        self.assertEqual(sorgente.cartella(1)["name"], "SkyTower")
        cartelle = sorgente.figli(1)
        self.assertEqual([c[2] for c in cartelle], ["101-003 Porto di Augusta", "102-001 Scuola Messina"])
        self.assertTrue(all(c[0] == "folder" and isinstance(c[1], int) and c[1] > 1 for c in cartelle))
        voci = ed.inventario(sorgente, 1)
        self.assertEqual([(v.cartella, v.nome, v.versione, v.byte) for v in voci],
                         [(("101-003 Porto di Augusta",), "PRJ-COS-ZZ-01-DR-A-0001", 1, 8),
                          (("102-001 Scuola Messina",), "PRJ-COS-ZZ-ZZ-RP-Z-0001", 1, 5)])
        # gli id sono stabili: una seconda istanza li ricalcola uguali (stato_estrazione e percorsi su disco)
        self.assertEqual([v.doc_id for v in ed.inventario(ed.SorgenteSkyTower(), 1)], [v.doc_id for v in voci])
        conti = ed.Estrazione(sorgente, self.tmp.name).esegui(voci)
        self.assertEqual(conti, {"scaricato": 2, "presente": 0, "errore": 0})
        pianta = Path(self.tmp.name) / "file" / str(voci[0].doc_id) / "v1" / "pianta.pdf"
        self.assertEqual(pianta.read_bytes(), b"%PDF-1.4")
        righe = (Path(self.tmp.name) / "manifest.csv").read_text(encoding="utf-8-sig").splitlines()
        self.assertEqual(len(righe), 3)
        self.assertIn("101-003 Porto di Augusta", righe[1])
        self.assertEqual(self.finto.chiamate[-1][2], "/suite/revisioni/r2/file")
        # commesse con spazi: il codice viaggia codificato nel percorso
        self.finto.docs["C 01"] = []
        sorgente2 = ed.SorgenteSkyTower()
        sorgente2._commesse = {77: {"code": "C 01", "name": "X"}}
        self.assertEqual(sorgente2.figli(77), [])
        self.assertEqual(self.finto.chiamate[-1][2], "/suite/commesse/C%2001/documenti")

    def test_documento_diretto_e_errori(self):
        import moduli
        _, http, sorgente = moduli._dms({"DMS_TIPO": "skytower"}, utente="mrossi")
        self.assertIs(http, sorgente)
        doc_id = ed.inventario(ed.SorgenteSkyTower(), 1)[1].doc_id
        # istanza nuova, senza aver letto le cartelle: trova il documento da solo (moduli.dms_scarica)
        self.assertEqual(sorgente.versioni(doc_id)[0]["nome_file"], "report.pdf")
        p = moduli.dms_scarica({"DMS_TIPO": "skytower"}, doc_id, self.tmp.name)
        self.assertEqual(p.read_bytes(), b"%PDF-")
        with self.assertRaisesRegex(ed.DmsErrore, "non trovato"):
            sorgente.versioni(123)
        with self.assertRaisesRegex(ed.DmsErrore, "non trovata"):
            sorgente.figli(2)
        import suite_cosedil

        def giu(*a, **k):
            raise suite_cosedil.suite_link.SuiteError("skytower", 503, "SkyTower non raggiungibile")
        with mock.patch.object(suite_cosedil.suite_link, "chiama", giu):
            with self.assertRaisesRegex(ed.DmsErrore, "non raggiungibile"):
                ed.SorgenteSkyTower().figli(1)
