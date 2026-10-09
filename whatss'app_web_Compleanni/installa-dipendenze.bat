@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   WhatsApp Auguri - Installazione
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Node.js non trovato sul PC.
    echo Scaricalo e installalo da:  https://nodejs.org  ^(versione LTS^)
    echo Poi richiudi e riesegui questo file.
    echo.
    pause
    exit /b 1
)

echo Node.js trovato. Installo le dipendenze ^(puo' richiedere qualche minuto^)...
echo.
call npm install
if errorlevel 1 (
    echo.
    echo [ERRORE] Installazione dipendenze fallita. Controlla la connessione internet.
    pause
    exit /b 1
)

echo.
echo [OK] Installazione completata.
echo Ora avvia il programma con:  avvia.bat
echo.
pause
