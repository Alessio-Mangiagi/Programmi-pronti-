# "><(((º> sabusabu <º)))><"
"""Avvio della versione AUTONOMA di Confronto Documenti: quella che si manda a un collega come cartella zip e
che parte con un doppio clic, senza suite Cosedil, senza portale e senza Python installato.

È il punto d'ingresso dell'exe costruito da build-autonomo.bat (ConfrontoAutonomo.spec). Il programma è lo stesso
di server.py; qui si decide solo COME gira su un PC qualunque, impostando le variabili d'ambiente che server.py e
confronta_pdf.py leggono all'import (per questo `import server` sta dentro main(), dopo):

  - COSEDIL_SSO=off         niente login del portale (che su quel PC non esiste);
  - HOST=127.0.0.1          risponde solo al PC su cui gira: senza login non deve essere raggiungibile dalla rete;
  - PORT                    5001, o la prima libera fino a 5020 se è occupata da un altro programma;
  - CONFRONTO_DATI          %LOCALAPPDATA%\\Confronto Documenti: storico e cache OCR restano lì anche se la
                            cartella del programma viene spostata, sostituita con una versione nuova o sta in un
                            posto dove non si può scrivere.

Se il programma è già aperto (stessa porta) non ne parte un secondo: si riapre solo la pagina nel browser.
I PDF firmati .p7m si aprono con busta_autonoma (estrazione senza verifica della firma), a meno che accanto
all'exe ci sia il motore vero in shared\\firma. L'OCR usa la cartella Tesseract-OCR accanto all'exe.

Si può provare anche dal repo, senza costruire l'exe:  .venv\\Scripts\\python.exe autonomo.py
"""
from __future__ import annotations

import json
import os
import socket
import sys
import urllib.request
import webbrowser
from pathlib import Path

NOME = "Confronto Documenti"
PORTA_PREFERITA = 5001      # la stessa di sempre: lo Storico sta nel browser ed è legato a indirizzo e porta
PORTE_DI_RISERVA = 20       # quante porte successive provare se la preferita è di un altro programma


def gia_aperto(porta: int) -> bool:
    """Vero se su quella porta risponde già Confronto Documenti (lo si riconosce da /healthz, che rende
    {"ok": true, "tesseract": ...}). Un altro programma sulla stessa porta, o nessuno, dà False."""
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{porta}/healthz", timeout=2) as r:
            dati = json.loads(r.read().decode("utf-8"))
        return isinstance(dati, dict) and dati.get("ok") is True and "tesseract" in dati
    except (OSError, ValueError):
        return False


def porta_libera(porta: int) -> bool:
    """Vero se la porta si può aprire in ascolto su 127.0.0.1 (prova e richiude subito)."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", porta))
        except OSError:
            return False
    return True


def scegli_porta() -> int | None:
    """La porta su cui partire: la preferita se libera, altrimenti la prima libera fra le successive.
    None se non ce n'è nessuna (caso anomalo: lo dice main())."""
    return next((p for p in range(PORTA_PREFERITA, PORTA_PREFERITA + PORTE_DI_RISERVA + 1) if porta_libera(p)), None)


def cartella_dati() -> Path:
    """Dove stanno storico e cache OCR: CONFRONTO_DATI se chi avvia l'ha impostata, altrimenti la cartella
    dell'utente in %LOCALAPPDATA% (creata se manca). Senza LOCALAPPDATA (non Windows) si usa la home."""
    if os.environ.get("CONFRONTO_DATI"):
        return Path(os.environ["CONFRONTO_DATI"])
    base = os.environ.get("LOCALAPPDATA") or str(Path.home())
    return Path(base) / NOME


def main() -> int:
    # console con caratteri accentati anche su PC con codifiche vecchie: mai un errore per una stampa
    for flusso in (sys.stdout, sys.stderr):
        if hasattr(flusso, "reconfigure"):
            flusso.reconfigure(errors="replace")
    if os.name == "nt":
        import ctypes
        ctypes.windll.kernel32.SetConsoleTitleW(f"{NOME} - non chiudere questa finestra mentre lo usi")

    if gia_aperto(PORTA_PREFERITA):
        print(f"{NOME} è già aperto: riapro la pagina nel browser.")
        webbrowser.open(f"http://127.0.0.1:{PORTA_PREFERITA}")
        return 0
    porta = scegli_porta()
    if porta is None:
        print(f"Nessuna porta libera fra {PORTA_PREFERITA} e {PORTA_PREFERITA + PORTE_DI_RISERVA}: "
              "chiudere gli altri programmi e riprovare.")
        return 1

    dati = cartella_dati()
    dati.mkdir(parents=True, exist_ok=True)
    os.environ["COSEDIL_SSO"] = "off"
    os.environ["HOST"] = "127.0.0.1"
    os.environ["PORT"] = str(porta)
    os.environ["CONFRONTO_DATI"] = str(dati)
    # Niente password: con CONFRONTO_PASSWORD ereditata dall'ambiente il browser chiederebbe utente e password
    # a chi ha solo fatto doppio clic. L'accesso è già limitato a questo PC (127.0.0.1).
    os.environ.pop("CONFRONTO_PASSWORD", None)

    print("=" * 62)
    print(f"  {NOME}")
    print(f"  Pagina del programma: http://127.0.0.1:{porta}")
    print("  Si apre da sola nel browser. I documenti restano su questo PC.")
    print("  Per CHIUDERE il programma: chiudi questa finestra.")
    print("=" * 62)
    if porta != PORTA_PREFERITA:
        print(f"Nota: la porta {PORTA_PREFERITA} è usata da un altro programma, uso la {porta}. "
              "Lo Storico dei confronti fatti sull'altra porta qui non compare.")

    import server                      # solo ora: legge le variabili impostate qui sopra

    if server.firma_busta is None:     # nessun motore vero in shared\firma accanto all'exe: estrazione senza verifica
        import busta_autonoma
        server.firma_busta = busta_autonoma
    if server.find_tesseract() is None:
        print("Attenzione: manca la cartella Tesseract-OCR accanto al programma. I PDF con testo si confrontano "
              "lo stesso; le scansioni e le immagini no.")
    print(f"Storico e cache in: {dati}\n", flush=True)
    server.avvia()
    return 0


if __name__ == "__main__":
    try:
        codice = main()
    except Exception as errore:                                   # noqa: BLE001 - qualunque errore d'avvio
        # la finestra si chiuderebbe da sola portandosi via il messaggio: lo si lascia leggere
        import traceback
        traceback.print_exc()
        print(f"\n{NOME} non è partito: {errore}")
        codice = 1
    if codice and sys.stdin and sys.stdin.isatty():
        input("Premi Invio per chiudere.")
    sys.exit(codice)
