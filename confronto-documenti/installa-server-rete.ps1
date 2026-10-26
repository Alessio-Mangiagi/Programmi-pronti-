# "><(((º> sabusabu <º)))><"
<#
Installa Confronto Documenti come server della rete d'ufficio su questo PC:
  - attivita' pianificata "Confronto Documenti (rete)" che parte all'avvio di
    Windows (anche senza nessuno collegato) e si riavvia se si ferma;
  - regola del firewall per la porta (solo reti di dominio e private);
  - avvio immediato e indirizzo da dare ai colleghi.

Uso (PowerShell come amministratore, dalla cartella confronto-documenti):
    .\installa-server-rete.ps1                 # porta 5001, senza login
    .\installa-server-rete.ps1 -Porta 8085     # altra porta
    .\installa-server-rete.ps1 -ConLogin       # login del portale Suite Cosedil
    .\installa-server-rete.ps1 -Rimuovi        # toglie attivita' e regola

Prima: Installa.bat (crea .venv con le dipendenze) e Tesseract installato.
#>
[CmdletBinding()]
param(
    [int]$Porta = 5001,
    [switch]$ConLogin,
    [switch]$Rimuovi
)
$ErrorActionPreference = 'Stop'
$nome = 'Confronto Documenti (rete)'
$regola = "Confronto Documenti - porta $Porta"

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw "Serve PowerShell aperto come amministratore." }

if ($Rimuovi) {
    Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $nome -Confirm:$false -ErrorAction SilentlyContinue
    Get-NetFirewallRule -DisplayName 'Confronto Documenti - porta *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host "Server di rete rimosso (attivita' e regola firewall)."
    return
}

$dir = $PSScriptRoot
$cmd = Join-Path $dir 'avvia-server-rete.cmd'
if (-not (Test-Path (Join-Path $dir '.venv\Scripts\python.exe'))) {
    Write-Warning "Manca .venv: esegui prima Installa.bat. Si usera' il python nel PATH."
}
$argomenti = "/c `"`"$cmd`" $Porta $(if ($ConLogin) { 'login' })`""

$azione = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument $argomenti -WorkingDirectory $dir
$avvio = New-ScheduledTaskTrigger -AtStartup
$opzioni = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$utente = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName $nome -Action $azione -Trigger $avvio -Settings $opzioni `
    -Principal $utente -Description 'Server Confronto Documenti per la rete interna' -Force | Out-Null

Get-NetFirewallRule -DisplayName 'Confronto Documenti - porta *' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -DisplayName $regola -Direction Inbound -Protocol TCP -LocalPort $Porta `
    -Action Allow -Profile Domain, Private | Out-Null

Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $nome

$ip = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Select-Object -ExpandProperty IPAddress
Write-Host ""
Write-Host "Server avviato. I colleghi aprono nel browser:" -ForegroundColor Green
Write-Host "  http://$($env:COMPUTERNAME):$Porta"
$ip | ForEach-Object { Write-Host "  http://${_}:$Porta" }
Write-Host ""
Write-Host "Login: $(if ($ConLogin) { 'portale Suite Cosedil' } else { 'nessuno (chiunque nella rete interna)' })"
Write-Host "Log: $dir\logs\server-rete.log  -  Rimozione: .\installa-server-rete.ps1 -Rimuovi"
