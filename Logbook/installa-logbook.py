# -*- coding: utf-8 -*-
# "><(((º> sabusabu <º)))><"
"""
Installatore di Copilota da solo, FUORI dalla suite Cosedil (25/11/2026, risposta 4b:
"il programma deve poter funzionare fuori dalla suite e quindi si deve poter avviare sia
dentro che fuori").

Compilato in InstallaLogbook.exe (PyInstaller --onefile, vedi in fondo) e tenuto nella
cartella di Copilota, accanto ad avvia.bat. Su un PC qualsiasi basta copiare la cartella
Logbook (senza node_modules e data) e fare doppio clic su InstallaLogbook.exe. Serve solo
Node.js 20.19 o successivo: l'installatore NON lo installa (sarebbe software di sistema),
dice dove scaricarlo.

Passi:
1. controlla Node.js;
2. installa le dipendenze (npm ci con il lock, altrimenti npm install). Il postinstall
   genera anche il client del database (prisma generate);
3. chiede nome utente e password del primo amministratore, che è il proprietario di Copilota
   (solo lui potrà nominare altri amministratori). Le passa soltanto al comando che prepara
   il database: non finiscono nel .env né in nessun file. Poi, se manca, crea il file .env
   da .env.example e chiede, facoltativi:
   - l'email del proprietario, che riceve il codice per "Cancella tutti i dati";
   - se Copilota va raggiunto dagli altri PC e dai telefoni della rete dell'ufficio
     (LOGBOOK_API_HOST=0.0.0.0).
   Il server di posta (LOGBOOK_SMTP_*) si completa dopo, a mano, nel .env;
4. prepara il database e compila l'interfaccia (come il primo avvio: npm run prestart).
   Il database nuovo è vuoto, con l'utente admin e le festività nazionali;
5. crea sul desktop l'icona "Copilota", che lancia apri-copilota.vbs: avvia Copilota senza
   finestra del terminale e lo apre in una finestra propria, come un programma tradizionale;
6. rete (dal 27/11/2026), solo se al passo 3 si è scelto di aprirlo alla rete, o se il .env
   che c'era già lo apre:
   - regola del firewall di Windows "Copilota 5210 (rete locale)": porta di Copilota in
     entrata, SOLO dalla stessa sottorete. Windows chiede il consenso da amministratore;
   - mostra l'indirizzo da dare ai colleghi (http://<indirizzo del PC>:5210);
   - a richiesta installa "cloudflared" (winget), che serve a tunnel-prova.bat per provare
     Copilota dal telefono fuori dall'ufficio su un indirizzo https temporaneo.
   Non imposta l'avvio automatico all'accensione: Copilota parte dall'icona o dal Portale.

Dentro la suite non serve: lo installa InstallaSuite.exe (installa-suite.py, voce "logbook")
e lo avvia la card del Portale. Le due strade usano la stessa cartella e lo stesso avvia.bat.

Uso:
  InstallaLogbook.exe                       con domande
  InstallaLogbook.exe --si                  senza domande: admin con password casuale mostrata a video
                                            (o LOGBOOK_ADMIN_USERNAME / LOGBOOK_ADMIN_PASSWORD nell'ambiente)
  InstallaLogbook.exe --senza-collegamento  non crea l'icona sul desktop
  InstallaLogbook.exe --rete                apre Copilota alla rete dell'ufficio senza chiederlo
                                            (su un .env già presente aggiunge solo LOGBOOK_API_HOST)
  InstallaLogbook.exe --tunnel              installa anche cloudflared per tunnel-prova.bat
  InstallaLogbook.exe --dry-run             mostra i passi senza eseguirli

Compilazione (dalla cartella Logbook, con PyInstaller in un ambiente Python qualsiasi):
  python -m PyInstaller --onefile --name InstallaLogbook --distpath . installa-logbook.py
"""
import argparse
import base64
import os
import re
import shutil
import socket
import subprocess
import sys
from pathlib import Path

# Console Windows: accenti corretti sia da cmd sia dall'exe.
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if os.name == "nt":
    os.system("chcp 65001 >nul")

NODE_MIN = (20, 19)  # Prisma 7: "engines" di package.json
# Nome della regola del firewall: lo stesso scritto in PROGRESS.md e nel README, così chi la
# cerca in "Windows Defender Firewall" la riconosce e la può togliere.
REGOLA_FIREWALL = "Copilota 5210 (rete locale)"
SI = ("s", "si", "sì", "y", "yes")


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


def run(cmd: str, env: dict | None = None) -> None:
    """Esegue un comando nella cartella di Copilota mostrando l'output; errore se fallisce.
    `env`: variabili in più solo per questo comando (le credenziali del primo amministratore)."""
    say(f"    $ {cmd}")
    if DRY:
        return
    r = subprocess.run(cmd, cwd=str(DIR), shell=True, env={**os.environ, **env} if env else None)
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


def SENZA_DOMANDE_CREDENZIALI() -> bool:
    return SENZA_DOMANDE


def chiedi_credenziali_admin() -> tuple[str, str] | None:
    """Nome utente e password del primo amministratore di Copilota, che ne è il proprietario
    (Giorno 34, 25/11/2026: "durante l'installazione venga creato il primo admin con le
    credenziali inserite e poi solo lui possa dare quel ruolo").

    Si chiedono a chi installa (la password non compare mentre la si scrive, e va ripetuta).
    Stesse regole di Copilota per un amministratore: almeno 12 caratteri, lettere e numeri.
    Senza terminale o con le domande spente restituisce None: allora Copilota crea "admin"
    con una password casuale, mostrata una volta sola e da cambiare al primo accesso. Per
    un'installazione senza domande si possono passare LOGBOOK_ADMIN_USERNAME e
    LOGBOOK_ADMIN_PASSWORD come variabili d'ambiente.
    """
    da_ambiente = (os.environ.get("LOGBOOK_ADMIN_USERNAME", "").strip().lower(), os.environ.get("LOGBOOK_ADMIN_PASSWORD", ""))
    if da_ambiente[1]:
        return (da_ambiente[0] or "admin", da_ambiente[1])
    if SENZA_DOMANDE_CREDENZIALI() or not sys.stdin or not sys.stdin.isatty():
        return None
    import getpass
    say("    Primo amministratore di Copilota (sarai il proprietario: solo tu potrai nominarne altri).")
    while True:
        try:
            nome = input("    Nome utente [admin]: ").strip().lower() or "admin"
        except EOFError:
            return None
        if re.fullmatch(r"[a-z0-9._-]{3,40}", nome):
            break
        say("    Da 3 a 40 caratteri: lettere minuscole, numeri, punto, trattino.")
    while True:
        try:
            p1 = getpass.getpass("    Password (almeno 12 caratteri, lettere e numeri): ")
            p2 = getpass.getpass("    Ripeti la password: ")
        except EOFError:
            return None
        if p1 != p2:
            say("    Le due password sono diverse, riprova.")
        elif len(p1) < 12 or not re.search(r"[A-Za-z]", p1) or not re.search(r"\d", p1):
            say("    Troppo debole: almeno 12 caratteri, con lettere e numeri.")
        else:
            return (nome, p1)

def prepara_env(proprietario: str = "admin", rete: bool = False) -> str:
    """Crea .env da .env.example (se manca) con le scelte dell'utente. Restituisce una nota.

    `rete` (opzione --rete): apre Copilota alla rete senza chiederlo. È l'unica cosa che si
    scrive anche in un .env già presente, e solo aggiungendo LOGBOOK_API_HOST: il resto del
    file è di chi l'ha compilato e non si tocca.
    """
    env = DIR / ".env"
    if env.exists():
        if rete and not rete_aperta():
            say(f"    aggiungo LOGBOOK_API_HOST=0.0.0.0 a {env.name}")
            if not DRY:
                env.write_text(imposta_env(env.read_text(encoding="utf-8"), "LOGBOOK_API_HOST", "0.0.0.0"), encoding="utf-8")
            return ".env già presente: aggiunta solo l'apertura alla rete (LOGBOOK_API_HOST)"
        return ".env già presente: lasciato com'è"
    esempio = DIR / ".env.example"
    testo = esempio.read_text(encoding="utf-8") if esempio.exists() else ""
    # Il proprietario è l'amministratore creato al primo avvio.
    testo = imposta_env(testo, "LOGBOOK_PROPRIETARIO", proprietario)
    email = chiedi("Email del proprietario (riceve il codice per cancellare tutti i dati), invio per saltare:")
    if email:
        testo = imposta_env(testo, "LOGBOOK_PROPRIETARIO_EMAIL", email)
    if not rete:
        rete = chiedi("Copilota deve essere raggiungibile dagli altri PC e dai telefoni della rete dell'ufficio? [s/N]").lower() in SI
    if rete:
        # LOGBOOK_API_HOST e non HOST: il Portale della suite passa HOST=127.0.0.1 alle app che
        # avvia, e una variabile già presente vince sul .env (server/index.ts legge prima
        # LOGBOOK_API_HOST). Così l'apertura vale sia dall'icona sia dalla card del Portale.
        testo = imposta_env(testo, "LOGBOOK_API_HOST", "0.0.0.0")
    say(f"    creo {env.name}" + (f" (proprietario {proprietario}, email {email})" if email else f" (proprietario {proprietario})"))
    if not DRY:
        env.write_text(testo, encoding="utf-8")
    note = "creato .env"
    if not email:
        note += ": scrivere LOGBOOK_PROPRIETARIO_EMAIL"
    return note + " e completare LOGBOOK_SMTP_* (server di posta) per il codice via email"


def rete_aperta() -> bool:
    """True se il .env fa ascoltare Copilota su tutta la rete (LOGBOOK_API_HOST o HOST = 0.0.0.0).
    Si legge il file e non la risposta data al passo 3, così vale anche per un .env che c'era già."""
    try:
        testo = (DIR / ".env").read_text(encoding="utf-8")
    except OSError:
        return False
    return bool(re.search(r"^\s*(LOGBOOK_API_HOST|HOST)\s*=\s*0\.0\.0\.0\s*$", testo, re.MULTILINE))


def porta_copilota() -> int:
    """Porta di Copilota: LOGBOOK_PORT dal .env, altrimenti 5210 (come server/index.ts)."""
    try:
        m = re.search(r"^\s*LOGBOOK_PORT\s*=\s*(\d+)\s*$", (DIR / ".env").read_text(encoding="utf-8"), re.MULTILINE)
    except OSError:
        m = None
    return int(m.group(1)) if m else 5210


def indirizzo_di_rete() -> str | None:
    """Indirizzo IPv4 di questo PC sulla rete locale, quello da dare ai colleghi.
    Il "connect" su UDP non spedisce nulla: serve solo a farsi dire da Windows quale scheda
    userebbe per uscire. None se il PC non è in rete."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("192.0.2.1", 9))  # indirizzo di documentazione (RFC 5737), mai raggiunto
            ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None


def powershell(script: str) -> subprocess.CompletedProcess:
    """Esegue uno script PowerShell senza passare da cmd (niente problemi di virgolette)."""
    return subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], capture_output=True, text=True, timeout=300)


def apri_firewall(porta: int) -> str:
    """Crea la regola del firewall di Windows che lascia entrare gli altri dispositivi sulla
    porta di Copilota. Restituisce una nota per il riepilogo finale; non solleva mai: senza
    regola Copilota funziona lo stesso su questo PC, e la si può creare dopo a mano.

    - Solo TCP sulla porta di Copilota e solo dalla stessa sottorete (RemoteAddress
      LocalSubnet): chi sta su un'altra rete non passa nemmeno se il router lo inoltrasse.
    - Tutti i profili (Any): in molti uffici Windows classifica la rete come "Pubblica", e una
      regola limitata a "Privata" non avrebbe effetto.
    - Serve il consenso da amministratore: la regola si crea in un PowerShell elevato
      (finestra "Vuoi consentire…?"). Il comando viaggia in -EncodedCommand (base64 UTF-16)
      per non dover annidare virgolette dentro virgolette.
    - Se la regola c'è già non si chiede nulla.
    """
    if os.name != "nt":
        return "firewall: non è Windows, niente da fare"
    say(f'    regola del firewall "{REGOLA_FIREWALL}" (porta {porta}, solo dalla stessa rete)')
    if DRY:
        return "firewall: prova a vuoto, regola non creata"
    regola_presente = f"if (Get-NetFirewallRule -DisplayName '{REGOLA_FIREWALL}' -ErrorAction SilentlyContinue) {{ 'SI' }} else {{ 'NO' }}"
    try:
        if "SI" in powershell(regola_presente).stdout:
            return "firewall: la regola c'era già"
        crea = (
            f"New-NetFirewallRule -DisplayName '{REGOLA_FIREWALL}' "
            "-Description 'Copilota (ore e presenze): accesso dagli altri PC e telefoni della stessa rete. Creata da InstallaLogbook.' "
            f"-Direction Inbound -Action Allow -Protocol TCP -LocalPort {porta} -RemoteAddress LocalSubnet -Profile Any"
        )
        codificato = base64.b64encode(crea.encode("utf-16-le")).decode("ascii")
        say("    Windows chiede il consenso da amministratore: rispondere Sì.")
        powershell(f"Start-Process powershell -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList '-NoProfile','-EncodedCommand','{codificato}'")
        if "SI" in powershell(regola_presente).stdout:
            return "firewall: regola creata"
    except Exception as e:  # noqa: BLE001 - PowerShell assente, consenso negato, tempo scaduto
        say(f"    firewall: {e}")
    return (
        f"firewall: regola NON creata (consenso negato?). Gli altri dispositivi non arrivano a Copilota finché non si apre "
        f"la porta {porta} TCP in entrata, o si rilancia l'installatore"
    )


def installa_cloudflared() -> str:
    """Installa cloudflared (Cloudflare Tunnel) con winget, se manca. Lo usa tunnel-prova.bat
    per dare a Copilota un indirizzo https temporaneo raggiungibile da fuori ufficio. Qui si
    installa soltanto: il tunnel lo apre chi usa il PC, quando serve, e si chiude con la finestra.
    Restituisce una nota per il riepilogo; non solleva mai."""
    predefinito = Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "cloudflared" / "cloudflared.exe"
    if shutil.which("cloudflared") or predefinito.exists():
        return "tunnel di prova: cloudflared c'era già, si apre con tunnel-prova.bat"
    if not shutil.which("winget"):
        return "tunnel di prova: winget non trovato, installare cloudflared a mano dal sito di Cloudflare"
    try:
        run("winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements --disable-interactivity")
    except RuntimeError as e:
        return f"tunnel di prova: cloudflared non installato ({e})"
    return "tunnel di prova: cloudflared installato, si apre con tunnel-prova.bat"


def crea_collegamento() -> None:
    """Icona "Copilota" sul desktop dell'utente (niente diritti di amministratore).

    Dal 27/11/2026 punta ad apri-copilota.vbs, lanciato con wscript.exe: avvia Copilota senza
    finestra del terminale se è spento e lo apre in una finestra propria (Edge o Chrome in
    modalità "app"), come un programma tradizionale. Chi lo usa non vede porte né indirizzi.
    Se apri-copilota.vbs manca (cartella copiata da una versione vecchia) ripiega su avvia.bat.
    """
    vbs = DIR / "apri-copilota.vbs"
    bat = DIR / "avvia.bat"
    icona = DIR / "public" / "favicon.ico"
    if vbs.exists():
        bersaglio = f"$l.TargetPath=(Join-Path $env:WINDIR 'System32\\wscript.exe');$l.Arguments='\\\"{vbs}\\\"';"
    else:
        bersaglio = f"$l.TargetPath='{bat}';"
    ps = (
        "$s=(New-Object -ComObject WScript.Shell);"
        "$d=[Environment]::GetFolderPath('Desktop');"
        "$l=$s.CreateShortcut((Join-Path $d 'Copilota.lnk'));"
        f"{bersaglio}$l.WorkingDirectory='{DIR}';"
        "$l.Description='Copilota - ore e presenze';"
        + (f"$l.IconLocation='{icona}';" if icona.exists() else "")
        + "$l.Save()"
    )
    run(f'powershell -NoProfile -ExecutionPolicy Bypass -Command "{ps}"')


def main() -> int:
    global DRY, SENZA_DOMANDE
    ap = argparse.ArgumentParser(description="Installatore di Copilota fuori dalla suite")
    ap.add_argument("--si", action="store_true", help="nessuna domanda")
    ap.add_argument("--senza-collegamento", action="store_true", help="non crea l'icona sul desktop")
    ap.add_argument("--rete", action="store_true", help="apre Copilota alla rete dell'ufficio (firewall compreso) senza chiederlo")
    ap.add_argument("--tunnel", action="store_true", help="installa cloudflared per provare Copilota da fuori ufficio (tunnel-prova.bat)")
    ap.add_argument("--dry-run", action="store_true", help="mostra i passi senza eseguirli")
    args = ap.parse_args()
    DRY, SENZA_DOMANDE = args.dry_run, args.si

    say("=" * 62)
    say("  Installazione di Copilota (ore e presenze)")
    say(f"  Cartella: {DIR}")
    say("=" * 62)
    try:
        if not (DIR / "package.json").exists():
            raise RuntimeError("package.json non trovato: InstallaLogbook.exe va tenuto nella cartella di Copilota")
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
        # Le credenziali servono solo se il database non esiste ancora (prima installazione).
        nuovo = not (DIR / "data" / "logbook.db").exists()
        credenziali = chiedi_credenziali_admin() if nuovo else None
        nota_env = prepara_env(credenziali[0] if credenziali else "admin", rete=args.rete)
        say(f"    {nota_env}")
        say("4. Database e interfaccia")
        run("npm run prestart", env={"LOGBOOK_ADMIN_USERNAME": credenziali[0], "LOGBOOK_ADMIN_PASSWORD": credenziali[1], "LOGBOOK_ADMIN_DEFINITIVA": "1"} if credenziali else None)
        if not args.senza_collegamento:
            say("5. Collegamento sul desktop")
            crea_collegamento()
        # Passo 6: solo se Copilota ascolta sulla rete (scelta appena fatta, --rete, o .env di prima).
        # In prova a vuoto il .env non viene scritto: vale l'opzione.
        porta = porta_copilota()
        in_rete = rete_aperta() or (DRY and args.rete)
        note_rete: list[str] = []
        if in_rete:
            say("6. Rete dell'ufficio")
            note_rete.append(apri_firewall(porta))
            if args.tunnel or chiedi("Vuoi poter provare Copilota anche da fuori ufficio, dal telefono (tunnel temporaneo)? [s/N]").lower() in SI:
                note_rete.append(installa_cloudflared())
        elif args.tunnel:
            say("6. Tunnel di prova")
            note_rete.append(installa_cloudflared())
    except Exception as e:  # noqa: BLE001 - qualsiasi errore va mostrato a chi installa
        say()
        say(f"ERRORE: {e}")
        if sys.stdin and sys.stdin.isatty() and not SENZA_DOMANDE:
            input("Premi Invio per chiudere...")
        return 1

    say()
    say("Copilota è installato.")
    say("  Avvio: icona Copilota sul desktop. Si apre da sola in una finestra propria, senza indirizzi da scrivere.")
    say(f"  (In alternativa avvia.bat, poi http://127.0.0.1:{porta} nel browser.)")
    if credenziali:
        say(f"  Si entra con l'utente {credenziali[0]} e la password appena scelta: è il proprietario di Copilota.")
    elif nuovo:
        say("  Si entra con l'utente admin e la password provvisoria scritta qui sopra (riga ATTENZIONE): annotarla ora.")
    say(f"  {nota_env}")
    if in_rete:
        ip = indirizzo_di_rete()
        say()
        say("  Dagli altri PC e dai telefoni collegati alla rete dell'ufficio:")
        say(f"    http://{ip}:{porta}" if ip else f"    http://<indirizzo di questo PC>:{porta} (il PC ora non risulta in rete)")
        say("    L'indirizzo lo dà il router e può cambiare: conviene farlo fissare da chi gestisce la rete.")
        say("    Senza HTTPS la password viaggia in chiaro sulla rete interna e il telefono non propone")
        say("    l'installazione sulla schermata: per quello serve un indirizzo https (accesso-da-internet.md).")
        say("    Questo PC deve restare acceso e con Copilota avviato: non parte da solo all'accensione.")
        say("    Per tornare al solo PC: togliere LOGBOOK_API_HOST dal .env, riavviare Copilota e cancellare")
        say(f'    la regola "{REGOLA_FIREWALL}" dal firewall di Windows.')
    for nota in note_rete:
        say(f"  {nota}")
    if any("tunnel-prova.bat" in n for n in note_rete):
        say("    tunnel-prova.bat: doppio clic con Copilota avviato; l'indirizzo https://….trycloudflare.com compare")
        say("    nella finestra, cambia a ogni avvio e si spegne chiudendola. È per provare, non per i dipendenti.")
        say("    Prima di aprirlo controllare che non ci siano account di esempio attivi (Impostazioni → Dati del programma).")
    say("  Dentro la suite lo stesso Copilota si apre anche dalla card del Portale.")
    if sys.stdin and sys.stdin.isatty() and not SENZA_DOMANDE:
        input("Premi Invio per chiudere...")
    return 0


if __name__ == "__main__":
    sys.exit(main())
