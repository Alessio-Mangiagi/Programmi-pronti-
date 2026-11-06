# "><(((º> sabusabu <º)))><"
"""Elenchi ufficiali degli enti fiduciari (Trusted List eIDAS): chi può emettere certificati di firma qualificati
e marche temporali qualificate, e da quando a quando.

Fonti (variabile FIRMA_ELENCHI):
  - "eu" (default): la lista delle liste europea (LOTL, https://ec.europa.eu/tools/lotl/eu-lotl.xml) e da lì
    le Trusted List di tutti gli Stati, compresa quella italiana di AgID;
  - "it": solo https://eidas.agid.gov.it/TL/TSL-IT.xml (più veloce, ma una firma qualificata tedesca risulterebbe
    "ente non presente negli elenchi").
Gli elenchi si scaricano in HTTPS dagli indirizzi ufficiali; la firma XML degli elenchi non è ricontrollata
(limite dichiarato nel README). Il risultato, già ridotto ai servizi che servono, sta in
`FIRMA_CACHE_DIR/elenchi.json` (default `shared/firma/cache/`, fuori da git). Si scarica subito solo se la cache
manca; se è più vecchia di FIRMA_ELENCHI_ORE (default 24) si aggiorna in un processo separato e intanto vale
quella vecchia, così nessun programma aspetta i download.

Per ogni servizio si tiene la storia degli stati (stato attuale + ServiceHistory): un ente certificatore oggi
cessato era valido quando la marca temporale dice che la firma è stata fatta.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

from asn1crypto import pem, x509

NS = {"t": "http://uri.etsi.org/02231/v2#"}
LOTL_URL = "https://ec.europa.eu/tools/lotl/eu-lotl.xml"
IT_URL = "https://eidas.agid.gov.it/TL/TSL-IT.xml"
SVC = "http://uri.etsi.org/TrstSvc/Svctype/"
STATO = "http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/"
# enti che emettono certificati qualificati di firma / marche temporali
TIPI_FIRMA = {SVC + "CA/QC", SVC + "NationalRootCA-QC"}
TIPI_MARCA = {SVC + "TSA/QTST", SVC + "TSA/TSS-QC", SVC + "TSA/TSS-AdESQCandQES", SVC + "TSA"}
# stati in cui il servizio è affidabile: "granted" dal 2016, prima "undersupervision"/"accredited";
# "recognisedatnationallevel" vale per le marche temporali riconosciute in Italia (TSS-QC)
STATI_OK = {STATO + s for s in ("granted", "undersupervision", "accredited", "supervisionincessation",
                                "recognisedatnationallevel")}
TIPO_XML = "application/vnd.etsi.tsl+xml"


def _cartella() -> Path:
    return Path(os.environ.get("FIRMA_CACHE_DIR") or Path(__file__).with_name("cache"))


def _data(testo: str | None) -> datetime | None:
    if not testo:
        return None
    d = datetime.fromisoformat(testo.strip().replace("Z", "+00:00"))
    return d if d.tzinfo else d.replace(tzinfo=UTC)


# ---------------------------------------------------------------------------------------------------------------
# Lettura di una Trusted List
# ---------------------------------------------------------------------------------------------------------------
def _certificati(nodo) -> list[str]:
    return [c.text.strip() for c in nodo.iterfind(".//t:ServiceDigitalIdentity/t:DigitalId/t:X509Certificate", NS)
            if c.text and c.text.strip()]


def leggi_tsl(xml: bytes) -> list[dict]:
    """Servizi utili di una Trusted List: [{tipo, nome, paese, certificati[b64], periodi[[inizio, fine, stato]]}].
    Solo i tipi di TIPI_FIRMA e TIPI_MARCA; i periodi coprono la storia del servizio, dal più vecchio."""
    radice = ET.fromstring(xml)
    paese = radice.findtext(".//t:SchemeInformation/t:SchemeTerritory", namespaces=NS) or ""
    servizi = []
    for svc in radice.iterfind(".//t:TSPService", NS):
        info = svc.find("t:ServiceInformation", NS)
        tipo = info.findtext("t:ServiceTypeIdentifier", namespaces=NS)
        if tipo not in TIPI_FIRMA | TIPI_MARCA:
            continue
        nome = info.findtext("t:ServiceName/t:Name", namespaces=NS) or ""
        eventi = [(_data(info.findtext("t:StatusStartingTime", namespaces=NS)), info.findtext("t:ServiceStatus", namespaces=NS))]
        certificati = set(_certificati(info))
        for storia in svc.iterfind("t:ServiceHistory/t:ServiceHistoryInstance", NS):
            eventi.append((_data(storia.findtext("t:StatusStartingTime", namespaces=NS)),
                           storia.findtext("t:ServiceStatus", namespaces=NS)))
            certificati |= set(_certificati(storia))
        eventi = sorted((e for e in eventi if e[0] is not None), key=lambda e: e[0])
        periodi = [[inizio.isoformat(), eventi[i + 1][0].isoformat() if i + 1 < len(eventi) else None, stato]
                   for i, (inizio, stato) in enumerate(eventi)]
        if certificati and periodi:
            servizi.append({"tipo": tipo, "nome": nome, "paese": paese, "certificati": sorted(certificati),
                            "periodi": periodi})
    return servizi


def indirizzi_lotl(xml: bytes) -> list[str]:
    """Gli indirizzi delle Trusted List nazionali in XML elencati nella LOTL europea."""
    radice = ET.fromstring(xml)
    indirizzi = []
    for p in radice.iterfind(".//t:PointersToOtherTSL/t:OtherTSLPointer", NS):
        url = p.findtext("t:TSLLocation", namespaces=NS)
        mime = [m.text for m in p.iter() if m.tag.endswith("MimeType")]
        if url and (TIPO_XML in mime or url.lower().endswith(".xml")) and "lotl" not in url.lower():
            indirizzi.append(url.strip())
    return list(dict.fromkeys(indirizzi))


# ---------------------------------------------------------------------------------------------------------------
# Scaricamento e cache
# ---------------------------------------------------------------------------------------------------------------
def _scarica_url(url: str, timeout: float = 40) -> bytes:
    import requests                                                      # solo qui: chi legge la cache non lo carica
    r = requests.get(url, timeout=timeout, headers={"User-Agent": "SuiteCosedil-firma/1.0"})
    r.raise_for_status()
    return r.content


def scarica(fonte: str | None = None) -> dict:
    """Scarica gli elenchi e riscrive la cache. Ritorna il contenuto scritto. Un elenco nazionale che non si
    scarica non ferma gli altri (finisce in "errori")."""
    fonte = (fonte or os.environ.get("FIRMA_ELENCHI") or "eu").lower()
    indirizzi = indirizzi_lotl(_scarica_url(LOTL_URL)) if fonte == "eu" else []
    if IT_URL not in indirizzi:
        indirizzi.append(IT_URL)
    servizi, errori = [], {}

    def uno(url):
        try:
            return url, leggi_tsl(_scarica_url(url)), None
        except Exception as e:                                           # noqa: BLE001 - un paese giù non blocca
            return url, [], str(e)[:200]
    with ThreadPoolExecutor(max_workers=8) as pool:
        for url, trovati, errore in pool.map(uno, indirizzi):
            servizi.extend(trovati)
            if errore:
                errori[url] = errore
    if not servizi:
        raise RuntimeError(f"Nessun elenco scaricato: {errori}")
    dati = {"aggiornato": datetime.now(UTC).isoformat(), "fonte": fonte, "elenchi": len(indirizzi) - len(errori),
            "errori": errori, "servizi": servizi}
    cartella = _cartella()
    cartella.mkdir(parents=True, exist_ok=True)
    tmp = cartella / "elenchi.json.tmp"
    tmp.write_text(json.dumps(dati, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, cartella / "elenchi.json")
    return dati


def _aggiorna_in_disparte() -> None:
    """Aggiornamento in un processo staccato (cache vecchia): niente attese per chi sta aprendo un documento.
    Il file di lock evita dieci aggiornamenti insieme se arrivano dieci documenti."""
    lock = _cartella() / "aggiornamento.lock"
    try:
        if lock.exists() and time.time() - lock.stat().st_mtime < 600:
            return
        lock.parent.mkdir(parents=True, exist_ok=True)
        lock.write_text(str(os.getpid()))
        opzioni = {"stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL, "stdin": subprocess.DEVNULL}
        if os.name == "nt":
            opzioni["creationflags"] = 0x00000008 | 0x08000000          # DETACHED_PROCESS | CREATE_NO_WINDOW
        else:
            opzioni["start_new_session"] = True
        subprocess.Popen([sys.executable, str(Path(__file__).with_name("firma.py")), "aggiorna-elenchi"], **opzioni)
    except OSError:
        pass


# ---------------------------------------------------------------------------------------------------------------
# Elenchi caricati
# ---------------------------------------------------------------------------------------------------------------
class Elenchi:
    """Servizi fiduciari in memoria; `ancore(momento)` dà i certificati affidabili a quella data."""

    def __init__(self, servizi: list[dict], aggiornato: str | None = None, fonte: str | None = None,
                 extra=(), errore: str | None = None):
        self.servizi = servizi
        self.aggiornato = aggiornato
        self.fonte = fonte
        self.errore = errore
        self._extra: list[x509.Certificate] = []
        self._cache: dict[str, x509.Certificate] = {}
        self.aggiungi(extra)

    def aggiungi(self, extra) -> None:
        """Certificati di fiducia in più (test, enti privati): valgono sempre, per firme e marche."""
        for c in extra or ():
            self._extra.append(c if isinstance(c, x509.Certificate) else carica_certificato(c))

    def _cert(self, b64: str) -> x509.Certificate | None:
        if b64 not in self._cache:
            try:
                self._cache[b64] = x509.Certificate.load(base64.b64decode(b64))
            except Exception:                                            # noqa: BLE001 - voce rotta nell'elenco
                self._cache[b64] = None
        return self._cache[b64]

    def ancore(self, momento: datetime, marca: bool = False) -> list[x509.Certificate]:
        tipi = TIPI_MARCA if marca else TIPI_FIRMA
        trovati = {}
        for s in self.servizi:
            if s["tipo"] not in tipi:
                continue
            for inizio, fine, stato in s["periodi"]:
                if (stato in STATI_OK and _data(inizio) <= momento
                        and (fine is None or momento < _data(fine))):
                    for b64 in s["certificati"]:
                        c = self._cert(b64)
                        if c is not None:
                            trovati[c.sha256] = c
                    break
        for c in self._extra:
            trovati[c.sha256] = c
        return list(trovati.values())

    def descrizione(self) -> dict:
        return {"fonte": self.fonte, "aggiornati_il": self.aggiornato, "servizi": len(self.servizi),
                "errore": self.errore}


def carica_certificato(dati: bytes | str | Path) -> x509.Certificate:
    """Un certificato da byte DER/PEM o da percorso (.cer, .crt, .pem, .der)."""
    if isinstance(dati, (str, Path)):
        dati = Path(dati).read_bytes()
    if pem.detect(dati):
        _, _, dati = pem.unarmor(dati)
    return x509.Certificate.load(dati)


def carica(rete: bool = True, extra=()) -> Elenchi:
    """Gli elenchi dalla cache (scaricati subito se mancano e c'è la rete; aggiornati in disparte se vecchi)."""
    file = _cartella() / "elenchi.json"
    dati, errore = None, None
    if file.exists():
        try:
            dati = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, ValueError) as e:
            errore = f"cache illeggibile: {e}"
    if dati is None and rete:
        try:
            dati = scarica()
        except Exception as e:                                           # noqa: BLE001 - niente rete
            errore = f"elenchi non scaricabili: {e}"[:300]
    elif dati is not None and rete:
        ore = float(os.environ.get("FIRMA_ELENCHI_ORE") or 24)
        if datetime.now(UTC) - _data(dati.get("aggiornato")) > __import__("datetime").timedelta(hours=ore):
            _aggiorna_in_disparte()
    if dati is None:
        return Elenchi([], extra=extra, errore=errore or "elenchi assenti (verifica senza rete)")
    return Elenchi(dati.get("servizi", []), dati.get("aggiornato"), dati.get("fonte"), extra=extra)
