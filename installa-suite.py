# -*- coding: utf-8 -*-
# "><(((º> sabusabu <º)))><"
"""
Installer interattivo della suite Cosedil.

Compilato in InstallaSuite.exe (PyInstaller --onefile): va tenuto nella
CARTELLA RADICE della suite, accanto alle cartelle delle app. Chiede quali
programmi installare e per ciascuno esegue gli stessi passi degli script
originali (installa.bat / Installa.bat / avvia.bat delle singole app),
senza avviare i server.

Uso:
  InstallaSuite.exe                     menu interattivo
  InstallaSuite.exe --app ddt,ocr       installa solo le app indicate
  InstallaSuite.exe --tutti             installa tutto
  InstallaSuite.exe --dry-run --tutti   mostra i passi senza eseguirli
  InstallaSuite.exe --si                risponde sì alle domande opzionali
"""
import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# Console Windows: accenti corretti sia da cmd che da exe PyInstaller.
if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if os.name == "nt":
    os.system("chcp 65001 >nul")

# ---------------------------------------------------------------------------
# Ambiente
# ---------------------------------------------------------------------------

def root_dir() -> Path:
    # Da exe PyInstaller: la cartella dove sta l'exe. Da sorgente: quella del .py.
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent

ROOT = root_dir()
DRY = False
AUTO_SI = False

def say(msg: str = "") -> None:
    print(msg, flush=True)

def chiedi_si_no(domanda: str, default: bool = False) -> bool:
    if AUTO_SI:
        return True
    if not sys.stdin or not sys.stdin.isatty():
        return default
    r = input(f"{domanda} [s/N] ").strip().lower()
    return r in ("s", "si", "sì", "y", "yes")

def run(cmd: str, cwd: Path | None = None, env: dict | None = None) -> None:
    """Esegue un comando mostrando l'output; solleva RuntimeError se fallisce."""
    say(f"    $ {cmd}")
    if DRY:
        return
    e = dict(os.environ)
    if env:
        e.update(env)
    r = subprocess.run(cmd, cwd=str(cwd) if cwd else None, shell=True, env=e)
    if r.returncode != 0:
        raise RuntimeError(f"comando fallito (exit {r.returncode}): {cmd}")

def output_di(cmd: str, cwd: Path | None = None) -> str:
    try:
        r = subprocess.run(cmd, cwd=str(cwd) if cwd else None, shell=True,
                           capture_output=True, text=True, timeout=30)
        return (r.stdout or "").strip() if r.returncode == 0 else ""
    except Exception:
        return ""

# ---------------------------------------------------------------------------
# Prerequisiti di sistema
# ---------------------------------------------------------------------------

def versione_node() -> str:
    return output_di("node --version")           # es. "v24.15.0", "" se assente

# Minimo comune: "engines" di tutte le app è >=20. L'agente chiede di più (24,
# per node:sqlite senza flag) e lo dichiara da sé in richiedi_node().
NODE_MIN = 20

def node_ok(minimo: int = NODE_MIN) -> bool:
    v = versione_node()
    try:
        return int(v.lstrip("v").split(".")[0]) >= minimo
    except (ValueError, IndexError):
        return False

def python_sistema() -> str:
    """Python di SISTEMA per creare i venv (mai sys.executable: nell'exe è PyInstaller)."""
    for cand in ("py -3", "python"):
        out = output_di(f"{cand} --version")
        if out.startswith("Python 3"):
            minor = int(out.split(".")[1])
            if minor >= 10:
                return cand
    return ""

def ha(cmd: str) -> bool:
    return shutil.which(cmd) is not None

def ha_tesseract() -> bool:
    return ha("tesseract") or Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe").exists()

def gpu_nvidia() -> bool:
    return ha("nvidia-smi") and output_di("nvidia-smi -L").startswith("GPU")

# ---------------------------------------------------------------------------
# Passi riusabili
# ---------------------------------------------------------------------------

def npm_install(d: Path, fallback_legacy: bool = True) -> None:
    # Con il lock si usa npm ci: installa esattamente le versioni collaudate in
    # CI e non riscrive package-lock.json (npm install lo aggiornava in silenzio,
    # e ogni PC dell'ufficio finiva con un albero diverso).
    if (d / "package-lock.json").exists():
        try:
            run("npm ci --no-audit --no-fund", cwd=d)
            return
        except RuntimeError:
            say("    npm ci fallito (lock non allineato a package.json?), ripiego su npm install")
    try:
        run("npm install --no-audit --no-fund", cwd=d)
    except RuntimeError:
        if not fallback_legacy:
            raise
        say("    npm install fallito, riprovo con --legacy-peer-deps (come fa installa.bat)")
        run("npm install --no-audit --no-fund --legacy-peer-deps", cwd=d)

def crea_venv(d: Path, req: str = "requirements.txt", nome: str = ".venv") -> Path:
    py = python_sistema()
    if not py:
        raise RuntimeError("Python 3.10+ non trovato nel PATH (installa da python.org)")
    venv = d / nome
    vpy = venv / "Scripts" / "python.exe"
    if not vpy.exists():
        run(f'{py} -m venv "{nome}"', cwd=d)
    run(f'"{vpy}" -m pip install --upgrade pip', cwd=d)
    if req:
        run(f'"{vpy}" -m pip install -r {req}', cwd=d)
    return vpy

def richiedi_node(app: str, minimo: int = NODE_MIN) -> None:
    if not node_ok(minimo):
        raise RuntimeError(f"{app} richiede Node.js >= {minimo} ({versione_node() or 'assente'}). "
                           "Installa da https://nodejs.org e rilancia.")

# ---------------------------------------------------------------------------
# Installazione per app (stessi passi degli script originali di ogni app)
# ---------------------------------------------------------------------------

def installa_portale(d: Path) -> str:
    richiedi_node("Il portale")
    # Zero dipendenze npm (package.json senza dependencies): serve solo data/.
    if not DRY:
        (d / "data").mkdir(exist_ok=True)
    return "nessuna dipendenza (Node puro). Avvio: avvia.vbs — al primo avvio crea l'admin e ne stampa la password"

def installa_ddt(d: Path) -> str:
    richiedi_node("Lettore DDT")
    npm_install(d)
    if DRY or not (d / "dist" / "server.js").exists():
        run("npm run build", cwd=d)                     # tsc && vite build -> dist/server.js
    if not DRY:
        (d / "versions").mkdir(exist_ok=True)
        (d / "json_exports").mkdir(exist_ok=True)
    if (d / "crea_collegamento.ps1").exists() and chiedi_si_no("  Creo il collegamento sul Desktop per Lettore DDT?"):
        run(f'powershell -NoProfile -ExecutionPolicy Bypass -File "crea_collegamento.ps1" -AppDir "{d}"', cwd=d)
    return "dipendenze + build (dist/server.js). Porta 5050"

def installa_agente(d: Path) -> str:
    richiedi_node("L'agente", 24)                       # engines >=24: node:sqlite
    npm_install(d)
    envf = d / ".env"
    if not envf.exists() and (d / ".env.example").exists() and not DRY:
        shutil.copyfile(d / ".env.example", envf)
        say("    creato .env da .env.example: configura Ollama/Claude/DB prima dell'uso")
    return "dipendenze installate. Porte 5173+3001; usa Ollama (o Claude API) — vedi .env"

def installa_confronta(d: Path) -> str:
    crea_venv(d)                                        # come Installa_librerie.bat
    avviso = "" if ha_tesseract() else " ATTENZIONE: Tesseract OCR non trovato (serve a pytesseract): installalo da https://github.com/UB-Mannheim/tesseract/wiki."
    return f"venv + requirements. Porta 5001.{avviso}"

def installa_ocr(d: Path) -> str:
    richiedi_node("La webapp OCR")
    npm_install(d)
    # venv PaddleOCR: GPU se c'è una NVIDIA, altrimenti CPU (come avvia.bat)
    if gpu_nvidia():
        vpy = crea_venv(d, req="", nome=".venv-gpu")
        run(f'"{vpy}" -m pip install paddlepaddle-gpu==3.3.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/', cwd=d)
        run(f'"{vpy}" -m pip install paddleocr==3.7.0', cwd=d)
    else:
        vpy = crea_venv(d, req="", nome=".venv")
        run(f'"{vpy}" -m pip install paddlepaddle paddleocr', cwd=d)
    run(f'"{vpy}" -c "import paddleocr"', cwd=d)        # verifica come fa avvia.bat
    note = []
    if not ha("ollama"):
        if ha("winget") and chiedi_si_no("  Ollama non trovato: lo installo con winget?"):
            run("winget install -e --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements")
        else:
            note.append("Ollama mancante: installalo (winget install Ollama.Ollama)")
    if ha("ollama") and "qwen2.5:3b" not in output_di("ollama list"):
        if chiedi_si_no("  Scarico il modello qwen2.5:3b (~1.9 GB)?", default=True):
            run("ollama pull qwen2.5:3b")
        else:
            note.append("modello qwen2.5:3b da scaricare (ollama pull qwen2.5:3b)")
    return "npm + venv PaddleOCR. Porte 5179+3007." + (" " + "; ".join(note) if note else "")

def installa_scadenzario(d: Path) -> str:
    crea_venv(d)                                        # come installa.bat
    return "venv + requirements. Porta 5180 (avvia.bat esegue anche database.py)"

def installa_verifica(d: Path) -> str:
    richiedi_node("Verifica Requisiti")
    npm_install(d)
    if DRY or not (d / "dist" / "server.js").exists():
        run("npm run build", cwd=d)                     # tsc -> dist/server.js
    # OCR: senza Tesseract legge solo i PDF con testo selezionabile; per i PDF
    # scansionati serve anche pdftoppm (poppler), che li trasforma in immagini.
    note = []
    if not ha_tesseract():
        note.append("Tesseract OCR assente: i documenti scansionati non verranno letti"
                    " (https://github.com/UB-Mannheim/tesseract/wiki)")
    if not ha("pdftoppm"):
        note.append("pdftoppm (poppler) non nel PATH: serve all'OCR dei PDF scansionati")
    avviso = (" ATTENZIONE: " + "; ".join(note)) if note else ""
    return f"dipendenze + build (dist/server.js). Porta 5185.{avviso}"

def installa_auguri(d: Path) -> str:
    richiedi_node("Auguri")
    npm_install(d)                                      # whatsapp-web.js scarica Chromium: minuti
    if (d / "installa-avvio-automatico.ps1").exists() and chiedi_si_no(
            "  Installo l'avvio automatico giornaliero (Scheduled Task 09:30, chiede admin)?"):
        run('powershell -NoProfile -ExecutionPolicy Bypass -File "installa-avvio-automatico.ps1"', cwd=d)
    return "dipendenze installate (Chromium incluso). Porta 3000; primo avvio: scansione QR WhatsApp"

def installa_trimble(d: Path) -> str:
    richiedi_node("Ponte Trimble")
    npm_install(d)
    envf = d / ".env"
    if not envf.exists() and (d / ".env.example").exists() and not DRY:
        shutil.copyfile(d / ".env.example", envf)       # come avvia.bat
        say("    creato .env da .env.example: le credenziali Trimble vanno compilate a mano")
    return "dipendenze installate. Porta 3011; credenziali Trimble nel .env"

def installa_credenziali(d: Path) -> str:
    bat = ROOT / "installa-credenziali.bat"
    if not bat.exists():
        raise RuntimeError("installa-credenziali.bat non trovato nella radice della suite")
    run(f'"{bat}"', cwd=ROOT)
    return "account admin installato negli store di portale, agente e DDT"

APPS = [
    # (id, nome a menu, cartella, funzione)
    ("portale",     "Portale - accesso e avvio della suite (porta 8080)",        "portale",             installa_portale),
    ("ddt",         "Lettore DDT - da PDF a Excel (porta 5050)",                 "lettore-ddt",         installa_ddt),
    ("agente",      "Analista Dati - domande sui dati con AI (porte 5173+3001)", "analista-dati",       installa_agente),
    ("confronta",   "Confronto Documenti (porta 5001)",                          "confronto-documenti", installa_confronta),
    ("ocr",         "OCR Documenti (porte 5179+3007)",                           "ocr-documenti",       installa_ocr),
    ("scadenzario", "Scadenzario - scadenze e adempimenti (porta 5180)",         "scadenzario",         installa_scadenzario),
    ("requisiti",   "Verifica Requisiti - ricerca e checklist (porta 5185)",     "verifica-requisiti",  installa_verifica),
    ("auguri",      "Auguri - compleanni su WhatsApp (porta 3000)",              "auguri",              installa_auguri),
    ("trimble",     "Ponte Trimble - PDF verso Trimble (porta 3011)",            "ponte-trimble",       installa_trimble),
    ("credenziali", "Credenziali admin (account unico in tutta la suite)",       ".",                   installa_credenziali),
]

# ---------------------------------------------------------------------------
# Menu e orchestrazione
# ---------------------------------------------------------------------------

def stampa_prerequisiti() -> None:
    v = versione_node()
    say(f"  Node.js:   {v + (' OK' if node_ok() else f' TROPPO VECCHIO (serve >={NODE_MIN}, agente >=24)') if v else 'ASSENTE (serve per portale/ddt/agente/ocr/requisiti/auguri/trimble)'}")
    py = python_sistema()
    say(f"  Python:    {output_di(py + ' --version') + ' OK' if py else 'ASSENTE 3.10+ (serve per confronta/scadenzario/ocr)'}")
    say(f"  Ollama:    {'OK' if ha('ollama') else 'assente (serve a ocr; usato da agente)'}")
    say(f"  Tesseract: {'OK' if ha_tesseract() else 'assente (serve a confronta e requisiti)'}")

def menu() -> list[str]:
    say()
    say("=" * 62)
    say("  Installazione Suite Cosedil")
    say("=" * 62)
    stampa_prerequisiti()
    say()
    for i, (_, nome, _, _) in enumerate(APPS, 1):
        say(f"   {i}. {nome}")
    say(f"   {len(APPS) + 1}. TUTTI i programmi")
    say("   0. Esci")
    say()
    while True:
        scelta = input("Cosa installo? (numeri separati da virgola, es. 1,4,6): ").strip()
        if scelta == "0":
            return []
        try:
            nums = sorted({int(x) for x in scelta.replace(" ", "").split(",") if x})
        except ValueError:
            say("Scelta non valida, riprova.")
            continue
        if len(APPS) + 1 in nums:
            return [a[0] for a in APPS]
        if nums and all(1 <= n <= len(APPS) for n in nums):
            return [APPS[n - 1][0] for n in nums]
        say("Scelta non valida, riprova.")

def main() -> int:
    global DRY, AUTO_SI
    ap = argparse.ArgumentParser(description="Installer della suite Cosedil")
    ap.add_argument("--app", help="id o cartelle separati da virgola: " + ",".join(a[0] for a in APPS))
    ap.add_argument("--tutti", action="store_true", help="installa tutti i programmi")
    ap.add_argument("--dry-run", action="store_true", help="mostra i passi senza eseguirli")
    ap.add_argument("--si", action="store_true", help="rispondi sì alle domande opzionali")
    args = ap.parse_args()
    DRY, AUTO_SI = args.dry_run, args.si

    ids = [a[0] for a in APPS]
    if args.tutti:
        scelte = ids
    elif args.app:
        # Vale sia l'id storico (ddt, agente...) sia il nome della cartella
        # (lettore-ddt, analista-dati...), che e' anche l'indirizzo sul server.
        per_cartella = {c: i for i, _, c, _ in APPS if c != "."}
        scelte = [per_cartella.get(x.strip(), x.strip()) for x in args.app.split(",") if x.strip()]
        sconosciute = [x for x in scelte if x not in ids]
        if sconosciute:
            say(f"App sconosciute: {', '.join(sconosciute)}. Valide: {', '.join(ids)}")
            return 1
    else:
        scelte = menu()
        if not scelte:
            return 0

    # ordine consigliato = ordine del registro APPS (credenziali per ultime)
    scelte = [i for i in ids if i in scelte]
    esiti: list[tuple[str, bool, str]] = []
    for app_id, nome, cartella, fn in APPS:
        if app_id not in scelte:
            continue
        d = (ROOT / cartella).resolve()
        say()
        say(f">>> {nome}")
        if not d.exists():
            esiti.append((app_id, False, f"cartella non trovata: {d}"))
            say(f"    ERRORE: cartella non trovata: {d}")
            continue
        try:
            esiti.append((app_id, True, fn(d)))
        except RuntimeError as e:
            esiti.append((app_id, False, str(e)))
            say(f"    ERRORE: {e}")

    say()
    say("=" * 62)
    say("  Riepilogo" + (" (DRY RUN: nessun comando eseguito)" if DRY else ""))
    say("=" * 62)
    for app_id, ok, msg in esiti:
        say(f"  [{'OK ' if ok else 'ERR'}] {app_id}: {msg}")
    falliti = sum(1 for _, ok, _ in esiti if not ok)
    say()
    say("Completato senza errori." if not falliti else f"Completato con {falliti} errore/i.")
    if not AUTO_SI and sys.stdin and sys.stdin.isatty():
        input("Premi INVIO per chiudere...")
    return 1 if falliti else 0

if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        say("\nInterrotto.")
        sys.exit(130)
