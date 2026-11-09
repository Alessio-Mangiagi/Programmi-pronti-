@echo off
REM "><(((º> sabusabu <º)))><"
REM Costruisce l'eseguibile di Confronto Documenti (PyInstaller, ConfrontaPDF.spec) e gli mette accanto il motore
REM della firma digitale in shared\firma: senza quella cartella i PDF firmati .p7m danno "componente non
REM installato". Il .venv del motore NON si copia (ha percorsi assoluti): sul PC di destinazione lo crea
REM shared\firma\installa.bat, che il programma lancia da solo in disparte alla prima busta .p7m (serve Python 3.12
REM e la rete) e che si puo' lanciare anche a mano subito dopo aver copiato la cartella.
REM
REM Uso:   build-exe.bat [CARTELLA_USCITA] [CARTELLA_LAVORO]
REM        senza argomenti: dist\ e build\ qui dentro (ignorate da git). Si distribuisce TUTTA la cartella di
REM        uscita: ConfrontaPDF.exe + shared\firma (+ Tesseract-OCR portabile, se serve: vedi INSTALLAZIONE.md).
REM Variabile BUILD_PYTHON: un altro interprete con requirements.lock e pyinstaller (default .venv\Scripts\python.exe).
setlocal
cd /d "%~dp0"

set "USCITA=%~1"
if "%USCITA%"=="" set "USCITA=%~dp0dist"
set "LAVORO=%~2"
if "%LAVORO%"=="" set "LAVORO=%~dp0build"
set "VPY=%BUILD_PYTHON%"
if "%VPY%"=="" set "VPY=%~dp0.venv\Scripts\python.exe"

if not exist "%VPY%" (
    echo Ambiente Python non trovato: lanciare prima Installa.bat oppure impostare BUILD_PYTHON.
    goto errore
)

REM PyInstaller serve solo per costruire l'exe: si installa nel .venv alla prima build
"%VPY%" -m PyInstaller --version >nul 2>&1
if errorlevel 1 (
    echo Installazione di PyInstaller...
    "%VPY%" -m pip install -q --disable-pip-version-check pyinstaller
    if errorlevel 1 goto errore
)

echo [1/2] Costruzione di ConfrontaPDF.exe in "%USCITA%"...
"%VPY%" -m PyInstaller --noconfirm --distpath "%USCITA%" --workpath "%LAVORO%" ConfrontaPDF.spec
if errorlevel 1 goto errore

echo [2/2] Copia del motore della firma digitale in "%USCITA%\shared\firma"...
call "%~dp0..\shared\firma\copia-motore.bat" "%USCITA%\shared\firma"
if errorlevel 1 goto errore

echo.
echo Fatto. Da distribuire: la cartella "%USCITA%" intera (ConfrontaPDF.exe e shared\firma).
echo Sul PC di destinazione, per i .p7m: shared\firma\installa.bat (o lo fa da solo il programma alla prima busta).
if "%~1"=="" pause
exit /b 0

:errore
echo.
echo Build NON riuscita: vedere i messaggi sopra.
if "%~1"=="" pause
exit /b 1
