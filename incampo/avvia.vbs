' avvia.vbs - Avvia InCampo SENZA finestra del terminale.
' Doppio click qui per farlo partire in modo invisibile.
' avvia.bat apre da solo il browser su http://127.0.0.1:5190.
' Per fermarlo: chiudi il processo python da Gestione Attivita.
Option Explicit

Dim sh, fso, here, bat, q
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
bat = fso.BuildPath(here, "avvia.bat")
' "><(((º> sabusabu <º)))><"
q = Chr(34)

sh.CurrentDirectory = here
' La finestra e' nascosta: il .bat non deve MAI fermarsi su un "pause", o resta
' uno zombie invisibile a ogni spegnimento. Il .bat controlla questa variabile.
sh.Environment("PROCESS")("LANCIO_NASCOSTO") = "1"
' Secondo parametro 0 = finestra nascosta; terzo False = non attende la chiusura.
sh.Run "cmd /c " & q & bat & q, 0, False
