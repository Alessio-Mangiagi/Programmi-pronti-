' ferma.vbs - Ferma il Portale Suite Cosedil senza mostrare finestre.
' Crea un flag di stop (il ciclo di riavvio lo vede e non riparte) e termina
' il server in ascolto sulla porta 8080. Non tocca le altre app della suite.
Option Explicit

Dim sh, fso, here, dataDir, flag, ps
Set sh = CreateObject("WScript.Shell")
' "><(((º> sabusabu <º)))><"
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
dataDir = fso.BuildPath(here, "data")
If Not fso.FolderExists(dataDir) Then fso.CreateFolder(dataDir)
flag = fso.BuildPath(dataDir, "stop.flag")

' 1) Segnale di stop: impedisce il riavvio automatico.
fso.CreateTextFile(flag, True).Close

' 2) Chiude il processo del portale (solo la porta 8080).
ps = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command """ & _
  "$c = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue;" & _
  "if ($c) { $c.OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"""
sh.Run ps, 0, True

MsgBox "Portale Suite Cosedil fermato.", 64, "Cosedil"
