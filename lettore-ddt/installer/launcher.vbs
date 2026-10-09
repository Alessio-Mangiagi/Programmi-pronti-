Dim objShell, objFSO, strDir
Set objShell = CreateObject("WScript.Shell")
Set objFSO   = CreateObject("Scripting.FileSystemObject")
strDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' Verifica integrità installazione
If Not objFSO.FileExists(strDir & "node.exe") Then
  MsgBox "Installazione corrotta: node.exe non trovato." & vbCrLf & vbCrLf & _
         "Reinstalla l'applicazione.", vbCritical, "Gestione Progetto"
  WScript.Quit
End If

If Not objFSO.FileExists(strDir & "dist\server.js") Then
  MsgBox "Installazione corrotta: dist\server.js non trovato." & vbCrLf & vbCrLf & _
         "Reinstalla l'applicazione.", vbCritical, "Gestione Progetto"
  WScript.Quit
End If

' Protezione doppio avvio
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

' Avvio server con watchdog
objShell.Run "cmd /c """ & strDir & "_avvia_server.bat""", 0, False

' Attendi avvio e apri browser
WScript.Sleep 2500
objShell.Run "cmd /c start http://127.0.0.1:5050", 0, False
