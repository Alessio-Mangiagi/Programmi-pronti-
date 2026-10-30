# "><(((º> sabusabu <º)))><"
import tempfile
import unittest
import zipfile
from pathlib import Path

from tests import ROOT  # noqa: F401
import modelli_doc as md
import modelli_protetti as mp
from tests.test_modelli_protetti import crea_docx

# .docx come lo scrive LibreOffice: nessuna area, testo diviso in run
CORPO = (
    '<w:p><w:r><w:t>CONTRATTO DI NOLO</w:t></w:r></w:p>'
    '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">IBAN: ____ e </w:t></w:r>'
    '<w:r><w:t>fine &amp; firma</w:t></w:r></w:p>'
    '<w:p><w:r><w:t>Art. 2 - OGGETTO</w:t></w:r></w:p>'
    '<w:p><w:r><w:t>Le prestazioni riguardano ____</w:t></w:r></w:p>'
    '<w:p><w:r><w:t>Clausola fissa</w:t></w:r></w:p>'
)


class FintoDoc:
    """Quello che DocWord legge da un .doc: testo (con \\r a fine paragrafo e codici di campo) e aree."""

    def __init__(self, testo, aree):
        self.testo, self._aree = testo, aree

    def aree(self):
        return self._aree

    def inizi_storie(self):
        return [0]


class ModelliDocTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_norm_toglie_codici_di_campo(self):
        self.assertEqual(md.norm('pec \x13 HYPERLINK "mailto:a@b.it" \x14a@b.it\x15 fine\r\x07'), "pec a@b.it fine")
        self.assertEqual(md.norm("\x13 PAGE \x141\x15 / \x13 NUMPAGES \x145\x15"), "1 / 5")

    def test_aree_rimesse_nel_docx(self):
        testo = "CONTRATTO DI NOLO\rIBAN: ____ e fine & firma\rArt. 2 - OGGETTO\rLe prestazioni riguardano ____\rClausola fissa\r"
        i = testo.index("____")  # area dentro un run: il run va diviso
        j = testo.index("Le prestazioni")  # area su un paragrafo intero
        doc = FintoDoc(testo, [(i, i + 4), (j, testo.index("\rClausola"))])
        src = crea_docx(self.dir / "lo.docx", CORPO, protezione="")
        with zipfile.ZipFile(src) as z:
            infos = z.infolist()
            dati = {x.filename: z.read(x) for x in infos}
        parti = {"word/document.xml": dati["word/document.xml"].decode()}
        esiti, piatti = md.trova_aree(doc, parti)
        self.assertEqual([len(e["posti"]) for e in esiti], [1, 1])
        parti = md.metti_aree(parti, esiti, piatti)
        out = self.dir / "aree.docx"
        with zipfile.ZipFile(out, "w") as z:
            for x in infos:
                data = parti.get(x.filename, "").encode() or dati[x.filename]
                if x.filename == "word/settings.xml":
                    data = md.proteggi(data.decode()).encode()
                z.writestr(x, data)
        info = mp.leggi_aree(out)
        self.assertEqual(info["protezione"], "readOnly")
        self.assertEqual([a["testo"] for a in info["aree"]], ["____", "Le prestazioni riguardano ____"])
        # il run diviso tiene la sua formattazione e il resto del documento e' lo stesso
        xml = parti["word/document.xml"]
        self.assertIn('<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">____</w:t>', xml)
        self.assertEqual(md.piatto(xml)[0], md.piatto(dati["word/document.xml"].decode())[0])
        # compilazione: cambia solo l'area
        mp.compila_file(out, self.dir / "compilato.docx", {info["aree"][0]["id"]: "IT60X0542811101000000123456"})
        testo_finale = md.piatto(zipfile.ZipFile(self.dir / "compilato.docx").read("word/document.xml").decode())[0]
        self.assertIn("IBAN: IT60X0542811101000000123456 e fine & firma", testo_finale)

    def test_area_ambigua_non_si_indovina(self):
        # due paragrafi identici e un contesto che nel .docx non c'e': l'area non viene messa a caso
        testo = "Santa Venerina lì __/__/2023\rSanta Venerina lì __/__/2023\r"
        corpo = "".join(f"<w:p><w:r><w:t>{r}</w:t></w:r></w:p>" for r in testo.split("\r")[:2])
        src = crea_docx(self.dir / "amb.docx", corpo, protezione="")
        parti = {"word/document.xml": zipfile.ZipFile(src).read("word/document.xml").decode()}
        doc = FintoDoc("ALTRO TESTO\r" + testo, [(12, 12 + 28)])
        esiti, _ = md.trova_aree(doc, parti)
        self.assertEqual(esiti[0]["posti"], [])

    def test_non_doc(self):
        p = self.dir / "falso.doc"
        p.write_bytes(b"non e' un documento")
        with self.assertRaises(md.DocError):
            md.DocWord(p)


if __name__ == "__main__":
    unittest.main()
