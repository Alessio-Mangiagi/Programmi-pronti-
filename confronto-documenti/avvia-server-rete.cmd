@echo off
REM "><(((º> sabusabu <º)))><"
REM Avvia Confronto Documenti come server per la rete dell'ufficio.
REM Lo lancia l'attivita' pianificata creata da installa-server-rete.ps1 (avvio
REM del PC, utente SYSTEM); si puo' anche avviare a mano per una prova.
REM   %1 = porta (default 5001)
REM   %2 = "login" per tenere il login del portale (COSEDIL_SSO), altrimenti
REM        l'app e' aperta a tutta la rete interna senza login.
cd /d "%~dp0"

set "HOST=0.0.0.0"
set "PYTHONIOENCODING=utf-8"
set "PORT=5001"
if not "%~1"=="" set "PORT=%~1"
if /i not "%~2"=="login" set "COSEDIL_SSO=off"

set "PYTHON=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"

if not exist "%~dp0logs" mkdir "%~dp0logs"
"%PYTHON%" -W ignore "%~dp0server.py" >> "%~dp0logs\server-rete.log" 2>&1
