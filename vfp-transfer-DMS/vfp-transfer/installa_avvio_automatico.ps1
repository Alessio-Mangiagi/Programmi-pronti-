# "><(((º> sabusabu <º)))><"
# Installa il programma come operazione pianificata di Windows, cosi' resta sempre attivo:
#  - parte all'accesso dell'utente, senza finestre (pythonw);
#  - ogni 5 minuti Windows controlla che sia in esecuzione e, se si e' chiuso, lo riavvia;
#  - se termina con un errore viene riavviato dopo 1 minuto.
# Uso: tasto destro > "Esegui con PowerShell" (oppure: powershell -ExecutionPolicy Bypass -File installa_avvio_automatico.ps1)
# Per rimuoverlo: rimuovi_avvio_automatico.ps1

$ErrorActionPreference = "Stop"
$TaskName = "Cosedil - Trasferimento VFP"
$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path

# pythonw = Python senza finestra; si preferisce quello dell'ambiente virtuale del progetto
$Pythonw = Join-Path $Dir ".venv\Scripts\pythonw.exe"
if (-not (Test-Path $Pythonw)) {
    $py = Get-Command pythonw.exe -ErrorAction SilentlyContinue
    if (-not $py) {
        Write-Host "Python non trovato. Installarlo da https://www.python.org/downloads/ (spuntare 'Add python.exe to PATH')." -ForegroundColor Red
        Read-Host "Premere Invio per chiudere"
        exit 1
    }
    $Pythonw = $py.Source
}

# librerie necessarie
$Python = $Pythonw -replace "pythonw\.exe$", "python.exe"
& $Python -c "import requests" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installazione delle librerie necessarie..."
    & $Python -m pip install -r (Join-Path $Dir "requirements.txt")
}

if (-not (Test-Path (Join-Path $Dir ".env"))) {
    Write-Host "Attenzione: il file .env non esiste ancora. Compilare le Impostazioni dall'interfaccia (http://127.0.0.1:8770)." -ForegroundColor Yellow
}

$Action = New-ScheduledTaskAction -Execute $Pythonw -Argument "`"$(Join-Path $Dir 'vfp_gui.py')`" --service" -WorkingDirectory $Dir
$AtLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
# controllo ogni 5 minuti: se il programma e' gia' attivo Windows non fa nulla (IgnoreNew)
$Watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$Principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($AtLogon, $Watchdog) -Settings $Settings -Principal $Principal `
    -Description "Interfaccia e posta automatica per il trasferimento documenti verso Viewpoint For Projects" -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "Avvio automatico installato: '$TaskName'." -ForegroundColor Green
Write-Host "Il programma e' attivo e ripartira' da solo a ogni accesso a Windows."
Write-Host "Interfaccia: http://127.0.0.1:8770   Registro: $Dir\logs\vfp_servizio.log"
Write-Host "Nota: il PC non deve andare in sospensione, altrimenti la posta non viene controllata."
Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:8770/"
Read-Host "Premere Invio per chiudere"
