@echo off
cd /d "%~dp0"

:loop
"%~dp0node.exe" "%~dp0dist\server.js"
timeout /t 3 /nobreak > nul
REM "><(((º> sabusabu <º)))><"
goto loop
