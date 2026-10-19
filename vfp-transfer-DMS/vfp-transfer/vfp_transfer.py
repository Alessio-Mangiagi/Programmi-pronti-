# "><(((º> sabusabu <º)))><"
"""
Trasferisce documenti da un altro DMS (esportato su disco) a Viewpoint For Projects (Trimble).

Per ogni file:
  1. ricrea in VFP la struttura di cartelle di origine (Document Folders);
  2. crea il Documento con la sua revisione, oppure aggiunge una nuova revisione
     se il documento esiste gia';
  3. carica il file sulla revisione corrente (upload semplice o multipart per file grandi).

API usate (Swagger: https://api-uk.vfp.viewpoint.com/swagger/ui/index):
  GET  /vfp/api/v1/projects/{id}/documentfolders
  GET  /vfp/api/v1/documentfolders/{id}/childfolders
  POST /vfp/api/v5/documentfolders
  GET  /vfp/api/v1/documentfolders/{id}/documents
  POST /vfp/api/v3/documents
  GET  /vfp/api/v2/documents/{id}                  (per l'ETag da usare in If-Match)
  POST /vfp/api/v4/documents/{id}/revisions
  POST /vfp/api/v1/documents/{id}/files            (URL temporaneo, poi PUT del file)
  POST /vfp/api/v1/documents/{id}/files/multipart  (URL per ogni parte, poi PUT delle parti)
  POST /vfp/api/v1/documents/{id}/files/completemultipartupload

Interfaccia grafica per il personale: vfp_gui.py (usa le classi di questo modulo).
"""

import argparse
import base64
import csv
import hashlib
import json
import logging
import math
import secrets
import sys
import threading
import time
import webbrowser
from dataclasses import dataclass
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse

import requests

import cassaforte

log = logging.getLogger("vfp_transfer")

MAX_RETRIES = 5
SIMPLE_UPLOAD_LIMIT = 100 * 1024 * 1024  # oltre 100 MB si usa l'upload multipart
PART_SIZE = 64 * 1024 * 1024  # S3: minimo 5 MB per parte, massimo 10.000 parti
MAX_NAME_LEN = 100  # limite del campo Name di documenti e cartelle
# file di sistema che gli export da Windows/Office si portano dietro e che non vanno caricati
IGNORED_FILES = {"thumbs.db", "desktop.ini", ".ds_store"}


# i report CSV si aprono in Excel: un valore che inizia cosi' verrebbe eseguito come formula
_FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def csv_cell(value):
    """Valore sicuro per un CSV aperto in Excel (oggetti e nomi di file arrivano da mittenti esterni)."""
    value = "" if value is None else str(value)
    return "'" + value if value.startswith(_FORMULA_START) else value


def csv_plain(value):
    """Inverso di csv_cell, per mostrare il valore originale nell'interfaccia e nel report Excel."""
    value = value or ""
    return value[1:] if value.startswith("'") and value[1:2] in _FORMULA_START and value[1:2] else value


class VfpError(Exception):
    def __init__(self, resp):
        self.status = resp.status_code
        # senza query string: gli URL S3 temporanei contengono la firma, che non deve finire in log e report
        url = resp.url.split("?", 1)[0]
        super().__init__(f"{resp.request.method} {url} -> {resp.status_code}: {resp.text[:500]}")


class LoginError(Exception):
    """Login Viewpoint non riuscito (sollevata invece di sys.exit, per poterla gestire anche dalla GUI)."""


# --------------------------------------------------------------------------- autenticazione

class _CallbackHandler(BaseHTTPRequestHandler):
    result = {}
    path_expected = "/"

    def do_GET(self):
        url = urlparse(self.path)
        params = parse_qs(url.query)
        if not params or url.path != type(self).path_expected:  # es. /favicon.ico: non e' la risposta del login
            self.send_response(404)
            self.end_headers()
            return
        type(self).result.update({k: v[0] for k, v in params.items()})
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write("<h3>Autenticazione completata. Puoi chiudere questa finestra.</h3>".encode())

    def log_message(self, *args):
        pass


class TokenManager:
    """
    OAuth2 Authorization Code: la prima volta apre il browser, poi usa il refresh token.
    Con interactive=False (servizio automatico) non apre mai il browser: se l'accesso e' scaduto
    solleva LoginError e qualcuno deve rifare l'accesso dall'interfaccia.
    """

    def __init__(self, cfg, cache_path, interactive=True):
        self.cfg = cfg
        self.cache_path = Path(cache_path)
        self.interactive = interactive
        self.lock = threading.RLock()  # lo stesso token e' usato da piu' thread (GUI e posta)
        self.token = {}
        self._mtime = None
        self._reload()

    def _reload(self):
        """Rilegge il token se il file e' cambiato (es. accesso rifatto da un altro thread o programma)."""
        try:
            mtime = self.cache_path.stat().st_mtime
        except OSError:
            if self._mtime is not None:  # file eliminato (disconnessione): si dimentica il token
                self.token, self._mtime = {}, None
            return
        if mtime != self._mtime:
            raw = self.cache_path.read_bytes()
            self.token = cassaforte.load_json(raw)  # cifrato con DPAPI
            if cassaforte.available() and not raw.startswith(cassaforte.MAGIC):  # vecchio file in chiaro
                self.cache_path.write_bytes(cassaforte.dump_json(self.token))
                mtime = self.cache_path.stat().st_mtime
            self._mtime = mtime

    def get(self, interactive=None):
        interactive = self.interactive if interactive is None else interactive
        with self.lock:
            self._reload()
            if self.token.get("access_token") and self.token.get("expires_at", 0) > time.time() + 60:
                return self.token["access_token"]
            if self.token.get("refresh_token"):
                try:
                    self._exchange({"grant_type": "refresh_token", "refresh_token": self.token["refresh_token"]})
                    return self.token["access_token"]
                except (VfpError, requests.RequestException) as e:
                    log.warning("Refresh del token fallito, serve un nuovo login: %s", e)
            if not interactive:
                raise LoginError("accesso a Viewpoint scaduto o mai eseguito: accedere dall'interfaccia (Impostazioni > Accedi a Viewpoint)")
            self._interactive_login()
            return self.token["access_token"]

    def invalidate(self):
        with self.lock:
            self.token["expires_at"] = 0

    def _interactive_login(self):
        redirect = urlparse(self.cfg["redirect_uri"])
        state = secrets.token_urlsafe(16)
        # PKCE (RFC 7636): un programma che intercetta il codice sulla porta locale non puo' usarlo
        verifier = secrets.token_urlsafe(64)
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
        url = self.cfg["authorization_url"] + "?" + urlencode({
            "response_type": "code",
            "client_id": self.cfg["client_id"],
            "redirect_uri": self.cfg["redirect_uri"],
            "scope": self.cfg.get("scope", "vfp.fullaccess"),
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        })
        _CallbackHandler.result = {}
        _CallbackHandler.path_expected = redirect.path or "/"
        server = HTTPServer((redirect.hostname, redirect.port or 80), _CallbackHandler)
        server.timeout = 1
        log.info("Login Viewpoint: si apre il browser. Se non succede, aprire: %s", url)
        webbrowser.open(url)
        deadline = time.time() + 300
        while not _CallbackHandler.result and time.time() < deadline:
            server.handle_request()
        server.server_close()

        result = _CallbackHandler.result
        if not result:
            raise LoginError("Login non completato entro 5 minuti.")
        if "error" in result:
            raise LoginError(f"Login rifiutato: {result.get('error')} {result.get('error_description', '')}")
        if not secrets.compare_digest(result.get("state", ""), state) or "code" not in result:
            raise LoginError("Risposta di login non valida (state diverso o codice mancante).")
        try:
            self._exchange({
                "grant_type": "authorization_code",
                "code": result["code"],
                "redirect_uri": self.cfg["redirect_uri"],
                "code_verifier": verifier,
            })
        except VfpError as e:
            raise LoginError(f"Scambio del codice di login fallito: {e}") from e

    def _exchange(self, data):
        data = {**data, "client_id": self.cfg["client_id"]}
        if self.cfg.get("client_secret"):
            data["client_secret"] = self.cfg["client_secret"]
        resp = requests.post(self.cfg["token_url"], data=data, timeout=60)
        if not resp.ok:
            raise VfpError(resp)
        body = resp.json()
        self.token = {
            "access_token": body["access_token"],
            "refresh_token": body.get("refresh_token", self.token.get("refresh_token")),
            "expires_at": time.time() + int(body.get("expires_in", 3600)),
        }
        self.cache_path.write_bytes(cassaforte.dump_json(self.token))  # il refresh token vale come una password
        self._mtime = self.cache_path.stat().st_mtime


# --------------------------------------------------------------------------- client API

def _items(data):
    """Le liste possono arrivare come array o dentro un oggetto contenitore."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("Items", "items", "Results", "results", "Data", "data", "Value", "value"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


def _same_name(a, b):
    return (a or "").strip().casefold() == (b or "").strip().casefold()


def _put_with_retry(do_put, label):
    """PUT verso l'URL S3 temporaneo, ripetuta su errori HTTP e di rete."""
    err = RuntimeError(f"{label}: nessun tentativo eseguito")
    for attempt in range(MAX_RETRIES):
        try:
            put = do_put()
            if put.ok:
                return put
            err = VfpError(put)
        except (requests.ConnectionError, requests.Timeout) as e:
            err = e
        log.warning("%s fallito (%s), nuovo tentativo", label, err)
        time.sleep(2 ** attempt)
    raise err


class VfpClient:
    def __init__(self, base_url, tokens):
        self.base_url = base_url.rstrip("/")
        self.tokens = tokens
        self.session = requests.Session()

    def _request(self, method, path, headers=None, **kwargs):
        url = self.base_url + path
        auth_retried = False
        resp = None
        for attempt in range(MAX_RETRIES):
            h = {"Authorization": f"Bearer {self.tokens.get()}", "Accept": "application/json"}
            if headers:
                h.update(headers)
            try:
                resp = self.session.request(method, url, headers=h, timeout=120, **kwargs)
            except (requests.ConnectionError, requests.Timeout) as e:
                if attempt == MAX_RETRIES - 1:
                    raise
                log.warning("%s %s -> errore di rete (%s), nuovo tentativo", method, path, e)
                time.sleep(2 ** attempt)
                continue
            if resp.status_code == 401 and not auth_retried:
                self.tokens.invalidate()
                auth_retried = True
                continue
            if resp.status_code == 429 or resp.status_code >= 500:
                try:
                    wait = int(resp.headers.get("Retry-After", ""))
                except ValueError:
                    wait = 2 ** attempt
                log.warning("%s %s -> %s, nuovo tentativo tra %ss", method, path, resp.status_code, wait)
                time.sleep(wait)
                continue
            if not resp.ok:
                raise VfpError(resp)
            return resp
        raise VfpError(resp)

    # ---- cartelle

    def find_child_folder(self, parent_type, parent_id, name):
        if parent_type == "project":
            path = f"/vfp/api/v1/projects/{parent_id}/documentfolders"
        else:
            path = f"/vfp/api/v1/documentfolders/{parent_id}/childfolders"
        data = self._request("GET", path, params={"name": name}).json()
        for folder in _items(data):
            if _same_name(folder.get("Name"), name):
                return folder["Id"]
        return None

    def list_child_folders(self, parent_type, parent_id):
        """Sottocartelle dirette di un progetto o di una cartella: [(id, nome)]."""
        if parent_type == "project":
            path = f"/vfp/api/v1/projects/{parent_id}/documentfolders"
        else:
            path = f"/vfp/api/v1/documentfolders/{parent_id}/childfolders"
        data = self._request("GET", path).json()
        return [(f["Id"], f.get("Name") or "") for f in _items(data) if f.get("Id")]

    def create_folder(self, parent_id, name):
        resp = self._request("POST", "/vfp/api/v5/documentfolders", json={"Name": name, "ParentId": parent_id})
        return resp.json()["Id"]

    # ---- documenti

    def find_document(self, folder_id, name):
        page, page_size = 1, 100
        while True:
            data = self._request(
                "GET", f"/vfp/api/v1/documentfolders/{folder_id}/documents",
                params={"name": name, "page": page, "pageSize": page_size},
            ).json()
            docs = _items(data)
            for doc in docs:
                if _same_name(doc.get("Name"), name):
                    return doc
            if len(docs) < page_size:
                return None
            page += 1

    def get_document(self, doc_id):
        resp = self._request("GET", f"/vfp/api/v2/documents/{doc_id}")
        return resp.json(), resp.headers.get("ETag")

    def create_document(self, folder_id, name, revision, description, extra):
        body = {"Name": name, "ParentId": folder_id, **extra}
        if revision:
            body["RevisionReference"] = revision
        if description:
            body["Description"] = description[:200]
        return self._request("POST", "/vfp/api/v3/documents", json=body).json()["Id"]

    def create_revision(self, doc_id, revision, extra):
        _, etag = self.get_document(doc_id)
        body = {**extra}
        if revision:
            body["RevisionReference"] = revision
        self._request("POST", f"/vfp/api/v4/documents/{doc_id}/revisions", json=body, headers={"If-Match": etag})

    # ---- file

    def upload_file(self, doc_id, file_path):
        size = file_path.stat().st_size
        if size <= SIMPLE_UPLOAD_LIMIT:
            self._upload_simple(doc_id, file_path)
        else:
            self._upload_multipart(doc_id, file_path, size)

    def _upload_simple(self, doc_id, file_path):
        _, etag = self.get_document(doc_id)
        info = self._request(
            "POST", f"/vfp/api/v1/documents/{doc_id}/files",
            json={"FileName": file_path.name}, headers={"If-Match": etag},
        ).json()

        def do_put():
            with open(file_path, "rb") as f:
                return requests.put(info["Url"], data=f, timeout=3600)

        _put_with_retry(do_put, f"Upload di {file_path.name}")

    def _upload_multipart(self, doc_id, file_path, size):
        part_size = max(PART_SIZE, math.ceil(size / 10_000))
        part_count = math.ceil(size / part_size)
        _, etag = self.get_document(doc_id)
        info = self._request(
            "POST", f"/vfp/api/v1/documents/{doc_id}/files/multipart",
            json={"FileName": file_path.name, "PartCount": part_count}, headers={"If-Match": etag},
        ).json()

        parts = []
        with open(file_path, "rb") as f:
            for number, url in enumerate(info["PartUrls"], start=1):
                chunk = f.read(part_size)
                put = _put_with_retry(
                    lambda: requests.put(url, data=chunk, timeout=3600),
                    f"Parte {number}/{part_count}",
                )
                parts.append({"PartNumber": number, "ETag": put.headers.get("ETag")})
                log.info("  parte %s/%s caricata", number, part_count)

        _, etag = self.get_document(doc_id)
        self._request(
            "POST", f"/vfp/api/v1/documents/{doc_id}/files/completemultipartupload",
            json={"Key": info["Key"], "UploadId": info["UploadId"], "Parts": parts},
            headers={"If-Match": etag},
        )


# --------------------------------------------------------------------------- sorgente

@dataclass
class SourceItem:
    file: Path
    folder: tuple  # percorso cartelle di destinazione, relativo alla radice in VFP
    name: str
    revision: str
    description: str = ""

    @property
    def key(self):
        """Chiave usata nel file di stato per riconoscere un file gia' trasferito."""
        return f"{self.file}|{self.revision}"


def _is_ignored(path):
    name = path.name.casefold()
    return name in IGNORED_FILES or name.startswith("~$") or name.startswith(".")


def items_from_folder(root, default_revision):
    """Ogni file dell'export diventa un documento; le sottocartelle diventano Document Folders."""
    root = Path(root)
    if not root.is_dir():
        raise ValueError(f"cartella di origine non trovata: {root}")
    for path in sorted(p for p in root.rglob("*") if p.is_file() and not _is_ignored(p)):
        rel = path.relative_to(root)
        yield SourceItem(path, rel.parent.parts, path.stem, default_revision)


def items_from_manifest(manifest_path, base_dir, default_revision):
    """
    CSV con colonne: file, folder, name, revision, description.
    Piu' righe con lo stesso folder+name (in ordine) = storico delle revisioni dello stesso documento.
    """
    base_dir = Path(base_dir)
    with open(manifest_path, newline="", encoding="utf-8-sig") as f:
        sample = f.read(4096)
        f.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;")
        except csv.Error:  # es. una sola colonna: lo Sniffer non riesce a decidere
            class dialect(csv.excel):
                delimiter = ";" if sample.count(";") >= sample.count(",") else ","
        reader = csv.DictReader(f, dialect=dialect)
        if "file" not in (reader.fieldnames or []):
            raise ValueError(f"il manifest deve avere la colonna 'file' (trovate: {reader.fieldnames})")
        for row in reader:
            if not (row.get("file") or "").strip():
                continue
            file = Path(row["file"].strip())
            if not file.is_absolute():
                file = base_dir / file
            folder = tuple(p for p in (row.get("folder") or "").replace("\\", "/").split("/") if p)
            yield SourceItem(
                file=file,
                folder=folder,
                name=(row.get("name") or file.stem).strip(),
                revision=(row.get("revision") or default_revision).strip(),
                description=(row.get("description") or "").strip(),
            )


def load_items(source, manifest, default_revision):
    if manifest:
        return list(items_from_manifest(manifest, source, default_revision))
    return list(items_from_folder(source, default_revision))


# --------------------------------------------------------------------------- trasferimento

def load_state(state_path):
    """
    Stato per la ripresa: "completati" = file caricati, "in_sospeso" = documento o revisione
    creati in VFP ma con upload non concluso (al rilancio si ricarica solo il file).
    """
    state_path = Path(state_path)
    if not state_path.exists():
        return {"completati": {}, "in_sospeso": {}}
    state = json.loads(state_path.read_text(encoding="utf-8"))
    if "completati" not in state:  # vecchio formato: dizionario piatto dei soli file caricati
        state = {"completati": state, "in_sospeso": {}}
    state.setdefault("in_sospeso", {})
    return state


class Transfer:
    def __init__(self, client, cfg, state_path, report_path, dry_run, on_event=None, stop_event=None, on_item=None):
        self.client = client
        self.cfg = cfg
        self.dry_run = dry_run
        self.on_event = on_event  # callback(item, esito, id_documento, messaggio), usata dalla GUI
        self.on_item = on_item  # callback(item) all'inizio del trasferimento di ogni file
        self.stop_event = stop_event  # threading.Event: se impostato, si ferma dopo il file in corso
        self.target_type = cfg["target"]["type"]  # "project" oppure "folder"
        self.target_id = cfg["target"]["id"]
        self.if_exists = cfg.get("if_exists", "new_revision")  # "new_revision" oppure "skip"
        self.extra = cfg.get("document_defaults", {})
        self.folder_cache = {(): (self.target_type, self.target_id)}
        self.doc_cache = {}
        self.state_path = Path(state_path)
        self.state = load_state(self.state_path)
        self.report_file = None
        if not dry_run:  # la prova non scrive nel report
            new_report = not Path(report_path).exists()
            self.report_file = open(report_path, "a", newline="", encoding="utf-8")
            self.report = csv.writer(self.report_file, delimiter=";")
            if new_report:
                self.report.writerow(["data", "file", "cartella", "nome", "revisione", "esito", "id_documento", "messaggio"])

    def close(self):
        if self.report_file:
            self.report_file.close()

    def _save_state(self):
        self.state_path.write_text(json.dumps(self.state, indent=1), encoding="utf-8")

    def _ensure_folder(self, parts):
        if parts in self.folder_cache:
            return self.folder_cache[parts][1]
        if len(parts) == 1:
            parent_type, parent_id = self.folder_cache[()]
        else:
            parent_type, parent_id = "folder", self._ensure_folder(parts[:-1])
        name = parts[-1][:MAX_NAME_LEN]
        folder_id = self.client.find_child_folder(parent_type, parent_id, name)
        if folder_id is None:
            folder_id = self.client.create_folder(parent_id, name)
            log.info("Creata cartella %s", "/".join(parts))
        self.folder_cache[parts] = ("folder", folder_id)
        return folder_id

    def run(self, items):
        counts = {"caricato": 0, "saltato": 0, "errore": 0, "prova": 0, "interrotto": False}
        # documenti con una revisione non andata a buon fine: le revisioni successive dello stesso
        # documento non vanno caricate, altrimenti alla ripresa la revisione mancante finirebbe sopra di loro
        blocked = set()
        for item in items:
            if self.stop_event is not None and self.stop_event.is_set():
                counts["interrotto"] = True
                log.warning("Trasferimento interrotto dall'utente")
                break
            key = item.key
            doc_key = (item.folder, item.name[:MAX_NAME_LEN].casefold())
            if key in self.state["completati"]:
                self._record(item, "saltato", self.state["completati"][key], "gia' trasferito in precedenza", counts)
                continue
            problem = None
            if doc_key in blocked:
                problem = "una revisione precedente dello stesso documento non e' stata caricata"
            elif not item.file.is_file():
                problem = "file di origine non trovato"
            elif not item.folder and self.target_type == "project":
                # in VFP un documento deve stare dentro una Document Folder, non direttamente nel progetto
                problem = "file nella radice: con destinazione 'progetto' serve una cartella"
            if problem:
                blocked.add(doc_key)
                self._record(item, "errore", "", problem, counts)
                continue
            if self.dry_run:
                folder_label = "/".join(item.folder) or "(radice)"
                self._record(item, "prova", "", f"-> {folder_label} / {item.name} rev. {item.revision}", counts)
                continue
            if self.on_item:
                self.on_item(item)
            try:
                status, doc_id, msg = self._transfer_one(item, key)
                if status == "caricato":
                    self.state["completati"][key] = doc_id
                    self.state["in_sospeso"].pop(key, None)
                    self._save_state()
                self._record(item, status, doc_id, msg, counts)
            except LoginError:
                raise  # senza login nessun file puo' passare: inutile proseguire
            except Exception as e:  # un file in errore non deve fermare gli altri
                log.exception("Errore su %s", item.file)
                blocked.add(doc_key)
                self._record(item, "errore", self.state["in_sospeso"].get(key, ""), str(e), counts)
        return counts

    def _transfer_one(self, item, key):
        folder_id = self.target_id if not item.folder else self._ensure_folder(item.folder)
        name = item.name[:MAX_NAME_LEN]
        cache_key = (folder_id, name.casefold())

        pending_id = self.state["in_sospeso"].get(key)
        if pending_id:
            # documento/revisione gia' creati in un tentativo precedente: manca solo il file
            doc_id, msg = pending_id, "upload ripreso"
        else:
            doc_id = self.doc_cache.get(cache_key)
            if doc_id is None:
                existing = self.client.find_document(folder_id, name)
                doc_id = existing["Id"] if existing else None

            if doc_id is None:
                doc_id = self.client.create_document(folder_id, name, item.revision, item.description, self.extra)
                msg = "documento creato"
            elif self.if_exists == "skip" and cache_key not in self.doc_cache:
                return "saltato", doc_id, "documento gia' presente in VFP"
            else:
                try:
                    self.client.create_revision(doc_id, item.revision, {})
                except VfpError as e:
                    if e.status == 409:
                        return "saltato", doc_id, f"revisione {item.revision} gia' presente"
                    raise
                msg = "nuova revisione"
            self.state["in_sospeso"][key] = doc_id
            self._save_state()

        self.doc_cache[cache_key] = doc_id
        self.client.upload_file(doc_id, item.file)
        return "caricato", doc_id, msg

    def _record(self, item, status, doc_id, msg, counts):
        counts[status] += 1
        log.info("%s: %s (%s)", status.upper(), item.file, msg)
        if self.report_file:
            self.report.writerow([csv_cell(v) for v in (
                datetime.now().isoformat(timespec="seconds"), str(item.file), "/".join(item.folder),
                item.name, item.revision, status, doc_id, msg,
            )])
            self.report_file.flush()
        if self.on_event:
            self.on_event(item, status, doc_id, msg)


# --------------------------------------------------------------------------- main

def main():
    parser = argparse.ArgumentParser(description="Trasferisce file da un altro DMS a Viewpoint For Projects.")
    parser.add_argument("--env", default=None, help="file .env con impostazioni e credenziali (predefinito: .env accanto al programma)")
    parser.add_argument("--source", required=True, help="cartella con i file esportati dal DMS di origine")
    parser.add_argument("--manifest", help="CSV opzionale con cartella, nome, revisione e descrizione per ogni file")
    parser.add_argument("--dry-run", action="store_true", help="mostra cosa verrebbe fatto senza chiamare VFP")
    parser.add_argument("--report", default="report_trasferimento.csv")
    parser.add_argument("--state", default="stato_trasferimento.json", help="file per riprendere un trasferimento interrotto")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    import env_config  # import qui: il modulo e' usabile anche come libreria senza .env
    settings = env_config.load_settings(args.env or env_config.ENV_PATH)
    try:
        cfg = env_config.vfp_config(settings)
    except ValueError as e:
        sys.exit(f"Errore nel file .env: {e}")
    if not args.dry_run and env_config.vfp_problems(settings):
        sys.exit("Completare il file .env: " + "; ".join(env_config.vfp_problems(settings)))
    default_revision = cfg.get("default_revision", "1")

    try:
        items = load_items(args.source, args.manifest, default_revision)
    except (ValueError, OSError) as e:
        sys.exit(f"Errore nella lettura della sorgente: {e}")
    log.info("%s file da trasferire", len(items))

    tokens = TokenManager(cfg["auth"], cfg["token_cache"])
    client = VfpClient(cfg["base_url"], tokens)
    transfer = Transfer(client, cfg, args.state, args.report, args.dry_run)
    try:
        counts = transfer.run(items)
    except LoginError as e:
        sys.exit(str(e))
    finally:
        transfer.close()
    if args.dry_run:
        log.info("Fine prova: %s file pronti, %s gia' trasferiti, %s errori.",
                 counts["prova"], counts["saltato"], counts["errore"])
    else:
        log.info("Fine: %s caricati, %s saltati, %s errori. Report: %s",
                 counts["caricato"], counts["saltato"], counts["errore"], args.report)


if __name__ == "__main__":
    main()
