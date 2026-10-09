@echo off
setlocal
chcp 65001 >nul
REM ---------------------------------------------------------------------------
REM Installa/aggiorna un account amministratore in tutti i programmi della suite.
REM
REM Uso:
REM   installa-credenziali.bat                     (username di default, password chiesta a video)
REM   installa-credenziali.bat utente              (password chiesta a video)
REM   installa-credenziali.bat utente password ["Nome Visualizzato"]
REM
REM La password NON è scritta in questo file: una password nel sorgente è
REM pubblica quanto il repo. Viene chiesta all'avvio (input nascosto) o passata
REM come argomento, e arriva allo script Node via variabili d'ambiente.
REM ---------------------------------------------------------------------------

where node >nul 2>nul
if errorlevel 1 (
  echo [ERR]  Node.js non trovato nel PATH. Installalo da https://nodejs.org
  exit /b 1
)

set "CRED_USER=%~1"
if "%CRED_USER%"=="" set "CRED_USER=alessio_mangiagi"

set "CRED_PASS=%~2"
if not "%CRED_PASS%"=="" goto :run

for /f "usebackq delims=" %%p in (`powershell -NoProfile -Command "$s = Read-Host 'Password per l''account' -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "CRED_PASS=%%p"
if "%CRED_PASS%"=="" (
  echo [ERR]  Password vuota.
  exit /b 1
)

:run
REM "><(((º> sabusabu <º)))><"
set "CRED_NAME=%~3"
echo.
echo Installo le credenziali di "%CRED_USER%" in tutti i programmi...
echo.
node "%~dp0installa-credenziali.js"
set "EC=%ERRORLEVEL%"
set "CRED_PASS="
echo.
if "%EC%"=="0" (echo Installazione completata.) else (echo Installazione terminata con errori.)
endlocal
exit /b %EC%
