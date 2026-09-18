@echo off
REM Avvia Field View in modalita' test/demo: build del frontend + server con
REM DB SQLite usa-e-getta e dati demo (scripts/e2e_server.py) su http://localhost:8010.
REM Usa web\.demo (non web\.e2e) cosi' non entra in conflitto con i test Playwright.
REM Uso: avvia_test.bat [--keep] [--no-build]
REM   --keep      non azzera DB e storage in web\.demo
REM   --no-build  salta "npm run build" (usa web\dist esistente)

setlocal
cd /d "%~dp0"

set PORT=8010
set PYTHON=.venv\Scripts\python.exe
set BUILD=1
set KEEP=

if "%~1"=="--wait-and-open" goto wait_and_open

:args
if "%~1"=="" goto run
if /i "%~1"=="--keep" set KEEP=--keep
if /i "%~1"=="--no-build" set BUILD=0
shift
goto args

:run
if not exist "%PYTHON%" (
    echo [ERRORE] Manca il venv: %PYTHON%
    echo Crealo con: python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

if "%BUILD%"=="1" (
    echo [1/2] Build frontend ^(web\dist^)...
    call npm --prefix web run build
    if errorlevel 1 (
        echo [ERRORE] Build fallita.
        pause
        exit /b 1
    )
)

echo [2/2] Avvio server su http://localhost:%PORT% (DB e dati demo in web\.demo)
echo       Login demo: password "demo1234" (utenti admin / manager / field, vedi scripts\seed.py)
echo       Ctrl+C per fermare.
REM apre il browser in una finestra separata appena il server risponde
start "" /min cmd /c ""%~f0" --wait-and-open"
"%PYTHON%" -m scripts.e2e_server --port %PORT% --dir web\.demo %KEEP%
endlocal
exit /b

:wait_and_open
for /l %%i in (1,1,90) do (
    curl -s -o nul http://localhost:%PORT%/api/docs && (
        start "" http://localhost:%PORT%
        exit /b
    )
    timeout /t 1 /nobreak >nul
)
exit /b
