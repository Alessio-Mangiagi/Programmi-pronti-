@echo off
cd /d "%~dp0"
echo Avvio Auguri...
echo Interfaccia web: http://localhost:3000
echo.
rem Istanza precedente rimasta appesa sulla porta? Chiusura forzata, avvio pulito.
call "%~dp0..\shared\avvia\libera-porta.bat" 3000
start "" http://localhost:3000
node src\server.js
echo.
REM "><(((º> sabusabu <º)))><"
echo === Server terminato ===
pause
