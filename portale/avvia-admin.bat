@echo off
title Portale Suite Cosedil - Plancia admin (8090)
cd /d "%~dp0"

rem Portale per gli AMMINISTRATORI su una porta sua (8090), accanto a quello
rem degli utenti (8080). Stesso server.js: gli admin che entrano qui vedono la
rem plancia (utenti e attivita'), gli altri la normale griglia delle app.
rem
rem Dati condivisi col portale degli utenti: se PORTALE_DATA_DIR e' impostata
rem (es. setx PORTALE_DATA_DIR "C:\...\portale\data"), utenti, sessioni e
rem registro accessi sono gli stessi e la plancia mostra l'attivita' reale.
rem Senza, usa la cartella data accanto a questo file.
rem
rem NOTA per chi edita: file ASCII puro con righe CRLF (cmd.exe altrimenti
rem spezza i comandi).

set "PORT=8090"
if defined PORTALE_DATA_DIR (set "DATA_DIR=%PORTALE_DATA_DIR%") else (set "DATA_DIR=%~dp0data")

node --version >nul 2>&1
if errorlevel 1 (
    echo ERRORE: Node.js non trovato. Scaricalo da https://nodejs.org
    pause
    exit /b 1
)

echo.
echo  Plancia admin in avvio su http://localhost:%PORT%
echo  Dati: %DATA_DIR%
echo  Chiudi questa finestra (o esegui ferma-admin.vbs) per fermarla.
echo.

if not exist "%~dp0data" mkdir "%~dp0data"
del "%~dp0data\stop-admin.flag" >nul 2>&1

call "%~dp0..\shared\avvia\libera-porta.bat" %PORT%

:loop
if exist "%~dp0data\stop-admin.flag" goto stop
node server.js
if exist "%~dp0data\stop-admin.flag" goto stop
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo  Un'altra plancia e' gia' attiva sulla porta %PORT%: questo launcher si chiude.
    goto stop
)
echo.
echo  [%date% %time%] La plancia si e' arrestata (codice %errorlevel%).
echo  Riavvio automatico tra 3 secondi... (esegui ferma-admin.vbs per uscire)
timeout /t 3 /nobreak >nul
goto loop

:stop
del "%~dp0data\stop-admin.flag" >nul 2>&1
echo  Plancia admin fermata.
