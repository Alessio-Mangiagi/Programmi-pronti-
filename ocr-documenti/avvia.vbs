' avvia.vbs - Avvia OCR Documenti SENZA finestra del terminale.
' Doppio click qui per farlo partire in modo invisibile.
' Il browser si apre da solo su http://localhost:5179 (lo apre Vite, vedi vite.config.ts: server.open).
' Per fermarlo: chiudi il processo node da Gestione Attivita.
Option Explicit

Dim sh, fso, here, bat, log, q, cmd
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

here = fso.GetParentFolderName(WScript.ScriptFullName)
bat = fso.BuildPath(here, "avvia.bat")
log = fso.BuildPath(here, "avvio.log")
q = Chr(34)

sh.CurrentDirectory = here
' Finestra nascosta = nessun messaggio visibile: l'output del .bat va in avvio.log
' (sovrascritto a ogni avvio), cosi' un "non parte" si diagnostica leggendo quello.
' Il cmd dell'istanza in corso tiene il file aperto finche' gira: se il log non si
' lascia cancellare c'e' gia' un'istanza viva, e si parte SENZA redirect (il .bat
' la chiude e riparte lo stesso; con il redirect cmd non aprirebbe il file e non
' partirebbe niente).
cmd = "cmd /c " & q & bat & q
On Error Resume Next
' "><(((º> sabusabu <º)))><"
If fso.FileExists(log) Then fso.DeleteFile log, True
If Err.Number = 0 Then cmd = "cmd /c " & q & q & bat & q & " > " & q & log & q & " 2>&1" & q
On Error GoTo 0
' Secondo parametro 0 = finestra nascosta; terzo False = non attende la chiusura.
sh.Run cmd, 0, False
