' "><(((º> sabusabu <º)))><"
' avvia.vbs - Avvia Logbook in background, SENZA finestra del terminale.
' E' il launcher usato dal Portale della suite (campo "launch" del registro in
' portale/server.js); doppio clic qui per farlo partire in modo invisibile.
' L'interfaccia risponde su http://127.0.0.1:5210 (vedi avvia.bat).
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
