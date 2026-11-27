' "><(((º> sabusabu <º)))><"
' apri-copilota.vbs - Apre Copilota come un programma tradizionale (27/11/2026).
' E' il file a cui punta l'icona "Copilota" sul desktop (la crea InstallaLogbook.exe).
'
' Cosa fa, in ordine:
' 1. chiede a Copilota se e' gia' acceso (GET /api/salute sulla porta del .env, 5210 se manca);
' 2. se non risponde lo avvia SENZA finestra del terminale (avvia.bat nascosto, come fa
'    avvia.vbs per il Portale) e aspetta che risponda, al massimo tre minuti: la prima volta
'    avvia.bat installa le dipendenze e compila l'interfaccia;
' 3. apre Copilota in una finestra propria, senza barra degli indirizzi e con la sua icona
'    nella barra delle applicazioni (Edge o Chrome in modalita' "app"). Se non c'e' nessuno
'    dei due, lo apre nel browser predefinito.
'
' Chi lo usa non vede porte ne' indirizzi. Copilota resta acceso anche chiudendo la
' finestra: per spegnerlo si chiude il processo "node" o si riavvia il PC.
' I messaggi a video sono senza lettere accentate di proposito: uno script .vbs salvato in
' UTF-8 le mostrerebbe sbagliate.
Option Explicit

Dim sh, fso, qui, porta, indirizzo, q
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
qui = fso.GetParentFolderName(WScript.ScriptFullName)
q = Chr(34)
porta = PortaDalEnv(fso.BuildPath(qui, ".env"))
indirizzo = "http://127.0.0.1:" & porta

If Not Risponde(indirizzo) Then
  ' PORTALE_APRE_BROWSER=1 dice ad avvia.bat di non aprire lui il browser e di non fermarsi
  ' su "premi un tasto": la finestra la apre questo script, quando Copilota e' pronto.
  sh.Environment("PROCESS")("PORTALE_APRE_BROWSER") = "1"
  sh.CurrentDirectory = qui
  sh.Run q & fso.BuildPath(qui, "avvia.bat") & q, 0, False
  Dim tentativi
  tentativi = 0
  Do While Not Risponde(indirizzo)
    tentativi = tentativi + 1
    If tentativi > 90 Then
      MsgBox "Copilota non si e' avviato entro tre minuti." & vbCrLf & _
             "Per vedere l'errore fare doppio clic su avvia.bat nella cartella:" & vbCrLf & qui, vbExclamation, "Copilota"
      WScript.Quit 1
    End If
    WScript.Sleep 2000
  Loop
End If

ApriFinestra indirizzo

' Porta di Copilota: riga LOGBOOK_PORT=... del .env, altrimenti 5210 (come server/index.ts).
Function PortaDalEnv(percorso)
  Dim f, riga, re, m
  PortaDalEnv = "5210"
  If Not fso.FileExists(percorso) Then Exit Function
  Set re = New RegExp
  re.Pattern = "^\s*LOGBOOK_PORT\s*=\s*(\d+)\s*$"
  Set f = fso.OpenTextFile(percorso, 1)
  Do Until f.AtEndOfStream
    riga = f.ReadLine
    Set m = re.Execute(riga)
    If m.Count > 0 Then PortaDalEnv = m(0).SubMatches(0)
  Loop
  f.Close
End Function

' True se Copilota risponde. Tempi corti (2 secondi): a server spento si deve saperlo subito.
Function Risponde(base)
  Dim h
  Risponde = False
  On Error Resume Next
  Set h = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  h.setTimeouts 2000, 2000, 2000, 2000
  h.Open "GET", base & "/api/salute", False
  h.Send
  If Err.Number = 0 Then
    If h.Status = 200 Then Risponde = True
  End If
  Err.Clear
  On Error GoTo 0
End Function

' Finestra "da programma": Edge (c'e' su ogni Windows 10 e 11), poi Chrome, poi il browser predefinito.
Sub ApriFinestra(url)
  Dim candidati, c
  candidati = Array( _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"), _
    sh.ExpandEnvironmentStrings("%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"), _
    sh.ExpandEnvironmentStrings("%ProgramFiles%\Google\Chrome\Application\chrome.exe"), _
    sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"), _
    sh.ExpandEnvironmentStrings("%LocalAppData%\Google\Chrome\Application\chrome.exe"))
  For Each c In candidati
    If fso.FileExists(c) Then
      sh.Run q & c & q & " --app=" & url, 1, False
      Exit Sub
    End If
  Next
  sh.Run url, 1, False
End Sub
