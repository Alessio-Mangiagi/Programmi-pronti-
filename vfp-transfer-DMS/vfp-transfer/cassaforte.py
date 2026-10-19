# "><(((º> sabusabu <º)))><"
"""
Cassaforte cifrata: utenti, password, chiavi e ID delle API (e il token Viewpoint, in un file a parte).

Cifratura con Windows DPAPI (CryptProtectData, AES-256) legata all'utente Windows che esegue il programma:
il file copiato su un altro PC, o aperto da un altro utente Windows, non si puo' leggere. Il programma
puo' cosi' ripartire da solo all'accensione senza che qualcuno debba scrivere una password.

Le modifiche a utenti e credenziali richiedono un codice monouso inviato via email solo all'amministratore
(vedi auth.py e vfp_gui.py); da riga di comando:
  python cassaforte.py elenco                 nomi delle voci salvate (mai i valori)
  python cassaforte.py imposta CHIAVE         chiede il codice all'amministratore, poi il nuovo valore
  python cassaforte.py imposta CHIAVE --emergenza   senza codice, se l'invio email non funziona (registrato)

Importante: se la password di Windows dell'utente del servizio viene REIMPOSTATA da un amministratore
(non cambiata dall'utente stesso), Windows perde le chiavi DPAPI e la cassaforte non e' piu' leggibile:
andranno reinseriti utenti e credenziali.
"""

import json
import os
import sys
import threading
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
VAULT_PATH = BASE_DIR / "cassaforte.dat"
MAGIC = b"VFPCASSA1\n"  # intestazione dei file cifrati
_ENTROPY = b"cosedil-vfp-transfer/cassaforte/v1"

_lock = threading.RLock()
_cache = {"mtime": None, "data": None}


class VaultError(Exception):
    pass


# --------------------------------------------------------------------------- DPAPI

def available():
    return os.name == "nt"


if available():
    import ctypes
    from ctypes import wintypes

    class _Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    _crypt32 = ctypes.windll.crypt32
    _kernel32 = ctypes.windll.kernel32
    _UI_FORBIDDEN = 0x1

    def _blob(data):
        buf = ctypes.create_string_buffer(data, len(data))
        return _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), buf

    def _result(ok, out, what):
        if not ok:
            raise VaultError(f"Windows non riesce a {what} la cassaforte (errore {ctypes.GetLastError()}): "
                             "va aperta con lo stesso utente Windows che l'ha creata")
        try:
            return ctypes.string_at(out.pbData, out.cbData)
        finally:
            _kernel32.LocalFree(out.pbData)

    def protect(data):
        inp, _k1 = _blob(data)
        ent, _k2 = _blob(_ENTROPY)
        out = _Blob()
        ok = _crypt32.CryptProtectData(ctypes.byref(inp), ctypes.c_wchar_p("cosedil-vfp"), ctypes.byref(ent),
                                       None, None, _UI_FORBIDDEN, ctypes.byref(out))
        return MAGIC + _result(ok, out, "cifrare")

    def unprotect(data):
        if not data.startswith(MAGIC):
            raise VaultError("file non cifrato o di formato sconosciuto")
        inp, _k1 = _blob(data[len(MAGIC):])
        ent, _k2 = _blob(_ENTROPY)
        out = _Blob()
        ok = _crypt32.CryptUnprotectData(ctypes.byref(inp), None, ctypes.byref(ent),
                                         None, None, _UI_FORBIDDEN, ctypes.byref(out))
        return _result(ok, out, "decifrare")
else:  # fuori da Windows (solo sviluppo): nessuna cifratura disponibile
    def protect(data):
        raise VaultError("cassaforte disponibile solo su Windows")

    def unprotect(data):
        raise VaultError("cassaforte disponibile solo su Windows")


def dump_json(obj):
    """JSON cifrato (o in chiaro fuori da Windows), per file come il token Viewpoint."""
    raw = json.dumps(obj).encode("utf-8")
    return protect(raw) if available() else raw


def load_json(raw):
    """Legge un file scritto da dump_json; accetta anche il vecchio formato in chiaro (verra' riscritto cifrato)."""
    if raw.startswith(MAGIC):
        return json.loads(unprotect(raw).decode("utf-8"))
    return json.loads(raw.decode("utf-8-sig"))


# --------------------------------------------------------------------------- contenuto

def _empty():
    return {"version": 1, "users": {}, "secrets": {}}


def load():
    """Contenuto della cassaforte (copia). Riletta solo se il file e' cambiato."""
    with _lock:
        try:
            mtime = VAULT_PATH.stat().st_mtime_ns
        except OSError:
            return _empty()
        if mtime != _cache["mtime"]:
            data = json.loads(unprotect(VAULT_PATH.read_bytes()).decode("utf-8"))
            data.setdefault("users", {})
            data.setdefault("secrets", {})
            _cache.update(mtime=mtime, data=data)
        return json.loads(json.dumps(_cache["data"]))


def _save(data):
    tmp = VAULT_PATH.with_suffix(".tmp")
    tmp.write_bytes(protect(json.dumps(data, ensure_ascii=False).encode("utf-8")))
    tmp.replace(VAULT_PATH)
    _cache.update(mtime=VAULT_PATH.stat().st_mtime_ns, data=data)


def secrets():
    return load()["secrets"] if available() else {}


def set_secrets(values):
    """Aggiorna le voci indicate (valore vuoto = voce eliminata)."""
    with _lock:
        data = load()
        for k, v in values.items():
            if v:
                data["secrets"][k] = v
            else:
                data["secrets"].pop(k, None)
        _save(data)


def users():
    return load()["users"]


def set_users(users_):
    with _lock:
        data = load()
        data["users"] = users_
        _save(data)


# --------------------------------------------------------------------------- riga di comando

def main():
    import argparse
    import getpass

    import auth
    import env_config

    parser = argparse.ArgumentParser(description="Cassaforte cifrata delle credenziali.")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("elenco", help="voci salvate (senza valori)")
    p = sub.add_parser("imposta", help="imposta una credenziale")
    p.add_argument("chiave", choices=sorted(env_config.VAULT_KEYS))
    p.add_argument("--emergenza", action="store_true", help="senza codice email (solo se l'invio non funziona)")
    args = parser.parse_args()
    if args.cmd == "elenco":
        data = load()
        print("Utenti:", ", ".join(sorted(data["users"])) or "nessuno")
        print("Credenziali:", ", ".join(sorted(data["secrets"])) or "nessuna")
        return
    try:
        auth.cli_approval(f"modifica di {args.chiave} da riga di comando", args.emergenza)
    except ValueError as e:
        sys.exit(str(e))
    value = getpass.getpass(f"Nuovo valore per {args.chiave} (vuoto = elimina): ")
    set_secrets({args.chiave: value})
    print("Salvato nella cassaforte.")


if __name__ == "__main__":
    main()
