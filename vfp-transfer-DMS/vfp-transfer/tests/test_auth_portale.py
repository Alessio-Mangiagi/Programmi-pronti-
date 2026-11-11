# "><(((º> sabusabu <º)))><"
"""Login con la password del Portale Suite Cosedil (auth.login -> shared/sso/cosedil_sso.verifica_password) e,
dall'11/11/2026, profilo del portale chiesto a ogni login (auth._controllo_al_login, scelte "2b 3b"):
disattivato o non abilitato -> fuori; portale spento -> dentro con traccia; l'amministratore lo decide il portale
(con la sola password di qui si puo' solo togliere, mai dare).

Il portale e' finto: cosedil_sso.verifica_password e auth.profilo_portale vengono sostituite, quindi il portale vero
non viene mai chiamato e i tentativi sbagliati dei test non finiscono nei suoi contatori. Gli utenti stanno in
memoria.
"""

import sys
import unittest
from unittest import mock

from tests import ROOT  # noqa: F401  (mette la cartella del programma nel sys.path)
import auth

if str(auth._SSO) not in sys.path:
    sys.path.insert(0, str(auth._SSO))
import cosedil_sso  # noqa: E402


def utenti_iniziali():
    return {
        "Mario": {"role": "admin", "hash": auth.hash_password("Locale-Mario-1"), "email": ""},
        "segreteria": {"role": "utente", "hash": auth.hash_password("Locale-Segr-1"), "email": "laura@cosedilspa.com",
                       "area": "posta"},
        # utente di qui con il nome di un amministratore del portale: con la sola password di qui non diventa admin
        "titolare": {"role": "utente", "hash": auth.hash_password("Locale-Tito-1"), "email": "", "area": "documenti"},
        # utente solo di qui: il portale non lo conosce
        "magazzino": {"role": "utente", "hash": auth.hash_password("Locale-Maga-1"), "email": "", "area": "mezzi"},
        # collegato a un utente del portale che poi e' stato eliminato
        "ex.collega": {"role": "utente", "hash": auth.hash_password("Locale-Excol-1"), "email": "",
                       "portale": "ex.collega"},
    }


# profili del portale (POST /api/suite/profilo) per username
PROFILI = {
    "mario": {"ruolo": "admin", "email": "mario@cosedilspa.com"},
    "laura": {"ruolo": "utente", "email": "laura@cosedilspa.com"},
    "gino": {"ruolo": "utente", "email": "gino@cosedilspa.com"},
    "titolare": {"ruolo": "admin", "email": "titolare@cosedilspa.com", "proprietario": True},
}


def profilo(username, **extra):
    d = PROFILI[username]
    base = {"raggiungibile": True, "trovato": True, "errore": "", "username": username, "nome": username.title(),
            "email": d["email"], "ruolo": d["ruolo"], "admin": d["ruolo"] == "admin",
            "proprietario": d.get("proprietario", False), "disattivato": False, "must_change": False,
            "abilitato": True}
    base.update(extra)
    return base


def portale_finto(chiamate):
    """mario.rossi / Portale-2026! (email dedotta); laura ha l'email della segreteria di qui."""
    def verifica(login, password, app_id, ip=None, timeout=4):
        chiamate.append({"login": login, "app": app_id, "ip": ip})
        chi = PROFILI.get(login.lower().split("@")[0])
        if chi and password == "Portale-2026!":
            u = login.lower().split("@")[0]
            return {"ok": True, "reachable": True, "status": 200, "nome": login, "username": u, "email": chi["email"],
                    "ruolo": chi["ruolo"], "admin": chi["ruolo"] == "admin"}
        return {"ok": False, "reachable": True, "status": 401, "errore": "Credenziali non valide", "motivo": ""}
    return verifica


class _Base(unittest.TestCase):
    def setUp(self):
        self.chiamate = []
        self.profili = {}            # profili cambiati per un test: username -> profilo
        self.portale_su = True
        self.registro = []
        self.utenti = utenti_iniziali()
        auth._failures.clear()

        def profilo_finto(login, timeout=3):
            if not self.portale_su:
                return {"raggiungibile": False, "trovato": False, "errore": "Portale non raggiungibile"}
            login = (login or "").lower()
            for u, d in PROFILI.items():
                if login in (u, d["email"]):
                    return self.profili.get(u) or profilo(u)
            return {"raggiungibile": True, "trovato": False, "errore": ""}

        self.patches = [
            mock.patch.object(auth, "load_users", lambda: {k: dict(v) for k, v in self.utenti.items()}),
            mock.patch.object(auth, "_save_users", lambda users: self.utenti.update({k: dict(v) for k, v in users.items()})),
            mock.patch.object(auth.attivita, "record", lambda *a, **k: self.registro.append(a)),
            mock.patch.object(auth, "_log_line", lambda testo: None),
            mock.patch.object(cosedil_sso, "verifica_password", portale_finto(self.chiamate)),
            mock.patch.object(auth, "profilo_portale", profilo_finto),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        auth._failures.clear()
        auth._sessions.clear()


class LoginConPasswordDelPortale(_Base):
    def test_password_locale_resta_valida_senza_chiamare_la_verifica_della_password(self):
        token, ruolo = auth.login("mario", "Locale-Mario-1", ip="10.0.0.5")
        self.assertEqual(ruolo, "admin")           # mario e' amministratore anche nel portale
        self.assertEqual(self.chiamate, [])
        self.assertIsNone(auth.session(token)["portale"], "con la password di qui l'identita' del portale non c'e'")

    def test_password_del_portale_stesso_nome(self):
        token, ruolo = auth.login("mario", "Portale-2026!", ip="10.0.0.5")
        self.assertEqual(auth.session(token)["user"], "Mario")
        self.assertEqual(ruolo, "admin")
        self.assertEqual(self.chiamate, [{"login": "mario", "app": "vfp-transfer", "ip": "10.0.0.5"}])
        self.assertEqual(auth.session(token)["portale"], "mario")
        self.assertEqual(self.utenti["Mario"]["portale"], "mario", "collegato al portale")

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
        self.portale_su = False
        with mock.patch.object(cosedil_sso, "verifica_password", lambda *a, **k: giu):
            with self.assertRaises(auth.AuthError):
                auth.login("mario", "Portale-2026!")
            auth.login("mario", "Locale-Mario-1")


class ProfiloDelPortaleAlLogin(_Base):
    """Scelte 2b (solo al login) e 3b (password di qui valide, ma il portale decide chi entra)."""

    def test_disattivato_nel_portale_fuori_anche_con_la_password_di_qui(self):
        self.profili["mario"] = profilo("mario", disattivato=True, admin=False)
        with self.assertRaisesRegex(auth.AuthError, "disattivato"):
            auth.login("mario", "Locale-Mario-1")
        self.assertIn(("Mario", "sicurezza", "Accesso negato dal Portale"), [a[:3] for a in self.registro])

    def test_non_abilitato_nel_portale_fuori(self):
        self.profili["laura"] = profilo("laura", abilitato=False)
        with self.assertRaisesRegex(auth.AuthError, "non è fra i tuoi programmi"):
            auth.login("segreteria", "Locale-Segr-1")     # trovata nel portale per email

    def test_rifiuto_del_portale_non_conta_come_password_sbagliata(self):
        self.profili["mario"] = profilo("mario", disattivato=True, admin=False)
        for _ in range(auth.MAX_FAILURES + 1):
            with self.assertRaisesRegex(auth.AuthError, "disattivato"):
                auth.login("mario", "Locale-Mario-1")

    def test_portale_spento_si_entra_con_traccia(self):
        self.portale_su = False
        token, ruolo = auth.login("mario", "Locale-Mario-1")
        self.assertEqual(ruolo, "admin")
        self.assertIn(("Mario", "sicurezza", "Accesso senza verifica del Portale"), [a[:3] for a in self.registro])

    def test_admin_tolto_al_login_con_la_password_di_qui(self):
        self.profili["mario"] = profilo("mario", ruolo="utente", admin=False)
        token, ruolo = auth.login("mario", "Locale-Mario-1")
        self.assertEqual(ruolo, "utente")
        self.assertEqual(self.utenti["Mario"]["role"], "utente")

    def test_admin_mai_dato_con_la_sola_password_di_qui(self):
        # "titolare" e' amministratore (e proprietario) nel portale, ma qui si entra con la password di qui:
        # l'identita' non e' confermata, quindi niente admin e niente collegamento
        token, ruolo = auth.login("titolare", "Locale-Tito-1")
        self.assertEqual(ruolo, "utente")
        self.assertNotIn("portale", self.utenti["titolare"])
        self.assertFalse(auth.e_proprietario(auth.session(token)))

    def test_admin_dato_con_la_password_del_portale(self):
        token, ruolo = auth.login("titolare", "Portale-2026!")
        self.assertEqual(ruolo, "admin")
        self.assertEqual(self.utenti["titolare"]["portale"], "titolare")
        # utente nato qui promosso dal portale: la password di qui non vale piu'
        with self.assertRaises(auth.AuthError):
            auth.login("titolare", "Locale-Tito-1")

    def test_utente_solo_di_qui_non_toccato(self):
        token, ruolo = auth.login("magazzino", "Locale-Maga-1")
        self.assertEqual(ruolo, "utente")
        self.assertEqual(auth.session(token)["area"], "mezzi")

    def test_collegato_a_utente_eliminato_dal_portale_fuori(self):
        with self.assertRaisesRegex(auth.AuthError, "non esiste più"):
            auth.login("ex.collega", "Locale-Excol-1")


if __name__ == "__main__":
    unittest.main()
