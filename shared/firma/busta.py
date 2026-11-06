# "><(((º> sabusabu <º)))><"
"""Client Python del motore della firma digitale, per i programmi Python della suite (SkyTower, Confronto
Documenti…): non importa librerie di verifica, chiama `firma.py` con l'ambiente `shared/firma/.venv`.

    from busta import e_busta_firmata, apri, FirmaNonInstallata, BustaIllegibile
    if e_busta_firmata(dati, nome):
        contenuto, nome_pdf, rapporto = apri(dati, nome)      # rapporto = JSON di firma.py apri

`e_busta_firmata` è solo stdlib (si può usare anche senza l'ambiente installato). `apri` solleva
`FirmaNonInstallata` se manca `shared/firma/.venv` (lanciare shared/firma/installa.bat) e `BustaIllegibile` se il
file .p7m è rotto. Variabile FIRMA_PYTHON: un altro interprete con le librerie (es. nell'immagine Docker).
"""
from __future__ import annotations

import base64
import binascii
import json
import os
import re
import subprocess
import tempfile
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


def python_firma() -> Path:
    """L'interprete con le librerie di verifica."""
    if os.environ.get("FIRMA_PYTHON"):
        return Path(os.environ["FIRMA_PYTHON"])
    return CARTELLA / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def apri(dati: bytes, nome: str | None = None, *, rete: bool = True, verifica: bool = True,
         timeout: float = 180) -> tuple[bytes, str, dict]:
    """(documento contenuto, suo nome, rapporto della verifica). Un file non firmato torna com'è."""
    py = python_firma()
    if not py.exists():
        raise FirmaNonInstallata("Componente firma digitale non installato: lanciare shared\\firma\\installa.bat")
    with tempfile.TemporaryDirectory(prefix="firma-") as tmp:
        entrata, uscita = Path(tmp) / "busta.p7m", Path(tmp) / "contenuto"
        entrata.write_bytes(dati)
        comando = [str(py), str(CARTELLA / "firma.py"), "apri", str(entrata), "--nome", nome or "documento.p7m",
                   "--estrai", str(uscita)]
        if not rete:
            comando.append("--senza-rete")
        if not verifica:
            comando.append("--senza-verifica")
        r = subprocess.run(comando, capture_output=True, timeout=timeout, cwd=str(CARTELLA))
        testo = r.stdout.decode("utf-8", "replace").strip().splitlines()
        rapporto = json.loads(testo[-1]) if testo else {}
        if r.returncode == 2:
            raise BustaIllegibile(rapporto.get("errore") or "Busta firmata illeggibile")
        if r.returncode != 0:
            raise RuntimeError(f"Verifica della firma non riuscita: {r.stderr.decode('utf-8', 'replace')[-500:]}")
        return uscita.read_bytes(), rapporto.get("nome_contenuto") or "documento.pdf", rapporto
