# "><(((º> sabusabu <º)))><"
<#
Prima installazione di SkyTower sul server aziendale (Windows + Docker Desktop o Docker Engine).
Da PowerShell, in questa cartella:   .\installa.ps1

Cosa fa:
  1. controlla Docker; crea .env da .env.esempio con i segreti generati a caso (una volta sola);
  2. chiede nome del server / dominio della suite e scrive gli URL pubblici (web, API, S3) nel .env;
  3. prende il token di servizio della suite da ..\..\..\shared\suite\.token (o lo crea lì);
  4. costruisce le immagini e avvia database, MinIO (bucket con Object Lock) e antivirus;
  5. chiede le password del primo amministratore e dell'account personale (a video, nascoste: non
     finiscono in nessun file) e lancia prepara_db.py (ruoli, migrazioni, organizzazione, account);
  6. avvia API, worker, web e backup; fa lo smoke test (infra/smoke.py) se c'è Python sul server.
Rilanciarlo è innocuo: non rigenera i segreti già scritti e non tocca i dati.
#>
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Segreto([int]$n = 32) {
    # Base64url senza caratteri che danno fastidio a .env e agli URL
    $b = New-Object byte[] $n; [System.Security.Cryptography.RandomNumberGenerator]::Fill($b)
    ([Convert]::ToBase64String($b) -replace '[+/=]', '').Substring(0, [Math]::Min(40, $n + 8))
}
function LeggiEnv([string]$chiave) {
    $r = Select-String -Path .env -Pattern "^$chiave=(.*)$" | Select-Object -First 1
    if ($r) { $r.Matches[0].Groups[1].Value.Trim() } else { "" }
}
function ScriviEnv([string]$chiave, [string]$valore) {
    $righe = Get-Content .env
    if ($righe -match "^$chiave=") { $righe = $righe -replace "^$chiave=.*$", "$chiave=$valore" }
    else { $righe += "$chiave=$valore" }
    Set-Content .env $righe -Encoding utf8
}
function PasswordNascosta([string]$testo) {
    $s = Read-Host -AsSecureString $testo
    [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

# ---- 1. Docker e .env ------------------------------------------------------------------------------
docker version | Out-Null
if (-not (Test-Path .env)) {
    Copy-Item .env.esempio .env
    foreach ($k in 'POSTGRES_PASSWORD', 'DB_PWD_OWNER', 'DB_PWD_APP', 'DB_PWD_AUTH', 'DB_PWD_WORKER', 'MINIO_ROOT_PASSWORD', 'S3_SEGRETO') {
        ScriviEnv $k (Segreto)
    }
    Write-Host "Creato .env con i segreti generati (non condividerlo, non metterlo in git)."
}
New-Item -ItemType Directory -Force backup, certs | Out-Null

# ---- 2. Come lo raggiungono i colleghi ---------------------------------------------------------------
$host0 = LeggiEnv 'SKYTOWER_HOST'; $dom0 = LeggiEnv 'SUITE_DOMINIO'
$hostSrv = Read-Host "Nome o IP del server visto dai PC dei colleghi [$host0]"; if (-not $hostSrv) { $hostSrv = $host0 }
$dominio = Read-Host "Dominio della suite dietro Caddy (vuoto = HTTP diretto in LAN) [$dom0]"; if (-not $dominio) { $dominio = $dom0 }
ScriviEnv 'SKYTOWER_HOST' $hostSrv
ScriviEnv 'SUITE_DOMINIO' $dominio
$webPorta = LeggiEnv 'WEB_PORTA'; if (-not $webPorta) { $webPorta = '5195' }
$s3Porta = LeggiEnv 'S3_PORTA'; if (-not $s3Porta) { $s3Porta = '9100' }
if ($dominio) {
    # Dietro il Caddy della suite: HTTPS con CA interna; l'API deve fidarsi del suo certificato radice
    ScriviEnv 'WEB_ORIGIN' "https://skytower.$dominio"
    ScriviEnv 'S3_ENDPOINT_PUBBLICO' "https://s3-skytower.$dominio"
    ScriviEnv 'COOKIE_SECURE' 'true'
    ScriviEnv 'SKYTOWER_HOST_PUBBLICO' "skytower.$dominio"
    ScriviEnv 'S3_HOST_PUBBLICO' "s3-skytower.$dominio"
    $ca = Get-ChildItem "$env:APPDATA\Caddy\pki\authorities\local\root.crt", "$env:ProgramData\Caddy\pki\authorities\local\root.crt" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($ca) { Copy-Item $ca.FullName certs\root.crt -Force; ScriviEnv 'AWS_CA_BUNDLE' '/certs/root.crt'; Write-Host "Certificato radice di Caddy copiato in certs\root.crt" }
    else { Write-Warning "Non trovo root.crt del Caddy della suite: copialo in certs\root.crt e imposta AWS_CA_BUNDLE=/certs/root.crt nel .env" }
    Write-Host "Ricorda nel Caddyfile della suite:  s3-skytower.$dominio { import suite; reverse_proxy 127.0.0.1:$s3Porta }"
} else {
    ScriviEnv 'WEB_ORIGIN' "http://${hostSrv}:$webPorta"
    ScriviEnv 'S3_ENDPOINT_PUBBLICO' "http://${hostSrv}:$s3Porta"
    ScriviEnv 'COOKIE_SECURE' 'false'
    ScriviEnv 'SKYTOWER_HOST_PUBBLICO' 'skytower.localhost'
    ScriviEnv 'S3_HOST_PUBBLICO' 's3-skytower.localhost'
    ScriviEnv 'AWS_CA_BUNDLE' '/etc/ssl/certs/ca-certificates.crt'
}

# ---- 3. Token di servizio della suite -----------------------------------------------------------------
$tokenFile = Join-Path $PSScriptRoot '..\..\..\shared\suite\.token'
if (-not (LeggiEnv 'SUITE_TOKEN')) {
    if (Test-Path $tokenFile) { $tok = (Get-Content $tokenFile -Raw).Trim() }
    else { $tok = Segreto 32; Set-Content $tokenFile $tok -Encoding ascii; Write-Host "Token di servizio creato in shared\suite\.token" }
    ScriviEnv 'SUITE_TOKEN' $tok
}

# ---- 4. Immagini e servizi di base -----------------------------------------------------------------------
docker compose build
docker compose up -d db minio minio-init clamav
docker compose wait minio-init | Out-Null

# ---- 5. Database, organizzazione, account --------------------------------------------------------------------
$adminEmail = LeggiEnv 'ADMIN_EMAIL'
$env:CDE_NUOVA_PWD = PasswordNascosta "Password del primo amministratore ($adminEmail; vuota = non crearlo ora)"
$personale = LeggiEnv 'ACCOUNT_PERSONALE_EMAIL'
if ($personale) { $env:CDE_PWD_PERSONALE = PasswordNascosta "Password dell'account personale $personale (vuota = non crearlo ora)" }
try {
    docker compose --profile strumenti run --rm prepara
} finally {
    Remove-Item Env:CDE_NUOVA_PWD, Env:CDE_PWD_PERSONALE -ErrorAction SilentlyContinue
}

# ---- 6. Tutto su, smoke test ------------------------------------------------------------------------------------
docker compose up -d
Write-Host "Attendo l'API..."
docker compose wait 2>$null | Out-Null   # torna subito: i servizi restano su; il controllo vero è sotto
$web = LeggiEnv 'WEB_ORIGIN'
$ok = $false
for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
    try { $ok = (Invoke-WebRequest -Uri "http://127.0.0.1:$webPorta/api/health" -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch { Start-Sleep -Seconds 3 }
}
if (-not $ok) { Write-Warning "L'API non risponde ancora: docker compose logs api"; exit 1 }
$py = Get-Command python -ErrorAction SilentlyContinue
if ($py) {
    $env:CDE_SMOKE_PASSWORD = ''
    & $py.Source (Join-Path $PSScriptRoot '..\smoke.py') --api "http://127.0.0.1:$webPorta/api"
} else { Write-Host "Python non trovato sul server: smoke test saltato (health OK)." }
Write-Host ""
Write-Host "SkyTower pronto: $web   (API per le altre app: http://127.0.0.1:$(LeggiEnv 'API_PORTA')/health)"
Write-Host "Portale: nel registro APPS di portale/server.js la voce skytower resta sulla 5195; con il container"
Write-Host "acceso il portale la vede 'accesa' e non lancia avvia.vbs. Vedi README § Rilascio sul server aziendale."
