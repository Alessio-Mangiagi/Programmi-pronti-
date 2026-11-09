# "><(((º> sabusabu <º)))><"
"""Test del motore della firma digitale (shared/firma), con un ente certificatore di prova creato al volo.

    shared\\firma\\.venv\\Scripts\\python.exe shared\\firma\\test_firma.py           # tutti i test
    shared\\firma\\.venv\\Scripts\\python.exe shared\\firma\\test_firma.py fixture DIR
        crea in DIR ente.pem, firmato.pdf.p7m, alterato.pdf.p7m, documento.pdf (per i test Node di firma.js)

Niente rete: gli elenchi ufficiali sono sostituiti dal certificato dell'ente di prova (ancore_extra) o da una
Trusted List finta (test degli elenchi). Casi: firma valida (firma digitale), documento alterato, busta annidata,
base64, ente sconosciuto, certificato non qualificato, revocato (CRL), scaduto senza e con marca temporale, marca
che non riguarda la firma, file non firmato, .p7m rotto, client busta.py e riga di comando.
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path

CARTELLA = Path(__file__).resolve().parent
sys.path.insert(0, str(CARTELLA))

from asn1crypto import cms, tsp                                       # noqa: E402
from asn1crypto import x509 as ax509                                  # noqa: E402
from cryptography import x509                                         # noqa: E402
from cryptography.hazmat.primitives import hashes, serialization      # noqa: E402
from cryptography.hazmat.primitives.asymmetric import padding, rsa    # noqa: E402
from cryptography.hazmat.primitives.serialization import pkcs7        # noqa: E402
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID        # noqa: E402

import busta                                                          # noqa: E402
import elenchi_fiduciari                                              # noqa: E402
import firma_digitale                                                 # noqa: E402

PDF = b"%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n"
# QcStatements: QcCompliance (certificato qualificato) + QcSSCD (dispositivo sicuro)
QC_STATEMENTS = bytes.fromhex("3014" "3008" "060604008e460101" "3008" "060604008e460104")
ADESSO = datetime.now(UTC)


def _chiave():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


def _nome(cn, **altro):
    attrs = [x509.NameAttribute(NameOID.COUNTRY_NAME, "IT"), x509.NameAttribute(NameOID.COMMON_NAME, cn)]
    for oid, v in altro.items():
        attrs.append(x509.NameAttribute(getattr(NameOID, oid), v))
    return x509.Name(attrs)


def ente(dal=ADESSO - timedelta(days=3650), al=ADESSO + timedelta(days=3650)):
    """Ente certificatore di prova (radice)."""
    k = _chiave()
    nome = _nome("Ente di Prova CA", ORGANIZATION_NAME="Ente di Prova S.p.A.")
    c = (x509.CertificateBuilder().subject_name(nome).issuer_name(nome).public_key(k.public_key())
         .serial_number(x509.random_serial_number()).not_valid_before(dal).not_valid_after(al)
         .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
         .add_extension(x509.KeyUsage(digital_signature=False, content_commitment=False, key_encipherment=False,
                                      data_encipherment=False, key_agreement=False, key_cert_sign=True,
                                      crl_sign=True, encipher_only=False, decipher_only=False), critical=True)
         .sign(k, hashes.SHA256()))
    return c, k


def titolare(ca, ca_key, *, qualificato=True, dal=ADESSO - timedelta(days=30), al=ADESSO + timedelta(days=700),
             cn="Mario Rossi", tsa=False, crl_url=None):
    """Certificato di firma (o di marcatura temporale, tsa=True) emesso dall'ente di prova."""
    k = _chiave()
    b = (x509.CertificateBuilder()
         .subject_name(_nome(cn, SERIAL_NUMBER="TINIT-RSSMRA80A01H501U", ORGANIZATION_NAME="Prova Costruzioni"))
         .issuer_name(ca.subject).public_key(k.public_key()).serial_number(x509.random_serial_number())
         .not_valid_before(dal).not_valid_after(al)
         .add_extension(x509.KeyUsage(digital_signature=tsa, content_commitment=not tsa, key_encipherment=False,
                                      data_encipherment=False, key_agreement=False, key_cert_sign=False,
                                      crl_sign=False, encipher_only=False, decipher_only=False), critical=True))
    if tsa:
        b = b.add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.TIME_STAMPING]), critical=True)
    if crl_url:                                                         # come i certificati veri: dove sta la CRL
        b = b.add_extension(x509.CRLDistributionPoints([x509.DistributionPoint(
            [x509.UniformResourceIdentifier(crl_url)], None, None, None)]), critical=False)
    if qualificato:
        b = b.add_extension(x509.UnrecognizedExtension(x509.ObjectIdentifier("1.3.6.1.5.5.7.1.3"), QC_STATEMENTS),
                            critical=False)
    return b.sign(ca_key, hashes.SHA256()), k


def p7m(dati, cert, key, extra_certs=()):
    b = pkcs7.PKCS7SignatureBuilder().set_data(dati).add_signer(cert, key, hashes.SHA256())
    for c in extra_certs:
        b = b.add_certificate(c)
    return b.sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.Binary])


def con_marca(busta_der, tsa_cert, tsa_key, quando, imprint=None):
    """Aggiunge alla prima firma una marca temporale (CAdES-T) firmata dall'ente di marcatura di prova."""
    ci = cms.ContentInfo.load(busta_der)
    si = ci["content"]["signer_infos"][0]
    impronta = imprint or hashlib.sha256(si["signature"].native).digest()
    tst = tsp.TSTInfo({"version": "v1", "policy": "1.2.3.4.5",
                       "message_imprint": {"hash_algorithm": {"algorithm": "sha256"}, "hashed_message": impronta},
                       "serial_number": 7, "gen_time": quando})
    attrs = cms.CMSAttributes([
        cms.CMSAttribute({"type": "content_type", "values": ["tst_info"]}),
        cms.CMSAttribute({"type": "message_digest", "values": [hashlib.sha256(tst.dump()).digest()]})])
    firma = tsa_key.sign(attrs.dump(), padding.PKCS1v15(), hashes.SHA256())
    tcert = ax509.Certificate.load(tsa_cert.public_bytes(serialization.Encoding.DER))
    tsi = cms.SignerInfo({
        "version": "v1", "sid": cms.SignerIdentifier({"issuer_and_serial_number": cms.IssuerAndSerialNumber(
            {"issuer": tcert.issuer, "serial_number": tcert.serial_number})}),
        "digest_algorithm": {"algorithm": "sha256"}, "signed_attrs": attrs,
        "signature_algorithm": {"algorithm": "sha256_rsa"}, "signature": firma})
    tsd = cms.SignedData({"version": "v3", "digest_algorithms": [{"algorithm": "sha256"}],
                          "encap_content_info": {"content_type": "tst_info", "content": tst},
                          "certificates": [tcert], "signer_infos": [tsi]})
    token = cms.ContentInfo({"content_type": "signed_data", "content": tsd})
    si["unsigned_attrs"] = cms.CMSAttributes([cms.CMSAttribute({"type": "signature_time_stamp_token", "values": [token]})])
    return ci.dump(force=True)


def asn1(cert):
    return ax509.Certificate.load(cert.public_bytes(serialization.Encoding.DER))


def apri(dati, nome="contratto.pdf.p7m", ancore=(), **kw):
    elenchi = elenchi_fiduciari.Elenchi([], aggiornato="prova", fonte="prova", extra=ancore)
    return firma_digitale.apri(dati, nome, rete=False, elenchi=elenchi, **kw)


class Busta(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ca, cls.ca_key = ente()
        cls.cert, cls.key = titolare(cls.ca, cls.ca_key)
        cls.der = p7m(PDF, cls.cert, cls.key)

    def test_firma_valida_e_documento_estratto(self):
        r = apri(self.der, ancore=[asn1(self.ca)])
        self.assertTrue(r["firmato"])
        self.assertEqual(r["contenuto"], PDF)
        self.assertEqual(r["nome_contenuto"], "contratto.pdf")
        self.assertEqual(r["esito"], "valida", r["firme"])
        f = r["firme"][0]
        self.assertEqual(f["firmatario"], "Mario Rossi")
        self.assertEqual(f["codice_fiscale"], "RSSMRA80A01H501U")
        self.assertEqual(f["ente_certificatore"], "Ente di Prova S.p.A.")
        self.assertEqual(f["tipo"], "firma digitale")
        self.assertTrue(f["integra"] and f["qualificato"] and f["dispositivo_sicuro"] and f["non_ripudio"])
        self.assertIn("Firma valida: Mario Rossi (Ente di Prova S.p.A.)", r["riepilogo"])

    def test_documento_alterato(self):
        alterato = self.der.replace(b"/Catalog", b"/Catalgo")
        r = apri(alterato, ancore=[asn1(self.ca)])
        self.assertEqual(r["esito"], "non valida")
        self.assertFalse(r["firme"][0]["integra"])
        self.assertIn("modificato dopo la firma", r["riepilogo"])

    def test_busta_annidata_e_base64(self):
        secondo, k2 = titolare(self.ca, self.ca_key, cn="Anna Bianchi")
        doppia = p7m(self.der, secondo, k2)
        r = apri(base64.b64encode(doppia), "contratto.pdf.p7m.p7m", ancore=[asn1(self.ca)])
        self.assertEqual(r["livelli"], 2)
        self.assertEqual([f["firmatario"] for f in r["firme"]], ["Anna Bianchi", "Mario Rossi"])
        self.assertEqual(r["contenuto"], PDF)
        self.assertEqual(r["nome_contenuto"], "contratto.pdf")
        self.assertEqual(r["esito"], "valida")

    def test_ente_sconosciuto_e_non_qualificato(self):
        r = apri(self.der)                                              # nessun ente di fiducia
        self.assertEqual(r["esito"], "da verificare")
        self.assertTrue(any("non è fra gli enti" in m or "non disponibili" in m for m in r["firme"][0]["motivi"]))
        semplice, k = titolare(self.ca, self.ca_key, qualificato=False)
        r = apri(p7m(PDF, semplice, k), ancore=[asn1(self.ca)])
        self.assertEqual(r["esito"], "da verificare")
        self.assertEqual(r["firme"][0]["tipo"], "firma elettronica")

    def test_revocato(self):
        cert, key = titolare(self.ca, self.ca_key, crl_url="http://crl.prova.invalid/ente.crl")
        der = p7m(PDF, cert, key)
        # senza rete e senza CRL la revoca non si controlla: "da verificare", mai "valida"
        r = apri(der, ancore=[asn1(self.ca)])
        self.assertEqual(r["esito"], "da verificare", r["firme"][0]["motivi"])
        self.assertIn("revoca", " ".join(r["firme"][0]["motivi"]))
        crl = (x509.CertificateRevocationListBuilder().issuer_name(self.ca.subject)
               .last_update(ADESSO - timedelta(hours=1)).next_update(ADESSO + timedelta(days=7))
               .add_revoked_certificate(x509.RevokedCertificateBuilder().serial_number(cert.serial_number)
                                        .revocation_date(ADESSO - timedelta(days=1)).build())
               .sign(self.ca_key, hashes.SHA256()))
        r = apri(der, ancore=[asn1(self.ca)], crls=[crl.public_bytes(serialization.Encoding.DER)])
        self.assertEqual(r["esito"], "non valida", r["firme"][0]["motivi"])
        self.assertIn("revocato", " ".join(r["firme"][0]["motivi"]))

    def test_scaduto_senza_e_con_marca_temporale(self):
        ca, ca_key = ente(dal=datetime(2019, 1, 1, tzinfo=UTC), al=datetime(2040, 1, 1, tzinfo=UTC))
        vecchio, k = titolare(ca, ca_key, dal=datetime(2020, 1, 1, tzinfo=UTC), al=datetime(2021, 12, 31, tzinfo=UTC))
        der = p7m(PDF, vecchio, k)
        r = apri(der, ancore=[asn1(ca)])
        self.assertEqual(r["esito"], "non valida")
        self.assertIn("scaduto", " ".join(r["firme"][0]["motivi"]))
        tsa, tsa_key = titolare(ca, ca_key, tsa=True, cn="Marca di Prova", dal=datetime(2020, 1, 1, tzinfo=UTC),
                                al=datetime(2035, 1, 1, tzinfo=UTC))
        marcato = con_marca(der, tsa, tsa_key, datetime(2021, 6, 1, 10, 0, tzinfo=UTC))
        r = apri(marcato, ancore=[asn1(ca)])
        f = r["firme"][0]
        self.assertTrue(f["marca_temporale"]["valida"], f["marca_temporale"])
        self.assertEqual(f["data_riferimento"][:10], "2021-06-01")
        self.assertEqual(r["esito"], "valida", f["motivi"])
        self.assertIn("01/06/2021", r["riepilogo"])
        # marca che non riguarda questa firma: non vale, si torna a oggi → scaduto
        falsa = con_marca(der, tsa, tsa_key, datetime(2021, 6, 1, tzinfo=UTC), imprint=b"\x00" * 32)
        r = apri(falsa, ancore=[asn1(ca)])
        self.assertFalse(r["firme"][0]["marca_temporale"]["valida"])
        self.assertEqual(r["esito"], "non valida")

    def test_non_firmato_e_rotto(self):
        r = apri(PDF, "relazione.pdf")
        self.assertFalse(r["firmato"])
        self.assertEqual(r["contenuto"], PDF)
        with self.assertRaises(firma_digitale.FirmaErrore):
            apri(self.der[:200], "rotto.pdf.p7m")
        self.assertTrue(busta.e_busta_firmata(self.der))
        self.assertTrue(busta.e_busta_firmata(base64.b64encode(self.der)))
        self.assertTrue(busta.e_busta_firmata(b"qualsiasi", "x.PDF.P7M"))
        self.assertFalse(busta.e_busta_firmata(PDF, "x.pdf"))

    def test_senza_verifica(self):
        r = apri(self.der, verifica=False)
        self.assertEqual(r["contenuto"], PDF)
        self.assertIsNone(r["esito"])
        self.assertEqual(r["firme"][0]["firmatario"], "Mario Rossi")


class ElenchiFiduciari(unittest.TestCase):
    def test_storia_degli_stati(self):
        ca, _ = ente()
        b64 = base64.b64encode(ca.public_bytes(serialization.Encoding.DER)).decode()
        xml = f"""<TrustServiceStatusList xmlns="http://uri.etsi.org/02231/v2#"><SchemeInformation>
          <SchemeTerritory>IT</SchemeTerritory></SchemeInformation><TrustServiceProviderList><TrustServiceProvider>
          <TSPServices><TSPService><ServiceInformation>
            <ServiceTypeIdentifier>http://uri.etsi.org/TrstSvc/Svctype/CA/QC</ServiceTypeIdentifier>
            <ServiceName><Name xml:lang="it">CA di prova</Name></ServiceName>
            <ServiceDigitalIdentity><DigitalId><X509Certificate>{b64}</X509Certificate></DigitalId></ServiceDigitalIdentity>
            <ServiceStatus>http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/withdrawn</ServiceStatus>
            <StatusStartingTime>2024-01-01T00:00:00Z</StatusStartingTime></ServiceInformation>
            <ServiceHistory><ServiceHistoryInstance>
              <ServiceTypeIdentifier>http://uri.etsi.org/TrstSvc/Svctype/CA/QC</ServiceTypeIdentifier>
              <ServiceStatus>http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/granted</ServiceStatus>
              <StatusStartingTime>2016-07-01T00:00:00Z</StatusStartingTime></ServiceHistoryInstance></ServiceHistory>
          </TSPService>
          <TSPService><ServiceInformation>
            <ServiceTypeIdentifier>http://uri.etsi.org/TrstSvc/Svctype/IdV</ServiceTypeIdentifier>
            <ServiceStatus>http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/granted</ServiceStatus>
            <StatusStartingTime>2016-07-01T00:00:00Z</StatusStartingTime></ServiceInformation></TSPService>
          </TSPServices></TrustServiceProvider></TrustServiceProviderList></TrustServiceStatusList>""".encode()
        servizi = elenchi_fiduciari.leggi_tsl(xml)
        self.assertEqual(len(servizi), 1)                               # il servizio IdV non interessa
        e = elenchi_fiduciari.Elenchi(servizi)
        self.assertEqual(len(e.ancore(datetime(2020, 5, 1, tzinfo=UTC))), 1)   # concesso allora
        self.assertEqual(e.ancore(datetime(2025, 5, 1, tzinfo=UTC)), [])      # ritirato dal 2024
        self.assertEqual(e.ancore(datetime(2020, 5, 1, tzinfo=UTC), marca=True), [])

    def test_lotl(self):
        xml = b"""<TrustServiceStatusList xmlns="http://uri.etsi.org/02231/v2#"><SchemeInformation><PointersToOtherTSL>
          <OtherTSLPointer><TSLLocation>https://esempio.it/TSL-IT.xml</TSLLocation><AdditionalInformation>
          <OtherInformation><MimeType xmlns="http://uri.etsi.org/02231/v2/additionaltypes#">application/vnd.etsi.tsl+xml</MimeType>
          </OtherInformation></AdditionalInformation></OtherTSLPointer>
          <OtherTSLPointer><TSLLocation>https://esempio.it/TSL-IT.pdf</TSLLocation><AdditionalInformation><OtherInformation>
          <MimeType xmlns="http://uri.etsi.org/02231/v2/additionaltypes#">application/pdf</MimeType></OtherInformation>
          </AdditionalInformation></OtherTSLPointer></PointersToOtherTSL></SchemeInformation></TrustServiceStatusList>"""
        self.assertEqual(elenchi_fiduciari.indirizzi_lotl(xml), ["https://esempio.it/TSL-IT.xml"])


def crea_fixture(cartella: Path) -> None:
    """File per i test Node e per le prove dal vivo dei programmi (ente di prova fuori dagli elenchi ufficiali)."""
    cartella.mkdir(parents=True, exist_ok=True)
    ca, ca_key = ente()
    cert, key = titolare(ca, ca_key)
    der = p7m(PDF, cert, key)
    (cartella / "ente.pem").write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    (cartella / "firmato.pdf.p7m").write_bytes(der)
    (cartella / "alterato.pdf.p7m").write_bytes(der.replace(b"/Catalog", b"/Catalgo"))
    (cartella / "documento.pdf").write_bytes(PDF)


class RigaDiComandoEClient(unittest.TestCase):
    def test_busta_py_e_firma_py(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            crea_fixture(tmp / "fx")
            ancore = tmp / "ancore"
            ancore.mkdir()
            (ancore / "ente.pem").write_bytes((tmp / "fx" / "ente.pem").read_bytes())
            vecchio = {k: os.environ.get(k) for k in ("FIRMA_ANCORE_EXTRA", "FIRMA_CACHE_DIR", "FIRMA_PYTHON")}
            os.environ.update(FIRMA_ANCORE_EXTRA=str(ancore), FIRMA_CACHE_DIR=str(tmp / "cache"),
                              FIRMA_PYTHON=sys.executable)
            try:
                contenuto, nome, rapporto = busta.apri((tmp / "fx" / "firmato.pdf.p7m").read_bytes(),
                                                       "offerta.pdf.p7m", rete=False)
                self.assertEqual(contenuto, PDF)
                self.assertEqual(nome, "offerta.pdf")
                self.assertEqual(rapporto["esito"], "valida", rapporto)
                with self.assertRaises(busta.BustaIllegibile):
                    busta.apri(b"\x30\x82\x00\x10" + b"\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x07\x02" + b"\x00" * 8,
                               "rotto.p7m", rete=False)
                r = subprocess.run([sys.executable, str(CARTELLA / "firma.py"), "controlla", str(tmp / "fx" / "documento.pdf")])
                self.assertEqual(r.returncode, 1)
            finally:
                for k, v in vecchio.items():
                    if v is None:
                        os.environ.pop(k, None)
                    else:
                        os.environ[k] = v

    def test_dove_si_cerca_il_motore(self):
        """FIRMA_DIR → <cartella dell'eseguibile>/shared/firma → cartella di busta.py; motore senza .venv né
        installa.bat = messaggio con cosa fare (nessuna installazione lanciata davvero)."""
        vecchio = {k: os.environ.get(k) for k in ("FIRMA_DIR", "FIRMA_PYTHON")}
        os.environ.pop("FIRMA_PYTHON", None)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                altrove = Path(tmp) / "motore"
                altrove.mkdir()
                os.environ["FIRMA_DIR"] = str(altrove)
                # cartella indicata ma senza firma.py: si passa alla successiva (qui quella di busta.py)
                self.assertEqual(busta.candidati_motore()[0], altrove.resolve())
                self.assertEqual(busta.cartella_motore(), CARTELLA)
                # con firma.py vince lei, anche per l'interprete; senza .venv e senza installa.bat niente
                # installazione automatica: il messaggio dice quale installa.bat lanciare
                (altrove / "firma.py").write_text("# finto")
                self.assertEqual(busta.cartella_motore(), altrove.resolve())
                self.assertTrue(str(busta.python_firma()).startswith(str(altrove.resolve())))
                with self.assertRaises(busta.FirmaNonInstallata) as e:
                    busta.apri(b"x", "a.pdf.p7m")
                self.assertIn(str(altrove.resolve() / "installa.bat"), str(e.exception))
                # da un eseguibile impacchettato si guarda accanto all'exe
                self.assertIn(Path(sys.executable).resolve().parent / "shared" / "firma", busta.candidati_motore())
        finally:
            for k, v in vecchio.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "fixture":
        crea_fixture(Path(sys.argv[2]))
        print(json.dumps({"cartella": sys.argv[2]}))
        sys.exit(0)
    unittest.main(verbosity=1)
