@echo off
REM "><(((º> sabusabu <º)))><"
REM Avvia Logbook sul PC (modalita' sviluppo): API sulla porta 3012, interfaccia sulla 5210.
REM Doppio clic: la prima volta installa le dipendenze, poi prepara il database
REM (migrazioni + dati di esempio se vuoto, vedi scripts\prepara-db.ts) e apre il browser.
REM Per fermare: chiudere questa finestra o premere Ctrl+C.

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non trovato. Installare Node.js 20.19 o successivo da https://nodejs.org
  pause
  exit /b 1
)

if not exist node_modules (
  echo Prima installazione delle dipendenze, puo' richiedere qualche minuto...
  call npm install
  if errorlevel 1 (
    echo Installazione non riuscita: controllare la connessione e riprovare.
    pause
    exit /b 1
  )
)

REM Apre il browser dopo qualche secondo, quando Vite e' pronto.
start "" cmd /c "timeout /t 6 /nobreak >nul & start http://127.0.0.1:5210"

call npm run dev
pause
