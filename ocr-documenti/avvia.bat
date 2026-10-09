@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title OCR Documenti (parallelo)

echo ============================================================
echo  OCR Documenti — Configurazione automatica
echo ============================================================
echo.

:: ── 1. Node.js ──────────────────────────────────────────────
node -v >nul 2>&1
if not errorlevel 1 goto node_ok
echo  [SETUP] Node.js non trovato — installazione in corso...
winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
call :refresh_path
node -v >nul 2>&1
if errorlevel 1 (
    echo  [ERRORE] Installa Node.js manualmente: https://nodejs.org  poi riavvia.
    pause & exit /b 1
)
:node_ok
for /f %%v in ('node -v') do echo  [OK] Node.js %%v

:: ── 2. Ollama ───────────────────────────────────────────────
ollama --version >nul 2>&1
if not errorlevel 1 goto ollama_ok
echo  [SETUP] Ollama non trovato — installazione in corso...
winget install -e --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements
call :refresh_path
timeout /t 4 /nobreak >nul
ollama --version >nul 2>&1
if errorlevel 1 (
    echo  [ERRORE] Installa Ollama manualmente: https://ollama.ai  poi riavvia.
    pause & exit /b 1
)
:ollama_ok
echo  [OK] Ollama trovato

:: ── 3. Parallelismo + ottimizzazioni VRAM (8GB) ─────────────
:: Structuring solo testo con qwen2.5:3b (~1.9GB): NUM_PARALLEL=2 struttura 2 richieste insieme.
:: FLASH_ATTENTION + KV q8_0 riducono la VRAM della cache -> stanno in 8GB.
:: setx = persistente; set = sessione corrente (così l'ollama serve qui sotto le eredita).
echo  [INFO] Configuro parallelismo Ollama (NUM_PARALLEL=2, flash attn, KV q8)...
setx OLLAMA_NUM_PARALLEL 2 >nul
setx OLLAMA_FLASH_ATTENTION 1 >nul
setx OLLAMA_KV_CACHE_TYPE q8_0 >nul
set "OLLAMA_NUM_PARALLEL=2"
set "OLLAMA_FLASH_ATTENTION=1"
set "OLLAMA_KV_CACHE_TYPE=q8_0"

:: ── 3b. PaddleOCR (motore OCR immagine -> testo, worker Python) ──
:: Con GPU NVIDIA: venv dedicato .venv-gpu con paddlepaddle-gpu (misurato su pagina
:: reale: 0,65s/pagina contro i ~63s della CPU, stessa identica qualita').
:: Il server preferisce .venv-gpu se esiste, altrimenti usa .venv (CPU).
nvidia-smi >nul 2>&1
if errorlevel 1 goto venv_cpu
if exist ".venv-gpu\Scripts\python.exe" goto venv_gpu_ok
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERRORE] Python non trovato. Installalo da https://www.python.org (>= 3.10^) e riavvia.
    pause & exit /b 1
)
echo  [SETUP] GPU NVIDIA rilevata: creo .venv-gpu con PaddleOCR GPU (prima volta, ~3GB)...
python -m venv .venv-gpu
.venv-gpu\Scripts\python.exe -m pip install paddlepaddle-gpu==3.3.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/ --trusted-host www.paddlepaddle.org.cn
if errorlevel 1 goto venv_gpu_fallita
.venv-gpu\Scripts\pip install paddleocr==3.7.0 --trusted-host pypi.org --trusted-host files.pythonhosted.org
if errorlevel 1 goto venv_gpu_fallita
:venv_gpu_ok
.venv-gpu\Scripts\python.exe -c "import paddle, paddleocr; assert paddle.device.is_compiled_with_cuda()" >nul 2>&1
if errorlevel 1 goto venv_gpu_fallita
echo  [OK] PaddleOCR GPU pronto: .venv-gpu\Scripts\python.exe
goto paddle_ok
:venv_gpu_fallita
echo  [AVVISO] Setup GPU non riuscito — uso la CPU (piu' lenta). Per ritentare: cancella .venv-gpu e riavvia.
:venv_cpu
if exist ".venv\Scripts\python.exe" goto venv_ok
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERRORE] Python non trovato. Installalo da https://www.python.org (>= 3.10^) e riavvia.
    pause & exit /b 1
)
echo  [SETUP] Creo il venv Python e installo PaddleOCR (solo la prima volta, ~600MB)...
python -m venv .venv
.venv\Scripts\pip install paddlepaddle paddleocr --trusted-host pypi.org --trusted-host files.pythonhosted.org
if errorlevel 1 (
    echo  [ERRORE] Installazione PaddleOCR fallita — controlla la connessione.
    pause & exit /b 1
)
:venv_ok
:: Import di prova: il venv puo' esserci ma non funzionare (installazione a meta',
:: oppure Windows App Control che blocca le DLL non firmate, WinError 4551).
:: NON si esce: il resto del programma (PDF con testo, .docx, elenchi, Alyante)
:: funziona lo stesso, e lanciati nascosti dal portale un exit qui = "non si avvia"
:: senza nessun messaggio. Il motivo preciso lo mostra la pagina (PaddleOCR bloccato).
.venv\Scripts\python.exe -c "import paddle, paddleocr" >nul 2>&1
if errorlevel 1 (
    echo  [AVVISO] PaddleOCR non importabile nel venv: le scansioni non funzioneranno,
    echo           il resto del programma si'. Dettagli: apri la pagina e passa col mouse
    echo           su "PaddleOCR bloccato". Venv rotto? cancella .venv e rilancia.
    echo           DLL bloccata da App Control? serve l'IT, non la reinstallazione.
    goto paddle_ok
)
echo  [OK] PaddleOCR pronto: .venv\Scripts\python.exe
:paddle_ok

:: ── 4. Ollama server ────────────────────────────────────────
:: Per applicare il parallelismo, Ollama deve (ri)partire con queste env.
:: Se gira gia', lo riavvio cosi' carica la nuova configurazione.
curl -s --max-time 2 http://localhost:11434/api/tags >nul 2>&1
if not errorlevel 1 (
    echo  [INFO] Ollama gia' attivo — riavvio per applicare il parallelismo...
    taskkill /f /im ollama.exe >nul 2>&1
    taskkill /f /im "ollama app.exe" >nul 2>&1
    timeout /t 2 /nobreak >nul
)
echo  [INFO] Avvio Ollama server (parallelo)...
start /min "" ollama serve
:wait_ollama
timeout /t 2 /nobreak >nul
curl -s --max-time 2 http://localhost:11434/api/tags >nul 2>&1
if errorlevel 1 goto wait_ollama
echo  [OK] Ollama server attivo

:: ── 5. Modello structuring (qwen2.5:3b — solo testo, l'OCR lo fa Tesseract) ──
ollama list 2>nul | findstr /i "qwen2.5:3b" >nul
if not errorlevel 1 goto model_ok
echo  [SETUP] Download modello qwen2.5:3b (~1.9GB, solo la prima volta)...
ollama pull qwen2.5:3b
if errorlevel 1 (
    echo  [ERRORE] Download qwen2.5:3b fallito — controlla la connessione internet.
    pause & exit /b 1
)
:model_ok
echo  [OK] Modello qwen2.5:3b pronto

:: ── 6. Dipendenze npm ───────────────────────────────────────
if not exist "node_modules" (
    echo  [SETUP] Installazione dipendenze npm...
    npm install
    if errorlevel 1 ( echo  [ERRORE] npm install fallito & pause & exit /b 1 )
) else if not exist "node_modules\mammoth" (
    echo  [SETUP] Pacchetto mammoth mancante — aggiornamento dipendenze...
    npm install
    if errorlevel 1 ( echo  [ERRORE] npm install fallito & pause & exit /b 1 )
) else (
    echo  [OK] Dipendenze node_modules presenti
)

:: ── 7. Avvio ────────────────────────────────────────────────
echo.
echo ============================================================
echo  Il browser si apre da solo su: http://localhost:5179
echo  (se non si apre, aprilo a mano su quell'indirizzo)
echo  Chiudi questa finestra per spegnere il programma.
echo ============================================================
echo.
:: Istanze precedenti rimaste appese su frontend (5179) o backend OCR (3007)?
:: Chiusura forzata, poi avvio pulito (il retry EADDRINUSE del server aiuta
:: solo se la vecchia istanza sta uscendo, non se e' appesa per sempre).
call "%~dp0..\shared\avvia\libera-porta.bat" 5179 3007
:: Produzione: frontend compilato (dist/) servito dal backend sulla 5179, senza il
:: dev server Vite ne' tsx watch (vedi tools/avvio-prod.mjs: ricompila dist/ solo se
:: piu' vecchia dei sorgenti, e se la build fallisce ripiega su npm run dev).
npm run start:prod
goto :eof

:refresh_path
for /f "tokens=*" %%p in ('powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\"PATH\",\"Machine\")+\";\"+ [System.Environment]::GetEnvironmentVariable(\"PATH\",\"User\")"') do set "PATH=%%p"
exit /b
