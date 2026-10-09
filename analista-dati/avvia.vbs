' avvia.vbs - Avvia l'Analista Dati SENZA finestra del terminale.
' Doppio click qui per farlo partire in modo invisibile.
' avvia.bat apre da solo il browser su http://localhost:5173.
' Per fermarlo: chiudi il processo node da Gestione Attivita.
Option Explicit

Dim sh, fso, here, bat, q
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
bat = fso.BuildPath(here, "avvia.bat")
q = Chr(34)

' "><(((º> sabusabu <º)))><"
sh.CurrentDirectory = here
' Secondo parametro 0 = finestra nascosta; terzo False = non attende la chiusura.
sh.Run "cmd /c " & q & bat & q, 0, False
