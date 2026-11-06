@echo off
REM "><(((º> sabusabu <º)))><"
REM Installa il motore della firma digitale della suite (shared\firma): ambiente Python .venv con le librerie
REM di verifica e primo scaricamento degli elenchi ufficiali degli enti certificatori (serve la rete).
REM Lo chiamano da soli gli avvia.bat dei programmi che aprono i .p7m, solo se .venv manca; si puo' rilanciare
REM a mano senza danni. Uscita 0 = pronto.
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" goto librerie
REM Python 3.12 se c'e' (le librerie hanno le ruote pronte), altrimenti quello di default
py -3.12 -m venv .venv 2>nul || py -3 -m venv .venv 2>nul || python -m venv .venv
if not exist ".venv\Scripts\python.exe" (
    echo Python non trovato: installare Python 3.12 e rilanciare shared\firma\installa.bat
    exit /b 1
)
:librerie
".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r requirements.txt || exit /b 1
REM elenchi: se la rete manca la firma si verifica lo stesso, con esito "da verificare" finche' non si scaricano
".venv\Scripts\python.exe" firma.py aggiorna-elenchi >nul 2>&1
echo Motore della firma digitale pronto.
exit /b 0
