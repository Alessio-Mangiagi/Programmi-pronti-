# -*- coding: utf-8 -*-
# "><(((º> sabusabu <º)))><"
"""
Prepara la cartella da consegnare per installare Copilota su un altro PC (27/11/2026).

Risultato, nella cartella indicata (default: Documenti\\Copilota - distribuzione):

    AVVIO.md            istruzioni per chi installa (copia di Logbook/AVVIO.md)
    Copilota\\           il programma: i file del repository + InstallaLogbook.exe
    Copilota.zip        la stessa cartella Copilota più AVVIO.md, da mandare in un pezzo solo

Come lavora:
- i file del programma vengono da `git archive HEAD`, cioè dall'ultimo commit: niente
  node_modules, niente database, niente .env con le password, niente modifiche non salvate.
  Per questo prima di lanciarlo va fatto il commit di quello che si vuole consegnare;
- restano fuori le cose che servono solo a chi sviluppa (ESCLUSI qui sotto);
- InstallaLogbook.exe non sta nel repository: lo prende dalla cartella Logbook e si ferma se
  manca o se è più vecchio di installa-logbook.py (andrebbe ricompilato, comando in testa a
  quel file).

Uso, dalla cartella Logbook:
    python scripts/crea-distribuzione.py [cartella di destinazione]

La cartella di destinazione viene svuotata e ricreata a ogni lancio: non tenerci altro.
"""
import io
import shutil
import subprocess
import sys
import tarfile
import zipfile
from pathlib import Path

LOGBOOK = Path(__file__).resolve().parent.parent
REPO = LOGBOOK.parent
# Percorsi dentro Logbook/ che non servono per installare e usare il programma.
ESCLUSI = [
    "PROGRESS.md",          # diario di sviluppo
    "server/__tests__",     # test automatici
    "scripts/carico",       # test di carico
    "scripts/crea-distribuzione.py",
    "docs/vercel.md",       # pubblicazione su Vercel
    "docs/test-di-carico.md",
    "vercel.json",
    "vitest.config.ts",
]


def main() -> int:
    destinazione = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.home() / "Documents" / "Copilota - distribuzione"
    exe = LOGBOOK / "InstallaLogbook.exe"
    sorgente_exe = LOGBOOK / "installa-logbook.py"
    if not exe.exists():
        print("ERRORE: manca InstallaLogbook.exe nella cartella Logbook: va compilato (vedi installa-logbook.py).")
        return 1
    if exe.stat().st_mtime < sorgente_exe.stat().st_mtime:
        print("ERRORE: InstallaLogbook.exe è più vecchio di installa-logbook.py: va ricompilato prima di consegnarlo.")
        return 1
    # La destinazione non deve stare dentro il repository: finirebbe fra i file da salvare.
    if REPO in destinazione.parents or destinazione == REPO:
        print("ERRORE: la cartella di destinazione deve stare fuori dal repository.")
        return 1

    commit = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True).stdout.strip()
    sporco = subprocess.run(["git", "-C", str(REPO), "status", "--porcelain", "--", "Logbook"], capture_output=True, text=True, check=True).stdout.strip()
    if sporco:
        print("ATTENZIONE: in Logbook ci sono modifiche non salvate in un commit, che NON finiscono nella distribuzione:")
        print(sporco)

    if destinazione.exists():
        shutil.rmtree(destinazione)
    programma = destinazione / "Copilota"
    programma.mkdir(parents=True)

    # git archive scrive un tar con i percorsi "Logbook/…": si estrae togliendo quel primo pezzo.
    argomenti = ["git", "-C", str(REPO), "archive", "--format=tar", "HEAD", "--", "Logbook"] + [f":(exclude)Logbook/{e}" for e in ESCLUSI]
    tar = subprocess.run(argomenti, capture_output=True, check=True).stdout
    quanti = 0
    with tarfile.open(fileobj=io.BytesIO(tar)) as archivio:
        for membro in archivio.getmembers():
            if not membro.isfile():
                continue
            relativo = Path(*Path(membro.name).parts[1:])
            arrivo = programma / relativo
            arrivo.parent.mkdir(parents=True, exist_ok=True)
            arrivo.write_bytes(archivio.extractfile(membro).read())
            quanti += 1
    shutil.copy2(exe, programma / exe.name)
    shutil.copy2(LOGBOOK / "AVVIO.md", destinazione / "AVVIO.md")
    # Da quale versione viene: utile quando qualcuno chiede "che versione ho installato?".
    (programma / "VERSIONE.txt").write_text(f"Copilota, distribuzione preparata dal commit {commit}\n", encoding="utf-8")

    zip_file = destinazione / "Copilota.zip"
    with zipfile.ZipFile(zip_file, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(destinazione / "AVVIO.md", "AVVIO.md")
        for f in sorted(programma.rglob("*")):
            if f.is_file():
                z.write(f, Path("Copilota") / f.relative_to(programma))

    print(f"Distribuzione pronta in: {destinazione}")
    print(f"  commit {commit}, {quanti} file del programma + InstallaLogbook.exe")
    print(f"  Copilota.zip: {zip_file.stat().st_size / 1048576:.1f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
