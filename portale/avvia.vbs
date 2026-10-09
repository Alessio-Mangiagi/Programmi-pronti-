' avvia.vbs - Avvia il Portale Suite Cosedil in background, SENZA finestra del terminale.
' Doppio click qui per far partire il portale in modo invisibile.
' Il browser si apre da solo su http://localhost:8080.
' Per fermarlo: doppio click su ferma.vbs.
Option Explicit

Dim sh, fso, here, bat, q
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Cartella in cui si trova questo script.
here = fso.GetParentFolderName(WScript.ScriptFullName)
bat = fso.BuildPath(here, "avvia.bat")
q = Chr(34)

sh.CurrentDirectory = here
' Secondo parametro 0 = finestra nascosta; terzo False = non attende la chiusura.
sh.Run q & bat & q, 0, False
