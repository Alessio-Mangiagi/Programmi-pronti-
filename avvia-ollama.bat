@echo off
setlocal
chcp 65001 >nul
REM "><(((º> sabusabu <º)))><"
REM ---------------------------------------------------------------------------
REM Avvia il server Ollama di questo PC in background (senza finestre).
REM Se è già acceso non fa nulla.
REM
REM Uso: doppio clic, oppure  avvia-ollama.bat [/q]   (/q = senza pausa finale)
REM Per spegnerlo: spegni-ollama.bat
REM ---------------------------------------------------------------------------

set "OLLAMA_URL=http://127.0.0.1:11434"
set "EC=0"

curl -s -m 2 %OLLAMA_URL%/api/version >nul 2>&1
if not errorlevel 1 (
  echo [OK]   Ollama è già acceso su %OLLAMA_URL%.
  goto :fine
)

set "OLLAMA_EXE="
for /f "delims=" %%p in ('where ollama 2^>nul') do if not defined OLLAMA_EXE set "OLLAMA_EXE=%%p"
if not defined OLLAMA_EXE if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if not defined OLLAMA_EXE (
  echo [ERR]  Ollama non è installato: winget install Ollama.Ollama
  set "EC=1"
  goto :fine
)

echo Avvio Ollama...
powershell -NoProfile -Command "Start-Process -FilePath $env:OLLAMA_EXE -ArgumentList 'serve' -WindowStyle Hidden"

REM attesa: al massimo ~20 secondi perché risponda (ping e non timeout, che
REM fallisce se lo script gira senza console)
for /l %%i in (1,1,20) do (
  ping -n 2 127.0.0.1 >nul
  curl -s -m 1 %OLLAMA_URL%/api/version >nul 2>&1 && goto :acceso
)
echo [ERR]  Ollama non risponde su %OLLAMA_URL% dopo 20 secondi.
set "EC=1"
goto :fine

:acceso
echo [OK]   Ollama acceso su %OLLAMA_URL%.

:fine
if /i not "%~1"=="/q" pause
endlocal & exit /b %EC%
