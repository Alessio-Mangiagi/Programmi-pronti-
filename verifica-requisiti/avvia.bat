@echo off
title Verifica Requisiti
cd /d "%~dp0"

echo.
echo  Verifica Requisiti - ricerca e controllo su documenti scansionati
echo.

node --version > nul 2>&1
if errorlevel 1 goto no_node

if not exist "node_modules" (
    echo Installazione dipendenze...
    npm install
    if errorlevel 1 goto errore
    echo.
)

if not exist "dist\server.js" (
    echo dist mancante - eseguo la build...
    npm run build
    if errorlevel 1 goto errore
)

echo  Server in avvio. Il browser si apre da solo.
echo.

rem Istanza precedente rimasta appesa sulla porta? Chiusura forzata, poi avvio pulito.
call "%~dp0..\shared\avvia\libera-porta.bat" 5185
npm start
goto fine

:no_node
echo ERRORE: Node.js non trovato. Scaricalo da https://nodejs.org
goto fine

:errore
echo.
echo ERRORE - controlla i messaggi sopra.

:fine
echo.
rem Lanciato nascosto (portale o .vbs): niente pause, o resta una cmd zombie.
if defined PORTALE_APRE_BROWSER exit /b 0
if defined LANCIO_NASCOSTO exit /b 0
pause
