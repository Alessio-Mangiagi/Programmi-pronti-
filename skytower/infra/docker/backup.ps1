# "><(((º> sabusabu <º)))><"
<#
Backup di SkyTower sul server (Windows), da questa cartella:   .\backup.ps1 [-SoloDatabase]

Scrive in .\backup (o BACKUP_DIR del .env):
  cde-<data>.sql.gz      pg_dump del database (lo stesso che il servizio "backup" fa ogni 24 ore)
  documenti-<data>.tar   contenuto del volume miniodata (documenti e ancore del registro, con le versioni)
  chiavi\CHIAVI-SEGRETE-<data>.tar   chiave master e chiave JWT, in una cartella a parte: senza, i segreti MFA nel
                         DB non si leggono più; insieme al dump permettono di firmare token per chiunque
La cartella backup è leggibile solo dall'utente che lancia lo script e dagli amministratori (ACL, M6) e va
copiata fuori dal server (NAS, backup aziendale), le chiavi in un posto diverso dal dump e cifrate (runbook § 5).
Ripristino: .\ripristina.ps1 -Database <file.sql.gz> [-Documenti <file.tar>] [-Segreti <file.tar>]
#>
param([switch]$SoloDatabase)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$dir = (Select-String -Path .env -Pattern '^BACKUP_DIR=(.*)$' | ForEach-Object { $_.Matches[0].Groups[1].Value }); if (-not $dir) { $dir = '.\backup' }
New-Item -ItemType Directory -Force (Join-Path $dir 'chiavi') | Out-Null
$ts = Get-Date -Format 'yyyyMMdd-HHmm'
$dirAbs = (Resolve-Path $dir).Path
# ACL: niente permessi ereditati, solo chi lancia il backup, SYSTEM e Administrators (M6)
icacls $dirAbs /inheritance:r /grant:r "${env:USERNAME}:(OI)(CI)F" "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null

Write-Host "Database..."
# pg_dump dentro il container db: niente client Postgres da installare sul server
docker compose exec -T db sh -c 'pg_dump -U postgres -d cde --no-owner | gzip' > "$dirAbs\cde-$ts.sql.gz"
if ($SoloDatabase) { Write-Host "Scritto $dirAbs\cde-$ts.sql.gz"; exit 0 }

Write-Host "Documenti (volume miniodata)..."
docker run --rm -v skytower_miniodata:/data:ro -v "${dirAbs}:/backup" alpine tar cf "/backup/documenti-$ts.tar" -C /data .
Write-Host "Chiavi (volume segreti) in $dirAbs\chiavi..."
docker run --rm -v skytower_segreti:/segreti:ro -v "${dirAbs}\chiavi:/backup" alpine tar cf "/backup/CHIAVI-SEGRETE-$ts.tar" -C /segreti .
Get-ChildItem $dirAbs -Recurse -Filter "*-$ts.*" | ForEach-Object { "{0,12:N0} KB  {1}" -f ($_.Length / 1KB), $_.FullName.Substring($dirAbs.Length + 1) }
