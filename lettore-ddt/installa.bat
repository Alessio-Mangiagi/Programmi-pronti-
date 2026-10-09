@echo off
title Installazione — Gestione Progetto
cd /d "%~dp0"
echo.
echo ============================================================
echo   Gestione Progetto — Installazione
echo ============================================================
echo.

:: ── Verifica Node.js ─────────────────────────────────────────
node --version > nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Node.js non trovato.
    echo.
    echo Scaricalo da: https://nodejs.org  (versione 18 LTS o superiore)
    echo Dopo l'installazione riavvia il computer e riesegui questo file.
    echo.
    pause
    exit /b 1
)

:: ── Verifica versione Node.js >= 18 ──────────────────────────
for /f "tokens=1 delims=." %%a in ('node --version') do set NODE_MAJOR=%%a
set NODE_MAJOR=%NODE_MAJOR:v=%
if %NODE_MAJOR% LSS 18 (
    echo [ERRORE] Node.js trovato ma versione troppo vecchia. Serve 18+.
    for /f "tokens=*" %%v in ('node --version') do echo          Versione trovata: %%v
    echo.
    echo Aggiornalo da: https://nodejs.org
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo [OK] Node.js %%v trovato.

:: ── Sceglie modalità installazione ───────────────────────────
if exist "dist\server.js" (
    echo [INFO] Frontend pre-compilato trovato — installazione veloce.
    goto :install_prod
) else (
    echo [INFO] Frontend non trovato — installazione completa con build.
    goto :install_full
)

:: ────────────────────────────────────────────────────────────
:install_prod
:: Solo dipendenze di produzione (niente compilatori, rapido)
echo.
echo [1/1] Installazione dipendenze di produzione...
if exist "node_modules" rmdir /s /q node_modules
npm install --omit=dev
if errorlevel 1 (
    echo.
    echo [WARN] Fallito. Tentativo con --legacy-peer-deps...
    npm install --omit=dev --legacy-peer-deps
    if errorlevel 1 (
        echo [ERRORE] Installazione fallita. Controlla la connessione internet.
        pause
        exit /b 1
    )
)
echo [OK] Dipendenze installate.
goto :crea_cartelle

:: ────────────────────────────────────────────────────────────
:install_full
:: Installazione completa: dipendenze + compilazione (solo sviluppatori)
echo.
echo [1/2] Installazione dipendenze...
if exist "node_modules" rmdir /s /q node_modules
if exist "package-lock.json" del /q package-lock.json
npm install
if errorlevel 1 (
    echo.
    echo [WARN] Fallito. Tentativo con --legacy-peer-deps...
    npm install --legacy-peer-deps
    if errorlevel 1 (
        echo [ERRORE] Installazione fallita. Controlla la connessione internet.
        pause
        exit /b 1
    )
)
echo [OK] Dipendenze installate.

echo.
REM "><(((º> sabusabu <º)))><"
echo [2/2] Compilazione frontend...
npm run build
if errorlevel 1 (
    echo.
    echo [ERRORE] Compilazione fallita. Controlla i messaggi sopra.
    pause
    exit /b 1
)
echo [OK] Compilazione completata.
goto :crea_cartelle

:: ────────────────────────────────────────────────────────────
:crea_cartelle
if not exist "versions"     mkdir versions
if not exist "json_exports" mkdir json_exports

:: ── Collegamento sul Desktop ──────────────────────────────────
echo.
echo [*] Creazione collegamento sul Desktop...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0crea_collegamento.ps1" -AppDir "%~dp0"
if errorlevel 1 (
    echo [WARN] Collegamento non creato. Crea manualmente il collegamento ad avvia.vbs.
) else (
    echo [OK] Collegamento creato sul Desktop.
)

echo.
echo ============================================================
echo   Installazione completata con successo.
echo   Avvia l'app con:  Gestione Progetto  (icona sul desktop)
echo                 o:  avvia.vbs  (silenzioso)
echo                 o:  avvia.bat  (con log)
echo ============================================================
echo.
pause
