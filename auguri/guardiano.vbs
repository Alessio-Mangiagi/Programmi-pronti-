' Guardiano di Auguri: controlla che il programma sia vivo e, se non lo
' e', lo riavvia. Senza finestre, nessun disturbo per chi usa il PC.
'
' Lo lancia l'Attivita' pianificata "WhatsApp Auguri Cosedil" ogni 5 minuti e a
' ogni accesso (vedi installa-avvio-automatico.ps1). Il programma deve restare
' sempre attivo: se qualcuno lo chiude, se Chromium muore o se il PC si riavvia,
' entro 5 minuti torna su da solo.
'
' Differenza con avvia-silenzioso.vbs: quello e' l'avvio manuale e LIBERA la
' porta 3000 prima di partire (chiude l'istanza vecchia); il guardiano non deve
' mai farlo, altrimenti ucciderebbe proprio il programma sano che sta vegliando.

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

projDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = projDir

' Il programma e' vivo se qualcuno ascolta sulla porta 3000.
' 0 = finestra nascosta, True = aspetta l'esito. Codice 0 = trovato.
inAscolto = sh.Run("cmd /c netstat -ano -p TCP | findstr "":3000"" | findstr ""LISTENING"" >nul", 0, True)
If inAscolto = 0 Then WScript.Quit 0

nodeExe = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"

' 0 = finestra nascosta, False = non aspettare la fine
sh.Run """" & nodeExe & """ """ & projDir & "\src\server.js""", 0, False

' Traccia del riavvio: se il programma cade spesso, qui si vede.
logDir = projDir & "\log"
If Not fso.FolderExists(logDir) Then fso.CreateFolder(logDir)
Set f = fso.OpenTextFile(logDir & "\guardiano.log", 8, True)
f.WriteLine Now & " - programma non attivo: riavviato"
f.Close
