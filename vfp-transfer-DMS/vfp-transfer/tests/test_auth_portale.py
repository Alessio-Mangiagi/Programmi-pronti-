# "><(((º> sabusabu <º)))><"
"""Login con la password del Portale Suite Cosedil (auth.login -> shared/sso/cosedil_sso.verifica_password).

Il portale e' finto: cosedil_sso.verifica_password viene sostituita, quindi il portale vero non viene mai
chiamato e i tentativi sbagliati dei test non finiscono nei suoi contatori. Gli utenti stanno in memoria.
"""

import sys
import unittest
from unittest import mock

from tests import ROOT  # noqa: F401  (mette la cartella del programma nel sys.path)
import auth

if str(auth._SSO) not in sys.path:
    sys.path.insert(0, str(auth._SSO))
import cosedil_sso  # noqa: E402

UTENTI = {
    "Mario": {"role": "admin", "hash": auth.hash_password("Locale-Mario-1"), "email": ""},
    "segreteria": {"role": "utente", "hash": auth.hash_password("Locale-Segr-1"), "email": "laura@cosedilspa.com",
                   "area": "posta"},
}


def portale_finto(chiamate):
    """mario.rossi / Portale-2026! (email dedotta); laura ha l'email della segreteria di qui."""
    conti = {
        "mario": {"username": "mario", "email": "mario@cosedilspa.com"},
        "laura": {"username": "laura", "email": "laura@cosedilspa.com"},
        "gino": {"username": "gino", "email": "gino@cosedilspa.com"},
    }

    def verifica(login, password, app_id, ip=None, timeout=4):
        chiamate.append({"login": login, "app": app_id, "ip": ip})
        chi = conti.get(login.lower().split("@")[0])
        if chi and password == "Portale-2026!":
            return {"ok": True, "reachable": True, "status": 200, "nome": login, "ruolo": "utente", "admin": False, **chi}
        return {"ok": False, "reachable": True, "status": 401, "errore": "Credenziali non valide", "motivo": ""}
    return verifica


class LoginConPasswordDelPortale(unittest.TestCase):
    def setUp(self):
        self.chiamate = []
        auth._failures.clear()
        self.patches = [
            mock.patch.object(auth, "load_users", lambda: {k: dict(v) for k, v in UTENTI.items()}),
            mock.patch.object(auth, "_save_users", lambda users: None),
            mock.patch.object(auth.attivita, "record", lambda *a, **k: None),
            mock.patch.object(cosedil_sso, "verifica_password", portale_finto(self.chiamate)),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        auth._failures.clear()
        auth._sessions.clear()

    def test_password_locale_resta_valida_senza_chiamare_il_portale(self):
        token, ruolo = auth.login("mario", "Locale-Mario-1", ip="10.0.0.5")
        self.assertEqual(ruolo, "admin")
        self.assertEqual(self.chiamate, [])

    def test_password_del_portale_stesso_nome(self):
        token, ruolo = auth.login("mario", "Portale-2026!", ip="10.0.0.5")
        self.assertEqual(auth.session(token)["user"], "Mario")
        self.assertEqual(ruolo, "admin", "il ruolo resta quello di VFP Transfer")
        self.assertEqual(self.chiamate, [{"login": "mario", "app": "vfp-transfer", "ip": "10.0.0.5"}])

    def test_password_del_portale_stessa_email(self):
        # nel portale e' "laura", qui l'utente si chiama "segreteria" ma ha la sua email
        token, ruolo = auth.login("laura@cosedilspa.com", "Portale-2026!")
        self.assertEqual(auth.session(token)["user"], "segreteria")
        self.assertEqual(auth.session(token)["area"], "posta")

    def test_utente_del_portale_senza_utente_qui_resta_fuori(self):
        with self.assertRaises(auth.AuthError):
            auth.login("gino", "Portale-2026!")

    def test_password_sbagliata_ovunque_conta_e_blocca(self):
        for _ in range(auth.MAX_FAILURES):
            with self.assertRaises(auth.AuthError):
                auth.login("mario", "sbagliata")
        with self.assertRaisesRegex(auth.AuthError, "Troppi tentativi"):
            auth.login("mario", "Portale-2026!")

    def test_portale_spento_resta_la_password_locale(self):
        giu = {"ok": False, "reachable": False, "status": 0, "errore": "Portale non raggiungibile", "motivo": ""}
        with mock.patch.object(cosedil_sso, "verifica_password", lambda *a, **k: giu):
            with self.assertRaises(auth.AuthError):
                auth.login("mario", "Portale-2026!")
            auth.login("mario", "Locale-Mario-1")


if __name__ == "__main__":
    unittest.main()
