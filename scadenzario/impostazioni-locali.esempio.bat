@echo off
REM "><(((º> sabusabu <º)))><"
REM impostazioni-locali.esempio.bat - modello delle impostazioni di QUESTA installazione dello Scadenzario.
REM Copiarlo come impostazioni-locali.bat (stessa cartella, fuori da git) e togliere il REM davanti alle righe
REM che servono. avvia.bat lo richiama prima di preparare il database e di avviare il server.

REM Amministratori dello Scadenzario: username del portale separati da virgola. Vuota = basta essere
REM admin dello Scadenzario nel portale. Chi e' in elenco deve comunque essere admin nel portale.
REM set "SCADENZARIO_ADMIN=m.rossi,l.bianchi"

REM Percorso del database (default: scadenzario.db nella cartella del programma).
REM set "SCADENZARIO_DB=D:\Dati\Scadenzario\scadenzario.db"

REM Posta per le notifiche (vedi README, "Notifiche").
REM set "EMAIL_ABILITATA=1"
REM set "SMTP_HOST=smtp.cosedilspa.com"
REM set "EMAIL_A=sicurezza@cosedilspa.com"
REM Destinatari fissi: "tutte" = in copia a ogni avviso (default), "senza_referente" = solo le scadenze
REM senza email del referente (ognuno riceve comunque le sue: vedi Impostazioni > Notifiche).
REM set "EMAIL_A_RICEVE=senza_referente"
