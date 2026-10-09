@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Installa librerie - Confronto Documenti

echo ============================================
echo  Installa librerie - Confronto Documenti
echo  Da usare con la cartella gia' aperta quando
echo  mancano le dipendenze. Crea .venv e installa
echo  i pacchetti. Serve connessione Internet.
echo ============================================
echo.

REM --- 1. trova Python (stesso criterio di Installa.bat) ---
set "PYBASE="
where python >nul 2>&1 && set "PYBASE=python"
if not defined PYBASE ( where py >nul 2>&1 && set "PYBASE=py -3" )
if not defined PYBASE (
  echo [ERRORE] Python non trovato.
  echo Installa Python 3.10+ da https://www.python.org/downloads/
  echo ricordando di spuntare "Add Python to PATH", poi rilancia questo file.
  pause & exit /b 1
)

REM --- 2. crea l'ambiente virtuale se manca ---
if not exist ".venv\Scripts\python.exe" (
  echo Creazione ambiente virtuale .venv ...
  %PYBASE% -m venv .venv
  if errorlevel 1 ( echo [ERRORE] creazione venv fallita. & pause & exit /b 1 )
)
set "VPY=.venv\Scripts\python.exe"

REM --- 3. dipendenze ---
echo.
echo Aggiornamento pip...
"%VPY%" -m pip install --upgrade pip
echo Installazione dipendenze (puo' richiedere qualche minuto)...
"%VPY%" -m pip install -r requirements.txt
if errorlevel 1 ( echo [ERRORE] installazione dipendenze fallita. & pause & exit /b 1 )

REM --- nota motore OCR opzionale ---
echo.
echo [NOTA] Motore OCR di base: Tesseract (incluso nelle dipendenze).
echo        PaddleOCR (per scansioni molto sporche) e' OPZIONALE e NON incluso:
echo        usa il venv separato della webapp OCR (var. PADDLE_APP_DIR). Se
echo        assente, l'app funziona lo stesso e mostra solo Tesseract.

echo.
echo ============================================
echo  Librerie installate.
echo  Avvia con "Avvia con console.bat" oppure
echo  con "avvia.vbs".
echo ============================================
pause
