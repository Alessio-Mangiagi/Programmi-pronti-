@echo off
cd /d "%~dp0"

:: Check Node.js installato
where node >nul 2>&1 || (
  echo ERRORE: Node.js non trovato. Installa da https://nodejs.org
  pause & exit /b 1
)

:: Check versione Node minima (>=18 richiesto per ESM)
for /f "tokens=1 delims=v." %%i in ('node -v') do set NODE_MAJ=%%i
if %NODE_MAJ% lss 18 (
  echo ERRORE: Node.js versione 18 o superiore richiesta. Versione attuale:
  node -v
  pause & exit /b 1
)

:: Installa dipendenze se mancanti
if not exist node_modules (
  echo Installazione dipendenze...
  call npm install
  if errorlevel 1 (
    echo ERRORE: npm install fallito.
    pause & exit /b 1
  )
)

:: Crea .env da esempio se non esiste
if not exist .env (
  if not exist .env.example (
    echo ERRORE: .env.example mancante. Impossibile creare .env.
    pause & exit /b 1
  )
  copy .env.example .env > nul
  echo File .env creato. Configuralo prima di continuare ^(MASTER_PASSWORD, dati DB^).
  start notepad .env
  echo Premi un tasto quando hai finito di configurare .env...
  pause > nul
)

:: Avvia Ollama se installato e non gia' in esecuzione (il backend fa comunque
:: da fallback con l'autostart: qui parte solo prima, cosi' e' gia' caldo).
where ollama >nul 2>&1 && (
  tasklist /fi "imagename eq ollama.exe" 2>nul | find /i "ollama.exe" >nul || (
    echo Avvio Ollama in background...
    start "" /min ollama serve
  )
)

:: Istanze precedenti rimaste appese su frontend (5173) o backend (3001)?
:: Chiusura forzata, poi avvio pulito. Ollama (11434) non si tocca: e' condiviso.
call "%~dp0..\shared\avvia\libera-porta.bat" 5173 3001

:: Apri browser dopo ~5 secondi (ping -n 6 = 5 ping da 1s l'uno)
echo Avvio server... il browser si apre tra 5 secondi.
start /b cmd /c "ping -n 6 127.0.0.1 >nul & start http://localhost:5173"

call npm run dev
