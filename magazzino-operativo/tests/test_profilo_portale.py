# "><(((º> sabusabu <º)))><"
"""Profilo del portale valido nel Magazzino (decisione dell'utente dell'11/11/2026).

e_admin() con il gate acceso: l'amministratore del portale (ruolo "admin") è admin del Magazzino anche
quando MAGAZZINO_ADMIN è impostata e non lo nomina; chi è admin solo per una regola IP del portale
(admin: true, ruolo "utente") resta legato all'elenco, come prima. Stessa regola dello Scadenzario.
"""
import pytest

import app as modulo_app
import config


@pytest.fixture
def gate_acceso(monkeypatch):
    """Gate SSO acceso e identità del portale finta (quella che metterebbe g.cosedil)."""
    monkeypatch.setattr(modulo_app.cosedil_sso, "ENABLED", True)
    identita = {}
    monkeypatch.setattr(modulo_app, "utente_corrente", lambda: identita or None)
    return identita


def test_admin_del_portale_sempre_admin_anche_con_elenco(gate_acceso, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_UTENTI", {"m.russo"})
    gate_acceso.update(username="a.mangiagi", ruolo="admin", admin=True)
    assert modulo_app.e_admin() is True


def test_admin_per_regola_ip_resta_legato_all_elenco(gate_acceso, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_UTENTI", {"m.russo"})
    gate_acceso.update(username="g.ferrante", ruolo="utente", admin=True)     # admin solo da regola IP
    assert modulo_app.e_admin() is False
    gate_acceso.update(username="m.russo")
    assert modulo_app.e_admin() is True
    monkeypatch.setattr(config, "ADMIN_UTENTI", set())                         # elenco vuoto: basta il portale
    gate_acceso.update(username="g.ferrante")
    assert modulo_app.e_admin() is True


def test_non_admin_nel_portale_mai_admin(gate_acceso, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_UTENTI", {"s.grasso"})
    gate_acceso.update(username="s.grasso", ruolo="utente", admin=False)     # nell'elenco ma non admin nel portale
    assert modulo_app.e_admin() is False
