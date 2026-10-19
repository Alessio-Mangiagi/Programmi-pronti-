# "><(((º> sabusabu <º)))><"
"""
API dell'interfaccia per posta, protocolli PEC e ricerca (usate da vfp_gui.py, che ne controlla i permessi).

  GET  /api/mail [U]            stato del controllo posta e cronologia
  GET  /api/mail/log            caselle collegate ed email ricevute (filtri dal, casella, q)
  GET  /api/mail/file           anteprima o download di un allegato salvato (key, name)
  POST /api/mail/check | /api/mail/test | /api/mail/retry
  GET  /api/protocol/check      controllo della numerazione dei protocolli PEC (mancanti e doppi per anno)
  POST /api/protocol/test       prova di una regola sul testo di un oggetto e sulle ultime PEC
  POST /api/protocol/set        correzione a mano del protocollo di un'email
  GET  /api/protocolli.xlsx     registro dei protocolli (anno=)
  GET  /api/search              ricerca unica in email, protocolli e documenti trasferiti
"""

import logging
import time
from pathlib import Path

import attivita
import env_config
import protocollo
import report_excel
import vfp_mail

log = logging.getLogger("vfp_gui")

WATCHER = None  # MailWatcher, impostato da vfp_gui.main()
PATHS = {"mail_log": None, "report": None}  # impostati da vfp_gui
# anteprima nel browser solo per formati che il browser mostra da se'; il resto si scarica
PREVIEW_TYPES = {".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                 ".gif": "image/gif", ".txt": "text/plain; charset=utf-8"}


def _arg(query, k, default=""):
    return (query.get(k) or [default])[0].strip()


def _emails(settings=None):
    return vfp_mail.group_mail_log(vfp_mail.read_mail_log(PATHS["mail_log"], settings))


# --------------------------------------------------------------------------- posta

def mail_status():
    if not WATCHER:
        return {"available": False}
    snap = WATCHER.snapshot()
    snap["available"] = True
    snap["now"] = time.time()
    return snap


def mail_log(query):
    """Caselle collegate con i conteggi, ed email ricevute (una riga per email) filtrate per l'elenco."""
    settings = env_config.load_settings()
    emails = _emails(settings)
    status = WATCHER.snapshot() if WATCHER else {"sources": {}}
    sources = {}
    for kind in env_config.mail_sources(settings):
        mbx = vfp_mail.make_mailbox(kind, settings)
        st = status["sources"].get(mbx.key, {})
        sources[mbx.label] = {"label": mbx.label, "kind": kind, "address": mbx.address, "active": True,
                              "last_check": st.get("last_check"), "last_error": st.get("last_error", "")}
    for e in emails:  # caselle non piu' attive ma presenti nel registro
        sources.setdefault(e.get("casella", ""), {"label": e.get("casella", ""), "kind": e.get("tipo_casella", ""),
                                                  "address": e.get("indirizzo_casella", ""), "active": False,
                                                  "last_check": None, "last_error": ""})
    for src in sources.values():
        mine = [e for e in emails if e.get("casella") == src["label"]]
        src["counts"] = {k: sum(1 for e in mine if e.get("esito") == k) for k in vfp_mail.OUTCOME_LABELS}
        src["counts"]["totale"] = len(mine)
        src["last_mail"] = mine[0].get("data") if mine else None

    dal = report_excel.parse_day(_arg(query, "dal"))
    casella, q = _arg(query, "casella"), _arg(query, "q").lower()
    rows = [e for e in emails
            if (not dal or (e.get("data") or "")[:10] >= dal.isoformat())
            and (not casella or e.get("casella") == casella)
            and (not q or q in _haystack(e))]
    limit = int(_arg(query, "limit", "500") or 500)
    return {"sources": sorted(sources.values(), key=lambda x: (not x["active"], x["label"])),
            "rows": rows[:limit], "total": len(rows), "all_total": len(emails)}


def _haystack(e):
    return " ".join(str(e.get(k) or "") for k in ("mittente", "oggetto", "protocollo", "allegati", "pec_id",
                                                  "documenti", "pec_destinatari")).lower()


def report_xlsx(query):
    dal, al = report_excel.parse_day(_arg(query, "dal")), report_excel.parse_day(_arg(query, "al"))
    settings = env_config.load_settings()
    return report_excel.build_report(PATHS["mail_log"], PATHS["report"], vfp_mail.archive_dir(settings),
                                     dal, al, _arg(query, "casella") or None)


def mail_check():
    if WATCHER:
        WATCHER.trigger()
        log.info("Controllo posta richiesto dall'interfaccia")
    return {"ok": True}


def mail_test(body):
    kind = body.get("kind")
    if kind not in env_config.MAIL_SOURCE_NAMES:
        raise ValueError("Casella non valida")
    try:
        return {"ok": True, "message": vfp_mail.test_mailbox(kind, env_config.load_settings())}
    except Exception as e:  # qualsiasi errore di rete/credenziali va mostrato in chiaro
        return {"ok": False, "message": f"Connessione non riuscita: {e}"}


def mail_retry(body, sess):
    if not WATCHER:
        raise ValueError("Controllo posta non attivo")
    message = WATCHER.request_retry(str(body.get("key") or ""), sess["user"])
    attivita.record(sess["user"], "trasferimento", "Email ritentata", str(body.get("key") or ""), role=sess["role"])
    return {"ok": True, "message": message}


def mail_file(query):
    """(byte, tipo, intestazioni) di un allegato salvato nella copia locale."""
    folder = vfp_mail.archived_files(env_config.load_settings(), _arg(query, "key"))
    name = _arg(query, "name")
    if folder is None:
        raise ValueError("Copia locale degli allegati non trovata (le email bloccate non vengono salvate)")
    files = {p.name: p for p in folder.iterdir() if p.is_file()}
    if name not in files:  # solo nomi esatti della cartella: niente percorsi
        raise ValueError("Allegato non trovato")
    path = files[name]
    ext = path.suffix.lower()
    download = _arg(query, "download") == "1" or ext not in PREVIEW_TYPES
    ctype = "application/octet-stream" if download else PREVIEW_TYPES[ext]
    quoted = name.replace('"', "_").encode("ascii", "replace").decode()
    disposition = f'{"attachment" if download else "inline"}; filename="{quoted}"'
    # l'anteprima non deve poter eseguire nulla nella pagina dell'interfaccia
    headers = {"Content-Disposition": disposition, "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'"}
    if ext == ".pdf" and not download:
        headers.pop("Content-Security-Policy")  # il lettore PDF del browser non funziona in sandbox
    return path.read_bytes(), ctype, headers


# --------------------------------------------------------------------------- protocolli PEC

def protocol_check(query):
    emails = _emails()
    year = _arg(query, "anno")
    years = protocollo.check(emails)
    pecs = [e for e in emails if e.get("tipo_casella") == "pec" and e.get("esito") != "ricevuta"]
    return {"years": [y for y in years if not year or str(y["anno"]) == year],
            "pec_total": len(pecs), "pec_without": sum(1 for e in pecs if not e.get("protocollo")),
            "receipts": sum(1 for e in emails if e.get("esito") == "ricevuta")}


def protocol_test(body):
    """Prova una regola (anche non ancora salvata) su un oggetto scritto a mano e sulle ultime PEC arrivate."""
    rule = str(body.get("rule") or "")
    protocollo.compile_rule(rule)  # ValueError con il motivo se non valida
    subject = str(body.get("subject") or "")[:500]
    out = {"ok": True}
    if subject:
        out["subject"] = {"testo": subject, "protocollo": protocollo.with_year(protocollo.extract(subject, rule),
                                                                              time.strftime("%Y"))}
    samples = [e for e in _emails() if e.get("tipo_casella") == "pec" and e.get("esito") != "ricevuta"][:15]
    out["samples"] = [{"oggetto": e.get("oggetto", ""),
                       "attuale": e.get("protocollo", ""),
                       "nuovo": protocollo.for_mail("pec", e.get("oggetto"), e.get("ricevuta") or e.get("data"), rule)}
                      for e in samples]
    return out


def protocol_set(body, sess):
    key, number = str(body.get("key") or ""), str(body.get("protocol") or "")
    saved = protocollo.set_override(key, number, sess["user"])
    log.warning("Protocollo dell'email %s %s da %s", key, f"corretto in '{saved}'" if saved else "riportato all'automatico",
                sess["user"])
    attivita.record(sess["user"], "modifica", "Protocollo PEC corretto" if saved else "Protocollo PEC automatico",
                    f"{key}: {saved}" if saved else key, role=sess["role"])
    return {"ok": True, "protocol": saved}


def protocol_xlsx(query):
    year = _arg(query, "anno")
    if year and not year.isdigit():
        raise ValueError("Anno non valido")
    return report_excel.build_protocol_register(PATHS["mail_log"], int(year) if year else None)


# --------------------------------------------------------------------------- ricerca unica

def search(query):
    q = _arg(query, "q").lower()
    if len(q) < 2:
        return {"q": q, "emails": [], "documents": [], "emails_total": 0, "documents_total": 0}
    emails = [e for e in _emails() if q in _haystack(e)]
    docs = []
    for r in reversed(report_excel._read_report(PATHS["report"])):
        if q in " ".join(str(r.get(k) or "") for k in ("file", "cartella", "nome", "id_documento", "messaggio")).lower():
            docs.append({**r, "nome_file": Path(r.get("file") or "").name})
    return {"q": q, "emails": emails[:25], "emails_total": len(emails), "documents": docs[:25], "documents_total": len(docs)}
