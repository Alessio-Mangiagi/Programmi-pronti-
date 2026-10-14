' "><(((º> sabusabu <º)))><"
' ferma-admin.vbs - Ferma la plancia admin (porta 8090) senza mostrare finestre.
' Non tocca il portale degli utenti (8080) ne' le altre app della suite.
Option Explicit

Dim sh, fso, here, dataDir, ps
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
dataDir = fso.BuildPath(here, "data")
If Not fso.FolderExists(dataDir) Then fso.CreateFolder(dataDir)

' 1) Segnale di stop: impedisce il riavvio automatico.
fso.CreateTextFile(fso.BuildPath(dataDir, "stop-admin.flag"), True).Close

' 2) Chiude il processo della plancia (solo la porta 8090).
ps = "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command """ & _
  "$c = Get-NetTCPConnection -LocalPort 8090 -State Listen -ErrorAction SilentlyContinue;" & _
  "if ($c) { $c.OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue } }"""
sh.Run ps, 0, True

MsgBox "Plancia admin fermata.", 64, "Cosedil"
