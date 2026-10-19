@echo off
rem "><(((º> sabusabu <º)))><"
rem Avvia l'interfaccia grafica del trasferimento verso Viewpoint For Projects.
rem Doppio clic su questo file: si apre il browser. Per chiudere, chiudere questa finestra.
rem Se il programma e' gia' attivo apre solo la pagina; se quello attivo e' una versione vecchia
rem e non sta caricando nulla, lo sostituisce con quella aggiornata.
chcp 65001 >nul
title Trasferimento VFP
cd /d "%~dp0"

rem Python: prima l'ambiente del progetto, poi "python", poi il lanciatore "py".
rem Si prova davvero a eseguirlo: su Windows "python" puo' essere solo un collegamento al Microsoft Store.
set "PY="
if exist ".venv\Scripts\python.exe" set "PY=.venv\Scripts\python.exe"
if not defined PY (python -c "import sys" >nul 2>nul && set "PY=python")
if not defined PY (py -3 -c "import sys" >nul 2>nul && set "PY=py -3")
if not defined PY (
    echo Python non e' installato su questo PC.
    echo Installarlo da https://www.python.org/downloads/ spuntando "Add python.exe to PATH", poi riprovare.
    pause
    exit /b 1
)

%PY% -c "import requests" >nul 2>nul || (
    echo Installazione delle librerie necessarie, solo la prima volta...
    %PY% -m pip install -r requirements.txt || (
        echo Installazione non riuscita: controllare la connessione a Internet o contattare l'ufficio IT.
        pause
        exit /b 1
    )
)

%PY% vfp_gui.py
if errorlevel 1 (
    echo.
    echo Il programma si e' chiuso con un errore. Dettagli nel file logs\vfp_servizio.log
    pause
)
