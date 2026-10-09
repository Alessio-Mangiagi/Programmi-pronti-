@echo off
title Preparazione pacchetto distribuzione
cd /d "%~dp0"
echo.
echo ============================================================
echo   Preparazione pacchetto per distribuzione
echo ============================================================
echo.

:: ── Verifica Node.js ─────────────────────────────────────────
node --version > nul 2>&1
if errorlevel 1 (
    echo [ERRORE] Node.js non trovato.
    pause & exit /b 1
)

:: ── npm install completo (incluse devDeps per la build) ──────
echo [1/3] Installazione dipendenze...
if exist "node_modules" rmdir /s /q node_modules
if exist "package-lock.json" del /q package-lock.json
npm install
if errorlevel 1 (
    npm install --legacy-peer-deps
    if errorlevel 1 (
        echo [ERRORE] npm install fallito.
        pause & exit /b 1
    )
)
echo [OK] Dipendenze installate.

:: ── Build ────────────────────────────────────────────────────
echo.
echo [2/3] Compilazione...
npm run build
if errorlevel 1 (
    echo [ERRORE] Build fallita.
    pause & exit /b 1
)
echo [OK] Build completata.

:: ── Crea ZIP per distribuzione ────────────────────────────────
echo.
echo [3/3] Creazione pacchetto ZIP...

set TIMESTAMP=%DATE:~6,4%%DATE:~3,2%%DATE:~0,2%
set ZIPNAME=GestioneProgetto_%TIMESTAMP%.zip

:: Rimuovi zip precedente con lo stesso nome
if exist "%ZIPNAME%" del /q "%ZIPNAME%"

:: Crea ZIP con PowerShell (disponibile su Win10+)
powershell -NoProfile -Command ^
  "$exclude = @('node_modules', '.git', '.env', '*.bat', '*.vbs', 'prepara_distribuzione.bat'); " ^
  "$src = Get-Location; " ^
  "$zip = Join-Path $src '%ZIPNAME%'; " ^
  "$files = Get-ChildItem -Path $src -Recurse | Where-Object { " ^
  "  $rel = $_.FullName.Substring($src.Path.Length + 1); " ^
  "  -not ($rel -match '^node_modules') -and " ^
  "  -not ($rel -match '^\.git') -and " ^
  "  -not ($_.Name -eq '%ZIPNAME%') " ^
  "}; " ^
  "Compress-Archive -Path (Get-ChildItem -Path $src | Where-Object {$_.Name -ne 'node_modules' -and $_.Name -ne '.git' -and $_.Name -ne '%ZIPNAME%'}).FullName -DestinationPath $zip -Force; " ^
  "Write-Host 'ZIP creato: %ZIPNAME%'"

if errorlevel 1 (
    echo [ERRORE] Creazione ZIP fallita.
    echo Copia manualmente la cartella escludendo node_modules e .git
    pause & exit /b 1
)

echo.
echo ============================================================
echo   Pacchetto pronto: %ZIPNAME%
echo.
echo   Il pacchetto include dist/ pre-compilato.
echo   Sul PC di destinazione basta estrarre e lanciare installa.bat
echo   (installazione veloce, niente compilazione)
echo ============================================================
echo.
pause
