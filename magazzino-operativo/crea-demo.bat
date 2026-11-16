@echo off
REM "><(((º> sabusabu <º)))><"
REM Carica i dati di esempio del Magazzino Operativo (crea_demo.py): deposito, officina e tre cantieri
REM con le commesse della demo della suite (101-003, C-2024-015, 102-011), 26 articoli, 12 mezzi,
REM sei settimane di movimenti, registro attività e storico importazioni. Tutto inventato.
REM
REM   crea-demo.bat            carica in un database vuoto (se ci sono già dati si ferma)
REM   crea-demo.bat --azzera   svuota il database e ricarica la demo (cancella TUTTO)
REM   crea-demo.bat --conta    dice solo quante righe ci sono
REM
REM Usa lo stesso database dell'app (magazzino.db o MAGAZZINO_DB). Meglio con l'app spenta.
setlocal
chcp 65001 >nul
title Magazzino Operativo - demo
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" (
    echo ERRORE: ambiente virtuale .venv non trovato. Lanciare prima installa.bat.
    pause
    exit /b 1
)
cd /d "%~dp0"
set "PYTHONIOENCODING=utf-8"
"%PY%" crea_demo.py %*
set "EC=%ERRORLEVEL%"
echo.
if "%EC%"=="0" (
    echo Demo pronta. Apri il Magazzino dal portale: tessera "DDT e Magazzino", commessa 101-003 o C-2024-015.
) else (
    echo La demo NON e' stata caricata: leggere il messaggio qui sopra.
)
pause
exit /b %EC%
