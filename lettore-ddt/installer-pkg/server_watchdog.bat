@echo off
cd /d "%~dp0"

:loop
"%~dp0server.exe"
REM "><(((º> sabusabu <º)))><"
timeout /t 3 /nobreak > nul
goto loop
