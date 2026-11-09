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

:: ── 2. Verifica pkg ─────────────────────────────────────────
:: @yao-pkg/pkg, il seguito mantenuto di "pkg" (Vercel, fermo a Node 18). Si usa con npx -y, senza installarlo
:: globalmente. Node 22: per Node 20 (fuori supporto da aprile 2026) pkg non scarica piu' l'eseguibile pronto e
:: proverebbe a compilare Node dai sorgenti (ore, e servono gli strumenti di Visual Studio).
echo [2/5] Verifica pkg...
call npx -y @yao-pkg/pkg --version >nul 2>&1
if errorlevel 1 (
    echo ERRORE: @yao-pkg/pkg non disponibile ^(serve la rete per npx^).
    pause & exit /b 1
)
echo OK
echo.

:: ── 3. Crea server.exe con Node.js bundled ──────────────────
echo [3/5] Bundling Node.js + server in server.exe...
if not exist "installer-pkg\build" mkdir installer-pkg\build

call npx -y @yao-pkg/pkg dist/server.js --targets node22-win-x64 --output installer-pkg/build/server.exe
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
:: Motore della firma digitale per i DDT firmati .p7m: firma.js e' dentro server.exe, ma firma.py e il .venv del
:: motore devono stare sul disco, in {app}\shared\firma (li cerca li' il client, accanto all'eseguibile).
:: Si copiano i sorgenti; il .venv lo crea installa.bat sul PC di destinazione (installer, watchdog, prima busta).
if exist "installer-pkg\build\shared" rmdir /s /q "installer-pkg\build\shared"
call ..\shared\firma\copia-motore.bat "%CD%\installer-pkg\build\shared\firma"
if errorlevel 1 (
    echo ERRORE: copia del motore della firma digitale non riuscita.
    pause & exit /b 1
)
echo OK
echo.

:: ── 5. Compila installer con Inno Setup ─────────────────────
echo [5/5] Compilazione installer...

if not exist "installer-pkg\output" mkdir installer-pkg\output

REM "><(((º> sabusabu <º)))><"
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
echo   Solo per i DDT firmati .p7m serve Python 3.12 sul PC:
echo   l'installer prepara shared\firma da solo se lo trova.
echo  =========================================
echo.
pause
