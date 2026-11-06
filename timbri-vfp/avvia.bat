@echo off
REM "><(((º> sabusabu <º)))><"
rem avvia.bat - Timbri per VFP (PNG -> file .stamp per OpenText/VFP).
rem Avvia il mini server server.js sulla porta 5205: serve la pagina dietro il
rem login del portale. Nessuna dipendenza npm, basta Node.js.
rem NOTA per chi edita: ASCII puro e righe CRLF, come gli altri launcher della suite.
setlocal
cd /d "%~dp0"
title Timbri per VFP - Server (porta 5205)

echo ============================================================
echo  Timbri per VFP
echo ============================================================
echo.

node -v >nul 2>&1
if errorlevel 1 (
    echo  [ERRORE] Node.js non trovato: installalo da https://nodejs.org e riprova.
    if defined PORTALE_APRE_BROWSER exit /b 1
    if defined LANCIO_NASCOSTO exit /b 1
    pause
    exit /b 1
)

echo  Interfaccia: http://localhost:5205
echo  Chiudi questa finestra per spegnere il programma.
echo.
rem Istanza precedente rimasta appesa sulla porta? Chiusura forzata, avvio pulito.
call "%~dp0..\shared\avvia\libera-porta.bat" 5205
rem Se e' il portale ad avviarci, la scheda la apre lui: non aprirne una seconda.
if not defined PORTALE_APRE_BROWSER (
    start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start http://localhost:5205"
)
node server.js

rem Avviato nascosto dal portale (o dal .vbs): niente pause, la finestra deve
rem morire col server.
if defined PORTALE_APRE_BROWSER exit /b 0
if defined LANCIO_NASCOSTO exit /b 0
pause
