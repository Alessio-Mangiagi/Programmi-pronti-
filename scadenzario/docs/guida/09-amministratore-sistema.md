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

È amministratore chi è **admin per lo Scadenzario nel Portale** e, se la variabile
`SCADENZARIO_ADMIN` contiene un elenco di username (separati da virgola), compare anche
in quell'elenco. `avvia.bat` imposta un valore predefinito se la variabile manca:
controllalo, altrimenti gli altri admin del Portale non vedono **Amministrazione**.

## Dove stanno i dati

| Cosa | Dove |
|---|---|
| Database (scadenze, anagrafiche, registro notifiche) | `scadenzario/scadenzario.db` |
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

Per inviare il riepilogo via email impostare `EMAIL_ABILITATA=1`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_DA` ed `EMAIL_A` (destinatari separati
da virgola). Senza configurazione il canale resta "Disabilitato".

## Ripristino

Ferma lo Scadenzario, estrai lo zip di backup nella cartella del programma
(`scadenzario.db` e `allegati/`) e riavvia.
