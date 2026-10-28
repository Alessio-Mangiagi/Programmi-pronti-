@echo off
REM "><(((º> sabusabu <º)))><"
REM Avvia SkyTower da questa cartella con il codice corrente: frontend ricompilato,
REM database ricreato con i dati demo (cartelle, tavole, modelli BIM), poi Firefox.
REM Si riparte puliti a ogni avvio perche' l'S3 di sviluppo e' in memoria: i file
REM caricati non sopravvivono alla chiusura della finestra.
REM Il database si ricrea, quindi il tuo account personale si ricrea a ogni avvio:
REM password da CDE_NUOVA_PWD se impostata, altrimenti chiesta qui (nascosta).
REM La password non viene mai scritta su file.
REM Per fermare: chiudere la finestra o CTRL+C.
if "%~1"==":dopo" goto dopo

title SkyTower - avvio con dati demo
set "SKYTOWER=%~dp0..\skytower"
set "MIO_ACCOUNT=a.mangiagi@nexora.srl"
if not exist "%SKYTOWER%\avvia.bat" (
    echo ERRORE: non trovo "%SKYTOWER%\avvia.bat".
    pause
    exit /b 1
)
if not defined CDE_NUOVA_PWD (
    echo Password del tuo account %MIO_ACCOUNT% - INVIO vuoto per usare solo gli utenti demo
    for /f "usebackq delims=" %%P in (`powershell -NoProfile -Command "$s = Read-Host 'Password' -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "CDE_NUOVA_PWD=%%P"
)
REM istanza precedente: chiusa subito, cosi' l'attesa qui sotto non la scambia per quella nuova
call "%~dp0..\shared\avvia\libera-porta.bat" 5195 8100 9100
set "SKYTOWER_RESET=1"
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
echo Carico i documenti demo (tavole, relazioni, modelli BIM): circa un minuto ...
"%SKYTOWER%\.venv\Scripts\cde.exe" demo-contenuti
echo.
if defined CDE_NUOVA_PWD (
    "%SKYTOWER%\.venv\Scripts\cde.exe" utente-dev --email %MIO_ACCOUNT% --nome Alessio --cognome Mangiagi --org COM
)
echo.
echo SkyTower pronto su http://127.0.0.1:5195
if defined CDE_NUOVA_PWD echo   accedi con %MIO_ACCOUNT% e la tua password
echo   utenti demo, password Cantiere-2026! - es. com.admin@com.example, des.lead@des.example
set "FF=C:\Program Files\Mozilla Firefox\firefox.exe"
if exist "%FF%" (
    start "" "%FF%" http://127.0.0.1:5195/login
) else (
    start "" http://127.0.0.1:5195/login
)
exit /b 0
