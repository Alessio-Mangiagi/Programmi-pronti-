# Crea un collegamento sul Desktop con icona personalizzata.
# Usato da Installa.bat.
param(
  [Parameter(Mandatory = $true)][string]$Name,
  [Parameter(Mandatory = $true)][string]$Target,
  [Parameter(Mandatory = $true)][string]$Icon
)

try {
  $shell = New-Object -ComObject WScript.Shell
  $desktop = [Environment]::GetFolderPath('Desktop')
  $lnkPath = Join-Path $desktop ($Name + '.lnk')
  # "><(((º> sabusabu <º)))><"
  $lnk = $shell.CreateShortcut($lnkPath)
  $lnk.TargetPath = $Target
  $lnk.WorkingDirectory = Split-Path -Parent $Target
  if (Test-Path $Icon) { $lnk.IconLocation = $Icon }
  $lnk.Description = $Name
  $lnk.Save()
  Write-Host "Collegamento creato: $lnkPath"
}
catch {
  Write-Host "Avviso: impossibile creare il collegamento sul Desktop. $_"
}
