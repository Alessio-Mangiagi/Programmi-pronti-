# "><(((º> sabusabu <º)))><"
import email
import os
import unittest
from email import policy

from tests import FIXTURES
import env_config
import pec
import vfp_mail

RAW = (FIXTURES / "pec_firmata.eml").read_bytes()


def parse(raw):
    return email.message_from_bytes(raw, policy=policy.default)


RICEVUTA = b"""From: posta-certificata@pec-prova.it\r
Subject: AVVENUTA CONSEGNA: 001 - Trasmissione verbale\r
Message-ID: <consegna-1@pec-prova.it>\r
MIME-Version: 1.0\r
Content-Type: multipart/mixed; boundary="R"\r
\r
--R\r
Content-Type: text/plain\r
\r
Ricevuta di avvenuta consegna\r
--R\r
Content-Type: application/xml; name="daticert.xml"\r
Content-Disposition: attachment; filename="daticert.xml"\r
\r
<?xml version="1.0"?><postacert tipo="avvenuta-consegna" errore="nessuno"><intestazione><mittente>cosedil@pec-prova.it</mittente>\r
<destinatari tipo="certificato">ente@pec.it</destinatari><oggetto>001 - Trasmissione verbale</oggetto></intestazione>\r
<dati><gestore-emittente>GESTORE</gestore-emittente><data zona="+0200"><giorno>13/10/2026</giorno><ora>10:00:00</ora></data>\r
<identificativo>id-1</identificativo><msgid>&lt;m1@pec&gt;</msgid><consegna>ente@pec.it</consegna></dati></postacert>\r
--R--\r
"""


class DaticertTest(unittest.TestCase):
    def test_lettura(self):
        info = pec.analyze(RAW, parse(RAW))
        self.assertEqual(info["tipo"], "posta-certificata")
        self.assertFalse(info["ricevuta"])
        self.assertEqual(info["gestore"], "GESTORE PEC DI PROVA")
        self.assertEqual(info["identificativo"], "opec-prova.20261013095830.00001.01.1.1@pec-prova.it")
        self.assertEqual(info["msgid"], "<originale-001@comune-prova.it>")
        self.assertEqual(info["destinatari"], ["cosedil@pec-prova.it"])
        self.assertEqual(info["data"], "13/10/2026 09:58:30 +0200")

    def test_entita_xml_rifiutate(self):
        bomb = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><postacert tipo="&a;"/>'
        self.assertEqual(pec.parse_daticert(bomb), {})
        self.assertEqual(pec.parse_daticert(b"non xml"), {})
        self.assertEqual(pec.parse_daticert(b"<altro/>"), {})

    def test_ricevuta(self):
        info = pec.analyze(RICEVUTA, parse(RICEVUTA))
        self.assertEqual(info["tipo"], "avvenuta-consegna")
        self.assertTrue(info["ricevuta"])
        self.assertEqual(info["consegna"], "ente@pec.it")
        self.assertEqual(info["firma"]["stato"], "assente")
        self.assertEqual(pec.clean_receipt_subject("AVVENUTA CONSEGNA: 001 - x"), "001 - x")

    def test_email_normale_in_casella_pec(self):
        raw = b"From: a@b.it\r\nSubject: ciao\r\nContent-Type: text/plain\r\n\r\ntesto\r\n"
        info = pec.analyze(raw, parse(raw))
        self.assertEqual(info["tipo"], "anomalia")
        self.assertEqual(info["firma"]["stato"], "assente")


@unittest.skipUnless(os.name == "nt", "la verifica della firma usa le funzioni di Windows")
class FirmaTest(unittest.TestCase):
    def test_firma_valida(self):
        firma = pec.analyze(RAW, parse(RAW))["firma"]
        self.assertEqual(firma["stato"], "valida")
        self.assertEqual(firma["firmatario"], "Gestore PEC di Prova")

    def test_busta_modificata(self):
        bad = RAW.replace(b"Messaggio di posta certificata.", b"Messaggio di posta modificato!!")
        self.assertEqual(pec.analyze(bad, parse(bad))["firma"]["stato"], "non valida")

    def test_allegato_sostituito(self):
        bad = RAW.replace(b"In allegato il verbale.", b"In allegato il falso. ")
        self.assertEqual(pec.analyze(bad, parse(bad))["firma"]["stato"], "non valida")


class AllegatiPecTest(unittest.TestCase):
    def test_allegati_presi_dalla_busta(self):
        allowed = set(env_config.DEFAULT_ALLOWED_EXT.split(","))
        atts = vfp_mail.extract_attachments(parse(RAW), True, True, allowed)
        self.assertEqual([a.name for a in atts], ["verbale.pdf"])
        self.assertTrue(atts[0].data.startswith(b"%PDF"))

    def test_ricevuta_senza_allegati(self):
        allowed = set(env_config.DEFAULT_ALLOWED_EXT.split(","))
        self.assertEqual(vfp_mail.extract_attachments(parse(RICEVUTA), True, True, allowed), [])


if __name__ == "__main__":
    unittest.main()
