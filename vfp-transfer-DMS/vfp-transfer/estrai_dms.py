# "><(((º> sabusabu <º)))><"
"""
Estrae documenti e revisioni dal DMS di origine via API, in SOLA LETTURA e con poco carico,
in una cartella locale con manifest.csv pronta per vfp_transfer.py:

    python estrai_dms.py --url https://dms.example/restapi/index.php --user lettore --cartella 12 --dest D:\\estrazione
    python vfp_transfer.py --source D:\\estrazione --manifest D:\\estrazione\\manifest.csv --dry-run

Il DMS viene letto una sola volta per file: il caricamento su VFP parte dalla copia locale.

Protezioni per il DMS di origine (classe LetturaSicura):
  - solo GET; l'unica POST ammessa e' il login. Qualsiasi altra scrittura viene bloccata qui, prima di partire;
  - una richiesta alla volta e al massimo --richieste-al-secondo (dimezzate da sole se il DMS risponde 429);
  - nuovi tentativi con attesa crescente (rispetta Retry-After) su 429/5xx ed errori di rete;
  - stop automatico dopo --max-errori errori di fila: il DMS e' in difficolta', meglio fermarsi;
  - --orario 20:00-07:00: lavora solo nella finestra, fuori aspetta.
Integrita' e ripresa: download in .part, controllo della dimensione dichiarata dal DMS, SHA-256 salvato
in stato_estrazione.json e nel manifest (vfp_transfer non carica un file cambiato); rilanciando si scaricano
solo le versioni mancanti (anche quelle nuove). --verifica --dest D:\\estrazione ricontrolla gli SHA-256.

Per ora c'e' l'adattatore per SeedDMS (SorgenteSeedDms): per un altro DMS basta una classe con gli stessi
metodi (login, logout, figli, versioni, scarica).
"""

import argparse
import csv
import getpass
import hashlib
import json
import logging
import os
import random
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import requests

from vfp_transfer import csv_cell

log = logging.getLogger("estrai_dms")

MAX_TENTATIVI = 5
ATTESA_MAX = 120  # secondi, tetto dell'attesa tra un tentativo e l'altro
RETRY_STATUS = {429, 500, 502, 503, 504}
BLOCCO = 1024 * 1024
LOCALI = {"127.0.0.1", "localhost", "::1"}
MANIFEST_FIELDS = ["file", "folder", "name", "revision", "description", "sha256"]
REPORT_FIELDS = ["data", "esito", "cartella", "documento", "versione", "file", "byte", "sha256", "dettaglio"]
_VIETATI = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RISERVATI = {"con", "prn", "aux", "nul", *(f"com{i}" for i in range(1, 10)), *(f"lpt{i}" for i in range(1, 10))}


class ScritturaBloccata(Exception):
    """Il programma ha provato a scrivere nel DMS di origine: non deve succedere mai."""


class DmsSovraccarico(Exception):
    """Troppi errori di fila: l'estrazione si ferma per non pesare sul DMS."""


class DmsErrore(Exception):
    def __init__(self, resp):
        self.status = resp.status_code
        super().__init__(f"DMS {resp.status_code} su {urlparse(resp.url).path}: {resp.text[:200]}")


def controlla_url(url):
    """https obbligatorio, http solo verso questo PC (DMS di prova): le credenziali non viaggiano in chiaro."""
    p = urlparse(url)
    if p.scheme == "https" or (p.scheme == "http" and p.hostname in LOCALI):
        return url.rstrip("/")
    raise ValueError(f"indirizzo del DMS non ammesso: {url} (serve https, http solo per 127.0.0.1)")


def leggi_orario(testo):
    """'20:00-07:00' -> (time, time); la finestra puo' scavalcare la mezzanotte."""
    m = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*", testo or "")
    if not m:
        raise ValueError(f"orario non valido: {testo!r} (esempio: 20:00-07:00)")
    h1, m1, h2, m2 = map(int, m.groups())
    inizio, fine = datetime.min.replace(hour=h1, minute=m1).time(), datetime.min.replace(hour=h2, minute=m2).time()
    if inizio == fine:
        raise ValueError("orario non valido: inizio e fine coincidono")
    return inizio, fine


def in_finestra(orario, adesso):
    inizio, fine = orario
    t = adesso.time()
    return inizio <= t < fine if inizio < fine else (t >= inizio or t < fine)


def secondi_alla_finestra(orario, adesso):
    inizio = datetime.combine(adesso.date(), orario[0])
    if inizio <= adesso:
        inizio += timedelta(days=1)
    return (inizio - adesso).total_seconds()


class LetturaSicura:
    """Client HTTP che puo' solo leggere, una richiesta alla volta, con freno e interruttore."""

    def __init__(self, base_url, richieste_al_secondo=2.0, max_errori=10, timeout=60, orario=None,
                 sleep=time.sleep, now=datetime.now):
        self.base_url = controlla_url(base_url)
        self.intervallo = 1.0 / richieste_al_secondo
        self.max_errori = max_errori
        self.timeout = timeout
        self.orario = orario
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "vfp-transfer estrai_dms (sola lettura)"
        self._sleep, self._now = sleep, now
        self._ultima = 0.0
        self._errori_di_fila = 0
        self.richieste = 0

    def _ammessa(self, method, path):
        if method == "GET" or (method == "POST" and path == "/login"):
            return
        raise ScritturaBloccata(f"{method} {path}: il programma legge soltanto dal DMS di origine")

    def _freno(self):
        if self.orario and not in_finestra(self.orario, self._now()):
            attesa = secondi_alla_finestra(self.orario, self._now())
            log.info("Fuori dall'orario consentito: riprendo tra %.0f minuti", attesa / 60)
            self._sleep(attesa)
        pausa = self._ultima + self.intervallo - time.monotonic()
        if pausa > 0:
            self._sleep(pausa)
        self._ultima = time.monotonic()

    def _errore(self, motivo):
        self._errori_di_fila += 1
        if self._errori_di_fila >= self.max_errori:
            raise DmsSovraccarico(f"{self._errori_di_fila} errori di fila dal DMS (ultimo: {motivo}): "
                                  "estrazione sospesa. Rilanciare piu' tardi, riprende da dove si e' fermata.")

    def request(self, method, path, stream=False, **kwargs):
        method = method.upper()
        self._ammessa(method, path)
        for tentativo in range(1, MAX_TENTATIVI + 1):
            self._freno()
            self.richieste += 1
            try:
                resp = self.session.request(method, self.base_url + path, timeout=self.timeout,
                                            stream=stream, allow_redirects=False, **kwargs)
            except (requests.ConnectionError, requests.Timeout) as e:
                motivo, attesa = f"rete: {e.__class__.__name__}", None
            else:
                if resp.status_code not in RETRY_STATUS:
                    if resp.status_code >= 300:
                        raise DmsErrore(resp)
                    self._errori_di_fila = 0
                    return resp
                motivo = f"HTTP {resp.status_code}"
                attesa = resp.headers.get("Retry-After")
                attesa = int(attesa) if attesa and attesa.isdigit() else None
                if resp.status_code == 429:
                    self.intervallo = min(self.intervallo * 2, 10.0)
                    log.warning("Il DMS chiede di rallentare: ora al massimo una richiesta ogni %.1f s", self.intervallo)
                resp.close()
            self._errore(motivo)
            if tentativo == MAX_TENTATIVI:
                raise DmsSovraccarico(f"{method} {path}: {motivo} dopo {MAX_TENTATIVI} tentativi")
            attesa = min(attesa if attesa is not None else 2 ** tentativo + random.random(), ATTESA_MAX)
            log.warning("%s su %s: nuovo tentativo tra %.0f s", motivo, path, attesa)
            self._sleep(attesa)

    def get(self, path, **kwargs):
        return self.request("GET", path, **kwargs)

    def close(self):
        self.session.close()


# --------------------------------------------------------------------------- adattatori dei DMS

class SorgenteSeedDms:
    """SeedDMS 6 (restapi/index.php). Cartelle, documenti e versioni numerate 1..n."""

    def __init__(self, http):
        self.http = http

    def _dati(self, path):
        body = self.http.get(path).json()
        if not body.get("success"):
            raise ValueError(f"SeedDMS su {path}: {body.get('message')}")
        return body["data"]

    def login(self, user, password):
        try:
            body = self.http.request("POST", "/login", data={"user": user, "pass": password}).json()
        except DmsErrore as e:
            raise ValueError(f"accesso al DMS rifiutato per {user}") from e
        if not body.get("success"):
            raise ValueError(f"accesso al DMS rifiutato per {user}")

    def logout(self):
        try:
            self.http.get("/logout")
        except Exception:  # uscita di cortesia: la sessione scade comunque
            pass

    def cartella(self, folder_id):
        return self._dati(f"/folder/{int(folder_id)}")

    def figli(self, folder_id):
        """[(tipo 'folder'|'document', id, nome, commento)]"""
        # id sempre interi: finiscono nei percorsi su disco (file/<doc>/...)
        return [(d["type"], int(d["id"]), d["name"], d.get("comment") or "") for d in self._dati(f"/folder/{int(folder_id)}/children")]

    def versioni(self, doc_id):
        """[{'versione', 'commento', 'nome_file', 'byte', 'data'}] in ordine crescente."""
        out = []
        for v in self._dati(f"/document/{int(doc_id)}/versions"):
            nome = v.get("origfilename") or ""
            if not Path(nome).suffix and v.get("filetype"):
                nome += v["filetype"]
            out.append({"versione": int(v["version"]), "commento": v.get("comment") or "",
                        "nome_file": nome, "byte": int(v.get("size") or 0), "data": v.get("date") or ""})
        return sorted(out, key=lambda v: v["versione"])

    def scarica(self, doc_id, versione):
        return self.http.get(f"/document/{int(doc_id)}/version/{int(versione)}", stream=True)


# --------------------------------------------------------------------------- estrazione

@dataclass
class Voce:
    cartella: tuple
    doc_id: int
    nome: str
    commento_doc: str
    versione: int
    commento: str
    nome_file: str
    byte: int
    data: str

    @property
    def chiave(self):
        return f"{self.doc_id}:{self.versione}"


def nome_sicuro(nome, ripiego="documento"):
    """Nome file valido su Windows, senza cartelle (niente ../ dal DMS)."""
    # non Path().name: su Windows "a:b.pdf" verrebbe letto come unita' "a:"
    nome = _VIETATI.sub("_", nome.replace("\\", "/").rsplit("/", 1)[-1]).strip(" .")
    stem, suffix = os.path.splitext(nome)
    if stem.casefold() in _RISERVATI:
        stem = "_" + stem
    suffix = suffix if re.fullmatch(r"\.[A-Za-z0-9]{1,10}", suffix or "") else ""
    stem = stem[:120] or ripiego
    return stem + suffix


def inventario(sorgente, radice_id):
    """Percorre l'albero partendo da radice_id (esclusa) e restituisce una Voce per ogni versione."""
    voci, pila = [], [(int(radice_id), ())]
    nomi_visti, cartelle_viste = {}, {int(radice_id)}
    while pila:
        folder_id, percorso = pila.pop()
        sottocartelle = []
        for tipo, oid, nome, commento in sorgente.figli(folder_id):
            if tipo == "folder":
                # un collegamento che riporta a una cartella gia' letta farebbe girare all'infinito sul DMS
                if oid in cartelle_viste:
                    log.warning("Cartella %s gia' letta (collegamento circolare?): saltata", oid)
                    continue
                cartelle_viste.add(oid)
                # "/" separa le cartelle nel manifest: dentro un nome diventa "-"
                sottocartelle.append((oid, percorso + (nome.replace("/", "-").replace("\\", "-").strip(),)))
                continue
            chiave = (percorso, nome.casefold())
            if chiave in nomi_visti and nomi_visti[chiave] != oid:
                log.warning("Due documenti con lo stesso nome in %s: %s (id %s rinominato)", "/".join(percorso) or "radice", nome, oid)
                nome = f"{nome} (id {oid})"
            nomi_visti.setdefault(chiave, oid)
            for v in sorgente.versioni(oid):
                voci.append(Voce(percorso, oid, nome, commento, v["versione"], v["commento"],
                                 v["nome_file"], v["byte"], v["data"]))
        pila.extend(reversed(sottocartelle))
    return voci


def _scrivi_json(path, data):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


class Estrazione:
    def __init__(self, sorgente, dest):
        self.sorgente = sorgente
        self.dest = Path(dest)
        self.stato_path = self.dest / "stato_estrazione.json"
        self.stato = {"scaricati": {}}
        if self.stato_path.exists():
            self.stato = json.loads(self.stato_path.read_text(encoding="utf-8"))

    def _percorso(self, s):
        """Percorso su disco di una voce dello stato, solo se dentro dest/file (stato modificato a mano = None)."""
        p = (self.dest / s["file"]).resolve()
        return p if p.is_relative_to((self.dest / "file").resolve()) else None

    def _gia_presente(self, voce):
        s = self.stato["scaricati"].get(voce.chiave)
        if not s:
            return False
        p = self._percorso(s)
        return p is not None and p.is_file() and p.stat().st_size == s["byte"]

    def scarica(self, voce):
        """Scarica una versione con i controlli di integrita'; restituisce (percorso relativo, byte, sha256)."""
        rel = Path("file") / str(voce.doc_id) / f"v{voce.versione}" / nome_sicuro(voce.nome_file, nome_sicuro(voce.nome))
        finale = self.dest / rel
        finale.parent.mkdir(parents=True, exist_ok=True)
        part = finale.with_name(finale.name + ".part")
        h, scritti = hashlib.sha256(), 0
        resp = self.sorgente.scarica(voce.doc_id, voce.versione)
        try:
            dichiarati = resp.headers.get("Content-Length")
            # con gzip Content-Length e' la dimensione compressa: vale solo il conteggio dei byte scritti
            if dichiarati is not None and not resp.headers.get("Content-Encoding") and int(dichiarati) != voce.byte:
                raise ValueError(f"dimensione diversa: il DMS dichiara {voce.byte} byte, il download {dichiarati}")
            with open(part, "wb") as f:
                for blocco in resp.iter_content(BLOCCO):
                    scritti += len(blocco)
                    if scritti > voce.byte:  # non riempire il disco con un download che non finisce
                        raise ValueError(f"file piu' grande del dichiarato ({voce.byte} byte)")
                    f.write(blocco)
                    h.update(blocco)
        except Exception:
            part.unlink(missing_ok=True)
            raise
        finally:
            resp.close()
        if scritti != voce.byte:
            part.unlink(missing_ok=True)
            raise ValueError(f"file incompleto: {scritti} byte su {voce.byte}")
        os.replace(part, finale)
        self.stato["scaricati"][voce.chiave] = {"file": rel.as_posix(), "byte": scritti, "sha256": h.hexdigest(),
                                               "data_dms": voce.data, "scaricato": datetime.now().isoformat(timespec="seconds")}
        return rel.as_posix(), scritti, h.hexdigest()

    def esegui(self, voci, salva_ogni=20):
        self.dest.mkdir(parents=True, exist_ok=True)
        conti = {"scaricato": 0, "presente": 0, "errore": 0}
        report_path = self.dest / "report_estrazione.csv"
        nuovo = not report_path.exists()
        with open(report_path, "a", newline="", encoding="utf-8-sig") as rf:
            report = csv.writer(rf, delimiter=";")
            if nuovo:
                report.writerow(REPORT_FIELDS)
            try:
                for i, voce in enumerate(voci, 1):
                    riga = [datetime.now().isoformat(timespec="seconds"), "", "/".join(voce.cartella), voce.nome, voce.versione]
                    if self._gia_presente(voce):
                        conti["presente"] += 1
                        continue
                    try:
                        rel, n, sha = self.scarica(voce)
                    except (DmsSovraccarico, ScritturaBloccata, KeyboardInterrupt):
                        raise
                    except Exception as e:  # un file rotto non ferma gli altri
                        conti["errore"] += 1
                        log.error("Errore su %s v%s: %s", voce.nome, voce.versione, e)
                        report.writerow([csv_cell(x) for x in riga[:1] + ["errore"] + riga[2:] + ["", "", "", str(e)]])
                        continue
                    conti["scaricato"] += 1
                    log.info("[%s/%s] %s v%s (%s byte)", i, len(voci), voce.nome, voce.versione, n)
                    report.writerow([csv_cell(x) for x in riga[:1] + ["scaricato"] + riga[2:] + [rel, n, sha, ""]])
                    if conti["scaricato"] % salva_ogni == 0:
                        _scrivi_json(self.stato_path, self.stato)
                        rf.flush()
            finally:
                _scrivi_json(self.stato_path, self.stato)
                self.scrivi_manifest(voci)
        return conti

    def scrivi_manifest(self, voci):
        """Solo le versioni presenti su disco, in ordine: per vfp_transfer diventano lo storico delle revisioni."""
        tmp = self.dest / "manifest.tmp"
        with open(tmp, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.writer(f, delimiter=";")
            w.writerow(MANIFEST_FIELDS)
            for voce in voci:
                if self._gia_presente(voce):
                    s = self.stato["scaricati"][voce.chiave]
                    w.writerow([csv_cell(x) for x in (s["file"], "/".join(voce.cartella), voce.nome,
                                                      voce.versione, voce.commento or voce.commento_doc, s["sha256"])])
        os.replace(tmp, self.dest / "manifest.csv")

    def verifica(self):
        """Ricalcola lo SHA-256 dei file scaricati, senza toccare il DMS. Le voci mancanti o diverse escono dallo
        stato (e quindi dal manifest): rilanciando l'estrazione vengono riscaricate. Restituisce {chiave: problema}."""
        problemi = {}
        for chiave, s in list(self.stato["scaricati"].items()):
            p = self._percorso(s)
            if p is None:
                problemi[chiave] = f"percorso fuori dalla cartella dei file: {s['file']}"
            elif not p.is_file():
                problemi[chiave] = f"file mancante: {s['file']}"
            else:
                h = hashlib.sha256()
                with open(p, "rb") as f:
                    while blocco := f.read(BLOCCO):
                        h.update(blocco)
                if h.hexdigest() != s["sha256"]:
                    problemi[chiave] = f"file cambiato dopo l'estrazione: {s['file']}"
        for chiave, problema in problemi.items():
            log.error("Verifica %s: %s", chiave, problema)
            del self.stato["scaricati"][chiave]
        if problemi:
            _scrivi_json(self.stato_path, self.stato)
        return problemi


# --------------------------------------------------------------------------- CLI

def main():
    p = argparse.ArgumentParser(description="Estrae in sola lettura documenti e revisioni dal DMS di origine.")
    p.add_argument("--url", help="indirizzo delle API del DMS (es. https://dms/restapi/index.php)")
    p.add_argument("--user", help="utente del DMS, meglio un utente tecnico in sola lettura")
    p.add_argument("--cartella", type=int, default=1, help="ID della cartella da estrarre (es. una commessa); 1 = tutto")
    p.add_argument("--dest", help="cartella locale dove scaricare (obbligatoria se non --dry-run)")
    p.add_argument("--dry-run", action="store_true", help="conta cartelle, documenti e dimensione senza scaricare")
    p.add_argument("--richieste-al-secondo", type=float, default=2.0)
    p.add_argument("--max-errori", type=int, default=10, help="errori di fila prima di fermarsi")
    p.add_argument("--orario", help="lavora solo in questa fascia, es. 20:00-07:00")
    p.add_argument("--verifica", action="store_true",
                   help="ricontrolla lo SHA-256 dei file in --dest, senza collegarsi al DMS")
    args = p.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    if args.verifica:
        if not args.dest:
            p.error("--verifica richiede --dest")
        estrazione = Estrazione(None, args.dest)
        problemi = estrazione.verifica()
        log.info("Verifica: %s file controllati, %s problemi", len(estrazione.stato["scaricati"]) + len(problemi), len(problemi))
        if problemi:
            sys.exit("Rilanciare l'estrazione per riscaricare i file segnalati (poi rifare il manifest).")
        return
    if not args.url or not args.user:
        p.error("--url e --user sono obbligatori (tranne con --verifica)")
    if not args.dry_run and not args.dest:
        p.error("--dest e' obbligatoria (oppure --dry-run)")
    if not 0 < args.richieste_al_secondo <= 20:
        p.error("--richieste-al-secondo deve essere tra 0 e 20")

    try:
        http = LetturaSicura(args.url, args.richieste_al_secondo, args.max_errori,
                             orario=leggi_orario(args.orario) if args.orario else None)
    except ValueError as e:
        sys.exit(f"Errore: {e}")
    password = os.environ.get("SEEDDMS_PASSWORD") or getpass.getpass(f"Password del DMS per {args.user}: ")
    sorgente = SorgenteSeedDms(http)
    try:
        sorgente.login(args.user, password)
        radice = sorgente.cartella(args.cartella)
        log.info("Lettura dell'elenco da '%s' (cartella %s)...", radice["name"], args.cartella)
        voci = inventario(sorgente, args.cartella)
        documenti = len({v.doc_id for v in voci})
        totale = sum(v.byte for v in voci)
        log.info("%s documenti, %s versioni, %.1f MB in totale", documenti, len(voci), totale / 1024 / 1024)
        if args.dry_run:
            log.info("Prova: nessun file scaricato (%s richieste al DMS).", http.richieste)
            return
        conti = Estrazione(sorgente, args.dest).esegui(voci)
        log.info("Fine: %s scaricati, %s gia' presenti, %s errori (%s richieste al DMS). Manifest: %s",
                 conti["scaricato"], conti["presente"], conti["errore"], http.richieste, Path(args.dest) / "manifest.csv")
        if conti["errore"]:
            sys.exit(1)
    except (ValueError, DmsErrore, DmsSovraccarico, ScritturaBloccata) as e:
        sys.exit(f"Errore: {e}")
    except KeyboardInterrupt:
        sys.exit("Interrotto: rilanciando riprende da dove si e' fermato.")
    finally:
        sorgente.logout()
        http.close()


if __name__ == "__main__":
    main()
