# -*- coding: utf-8 -*-
# "><(((º> sabusabu <º)))><"
"""
Installatore di Logbook da solo, FUORI dalla suite Cosedil (25/11/2026, risposta 4b:
"il programma deve poter funzionare fuori dalla suite e quindi si deve poter avviare sia
dentro che fuori").

Compilato in InstallaLogbook.exe (PyInstaller --onefile, vedi in fondo) e tenuto nella
cartella di Logbook, accanto ad avvia.bat. Su un PC qualsiasi basta copiare la cartella
Logbook (senza node_modules e data) e fare doppio clic su InstallaLogbook.exe. Serve solo
Node.js 20.19 o successivo: l'installatore NON lo installa (sarebbe software di sistema),
dice dove scaricarlo.

Passi:
1. controlla Node.js;
2. installa le dipendenze (npm ci con il lock, altrimenti npm install). Il postinstall
   genera anche il client del database (prisma generate);
3. se manca crea il file .env da .env.example e chiede, facoltativi:
   - l'email del proprietario, che riceve il codice per "Cancella tutti i dati";
   - se Logbook va raggiunto dagli altri PC della rete (HOST=0.0.0.0).
   Il server di posta (LOGBOOK_SMTP_*) si completa dopo, a mano, nel .env;
4. prepara il database e compila l'interfaccia (come il primo avvio: npm run prestart).
   Il database nuovo è vuoto, con l'utente admin e le festività nazionali;
5. crea sul desktop il collegamento "Logbook" ad avvia.bat.

Dentro la suite non serve: lo installa InstallaSuite.exe (installa-suite.py, voce "logbook")
e lo avvia la card del Portale. Le due strade usano la stessa cartella e lo stesso avvia.bat.

Uso:
  InstallaLogbook.exe                       con domande
  InstallaLogbook.exe --si                  senza domande (email e rete restano da impostare)
  InstallaLogbook.exe --senza-collegamento  non crea l'icona sul desktop
  InstallaLogbook.exe --dry-run             mostra i passi senza eseguirli

Compilazione (dalla cartella Logbook, con PyInstaller in un ambiente Python qualsiasi):
  python -m PyInstaller --onefile --name InstallaLogbook --distpath . installa-logbook.py
"""
import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

# Console Windows: accenti corretti sia da cmd sia dall'exe.
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if os.name == "nt":
    os.system("chcp 65001 >nul")

NODE_MIN = (20, 19)  # Prisma 7: "engines" di package.json


def cartella_logbook() -> Path:
    """Dall'exe: la cartella dove sta l'exe. Dal sorgente: quella del .py."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


DIR = cartella_logbook()
DRY = False
SENZA_DOMANDE = False


def say(msg: str = "") -> None:
    print(msg, flush=True)


def chiedi(domanda: str) -> str:
    """Risposta libera; vuota se non si può chiedere (--si, nessun terminale)."""
    if SENZA_DOMANDE or not sys.stdin or not sys.stdin.isatty():
        return ""
    try:
        return input(f"{domanda} ").strip()
    except EOFError:
        return ""


def run(cmd: str) -> None:
    """Esegue un comando nella cartella di Logbook mostrando l'output; errore se fallisce."""
    say(f"    $ {cmd}")
    if DRY:
        return
    r = subprocess.run(cmd, cwd=str(DIR), shell=True)
    if r.returncode != 0:
        raise RuntimeError(f"comando fallito (exit {r.returncode}): {cmd}")


def versione_node() -> tuple[int, int] | None:
    try:
        out = subprocess.run("node --version", shell=True, capture_output=True, text=True, timeout=30).stdout.strip()
        m = re.match(r"v(\d+)\.(\d+)", out)
        return (int(m.group(1)), int(m.group(2))) if m else None
    except Exception:
        return None


def imposta_env(testo: str, chiave: str, valore: str) -> str:
    """Scrive CHIAVE=valore nel testo del .env: sostituisce la riga (anche commentata) o la aggiunge."""
    riga = f"{chiave}={valore}"
    modello = re.compile(rf"^#?\s*{re.escape(chiave)}=.*$", re.MULTILINE)
    if modello.search(testo):
        return modello.sub(riga.replace("\\", "\\\\"), testo, count=1)
    return testo.rstrip("\n") + "\n" + riga + "\n"


def prepara_env() -> str:
    """Crea .env da .env.example (se manca) con le scelte dell'utente. Restituisce una nota."""
    env = DIR / ".env"
    if env.exists():
        return ".env già presente: lasciato com'è"
    esempio = DIR / ".env.example"
    testo = esempio.read_text(encoding="utf-8") if esempio.exists() else ""
    # Il proprietario è l'amministratore creato al primo avvio.
    testo = imposta_env(testo, "LOGBOOK_PROPRIETARIO", "admin")
    email = chiedi("Email del proprietario (riceve il codice per cancellare tutti i dati), invio per saltare:")
    if email:
        testo = imposta_env(testo, "LOGBOOK_PROPRIETARIO_EMAIL", email)
    rete = chiedi("Logbook deve essere raggiungibile dagli altri PC della rete? [s/N]").lower()
    if rete in ("s", "si", "sì", "y", "yes"):
        testo = imposta_env(testo, "HOST", "0.0.0.0")
    say(f"    creo {env.name}" + (f" (proprietario admin, email {email})" if email else " (proprietario admin)"))
    if not DRY:
        env.write_text(testo, encoding="utf-8")
    note = "creato .env"
    if not email:
        note += ": scrivere LOGBOOK_PROPRIETARIO_EMAIL"
    return note + " e completare LOGBOOK_SMTP_* (server di posta) per il codice via email"


def crea_collegamento() -> None:
    """Icona "Logbook" sul desktop dell'utente che punta ad avvia.bat (niente diritti di amministratore)."""
    bat = DIR / "avvia.bat"
    icona = DIR / "public" / "favicon.ico"
    ps = (
        "$s=(New-Object -ComObject WScript.Shell);"
        "$d=[Environment]::GetFolderPath('Desktop');"
        "$l=$s.CreateShortcut((Join-Path $d 'Logbook.lnk'));"
        f"$l.TargetPath='{bat}';$l.WorkingDirectory='{DIR}';"
        "$l.Description='Logbook - ore e presenze';"
        + (f"$l.IconLocation='{icona}';" if icona.exists() else "")
        + "$l.Save()"
    )
    run(f'powershell -NoProfile -ExecutionPolicy Bypass -Command "{ps}"')


def main() -> int:
    global DRY, SENZA_DOMANDE
    ap = argparse.ArgumentParser(description="Installatore di Logbook fuori dalla suite")
    ap.add_argument("--si", action="store_true", help="nessuna domanda")
    ap.add_argument("--senza-collegamento", action="store_true", help="non crea l'icona sul desktop")
    ap.add_argument("--dry-run", action="store_true", help="mostra i passi senza eseguirli")
    args = ap.parse_args()
    DRY, SENZA_DOMANDE = args.dry_run, args.si

    say("=" * 62)
    say("  Installazione di Logbook (ore e presenze)")
    say(f"  Cartella: {DIR}")
    say("=" * 62)
    try:
        if not (DIR / "package.json").exists():
            raise RuntimeError("package.json non trovato: InstallaLogbook.exe va tenuto nella cartella di Logbook")
        say("1. Node.js")
        v = versione_node()
        if not v or v < NODE_MIN:
            raise RuntimeError(
                f"serve Node.js {NODE_MIN[0]}.{NODE_MIN[1]} o successivo ({'assente' if not v else f'trovato {v[0]}.{v[1]}'}). "
                "Installarlo da https://nodejs.org e rilanciare."
            )
        say(f"    Node.js {v[0]}.{v[1]} OK")
        say("2. Dipendenze")
        if (DIR / "package-lock.json").exists():
            try:
                run("npm ci --no-audit --no-fund")
            except RuntimeError:
                say("    npm ci fallito, ripiego su npm install")
                run("npm install --no-audit --no-fund")
        else:
            run("npm install --no-audit --no-fund")
        say("3. Configurazione")
        nota_env = prepara_env()
        say(f"    {nota_env}")
        say("4. Database e interfaccia")
        run("npm run prestart")
        if not args.senza_collegamento:
            say("5. Collegamento sul desktop")
            crea_collegamento()
    except Exception as e:  # noqa: BLE001 - qualsiasi errore va mostrato a chi installa
        say()
        say(f"ERRORE: {e}")
        if sys.stdin and sys.stdin.isatty() and not SENZA_DOMANDE:
            input("Premi Invio per chiudere...")
        return 1

    say()
    say("Logbook è installato.")
    say("  Avvio: icona Logbook sul desktop (o avvia.bat), poi http://127.0.0.1:5210")
    say("  Database nuovo: si entra con utente admin e password Admin2026! (Logbook chiede subito di cambiarla)")
    say(f"  {nota_env}")
    say("  Dentro la suite lo stesso Logbook si apre anche dalla card del Portale.")
    if sys.stdin and sys.stdin.isatty() and not SENZA_DOMANDE:
        input("Premi Invio per chiudere...")
    return 0


if __name__ == "__main__":
    sys.exit(main())
