@echo off
REM "><(((º> sabusabu <º)))><"
REM OnlyOffice Docs locale (ADR-37) per la modifica in piattaforma di Word/Excel/PowerPoint.
REM Chiamato da avvia.bat: se Docker c'e', avvia il Document Server (container
REM skytower-onlyoffice, porta 8085) e imposta le variabili CDE_ONLYOFFICE_* per l'API.
REM Senza Docker non fa nulla: la funzione resta spenta, il resto parte uguale.
REM Il segreto condiviso nasce al primo avvio in .devdata\onlyoffice.secret (mai nel repo).
REM Primo avvio: scarica l'immagine (circa 1 GB) e il server impiega 1-2 minuti a partire.

where docker >nul 2>nul || exit /b 0
docker info >nul 2>nul
if errorlevel 1 (
    echo OnlyOffice: Docker installato ma non attivo ^(aprire Docker Desktop^), modifica in piattaforma spenta.
    exit /b 0
)
set "OO_DIR=%~dp0.devdata"
set "OO_SECRET_FILE=%OO_DIR%\onlyoffice.secret"
if not exist "%OO_DIR%" mkdir "%OO_DIR%"
if not exist "%OO_SECRET_FILE%" (
    powershell -NoProfile -Command "$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [IO.File]::WriteAllText('%OO_SECRET_FILE%', -join ($b | ForEach-Object { $_.ToString('x2') }))"
)
set /p OO_SECRET=<"%OO_SECRET_FILE%"

docker container inspect skytower-onlyoffice >nul 2>nul
if errorlevel 1 (
    echo OnlyOffice: creo il Document Server ^(primo avvio, scarica l'immagine^) ...
    REM ALLOW_PRIVATE_IP_ADDRESS: i file si scaricano dall'API sul PC ^(host.docker.internal^)
    docker run -d --name skytower-onlyoffice -p 127.0.0.1:8085:80 --restart unless-stopped ^
        -e JWT_ENABLED=true -e JWT_SECRET=%OO_SECRET% -e ALLOW_PRIVATE_IP_ADDRESS=true ^
        onlyoffice/documentserver >nul
    if errorlevel 1 (
        echo OnlyOffice: avvio del Document Server non riuscito, modifica in piattaforma spenta.
        exit /b 0
    )
) else (
    docker start skytower-onlyoffice >nul
)
REM il browser apre l'editor da 127.0.0.1:8085; il Document Server raggiunge l'API sul PC
set "CDE_ONLYOFFICE_URL=http://127.0.0.1:8085"
set "CDE_ONLYOFFICE_JWT_SECRET=%OO_SECRET%"
set "CDE_ONLYOFFICE_CALLBACK_URL=http://host.docker.internal:8100"
set "OO_SECRET="
echo OnlyOffice: Document Server su http://127.0.0.1:8085
exit /b 0
