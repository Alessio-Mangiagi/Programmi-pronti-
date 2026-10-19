# "><(((º> sabusabu <º)))><"
# Rimuove l'avvio automatico e ferma il programma in esecuzione.
$TaskName = "Cosedil - Trasferimento VFP"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Avvio automatico rimosso." -ForegroundColor Green
} else {
    Write-Host "L'avvio automatico non era installato."
}
Read-Host "Premere Invio per chiudere"
