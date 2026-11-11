# "><(((º> sabusabu <º)))><"
"""Amministratori gestiti solo dal proprietario della suite (decisione dell'utente dell'11/11/2026: "gli admin li
creo e li cancello solo io") e chiamata vera a POST /api/suite/profilo.

- auth.controlla_modifica_utente / vfp_gui.api_users_save: creare un amministratore, dare o togliere il ruolo,
  eliminare un amministratore o cambiargli password/email/area -> solo il proprietario, riconosciuto dal portale
  adesso e solo con una sessione aperta con l'identita' del portale; il ruolo degli utenti collegati al portale
  non si cambia qui. Il rifiuto arriva prima del codice via email.
- auth.profilo_portale: richiesta HTTP vera verso un portale finto su una porta libera (token, corpo, risposte
  200 / trovato false / 403 / 404 / portale spento).
"""

import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

from tests import ROOT  # noqa: F401  (mette la cartella del programma nel sys.path)
import auth
import vfp_gui

if str(auth._SSO) not in sys.path:
    sys.path.insert(0, str(auth._SSO))
import cosedil_sso  # noqa: E402

HASH = "pbkdf2_sha256$1$00$00"  # mai usato per entrare: qui si provano solo le regole


def utenti_iniziali():
    return {
        "titolare": {"role": "admin", "hash": HASH, "email": "", "portale": "titolare"},
        "vice": {"role": "admin", "hash": HASH, "email": "", "portale": "vice"},
        "locale.admin": {"role": "admin", "hash": HASH, "email": ""},
        "laura": {"role": "utente", "hash": HASH, "email": "", "area": "posta", "portale": "laura"},
        "magazzino": {"role": "utente", "hash": HASH, "email": "", "area": "mezzi"},
    }


def sess(user, portale=None):
    return {"user": user, "role": "admin", "portale": portale}


class RegoleSugliAmministratori(unittest.TestCase):
    def setUp(self):
        self.utenti = utenti_iniziali()
        self.portale_su = True
        self.chieste = []

        def profilo_finto(login, timeout=3):
            self.chieste.append(login)
            if not self.portale_su:
                return {"raggiungibile": False, "trovato": False, "errore": "Portale non raggiungibile"}
            return {"raggiungibile": True, "trovato": True, "username": login, "proprietario": login == "titolare",
                    "admin": login in ("titolare", "vice"), "disattivato": False, "abilitato": True}

        self.patches = [
            mock.patch.object(auth, "load_users", lambda: {k: dict(v) for k, v in self.utenti.items()}),
            mock.patch.object(auth, "profilo_portale", profilo_finto),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def ok(self, s, *args):
        auth.controlla_modifica_utente(s, *args)

    def no(self, s, *args, msg=auth.MSG_SOLO_PROPRIETARIO):
        with self.assertRaisesRegex(ValueError, msg):
            auth.controlla_modifica_utente(s, *args)

    def test_il_proprietario_gestisce_gli_amministratori(self):
        capo = sess("titolare", "titolare")
        self.ok(capo, "add", "nuovo.admin", "admin")
        self.ok(capo, "update", "magazzino", "admin")
        self.ok(capo, "update", "locale.admin", "utente")
        self.ok(capo, "delete", "vice")
        self.ok(capo, "password", "vice")
        self.assertEqual(self.chieste[0], "titolare", "chiesto al portale con lo username della sessione")

    def test_un_altro_amministratore_non_crea_ne_tocca_amministratori(self):
        vice = sess("vice", "vice")
        self.no(vice, "add", "nuovo.admin", "admin")
        self.no(vice, "update", "magazzino", "admin")         # dare l'admin
        self.no(vice, "update", "locale.admin", "utente")     # toglierlo
        self.no(vice, "delete", "locale.admin")
        self.no(vice, "password", "titolare")                 # prendere l'utente di un admin
        self.no(vice, "update", "locale.admin", None)         # email o area di un altro admin

    def test_un_altro_amministratore_gestisce_gli_utenti_normali_e_la_sua_password(self):
        vice = sess("vice", "vice")
        self.ok(vice, "add", "nuovo.utente", "utente")
        self.ok(vice, "update", "magazzino", None)            # area / email
        self.ok(vice, "password", "magazzino")
        self.ok(vice, "delete", "magazzino")
        self.ok(vice, "password", "vice")                     # la propria
        self.assertEqual(self.chieste, [], "per gli utenti normali il portale non serve")

    def test_ruolo_degli_utenti_collegati_lo_decide_il_portale(self):
        capo = sess("titolare", "titolare")
        self.no(capo, "update", "laura", "admin", msg="Ruolo deciso dal Portale")
        self.no(capo, "update", "vice", "utente", msg="Ruolo deciso dal Portale")
        self.ok(sess("vice", "vice"), "update", "laura", None)   # l'area si', la sceglie l'admin di qui

    def test_senza_identita_del_portale_non_si_e_proprietari(self):
        # entrato con la password di qui con il nome del proprietario: non basta
        self.no(sess("titolare", None), "add", "nuovo.admin", "admin")
        self.assertEqual(self.chieste, [])

    def test_portale_spento_si_rifiuta(self):
        self.portale_su = False
        self.no(sess("titolare", "titolare"), "add", "nuovo.admin", "admin")


class ApiUtenti(unittest.TestCase):
    """vfp_gui.api_users_save: rifiuto prima del codice via email, traccia nel registro; api_users con il flag."""

    def setUp(self):
        self.utenti = utenti_iniziali()
        self.registro = []
        self.codici = []
        self.patches = [
            mock.patch.object(auth, "load_users", lambda: {k: dict(v) for k, v in self.utenti.items()}),
            mock.patch.object(auth, "profilo_portale", lambda login, timeout=3: {
                "raggiungibile": True, "trovato": True, "username": login, "proprietario": login == "titolare",
                "admin": True, "disattivato": False, "abilitato": True}),
            mock.patch.object(auth, "require_approval", lambda *a, **k: self.codici.append(a)),
            mock.patch.object(auth, "add_user", lambda *a, **k: None),
            mock.patch.object(vfp_gui.attivita, "record", lambda *a, **k: self.registro.append(a)),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_rifiuto_prima_del_codice_e_registrato(self):
        with self.assertRaisesRegex(ValueError, auth.MSG_SOLO_PROPRIETARIO):
            vfp_gui.api_users_save({"action": "add", "name": "nuovo", "role": "admin", "password": "x" * 12},
                                   sess("vice", "vice"))
        self.assertEqual(self.codici, [], "nessun codice inviato per una modifica rifiutata")
        self.assertEqual(self.registro[-1][:3], ("vice", "sicurezza", "Modifica utente negata"))
        self.assertEqual(self.registro[-1][4], "negato")

    def test_il_proprietario_passa_al_codice(self):
        out = vfp_gui.api_users_save({"action": "add", "name": "nuovo", "role": "admin", "password": "x" * 12},
                                     sess("titolare", "titolare"))
        self.assertEqual(len(self.codici), 1)
        self.assertTrue(out["proprietario"])

    def test_elenco_con_il_flag_del_proprietario_e_il_collegamento(self):
        d = vfp_gui.api_users(sess("vice", "vice"))
        self.assertFalse(d["proprietario"])
        self.assertTrue(d["dal_portale"])
        self.assertEqual(d["msg_proprietario"], auth.MSG_SOLO_PROPRIETARIO)
        laura = next(u for u in d["users"] if u["name"] == "laura")
        self.assertEqual(laura["portale"], "laura")
        self.assertTrue(vfp_gui.api_users(sess("titolare", "titolare"))["proprietario"])
        self.assertFalse(vfp_gui.api_users(sess("titolare", None))["dal_portale"])


# --------------------------------------------------------------------------- POST /api/suite/profilo vero

class _PortaleFinto(BaseHTTPRequestHandler):
    ricevute = []
    risposta = (200, {})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        _PortaleFinto.ricevute.append((self.path, dict(self.headers), json.loads(self.rfile.read(n) or b"{}")))
        stato, corpo = _PortaleFinto.risposta
        dati = json.dumps(corpo).encode()
        self.send_response(stato)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dati)))
        self.end_headers()
        self.wfile.write(dati)

    def log_message(self, *a):
        pass


class ProfiloPortaleHttp(unittest.TestCase):
    def setUp(self):
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _PortaleFinto)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        _PortaleFinto.ricevute = []
        self.patches = [
            mock.patch.object(cosedil_sso, "PORTAL", f"http://127.0.0.1:{self.server.server_address[1]}"),
            mock.patch.object(cosedil_sso, "ENABLED", True),
            mock.patch.object(cosedil_sso, "_token_suite", lambda: "token-di-prova"),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.server.shutdown()
        self.server.server_close()

    def test_profilo_trovato(self):
        _PortaleFinto.risposta = (200, {"ok": True, "trovato": True, "username": "laura", "nome": "Laura Neri",
                                        "email": "laura@cosedilspa.com", "ruolo": "admin", "admin": True,
                                        "proprietario": False, "disattivato": False, "mustChange": False,
                                        "abilitato": True})
        p = auth.profilo_portale("laura@cosedilspa.com")
        self.assertEqual((p["raggiungibile"], p["trovato"], p["username"], p["admin"], p["abilitato"]),
                         (True, True, "laura", True, True))
        path, testata, corpo = _PortaleFinto.ricevute[0]
        self.assertEqual(path, "/api/suite/profilo")
        self.assertEqual(testata["X-Suite-Token"], "token-di-prova")
        self.assertEqual(corpo, {"login": "laura@cosedilspa.com", "app": "vfp-transfer"})

    def test_disattivato_non_e_mai_admin_ne_proprietario(self):
        _PortaleFinto.risposta = (200, {"ok": True, "trovato": True, "username": "capo", "ruolo": "admin",
                                        "admin": True, "proprietario": True, "disattivato": True, "abilitato": True})
        p = auth.profilo_portale("capo")
        self.assertTrue(p["disattivato"])
        self.assertFalse(p["admin"] or p["proprietario"])

    def test_non_trovato(self):
        _PortaleFinto.risposta = (200, {"ok": True, "trovato": False})
        p = auth.profilo_portale("nessuno")
        self.assertEqual((p["raggiungibile"], p["trovato"]), (True, False))

    def test_token_rifiutato_e_portale_vecchio(self):
        _PortaleFinto.risposta = (403, {"ok": False})
        self.assertFalse(auth.profilo_portale("laura")["raggiungibile"])
        _PortaleFinto.risposta = (404, {"error": "non trovato"})
        p = auth.profilo_portale("laura")
        self.assertFalse(p["raggiungibile"])
        self.assertIn("versione precedente", p["errore"])

    def test_portale_spento_o_sso_spento(self):
        with mock.patch.object(cosedil_sso, "PORTAL", "http://127.0.0.1:9"):
            self.assertFalse(auth.profilo_portale("laura")["raggiungibile"])
        with mock.patch.object(cosedil_sso, "ENABLED", False):
            p = auth.profilo_portale("laura")
            self.assertFalse(p["raggiungibile"])
            self.assertIn("COSEDIL_SSO=off", p["errore"])
        self.assertEqual(_PortaleFinto.ricevute, [], "con lo SSO spento nessuna chiamata")


if __name__ == "__main__":
    unittest.main()
