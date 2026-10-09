@echo off
rem libera-porta.bat PORTA [PORTA...] - helper condiviso dei launcher della suite.
rem
rem Se una porta e' gia' occupata da un processo in LISTENING (tipicamente
rem un'istanza precedente rimasta appesa), il nuovo avvio muore con
rem EADDRINUSE e l'app "non parte". Qui si chiude a forza l'intero albero del
rem processo che tiene la porta, cosi' l'avvio che segue trova via libera.
rem
rem Usato dagli avvia.bat delle app PRIMA del comando di avvio:
rem     call "%~dp0..\shared\avvia\libera-porta.bat" 5050
rem
rem Attenzione: chiude QUALUNQUE processo in ascolto sulla porta, anche se
rem sano - e' il comportamento voluto (riavvio forzato), le porte della suite
rem sono riservate alle sue app.
rem
rem NOTA per chi edita: questo file DEVE restare ASCII puro con righe CRLF.
rem Con accenti/trattini Unicode o righe LF, cmd.exe spezza i comandi a caso.
setlocal enabledelayedexpansion

set "UCCISI="
for %%P in (%*) do (
    rem Colonna 2 = indirizzo locale (0.0.0.0:5050, [::]:5050), colonna 5 = PID.
    rem ":%%P " con lo spazio: la porta finisce li', :505 non piglia :5050.
    rem Senza "-p TCP": quel filtro e' SOLO IPv4, e un server legato a "localhost"
    rem (vite, node) sta su [::1] = IPv6 (-p TCPv6). Cosi' le istanze appese
    rem non venivano mai viste, si accumulavano, e la nuova finiva su un'altra porta.
    rem Le righe UDP non hanno LISTENING: il findstr le scarta da solo.
    for /f "tokens=5" %%I in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do (
        echo   [RIAVVIO] Porta %%P occupata dal processo %%I: chiusura forzata.
        taskkill /PID %%I /T /F >nul 2>&1
        set "UCCISI=1"
    )
)

rem Un attimo perche' Windows rilasci davvero le porte appena liberate.
rem (ping come pausa: "timeout" pretende una console interattiva e, avviato
rem nascosto dal portale o da un .vbs, fallirebbe.)
if defined UCCISI ping -n 2 127.0.0.1 >nul

endlocal
exit /b 0
