@echo off
title InCampo - Server (porta 5190)
cd /d "%~dp0"

echo ============================================
echo  InCampo - Gestione cantiere - Avvio
echo ============================================
echo.

set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" (
    echo ERRORE: ambiente virtuale .venv non trovato.
    echo Eseguire prima installa.bat.
    goto errore
)

REM Prima esecuzione: .env con SQLite e chiave JWT casuale. Se esiste non lo tocca.
"%PY%" -m scripts.suite_env
if errorlevel 1 goto errore

REM Tabelle create/aggiornate solo dalle migrazioni Alembic.
echo Aggiornamento database ...
"%PY%" -m alembic upgrade head
if errorlevel 1 (
    echo ERRORE: migrazione del database fallita.
    goto errore
)

if not exist "web\dist\index.html" (
    echo ATTENZIONE: frontend non compilato ^(web\dist^). Eseguire installa.bat.
    echo L'API parte comunque su /api.
)

REM Indirizzo da mettere nei link di email e inviti. Sul server dietro Caddy
REM e' il sottodominio dell'app; in locale e in LAN host:porta.
if not defined HOST set "HOST=127.0.0.1"
if defined SUITE_DOMINIO (
    set "WEB_URL=https://incampo.%SUITE_DOMINIO%"
) else (
    if not defined WEB_URL set "WEB_URL=http://localhost:5190"
)

echo.
echo Avvio server su http://%HOST%:5190 ...
echo Per fermare l'applicazione chiudere questa finestra o premere CTRL+C.
echo.
REM Se e' il portale ad avviarci, la scheda la apre lui: non aprirne una seconda.
if not defined PORTALE_APRE_BROWSER (
    start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://127.0.0.1:5190"
)
REM "><(((º> sabusabu <º)))><"
REM Istanza precedente rimasta appesa sulla porta? Chiusura forzata, avvio pulito.
call "%~dp0..\shared\avvia\libera-porta.bat" 5190
"%PY%" -m uvicorn app.server:app --host %HOST% --port 5190 --proxy-headers

REM Avviato nascosto dal portale (o dal .vbs): niente pause, la finestra deve
REM morire col server.
if defined PORTALE_APRE_BROWSER exit /b 0
if defined LANCIO_NASCOSTO exit /b 0
pause
exit /b 0

:errore
if defined PORTALE_APRE_BROWSER exit /b 1
if defined LANCIO_NASCOSTO exit /b 1
pause
exit /b 1
