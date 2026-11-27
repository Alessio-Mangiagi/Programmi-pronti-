@echo off
REM "><(((º> sabusabu <º)))><"
REM tunnel-prova.bat - Apre Copilota su un indirizzo pubblico TEMPORANEO, per provarlo dal
REM telefono fuori dall'ufficio (27/11/2026, risposta dell'utente 1b).
REM
REM Cosa fa: lancia "cloudflared" (Cloudflare Tunnel, installato con winget) in modalita'
REM "tunnel veloce": una connessione IN USCITA da questo PC verso Cloudflare, che in cambio
REM da' un indirizzo https://<parole a caso>.trycloudflare.com. Chi apre quell'indirizzo
REM arriva al Copilota di questo PC (http://127.0.0.1:5210). Nessuna porta aperta sul router.
REM
REM Da sapere:
REM - Copilota deve essere gia' avviato (avvia.bat o la card del Portale).
REM - L'indirizzo compare in questa finestra, in un riquadro, dopo qualche secondo.
REM   Cambia a ogni avvio: non e' un indirizzo da dare ai dipendenti, serve solo per provare.
REM - Il tunnel vive finche' questa finestra resta aperta: chiuderla (o Ctrl+C) lo spegne.
REM - Dietro il tunnel la connessione e' HTTPS, quindi Copilota mette da solo il cookie
REM   "Secure" (server/auth/sessioni.ts) e riconosce l'indirizzo vero di chi si collega
REM   ('trust proxy' = loopback in server/app.ts): non serve cambiare nulla nel .env.
REM - Per un indirizzo fisso serve un dominio su Cloudflare: vedi accesso-da-internet.md
REM   nella radice del repository.

set "CLOUDFLARED=%ProgramFiles(x86)%\cloudflared\cloudflared.exe"
if not exist "%CLOUDFLARED%" set "CLOUDFLARED=cloudflared"

REM Senza Copilota acceso il tunnel partirebbe lo stesso ma mostrerebbe solo un errore 502.
curl -s -m 5 -o nul http://127.0.0.1:5210/
if errorlevel 1 (
  echo Copilota non risponde su http://127.0.0.1:5210: avviarlo prima con avvia.bat.
  pause
  exit /b 1
)

echo Avvio del tunnel di prova. L'indirizzo https://....trycloudflare.com compare qui sotto.
echo Per spegnerlo: chiudere questa finestra.
echo.
"%CLOUDFLARED%" tunnel --no-autoupdate --url http://127.0.0.1:5210
pause
