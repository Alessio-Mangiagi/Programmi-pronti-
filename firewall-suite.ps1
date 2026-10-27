# "><(((º> sabusabu <º)))><"
# firewall-suite.ps1 - Apre nel firewall di Windows le porte della Suite Cosedil,
# SOLO verso la rete interna. Da eseguire UNA volta sul server che ospita la suite.
#
#   Tasto destro > Esegui con PowerShell        (chiede i permessi di amministratore)
#   powershell -ExecutionPolicy Bypass -File firewall-suite.ps1
#   ... -Rete 192.168.1.0/24                    (limita a una sottorete precisa)
#   ... -ReteAdmin 192.168.1.50                 (plancia admin solo da quel PC)
#   ... -Rimuovi                                (toglie tutte le regole della suite)
#
# Default "LocalSubnet": la sottorete della scheda di rete del server, senza
# doverla conoscere. Profili Dominio e Privato: su una rete "Pubblica" (un hotspot,
# un Wi-Fi sconosciuto) le porte restano chiuse.
#
# Rieseguibile: prima toglie le regole del gruppo "Suite Cosedil", poi le ricrea.
# Le porte sono quelle del registro APPS in portale/server.js: se ne cambia una,
# va cambiata anche qui.
#
# NOTA per chi edita: file ASCII (a parte la firma). PowerShell 5.1 legge gli
# script senza BOM come ANSI, e gli accenti diventerebbero caratteri strani.

param(
    [string]$Rete = 'LocalSubnet',
    [string]$ReteAdmin = '',
    [switch]$Rimuovi
)

$ErrorActionPreference = 'Stop'
$Gruppo = 'Suite Cosedil'

# Senza diritti di amministratore il firewall non si tocca: si rilancia elevato.
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    $argomenti = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Rete', $Rete)
    if ($ReteAdmin) { $argomenti += @('-ReteAdmin', $ReteAdmin) }
    if ($Rimuovi) { $argomenti += '-Rimuovi' }
    Start-Process powershell.exe -Verb RunAs -ArgumentList $argomenti
    exit
}

$porte = @(
    @{ Nome = 'Portale';             Porta = 8080 },
    @{ Nome = 'Plancia admin';       Porta = 8090; Admin = $true },
    @{ Nome = 'Lettore DDT';         Porta = 5050 },
    @{ Nome = 'Analista Dati';       Porta = 5173 },
    @{ Nome = 'Confronto Documenti'; Porta = 5001 },
    @{ Nome = 'OCR Documenti';       Porta = 5179 },
    @{ Nome = 'Scadenzario';         Porta = 5180 },
    @{ Nome = 'Verifica Requisiti';  Porta = 5185 },
    @{ Nome = 'InCampo';             Porta = 5190 },
    @{ Nome = 'SkyTower';            Porta = 5195 },
    @{ Nome = 'Ponte Trimble';       Porta = 3011 },
    @{ Nome = 'Auguri';              Porta = 3000 }
)

$vecchie = Get-NetFirewallRule -Group $Gruppo -ErrorAction SilentlyContinue
if ($vecchie) {
    $vecchie | Remove-NetFirewallRule
    Write-Host "Tolte $(@($vecchie).Count) regole precedenti del gruppo '$Gruppo'."
}
if ($Rimuovi) {
    Write-Host 'Porte della suite chiuse.'
    Read-Host 'Invio per chiudere'
    exit
}

foreach ($p in $porte) {
    # La plancia admin puo' avere una rete sua (es. solo i PC degli admin).
    $da = if ($p.Admin -and $ReteAdmin) { $ReteAdmin } else { $Rete }
    New-NetFirewallRule `
        -DisplayName "Suite Cosedil - $($p.Nome) ($($p.Porta))" `
        -Group $Gruppo `
        -Direction Inbound -Action Allow -Protocol TCP `
        -LocalPort $p.Porta `
        -RemoteAddress $da `
        -Profile Domain, Private | Out-Null
    Write-Host ("  aperta {0,-5} {1,-20} da {2}" -f $p.Porta, $p.Nome, $da)
}

Write-Host ''
Write-Host "Fatto: $($porte.Count) porte aperte solo verso '$Rete'."
Write-Host 'Ricorda: il portale va avviato con HOST=0.0.0.0 per farsi raggiungere dalla rete.'
Read-Host 'Invio per chiudere'
