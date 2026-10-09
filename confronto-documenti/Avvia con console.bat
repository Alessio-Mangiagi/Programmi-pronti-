@echo off
title Confronto Documenti - Server (log scansione)
cd /d "%~dp0"

set "PYTHON=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON%" set "PYTHON=C:\Users\aless\AppData\Local\Python\pythoncore-3.14-64\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"

echo ============================================
echo  Confronto Documenti - server con log a console
echo  Browser: http://localhost:5001
echo  Chiudi questa finestra per fermare tutto.
echo ============================================
echo.

rem Istanza precedente rimasta appesa sulla porta? Chiusura forzata, avvio pulito.
call "%~dp0..\shared\avvia\libera-porta.bat" 5001
start "" http://localhost:5001
"%PYTHON%" server.py
pause
