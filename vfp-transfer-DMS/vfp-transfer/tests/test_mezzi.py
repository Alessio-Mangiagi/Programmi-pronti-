# "><(((º> sabusabu <º)))><"
import csv
import json
import os
import re
import stat
import tempfile
import unittest
from pathlib import Path

from tests import ROOT
import mezzi
import modelli_protetti as mp
import vfp_transfer as vt
from tests.test_modelli_protetti import crea_docx

IBAN = "IT60X0542811101000000123456"
IBAN_NUOVO = "IT42L1234512345123456789012"
# come nei format veri: le aree gialle contengono il testo con i buchi ___ da riempire
CORPO = (
    '<w:p><w:r><w:t>Art. 2 - OGGETTO</w:t></w:r></w:p>'
    '<w:permStart w:id="1" w:edGrp="everyone"/><w:p><w:r><w:t xml:space="preserve">Le prestazioni oggetto del presente '
    'Contratto riguardano _________________________ </w:t></w:r></w:p><w:permEnd w:id="1"/>'
    '<w:permStart w:id="2" w:edGrp="everyone"/><w:p><w:r><w:t>ISTITUTO DI CREDITO: ___________</w:t></w:r></w:p>'
    '<w:p><w:r><w:t>IBAN: _______________________________</w:t></w:r></w:p><w:permEnd w:id="2"/>'
    '<w:p><w:r><w:t xml:space="preserve">Matricola </w:t></w:r><w:permStart w:id="3" w:edGrp="everyone"/>'
    '<w:r><w:t>{{matricola}}</w:t></w:r><w:permEnd w:id="3"/></w:p>'
    '<w:p><w:r><w:t>Clausola fissa</w:t></w:r></w:p>'
    '<w:permStart w:id="4" w:edGrp="everyone"/><w:p><w:r><w:t>Area senza regola</w:t></w:r></w:p><w:permEnd w:id="4"/>'
)


class FintoSeedDms:
    """SeedDMS restapi in memoria (cartella 5 = cartella dei mezzi), con la stessa forma delle risposte vere."""

    def __init__(self):
        self.headers = {}
        self.cartelle = {1: {"name": "DMS", "padre": None}, 5: {"name": "Archivio", "padre": 1}}
        self.documenti = {}
        self.prossimo = 100
        self.logout = False

    class _R:
        def __init__(self, stato, body):
            self.status_code, self._body = stato, body

        def json(self):
            return self._body

    def catena(self, doc_id):
        f, out = self.documenti[doc_id]["padre"], []
        while f != 5:
            out.insert(0, f)
            f = self.cartelle[f]["padre"]
        return out

    def request(self, metodo, url, timeout=None, allow_redirects=True, data=None, files=None):
        path = url.split("/restapi/index.php", 1)[1]
        ok = lambda d=None, stato=200: self._R(stato, {"success": True, "message": "", "data": d})  # noqa: E731
        if path == "/login":
            return ok()
        if path == "/logout":
            self.logout = True
            return ok()
        m = re.fullmatch(r"/folder/(\d+)/children", path)
        if m:
            fid = int(m[1])
            figli = [{"type": "folder", "id": k, "name": v["name"]} for k, v in self.cartelle.items() if v["padre"] == fid]
            figli += [{"type": "document", "id": k, "name": v["name"]} for k, v in self.documenti.items() if v["padre"] == fid]
            return ok(figli)
        m = re.fullmatch(r"/folder/(\d+)/folder", path)
        if m:
            self.prossimo += 1
            self.cartelle[self.prossimo] = {"name": data["name"], "padre": int(m[1])}
            return ok({"id": self.prossimo}, 201)
        m = re.fullmatch(r"/folder/(\d+)/document", path)
        if m:
            self.prossimo += 1
            self.documenti[self.prossimo] = {**data, "padre": int(m[1]), "versioni": [files["file"][1].read()]}
            return ok({"version": 1}, 201)
        m = re.fullmatch(r"/document/(\d+)/update", path)
        if m:
            doc, contenuto = self.documenti[int(m[1])], files["file"][1].read()
            if contenuto == doc["versioni"][-1]:
                return self._R(400, {"success": False, "message": "Uploaded file identical to last version", "data": ""})
            doc["versioni"].append(contenuto)
            return ok({"version": len(doc["versioni"])})
        return self._R(404, {"success": False, "message": "non trovato", "data": ""})

    def close(self):
        pass


def dati(**altri):
    return {"ragione_sociale": "Noli Etna S.r.l.", "piva": "01234567897", "sede": "Catania (CT), via Roma 1",
            "rappresentante": "Amministratore Unico Sig. Mario Rossi", "iban_dedicato": IBAN, "banca": "Banca di prova",
            "tipo_mezzo": "Miniescavatore", "marca": "CAT", "modello": "305CR", "matricola": "CAT305-0001",
            "attrezzature": "benna 400", "codice_contratto": "2026_101-006_008", "commessa": "Residenze Acireale",
            "data_contratto": "22/05/2026", "data_inizio": "2026-05-12", "data_fine": "12/08/2026",
            "compenso": "misura", "um": "gg", "prezzo_unitario": "35", "quantita": "30", "oneri_sicurezza": "31,50",
            "tipo_nolo": "a freddo", "pagamento": "30 gg. D.F.F.M.", "utilizzatrice": "COSEDIL S.p.A.",
            "firmatario_utilizzatrice": "Procuratore Speciale Geom. Mario Bianchi", **altri}


class ImportiTest(unittest.TestCase):
    def test_in_lettere_come_nei_contratti(self):
        self.assertEqual(mezzi.in_lettere("1050"), "millecinquanta/00")
        self.assertEqual(mezzi.in_lettere("31.50"), "trentuno/50")
        self.assertEqual(mezzi.in_lettere("3688620.33"), "tremilioniseicentoottantottomilaseicentoventi/33")
        self.assertEqual(mezzi.in_lettere("2003"), "duemilatré/00")
        self.assertEqual(mezzi.in_lettere("3000"), "tremila/00")
        self.assertEqual(mezzi.in_lettere("1001000"), "unmilionemille/00")
        self.assertEqual(mezzi.in_lettere("0.5"), "zero/50")
        with self.assertRaises(mezzi.MezziError):
            mezzi.in_lettere("-1")


class MezziTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        cond = self.dir / "condivisa" / "Mezzi"
        cond.mkdir(parents=True)
        self.modello = crea_docx(cond / "nolo.docx", CORPO)
        os.chmod(self.modello, stat.S_IREAD)
        self.s = {"MODULI_DIR": str(ROOT / "moduli"), "MODULI_ARCHIVIO": str(self.dir / "archivio"),
                  "MODELLI_SORGENTE": str(self.dir / "condivisa"), "MODELLI_LAVORO": str(self.dir / "lavoro")}
        self.maschera = mezzi.carica_maschera(self.s)
        self.pr = mezzi.pratiche(self.s)
        self.pdc = self.dir / "dal_pc"
        self.pdc.mkdir()
        (self.pdc / "polizza.pdf").write_bytes(b"%PDF-1.4 polizza\n%%EOF\n")
        (self.pdc / "ce.pdf").write_bytes(b"%PDF-1.4 ce\n%%EOF\n")

    def tearDown(self):
        os.chmod(self.modello, stat.S_IREAD | stat.S_IWRITE)
        self.tmp.cleanup()

    def nuova(self, **altri):
        docs = [{"tipo": "assicurazione", "percorso": str(self.pdc / "polizza.pdf"), "scadenza": "31/12/2026"},
                {"tipo": "ce", "percorso": str(self.pdc / "ce.pdf")}]
        return self.pr.salva(self.maschera, "", dati(**altri), docs, "prova")

    def test_maschera_vera_valida(self):
        ids = {c["id"] for c in self.maschera["campi"]}
        self.assertTrue({"piva", "iban_dedicato", "matricola", "importo"} <= ids)
        self.assertTrue(any(d.get("automatico") == "contratto" for d in self.maschera["dms"]["documenti"]))

    def test_valori_normalizzati_e_importo_calcolato(self):
        valori, errori = mezzi.normalizza_valori(self.maschera, dati())
        self.assertEqual(errori, {})
        self.assertEqual(valori["importo"], "1050.00")
        self.assertEqual(valori["data_inizio"], "2026-05-12")
        self.assertEqual(valori["compenso"], "MISURA")
        _, errori = mezzi.normalizza_valori(self.maschera, dati(piva="01234567890"))
        self.assertIn("piva", errori)
        with self.assertRaises(mezzi.MezziError):
            self.pr.salva(self.maschera, "", dati(piva="01234567890"), [], "prova")

    def test_riempi_parti_facoltative(self):
        valori, _ = mezzi.normalizza_valori(self.maschera, dati(attrezzature=""))
        t = "del {tipo_mezzo}[[ corredato di {attrezzature}]] per € {importo} (euro {importo:lettere}) {targa}"
        self.assertEqual(mezzi.riempi(t, self.maschera, valori, vuoto="?"),
                         "del Miniescavatore per € 1.050,00 (euro millecinquanta/00) ?")

    def test_sostituzioni_dei_buchi(self):
        valori, _ = mezzi.normalizza_valori(self.maschera, dati(cup="C51B2000970006", oneri_proprietaria=""))
        testo, n = mezzi.sostituisci("CUP: ____________\nCIG:____", self.maschera, valori)
        self.assertEqual(testo, "CUP: C51B2000970006\nCIG:____")  # CIG non scritto: il buco resta
        self.assertEqual(n, 1)
        # la scritta di istruzione sparisce se il dato facoltativo e' vuoto
        testo, _ = mezzi.sostituisci("AGGIUNGERE EVENTUALI ULTERIORI ONERI SUBAPPALTATORE", self.maschera, valori)
        self.assertEqual(testo, "")
        # un dato su piu' righe resta nello stesso paragrafo
        valori["delegati"] = "Mario Rossi\nAnna Verdi"
        testo, _ = mezzi.sostituisci("sono: nome: ____cognome: ____data di nascita: __/__/19__ luogo: ___ e C.F. ____",
                                     self.maschera, valori)
        self.assertEqual(testo, "sono: Mario Rossi; Anna Verdi")
        self.assertTrue(mezzi._rx("all'intervento ____").search("all’intervento _________"))

    def test_pratica_documenti_e_anagrafica(self):
        rec = self.nuova()
        d = self.pr.base / rec["id"] / "documenti"
        self.assertEqual(sorted(x["tipo"] for x in rec["documenti"]), ["assicurazione", "ce"])
        self.assertEqual(len(list(d.iterdir())), 2)
        self.assertEqual(rec["documenti"][0]["scadenza"], "2026-12-31")
        # la ditta e' registrata: la seconda volta basta la partita IVA
        ditta = self.pr.fornitore("IT 01234567897")
        self.assertTrue(ditta["registrato"])
        self.assertEqual(ditta["valori"]["iban_dedicato"], IBAN)
        # un IBAN diverso non sostituisce quello registrato senza conferma esplicita
        with self.assertRaisesRegex(mezzi.MezziError, "^ANAGRAFICA"):
            self.pr.salva(self.maschera, rec["id"], dati(iban_dedicato=IBAN_NUOVO), [], "prova")
        self.assertEqual(self.pr.fornitore("01234567897")["valori"]["iban_dedicato"], IBAN)
        # togliendo un documento dalla maschera si toglie anche la sua copia
        tenuto = [{"tipo": "ce", "file": next(x["file"] for x in rec["documenti"] if x["tipo"] == "ce")}]
        rec = self.pr.salva(self.maschera, rec["id"], dati(iban_dedicato=IBAN_NUOVO), tenuto, "prova",
                            aggiorna_anagrafica=True)
        self.assertEqual([x["tipo"] for x in rec["documenti"]], ["ce"])
        self.assertEqual(len(list(d.iterdir())), 1)
        scheda = json.loads((self.pr.anagrafica.base / "01234567897.json").read_text(encoding="utf-8"))
        self.assertEqual(scheda["valori"]["iban_dedicato"], IBAN_NUOVO)
        self.assertEqual(scheda["storico"][-1]["prima"], IBAN)

    def test_file_non_ammesso(self):
        (self.pdc / "virus.exe").write_bytes(b"MZ")
        with self.assertRaisesRegex(mezzi.MezziError, "formato"):
            self.pr.salva(self.maschera, "", dati(), [{"tipo": "ce", "percorso": str(self.pdc / "virus.exe")}], "prova")
        with self.assertRaisesRegex(mezzi.MezziError, "non previsto"):
            self.pr.salva(self.maschera, "", dati(), [{"tipo": "contratto", "percorso": str(self.pdc / "ce.pdf")}], "prova")

    def test_contratto_solo_aree_gialle(self):
        rec = self.nuova()
        info = mezzi.anteprima_contratto(self.s, self.maschera, rec, "Mezzi/nolo.docx")
        aree = {a["id"]: a for a in info["aree"]}
        self.assertEqual(aree["1"]["nuovo"], "Le prestazioni oggetto del presente Contratto riguardano il nolo a freddo "
                                             "del mezzo Miniescavatore CAT 305CR, matricola CAT305-0001, corredato di benna 400 ")
        self.assertEqual(aree["2"]["nuovo"], "ISTITUTO DI CREDITO: Banca di prova\nIBAN: IT60 X054 2811 1010 0000 0123 456")
        self.assertEqual(aree["3"]["nuovo"], "CAT305-0001")  # {{matricola}} scritto nel modello
        self.assertIsNone(aree["4"]["nuovo"])
        testi = {k: a["nuovo"] for k, a in aree.items() if a["nuovo"] is not None}
        rec = mezzi.compila_contratto(self.s, self.pr, rec["id"], "Mezzi/nolo.docx", testi, "prova")
        compilato = Path(rec["contratto"]["file"])
        dopo = {a["id"]: a["testo"] for a in mp.leggi_aree(compilato)["aree"]}
        self.assertEqual(dopo["2"], "ISTITUTO DI CREDITO: Banca di prova\nIBAN: IT60 X054 2811 1010 0000 0123 456")
        self.assertEqual(dopo["4"], "Area senza regola")
        self.assertEqual(rec["contratto"]["aree"], 3)
        # ricompilando si riusa la stessa copia di lavoro
        pratica = rec["contratto"]["pratica"]
        rec = mezzi.compila_contratto(self.s, self.pr, rec["id"], "Mezzi/nolo.docx", {"2": "Banca\nIBAN corretto"}, "prova")
        self.assertEqual(rec["contratto"]["pratica"], pratica)
        with self.assertRaisesRegex(mezzi.MezziError, "inesistenti"):
            mezzi.compila_contratto(self.s, self.pr, rec["id"], "Mezzi/nolo.docx", {"99": "x"}, "prova")

    def test_manifest_per_viewpoint(self):
        rec = self.nuova(targa="AB123CD")
        mezzi.compila_contratto(self.s, self.pr, rec["id"], "Mezzi/nolo.docx", {"3": "CAT305-0001"}, "prova")
        cartella, manifest, righe = mezzi.prepara_caricamento(self.s, self.maschera, self.pr, rec["id"])
        self.assertTrue((cartella / "scheda_mezzo.pdf").read_bytes().startswith(b"%PDF"))
        items = list(vt.items_from_manifest(manifest, cartella, "1"))
        self.assertEqual(len(items), 4)  # contratto, scheda, polizza, CE
        self.assertEqual({i.folder for i in items}, {("Mezzi", "Residenze Acireale", "Miniescavatore CAT 305CR - CAT305-0001")})
        nomi = {i.name: i for i in items}
        polizza = nomi["Polizza assicurativa RCT - CAT 305CR CAT305-0001"]
        self.assertTrue(polizza.description.startswith("Scadenza 31/12/2026 - Miniescavatore CAT 305CR"))
        self.assertIn("targa AB123CD", polizza.description)
        self.assertIn("Contratto di nolo - CAT 305CR CAT305-0001", nomi)
        for i in items:
            self.assertEqual(vt.file_sha256(i.file), i.sha256)
        with open(manifest, newline="", encoding="utf-8-sig") as f:
            self.assertEqual(next(csv.reader(f, delimiter=";"))[:3], ["file", "folder", "name"])
        # una copia cambiata dopo il salvataggio non parte
        copia = cartella / "documenti" / next(x["file"] for x in self.pr.leggi(rec["id"])["documenti"] if x["tipo"] == "ce")
        copia.write_bytes(b"altro")
        with self.assertRaisesRegex(mezzi.MezziError, "cambiata"):
            mezzi.prepara_caricamento(self.s, self.maschera, self.pr, rec["id"])

    def test_dati_obbligatori_prima_del_caricamento(self):
        rec = self.pr.salva(self.maschera, "", dati(matricola=""), [], "prova")
        self.assertIn("Matricola / n. di serie", rec["mancanti"])
        with self.assertRaisesRegex(mezzi.MezziError, "Matricola"):
            mezzi.prepara_caricamento(self.s, self.maschera, self.pr, rec["id"])
        self.assertIn("Polizza assicurativa RCT", mezzi.documenti_mancanti(self.maschera, rec))

    def test_archiviazione_nel_dms(self):
        rec = self.nuova()
        mezzi.compila_contratto(self.s, self.pr, rec["id"], "Mezzi/nolo.docx", {"3": "CAT305-0001"}, "prova")
        seed = FintoSeedDms()
        s = {**self.s, "DMS_URL": "http://127.0.0.1:8780/restapi/index.php", "DMS_USER": "mezzi", "DMS_PASSWORD": "x",
             "DMS_MEZZI_CARTELLA": "5"}
        rec = mezzi.archivia_nel_dms(s, self.maschera, self.pr, rec["id"], sessione=seed)
        esiti = rec["dms"]["esiti"]
        self.assertEqual([e["esito"] for e in esiti], ["creato"] * 4)  # contratto, scheda, polizza, CE
        # struttura sotto la cartella dei mezzi (id 5), mai fuori
        percorso = [seed.cartelle[f]["name"] for f in seed.catena(esiti[0]["id"])]
        self.assertEqual(percorso, ["Mezzi", "Residenze Acireale", "Miniescavatore CAT 305CR - CAT305-0001"])
        polizza = next(d for d in seed.documenti.values() if d["name"].startswith("Polizza"))
        self.assertEqual(polizza["expdate"], "2026-12-31")
        self.assertTrue(polizza["comment"].startswith("Scadenza 31/12/2026"))
        # seconda volta, cambiata la targa: la scheda diventa una nuova versione, gli altri file sono gia' presenti
        rec = self.pr.salva(self.maschera, rec["id"], dati(targa="ZZ999ZZ"),
                            [{"tipo": x["tipo"], "file": x["file"], "scadenza": x["scadenza"]} for x in rec["documenti"]], "prova")
        rec = mezzi.archivia_nel_dms(s, self.maschera, self.pr, rec["id"], sessione=seed)
        self.assertEqual(sorted(e["esito"] for e in rec["dms"]["esiti"]), ["gia' presente"] * 3 + ["nuova versione"])
        self.assertEqual(len(seed.documenti), 4)
        self.assertTrue(seed.logout)
        self.assertEqual(self.pr.elenco()[0]["archiviato"], rec["dms"]["data"])

    def test_scrittura_dms_limitata(self):
        dms = mezzi.ScritturaDms("http://127.0.0.1:8780/restapi/index.php", 5, session=FintoSeedDms())
        with self.assertRaisesRegex(mezzi.MezziError, "non ammessa"):
            dms._chiama("DELETE", "/document/3")
        with self.assertRaisesRegex(mezzi.MezziError, "non ammessa"):
            dms._chiama("PUT", "/users/1/password")
        with self.assertRaisesRegex(mezzi.MezziError, "fuori"):
            dms.archivia(1, "x", self.pdc / "ce.pdf")
        with self.assertRaisesRegex(mezzi.MezziError, "non configurato"):
            mezzi.archivia_nel_dms(self.s, self.maschera, self.pr, self.nuova()["id"])

    def test_documento_dal_browser(self):
        rec = self.nuova()
        arrivo = self.pr.cartella_upload(rec["id"]) / "x.part"
        arrivo.write_bytes(b"%PDF-1.4 libretto\n")
        rec = self.pr.allega(self.maschera, rec["id"], "libretto", "Libretto AB123.pdf", arrivo, "", "prova")
        self.assertEqual(rec["documenti"][-1]["nome_file"], "Libretto AB123.pdf")
        self.assertFalse(arrivo.exists())
        arrivo.write_bytes(b"MZ")
        with self.assertRaisesRegex(mezzi.MezziError, "formato"):
            self.pr.allega(self.maschera, rec["id"], "libretto", "virus.exe", arrivo)
        self.assertFalse(arrivo.exists())  # scartato, non resta nella pratica

    def test_nomi_per_viewpoint(self):
        self.assertEqual(mezzi.nome_vfp('Gru 3/4 "XL": tipo*A?'), "Gru 3-4 -XL- tipo-A")
        self.assertEqual(mezzi.nome_vfp("  ..  "), "senza nome")


if __name__ == "__main__":
    unittest.main()
