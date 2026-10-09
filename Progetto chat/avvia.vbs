Dim objShell, objFSO, strDir
Set objShell = CreateObject("WScript.Shell")
Set objFSO   = CreateObject("Scripting.FileSystemObject")
strDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' ── 1. Verifica Node.js ─────────────────────────────────────────────────────
If objShell.Run("cmd /c node --version", 0, True) <> 0 Then
  MsgBox "Node.js non trovato." & vbCrLf & vbCrLf & _
         "Scaricalo da: https://nodejs.org" & vbCrLf & _
         "(versione 18 LTS o superiore)", _
         vbCritical, "Gestione Progetto"
  WScript.Quit
End If

' ── 2. Verifica build ────────────────────────────────────────────────────────
If Not objFSO.FileExists(strDir & "dist\server.js") Then
  MsgBox "Installazione non completata." & vbCrLf & vbCrLf & _
         "Esegui installa.bat prima di avviare l'applicazione.", _
         vbCritical, "Gestione Progetto"
  WScript.Quit
End If

' ── 3. Protezione doppio avvio ───────────────────────────────────────────────
Dim oExec, sLine, portFound
portFound = 0
Set oExec = objShell.Exec("netstat -an")
Do While Not oExec.StdOut.AtEndOfStream
  sLine = oExec.StdOut.ReadLine()
  Dim p
  For p = 5050 To 5059
    If InStr(sLine, "127.0.0.1:" & p) > 0 And InStr(sLine, "LISTENING") > 0 Then
      portFound = p
      Exit Do
    End If
  Next
  If portFound > 0 Then Exit Do
Loop

If portFound > 0 Then
  objShell.Run "cmd /c start http://127.0.0.1:" & portFound, 0, False
  WScript.Quit
End If

' ── 4. Avvio server (finestra nascosta: 0 = hidden, False = non attende) ──────
' Il server apre da solo il browser. Per fermarlo: chiudi il tab / Gestione Attivita.
' La finestra e' nascosta: il .bat salta i "pause" finali (via questa variabile),
' altrimenti a ogni spegnimento resterebbe una cmd zombie invisibile.
objShell.Environment("PROCESS")("LANCIO_NASCOSTO") = "1"
objShell.Run "cmd /c """ & strDir & "avvia.bat""", 0, False
