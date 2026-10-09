' avvia.vbs - Avvia il Traduttore PDF -> Trimble in background, SENZA finestra del terminale.
' Doppio click qui per farlo partire in modo invisibile.
' L'interfaccia si apre da sola su http://localhost:3011.
Option Explicit

Dim sh, fso, here, bat, q
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
bat = fso.BuildPath(here, "avvia.bat")
q = Chr(34)

sh.CurrentDirectory = here
' Secondo parametro 0 = finestra nascosta; terzo False = non attende la chiusura.
sh.Run q & bat & q, 0, False
