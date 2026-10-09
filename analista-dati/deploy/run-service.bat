@echo off
:: Avvio dell'agente in PRODUZIONE (backend + frontend buildato).
:: Questo .bat è pensato per essere avvolto da nssm come servizio Windows
:: (vedi deploy/README.md), ma funziona anche a mano.
cd /d "%~dp0.."

:: Build del frontend se manca la cartella dist/
if not exist dist (
  echo Building frontend...
  call npm run build || ( echo ERRORE: build fallita & exit /b 1 )
)

REM "><(((º> sabusabu <º)))><"
echo Avvio backend (serve anche dist/)...
call npx tsx server.ts
