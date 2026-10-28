@echo off
REM "><(((º> sabusabu <º)))><"
REM Avvia SkyTower da questa cartella con il codice corrente: frontend ricompilato,
REM migrazioni nuove applicate, dati demo (cartelle, tavole, modelli BIM), poi Firefox.
REM Database, file e account restano tra un avvio e l'altro (cartella .devdata).
REM Il tuo account personale entra sempre con la stessa password: cde dev lo salva
REM in .devdata\account-personali.json (solo l'impronta, mai la password) e lo
REM rimette anche dopo un reset. Nessuna password da scrivere qui.
REM Per cambiarla: dall'app (Sicurezza) oppure impostando CDE_NUOVA_PWD prima di lanciare.
REM Per fermare: chiudere la finestra o CTRL+C.
if "%~1"==":dopo" goto dopo

title SkyTower - avvio
set "SKYTOWER=%~dp0..\skytower"
set "CDE=%SKYTOWER%\.venv\Scripts\cde.exe"
set "MIO_ACCOUNT=a.mangiagi@nexora.srl"
if not exist "%SKYTOWER%\avvia.bat" (
    echo ERRORE: non trovo "%SKYTOWER%\avvia.bat".
    pause
    exit /b 1
)
if defined CDE_NUOVA_PWD (
    "%CDE%" utente-dev --email %MIO_ACCOUNT% --solo-verifica
    if errorlevel 1 (
        pause
        exit /b 1
    )
)

REM istanza precedente: chiusa subito, cosi' l'attesa qui sotto non la scambia per quella nuova
call "%~dp0..\shared\avvia\libera-porta.bat" 5195 8100 9100
REM prima volta, o dati della versione con S3 solo in memoria: si riparte puliti
REM (l'account personale si salva prima e si rimette dopo)
if not exist "%SKYTOWER%\.devdata\s3-state.pkl" set "SKYTOWER_RESET=1"
set "PORTALE_APRE_BROWSER=1"
start "" /b cmd /c ""%~f0" :dopo"
call "%SKYTOWER%\avvia.bat"
exit /b

:dopo
REM Attesa dell'API (build del frontend + migrazioni: fino a 3 minuti)
set /a N=0
:attesa
curl -sf -o nul http://127.0.0.1:8100/health && goto pronta
set /a N+=1
if %N% gtr 90 (
    echo ERRORE: l'API non risponde su http://127.0.0.1:8100
    exit /b 1
)
ping -n 3 127.0.0.1 >nul
goto attesa

:pronta
echo.
echo Documenti demo - tavole, relazioni, modelli BIM: carico quelli che mancano ...
"%CDE%" demo-contenuti
if defined CDE_NUOVA_PWD (
    "%CDE%" utente-dev --email %MIO_ACCOUNT% --nome Alessio --cognome Mangiagi --org COM
)
echo.
echo ============================================================
echo  SkyTower pronto su http://127.0.0.1:5195
echo  accedi con %MIO_ACCOUNT% e la tua password di sempre
echo  utenti demo, password Cantiere-2026! - es. com.admin@com.example
echo ============================================================
set "FF=C:\Program Files\Mozilla Firefox\firefox.exe"
if exist "%FF%" (
    start "" "%FF%" http://127.0.0.1:5195/login
) else (
    start "" http://127.0.0.1:5195/login
)
exit /b 0
