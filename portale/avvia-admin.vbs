' "><(((º> sabusabu <º)))><"
' avvia-admin.vbs - Avvia la plancia admin (porta 8090) SENZA finestra del terminale.
' Per fermarla: doppio click su ferma-admin.vbs.
Option Explicit

Dim sh, fso, here, q
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
q = Chr(34)

sh.CurrentDirectory = here
sh.Run q & fso.BuildPath(here, "avvia-admin.bat") & q, 0, False
