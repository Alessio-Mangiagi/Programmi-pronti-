@echo off
REM "><(((º> sabusabu <º)))><"
REM Avvia SkyTower da questa cartella con il codice corrente: frontend ricompilato,
REM migrazioni nuove applicate, dati demo (cartelle, tavole, modelli BIM), poi Firefox.
REM Database e file restano tra un avvio e l'altro (.devdata): si ricrea tutto solo
REM la prima volta, o con SKYTOWER_RESET=1.
REM Account personale: password da CDE_NUOVA_PWD se impostata, altrimenti chiesta qui
REM (nascosta) e controllata subito; INVIO vuoto lascia l'account com'e'.
REM La password non viene mai scritta su file.
REM Per fermare: chiudere la finestra o CTRL+C.
if "%~1"==":dopo" goto dopo

title SkyTower - avvio con dati demo
set "SKYTOWER=%~dp0..\skytower"
set "CDE=%SKYTOWER%\.venv\Scripts\cde.exe"
set "MIO_ACCOUNT=a.mangiagi@nexora.srl"
if not exist "%SKYTOWER%\avvia.bat" (
    echo ERRORE: non trovo "%SKYTOWER%\avvia.bat".
    pause
    exit /b 1
)

:chiedi
if defined CDE_NUOVA_PWD goto verifica
echo.
echo Password del tuo account %MIO_ACCOUNT%
echo   - i caratteri non si vedono mentre scrivi
echo   - INVIO vuoto: account e password restano quelli dell'ultima volta
for /f "usebackq eol= delims=" %%P in (`powershell -NoProfile -Command "$s = Read-Host 'Password' -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "CDE_NUOVA_PWD=%%P"
if not defined CDE_NUOVA_PWD (
    echo Nessuna password nuova: account invariato.
    goto avvio
)
:verifica
"%CDE%" utente-dev --email %MIO_ACCOUNT% --solo-verifica
if errorlevel 1 (
    set "CDE_NUOVA_PWD="
    echo Riprova.
    goto chiedi
)

:avvio
REM istanza precedente: chiusa subito, cosi' l'attesa qui sotto non la scambia per quella nuova
call "%~dp0..\shared\avvia\libera-porta.bat" 5195 8100 9100
REM prima volta, o dati della versione con S3 solo in memoria: si riparte puliti
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
echo.
echo ============================================================
set "ESITO=account %MIO_ACCOUNT% invariato"
if defined SKYTOWER_RESET set "ESITO=database nuovo: solo utenti demo, rilancia e scrivi la tua password"
if defined CDE_NUOVA_PWD (
    "%CDE%" utente-dev --email %MIO_ACCOUNT% --nome Alessio --cognome Mangiagi --org COM
    if errorlevel 1 (
        set "ESITO=ERRORE: account %MIO_ACCOUNT% NON creato, vedi sopra"
    ) else (
        set "ESITO=accedi con %MIO_ACCOUNT% e la tua password"
    )
)
echo  SkyTower pronto su http://127.0.0.1:5195
echo  %ESITO%
echo  utenti demo, password Cantiere-2026! - es. com.admin@com.example
echo ============================================================
set "FF=C:\Program Files\Mozilla Firefox\firefox.exe"
if exist "%FF%" (
    start "" "%FF%" http://127.0.0.1:5195/login
) else (
    start "" http://127.0.0.1:5195/login
)
exit /b 0
