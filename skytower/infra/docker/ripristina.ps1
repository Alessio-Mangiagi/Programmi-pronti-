# "><(((º> sabusabu <º)))><"
<#
Ripristino di SkyTower da un backup (Windows), da questa cartella:
    .\ripristina.ps1 -Database .\backup\cde-20261103-0300.sql.gz [-Documenti .\backup\documenti-....tar] [-Segreti .\backup\segreti-....tar]

ATTENZIONE: sostituisce il database (e, se indicati, documenti e chiavi) con il contenuto del backup.
Ferma API e worker, ricrea il database `cde` dal dump, rimette i file nel volume miniodata e le chiavi
nel volume segreti, poi riavvia tutto. Database e documenti devono venire dallo STESSO momento, o i
documenti registrati nel DB non si troveranno su S3 (e viceversa): usare i file con la stessa data.
#>
param(
    [Parameter(Mandatory = $true)][string]$Database,
    [string]$Documenti = "",
    [string]$Segreti = ""
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
foreach ($f in @($Database, $Documenti, $Segreti)) { if ($f -and -not (Test-Path $f)) { throw "File non trovato: $f" } }
$conferma = Read-Host "Sostituisco il database$(if ($Documenti) {', i documenti'})$(if ($Segreti) {', le chiavi'}) con il backup. Scrivi SI per continuare"
if ($conferma -ne 'SI') { exit 1 }

Write-Host "Fermo api e worker (web e db restano su)..."
docker compose stop api worker backup

Write-Host "Database dal dump..."
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS cde WITH (FORCE)" -c "CREATE DATABASE cde OWNER cde_owner" | Out-Null
Get-Content -Raw -Encoding Byte $Database | docker compose exec -T db sh -c 'gunzip | psql -U postgres -d cde -q -v ON_ERROR_STOP=1' | Out-Null
# Le tabelle vanno di cde_owner (il dump è --no-owner e lo carica postgres): rimetto il proprietario
docker compose exec -T db psql -U postgres -d cde -v ON_ERROR_STOP=1 -c "REASSIGN OWNED BY postgres TO cde_owner" | Out-Null

if ($Documenti) {
    Write-Host "Documenti nel volume miniodata..."
    docker compose stop minio
    $abs = (Resolve-Path $Documenti).Path
    docker run --rm -v skytower_miniodata:/data -v "${abs}:/backup.tar:ro" alpine sh -c 'rm -rf /data/* /data/.minio.sys && tar xf /backup.tar -C /data'
    docker compose start minio
}
if ($Segreti) {
    Write-Host "Chiavi nel volume segreti..."
    $abs = (Resolve-Path $Segreti).Path
    docker run --rm -v skytower_segreti:/segreti -v "${abs}:/backup.tar:ro" alpine sh -c 'rm -rf /segreti/* && tar xf /backup.tar -C /segreti && chown -R 10001:10001 /segreti'
}

Write-Host "Riavvio..."
docker compose up -d
Write-Host "Ripristino completato. Controlla con: docker compose logs -f api"
