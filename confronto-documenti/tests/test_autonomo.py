# "><(((º> sabusabu <º)))><"
"""Versione autonoma di Confronto Documenti (autonomo.py + busta_autonoma.py, richiesta del 27/11/2026).

  - busta_autonoma: estrae il documento da una busta .p7m senza verificare la firma. Le buste di prova si
    costruiscono qui con asn1crypto (senza firmatari: per l'estrazione non servono); quella con un firmatario
    vero la firma l'ente di prova del motore shared/firma (saltata se il suo .venv manca);
  - server.apri_busta e il confronto intero con busta_autonoma al posto del motore: esito "non verificata" in
    pagina e nei tre report;
  - autonomo: riconoscere il programma già aperto, scegliere la porta, cartella dei dati.
L'exe vero si prova a mano dopo build-autonomo.bat (vedi INSTALLAZIONE.md, "Versione autonoma").
"""
import base64
import os
import socket
import subprocess
import sys
import uuid
from pathlib import Path

import pytest

pytest.importorskip("asn1crypto", reason="serve asn1crypto (requirements-dev.txt)")
from asn1crypto import cms  # noqa: E402

os.environ.setdefault("SUITE_TOKEN", "token-di-prova")
RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))

import autonomo  # noqa: E402
import busta_autonoma  # noqa: E402
import server  # noqa: E402
from confronta_pdf import DocumentError  # noqa: E402

FIRMA = RADICE.parent / "shared" / "firma"
FIRMA_PY = FIRMA / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def _pdf(testo: str) -> bytes:
    """PDF vero di una pagina con testo incorporato (niente OCR nel confronto)."""
    import pymupdf
    doc = pymupdf.open()
    pagina = doc.new_page()
    y = 72
    for riga in testo.splitlines():
        pagina.insert_text((72, y), riga, fontsize=11)
        y += 16
    dati = doc.tobytes()
    doc.close()
    return dati


def _busta(contenuto: bytes | None) -> bytes:
    """Busta CMS SignedData in DER con dentro `contenuto` e nessun firmatario (None = firma staccata)."""
    eci = {"content_type": "data"}
    if contenuto is not None:
        eci["content"] = contenuto
    return cms.ContentInfo({"content_type": "signed_data", "content": cms.SignedData({
        "version": "v1", "digest_algorithms": [], "encap_content_info": eci, "signer_infos": []})}).dump()


# ---------------------------------------------------------------------------------------------------------------
# busta_autonoma
# ---------------------------------------------------------------------------------------------------------------
def test_riconosce_la_busta():
    # documento vero: una busta sotto i 128 byte in base64 non comincia per "MI"/"MC" come quelle reali
    der = _busta(_pdf("prova"))
    assert busta_autonoma.e_busta_firmata(der[:64])                       # dal contenuto, anche solo la testa
    assert busta_autonoma.e_busta_firmata(b"qualunque", "offerta.pdf.P7M")  # dal nome
    assert busta_autonoma.e_busta_firmata(base64.b64encode(der))          # base64
    assert not busta_autonoma.e_busta_firmata(b"%PDF-1.7", "offerta.pdf")
    assert not busta_autonoma.e_busta_firmata(b"MI non e' base64 valido!!")


def test_estrae_il_documento_senza_verifica():
    pdf = _pdf("Offerta economica")
    contenuto, nome, rapporto = busta_autonoma.apri(_busta(pdf), "offerta.pdf.p7m")
    assert contenuto == pdf and nome == "offerta.pdf"
    assert rapporto["esito"] is None and rapporto["livelli"] == 1 and rapporto["firme"] == []
    assert "non verificata" in rapporto["riepilogo"]


def test_busta_annidata_base64_e_nome_senza_estensione():
    pdf = _pdf("Contratto")
    doppia = _busta(_busta(pdf))                                          # contratto.pdf.p7m.p7m
    contenuto, nome, rapporto = busta_autonoma.apri(doppia, "contratto.pdf.p7m.p7m")
    assert contenuto == pdf and nome == "contratto.pdf" and rapporto["livelli"] == 2
    pem = b"-----BEGIN PKCS7-----\n" + base64.encodebytes(_busta(pdf)) + b"-----END PKCS7-----\n"
    contenuto, nome, _ = busta_autonoma.apri(pem, "busta.p7m")            # il nome non dice il formato: dal contenuto
    assert contenuto == pdf and nome == "busta.pdf"


def test_buste_illeggibili():
    with pytest.raises(busta_autonoma.BustaIllegibile, match="Firma staccata"):
        busta_autonoma.apri(_busta(None), "offerta.pdf.p7m")
    with pytest.raises(busta_autonoma.BustaIllegibile, match="non contiene una busta"):
        busta_autonoma.apri(b"questo non e' un p7m", "offerta.pdf.p7m")
    with pytest.raises(busta_autonoma.BustaIllegibile, match="illeggibile"):
        busta_autonoma.apri(_busta(b"x" * 200)[:60], "offerta.pdf.p7m")   # troncata


def test_server_apri_busta_con_il_motore_autonomo(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "firma_busta", busta_autonoma)
    p = tmp_path / "cmp_x_a.p7m"
    p.write_bytes(_busta(_pdf("Offerta")))
    estratto, firma = server.apri_busta(p, "offerta.pdf.p7m")
    assert estratto.suffix == ".pdf" and estratto.read_bytes().startswith(b"%PDF")
    assert firma["esito"] is None and firma["documento"] == "offerta.pdf"
    semplice = tmp_path / "cmp_x_b.pdf"
    semplice.write_bytes(_pdf("ciao"))
    assert server.apri_busta(semplice, "relazione.pdf") == (semplice, None)   # non firmato: resta com'è
    rotta = tmp_path / "cmp_x_c.p7m"
    rotta.write_bytes(b"non una busta")
    with pytest.raises(DocumentError, match="non contiene una busta"):
        server.apri_busta(rotta, "rotta.pdf.p7m")
    exe = tmp_path / "cmp_x_d.p7m"
    exe.write_bytes(_busta(b"MZ programma"))
    with pytest.raises(DocumentError, match=".exe"):
        server.apri_busta(exe, "programma.exe.p7m")


def _confronta(tmp_path, monkeypatch, busta: bytes, pdf: bytes) -> dict:
    """Confronto intero (worker run_compare) fra la busta e il PDF non firmato, col motore autonomo."""
    monkeypatch.setattr(server, "firma_busta", busta_autonoma)
    monkeypatch.setattr(server.storico, "CARTELLA", tmp_path / "storico")
    job_id = uuid.uuid4().hex[:12]
    a, b = tmp_path / f"cmp_{job_id}_a.p7m", tmp_path / f"cmp_{job_id}_b.pdf"
    a.write_bytes(busta)
    b.write_bytes(pdf)
    with server.JOBS_LOCK:
        server.JOBS[job_id] = {"id": job_id, "status": "queued", "message": "", "cancel": False, "results": [],
                               "name_a": "contratto.pdf.p7m", "name_b": "contratto.pdf"}
    try:
        server.run_compare(job_id, a, b, "contratto.pdf.p7m", "contratto.pdf", "tesseract", 150, "ita+eng",
                           False, True, [], True)
        job = server.get_job(job_id)
        assert job["status"] == "done", job["message"]
        # i tre report si costruiscono anche con la firma non verificata (esito None)
        assert server.build_report_pdf(job)[:4] == b"%PDF"
        assert server.build_report_docx(job)[:2] == b"PK"
        assert server.build_report_xlsx(job)[:2] == b"PK"
        return job
    finally:
        with server.JOBS_LOCK:
            server.JOBS.pop(job_id, None)
            server.PREVIEWS.pop(job_id, None)


def test_confronto_intero_con_busta_senza_firmatari(tmp_path, monkeypatch):
    pdf = _pdf("Contratto di fornitura\nImporto complessivo 1.250,00 euro")
    job = _confronta(tmp_path, monkeypatch, _busta(pdf), pdf)
    assert job["diff_count"] == 0
    assert job["firma_a"]["esito"] is None and job["firma_b"] is None
    assert job["firma_nota"].startswith("Solo A è firmato digitalmente (firma non verificata)")


@pytest.mark.skipif(not FIRMA_PY.exists(), reason="motore della firma non installato (shared/firma/installa.bat)")
def test_confronto_intero_con_firma_vera(tmp_path, monkeypatch):
    """Busta firmata dall'ente di prova del motore (test_firma.py): il motore autonomo ne legge il firmatario."""
    pdf = _pdf("Contratto di fornitura\nImporto complessivo 1.250,00 euro")
    (tmp_path / "originale.pdf").write_bytes(pdf)
    script = ("import sys; sys.path.insert(0, sys.argv[1]); import test_firma as t\n"
              "from pathlib import Path\n"
              "ca, k = t.ente(); c, ck = t.titolare(ca, k)\n"
              "Path(sys.argv[3]).write_bytes(t.p7m(Path(sys.argv[2]).read_bytes(), c, ck))\n")
    subprocess.run([str(FIRMA_PY), "-c", script, str(FIRMA), str(tmp_path / "originale.pdf"),
                    str(tmp_path / "busta.p7m")], check=True, timeout=120)
    job = _confronta(tmp_path, monkeypatch, (tmp_path / "busta.p7m").read_bytes(), pdf)
    firma = job["firma_a"]
    assert job["diff_count"] == 0 and firma["esito"] is None
    assert firma["firme"][0]["firmatario"] == "Mario Rossi"
    assert "non verificata" in firma["firme"][0]["motivi"][0]
    assert "Mario Rossi" in firma["riepilogo"]


# ---------------------------------------------------------------------------------------------------------------
# autonomo
# ---------------------------------------------------------------------------------------------------------------
def test_porta_occupata_si_passa_alla_successiva(monkeypatch):
    with socket.socket() as occupata:
        occupata.bind(("127.0.0.1", 0))
        occupata.listen(1)
        porta = occupata.getsockname()[1]
        assert not autonomo.porta_libera(porta)
        monkeypatch.setattr(autonomo, "PORTA_PREFERITA", porta)
        scelta = autonomo.scegli_porta()
        assert scelta is not None and porta < scelta <= porta + autonomo.PORTE_DI_RISERVA
        # sulla porta risponde qualcosa che non è Confronto Documenti (non parla nemmeno HTTP): non è "già aperto"
        assert not autonomo.gia_aperto(porta)


def test_cartella_dati(monkeypatch, tmp_path):
    monkeypatch.delenv("CONFRONTO_DATI", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    assert autonomo.cartella_dati() == tmp_path / "Confronto Documenti"
    monkeypatch.setenv("CONFRONTO_DATI", str(tmp_path / "altrove"))
    assert autonomo.cartella_dati() == tmp_path / "altrove"
