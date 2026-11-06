# "><(((º> sabusabu <º)))><"
"""File di prova per firma.spec.ts (ADR-55): un PDF vero (si vede nel visualizzatore) firmato in busta .p7m da un
ente certificatore di prova creato al volo, con certificato qualificato su dispositivo sicuro (QcStatements).

    python firma_fixture.py CARTELLA      → CARTELLA/ente.pem, CARTELLA/firmato.pdf.p7m

L'ente di prova non è negli elenchi eIDAS: il test lo mette fra i certificati di fiducia del motore
(FIRMA_ANCORE_EXTRA, impostata in playwright.config.ts). Gira con il Python di SkyTower (cryptography, fpdf).
"""
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs7
from cryptography.x509.oid import NameOID
from fpdf import FPDF

QC = bytes.fromhex("3014" "3008" "060604008e460101" "3008" "060604008e460104")   # QcCompliance + QcSSCD
ORA = datetime.now(UTC)


def nome(cn, org):
    return x509.Name([x509.NameAttribute(NameOID.COUNTRY_NAME, "IT"), x509.NameAttribute(NameOID.COMMON_NAME, cn),
                      x509.NameAttribute(NameOID.ORGANIZATION_NAME, org)])


def uso(firma: bool):
    return x509.KeyUsage(digital_signature=False, content_commitment=firma, key_encipherment=False,
                         data_encipherment=False, key_agreement=False, key_cert_sign=not firma, crl_sign=not firma,
                         encipher_only=False, decipher_only=False)


def main(cartella: Path) -> None:
    cartella.mkdir(parents=True, exist_ok=True)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_nome = nome("Ente di Prova CA", "Ente di Prova S.p.A.")
    ca = (x509.CertificateBuilder().subject_name(ca_nome).issuer_name(ca_nome).public_key(ca_key.public_key())
          .serial_number(x509.random_serial_number()).not_valid_before(ORA - timedelta(days=30))
          .not_valid_after(ORA + timedelta(days=3650))
          .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
          .add_extension(uso(False), critical=True).sign(ca_key, hashes.SHA256()))
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    cert = (x509.CertificateBuilder()
            .subject_name(x509.Name([x509.NameAttribute(NameOID.COUNTRY_NAME, "IT"),
                                     x509.NameAttribute(NameOID.COMMON_NAME, "Mario Rossi"),
                                     x509.NameAttribute(NameOID.SERIAL_NUMBER, "TINIT-RSSMRA80A01H501U")]))
            .issuer_name(ca_nome).public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(ORA - timedelta(days=10)).not_valid_after(ORA + timedelta(days=700))
            .add_extension(uso(True), critical=True)
            .add_extension(x509.UnrecognizedExtension(x509.ObjectIdentifier("1.3.6.1.5.5.7.1.3"), QC), critical=False)
            .sign(ca_key, hashes.SHA256()))
    pdf = FPDF()
    pdf.set_font("Helvetica", size=16)
    pdf.add_page()
    pdf.text(20, 30, "Capitolato speciale d'appalto - documento firmato digitalmente")
    busta = (pkcs7.PKCS7SignatureBuilder().set_data(bytes(pdf.output())).add_signer(cert, key, hashes.SHA256())
             .sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.Binary]))
    (cartella / "ente.pem").write_bytes(ca.public_bytes(serialization.Encoding.PEM))
    (cartella / "firmato.pdf.p7m").write_bytes(busta)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
