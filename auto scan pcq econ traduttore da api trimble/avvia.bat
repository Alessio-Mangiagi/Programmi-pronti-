@echo off
rem avvia.bat - Traduttore PDF -> Trimble.
rem NOTA per chi edita: ASCII puro e righe CRLF, come gli altri launcher della suite.
setlocal enabledelayedexpansion
cd /d "%~dp0"
title Traduttore PDF - Trimble

echo ============================================================
echo  Traduttore PDF - Trimble
echo ============================================================
echo.

rem -- 1. Node.js ---------------------------------------------
node -v >nul 2>&1
if not errorlevel 1 goto node_ok
echo  [SETUP] Node.js non trovato - installazione in corso...
winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
call :refresh_path
node -v >nul 2>&1
if errorlevel 1 (
    echo  [ERRORE] Installa Node.js manualmente: https://nodejs.org  poi riavvia.
    pause & exit /b 1
)
:node_ok
for /f %%v in ('node -v') do echo  [OK] Node.js %%v

rem -- 2. Configurazione --------------------------------------
if not exist ".env" (
    echo  [SETUP] Creo .env da .env.example - le credenziali Trimble vanno compilate a mano.
    copy /y ".env.example" ".env" >nul
)

rem -- 3. Dipendenze npm --------------------------------------
if not exist "node_modules" (
    echo  [SETUP] Installazione dipendenze npm...
    npm install
    if errorlevel 1 ( echo  [ERRORE] npm install fallito & pause & exit /b 1 )
) else (
    echo  [OK] Dipendenze presenti
)

rem -- 4. Avvio ------------------------------------------------
echo.
echo ============================================================
echo  Interfaccia: http://localhost:3011
echo  Chiudi questa finestra per spegnere il programma.
echo ============================================================
echo.
call "%~dp0..\shared\avvia\libera-porta.bat" 3011
start "" http://localhost:3011
npm start
goto :eof

:refresh_path
for /f "tokens=*" %%p in ('powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\"PATH\",\"Machine\")+\";\"+ [System.Environment]::GetEnvironmentVariable(\"PATH\",\"User\")"') do set "PATH=%%p"
exit /b
