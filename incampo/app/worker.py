"""
Worker delle notifiche: consuma `notifications` pending a intervalli.

    python -m app.worker            # processo separato (prod, docker compose "worker")
    NOTIFY_WORKER=thread uvicorn …  # in sviluppo: thread daemon dentro l'API

Intervallo NOTIFY_INTERVAL (secondi, default 10).
"""
import logging
import os
import threading
import time

from .database import SessionLocal
from .notify import process_pending, senders_from_env

log = logging.getLogger("fieldview.worker")


def run_once() -> dict:
    email, push = senders_from_env()
    with SessionLocal() as db:
        return process_pending(db, email, push)


def loop(stop: threading.Event | None = None, interval: float | None = None) -> None:
    interval = interval or float(os.getenv("NOTIFY_INTERVAL", "10"))
    while not (stop and stop.is_set()):
        try:
            res = run_once()
            if res["sent"] or res["failed"]:
                log.info("notifiche: %s", res)
        except Exception:  # il worker non deve morire per un errore transitorio
            log.exception("worker notifiche")
        if stop:
            stop.wait(interval)
        else:
            time.sleep(interval)


def start_thread() -> threading.Event:
    """Thread daemon in-process (sviluppo)."""
    stop = threading.Event()
    threading.Thread(target=loop, args=(stop,), name="notify-worker", daemon=True).start()
    return stop


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    log.info("worker notifiche avviato")
    loop()
