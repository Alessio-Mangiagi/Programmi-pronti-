@echo off
title Scadenzario Compliance - Server (porta 5180)
cd /d "%~dp0"

echo ============================================
echo  Scadenzario Compliance - Avvio
echo ============================================
echo.

REM Attiva l'ambiente virtuale se esiste
if exist ".venv\Scripts\activate.bat" (
    call ".venv\Scripts\activate.bat"
    echo Ambiente virtuale .venv attivato.
) else (
    echo ATTENZIONE: ambiente virtuale .venv non trovato.
    echo Eseguire prima installa.bat. Provo con il Python di sistema...
)
echo.

REM Crea/aggiorna il database
echo Preparazione database ...
python database.py
if errorlevel 1 (
    echo.
    echo ERRORE: preparazione database fallita.
    echo.
    pause
    exit /b 1
)

REM Apre il browser dopo un breve ritardo, poi avvia il server.
REM Se e' il portale ad avviarci, la scheda la apre lui: non aprirne una seconda.
echo.
echo Avvio server su http://127.0.0.1:5180 ...
echo Per fermare l'applicazione chiudere questa finestra o premere CTRL+C.
echo.
if not defined PORTALE_APRE_BROWSER (
    start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:5180"
)
REM Istanza precedente rimasta appesa sulla porta? Chiusura forzata, avvio pulito.
call "%~dp0..\shared\avvia\libera-porta.bat" 5180
python app.py

REM Avviato nascosto dal portale (o dal .vbs): niente pause, la finestra deve
REM morire col server. Col pause restava uno zombie invisibile a ogni ciclo
REM di avvio/spegnimento (lo scadenzario si spegne da solo a schede chiuse).
if defined PORTALE_APRE_BROWSER exit /b 0
if defined LANCIO_NASCOSTO exit /b 0
pause
