# "><(((º> sabusabu <º)))><"
"""Client Python del motore della firma digitale, per i programmi Python della suite (SkyTower, Confronto
Documenti…): non importa librerie di verifica, chiama `firma.py` con l'ambiente `shared/firma/.venv`.

    from busta import e_busta_firmata, apri, FirmaNonInstallata, BustaIllegibile
    if e_busta_firmata(dati, nome):
        contenuto, nome_pdf, rapporto = apri(dati, nome)      # rapporto = JSON di firma.py apri

`e_busta_firmata` è solo stdlib (si può usare anche senza l'ambiente installato). `apri` solleva
`FirmaNonInstallata` se manca il motore o il suo `.venv` (su Windows l'installazione parte da sola in disparte alla
prima busta: il messaggio dice di riprovare fra qualche minuto) e `BustaIllegibile` se il file .p7m è rotto.
Il motore si cerca in FIRMA_DIR, poi in <cartella dell'eseguibile>/shared/firma (programmi impacchettati con
PyInstaller), poi nella cartella di questo file (vedi `candidati_motore`). Variabile FIRMA_PYTHON: un altro
interprete con le librerie (es. nell'immagine Docker).
"""
from __future__ import annotations

import base64
import binascii
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CARTELLA = Path(__file__).resolve().parent
OID_SIGNED_DATA = b"\x06\x09\x2a\x86\x48\x86\xf7\x0d\x01\x07\x02"


class FirmaNonInstallata(RuntimeError):
    """Manca l'ambiente Python del motore della firma (shared/firma/.venv)."""


class BustaIllegibile(ValueError):
    """Il file sembra un .p7m ma la busta non si legge (rotta, troncata, firma staccata)."""


def e_busta_firmata(dati: bytes, nome: str | None = None) -> bool:
    """Vero se il file è una busta CAdES: per estensione .p7m o per contenuto (DER, oppure base64/PEM)."""
    if nome and str(nome).lower().rstrip().endswith(".p7m"):
        return True
    if dati[:1] == b"\x30" and OID_SIGNED_DATA in dati[:64]:
        return True
    testo = dati[:64 * 1024].strip()
    if testo.startswith(b"-----BEGIN"):
        testo = b"".join(r for r in testo.splitlines() if r and not r.startswith(b"-----"))
    if testo[:2] in (b"MI", b"MC"):
        try:
            der = base64.b64decode(re.sub(rb"\s+", b"", testo)[:4096 // 4 * 4] or b"", validate=True)
        except (binascii.Error, ValueError):
            return False
        return der[:1] == b"\x30" and OID_SIGNED_DATA in der[:64]
    return False


def candidati_motore() -> list[Path]:
    """Cartelle dove può stare il motore (firma.py, installa.bat e, installato, .venv), nell'ordine in cui si
    provano. Gemella di candidatiMotore in firma.js."""
    candidati = []
    # 1. indicata a mano: motore installato altrove (es. una sola copia per più programmi sullo stesso PC)
    if os.environ.get("FIRMA_DIR"):
        candidati.append(Path(os.environ["FIRMA_DIR"]).resolve())
    # 2. accanto all'eseguibile: un programma impacchettato con PyInstaller (Confronto Documenti) non ha il repo
    #    intorno; il motore si copia accanto all'exe in shared\firma (shared/firma/copia-motore.bat). Con un Python
    #    normale sys.executable è dentro un .venv e la cartella non esiste: si passa oltre.
    candidati.append(Path(sys.executable).resolve().parent / "shared" / "firma")
    # 3. la cartella di questo file: programmi lanciati dal repo o da una copia della suite
    candidati.append(CARTELLA)
    return candidati


def cartella_motore() -> Path | None:
    """La prima cartella candidata che contiene firma.py, None se il motore non c'è da nessuna parte."""
    return next((c for c in candidati_motore() if (c / "firma.py").is_file()), None)


def python_firma() -> Path:
    """L'interprete con le librerie di verifica: FIRMA_PYTHON, altrimenti il .venv del motore trovato."""
    if os.environ.get("FIRMA_PYTHON"):
        return Path(os.environ["FIRMA_PYTHON"])
    cartella = cartella_motore() or CARTELLA
    return cartella / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


# Installazione automatica alla prima busta (solo Windows, solo senza FIRMA_PYTHON): i programmi lanciati dal repo
# la fanno già nei loro avvia.bat, ma un .exe copiato su un PC o un servizio avviato in altro modo non passa di lì.
# installa.bat ha un lock suo (.installazione.lock): se più programmi lo lanciano insieme lavora uno solo. Al
# massimo un tentativo ogni 10 minuti per processo: se finisce senza .venv (manca Python, niente rete) non si
# riprova a ogni documento e il messaggio dice di lanciarlo a mano, così l'amministratore vede l'errore.
RIPROVA_INSTALLAZIONE_S = 600
_ultima_installazione = 0.0


def _avvia_installazione(cartella: Path) -> str:
    """Lancia installa.bat in disparte. Rende 'avviata' | 'in corso' | 'non riuscita' | 'manuale'."""
    global _ultima_installazione
    if os.name != "nt" or os.environ.get("FIRMA_PYTHON") or not (cartella / "installa.bat").is_file():
        return "manuale"
    if (cartella / ".installazione.lock").exists():
        return "in corso"
    if time.time() - _ultima_installazione < RIPROVA_INSTALLAZIONE_S:
        return "non riuscita"
    try:
        # cwd = cartella del motore, così cmd non deve quotare percorsi con spazi e parentesi ("Program Files (x86)").
        # ".\" esplicito: con NoDefaultCurrentDirectoryInExePath=1 (impostata da alcuni ambienti per sicurezza) cmd
        # non cerca i comandi senza percorso nella cartella corrente. Processo staccato e senza finestra: sopravvive
        # a chi l'ha chiesto e non trattiene la richiesta in corso.
        subprocess.Popen(["cmd.exe", "/d", "/c", ".\\installa.bat"], cwd=str(cartella), stdin=subprocess.DEVNULL,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         creationflags=0x00000008 | 0x08000000)          # DETACHED_PROCESS | CREATE_NO_WINDOW
    except OSError:
        return "manuale"
    _ultima_installazione = time.time()
    return "avviata"


def _messaggio_non_installato(cartella: Path | None) -> str:
    """Messaggio di FirmaNonInstallata, con quello che deve fare chi amministra il programma."""
    if cartella is None:
        cercato = "; ".join(str(c) for c in candidati_motore())
        return ("Componente firma digitale non trovato: copiare la cartella shared\\firma della suite accanto al "
                f"programma o indicarla con FIRMA_DIR (cercato in: {cercato})")
    if _avvia_installazione(cartella) in ("avviata", "in corso"):
        return ("Componente firma digitale in installazione (la prima volta prepara Python, librerie ed elenchi "
                "ufficiali, serve la rete): riprovare fra qualche minuto")
    return (f"Componente firma digitale non installato: lanciare {cartella / 'installa.bat'} "
            "(serve Python 3.12 e la rete)")


def apri(dati: bytes, nome: str | None = None, *, rete: bool = True, verifica: bool = True,
         timeout: float = 180) -> tuple[bytes, str, dict]:
    """(documento contenuto, suo nome, rapporto della verifica). Un file non firmato torna com'è."""
    cartella = cartella_motore()
    py = python_firma()
    if cartella is None or not py.exists():
        raise FirmaNonInstallata(_messaggio_non_installato(cartella))
    with tempfile.TemporaryDirectory(prefix="firma-") as tmp:
        entrata, uscita = Path(tmp) / "busta.p7m", Path(tmp) / "contenuto"
        entrata.write_bytes(dati)
        comando = [str(py), str(cartella / "firma.py"), "apri", str(entrata), "--nome", nome or "documento.p7m",
                   "--estrai", str(uscita)]
        if not rete:
            comando.append("--senza-rete")
        if not verifica:
            comando.append("--senza-verifica")
        r = subprocess.run(comando, capture_output=True, timeout=timeout, cwd=str(cartella))
        testo = r.stdout.decode("utf-8", "replace").strip().splitlines()
        rapporto = json.loads(testo[-1]) if testo else {}
        if r.returncode == 2:
            raise BustaIllegibile(rapporto.get("errore") or "Busta firmata illeggibile")
        if r.returncode != 0:
            raise RuntimeError(f"Verifica della firma non riuscita: {r.stderr.decode('utf-8', 'replace')[-500:]}")
        return uscita.read_bytes(), rapporto.get("nome_contenuto") or "documento.pdf", rapporto
