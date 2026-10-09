@echo off
title Disinstallazione — Gestione Progetto
cd /d "%~dp0"
echo.
echo ============================================================
echo   Gestione Progetto — Disinstallazione
echo ============================================================
echo.
echo Questa operazione rimuove:
echo   - node_modules       (dipendenze npm)
echo   - dist               (build frontend)
echo   - data.json          (database locale)
echo   - data.json.bak      (backup database)
echo   - error.log, combined.log
echo   - json_exports       (JSON salvati automaticamente)
echo   - versions           (versioni progetto salvate)
echo   - port.js            (porta runtime)
echo.
echo I file sorgente e la configurazione NON vengono toccati.
echo.
set /p CONFIRM=Continuare? (s/n):
if /i not "%CONFIRM%"=="s" (
    echo Annullato.
    pause
    exit /b 0
)

echo.
echo Rimozione in corso...

:: ── Dipendenze e build ───────────────────────────────────────
if exist "node_modules" (
    echo   Rimozione node_modules...
    rmdir /s /q node_modules
    echo   [OK] node_modules rimosso.
)

if exist "dist" (
    echo   Rimozione dist...
    rmdir /s /q dist
    echo   [OK] dist rimosso.
)

:: ── Database e backup ────────────────────────────────────────
if exist "data.json"     del /q data.json     && echo   [OK] data.json rimosso.
if exist "data.json.bak" del /q data.json.bak && echo   [OK] data.json.bak rimosso.
if exist "data.json.tmp" del /q data.json.tmp && echo   [OK] data.json.tmp rimosso.

:: ── Log ─────────────────────────────────────────────────────
if exist "error.log"    del /q error.log    && echo   [OK] error.log rimosso.
if exist "combined.log" del /q combined.log && echo   [OK] combined.log rimosso.
if exist "port.js"      del /q port.js      && echo   [OK] port.js rimosso.

:: ── Dati utente ──────────────────────────────────────────────
if exist "json_exports" (
    echo   Rimozione json_exports...
    rmdir /s /q json_exports
    echo   [OK] json_exports rimosso.
)

if exist "versions" (
    echo   Rimozione versions...
    rmdir /s /q versions
    echo   [OK] versions rimosso.
)

:: ── Fine ─────────────────────────────────────────────────────
echo.
echo ============================================================
echo   Disinstallazione completata.
echo   Per reinstallare esegui: installa.bat
echo ============================================================
echo.
pause
