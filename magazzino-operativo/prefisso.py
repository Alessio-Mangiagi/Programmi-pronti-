# "><(((º> sabusabu <º)))><"
"""Il Magazzino dentro il programma unico "DDT e Magazzino" (decisione del 09/11/2026).

Il Lettore DDT fa da porta unica: inoltra `/magazzino/*` a questo server (127.0.0.1:5200)
togliendo il prefisso e aggiungendo delle intestazioni (shared/suite/CONTRATTI.md § 11, C2):

  X-Forwarded-Prefix: /magazzino      dove l'utente vede il Magazzino (base dei link della pagina)
  X-Forwarded-Host / X-Forwarded-Proto  host e schema visti dal browser
  X-Forwarded-For                     IP vero di chi usa la pagina (per il registro attività)
  X-Suite-Commessa: 101-003           la commessa scelta all'accesso nel programma unico

Questo middleware WSGI le legge SOLO se la richiesta arriva da loopback (il proxy del DDT gira
sulla stessa macchina) e solo se il prefisso è sano: così chi apre il Magazzino direttamente sulla
5200 (o dietro il Caddy della suite) lo vede alla radice come prima. Il prefisso finisce in
SCRIPT_NAME, quindi Flask lo mette da solo in url_for e in request.script_root; la pagina lo riceve
dal template (window.MAGAZZINO.base) e lo antepone a ogni indirizzo.

Sicurezza: dietro il Caddy (stessa macchina, quindi anche lui da loopback) un client potrebbe
mandare queste intestazioni di suo. Il danno possibile è solo sulla sua pagina (link con un
prefisso sbagliato, un filtro predefinito diverso): per questo i valori passano da espressioni
regolari strette (niente HTML né caratteri strani) e non decidono mai permessi o dati.
Va montato FUORI dal ProxyFix di app.py: deve vedere l'indirizzo del socket, non quello che
ProxyFix ricava da X-Forwarded-For.
"""
import ipaddress
import re
import urllib.parse

# Un prefisso fatto di uno-tre pezzi di lettere, cifre, trattino e trattino basso ("/magazzino").
PREFISSO_OK = re.compile(r"^(/[A-Za-z0-9_-]{1,40}){1,3}$")
# Codici del registro della suite: "101-003", "C-2024-015", anche "101-003 SEDE" (spazi, punti, barre).
COMMESSA_OK = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,63}$")
HOST_OK = re.compile(r"^[A-Za-z0-9.-]{1,253}(:\d{1,5})?$|^\[[0-9A-Fa-f:.]{2,45}\](:\d{1,5})?$")

CHIAVE_UNICO = "magazzino.programma_unico"        # True: la pagina è dentro il programma unico
CHIAVE_COMMESSA = "magazzino.commessa_sessione"   # codice della commessa scelta all'accesso, o assente


def da_loopback(environ):
    """True se la connessione viene dalla macchina stessa (127.0.0.0/8, ::1)."""
    ip = (environ.get("REMOTE_ADDR") or "").split("%", 1)[0]
    try:
        return ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return False


def commessa_da_intestazione(valore):
    """Valore di X-Suite-Commessa ripulito ('' se assente o non valido).

    Il proxy può mandarlo codificato per URL (un'intestazione HTTP è ASCII): lo si decodifica."""
    testo = urllib.parse.unquote((valore or "").strip())
    testo = re.sub(r"\s+", " ", testo).strip()
    return testo if COMMESSA_OK.match(testo) else ""


class Prefisso:
    """Middleware WSGI: applica il prefisso e la commessa mandati dal proxy del Lettore DDT."""

    def __init__(self, app):
        self.app = app

    def __call__(self, environ, start_response):
        if da_loopback(environ):
            prefisso = (environ.get("HTTP_X_FORWARDED_PREFIX") or "").strip().rstrip("/")
            if prefisso and PREFISSO_OK.match(prefisso):
                environ["SCRIPT_NAME"] = prefisso
                # Il proxy toglie già il prefisso (C2); se non l'avesse fatto non si raddoppia.
                percorso = environ.get("PATH_INFO") or ""
                if percorso == prefisso or percorso.startswith(prefisso + "/"):
                    environ["PATH_INFO"] = percorso[len(prefisso):] or "/"
                environ[CHIAVE_UNICO] = True
                commessa = commessa_da_intestazione(environ.get("HTTP_X_SUITE_COMMESSA"))
                if commessa:
                    environ[CHIAVE_COMMESSA] = commessa
                host = (environ.get("HTTP_X_FORWARDED_HOST") or "").split(",")[0].strip()
                if host and HOST_OK.match(host):
                    environ["HTTP_HOST"] = host
                schema = (environ.get("HTTP_X_FORWARDED_PROTO") or "").split(",")[0].strip().lower()
                if schema in ("http", "https"):
                    environ["wsgi.url_scheme"] = schema
                # IP di chi usa la pagina, per il registro attività (senza, tutti risulterebbero 127.0.0.1):
                # in X-Forwarded-For si prende da destra il primo indirizzo che non è della macchina stessa.
                # I passaggi locali (Caddy della suite, proxy del DDT) sono tutti loopback; quello che sta
                # prima l'ha scritto il primo proxy locale. Serve solo al registro, mai ai permessi.
                inoltrati = [x.strip() for x in (environ.get("HTTP_X_FORWARDED_FOR") or "").split(",") if x.strip()]
                for voce in reversed(inoltrati):
                    try:
                        ip = ipaddress.ip_address(voce.split("%", 1)[0])
                    except ValueError:
                        break
                    if not ip.is_loopback:
                        environ["REMOTE_ADDR"] = str(ip)
                        break
        return self.app(environ, start_response)


def base(environ):
    """Prefisso con cui la pagina è vista dal browser ('' alla radice)."""
    return (environ.get("SCRIPT_NAME") or "").rstrip("/")


def programma_unico(environ):
    return bool(environ.get(CHIAVE_UNICO))


def commessa_sessione(environ):
    return environ.get(CHIAVE_COMMESSA) or ""
