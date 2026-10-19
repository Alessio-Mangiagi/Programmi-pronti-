# "><(((º> sabusabu <º)))><"
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from tests import ROOT
import claude_json
import moduli

DDT = """EDILFORNITURE SRL
Via dei Mulini 12 - 95100 Catania
Cod. Fisc./P. IVA: IT 01234567897

DOCUMENTO DI TRASPORTO
DDT n. 458/2026            Data documento: 14 marzo 2026

Luogo di destinazione: Cantiere Scuola Via Roma, Palermo
Rif. commessa C-2024-015
Causale del trasporto: VENDITA
Numero colli: 12
Totale documento € 3.480,50
Annotazioni:
Consegna al piano terra
"""


def modulo_esempio():
    return moduli.valida_modulo(json.loads((ROOT / "moduli" / "esempio_ddt.json").read_text(encoding="utf-8")))


def pdf_con_campo(nome_campo):
    """PDF minimo con un campo di testo compilabile (AcroForm), come quelli che arriveranno."""
    oggetti = [
        b"<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [4 0 R] >> >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Annots [4 0 R] >>",
        b"<< /Type /Annot /Subtype /Widget /FT /Tx /T (%s) /Rect [50 700 300 720] /P 3 0 R /F 4 >>" % nome_campo.encode(),
    ]
    out, offs = bytearray(b"%PDF-1.4\n"), []
    for i, o in enumerate(oggetti, 1):
        offs.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (i, o)
    x = len(out)
    out += b"xref\n0 5\n0000000000 65535 f \n" + b"".join(b"%010d 00000 n \n" % o for o in offs)
    out += b"trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % x
    return bytes(out)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.modulo = modulo_esempio()
        self.s = {"MODULI_DIR": str(ROOT / "moduli"), "MODULI_ARCHIVIO": str(self.dir / "archivio"),
                  "MODULI_AI": "conferma", "ANTHROPIC_API_KEY": "chiave-finta"}

    def tearDown(self):
        self.tmp.cleanup()

    def file(self, nome, contenuto):
        p = self.dir / nome
        p.write_bytes(contenuto if isinstance(contenuto, bytes) else contenuto.encode("utf-8"))
        return p


class DefinizioniTest(Base):
    def test_modulo_di_esempio_valido(self):
        self.assertIn("esempio_ddt", moduli.elenco_moduli(self.s))

    def test_modulo_sbagliato_rifiutato(self):
        casi = [
            {"nome": "x", "campi": [{"id": "a"}]},                                   # manca id
            {"id": "x", "nome": "x", "campi": []},                                   # nessun campo
            {"id": "x", "nome": "x", "campi": [{"id": "a"}, {"id": "a"}]},           # id doppio
            {"id": "x", "nome": "x", "campi": [{"id": "a", "tipo": "colore"}]},      # tipo sconosciuto
            {"id": "x", "nome": "x", "campi": [{"id": "a", "tipo": "scelta"}]},      # scelta senza opzioni
            {"id": "x", "nome": "x", "campi": [{"id": "a", "regex": "(["}]},         # regex rotta
            {"id": "x", "nome": "x", "campi": [{"id": "a", "regex": "abc"}]},        # regex senza gruppo
            {"id": "x", "nome": "x", "pdf": "..\\fuori.pdf", "campi": [{"id": "a"}]},  # pdf fuori cartella
            {"id": "../x", "nome": "x", "campi": [{"id": "a"}]},
        ]
        for m in casi:
            with self.assertRaises(moduli.ModuloError, msg=m):
                moduli.valida_modulo(m)


class FormatiTest(unittest.TestCase):
    def n(self, tipo, v, **kw):
        return moduli.normalizza({"tipo": tipo, **kw}, v)

    def test_date(self):
        for v in ("14/03/2026", "14.3.26", "14-03-2026", "2026-03-14", "14 marzo 2026"):
            self.assertEqual(self.n("data", v), "2026-03-14", v)
        for v in ("31/02/2026", "14 brumaio 2026", "domani"):
            with self.assertRaises(moduli.ModuloError):
                self.n("data", v)

    def test_importi(self):
        self.assertEqual(self.n("importo", "€ 3.480,50"), "3480.50")
        self.assertEqual(self.n("importo", "1.250"), "1250.00")
        self.assertEqual(self.n("importo", "1250.5"), "1250.50")
        self.assertEqual(self.n("importo", "1 250,00 EUR"), "1250.00")
        self.assertEqual(moduli.mostra({"tipo": "importo"}, "1234567.5"), "1.234.567,50")
        with self.assertRaises(moduli.ModuloError):
            self.n("importo", "tanti")

    def test_partita_iva_con_controllo(self):
        self.assertEqual(self.n("piva", "IT 01234567897"), "01234567897")
        with self.assertRaises(moduli.ModuloError):
            self.n("piva", "01234567890")  # cifra di controllo sbagliata

    def test_scelta_e_cf(self):
        self.assertEqual(self.n("scelta", "VENDITA merce", opzioni=["Vendita", "Reso"]), "Vendita")
        with self.assertRaises(moduli.ModuloError):
            self.n("scelta", "regalo", opzioni=["Vendita", "Reso"])
        self.assertEqual(self.n("cf", "rssmra80a01h501u"), "RSSMRA80A01H501U")


class CompilazioneTest(Base):
    def test_ddt_letto_senza_ai(self):
        v = moduli.compila_locale(self.modulo, DDT)
        atteso = {"numero": "458/2026", "data": "2026-03-14", "piva_fornitore": "01234567897", "commessa": "C-2024-015",
                  "cantiere": "Cantiere Scuola Via Roma, Palermo", "causale": "Vendita", "colli": "12",
                  "importo": "3480.50", "note": "Consegna al piano terra"}
        self.assertEqual({k: x["valore"] for k, x in v.items()}, atteso)
        self.assertNotIn("fornitore", v)  # e' solo l'intestazione: senza etichetta serve l'AI
        self.assertTrue(all(x["fonte"] == "locale" and not x["nota"] for x in v.values()))

    def test_valori_diversi_segnalati(self):
        v = moduli.compila_locale(self.modulo, "Numero colli: 12\n...\nNumero colli: 14\n")
        self.assertEqual(v["colli"]["valore"], "12")
        self.assertLessEqual(v["colli"]["confidenza"], 0.5)
        self.assertIn("14", v["colli"]["nota"])

    def _ai(self, valori):
        chiamate = []

        def chiedi(s, system, content, schema, **kw):
            chiamate.append((content, schema))
            return {"valori": {k: valori.get(k) for k in schema["properties"]["valori"]["properties"]}, "note": "ok"}, {}
        return chiamate, chiedi

    def test_conferma_non_chiama_claude_senza_richiesta(self):
        chiamate, chiedi = self._ai({})
        esito = moduli.compila(self.s, self.modulo, self.file("d.txt", DDT), chiedi=chiedi)
        self.assertEqual(chiamate, [])
        self.assertTrue(esito["ai_possibile"])
        self.assertIn("fornitore", esito["mancanti"])

    def test_claude_solo_sui_campi_mancanti_e_controllato(self):
        chiamate, chiedi = self._ai({"fornitore": "Edilforniture Srl", "piva_fornitore": "999"})
        esito = moduli.compila(self.s, self.modulo, self.file("d.txt", DDT), usa_ai=True, chiedi=chiedi)
        richiesti = set(chiamate[0][1]["properties"]["valori"]["properties"])
        self.assertEqual(richiesti, {"fornitore"})  # la P.IVA trovata sul PC non viene chiesta (ne' sovrascritta)
        self.assertEqual(esito["valori"]["fornitore"], {"valore": "Edilforniture Srl", "fonte": "ai", "confidenza": 0.7, "nota": ""})
        self.assertEqual(esito["valori"]["piva_fornitore"]["fonte"], "locale")
        self.assertTrue(esito["ai_usata"])

    def test_valore_ai_non_valido_scartato(self):
        _, chiedi = self._ai({"data": "trentadue di marzo"})
        esito = moduli.compila(self.s, self.modulo, self.file("d.txt", "Fornitore: X"), usa_ai=True, chiedi=chiedi)
        self.assertEqual(esito["valori"]["data"]["valore"], "")
        self.assertIn("scartato", esito["valori"]["data"]["nota"])
        self.assertIn("data", esito["mancanti"])

    def test_modalita_no_e_auto(self):
        chiamate, chiedi = self._ai({"fornitore": "X"})
        moduli.compila({**self.s, "MODULI_AI": "no"}, self.modulo, self.file("d.txt", DDT), usa_ai=True, chiedi=chiedi)
        moduli.compila({**self.s, "ANTHROPIC_API_KEY": ""}, self.modulo, self.file("d.txt", DDT), usa_ai=True, chiedi=chiedi)
        self.assertEqual(chiamate, [])
        moduli.compila({**self.s, "MODULI_AI": "auto"}, self.modulo, self.file("d.txt", DDT), chiedi=chiedi)
        self.assertEqual(len(chiamate), 1)

    def test_scansione_va_a_claude_come_documento(self):
        img = self.file("foto.png", b"\x89PNG\r\n\x1a\n" + b"0" * 100)
        chiamate, chiedi = self._ai({"numero": "12"})
        esito = moduli.compila(self.s, self.modulo, img, usa_ai=True, chiedi=chiedi)
        self.assertFalse(esito["leggibile"])
        self.assertEqual(chiamate[0][0][0]["type"], "image")
        self.assertEqual(chiamate[0][0][0]["source"]["media_type"], "image/png")
        pdf = self.file("scheda.pdf", moduli.scheda_pdf("x", [("a", "b")]))
        self.assertEqual(moduli.contenuto_ai(pdf, "")[0]["type"], "document")

    def test_pdf_e_docx(self):
        pdf = self.file("ddt.pdf", moduli.scheda_pdf("DDT", [(r, "") for r in DDT.splitlines() if r.strip()]))
        testo, pagine, leggibile = moduli.testo_documento(pdf)
        self.assertTrue(leggibile)
        self.assertEqual(moduli.compila_locale(self.modulo, testo)["numero"]["valore"], "458/2026")
        docx = self.dir / "ddt.docx"
        w = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        corpo = "".join(f"<w:p><w:r><w:t>{r}</w:t></w:r></w:p>" for r in DDT.replace("&", "&amp;").splitlines())
        with zipfile.ZipFile(docx, "w") as z:
            z.writestr("word/document.xml", f'<w:document xmlns:w="{w}"><w:body>{corpo}</w:body></w:document>')
        testo, _, _ = moduli.testo_documento(docx)
        self.assertEqual(moduli.compila_locale(self.modulo, testo)["importo"]["valore"], "3480.50")

    def test_file_non_ammessi(self):
        for nome, contenuto in (("x.exe", b"MZ"), ("rotto.pdf", b"non sono un pdf"), ("vuoto.docx", b"PK")):
            with self.assertRaises(moduli.ModuloError):
                moduli.testo_documento(self.file(nome, contenuto))


class ArchivioTest(Base):
    def test_bozza_revisione_conferma_e_pdf(self):
        a = moduli.archivio(self.s)
        doc = self.file("d.txt", DDT)
        rec = a.nuovo(self.modulo, doc, moduli.compila(self.s, self.modulo, doc), {"tipo": "caricamento"}, "mario")
        self.assertEqual(rec["stato"], "bozza")
        with self.assertRaises(moduli.ModuloError):  # fornitore obbligatorio ancora vuoto
            a.salva(self.modulo, rec["id"], {}, conferma=True)
        with self.assertRaises(moduli.ModuloError):
            a.salva(self.modulo, rec["id"], {"data": "30/02/2026"})
        rec = a.salva(self.modulo, rec["id"], {"fornitore": "Edilforniture Srl", "numero": "458/2026"}, "anna", conferma=True)
        self.assertEqual(rec["stato"], "confermato")
        self.assertEqual(rec["valori"]["fornitore"]["fonte"], "manuale")
        self.assertEqual(rec["valori"]["numero"]["fonte"], "locale")  # invariato: resta di origine locale
        from pypdf import PdfReader
        testo = PdfReader(str(a.base / rec["id"] / "modulo.pdf")).pages[0].extract_text()
        for atteso in ("Edilforniture Srl", "14/03/2026", "3.480,50", "Ricevimento merce"):
            self.assertIn(atteso, testo)
        with self.assertRaises(moduli.ModuloError):  # confermato = non piu' modificabile
            a.salva(self.modulo, rec["id"], {"fornitore": "Altro"})
        self.assertEqual(a.elenco()[0]["stato"], "confermato")
        self.assertTrue((a.base / rec["id"] / "documento_d.txt").is_file())

    def test_id_non_validi(self):
        a = moduli.archivio(self.s)
        for rid in ("../../etc", "20260101-000000-zzzzzz", ""):
            with self.assertRaises(moduli.ModuloError):
                a.leggi(rid)

    def test_pdf_compilabile_del_modulo(self):
        (self.dir / "ddt.pdf").write_bytes(pdf_con_campo("NumeroDDT"))
        modulo = {**self.modulo, "pdf": "ddt.pdf",
                  "campi": [{**c, "pdf_campo": "NumeroDDT"} if c["id"] == "numero" else c for c in self.modulo["campi"]]}
        rec = {"valori": {"numero": {"valore": "458/2026"}}, "origine": {}, "creato": ""}
        out = self.dir / "out.pdf"
        moduli.genera_pdf(modulo, rec, out, cartella_pdf=self.dir)
        from pypdf import PdfReader
        self.assertEqual(PdfReader(str(out)).get_fields()["NumeroDDT"].get("/V"), "458/2026")


class OriginiTest(Base):
    def test_allegati_posta_senza_file_di_servizio(self):
        base = self.dir / "posta"
        (base / "20260314_101500_abcdef0123").mkdir(parents=True)
        for n in ("ddt.pdf", "daticert.xml", "smime.p7s", "virus.exe", "foto.jpg"):
            (base / "20260314_101500_abcdef0123" / n).write_bytes(b"x")
        nomi = [f["nome"] for f in moduli.allegati_posta({"MAIL_ARCHIVE_DIR": str(base)})]
        self.assertEqual(nomi, ["ddt.pdf", "foto.jpg"])

    def test_cartella(self):
        (self.dir / "a" / "b").mkdir(parents=True)
        for n in ("a/uno.pdf", "a/b/due.docx", "a/~$temp.docx", "a/tre.dwg"):
            (self.dir / n).write_bytes(b"x")
        self.assertEqual([f["rel"] for f in moduli.file_in_cartella(self.dir / "a")], ["uno.pdf", "b/due.docx"])

    def test_cpm_e_alyante_previsti(self):
        self.assertEqual(moduli.SORGENTI["cpm"]["stato"], "da_collegare")
        self.assertEqual(moduli.SORGENTI["alyante"]["stato"], "da_collegare")


PRIMO = """EDILFORNITURE SRL
Ragione sociale: Edilforniture Srl
Sede legale: Via dei Mulini 12, Catania
P. IVA 01234567897
Ordine n. ORD-2026/045      Data documento: 02/04/2026
CIG: 1234567ABC
IBAN conto dedicato: IT60 X054 2811 1010 0000 0123 456
Istituto di credito: Banca di Prova
Persone delegate: Mario Rossi (RSSMRA80A01H501U)
"""
# secondo documento dello stesso fornitore: niente IBAN ne' delegati, un altro ordine
SECONDO = """Edilforniture Srl - P.IVA 01234567897
Ordine n. ORD-2026/051    Data documento: 20/04/2026
CIG: 9876543XYZ
"""
ALTRO_IBAN = SECONDO + "IBAN: IT42L1234512345123456789012\n"


class FornitoriTest(Base):
    def setUp(self):
        super().setUp()
        self.mod = moduli.carica_modulo(self.s, "esempio_tracciabilita")
        self.arch = moduli.archivio(self.s)

    def compila(self, testo, nome="d.txt", **kw):
        return moduli.compila(self.s, self.mod, self.file(nome, testo), anagrafica=self.arch.anagrafica, **kw)

    def conferma(self, testo, modifiche=None, **kw):
        esito = self.compila(testo)
        rec = self.arch.nuovo(self.mod, self.dir / "d.txt", esito, {"tipo": "caricamento"})
        return self.arch.salva(self.mod, rec["id"], modifiche or {}, "anna", conferma=True, **kw)

    def test_definizione_e_iban(self):
        self.assertEqual(moduli.normalizza({"tipo": "iban"}, "it60 x054 2811 1010 0000 0123 456"), "IT60X0542811101000000123456")
        self.assertEqual(moduli.mostra({"tipo": "iban"}, "IT60X0542811101000000123456"), "IT60 X054 2811 1010 0000 0123 456")
        for sbagliato in ("IT61X0542811101000000123456", "IT60X05428111010000001234", "XX"):
            with self.assertRaises(moduli.ModuloError):
                moduli.normalizza({"tipo": "iban"}, sbagliato)
        base = {"id": "x", "nome": "x"}
        for m in ({**base, "campi": [{"id": "a", "ambito": "cantiere"}]},
                  {**base, "campi": [{"id": "a", "ambito": "fisso"}]},                  # fisso senza valore
                  {**base, "campi": [{"id": "a", "ambito": "fornitore"}]},              # manca chiave_fornitore
                  {**base, "campi": [{"id": "a"}], "chiave_fornitore": "b"},
                  {**base, "campi": [{"id": "a"}], "sezioni": [{"titolo": "Art. 1", "testo": "IBAN {iban}"}]}):
            with self.assertRaises(moduli.ModuloError, msg=m):
                moduli.valida_modulo(m)

    def test_primo_documento_registra_il_fornitore(self):
        rec = self.conferma(PRIMO)
        self.assertEqual(rec["fornitore"], "01234567897")
        scheda = self.arch.anagrafica.leggi("01234567897")
        self.assertEqual(scheda["nome"], "Edilforniture Srl")
        self.assertEqual(scheda["valori"]["iban_dedicato"], "IT60X0542811101000000123456")
        self.assertNotIn("cig", scheda["valori"])  # dato del singolo documento, non del fornitore
        self.assertNotIn("committente", scheda["valori"])

    def test_documenti_successivi_si_autocompilano(self):
        self.conferma(PRIMO)
        esito = self.compila(SECONDO)
        v = esito["valori"]
        self.assertTrue(esito["fornitore"]["registrato"])
        self.assertEqual(v["iban_dedicato"]["fonte"], "anagrafica")
        self.assertEqual(v["delegati"]["valore"], "Mario Rossi (RSSMRA80A01H501U)")
        self.assertEqual(v["riferimento_contratto"]["valore"], "ORD-2026/051")  # del documento, non dell'anagrafica
        self.assertEqual(v["cig"]["valore"], "9876543XYZ")
        self.assertEqual(v["committente"], {"valore": "Cosedil S.p.A.", "fonte": "fisso", "confidenza": 1.0, "nota": ""})
        self.assertEqual(esito["mancanti"], ["cup"])

    def test_altro_fornitore_non_eredita_niente(self):
        self.conferma(PRIMO)
        esito = self.compila("Ditta: Altra Srl\nP. IVA 12345678903\n")
        self.assertFalse(esito["fornitore"]["registrato"])
        self.assertNotIn("iban_dedicato", esito["valori"])

    def test_iban_diverso_nel_documento_non_sostituisce_il_registrato(self):
        self.conferma(PRIMO)
        chiamate = []
        esito = self.compila(ALTRO_IBAN, usa_ai=True, chiedi=lambda *a, **k: chiamate.append(a) or ({"valori": {}, "note": ""}, {}))
        iban = esito["valori"]["iban_dedicato"]
        self.assertEqual(iban["valore"], "IT60X0542811101000000123456")
        self.assertIn("ATTENZIONE", iban["nota"])
        self.assertIn("IT42 L123", iban["nota"])
        richiesti = set(chiamate[0][3]["properties"]["valori"]["properties"]) if chiamate else set()
        self.assertNotIn("iban_dedicato", richiesti)  # i dati registrati non vengono chiesti a Claude

    def test_cambiare_dati_registrati_richiede_conferma_esplicita(self):
        self.conferma(PRIMO)
        nuovo_iban = {"iban_dedicato": "IT42L1234512345123456789012"}
        with self.assertRaises(moduli.ModuloError) as e:
            self.conferma(SECONDO, nuovo_iban)
        self.assertIn("iban_dedicato", str(e.exception))
        self.assertEqual(self.arch.anagrafica.leggi("01234567897")["valori"]["iban_dedicato"], "IT60X0542811101000000123456")
        self.conferma(SECONDO, nuovo_iban, aggiorna_anagrafica=True)
        scheda = self.arch.anagrafica.leggi("01234567897")
        self.assertEqual(scheda["valori"]["iban_dedicato"], "IT42L1234512345123456789012")
        ultimo = scheda["storico"][-1]
        self.assertEqual((ultimo["campo"], ultimo["prima"], ultimo["utente"]), ("iban_dedicato", "IT60X0542811101000000123456", "anna"))

    def test_campi_fissi_non_modificabili(self):
        rec = self.conferma(PRIMO, {"committente": "Altra impresa"})
        self.assertEqual(rec["valori"]["committente"]["valore"], "Cosedil S.p.A.")

    def test_pdf_con_art1_e_dati_del_fornitore(self):
        rec = self.conferma(PRIMO)
        from pypdf import PdfReader
        testo = " ".join(p.extract_text() for p in PdfReader(str(self.arch.base / rec["id"] / "modulo.pdf")).pages)
        testo = " ".join(testo.split())
        for atteso in ("Art. 1 - Obblighi di tracciabilita' finanziaria", "Tra Cosedil S.p.A. e il fornitore Edilforniture Srl",
                       "IT60 X054 2811 1010 0000 0123 456", "CIG 1234567ABC", "CUP " + moduli.VUOTO):
            self.assertIn(atteso, testo)

    def test_chiave_fornitore_non_valida(self):
        self.assertIsNone(self.arch.anagrafica.leggi("../../etc"))
        with self.assertRaises(moduli.ModuloError):
            self.arch.anagrafica.registra("../x", "", {})


class ClaudeJsonTest(unittest.TestCase):
    def risposta(self, body, ok=True):
        r = mock.Mock(ok=ok, status_code=200 if ok else 400)
        r.json.return_value = body
        return r

    def test_uscita_strutturata_senza_tool_choice(self):
        body = {"stop_reason": "end_turn", "content": [{"type": "text", "text": '{"a": 1}'}], "usage": {}}
        with mock.patch.object(claude_json.requests, "post", return_value=self.risposta(body)) as post:
            dati, _ = claude_json.chiedi_json({"ANTHROPIC_API_KEY": "k"}, "sys", "ciao", {"type": "object"})
        self.assertEqual(dati, {"a": 1})
        args, kw = post.call_args
        self.assertEqual(args[0], "https://api.anthropic.com/v1/messages")
        self.assertNotIn("tool_choice", kw["json"])
        self.assertEqual(kw["json"]["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(kw["json"]["model"], "claude-opus-5-5")
        self.assertEqual(kw["json"]["fallbacks"], "default")

    def test_rifiuto_e_troncamento(self):
        for stop in ("refusal", "max_tokens"):
            body = {"stop_reason": stop, "content": [], "usage": {}}
            with mock.patch.object(claude_json.requests, "post", return_value=self.risposta(body)):
                with self.assertRaises(claude_json.AiError):
                    claude_json.chiedi_json({"ANTHROPIC_API_KEY": "k"}, "s", "c", {})

    def test_senza_chiave(self):
        with self.assertRaises(claude_json.AiError):
            claude_json.chiedi_json({}, "s", "c", {})


if __name__ == "__main__":
    unittest.main()
