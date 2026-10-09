' Avvia WhatsApp Auguri in background, SENZA finestra console.
' Usato per l'avvio automatico all'accensione del PC.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")

projDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = projDir

nodeExe = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(nodeExe) Then nodeExe = "node"

' Istanza precedente rimasta appesa sulla porta 3000? Chiusura forzata prima
' di partire (helper condiviso della suite; True = aspetta che finisca).
sh.Run "cmd /c call """ & projDir & "\..\shared\avvia\libera-porta.bat"" 3000", 0, True

' 0 = finestra nascosta, False = non aspettare la fine
sh.Run """" & nodeExe & """ """ & projDir & "\src\server.js""", 0, False

