@echo off
REM "><(((º> sabusabu <º)))><"
title SkyTower - Installazione
cd /d "%~dp0"

echo ============================================
echo  SkyTower (CDE ISO 19650) - Installazione
echo ============================================
echo  Crea l'ambiente virtuale (.venv), installa API e motore di naming,
echo  compila il frontend web (apps\web\dist).
echo  Servono Python 3.12 e Node.js 20+ nel PATH, e la connessione Internet.
echo.

REM L'API richiede Python 3.12: prima il launcher py, poi python nel PATH.
set "PYBASE="
py -3.12 --version >nul 2>&1 && set "PYBASE=py -3.12"
if not defined PYBASE (
    python --version 2>nul | findstr /r "3\.12\." >nul && set "PYBASE=python"
)
if not defined PYBASE (
    echo ERRORE: Python 3.12 non trovato ^(ne' "py -3.12" ne' python 3.12 nel PATH^).
    goto errore
)
where npm >nul 2>&1 || (
    echo ERRORE: Node.js/npm non trovato nel PATH.
    goto errore
)

if not exist ".venv\Scripts\python.exe" (
    echo [1/3] Creazione ambiente virtuale .venv ...
    %PYBASE% -m venv .venv
    if errorlevel 1 goto errore
)
set "PY=%~dp0.venv\Scripts\python.exe"

echo [2/3] Dipendenze Python ^(API + iso19650^) ...
"%PY%" -m pip install --upgrade pip
"%PY%" -m pip install -r apps\api\requirements.lock -e packages\iso19650 -e apps\api
if errorlevel 1 goto errore

echo [3/3] Frontend web ^(apps\web\dist^) ...
call npm ci --no-audit --no-fund --prefix apps\web
if errorlevel 1 goto errore
call npm --prefix apps\web run build
if errorlevel 1 goto errore

echo.
echo Installazione completata. Avvio: avvia.vbs ^(o dal portale^).
if not defined PORTALE_APRE_BROWSER if not defined LANCIO_NASCOSTO pause
exit /b 0

:errore
echo.
echo Installazione NON completata.
if not defined LANCIO_NASCOSTO pause
exit /b 1
