# "><(((º> sabusabu <º)))><"
"""Un solo login nella suite (09/11/2026): chi apre l'interfaccia con la sessione del Portale entra senza scrivere
nulla (auth.ingresso_dal_portale, vfp_gui.do_GET). Dall'11/11/2026 il profilo del portale vale anche qui: utente
creato a chi e' abilitato, amministratore dato e tolto dal portale, nome ed email aggiornati, collegamento per
username (cosi' un cambio di email non crea un secondo utente).

Il portale e' finto (cosedil_sso.verifica_sessione e auth.profilo_portale sostituite): quello vero non viene mai
chiamato. Gli utenti stanno in un dizionario in memoria; il registro attivita' e' spento. Il server HTTP e' vero,
su una porta libera."""

import sys
import threading
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from tests import ROOT  # noqa: F401  (mette la cartella del programma nel sys.path)
import auth
import vfp_gui

if str(auth._SSO) not in sys.path:
    sys.path.insert(0, str(auth._SSO))
import cosedil_sso  # noqa: E402

PERSONE = {
    "sid-admin": {"username": "a.capo", "email": "a.capo@cosedilspa.com", "ruolo": "admin", "admin": True},
    "sid-utente": {"username": "laura", "email": "laura@cosedilspa.com", "ruolo": "utente", "admin": False},
    "sid-ip": {"username": "gino", "email": "gino@cosedilspa.com", "ruolo": "utente", "admin": True},
    "sid-nuovo": {"username": "piero", "email": "piero@cosedilspa.com", "ruolo": "utente", "admin": False},
    "sid-ex": {"username": "boss", "email": "boss@cosedilspa.com", "ruolo": "utente", "admin": False},
    "sid-no": {"username": "carlo", "email": "carlo@cosedilspa.com", "ruolo": "utente", "admin": False},
}


def profilo(username, **extra):
    """Profilo del portale finto, come lo restituisce auth.profilo_portale (POST /api/suite/profilo)."""
    p = next(x for x in PERSONE.values() if x["username"] == username)
    base = {"raggiungibile": True, "trovato": True, "errore": "", "username": username,
            "nome": username.title(), "email": p["email"], "ruolo": p["ruolo"], "admin": p["ruolo"] == "admin",
            "proprietario": False, "disattivato": False, "must_change": False, "abilitato": username != "carlo"}
    base.update(extra)
    return base


def utenti_iniziali():
    return {
        "segreteria": {"role": "utente", "hash": auth.hash_password("Locale-Segr-1"), "email": "laura@cosedilspa.com",
                       "area": "posta"},
        "gino": {"role": "utente", "hash": auth.hash_password("Locale-Gino-1"), "email": "", "area": "mezzi"},
        "A.Capo": {"role": "utente", "hash": auth.hash_password("Locale-Capo-1"), "email": "", "area": "documenti"},
        "boss": {"role": "admin", "hash": auth.hash_password("Locale-Boss-1"), "email": "", "area": "documenti"},
    }


class _Base(unittest.TestCase):
    def setUp(self):
        self.utenti = utenti_iniziali()
        self.cookie_al_portale = []

        def verifica(cookie, app_id=""):
            self.cookie_al_portale.append((cookie, app_id))
            sid = cookie.split("sid=", 1)[1].split(";")[0] if "sid=" in cookie else ""
            p = PERSONE.get(sid)
            if not p:
                return {"ok": False, "reachable": True, "admin": False, "username": None, "ruolo": None, "email": None}
            return {"ok": True, "reachable": True, "nome": p["username"], **p}

        # profilo del portale: quello di PERSONE, cambiabile per test (self.profili[username] = {...})
        self.profili = {}
        self.portale_su = True

        def profilo_finto(login, timeout=3):
            if not self.portale_su:
                return {"raggiungibile": False, "trovato": False, "errore": "Portale non raggiungibile"}
            login = (login or "").lower()
            for x in PERSONE.values():
                if login in (x["username"], x["email"]):
                    return self.profili.get(x["username"]) or profilo(x["username"])
            return {"raggiungibile": True, "trovato": False, "errore": ""}

        self.patches = [
            mock.patch.object(auth, "profilo_portale", profilo_finto),
            mock.patch.object(auth, "load_users", lambda: {k: dict(v) for k, v in self.utenti.items()}),
            mock.patch.object(auth, "_save_users", lambda users: self.utenti.update({k: dict(v) for k, v in users.items()})),
            mock.patch.object(auth.attivita, "record", lambda *a, **k: None),
            mock.patch.object(cosedil_sso, "verifica_sessione", verifica),
            mock.patch.object(cosedil_sso, "ENABLED", True),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        auth._sessions.clear()


class IngressoDalPortale(_Base):
    def test_admin_del_portale_con_utente_qui_e_promosso_ad_amministratore(self):
        token, ruolo, nome = auth.ingresso_dal_portale("sid=sid-admin; vfp_sessione=vecchia")
        self.assertEqual((ruolo, nome), ("admin", "A.Capo"))
        self.assertEqual(self.utenti["A.Capo"]["role"], "admin")
        self.assertEqual(auth.session(token)["role"], "admin")
        self.assertEqual(auth.session(token)["portale"], "a.capo", "la sessione ricorda l'identita' del portale")
        self.assertEqual(self.utenti["A.Capo"]["portale"], "a.capo")
        # utente nato qui e promosso dal portale: la sua password di qui non vale piu' (chi l'ha creato la conosceva)
        with self.assertRaises(auth.AuthError):
            auth.login("A.Capo", "Locale-Capo-1")

    def test_admin_del_portale_senza_utente_qui_viene_creato_amministratore(self):
        del self.utenti["A.Capo"]
        token, ruolo, nome = auth.ingresso_dal_portale("sid=sid-admin")
        self.assertEqual((ruolo, nome), ("admin", "a.capo"))
        self.assertEqual(self.utenti["a.capo"]["role"], "admin")
        self.assertEqual(self.utenti["a.capo"]["email"], "a.capo@cosedilspa.com")
        self.assertEqual((self.utenti["a.capo"]["origine"], self.utenti["a.capo"]["portale"]), ("portale", "a.capo"))
        # nessuno conosce la password dell'utente creato
        with self.assertRaises(auth.AuthError):
            auth.login("a.capo", "")

    def test_utente_del_portale_entra_con_il_suo_ruolo_e_la_sua_area(self):
        token, ruolo, nome = auth.ingresso_dal_portale("sid=sid-utente")
        self.assertEqual((ruolo, nome), ("utente", "segreteria"))
        self.assertEqual(auth.session(token)["area"], "posta")
        self.assertEqual(self.utenti["segreteria"]["role"], "utente")

    def test_utente_abilitato_senza_utente_qui_viene_creato_utente_normale(self):
        # 11/11/2026: non solo gli amministratori; ruolo utente, area predefinita (le aree le da' l'admin di qui)
        token, ruolo, nome = auth.ingresso_dal_portale("sid=sid-nuovo")
        self.assertEqual((ruolo, nome), ("utente", "piero"))
        u = self.utenti["piero"]
        self.assertEqual((u["role"], u["area"], u["origine"], u["portale"]), ("utente", "documenti", "portale", "piero"))
        self.assertEqual((u["email"], u["nome"]), ("piero@cosedilspa.com", "Piero"))

    def test_non_abilitato_o_disattivato_resta_fuori(self):
        self.assertIsNone(auth.ingresso_dal_portale("sid=sid-no"))   # carlo: VFP Transfer non spuntato
        self.assertNotIn("carlo", self.utenti)
        self.profili["laura"] = profilo("laura", disattivato=True)
        self.assertIsNone(auth.ingresso_dal_portale("sid=sid-utente"))

    def test_admin_tolto_quando_il_portale_non_lo_da_piu(self):
        token, ruolo, nome = auth.ingresso_dal_portale("sid=sid-ex")
        self.assertEqual((ruolo, nome), ("utente", "boss"))
        self.assertEqual(self.utenti["boss"]["role"], "utente")
        # la password di qui resta (togliere l'admin non apre nessuna strada)
        self.assertEqual(auth.login("boss", "Locale-Boss-1")[1], "utente")

    def test_email_cambiata_nel_portale_stesso_utente_aggiornato(self):
        auth.ingresso_dal_portale("sid=sid-utente")                  # laura -> segreteria (stessa email), collegata
        self.profili["laura"] = profilo("laura", email="laura.nuova@cosedilspa.com", nome="Laura Neri")
        token, ruolo, nome = auth.ingresso_dal_portale("sid=sid-utente")
        self.assertEqual(nome, "segreteria", "collegata per username: niente secondo utente")
        self.assertEqual(self.utenti["segreteria"]["email"], "laura.nuova@cosedilspa.com")
        self.assertEqual(self.utenti["segreteria"]["nome"], "Laura Neri")
        self.assertNotIn("laura", self.utenti)

    def test_portale_senza_rotta_del_profilo_come_prima(self):
        # portale di una versione precedente: si entra con i dati di /api/verify, un utente nuovo solo all'admin
        self.portale_su = False
        self.assertIsNone(auth.ingresso_dal_portale("sid=sid-nuovo"))
        self.assertNotIn("piero", self.utenti)
        token, ruolo, nome = auth.ingresso_dal_portale("sid=sid-utente")
        self.assertEqual((ruolo, nome), ("utente", "segreteria"))

    def test_admin_solo_da_regola_ip_non_promosso(self):
        token, ruolo, nome = auth.ingresso_dal_portale("sid=sid-ip")
        self.assertEqual((ruolo, nome), ("utente", "gino"))
        self.assertEqual(self.utenti["gino"]["role"], "utente")

    def test_senza_sessione_del_portale_o_sso_spento(self):
        self.assertIsNone(auth.ingresso_dal_portale(""))
        self.assertIsNone(auth.ingresso_dal_portale("sid=sconosciuto"))
        with mock.patch.object(cosedil_sso, "ENABLED", False):
            self.assertIsNone(auth.ingresso_dal_portale("sid=sid-admin"))

    def test_al_portale_va_solo_il_sid(self):
        auth.ingresso_dal_portale("vfp_sessione=segreta; sid=sid-utente; altro=x")
        self.assertEqual(self.cookie_al_portale, [("sid=sid-utente", "vfp-transfer")])


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


class PagineDalPortale(_Base):
    """Server vero: GET / con il cookie del portale porta dentro (302 + cookie di sessione)."""

    def setUp(self):
        super().setUp()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), vfp_gui.Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.opener = build_opener(_NoRedirect)

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        super().tearDown()

    def _get(self, path, cookie=""):
        try:
            r = self.opener.open(Request(self.base + path, headers={"Cookie": cookie, "Host": "localhost"}))
            return r.status, dict(r.headers)
        except HTTPError as e:
            return e.code, dict(e.headers)

    def test_pagina_principale_con_la_sessione_del_portale_entra(self):
        code, h = self._get("/", "sid=sid-admin")
        self.assertEqual(code, 302)
        self.assertEqual(h["Location"], "/")
        self.assertIn(vfp_gui.SESSION_COOKIE + "=", h["Set-Cookie"])

    def test_login_con_la_sessione_del_portale_entra_ma_non_dopo_esci(self):
        code, h = self._get("/login.html", "sid=sid-utente")
        self.assertEqual((code, h.get("Location")), (302, "/"))
        code, h = self._get("/login.html?uscito=1", "sid=sid-utente")
        self.assertEqual(code, 200)
        self.assertNotIn("Set-Cookie", h)

    def test_senza_portale_si_va_al_login_di_sempre(self):
        code, h = self._get("/", "sid=sconosciuto")
        self.assertEqual((code, h.get("Location")), (302, "/login.html"))
        self.assertNotIn("Set-Cookie", h)


if __name__ == "__main__":
    unittest.main()
