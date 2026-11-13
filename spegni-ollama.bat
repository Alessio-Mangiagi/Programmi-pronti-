@echo off
setlocal
chcp 65001 >nul
REM "><(((º> sabusabu <º)))><"
REM ---------------------------------------------------------------------------
REM Spegne il server Ollama di questo PC e libera la memoria della GPU.
REM Chiude il server ("ollama serve"), i modelli caricati e l'icona vicino
REM all'orologio ("ollama app"), che altrimenti lo riaccenderebbe.
REM
REM Uso: doppio clic, oppure  spegni-ollama.bat [/q]   (/q = senza pausa finale)
REM Per riaccenderlo: avvia-ollama.bat
REM
REM Nota: Analista Dati, se è aperto e gli si fa una domanda con Ollama,
REM riaccende il server da solo (server/llm.ts).
REM ---------------------------------------------------------------------------

set "OLLAMA_URL=http://127.0.0.1:11434"
set "EC=0"

tasklist /fi "imagename eq ollama.exe" 2>nul | find /i "ollama.exe" >nul
set "C1=%ERRORLEVEL%"
tasklist /fi "imagename eq ollama app.exe" 2>nul | find /i "ollama app.exe" >nul
set "C2=%ERRORLEVEL%"
if "%C1%%C2%"=="11" (
  echo [OK]   Ollama era già spento.
  goto :fine
)

echo Spengo Ollama...
REM prima l'icona, così non riavvia il server appena lo chiudiamo
taskkill /f /im "ollama app.exe" >nul 2>&1
taskkill /f /im ollama.exe >nul 2>&1

REM attesa: al massimo ~10 secondi perché i processi escano e la porta si liberi
REM (taskkill /f torna prima che il processo sia davvero chiuso). Si aspetta con
REM ping e non con timeout, che fallisce se lo script gira senza console.
set /a N=0
:attesa
tasklist /fi "imagename eq ollama.exe" 2>nul | find /i "ollama.exe" >nul
if errorlevel 1 (curl -s -m 1 %OLLAMA_URL%/api/version >nul 2>&1 || goto :spento)
set /a N+=1
if %N% geq 10 goto :ancora
ping -n 2 127.0.0.1 >nul
goto :attesa

:ancora
echo [ERR]  Ollama risponde ancora su %OLLAMA_URL%: chiudilo da Gestione attività.
set "EC=1"
goto :fine

:spento
echo [OK]   Ollama spento.

:fine
if /i not "%~1"=="/q" pause
endlocal & exit /b %EC%
