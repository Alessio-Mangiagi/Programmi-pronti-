# "><(((º> sabusabu <º)))><"
"""Smoke test dopo un deploy (runbook, passo 5): pochi controlli rapidi sul percorso reale degli utenti.

    set CDE_SMOKE_PASSWORD=...        (mai sulla riga di comando né in file)
    python infra/smoke.py --api https://cde.example.com/api --email collaudo@example.com

Controlla salute, chiavi pubbliche, header di sicurezza, login, profilo, commesse, lista documenti e
lettura di un file tramite URL firmato; se l'utente è Project Admin anche l'integrità del registro.
Senza CDE_SMOKE_PASSWORD esegue solo i controlli anonimi. Codice d'uscita 1 al primo controllo fallito.
"""
from __future__ import annotations

import argparse
import os
import sys
import time

import httpx

REQUIRED_HEADERS = ("strict-transport-security", "x-content-type-options", "content-security-policy")


class Smoke:
    def __init__(self):
        self.failed = 0

    def check(self, name: str, fn):
        t = time.perf_counter()
        try:
            detail = fn() or ""
            print(f"  ok    {name:<38} {(time.perf_counter() - t) * 1000:6.0f} ms  {detail}")
            return True
        except Exception as e:  # noqa: BLE001 - ogni controllo riporta il proprio errore
            self.failed += 1
            print(f"  ERRORE {name:<37} {type(e).__name__}: {e}")
            return False


def expect(cond: bool, message: str) -> None:
    if not cond:
        raise AssertionError(message)


def main() -> int:
    sys.stdout.reconfigure(errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--api", required=True, help="base dell'API, es. https://cde.example.com/api")
    ap.add_argument("--email", help="utente di collaudo (password in CDE_SMOKE_PASSWORD)")
    args = ap.parse_args()
    password = os.environ.get("CDE_SMOKE_PASSWORD")
    s = Smoke()
    ctx: dict = {}
    print(f"Smoke test {args.api}")

    with httpx.Client(base_url=args.api.rstrip("/"), timeout=20, follow_redirects=False) as c:
        def health():
            r = c.get("/health")
            expect(r.status_code == 200 and r.json()["status"] == "ok", f"HTTP {r.status_code}")
            missing = [h for h in REQUIRED_HEADERS if h not in r.headers]
            expect(not missing, f"header mancanti: {missing}")
            return f"versione {r.json()['version']}"
        s.check("salute e header di sicurezza", health)

        def jwks():
            keys = c.get("/.well-known/jwks.json").json()["keys"]
            expect(keys and keys[0]["alg"] == "RS256", "JWKS senza chiave RS256")
            return f"kid {keys[0]['kid']}"
        s.check("chiavi pubbliche (JWKS)", jwks)
        s.check("rotte protette senza token -> 401", lambda: expect(c.get("/me").status_code == 401, "accesso senza token"))

        if not (args.email and password):
            print("  (CDE_SMOKE_PASSWORD o --email assenti: solo controlli anonimi)")
            return 1 if s.failed else 0

        def login():
            r = c.post("/auth/login", json={"email": args.email, "password": password})
            expect(r.status_code == 200, f"HTTP {r.status_code}")
            body = r.json()
            expect("access_token" in body, "MFA richiesta: usare un utente di collaudo senza MFA o completare la verifica")
            ctx["h"] = {"Authorization": f"Bearer {body['access_token']}"}
        if not s.check("login", login):
            return 1

        def me():
            u = c.get("/me", headers=ctx["h"]).json()
            return f"{u.get('email')} ({u.get('organization_code', '')})"
        s.check("profilo", me)

        def projects():
            ps = c.get("/projects", headers=ctx["h"]).json()
            expect(ps, "nessuna commessa visibile")
            ctx["project"] = ps[0]
            return f"{len(ps)} commesse, prima {ps[0]['code']}"
        if s.check("commesse", projects):
            pid = ctx["project"]["id"]

            def documents():
                r = c.get(f"/projects/{pid}/documents", params={"limit": 50}, headers=ctx["h"])
                expect(r.status_code == 200, f"HTTP {r.status_code}")
                items = r.json()["items"]
                ctx["rev"] = next((d["current_revision_id"] for d in items if d.get("current_scan_status") == "CLEAN"), None)
                return f"{len(items)} documenti"
            s.check("lista documenti", documents)

            def download():
                if not ctx.get("rev"):
                    return "nessun file verificato da leggere: saltato"
                link = c.get(f"/revisions/{ctx['rev']}/download", headers=ctx["h"]).json()
                r = httpx.get(link["url"], headers={"Range": "bytes=0-1023"}, timeout=20)
                expect(r.status_code in (200, 206), f"S3 HTTP {r.status_code}")
                return f"{link['filename']} ({len(r.content)} byte letti)"
            s.check("lettura file da S3 (URL firmato)", download)

            detail = c.get(f"/projects/{pid}", headers=ctx["h"]).json()
            if detail.get("my_permissions", {}).get("ADMIN", {}).get("PROJECT"):
                def audit():
                    v = c.get(f"/projects/{pid}/audit/verify", headers=ctx["h"]).json()
                    expect(v["ok"], f"registro non integro (record {v.get('first_broken_seq')})")
                    return f"{v['checked']} eventi verificati"
                s.check("integrità del registro attività", audit)

    print("Esito:", "OK" if not s.failed else f"{s.failed} controlli falliti")
    return 1 if s.failed else 0


if __name__ == "__main__":
    sys.exit(main())
