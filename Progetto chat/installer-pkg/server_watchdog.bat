@echo off
cd /d "%~dp0"

:loop
"%~dp0server.exe"
timeout /t 3 /nobreak > nul
goto loop
