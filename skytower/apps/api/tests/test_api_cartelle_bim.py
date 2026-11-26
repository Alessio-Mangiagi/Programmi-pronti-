# "><(((º> sabusabu <º)))><"
"""Cartelle con modelli BIM (26/11/2026): GET /projects/{id}/containers dice quali cartelle ne
contengono (`has_bim`), così il frontend le disegna con un'icona propria.

Conta l'estensione del nome originale delle revisioni (.ifc, .rvt, .nwd, …) dei documenti non
archiviati, solo nella cartella che li contiene davvero: la cartella madre non eredita il segno."""
from __future__ import annotations

from test_api_documents import PDF, des_name, upload
from test_api_naming_auto import as_user  # noqa: F401 - fixture riusata


def _bim(client, w, headers) -> dict:
    r = client.get(f"/projects/{w.project_id}/containers", headers=headers)
    assert r.status_code == 200, r.text
    return {c["id"]: c["has_bim"] for c in r.json()}


def test_cartella_con_modello_bim(client, api_world, as_user):  # noqa: F811
    _, w = api_world
    lead = as_user("des_lead")
    arch, root = str(w.containers["des_arch"]), str(w.containers["des_root"])

    # una tavola PDF non basta
    assert upload(client, lead, arch, des_name(), PDF, title="Pianta").status_code == 200
    prima = _bim(client, w, lead)
    assert prima[arch] is False and prima[root] is False

    # un modello IFC (estensione in maiuscolo: conta lo stesso) segna la sua cartella, non la madre
    nome = des_name(ext="IFC").replace("-DR-", "-M3-")
    modello = upload(client, lead, arch, nome, b"ISO-10303-21;\nHEADER;\nENDSEC;\nEND-ISO-10303-21;\n", title="Modello architettonico")
    assert modello.status_code == 200, modello.text
    dopo = _bim(client, w, lead)
    assert dopo[arch] is True and dopo[root] is False
    # anche la lettura della singola cartella porta il segno
    assert client.get(f"/containers/{arch}", headers=lead).json()["has_bim"] is True
