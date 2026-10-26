# "><(((º> sabusabu <º)))><"
"""
Registro delle attivita' degli utenti dell'interfaccia (pagina "Attivita' utenti", solo amministratori).

Una riga JSON per evento in registro_attivita.jsonl: ora, utente, ruolo, categoria, azione, dettaglio, esito.
Ogni riga contiene l'impronta (SHA-256) della riga precedente: se qualcuno modifica o cancella una riga in mezzo
al file, la catena si rompe e la pagina lo segnala. Nel registro non finiscono mai password, codici o valori
delle impostazioni: solo cosa e' stato fatto e da chi.
"""

import hashlib
import json
import threading
from datetime import datetime, timedelta

import env_config

LOG_PATH = env_config.BASE_DIR / "registro_attivita.jsonl"
CATEGORIES = {
    "accesso": "Accessi",
    "modifica": "Modifiche",
    "trasferimento": "Trasferimenti",
    "report": "Report",
    "confronto": "Confronti",
    "sicurezza": "Sicurezza",
}
OUTCOMES = {"ok": "Riuscita", "fallito": "Non riuscita", "negato": "Negata"}

_lock = threading.Lock()
_cache = {"key": None, "events": [], "integrity": {"ok": True, "broken_at": None}, "last_hash": ""}


def _digest(prev, entry):
    body = json.dumps({k: v for k, v in entry.items() if k != "h"}, ensure_ascii=False, sort_keys=True)
    return hashlib.sha256((prev + body).encode("utf-8")).hexdigest()


def _load():
    """Eventi dal file (dal piu' vecchio), con verifica della catena. Riletto solo se il file cambia."""
    try:
        st = LOG_PATH.stat()
        key = (st.st_mtime_ns, st.st_size)
    except OSError:
        _cache.update(key=None, events=[], integrity={"ok": True, "broken_at": None}, last_hash="")
        return
    if key == _cache["key"]:
        return
    events, prev, broken = [], "", None
    with open(LOG_PATH, encoding="utf-8") as f:
        for n, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
            except ValueError:
                broken = broken or n
                continue
            if broken is None and e.get("h") != _digest(prev, e):
                broken = n
            prev = e.get("h", "")
            events.append(e)
    _cache.update(key=key, events=events, integrity={"ok": broken is None, "broken_at": broken}, last_hash=prev)


def record(user, category, action, detail="", outcome="ok", role=""):
    """Aggiunge un evento. Non solleva mai eccezioni: il registro non deve bloccare il lavoro."""
    try:
        entry = {"t": datetime.now().isoformat(timespec="seconds"), "u": str(user or "")[:64], "r": role,
                 "c": category if category in CATEGORIES else "sicurezza", "a": str(action)[:120],
                 "d": str(detail or "")[:500], "o": outcome if outcome in OUTCOMES else "ok"}
        with _lock:
            _load()
            entry["h"] = _digest(_cache["last_hash"], entry)
            with open(LOG_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:  # noqa: BLE001 - un errore del registro non deve fermare il programma
        import logging
        logging.getLogger("attivita").exception("Registro attivita' non scritto")


def query(user="", category="", days=0, q="", outcome=""):
    """Eventi filtrati, dal piu' recente."""
    with _lock:
        _load()
        events = list(_cache["events"])
        integrity = dict(_cache["integrity"])
    since = (datetime.now() - timedelta(days=days - 1)).strftime("%Y-%m-%d") if days else ""
    q = q.lower()
    rows = [e for e in reversed(events)
            if (not user or e.get("u") == user) and (not category or e.get("c") == category)
            and (not outcome or e.get("o") == outcome) and (not since or e.get("t", "") >= since)
            and (not q or q in f"{e.get('u')} {e.get('a')} {e.get('d')}".lower())]
    return rows, events, integrity


def stats(events):
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    day_ago = (now - timedelta(hours=24)).isoformat(timespec="seconds")
    return {
        "logins_today": sum(1 for e in events if e.get("t", "").startswith(today) and e.get("a") == "Accesso" and e.get("o") == "ok"),
        "failed_24h": sum(1 for e in events if e.get("t", "") >= day_ago and e.get("c") == "accesso" and e.get("o") == "fallito"),
        "denied_24h": sum(1 for e in events if e.get("t", "") >= day_ago and e.get("o") == "negato"),
        "changes_today": sum(1 for e in events if e.get("t", "").startswith(today) and e.get("c") == "modifica"),
    }


def last_seen_by_user(events):
    out = {}
    for e in events:
        if e.get("u"):
            out[e["u"]] = e.get("t")
    return out

