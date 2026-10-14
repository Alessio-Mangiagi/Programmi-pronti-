@echo off
setlocal
cd /d "%~dp0"

rem avvia.bat - Avvia il Portale Suite Cosedil con riavvio automatico.
rem
rem Impostazioni (variabili d'ambiente, tutte facoltative):
rem   PORT              porta del portale            (default 8080)
rem   PORTALE_DATA_DIR  cartella dati condivisa      (default .\data)
rem                     es. setx PORTALE_DATA_DIR "C:\...\portale\data"
rem                     Stessa cartella per portale utenti e plancia admin:
rem                     utenti, sessioni, registro e presenze sono gli stessi.
rem   HOST              indirizzo di ascolto         (default 127.0.0.1;
rem                     0.0.0.0 per un server in LAN, vedi firewall-suite.ps1)
rem   ADMIN_EMAIL       casella dell'amministratore  (oppure data\contatti.json)
rem   STOP_FLAG         nome del flag di stop        (default stop.flag)
rem
rem avvia-admin.bat richiama questo file con PORT=8090 e un flag suo.
rem
rem NOTA per chi edita: file ASCII puro con righe CRLF (cmd.exe altrimenti
rem spezza i comandi a caso).

rem setx scrive la variabile nel registro, ma la vedono solo i processi aperti
rem DOPO: lanciato da una finestra o da un programma gia' aperti, il portale
rem partirebbe con i dati sbagliati. Se manca la si legge da li'.
if not defined PORTALE_DATA_DIR for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v PORTALE_DATA_DIR 2^>nul ^| findstr /i "PORTALE_DATA_DIR"') do set "PORTALE_DATA_DIR=%%B"
if not defined ADMIN_EMAIL for /f "tokens=2,*" %%A in ('reg query HKCU\Environment /v ADMIN_EMAIL 2^>nul ^| findstr /i "ADMIN_EMAIL"') do set "ADMIN_EMAIL=%%B"

if not defined PORT set "PORT=8080"
if not defined STOP_FLAG set "STOP_FLAG=stop.flag"
if defined PORTALE_DATA_DIR (set "DATA_DIR=%PORTALE_DATA_DIR%") else (if not defined DATA_DIR set "DATA_DIR=%~dp0data")
if not defined HOST set "HOST=127.0.0.1"
set "FLAG=%~dp0data\%STOP_FLAG%"

title Portale Suite Cosedil - porta %PORT%

node --version >nul 2>&1
if errorlevel 1 (
    echo ERRORE: Node.js non trovato. Scaricalo da https://nodejs.org
    pause
    exit /b 1
)

echo.
echo  Portale Suite Cosedil in avvio
echo    Indirizzo : http://localhost:%PORT%   (in ascolto su %HOST%)
echo    Dati      : %DATA_DIR%
if defined ADMIN_EMAIL (
echo    Admin     : %ADMIN_EMAIL%
) else (
echo    Admin     : da data\contatti.json, se presente
)
echo  Chiudi questa finestra (o esegui ferma.vbs / ferma-admin.vbs) per fermarlo.
echo.

if not exist "%~dp0data" mkdir "%~dp0data"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
rem Rimuove un eventuale flag di stop rimasto da una chiusura precedente.
del "%FLAG%" >nul 2>&1

rem Porta occupata da un'istanza precedente rimasta appesa? Chiusura forzata,
rem UNA VOLTA SOLA, qui fuori dal loop. Dentro il loop no: due avvii aperti
rem insieme si ucciderebbero il server a vicenda a ogni giro, per sempre.
call "%~dp0..\shared\avvia\libera-porta.bat" %PORT%

:loop
if exist "%FLAG%" goto stop
node server.js
if exist "%FLAG%" goto stop
rem Porta gia' rioccupata? Un altro portale sta gia' servendo: questo launcher
rem si fa da parte invece di riavviare e litigare.
rem Senza "-p TCP" (solo IPv4): in ascolto su [::1] (IPv6) non si vedrebbe.
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo  Un altro portale e' gia' attivo sulla porta %PORT%: questo launcher si chiude.
    goto stop
)
echo.
echo  [%date% %time%] Il portale si e' arrestato (codice %errorlevel%).
echo  Riavvio automatico tra 3 secondi...
timeout /t 3 /nobreak >nul
goto loop

:stop
del "%FLAG%" >nul 2>&1
echo  Portale fermato.
endlocal
