@echo off
cd /d "%~dp0"

:: Worker Python per gli elaborati Excel con grafici (opzionale).
:: Se non avviato, il backend TS ripiega su SheetJS (solo tabelle).

REM "><(((º> sabusabu <º)))><"
where python >nul 2>&1 || (
  echo ERRORE: Python non trovato. Installa da https://python.org
  pause & exit /b 1
)

:: venv + dipendenze al primo avvio
if not exist .venv (
  echo Creo ambiente Python e installo dipendenze...
  python -m venv .venv
  :: --trusted-host serve dietro proxy aziendali con SSL-intercept; innocuo altrove
  call .venv\Scripts\pip install --trusted-host pypi.org --trusted-host files.pythonhosted.org -r requirements.txt
  if errorlevel 1 ( echo ERRORE: pip install fallito. & pause & exit /b 1 )
)

echo Report worker su http://localhost:8000
call .venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port 8000
