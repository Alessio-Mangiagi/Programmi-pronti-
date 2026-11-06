' Avvia il server Confronto Documenti (nascosto) e apre il browser.
' Doppio click per avviare. Per fermare il server: Gestione Attivita -> python.exe

Option Explicit

Dim shell, fso, http, scriptDir, pythonExe, serverUrl, i, ready
Set shell = CreateObject("WScript.Shell")
Set fso   = CreateObject("Scripting.FileSystemObject")
Set http  = CreateObject("MSXML2.XMLHTTP")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverUrl = "http://localhost:5001"

' Ambiente virtuale creato da Installa.bat; senza, il python nel PATH.
Dim venvPy
venvPy = scriptDir & "\.venv\Scripts\python.exe"
If fso.FileExists(venvPy) Then
    pythonExe = venvPy
Else
    pythonExe = "python"
End If

' Istanza precedente rimasta appesa sulla porta 5001? Chiusura forzata prima
' di partire (helper condiviso della suite; True = aspetta che finisca).
shell.CurrentDirectory = scriptDir
shell.Run "cmd /c call """ & scriptDir & "\..\shared\avvia\libera-porta.bat"" 5001", 0, True

' Motore della firma digitale (PDF firmati .p7m, shared\firma): se il suo ambiente Python manca lo installa
' installa.bat, in una finestra nascosta e senza aspettarlo (serve la rete, circa un minuto la prima volta).
' Intanto il confronto parte lo stesso: solo i .p7m danno "componente non installato" finché non ha finito.
Dim firmaDir
firmaDir = scriptDir & "\..\shared\firma"
If Not fso.FileExists(firmaDir & "\.venv\Scripts\python.exe") And fso.FileExists(firmaDir & "\installa.bat") Then
    shell.Run "cmd /c """ & firmaDir & "\installa.bat""", 0, False
End If

' Avvia il server con finestra nascosta (0 = hidden, False = non aspettare)
shell.Run """" & pythonExe & """ """ & scriptDir & "\server.py""", 0, False

' Aspetta finche il server risponde (max 30 secondi). Si controlla "/" e non
' un'/api: le API stanno dietro il gate SSO e senza login rispondono 401, che
' qui sembrerebbe "server spento" anche a server perfettamente su.
ready = False
For i = 1 To 30
    WScript.Sleep 1000
    On Error Resume Next
    http.Open "GET", serverUrl & "/", False
    ' "><(((º> sabusabu <º)))><"
    http.Send
    If Err.Number = 0 And http.Status = 200 Then
        ready = True
        Exit For
    End If
    On Error GoTo 0
Next

If ready Then
    shell.Run serverUrl
Else
    MsgBox "Server non avviato dopo 30 secondi. Controlla che Python e i pacchetti siano installati.", 48, "Confronto Documenti"
End If
