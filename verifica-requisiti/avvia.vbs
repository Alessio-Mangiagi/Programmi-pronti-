Dim objShell, objFSO, strDir
Set objShell = CreateObject("WScript.Shell")
Set objFSO   = CreateObject("Scripting.FileSystemObject")
strDir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))

' -- 1. Verifica Node.js ------------------------------------------------------
If objShell.Run("cmd /c node --version", 0, True) <> 0 Then
  MsgBox "Node.js non trovato." & vbCrLf & vbCrLf & _
         "Scaricalo da: https://nodejs.org" & vbCrLf & _
         "(versione 20 LTS o superiore)", _
         vbCritical, "Verifica Requisiti"
  WScript.Quit
End If

' -- 2. Doppio avvio: se una istanza risponde gia', apre solo il browser -------
Dim oExec, sLine, portFound, p
portFound = 0
Set oExec = objShell.Exec("netstat -an")
Do While Not oExec.StdOut.AtEndOfStream
  sLine = oExec.StdOut.ReadLine()
  For p = 5185 To 5189
    If InStr(sLine, "127.0.0.1:" & p) > 0 And InStr(sLine, "LISTENING") > 0 Then
      portFound = p
      Exit Do
    End If
  Next
  If portFound > 0 Then Exit Do
Loop

If portFound > 0 Then
  objShell.Run "cmd /c start http://localhost:" & portFound, 0, False
  WScript.Quit
End If

' -- 3. Avvio server (finestra nascosta: 0 = hidden, False = non attende) ------
' Il server apre da solo il browser. La finestra e' nascosta: il .bat salta i
' "pause" finali (via questa variabile), altrimenti resta una cmd zombie.
objShell.Environment("PROCESS")("LANCIO_NASCOSTO") = "1"
objShell.Run "cmd /c """ & strDir & "avvia.bat""", 0, False
