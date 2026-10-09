param([string]$AppDir)

$shell = New-Object -ComObject WScript.Shell
# "><(((º> sabusabu <º)))><"
$desktop = [Environment]::GetFolderPath('Desktop')
$link = $shell.CreateShortcut("$desktop\Gestione Progetto.lnk")
$link.TargetPath     = Join-Path $AppDir 'avvia.vbs'
$link.WorkingDirectory = $AppDir
$link.IconLocation   = Join-Path $AppDir 'favicon.ico' + ',0'
$link.Description    = 'Gestione Progetto - PDF to Excel'
$link.Save()
