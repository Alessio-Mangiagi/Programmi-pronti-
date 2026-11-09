# "><(((º> sabusabu <º)))><"
"""PDF firmati digitalmente (.p7m) in Confronto Documenti (richiesta del 06/11/2026, CONTRATTI.md §10).

Il server apre la busta col motore comune shared/firma (server.apri_busta), confronta il PDF contenuto come
gli altri e mette nel job firma_a / firma_b / firma_nota. Qui:
  - con il motore finto (monkeypatch): busta valida, non firmato, motore non installato, busta rotta, verifica
    fallita (si estrae lo stesso, "da verificare"), contenuto non ammesso, upload .p7m, frase di confronto;
  - con il motore vero (shared/firma/.venv, saltato se manca): un PDF firmato dall'ente di prova del motore
    confrontato con lo stesso PDF non firmato, fino al job "done" con la firma nel risultato e nei report.
"""
import json
import os
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest

# stesso token di test_suite_token.py: /api/compare si prova come la chiamano SkyTower e VFP Transfer
os.environ.setdefault("SUITE_TOKEN", "token-di-prova")
RADICE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RADICE))

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


RAPPORTO_VALIDO = {
    "firmato": True, "esito": "valida", "livelli": 1, "nome_contenuto": "offerta.pdf",
    "riepilogo": "Firma valida: Mario Rossi (InfoCert S.p.A.), 12/03/2026",
    "firme": [{"firmatario": "Mario Rossi", "codice_fiscale": "RSSMRA80A01H501U", "ente_certificatore": "InfoCert S.p.A.",
               "tipo": "firma digitale", "esito": "valida", "motivi": [], "data_firma_dichiarata": "2026-03-12T10:00:00+00:00",
               "marca_temporale": None, "certificato_valido_al": "2028-01-01T00:00:00+00:00"}],
    "elenchi": {"aggiornati_il": "2026-11-06T10:00:00+00:00"},
}


class MotoreFinto:
    """Il client busta.py senza processi: dice "firmato" ai .p7m e restituisce un PDF e un rapporto."""
    class FirmaNonInstallata(RuntimeError):
        pass

    class BustaIllegibile(ValueError):
        pass

    def __init__(self, comportamento="valida", nome_doc="offerta.pdf"):
        self.comportamento, self.nome_doc, self.chiamate = comportamento, nome_doc, []

    def e_busta_firmata(self, dati, nome=None):
        return bool(nome and nome.lower().endswith(".p7m"))

    def apri(self, dati, nome=None, *, verifica=True, rete=True, timeout=180):
        self.chiamate.append(verifica)
        if self.comportamento == "non installato":
            raise self.FirmaNonInstallata("Componente firma digitale non installato: lanciare "
                                          r"C:\suite\shared\firma\installa.bat (serve Python 3.12 e la rete)")
        if self.comportamento == "in installazione":
            raise self.FirmaNonInstallata("Componente firma digitale in installazione (...): riprovare fra "
                                          "qualche minuto")
        if self.comportamento == "rotta":
            raise self.BustaIllegibile("Firma staccata: la busta non contiene il documento")
        if self.comportamento == "verifica fallita" and verifica:
            raise subprocess.TimeoutExpired("firma.py", 180)
        rapporto = json.loads(json.dumps(RAPPORTO_VALIDO))
        if not verifica:
            rapporto.update(esito=None, riepilogo="Documento firmato (non verificato): Mario Rossi")
        return _pdf("Offerta economica\nImporto 100,00"), self.nome_doc, rapporto


@pytest.fixture
def motore(monkeypatch):
    def usa(comportamento="valida", nome_doc="offerta.pdf"):
        m = MotoreFinto(comportamento, nome_doc)
        monkeypatch.setattr(server, "firma_busta", m)
        return m
    return usa


def _busta(tmp_path, nome="cmp_x_a.p7m") -> Path:
    p = tmp_path / nome
    p.write_bytes(b"0\x82busta finta")
    return p


def test_busta_valida_estrae_il_pdf(tmp_path, motore):
    motore("valida")
    estratto, firma = server.apri_busta(_busta(tmp_path), "offerta.pdf.p7m")
    assert estratto.suffix == ".pdf" and estratto.read_bytes().startswith(b"%PDF")
    assert firma["esito"] == "valida" and firma["documento"] == "offerta.pdf"
    assert firma["firme"][0]["firmatario"] == "Mario Rossi" and firma["firme"][0]["ente"] == "InfoCert S.p.A."
    assert "Firma valida" in firma["riepilogo"]


def test_file_non_firmato_resta_com_e(tmp_path, motore):
    motore("valida")
    p = tmp_path / "cmp_x_a.pdf"
    p.write_bytes(_pdf("ciao"))
    assert server.apri_busta(p, "relazione.pdf") == (p, None)


def test_motore_non_installato_o_assente_messaggio_chiaro(tmp_path, motore, monkeypatch):
    motore("non installato")
    with pytest.raises(DocumentError, match="installa.bat"):
        server.apri_busta(_busta(tmp_path), "offerta.pdf.p7m")
    motore("in installazione")                                # prima busta: installa.bat partito in disparte
    with pytest.raises(DocumentError, match="riprovare fra qualche minuto"):
        server.apri_busta(_busta(tmp_path), "offerta.pdf.p7m")
    monkeypatch.setattr(server, "firma_busta", None)          # exe senza shared\firma accanto, Docker
    with pytest.raises(DocumentError, match="copiare la cartella shared"):
        server.apri_busta(_busta(tmp_path), "offerta.pdf.p7m")


def test_busta_rotta(tmp_path, motore):
    motore("rotta")
    with pytest.raises(DocumentError, match="Firma staccata"):
        server.apri_busta(_busta(tmp_path), "offerta.pdf.p7m")


def test_verifica_fallita_si_legge_lo_stesso(tmp_path, motore):
    m = motore("verifica fallita")
    estratto, firma = server.apri_busta(_busta(tmp_path), "offerta.pdf.p7m")
    assert m.chiamate == [True, False]                          # prima con verifica, poi solo estrazione
    assert estratto.exists() and firma["esito"] == "da verificare"
    assert firma["riepilogo"].startswith("Firma non verificata")


def test_contenuto_non_ammesso(tmp_path, motore):
    motore("valida", nome_doc="programma.exe")
    with pytest.raises(DocumentError, match=".exe"):
        server.apri_busta(_busta(tmp_path), "programma.exe.p7m")


def test_upload_p7m_ammesso_solo_con_formato_buono(tmp_path):
    class File:
        def __init__(self, nome):
            self.filename = nome

        def save(self, path):
            Path(path).write_bytes(b"x")
    assert server._save_upload(File("offerta.pdf.p7m"), tmp_path, "abc", "a").suffix == ".p7m"
    assert server._save_upload(File("busta.p7m"), tmp_path, "abc", "b") is not None   # formato deciso dopo
    assert server._save_upload(File("virus.exe.p7m"), tmp_path, "abc", "a") is None
    assert server._save_upload(File("virus.exe"), tmp_path, "abc", "a") is None


def test_nota_firme():
    fa = {"esito": "valida", "firme": [{"firmatario": "Mario Rossi", "codice_fiscale": "RSSMRA80A01H501U"}]}
    fb = {"esito": "non valida", "firme": [{"firmatario": "Anna Bianchi", "codice_fiscale": "BNCNNA85B41F205X"}]}
    assert server.nota_firme(None, None) is None
    assert server.nota_firme(fa, None).startswith("Solo A è firmato")
    assert server.nota_firme(None, fb).startswith("Solo B è firmato")
    assert "stessi firmatari" in server.nota_firme(fa, dict(fa))
    nota = server.nota_firme(fa, fb)
    assert "Firmatari diversi" in nota and "firma di A valida, di B non valida" in nota


def test_compare_accetta_p7m_e_avvia_il_job(motore, monkeypatch):
    """La rotta /api/compare (anche per SkyTower e VFP Transfer col token) accetta il .p7m e passa il nome vero
    al worker; il worker non parte davvero (thread finto)."""
    import io
    partiti = []
    monkeypatch.setattr(server.threading, "Thread",
                        lambda target, args, daemon: type("T", (), {"start": lambda self: partiti.append(args)})())
    monkeypatch.setattr(server, "_identita", lambda: ("mrossi", False))
    client = server.app.test_client()
    r = client.post("/api/compare", headers={"X-Suite-Token": os.environ["SUITE_TOKEN"]}, data={
        "pdf1": (io.BytesIO(b"0\x82busta"), "offerta.pdf.p7m"),
        "pdf2": (io.BytesIO(_pdf("Offerta")), "offerta.pdf")}, content_type="multipart/form-data")
    assert r.status_code == 200, r.get_json()
    job_id, path1, path2, nome1, nome2 = partiti[0][:5]
    assert path1.suffix == ".p7m" and nome1 == "offerta.pdf.p7m" and nome2 == "offerta.pdf"
    for p in (path1, path2):
        p.unlink(missing_ok=True)
    with server.JOBS_LOCK:
        server.JOBS.pop(job_id, None)


# ---------------------------------------------------------------------------------------------------------------
# Motore vero (shared/firma/.venv)
# ---------------------------------------------------------------------------------------------------------------
@pytest.mark.skipif(not FIRMA_PY.exists(), reason="motore della firma non installato (shared/firma/installa.bat)")
def test_confronto_vero_pdf_firmato_contro_non_firmato(tmp_path, monkeypatch):
    testo = "Contratto di fornitura\nImporto complessivo 1.250,00 euro\nConsegna entro 30 giorni"
    pdf = _pdf(testo)
    (tmp_path / "originale.pdf").write_bytes(pdf)
    # firma il PDF con l'ente di prova del motore (test_firma.py) e salva il certificato dell'ente come fiducia
    script = (
        "import sys; sys.path.insert(0, sys.argv[1]); import test_firma as t\n"
        "from pathlib import Path\n"
        "from cryptography.hazmat.primitives import serialization\n"
        "ca, k = t.ente(); c, ck = t.titolare(ca, k)\n"
        "Path(sys.argv[3]).write_bytes(t.p7m(Path(sys.argv[2]).read_bytes(), c, ck))\n"
        "Path(sys.argv[4]).write_bytes(ca.public_bytes(serialization.Encoding.PEM))\n")
    ancore = tmp_path / "ancore"
    ancore.mkdir()
    subprocess.run([str(FIRMA_PY), "-c", script, str(FIRMA), str(tmp_path / "originale.pdf"),
                    str(tmp_path / "busta.p7m"), str(ancore / "ente.pem")], check=True, timeout=120)
    # elenchi ufficiali vuoti in una cache temporanea: niente download, vale solo l'ente di prova
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "elenchi.json").write_text(json.dumps({"aggiornato": datetime.now(UTC).isoformat(), "fonte": "prova",
                                                    "servizi": []}), encoding="utf-8")
    monkeypatch.setenv("FIRMA_ANCORE_EXTRA", str(ancore))
    monkeypatch.setenv("FIRMA_CACHE_DIR", str(cache))
    monkeypatch.setattr(server.storico, "CARTELLA", tmp_path / "storico")
    sys.path.insert(0, str(FIRMA))
    import busta
    monkeypatch.setattr(server, "firma_busta", busta)

    job_id = uuid.uuid4().hex[:12]
    a, b = tmp_path / f"cmp_{job_id}_a.p7m", tmp_path / f"cmp_{job_id}_b.pdf"
    a.write_bytes((tmp_path / "busta.p7m").read_bytes())
    b.write_bytes(pdf)
    with server.JOBS_LOCK:
        server.JOBS[job_id] = {"id": job_id, "status": "queued", "message": "", "cancel": False, "results": [],
                               "name_a": "contratto.pdf.p7m", "name_b": "contratto.pdf"}
    try:
        server.run_compare(job_id, a, b, "contratto.pdf.p7m", "contratto.pdf", "tesseract", 150, "ita+eng",
                           False, True, [], True)
        job = server.get_job(job_id)
        assert job["status"] == "done", job["message"]
        assert job["diff_count"] == 0                                # stesso PDF: nessuna differenza
        assert job["firma_a"]["esito"] == "valida", job["firma_a"]
        assert job["firma_a"]["firme"][0]["firmatario"] == "Mario Rossi"
        assert job["firma_b"] is None
        assert job["firma_nota"].startswith("Solo A è firmato digitalmente (firma valida)")
        assert "Solo A è firmato" in job["message"]
        assert not a.exists() and not list(tmp_path.glob(f"cmp_{job_id}_a_contenuto*"))   # temporanei cancellati
        # la firma finisce nei tre report scaricabili
        assert any("Firma digitale A: Firma valida" in r for r in server._righe_firme(job))
        import openpyxl, io as _io                                   # noqa: E401
        wb = openpyxl.load_workbook(_io.BytesIO(server.build_report_xlsx(job)))
        assert any("Firma valida" in str(c.value) for row in wb["Confronto"].iter_rows() for c in row)
        assert server.build_report_pdf(job)[:4] == b"%PDF"
        assert server.build_report_docx(job)[:2] == b"PK"
    finally:
        with server.JOBS_LOCK:
            server.JOBS.pop(job_id, None)
            server.PREVIEWS.pop(job_id, None)
