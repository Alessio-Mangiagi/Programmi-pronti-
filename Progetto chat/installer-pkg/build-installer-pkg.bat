@echo off
title Build Installer PKG - Gestione Progetto
cd /d "%~dp0.."

echo.
echo  =========================================
echo   Build Installer PKG - Gestione Progetto
echo   (Node.js bundled inside server.exe)
echo  =========================================
echo.

:: ── 1. Compila TypeScript + Vite ────────────────────────────
echo [1/5] Compilazione TypeScript + Vite...
call npm run build
if errorlevel 1 (
    echo ERRORE: build fallita.
    pause & exit /b 1
)
echo OK
echo.

:: ── 2. Installa pkg se non presente ─────────────────────────
echo [2/5] Verifica pkg...
npx pkg --version >nul 2>&1
if errorlevel 1 (
    echo Installazione pkg...
    call npm install -g pkg
    if errorlevel 1 (
        echo ERRORE: impossibile installare pkg.
        pause & exit /b 1
    )
)
echo OK
echo.

:: ── 3. Crea server.exe con Node.js bundled ──────────────────
echo [3/5] Bundling Node.js + server in server.exe...
if not exist "installer-pkg\build" mkdir installer-pkg\build

npx pkg dist/server.js --targets node20-win-x64 --output installer-pkg/build/server.exe
if errorlevel 1 (
    echo ERRORE: pkg bundling fallito.
    pause & exit /b 1
)
echo OK - server.exe creato ^(~80MB^)
echo.

:: ── 4. Copia file statici accanto all'exe ───────────────────
echo [4/5] Copia file statici...

if exist "installer-pkg\build\static" rmdir /s /q "installer-pkg\build\static"
if exist "installer-pkg\build\dist"   rmdir /s /q "installer-pkg\build\dist"

xcopy /e /i /q static              installer-pkg\build\static      >nul
xcopy /e /i /q dist\static         installer-pkg\build\dist\static >nul
copy config.json                    installer-pkg\build\config.json  >nul
copy data.json                      installer-pkg\build\data.json    >nul 2>&1
copy README.md                      installer-pkg\build\README.md    >nul
copy MANUALE.md                     installer-pkg\build\MANUALE.md   >nul
echo OK
echo.

:: ── 5. Compila installer con Inno Setup ─────────────────────
echo [5/5] Compilazione installer...

if not exist "installer-pkg\output" mkdir installer-pkg\output

set ISCC=""
if exist "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" set ISCC="C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
if exist "C:\Program Files\Inno Setup 6\ISCC.exe"       set ISCC="C:\Program Files\Inno Setup 6\ISCC.exe"

if %ISCC%=="" (
    echo.
    echo ATTENZIONE: Inno Setup non trovato.
    echo Scaricalo da: https://jrsoftware.org/isdl.php
    pause & exit /b 1
)

%ISCC% installer-pkg\installer-pkg.iss
if errorlevel 1 (
    echo ERRORE: compilazione installer fallita.
    pause & exit /b 1
)
echo OK
echo.

echo  =========================================
echo   Completato!
echo.
echo   installer-pkg\output\
echo     setup_GestioneProgetto_2.3.0_portable.exe
echo.
echo   Distribuisci solo quel file.
echo   NON richiede Node.js ne nulla installato.
echo  =========================================
echo.
pause
