param([switch]$Remove)

# Crea (o rimuove) un'Attivita' pianificata di Windows che tiene il programma
# SEMPRE ATTIVO: parte a ogni accesso e poi il guardiano ricontrolla ogni 5
# minuti, riavviandolo se non e' in ascolto sulla porta 3000 (PC riavviato,
# programma chiuso a mano, Chromium morto). Sostituisce sia il vecchio avvio al
# login sia il singolo avvio giornaliero alle 09:30: l'orario degli auguri lo
# decide il programma (ORARIO_INVIO in config.json), non l'attivita'.

$taskName = 'WhatsApp Auguri Cosedil'

# --- Auto-elevazione: creare/rimuovere attivita' pianificate richiede privilegi admin ---
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$admin = ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
    $psArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $PSCommandPath)
    if ($Remove) { $psArgs += '-Remove' }
    Start-Process powershell -Verb RunAs -ArgumentList $psArgs
    exit
# "><(((º> sabusabu <º)))><"
}

$proj      = $PSScriptRoot
$startup   = [Environment]::GetFolderPath('Startup')
$legacyLnk = Join-Path $startup 'WhatsApp Auguri.lnk'

# --- Disinstallazione ---
if ($Remove) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    if (Test-Path $legacyLnk) { Remove-Item $legacyLnk -Force }
    Write-Host ""
    Write-Host "Avvio automatico RIMOSSO."
    Start-Sleep -Seconds 3
    return
}

# --- Installazione ---
$vbs     = Join-Path $proj 'guardiano.vbs'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

$action = New-ScheduledTaskAction -Execute $wscript -Argument ('"' + $vbs + '"') -WorkingDirectory $proj

# Due inneschi: all'accesso (PC appena acceso) e poi ogni 5 minuti per sempre.
# Il guardiano costa nulla quando il programma e' gia' su: guarda la porta ed esce.
$trigLogon  = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$trigRipeti = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
# Durata vuota = ripeti per sempre. [TimeSpan]::MaxValue no: genera un XML che
# l'Utilita' di pianificazione rifiuta ("P99999999DT23H59M59S" fuori intervallo).
$trigRipeti.Repetition.Duration = ''

$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
# ExecutionTimeLimit 0 = nessun limite; MultipleInstances IgnoreNew = se un
# controllo e' ancora in corso, il successivo non si accavalla.
$settings  = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($trigLogon, $trigRipeti) `
    -Principal $principal -Settings $settings -Force | Out-Null

# Rimuovi il vecchio avvio-al-login per evitare doppio avvio
if (Test-Path $legacyLnk) { Remove-Item $legacyLnk -Force }

Write-Host ""
Write-Host "Avvio automatico INSTALLATO."
Write-Host "Attivita' pianificata: $taskName"
Write-Host "Il programma parte a ogni accesso e resta SEMPRE attivo:"
Write-Host "ogni 5 minuti il guardiano controlla e, se e' caduto, lo riavvia."
Write-Host "L'orario degli auguri si imposta nel programma (ORARIO_INVIO)."
Start-Sleep -Seconds 4
