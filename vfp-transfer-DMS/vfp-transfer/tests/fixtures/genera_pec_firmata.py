# "><(((º> sabusabu <º)))><"
"""
Rigenera pec_firmata.eml: una PEC di prova (busta con daticert.xml e postacert.eml) firmata S/MIME con un
certificato temporaneo "Gestore PEC di Prova", creato in memoria da firma_pec.ps1 (nessun certificato
viene installato nel PC). Serve solo ai test; uso (Windows): python tests/fixtures/genera_pec_firmata.py
"""

import base64
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CRLF = "\r\n"

INNER = CRLF.join([
    "From: Ufficio Tecnico <tecnico@comune-prova.it>",
    "To: cosedil@pec-prova.it",
    "Subject: 001 - Trasmissione verbale di consegna lavori",
    "Message-ID: <originale-001@comune-prova.it>",
    "Date: Tue, 13 Oct 2026 09:58:00 +0200",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="IN"',
    "",
    "--IN",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "In allegato il verbale.",
    "--IN",
    'Content-Type: application/pdf; name="verbale.pdf"',
    'Content-Disposition: attachment; filename="verbale.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    "JVBERi0xLjQKJcOkw7zDtsOfCjEgMCBvYmoKPDw+PgplbmRvYmoKdHJhaWxlcgo8PD4+CiUlRU9GCg==",
    "--IN--",
    ""])

DATICERT = CRLF.join([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<postacert tipo="posta-certificata" errore="nessuno">',
    '<intestazione><mittente>tecnico@comune-prova.it</mittente><destinatari tipo="certificato">cosedil@pec-prova.it</destinatari>',
    '<risposte>tecnico@comune-prova.it</risposte><oggetto>001 - Trasmissione verbale di consegna lavori</oggetto></intestazione>',
    '<dati><gestore-emittente>GESTORE PEC DI PROVA</gestore-emittente><data zona="+0200"><giorno>13/10/2026</giorno><ora>09:58:30</ora></data>',
    '<identificativo>opec-prova.20261013095830.00001.01.1.1@pec-prova.it</identificativo><msgid>&lt;originale-001@comune-prova.it&gt;</msgid></dati>',
    '</postacert>',
    ""])

CONTENT = CRLF.join([
    'Content-Type: multipart/mixed; boundary="BUSTA"',
    "",
    "--BUSTA",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Messaggio di posta certificata.",
    "--BUSTA",
    'Content-Type: application/xml; name="daticert.xml"',
    'Content-Disposition: inline; filename="daticert.xml"',
    "",
    DATICERT,
    "--BUSTA",
    'Content-Type: message/rfc822; name="postacert.eml"',
    'Content-Disposition: attachment; filename="postacert.eml"',
    "",
    INNER,
    "--BUSTA--",
    ""]).encode()

HEADERS = CRLF.join([
    "Return-Path: <posta-certificata@pec-prova.it>",
    'From: "Per conto di: tecnico@comune-prova.it" <posta-certificata@pec-prova.it>',
    "Reply-To: tecnico@comune-prova.it",
    "To: cosedil@pec-prova.it",
    "Subject: POSTA CERTIFICATA: 001 - Trasmissione verbale di consegna lavori",
    "Date: Tue, 13 Oct 2026 09:58:30 +0200",
    "Message-ID: <opec-prova.20261013095830.00001.01.1.1@pec-prova.it>",
    "X-Trasporto: posta-certificata",
    "MIME-Version: 1.0",
    'Content-Type: multipart/signed; protocol="application/pkcs7-signature"; micalg=sha-256; boundary="FIRMA"',
    "", ""]).encode()


def main():
    with tempfile.TemporaryDirectory() as tmp:
        content, sig = Path(tmp) / "contenuto.bin", Path(tmp) / "firma.p7s"
        content.write_bytes(CONTENT)
        subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(HERE / "firma_pec.ps1"),
                        "-In", str(content), "-Out", str(sig)], check=True)
        signature = base64.encodebytes(sig.read_bytes()).replace(b"\n", b"\r\n")
    body = (b"--FIRMA\r\n" + CONTENT + b"\r\n--FIRMA\r\n"
            b'Content-Type: application/pkcs7-signature; name="smime.p7s"\r\n'
            b"Content-Transfer-Encoding: base64\r\n"
            b'Content-Disposition: attachment; filename="smime.p7s"\r\n\r\n' + signature + b"\r\n--FIRMA--\r\n")
    (HERE / "pec_firmata.eml").write_bytes(HEADERS + body)
    print("Creato", HERE / "pec_firmata.eml")


if __name__ == "__main__":
    main()
