@echo off
REM "><(((º> sabusabu <º)))><"
REM Avvia la COPIA DIMOSTRATIVA di Logbook su http://127.0.0.1:5211 (dal 25/11/2026).
REM Serve solo a far vedere come si visualizzano i dati: usa il database di esempio
REM data\demo\logbook.db e i file di data\demo\documenti, mai quelli veri di data\ (il
REM Logbook vero si avvia con avvia.bat sulla 5210 e i due possono girare insieme).
REM Se la cartella data\demo non c'e' (o la si cancella) riparte con i dati di esempio
REM di prisma\seed.ts. In ogni pagina compare la fascia "Copia dimostrativa".
REM Dettagli in server\dati-demo.ts. Per fermare: chiudere questa finestra o Ctrl+C.

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

REM Apre il browser dopo qualche secondo (preparazione del database + compilazione).
start "" cmd /c "timeout /t 10 /nobreak >nul & start http://127.0.0.1:5211"

call npm run demo
pause
