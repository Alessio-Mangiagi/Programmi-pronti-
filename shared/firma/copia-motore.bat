@echo off
REM "><(((º> sabusabu <º)))><"
REM Copia il motore della firma digitale (shared\firma) in un'altra cartella, per i programmi impacchettati in un
REM .exe (Lettore DDT con pkg, Confronto Documenti con PyInstaller): il client della firma cerca il motore anche
REM in <cartella dell'exe>\shared\firma, perche' dentro l'eseguibile Python non puo' leggere firma.py ne' creare
REM il .venv. Si copiano solo i sorgenti: .venv non si sposta (contiene percorsi assoluti) e si crea sul PC di
REM destinazione con installa.bat (lo lancia da solo il programma alla prima busta .p7m, o l'installatore).
REM Restano fuori anche la cache degli elenchi, i lock, __pycache__ e i test.
REM Uso:   copia-motore.bat CARTELLA_DESTINAZIONE        (es. installer-pkg\build\shared\firma)
REM Uscita 0 = copiato, 1 = errore.
setlocal
if "%~1"=="" (
    echo Uso: copia-motore.bat CARTELLA_DESTINAZIONE
    exit /b 1
)
REM robocopy: uscita da 0 a 7 = riuscito (1 = file copiati), da 8 in su = errore
robocopy "%~dp0." "%~1" /E /NFL /NDL /NJH /NJS /NP /XD .venv cache __pycache__ .installazione.lock node_modules /XF test_firma.py firma.test.js *.pyc >nul
if errorlevel 8 (
    echo Copia del motore della firma in "%~1" non riuscita.
    exit /b 1
)
exit /b 0
