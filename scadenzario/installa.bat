@echo off
title Scadenzario - Installazione
cd /d "%~dp0"

echo ============================================
echo  Scadenzario - Installazione
echo ============================================
echo.

REM Crea l'ambiente virtuale se non esiste
if exist ".venv\Scripts\python.exe" (
    echo Ambiente virtuale .venv gia' presente, salto la creazione.
    goto :deps
)

echo Creazione ambiente virtuale .venv ...
py -3 -m venv .venv 2>nul
if exist ".venv\Scripts\python.exe" goto :deps

echo Comando 'py -3' non disponibile, provo con 'python' ...
python -m venv .venv
if exist ".venv\Scripts\python.exe" goto :deps

echo.
echo ERRORE: impossibile creare l'ambiente virtuale.
echo Verificare che Python 3.10 o superiore sia installato e nel PATH.
echo.
pause
exit /b 1

:deps
echo.
echo Installazione dipendenze da requirements.txt ...
".venv\Scripts\python.exe" -m pip install --upgrade pip
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
    echo.
    echo ERRORE: installazione dipendenze fallita.
    echo Controllare la connessione internet e riprovare.
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Installazione completata con successo.
echo  Per avviare l'applicazione: avvia.bat
echo ============================================
echo.
pause
