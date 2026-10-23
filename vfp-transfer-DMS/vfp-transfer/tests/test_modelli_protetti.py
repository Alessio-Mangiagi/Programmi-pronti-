# "><(((º> sabusabu <º)))><"
import hashlib
import json
import os
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path

import modelli_protetti as mp

W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
PROTEZIONE = '<w:documentProtection w:edit="readOnly" w:enforcement="1"/>'
CORPO = (
    '<w:p><w:r><w:t>CONTRATTO DI TRASPORTO</w:t></w:r></w:p>'
    # area dentro il paragrafo, testo diviso in due run con formattazioni diverse
    '<w:p><w:r><w:t xml:space="preserve">Data: </w:t></w:r><w:permStart w:id="10" w:edGrp="everyone"/>'
    '<w:r><w:rPr><w:b/></w:rPr><w:t>11/03/</w:t></w:r><w:r><w:t>2026</w:t></w:r><w:permEnd w:id="10"/>'
    '<w:r><w:t xml:space="preserve"> fine riga</w:t></w:r></w:p>'
    # area su due paragrafi
    '<w:permStart w:id="20" w:edGrp="everyone"/><w:p><w:r><w:t>IBAN: ____</w:t></w:r></w:p>'
    '<w:p><w:r><w:t>Banca: ____</w:t></w:r></w:p><w:permEnd w:id="20"/>'
    # area vuota dentro un paragrafo
    '<w:p><w:r><w:t xml:space="preserve">Vettore: </w:t></w:r><w:permStart w:id="30" w:edGrp="everyone"/>'
    '<w:permEnd w:id="30"/></w:p>'
    '<w:p><w:r><w:t>Clausola fissa &amp; non modificabile</w:t></w:r></w:p>'
)


def crea_docx(path, corpo=CORPO, protezione=PROTEZIONE):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr("word/document.xml", f'<?xml version="1.0"?><w:document {W}><w:body>{corpo}</w:body></w:document>')
        z.writestr("word/settings.xml", f'<?xml version="1.0"?><w:settings {W}>{protezione}</w:settings>')
        z.writestr("word/styles.xml", "<w:styles/>")
    return path


class ModelliProtettiTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.cond = self.dir / "condivisa" / "Trasporti"
        self.cond.mkdir(parents=True)
        self.modello = crea_docx(self.cond / "contratto.docx")
        os.chmod(self.modello, stat.S_IREAD)  # la cartella condivisa e' in sola lettura

    def tearDown(self):
        os.chmod(self.modello, stat.S_IREAD | stat.S_IWRITE)
        self.tmp.cleanup()

    def settings(self):
        return {"MODELLI_SORGENTE": str(self.dir / "condivisa"), "MODELLI_LAVORO": str(self.dir / "lavoro")}

    def test_aree(self):
        info = mp.leggi_aree(self.modello)
        self.assertEqual(info["protezione"], "readOnly")
        aree = {a["id"]: a for a in info["aree"]}
        self.assertEqual(list(aree), ["10", "20", "30"])
        self.assertEqual(aree["10"]["testo"], "11/03/2026")
        self.assertEqual(aree["10"]["prima"], "CONTRATTO DI TRASPORTO Data:")
        self.assertEqual(aree["20"]["testo"], "IBAN: ____\nBanca: ____")
        self.assertEqual(aree["20"]["paragrafi"], 2)
        self.assertEqual(aree["30"]["testo"], "")

    def test_protezione_non_attiva(self):
        senza = crea_docx(self.dir / "libero.docx", protezione="")
        self.assertEqual(mp.leggi_aree(senza)["protezione"], "")

    def test_compila_solo_aree(self):
        out = self.dir / "out.docx"
        cambiate = mp.compila_file(self.modello, out, {
            "10": "23/10/2026", "20": [["____", "IT60X0542811101000000123456"]], "30": "Trasporti Rossi & C."})
        self.assertEqual(sorted(cambiate), ["10", "20", "30"])
        aree = {a["id"]: a["testo"] for a in mp.leggi_aree(out)["aree"]}
        self.assertEqual(aree["10"], "23/10/2026")
        self.assertEqual(aree["20"], "IBAN: IT60X0542811101000000123456\nBanca: IT60X0542811101000000123456")
        self.assertEqual(aree["30"], "Trasporti Rossi & C.")
        with zipfile.ZipFile(self.modello) as a, zipfile.ZipFile(out) as b:
            self.assertEqual([i.filename for i in a.infolist()], [i.filename for i in b.infolist()])
            for n in ("[Content_Types].xml", "word/settings.xml", "word/styles.xml"):
                self.assertEqual(a.read(n), b.read(n))
            prima, dopo = a.read("word/document.xml").decode(), b.read("word/document.xml").decode()
        self.assertEqual(mp._testo_fuori(prima), mp._testo_fuori(dopo))
        self.assertIn("Clausola fissa &amp; non modificabile", dopo)
        self.assertIn("Trasporti Rossi &amp; C.", dopo)

    def test_minima_differenza_conserva_formattazione(self):
        out = self.dir / "out.docx"
        mp.compila_file(self.modello, out, {"10": "11/03/2027"})
        with zipfile.ZipFile(out) as z:
            xml = z.read("word/document.xml").decode()
        self.assertIn("<w:b/></w:rPr><w:t>11/03/</w:t>", xml)  # run in grassetto non toccato
        self.assertIn('<w:t xml:space="preserve">2027</w:t>', xml)

    def test_righe_diverse_dai_paragrafi(self):
        with self.assertRaisesRegex(mp.ModelloError, "2 paragrafi"):
            mp.compila_file(self.modello, self.dir / "out.docx", {"20": "una riga sola"})
        self.assertFalse((self.dir / "out.docx").exists())

    def test_errori(self):
        out = self.dir / "out.docx"
        with self.assertRaisesRegex(mp.ModelloError, "inesistenti"):
            mp.compila_file(self.modello, out, {"99": "x"})
        with self.assertRaisesRegex(mp.ModelloError, "non trovato"):
            mp.compila_file(self.modello, out, {"20": [["assente", "x"]]})
        with self.assertRaisesRegex(mp.ModelloError, "aggiungere paragrafi"):
            mp.compila_file(self.modello, out, {"20": [["____", "a\nb"]]})
        with self.assertRaisesRegex(mp.ModelloError, "originale"):
            mp.compila_file(self.modello, self.modello, {"10": "x"})
        doc = self.dir / "vecchio.doc"
        doc.write_bytes(b"\xd0\xcf\x11\xe0")
        with self.assertRaisesRegex(mp.ModelloError, "salvarlo come .docx"):
            mp.leggi_aree(doc)

    def test_pratica_copia_e_non_scrive_nella_condivisa(self):
        s = self.settings()
        impronta = hashlib.sha256(self.modello.read_bytes()).hexdigest()
        self.assertEqual(mp.elenco_modelli(s), [{"rel": "Trasporti/contratto.docx", "byte": self.modello.stat().st_size,
                                                "gestito": True}])
        pr = mp.pratiche(s)
        rec = pr.nuova(mp.risolvi_modello(s, "Trasporti/contratto.docx"), "mario")
        d = pr.base / rec["id"]
        self.assertEqual(rec["origine"]["sha256"], impronta)
        self.assertTrue((d / "originale_contratto.docx").is_file())
        pr.compila(rec["id"], {"10": "01/01/2027"}, "mario")
        rec = pr.compila(rec["id"], {"30": "Rossi"}, "mario")  # i valori si sommano
        self.assertEqual(sorted(rec["aree_cambiate"]), ["10", "30"])
        aree = {a["id"]: a["testo"] for a in pr.aree(rec["id"])["aree"]}
        self.assertEqual((aree["10"], aree["30"]), ("01/01/2027", "Rossi"))
        self.assertEqual(hashlib.sha256(self.modello.read_bytes()).hexdigest(), impronta)
        self.assertEqual(sorted(p.name for p in self.cond.iterdir()), ["contratto.docx"])
        self.assertEqual(json.loads((d / "record.json").read_text(encoding="utf-8"))["valori"],
                         {"10": "01/01/2027", "30": "Rossi"})
        self.assertEqual(pr.elenco()[0]["aree_cambiate"], 2)

    def test_percorsi(self):
        s = self.settings()
        with self.assertRaisesRegex(mp.ModelloError, "fuori"):
            mp.risolvi_modello(s, "../altro.docx")
        with self.assertRaisesRegex(mp.ModelloError, "dentro la cartella condivisa"):
            mp.Pratiche(self.cond / "lavoro", self.dir / "condivisa")
        with self.assertRaisesRegex(mp.ModelloError, "non impostata"):
            mp.elenco_modelli({})
        with self.assertRaises(mp.ModelloError):
            mp.pratiche(s).leggi("../../x")

    def test_modello_senza_aree(self):
        vuoto = crea_docx(self.cond.parent / "senza.docx", corpo="<w:p><w:r><w:t>tutto bloccato</w:t></w:r></w:p>")
        with self.assertRaisesRegex(mp.ModelloError, "nessuna area"):
            mp.pratiche(self.settings()).nuova(vuoto)


if __name__ == "__main__":
    unittest.main()
