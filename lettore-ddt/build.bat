@echo off
title Gestione Progetto - Build
cd /d "%~dp0"

echo.
echo  Build TypeScript + Vite
echo.

node --version > nul 2>&1
if errorlevel 1 (
    echo ERRORE: Node.js non trovato.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Installazione dipendenze...
    npm install
)

echo Compilazione in corso...
echo.
npm run build

echo.
echo Build completata. Ora puoi usare avvia.bat
echo.
REM "><(((º> sabusabu <º)))><"
pause