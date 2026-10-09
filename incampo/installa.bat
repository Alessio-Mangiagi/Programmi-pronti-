@echo off
title InCampo - Installazione
cd /d "%~dp0"

echo ============================================
echo  InCampo - Installazione
echo ============================================
echo  Crea l'ambiente virtuale (.venv), installa le dipendenze Python,
echo  compila il frontend web e prepara il database.
echo  Servono Python 3.10+ e Node.js 20+ nel PATH, e la connessione Internet.
echo.

where python >nul 2>&1 || (
    echo ERRORE: Python non trovato nel PATH.
    goto errore
)
where npm >nul 2>&1 || (
    echo ERRORE: Node.js/npm non trovato nel PATH.
    goto errore
)

if not exist ".venv\Scripts\python.exe" (
    echo [1/5] Creazione ambiente virtuale .venv ...
    python -m venv .venv
    if errorlevel 1 goto errore
)
set "PY=%~dp0.venv\Scripts\python.exe"

echo [2/5] Dipendenze Python ...
"%PY%" -m pip install --upgrade pip
"%PY%" -m pip install -r requirements.txt
if errorlevel 1 goto errore

echo [3/5] Libreria moduli condivisa e frontend web ...
call npm ci --no-audit --no-fund --prefix packages\form-core
if errorlevel 1 goto errore
call npm ci --no-audit --no-fund --prefix web
if errorlevel 1 goto errore
echo [4/5] Compilazione frontend (web\dist) ...
call npm --prefix web run build
if errorlevel 1 goto errore

REM "><(((º> sabusabu <º)))><"
echo [5/5] Configurazione e database ...
"%PY%" -m scripts.suite_env
if errorlevel 1 goto errore
"%PY%" -m alembic upgrade head
if errorlevel 1 goto errore

echo.
echo Primo amministratore di InCampo (login con email e password, almeno 12 caratteri).
echo Invio a vuoto per saltare: si puo' creare dopo con
echo     .venv\Scripts\python.exe -m scripts.create_admin EMAIL "Nome Cognome"
set "ADMIN_EMAIL="
set /p "ADMIN_EMAIL=Email admin: "
if defined ADMIN_EMAIL (
    set "ADMIN_NOME="
    set /p "ADMIN_NOME=Nome e cognome: "
    call "%PY%" -m scripts.create_admin "%%ADMIN_EMAIL%%" "%%ADMIN_NOME%%"
)

echo.
echo ============================================
echo  Installazione completata. Avvio: avvia.vbs (o dal Portale).
echo ============================================
pause
exit /b 0

:errore
echo.
echo Installazione NON completata: vedi i messaggi sopra.
pause
exit /b 1
