# "><(((º> sabusabu <º)))><"
import tempfile
import unittest
from pathlib import Path

from tests import ROOT  # noqa: F401
import env_config


class ValidazioneTest(unittest.TestCase):
    def check(self, **values):
        env_config.validate_settings({k: str(v) for k, v in values.items()}, dict(env_config.DEFAULTS))

    def test_predefiniti_validi(self):
        self.check()

    def test_a_capo_rifiutato(self):
        with self.assertRaises(ValueError):
            self.check(MAIL_VFP_FOLDER="a\nVFP_TOKEN_URL=https://evil")

    def test_url_vfp_solo_domini_viewpoint(self):
        with self.assertRaises(ValueError):
            self.check(VFP_TOKEN_URL="https://evil.example.com/token")
        with self.assertRaises(ValueError):
            self.check(VFP_BASE_URL="http://api-uk.vfp.viewpoint.com")

    def test_link_documento(self):
        self.check(VFP_DOC_URL="https://uk.4projects.com/Document/Detail/{id}")
        for bad in ("https://uk.4projects.com/Document/Detail/", "https://evil.com/{id}", "http://uk.4projects.com/{id}"):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.check(VFP_DOC_URL=bad)

    def test_regola_protocollo(self):
        self.check(PEC_PROTOCOL_REGEX=r"^(\d{3,})")
        with self.assertRaises(ValueError):
            self.check(PEC_PROTOCOL_REGEX="(")

    def test_rete_solo_https(self):
        self.check(GUI_BIND="127.0.0.1")
        with self.assertRaises(ValueError):  # manca il certificato
            self.check(GUI_BIND="0.0.0.0", GUI_HOSTNAME="vfp.cosedil.local")
        with self.assertRaises(ValueError):
            self.check(GUI_BIND="non-un-ip")
        with tempfile.TemporaryDirectory() as tmp:
            cert, key = Path(tmp) / "c.pem", Path(tmp) / "k.pem"
            cert.write_text("x")
            key.write_text("x")
            self.check(GUI_BIND="0.0.0.0", GUI_HOSTNAME="vfp.cosedil.local", GUI_TLS_CERT=cert, GUI_TLS_KEY=key)
            with self.assertRaises(ValueError):
                self.check(GUI_BIND="0.0.0.0", GUI_HOSTNAME="", GUI_TLS_CERT=cert, GUI_TLS_KEY=key)


class FileEnvTest(unittest.TestCase):
    def test_scrittura_mantiene_commenti(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / ".env"
            p.write_text("# commento\nMAIL_POLL_SECONDS=120\n", encoding="utf-8")
            env_config.write_env_file({"MAIL_POLL_SECONDS": "60", "MAIL_VFP_FOLDER": "Posta #1"}, p)
            text = p.read_text(encoding="utf-8")
            self.assertTrue(text.startswith("# commento\nMAIL_POLL_SECONDS=60\n"))
            self.assertEqual(env_config.read_env_file(p)["MAIL_VFP_FOLDER"], "Posta #1")


if __name__ == "__main__":
    unittest.main()
