# "><(((º> sabusabu <º)))><"
<#
Aggiornamento di SkyTower sul server (Windows) senza perdere dati: nuovo codice → nuove immagini →
migrazioni → riavvio di API, worker e web. Database (pgdata), documenti (miniodata), chiavi (segreti)
e firme antivirus restano nei volumi. Da questa cartella:   .\aggiorna.ps1

Ordine (stesso del deploy AWS, runbook §2): le migrazioni girano PRIMA del nuovo codice, con il
vecchio ancora in esecuzione, quindi devono restare compatibili (expand → deploy → contract).
Se qualcosa va storto: .\aggiorna.ps1 -Versione <tag precedente> rimette le immagini di prima
(le migrazioni non si annullano da sole: vedi runbook).
#>
param([string]$Versione = "")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not $Versione) {
    # Tag = commit corrente, così "docker images" dice quale versione gira
    try { $Versione = (git -C ../../.. rev-parse --short HEAD).Trim() } catch { $Versione = (Get-Date -Format 'yyyyMMdd-HHmm') }
    $righe = Get-Content .env
    if ($righe -match '^SKYTOWER_VERSIONE=') { $righe = $righe -replace '^SKYTOWER_VERSIONE=.*$', "SKYTOWER_VERSIONE=$Versione" } else { $righe += "SKYTOWER_VERSIONE=$Versione" }
    Set-Content .env $righe -Encoding utf8
    Write-Host "Costruisco le immagini $Versione..."
    docker compose build --pull
} else {
    Write-Host "Torno alla versione $Versione (immagini già presenti)..."
    $righe = Get-Content .env
    $righe = $righe -replace '^SKYTOWER_VERSIONE=.*$', "SKYTOWER_VERSIONE=$Versione"
    Set-Content .env $righe -Encoding utf8
}

Write-Host "Backup del database prima delle migrazioni..."
.\backup.ps1 -SoloDatabase

Write-Host "Migrazioni..."
docker compose --profile strumenti run --rm migrate

Write-Host "Riavvio di api, worker e web..."
docker compose up -d --no-deps api worker web
$webPorta = (Select-String -Path .env -Pattern '^WEB_PORTA=(.*)$' | ForEach-Object { $_.Matches[0].Groups[1].Value }); if (-not $webPorta) { $webPorta = '5195' }
$ok = $false
for ($i = 0; $i -lt 40 -and -not $ok; $i++) {
    try { $ok = (Invoke-WebRequest -Uri "http://127.0.0.1:$webPorta/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { Start-Sleep -Seconds 3 }
}
if ($ok) { Write-Host "Aggiornato alla versione $Versione, API in salute." } else { Write-Warning "L'API non risponde: docker compose logs api"; exit 1 }
docker image prune -f | Out-Null
