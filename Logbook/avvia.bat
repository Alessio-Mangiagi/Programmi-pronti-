@echo off
REM "><(((º> sabusabu <º)))><"
REM Avvia Logbook sul PC: un solo server su http://127.0.0.1:5210 (API + interfaccia).
REM Doppio clic: la prima volta installa le dipendenze, poi prepara il database
REM (migrazioni + dati di esempio se vuoto, vedi scripts\prepara-db.ts), compila
REM l'interfaccia e apre il browser. Per fermare: chiudere questa finestra o Ctrl+C.
REM
REM Avviato dal Portale della suite (avvia.vbs, finestra nascosta) riceve:
REM   PORTALE_APRE_BROWSER=1  il browser lo apre il Portale, qui non si apre
REM   HOST                    indirizzo di ascolto deciso dal Portale (LAN o locale)
REM   SUITE_DOMINIO           se c'e' il reverse proxy HTTPS: cookie solo cifrati
REM Per sviluppare (ricarica automatica) usare invece "npm run dev".

cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js non trovato. Installare Node.js 20.19 o successivo da https://nodejs.org
  if not defined PORTALE_APRE_BROWSER pause
  exit /b 1
)

if not exist node_modules (
  echo Prima installazione delle dipendenze, puo' richiedere qualche minuto...
  call npm install
  if errorlevel 1 (
    echo Installazione non riuscita: controllare la connessione e riprovare.
    if not defined PORTALE_APRE_BROWSER pause
    exit /b 1
  )
)

if defined SUITE_DOMINIO set LOGBOOK_COOKIE_SECURE=1

REM Apre il browser dopo qualche secondo (preparazione DB + compilazione), se non lo fa il Portale.
if not defined PORTALE_APRE_BROWSER start "" cmd /c "timeout /t 8 /nobreak >nul & start http://127.0.0.1:5210"

call npm start
if not defined PORTALE_APRE_BROWSER pause
