# "><(((º> sabusabu <º)))><"
"""Admin del portale = admin dello Scadenzario (regola della suite del 09/11/2026).

e_admin() legge l'identità messa dal gate SSO in flask.g.cosedil. Qui la si imposta a mano, con il gate
"acceso" (cosedil_sso.ENABLED forzato a True) e SCADENZARIO_ADMIN impostato su un altro nome: un
amministratore del portale resta admin, chi è admin per l'app solo da regola IP no, chi non è admin no."""
import pytest
from flask import g

import app as modulo_app
import config

cosedil_sso = modulo_app.cosedil_sso      # app.py mette shared/sso nel percorso prima di importarlo


@pytest.fixture()
def gate_acceso(monkeypatch):
    monkeypatch.setattr(cosedil_sso, "ENABLED", True)
    monkeypatch.setattr(config, "ADMIN_UTENTI", ("m.rossi",))


def _admin(identita):
    with modulo_app.app.test_request_context("/api/me"):
        g.cosedil = identita
        return modulo_app.e_admin()


def test_admin_del_portale_e_admin_anche_fuori_da_scadenzario_admin(gate_acceso):
    assert _admin({"ok": True, "username": "a.mangiagi", "ruolo": "admin", "admin": True}) is True


def test_admin_solo_da_regola_ip_resta_legato_all_elenco(gate_acceso):
    # admin per l'app concesso dall'IP (ruolo utente nel portale): conta ancora SCADENZARIO_ADMIN
    assert _admin({"ok": True, "username": "l.bianchi", "ruolo": "utente", "admin": True}) is False
    assert _admin({"ok": True, "username": "m.rossi", "ruolo": "utente", "admin": True}) is True


def test_utente_normale_non_diventa_admin(gate_acceso):
    assert _admin({"ok": True, "username": "g.verdi", "ruolo": "utente", "admin": False}) is False
    # anche se il portale scrivesse ruolo admin ma admin=False per l'app (incoerente): niente diritti
    assert _admin({"ok": True, "username": "g.verdi", "ruolo": "admin", "admin": False}) is False
