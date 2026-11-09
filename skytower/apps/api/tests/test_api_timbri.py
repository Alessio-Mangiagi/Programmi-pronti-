# "><(((º> sabusabu <º)))><"
"""Timbri sui PDF (ADR-56, migrazione 0045).

Prima le due funzioni pure di ``cde_api/timbri.py`` (scontorno dell'immagine come Timbri per VFP, timbri sulle
pagine giuste anche ruotate o con CropBox, firma PAdES riconosciuta), controllate rendendo il PDF con pdfium e
cercando il rosso del timbro dove il visualizzatore lo aveva messo. Poi l'API: chi crea quali timbri e chi li vede,
il PDF timbrato come WIP successiva con il registro attività, e le regole di una revisione nuova (ultima
revisione, WRITE, blocco dei workflow con l'eccezione delle modifiche richieste, buste .p7m escluse).
"""
from __future__ import annotations

import base64
import io

import httpx
import numpy as np
import pypdfium2 as pdfium
import pytest
from fpdf import FPDF
from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, NumberObject, TextStringObject
from test_api_documents import as_user, des_name, upload, worker  # noqa: F401 - fixture riusate
from test_api_states import transition

from cde_api import timbri


# ---------------------------------------------------------------------
# Materiale di prova
# ---------------------------------------------------------------------
def immagine_timbro(fmt="PNG", sfondo=(250, 250, 247)) -> bytes:
    """Rettangolo rosso su carta quasi bianca, come un timbro scansionato (200×100, rosso nel 60% centrale)."""
    img = Image.new("RGB", (200, 100), sfondo)
    px = img.load()
    for x in range(40, 160):
        for y in range(20, 80):
            px[x, y] = (200, 0, 0)
    out = io.BytesIO()
    img.save(out, fmt)
    return out.getvalue()


def pdf_prova(rotazione=0, crop=None, formato=(595, 842), pagine=1) -> bytes:
    f = FPDF(unit="pt", format=formato)
    f.set_font("Helvetica", size=18)
    for n in range(pagine):
        f.add_page()
        f.text(60, 60, f"Tavola di prova, pagina {n + 1}")
    w = PdfWriter(clone_from=PdfReader(io.BytesIO(bytes(f.output()))))
    for p in w.pages:
        if rotazione:
            p.rotation = rotazione
        if crop:
            p.cropbox.lower_left, p.cropbox.upper_right = crop[:2], crop[2:]
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def pdf_firmato_pades() -> bytes:
    """PDF con un campo firma compilato (/FT /Sig con /V): basta per riconoscere una firma PAdES."""
    w = PdfWriter(clone_from=PdfReader(io.BytesIO(pdf_prova())))
    firma = DictionaryObject({NameObject("/Type"): NameObject("/Sig"),
                              NameObject("/Filter"): NameObject("/Adobe.PPKLite")})
    campo = DictionaryObject({NameObject("/FT"): NameObject("/Sig"), NameObject("/T"): TextStringObject("Firma1"),
                              NameObject("/V"): w._add_object(firma)})
    ref = w._add_object(campo)
    w._root_object[NameObject("/AcroForm")] = DictionaryObject({NameObject("/Fields"): ArrayObject([ref]),
                                                                 NameObject("/SigFlags"): NumberObject(3)})
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


def riquadro_rosso(pdf: bytes, pagina=1) -> tuple[float, float, float, float]:
    """Dove sta il rosso del timbro sulla pagina resa (frazioni della pagina come la mostra il visualizzatore)."""
    page = pdfium.PdfDocument(pdf)[pagina - 1]
    a = np.asarray(page.render(scale=1).to_pil().convert("RGB"))
    rosso = (a[..., 0] > 150) & (a[..., 1] < 80) & (a[..., 2] < 80)
    ys, xs = np.nonzero(rosso)
    assert len(xs), "timbro non trovato sulla pagina"
    h, w = rosso.shape
    return xs.min() / w, ys.min() / h, xs.max() / w, ys.max() / h


TIMBRO_PNG, _, _ = timbri.prepara_immagine(immagine_timbro(), scontorna_sfondo=True, tolleranza=0.15)


# ---------------------------------------------------------------------
# Funzioni pure
# ---------------------------------------------------------------------
def test_scontorno_come_timbri_per_vfp():
    png, w, h = timbri.prepara_immagine(immagine_timbro(), scontorna_sfondo=True, tolleranza=0.15)
    a = np.asarray(Image.open(io.BytesIO(png)))
    assert (w, h) == (200, 100) and a.shape == (100, 200, 4)
    assert a[0, 0, 3] == 0 and a[5, 5, 3] == 0                   # la carta diventa trasparente
    assert a[50, 100, 3] == 255 and tuple(a[50, 100, :3]) == (200, 0, 0)    # il timbro resta pieno e del suo colore
    # senza scontorno l'immagine resta opaca; un JPG va bene come un PNG
    png2, _, _ = timbri.prepara_immagine(immagine_timbro("JPEG"), scontorna_sfondo=False, tolleranza=0.15)
    assert np.asarray(Image.open(io.BytesIO(png2)))[0, 0, 3] == 255


def test_immagini_rifiutate_o_rimpicciolite():
    with pytest.raises(timbri.TimbroErrore, match="PNG o JPG"):
        timbri.prepara_immagine(b"non sono un'immagine", scontorna_sfondo=True, tolleranza=0.1)
    gif = io.BytesIO()
    Image.new("RGB", (10, 10), (255, 0, 0)).save(gif, "GIF")
    with pytest.raises(timbri.TimbroErrore, match="PNG o JPG"):
        timbri.prepara_immagine(gif.getvalue(), scontorna_sfondo=True, tolleranza=0.1)
    # tutta carta: dopo lo scontorno non resterebbe niente da timbrare
    vuota = io.BytesIO()
    Image.new("RGB", (50, 50), (250, 250, 250)).save(vuota, "PNG")
    with pytest.raises(timbri.TimbroErrore, match="vuota"):
        timbri.prepara_immagine(vuota.getvalue(), scontorna_sfondo=True, tolleranza=0.15)
    grande = io.BytesIO()
    Image.new("RGB", (4000, 1000), (0, 0, 200)).save(grande, "PNG")
    _, w, h = timbri.prepara_immagine(grande.getvalue(), scontorna_sfondo=False, tolleranza=0)
    assert (w, h) == (2000, 500)


@pytest.mark.parametrize(("descrizione", "pdf", "atteso"), [
    # riquadro x 0.6..0.9, y 0.7..0.85; l'immagine 2:1 sta dentro senza deformarsi, il rosso è il 60% centrale
    ("A4 verticale", pdf_prova(), (0.66, 0.74, 0.84, 0.81)),
    ("pagina ruotata di 90°", pdf_prova(rotazione=90), (0.69, 0.73, 0.81, 0.82)),
    ("pagina ruotata di 270°", pdf_prova(rotazione=270), (0.69, 0.73, 0.81, 0.82)),
    ("CropBox più piccola della pagina", pdf_prova(crop=(100, 100, 495, 742)), (0.66, 0.75, 0.84, 0.80)),
    ("A3 orizzontale", pdf_prova(formato=(1190, 842)), (0.69, 0.73, 0.81, 0.82)),
])
def test_timbro_dove_lo_mostra_il_visualizzatore(descrizione, pdf, atteso):
    out = timbri.timbra_pdf(pdf, [timbri.Posizione("t", 1, 0.6, 0.7, 0.3, 0.15)], {"t": TIMBRO_PNG})
    trovato = riquadro_rosso(out)
    assert all(abs(a - b) < 0.015 for a, b in zip(trovato, atteso, strict=True)), (descrizione, trovato)


def test_piu_pagine_didascalia_ed_errori():
    pdf = pdf_prova(pagine=3)
    out = timbri.timbra_pdf(pdf, [timbri.Posizione("a", 1, 0.1, 0.1, 0.2, 0.1, True),
                                  timbri.Posizione("a", 3, 0.5, 0.5, 0.2, 0.1)],
                            {"a": TIMBRO_PNG}, didascalia="Timbrato da Mario Rossi il 09/11/2026 10:30")
    r = PdfReader(io.BytesIO(out))
    assert len(r.pages) == 3
    assert "Timbrato da Mario Rossi il 09/11/2026 10:30" in r.pages[0].extract_text()
    assert "Timbrato" not in r.pages[2].extract_text()          # la didascalia solo dove richiesta
    riquadro_rosso(out, 3)
    with pytest.raises(timbri.TimbroErrore, match="Pagina 4 inesistente"):
        timbri.timbra_pdf(pdf, [timbri.Posizione("a", 4, 0, 0, 0.1, 0.1)], {"a": TIMBRO_PNG})
    with pytest.raises(timbri.TimbroErrore, match="non leggibile"):
        timbri.timbra_pdf(b"%PDF-1.7\nrotto", [timbri.Posizione("a", 1, 0, 0, 0.1, 0.1)], {"a": TIMBRO_PNG})
    protetto = PdfWriter(clone_from=PdfReader(io.BytesIO(pdf)))
    protetto.encrypt("segreta")
    buf = io.BytesIO()
    protetto.write(buf)
    with pytest.raises(timbri.TimbroErrore, match="password"):
        timbri.timbra_pdf(buf.getvalue(), [timbri.Posizione("a", 1, 0, 0, 0.1, 0.1)], {"a": TIMBRO_PNG})


def test_firma_pades_riconosciuta():
    assert timbri.ha_firma_pdf(pdf_prova()) is False
    assert timbri.ha_firma_pdf(pdf_firmato_pades()) is True


# ---------------------------------------------------------------------
# API: libreria dei timbri
# ---------------------------------------------------------------------
def crea(client, h, project_id, nome, ambito="PERSONAL", atteso=201, **altro):
    body = {"nome": nome, "ambito": ambito, "immagine_base64": base64.b64encode(immagine_timbro()).decode(), **altro}
    r = client.post(f"/projects/{project_id}/stamps", headers=h, json=body)
    assert r.status_code == atteso, r.text
    return r.json()


def nomi(client, h, project_id, **params) -> set[str]:
    r = client.get(f"/projects/{project_id}/stamps", headers=h, params=params)
    assert r.status_code == 200, r.text
    return {t["name"] for t in r.json()["timbri"]}


def test_libreria_ambiti_permessi_e_visibilita(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    pid = w.project_id
    lead, designer, des_admin = as_user("des_lead"), as_user("des_designer"), as_user("des_admin")
    com_admin, sub1 = as_user("com_admin"), as_user("sub1_user")

    firma = crea(client, lead, pid, "Firma Lead")
    assert firma["scope"] == "PERSONAL" and firma["can_manage"] and firma["width_px"] == 200
    # l'organizzazione: solo il suo amministratore; la commessa: solo il Project Admin
    crea(client, lead, pid, "Logo DES", "ORGANIZATION", atteso=403)
    logo = crea(client, des_admin, pid, "Logo DES", "ORGANIZATION")
    crea(client, lead, pid, "Approvato DL", "PROJECT", atteso=403)
    approvato = crea(client, com_admin, pid, "Approvato DL", "PROJECT")
    assert approvato["organization_code"] == "COM"
    r = client.get(f"/projects/{pid}/stamps", headers=lead).json()
    assert r["posso_creare"] == {"PERSONAL": True, "ORGANIZATION": False, "PROJECT": False}
    assert client.get(f"/projects/{pid}/stamps", headers=des_admin).json()["posso_creare"]["ORGANIZATION"] is True

    # chi vede cosa: la firma solo il proprietario, il logo i colleghi DES, «Approvato» tutta la commessa
    assert {"Firma Lead", "Logo DES", "Approvato DL"} <= nomi(client, lead, pid)
    vis_designer = nomi(client, designer, pid)
    assert "Logo DES" in vis_designer and "Approvato DL" in vis_designer and "Firma Lead" not in vis_designer
    vis_sub = nomi(client, sub1, pid)
    assert "Approvato DL" in vis_sub and "Logo DES" not in vis_sub and "Firma Lead" not in vis_sub
    img = client.get(f"/stamps/{firma['id']}/image", headers=lead)
    assert img.status_code == 200 and img.headers["content-type"] == "image/png"
    assert Image.open(io.BytesIO(img.content)).mode == "RGBA"
    assert client.get(f"/stamps/{firma['id']}/image", headers=designer).status_code == 404

    # rinomina e disattivazione: solo chi lo gestisce; i disattivati si vedono a richiesta
    assert client.patch(f"/stamps/{logo['id']}", headers=designer, json={"attivo": False}).status_code == 403
    r = client.patch(f"/stamps/{logo['id']}", headers=des_admin, json={"nome": "Logo DES S.p.A.", "attivo": False})
    assert r.status_code == 200 and r.json()["disabled_at"] and r.json()["name"] == "Logo DES S.p.A."
    assert "Logo DES S.p.A." not in nomi(client, designer, pid)
    assert "Logo DES S.p.A." in nomi(client, designer, pid, disattivati="true")
    assert client.patch(f"/stamps/{logo['id']}", headers=des_admin, json={"attivo": True}).json()["disabled_at"] is None
    # immagine non valida: messaggio chiaro
    r = client.post(f"/projects/{pid}/stamps", headers=lead,
                    json={"nome": "X", "immagine_base64": base64.b64encode(b"ciao ciao").decode()})
    assert r.status_code == 422 and "PNG o JPG" in r.json()["error"]["message"]


# ---------------------------------------------------------------------
# API: PDF timbrato come nuova revisione
# ---------------------------------------------------------------------
def pdf_caricato(client, h, w, worker, data=None, title="Tavola da timbrare"):  # noqa: F811
    rev = upload(client, h, w.containers["des_arch"], des_name(), data or pdf_prova(pagine=2), title=title)
    assert rev.status_code == 200, rev.text
    worker()
    return rev.json()


def timbra(client, h, rev_id, timbri_, atteso=201, **altro):
    r = client.post(f"/revisions/{rev_id}/timbra", headers=h, json={"timbri": timbri_, **altro})
    assert r.status_code == atteso, r.text
    return r.json()


def pos(timbro, pagina=1, didascalia=False, **kw):
    return {"timbro_id": timbro["id"], "pagina": pagina, "x": kw.get("x", 0.6), "y": kw.get("y", 0.7),
            "larghezza": kw.get("larghezza", 0.3), "altezza": kw.get("altezza", 0.15), "didascalia": didascalia}


def scarica(client, h, rev_id) -> bytes:
    d = client.get(f"/revisions/{rev_id}/download", headers=h)
    assert d.status_code == 200, d.text
    return httpx.get(d.json()["url"]).content


def test_pdf_timbrato_nuova_revisione_e_registro(client, api_world, as_user, worker):  # noqa: F811
    _, w = api_world
    lead, com_admin = as_user("des_lead"), as_user("com_admin")
    firma = crea(client, lead, w.project_id, "Firma Lead bis")
    approvato = crea(client, com_admin, w.project_id, "Approvato bis", "PROJECT")
    rev = pdf_caricato(client, lead, w, worker)

    nuova = timbra(client, lead, rev["id"], [pos(approvato, 1, didascalia=True), pos(firma, 2, x=0.1, y=0.8)],
                   commento="Approvazione della riunione del 9/11")
    assert nuova["revision_code"] == "P01.02" and nuova["state"] == "WIP" and nuova["suitability"] == "S0"
    assert nuova["original_filename"] == rev["original_filename"] and nuova["scan_status"] == "PENDING"
    assert nuova["comment"].startswith("Approvazione della riunione del 9/11")
    assert "Timbrata in piattaforma (Approvato bis, Firma Lead bis) a partire dalla P01.01" in nuova["comment"]
    worker()                                     # antivirus e impronta come per ogni file caricato
    pdf = scarica(client, lead, nuova["id"])
    r = PdfReader(io.BytesIO(pdf))
    assert len(r.pages) == 2 and "Timbrato da Des Lead il " in r.pages[0].extract_text()
    x0, y0, _, _ = riquadro_rosso(pdf, 1)
    assert abs(x0 - 0.66) < 0.015 and abs(y0 - 0.74) < 0.015
    riquadro_rosso(pdf, 2)
    # la revisione di partenza resta com'era
    assert "Timbrato" not in PdfReader(io.BytesIO(scarica(client, lead, rev["id"]))).pages[0].extract_text()

    eventi = client.get(f"/projects/{w.project_id}/audit", headers=com_admin,
                        params={"event_type": "REVISION_STAMPED"}).json()
    ev = next(e for e in eventi if e["details"]["revision"] == nuova["id"])
    assert ev["details"]["from_code"] == "P01.01" and ev["details"]["code"] == "P01.02"
    assert {(s["name"], s["page"]) for s in ev["details"]["stamps"]} == {("Approvato bis", 1), ("Firma Lead bis", 2)}
    assert ev["details"]["caption"].startswith("Timbrato da Des Lead il ")

    # si timbra solo l'ultima revisione; timbro disattivato o personale di un altro: non disponibile
    assert timbra(client, lead, rev["id"], [pos(firma)], atteso=409)["error"]["code"] == "not_current"
    client.patch(f"/stamps/{approvato['id']}", headers=com_admin, json={"attivo": False})
    assert timbra(client, lead, nuova["id"], [pos(approvato)], atteso=422)["error"]["code"] == "timbro_non_disponibile"
    assert timbra(client, as_user("des_designer"), nuova["id"], [pos(firma)], atteso=422)
    # senza WRITE sulla cartella non si timbra; fuori dalla pagina: rifiutato
    assert client.post(f"/revisions/{nuova['id']}/timbra", headers=as_user("des_viewer"),
                       json={"timbri": [pos(firma)]}).status_code in (403, 422)
    assert timbra(client, lead, nuova["id"], [pos(firma, x=0.9, larghezza=0.3)], atteso=422)


def test_pubblicata_si_timbra_come_nuova_wip(client, api_world, as_user, worker):  # noqa: F811
    _, w = api_world
    lead = as_user("des_lead")
    firma = crea(client, lead, w.project_id, "Firma pubblicata")
    rev = pdf_caricato(client, lead, w, worker)
    shared = transition(client, lead, rev["id"], "SHARED", "S2").json()
    pub = transition(client, lead, shared["id"], "PUBLISHED", "A1", "Approvato in riunione").json()
    nuova = timbra(client, lead, pub["id"], [pos(firma)])
    assert nuova["state"] == "WIP" and nuova["revision_code"] == "P02.01"


def test_buste_p7m_altri_formati_e_firma_pades(client, api_world, as_user, worker):  # noqa: F811
    _, w = api_world
    lead = as_user("des_lead")
    firma = crea(client, lead, w.project_id, "Firma casi limite")
    busta = upload(client, lead, w.containers["des_arch"], des_name(ext="pdf.p7m"), b"0\x80" + bytes(500),
                   title="Capitolato firmato").json()
    testo = upload(client, lead, w.containers["des_arch"], des_name(ext="txt"), b"appunti", title="Appunti").json()
    worker()
    assert timbra(client, lead, busta["id"], [pos(firma)], atteso=409)["error"]["code"] == "firmato"
    assert timbra(client, lead, testo["id"], [pos(firma)], atteso=415)["error"]["code"] == "solo_pdf"

    # PDF con firma PAdES: serve la conferma, poi la nuova revisione lo dice nel registro
    rev = pdf_caricato(client, lead, w, worker, data=pdf_firmato_pades())
    assert timbra(client, lead, rev["id"], [pos(firma)], atteso=409)["error"]["code"] == "pdf_firmato"
    nuova = timbra(client, lead, rev["id"], [pos(firma)], accetta_firma_pdf=True)
    eventi = client.get(f"/projects/{w.project_id}/audit", headers=as_user("com_admin"),
                        params={"event_type": "REVISION_STAMPED"}).json()
    ev = next(e for e in eventi if e["details"]["revision"] == nuova["id"])
    assert ev["details"]["pdf_signature_dropped"] is True


def test_workflow_blocca_tranne_le_modifiche_richieste(client, api_world, as_user, worker):  # noqa: F811
    from test_workflow_grafo import decisione, nodo, salva, utente
    from test_workflow_ritorno import compito, rimanda

    _, w = api_world
    admin, lead, des, dl = as_user("com_admin"), as_user("des_lead"), as_user("des_designer"), as_user("com_dl")
    firma = crea(client, lead, w.project_id, "Firma workflow")
    firma_des = crea(client, des, w.project_id, "Firma designer")
    rev = pdf_caricato(client, lead, w, worker)
    shared = transition(client, lead, rev["id"], "SHARED", "S4").json()
    tpl = salva(client, admin, w, [
        nodo("s", "start", "Avvio", 0, 0),
        decisione("dl", "Parere DL", 1, 0, [utente(w, "com_dl")]),
        nodo("ok", "end", "Approvato", 2, 0, result="OK"), nodo("ko", "end", "Rifiutato", 2, 1, result="KO")],
        [{"from": "s", "to": "dl"}, {"from": "dl", "outcome": "OK", "to": "ok"},
         {"from": "dl", "outcome": "NO", "to": "ko"}],
        subject="DOCUMENT", on_completed={"to_state": "PUBLISHED", "suitability": "A1"})
    inst = client.post(f"/revisions/{shared['id']}/workflows", headers=lead, json={"template_id": tpl["id"]}).json()
    # workflow in corso: bloccato per tutti
    assert timbra(client, lead, shared["id"], [pos(firma)], atteso=423)

    rimanda(client, dl, inst["id"], "dl", "ORIGINATOR", "Manca il timbro")
    assert timbra(client, des, shared["id"], [pos(firma_des)], atteso=423)     # non ha il compito riaperto
    nuova = timbra(client, lead, shared["id"], [pos(firma)])
    assert nuova["revision_code"] == "P02.01" and nuova["state"] == "WIP"
    assert compito(client, lead, inst["id"], "s")["new_revision"]["revision_code"] == "P02.01"
