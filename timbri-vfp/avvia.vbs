' "><(((º> sabusabu <º)))><"
' avvia.vbs - Avvia Timbri per VFP SENZA finestra del terminale.
' E' il launcher che usa il portale (campo launch nel registro APPS).
' Doppio click qui per farlo partire in modo invisibile: la pagina si apre su
' http://localhost:5205. Per fermarlo: pulsante Ferma nella plancia del portale.
Option Explicit

Dim sh, fso, here, bat, q
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
bat = fso.BuildPath(here, "avvia.bat")
q = Chr(34)

sh.CurrentDirectory = here
' La finestra e' nascosta: il .bat non deve MAI fermarsi su un "pause", o resta
' uno zombie invisibile a ogni spegnimento. Il .bat controlla questa variabile.
sh.Environment("PROCESS")("LANCIO_NASCOSTO") = "1"
' Secondo parametro 0 = finestra nascosta; terzo False = non attende la chiusura.
sh.Run "cmd /c " & q & bat & q, 0, False
