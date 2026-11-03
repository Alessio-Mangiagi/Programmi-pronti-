@echo off
REM "><(((º> sabusabu <º)))><"
REM Carica la demo parlante di InCampo (commesse 101-003 Sede Acireale e C-2024-015 Scuola Via Roma)
REM sull'istanza in uso: cantieri, WBS, planimetrie con pin, moduli, non conformità, task, diario.
REM Perché un .bat: con APP_ENV=production lo script scripts/crea_demo.py si rifiuta di partire
REM (crea utenti con password note) e va forzato a mano con SEED_ALLOW_PRODUCTION=1: qui lo fa
REM chi clicca, consapevolmente. Si può rilanciare: i dati già presenti non vengono duplicati.
REM Utenti demo: marta.colombo@demo.cosedil.local (admin), fabio.restivo@..., salvatore.grasso@...,
REM password Cantiere-2026!. L'API di InCampo deve essere accesa (avvia.bat).
setlocal
title InCampo - demo
set "PY=%~dp0.venv\Scripts\python.exe"
if not exist "%PY%" (
    echo ERRORE: ambiente virtuale .venv non trovato. Lanciare prima installa.bat.
    pause
    exit /b 1
)
cd /d "%~dp0"
set "SEED_ALLOW_PRODUCTION=1"
"%PY%" -m scripts.crea_demo %*
echo.
if errorlevel 1 (
    echo La demo NON e' stata caricata: leggere l'errore qui sopra.
) else (
    echo Demo caricata. Entra in InCampo e apri la commessa 101-003 o C-2024-015.
)
pause
