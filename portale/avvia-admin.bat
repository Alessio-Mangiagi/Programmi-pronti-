@echo off
rem avvia-admin.bat - Plancia per gli AMMINISTRATORI sulla porta 8090, accanto
rem al portale degli utenti (8080). Stesso server.js e stesso avvia.bat: gli
rem admin che entrano qui vedono la plancia, gli altri la home delle app.
rem
rem Con PORTALE_DATA_DIR impostata (setx PORTALE_DATA_DIR "C:\...\portale\data")
rem utenti, sessioni e registro sono quelli del portale utenti: la plancia
rem mostra l'attivita' reale. Le altre impostazioni sono in avvia.bat.
rem
rem NOTA per chi edita: file ASCII puro con righe CRLF.

set "PORT=8090"
set "STOP_FLAG=stop-admin.flag"
call "%~dp0avvia.bat"
