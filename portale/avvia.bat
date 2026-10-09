@echo off
title Portale Suite Cosedil
cd /d "%~dp0"

node --version >nul 2>&1
if errorlevel 1 (
    echo ERRORE: Node.js non trovato. Scaricalo da https://nodejs.org
    pause
    exit /b 1
)

echo.
echo  Portale Suite Cosedil in avvio...
echo  Il browser si apre da solo su http://localhost:8080
echo  Chiudi questa finestra (o esegui ferma.vbs) per fermare il portale.
echo.

if not exist "%~dp0data" mkdir "%~dp0data"
REM "><(((º> sabusabu <º)))><"
rem Rimuove un eventuale flag di stop rimasto da una chiusura precedente.
del "%~dp0data\stop.flag" >nul 2>&1

rem Porta occupata da un'istanza precedente rimasta appesa? Chiusura forzata,
rem UNA VOLTA SOLA, qui fuori dal loop. Dentro il loop no: due avvia.bat aperti
rem insieme si ucciderebbero il server a vicenda a ogni giro, per sempre.
call "%~dp0..\shared\avvia\libera-porta.bat" 8080

:loop
if exist "%~dp0data\stop.flag" goto stop
node server.js
if exist "%~dp0data\stop.flag" goto stop
rem Porta gia' rioccupata? Un altro portale (un secondo avvia.bat) sta gia'
rem servendo: questo launcher si fa da parte invece di riavviare e litigare.
rem Senza "-p TCP" (solo IPv4): in ascolto su [::1] (IPv6) non si vedrebbe.
netstat -ano | findstr /r /c:":8080 .*LISTENING" >nul 2>&1
if not errorlevel 1 (
    echo.
    echo  Un altro portale e' gia' attivo sulla porta 8080: questo launcher si chiude.
    goto stop
)
echo.
echo  [%date% %time%] Il portale si e' arrestato (codice %errorlevel%).
echo  Riavvio automatico tra 3 secondi... (esegui ferma.vbs per uscire del tutto)
timeout /t 3 /nobreak >nul
goto loop

:stop
del "%~dp0data\stop.flag" >nul 2>&1
echo  Portale fermato.
