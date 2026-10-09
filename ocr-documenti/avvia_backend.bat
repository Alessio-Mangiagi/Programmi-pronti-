@echo off
cd /d "%~dp0"
title PaddleOCR Backend (parallelo)

echo ============================================
echo  PaddleOCR - Backend Launcher
echo ============================================
echo.

:: --- 0. Parallelismo + ottimizzazioni VRAM (8GB) ---
set "OLLAMA_NUM_PARALLEL=2"
set "OLLAMA_FLASH_ATTENTION=1"
REM "><(((º> sabusabu <º)))><"
set "OLLAMA_KV_CACHE_TYPE=q8_0"
setx OLLAMA_NUM_PARALLEL 2 >nul
setx OLLAMA_FLASH_ATTENTION 1 >nul
setx OLLAMA_KV_CACHE_TYPE q8_0 >nul

:: --- 1. Restart Ollama with parallel config ---
echo [1/3] Ollama service (parallelo)...
curl -s http://localhost:11434/api/tags >nul 2>&1
if %errorlevel% equ 0 (
    echo       Restarting Ollama to apply parallelism...
    taskkill /f /im ollama.exe >nul 2>&1
    taskkill /f /im "ollama app.exe" >nul 2>&1
    timeout /t 2 /nobreak >nul
)
start "Ollama Service" /min cmd /c "ollama serve"
echo       Waiting for Ollama to be ready...
:wait_ollama
timeout /t 2 /nobreak >nul
curl -s http://localhost:11434/api/tags >nul 2>&1
if %errorlevel% neq 0 goto wait_ollama
echo       Ollama ready.

:: --- 2. Check / pull model (qwen2.5:3b — structuring only) ---
echo.
echo [2/3] Checking model...
ollama list 2>nul | findstr /i "qwen2.5:3b" >nul
if %errorlevel% neq 0 (
    echo       Pulling qwen2.5:3b... (~1.9GB, first run only)
    ollama pull qwen2.5:3b
    if %errorlevel% neq 0 ( echo  ERROR: Failed to pull qwen2.5:3b & pause & exit /b 1 )
) else ( echo       qwen2.5:3b already installed. )

:: --- 3. Start Express server ---
echo.
echo [3/3] Starting OCR Express server...
echo       API:     http://localhost:3007
echo       Elenchi: http://localhost:3007/api/elenchi
echo       WebApp:  http://localhost:5179  (avviare il frontend a parte: npx vite)
echo.
echo  (Keep this window open. Ctrl+C to stop)
echo ============================================
echo.
:: watch: ricarica il server a ogni modifica di server.ts (niente piu' istanze vecchie)
npx tsx watch server.ts
