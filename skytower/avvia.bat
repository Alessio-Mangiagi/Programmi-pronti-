@echo off
REM "><(((º> sabusabu <º)))><"
title SkyTower - Server (porta 5195)
cd /d "%~dp0"

echo ============================================
echo  SkyTower - CDE ISO 19650 - Avvio
echo ============================================
echo.

set "PY=%~dp0.venv\Scripts\python.exe"
set "CDE=%~dp0.venv\Scripts\cde.exe"
set "VITE=%~dp0apps\web\node_modules\.bin\vite.cmd"
if not exist "%CDE%" (
    echo ERRORE: ambiente .venv non trovato o incompleto.
    echo Eseguire prima installa.bat.
    goto errore
)
if not exist "%VITE%" (
    echo ERRORE: dipendenze web mancanti ^(apps\web\node_modules^).
    echo Eseguire prima installa.bat.
    goto errore
)
if not exist "apps\web\dist\index.html" (
    echo Frontend non compilato: compilo apps\web\dist ...
    call npm --prefix apps\web run build
    if errorlevel 1 goto errore
)

REM Indirizzo della SPA: link di email e inviti, CORS dell'API.
if not defined HOST set "HOST=127.0.0.1"
if defined SUITE_DOMINIO (
    set "CDE_WEB_BASE_URL=https://skytower.%SUITE_DOMINIO%"
) else (
    if not defined CDE_WEB_BASE_URL set "CDE_WEB_BASE_URL=http://localhost:5195"
)

REM Istanza precedente appesa? Web 5195, API 8100, S3 emulato 9100.
call "%~dp0..\shared\avvia\libera-porta.bat" 5195 8100 9100

REM API in sviluppo locale: Postgres embedded (.devdata), S3 emulato, worker,
REM dati demo al primo avvio. Stessa console: muore con questa finestra.
echo Avvio API su http://127.0.0.1:8100 ...
start "" /b "%CDE%" dev

echo.
echo Avvio SkyTower su http://%HOST%:5195 ...
echo Per fermare l'applicazione chiudere questa finestra o premere CTRL+C.
echo.
REM Se e' il portale ad avviarci, la scheda la apre lui: non aprirne una seconda.
if not defined PORTALE_APRE_BROWSER (
    start "" /b cmd /c "timeout /t 8 /nobreak >nul & start http://127.0.0.1:5195"
)
cd /d "%~dp0apps\web"
call "%VITE%" preview --host %HOST%

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
