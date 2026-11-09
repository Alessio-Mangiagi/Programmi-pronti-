<!-- "><(((º> sabusabu <º)))>< -->
# 9. Per l'amministratore di sistema

[← Indice](README.md)

Appendice breve per chi installa e mantiene lo Scadenzario. I dettagli tecnici sono
nel [README del programma](../../README.md), in [SPEC.md](../../SPEC.md) e
[SPEC-ADMIN.md](../../SPEC-ADMIN.md).

## Avvio

- Prima volta: `installa.bat` nella cartella `scadenzario` (serve Python 3.10 o
  superiore).
- Normalmente lo Scadenzario lo avvia il **Portale**. A mano: `avvia.bat` (o
  `avvia.vbs` senza finestra).
- Acceso solo sul PC locale, si **spegne da solo** quando si chiude l'ultima scheda; in
  rete resta acceso (`SPEGNIMENTO_AUTOMATICO=0/1` forza la scelta).
- Senza Portale acceso nessuno entra. Non esporre lo Scadenzario direttamente su
  internet: passa sempre dal Portale in https.

## Chi è amministratore

Ogni **amministratore del Portale** è amministratore anche qui, sempre: dal 09/11/2026 le
credenziali di un amministratore del Portale valgono come amministratore in tutti i programmi.

Chi invece è admin dello Scadenzario nel Portale solo per una regola sull'indirizzo del PC
(regole IP del Portale) è amministratore se la variabile `SCADENZARIO_ADMIN`, quando contiene
un elenco di username (separati da virgola), ha anche il suo nome. Se la variabile è vuota
basta essere admin dello Scadenzario nel Portale.

L'elenco non sta più dentro `avvia.bat`: si scrive in **`impostazioni-locali.bat`**, nella
cartella dello Scadenzario, che è di questa installazione e non finisce nel repository.
Per crearlo copia `impostazioni-locali.esempio.bat`, rinominalo e togli il `REM` davanti alle
righe che servono, per esempio:

```bat
set "SCADENZARIO_ADMIN=m.rossi,l.bianchi"
```

Lo stesso file può spostare il database (`SCADENZARIO_DB`, vedi sotto) e attivare la posta.
Le modifiche valgono dal riavvio successivo dello Scadenzario.

## Dove stanno i dati

| Cosa | Dove |
|---|---|
| Database (scadenze, anagrafiche, registro notifiche) | `scadenzario/scadenzario.db`, oppure il percorso in `SCADENZARIO_DB` |
| Allegati | `scadenzario/allegati/` |
| Backup automatici | `scadenzario/backup/scadenzario_AAAA-MM-GG.zip` |
| Pratiche dei mezzi a nolo lette | cartella pratiche di VFP Transfer (`MEZZI_VFP_DIR`) |

Il percorso del database e degli allegati non si sposta con una variabile: stanno nella
cartella del programma.

## Lavori automatici (ogni 15 minuti, a programma acceso)

- **Backup**: uno al giorno (database + allegati in uno zip), si tengono gli ultimi 14
  (`BACKUP_DA_TENERE`). Copia la cartella `backup/` anche fuori dal PC.
- **Notifiche**: un giro al giorno dalle `NOTIFICHE_ORA` (predefinito 7);
  `NOTIFICHE_AUTOMATICHE=0` lo spegne.
- **Mezzi a nolo**: lettura delle pratiche ogni `SCADENZARIO_IMPORT_SEC` secondi
  (predefinito 900, 0 = mai).

## Email

Per inviare gli avvisi via email impostare `EMAIL_ABILITATA=1`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_DA` ed `EMAIL_A` (destinatari fissi
separati da virgola). Senza configurazione il canale resta "Disabilitato".

Ogni referente (email sulla scadenza o predefinita del tipo) riceve le sue scadenze;
`EMAIL_A_RICEVE` decide cosa ricevono i destinatari fissi: `tutte` (predefinito, il
riepilogo completo in copia) oppure `senza_referente` (solo le scadenze che non hanno un
referente con email). Si imposta in `impostazioni-locali.bat` come le altre variabili.

## Ripristino

Ferma lo Scadenzario, estrai lo zip di backup nella cartella del programma
(`scadenzario.db` e `allegati/`) e riavvia.
