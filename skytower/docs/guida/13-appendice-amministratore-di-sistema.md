<!-- "><(((º> sabusabu <º)))>< -->
# 13. Appendice per l'amministratore di sistema

[← Indice](README.md)

Questa appendice è per chi installa e mantiene SkyTower, non per chi lo usa. Il riferimento completo è
`skytower/docs/runbook.md`; le scelte tecniche sono motivate in `skytower/docs/adr.md`.

## 13.1 Dove gira

Due modalità di rilascio:

- **Server aziendale della suite** (Docker Compose, cartella `infra/docker/`): database, archivio documenti con
  blocco degli oggetti (MinIO), antivirus, API, worker e interfaccia web. Si installa con `installa.ps1` /
  `installa.sh`, si aggiorna con `aggiorna.*`, si salva con `backup.*` e si ripristina con `ripristina.*`.
  Obiettivi: perdita massima di dati 24 ore (backup giornaliero), ripristino in circa un'ora.
- **Cloud** (Terraform, `infra/terraform/envs/prod`): database replicato, documenti immutabili per 10 anni con
  replica in un'altra regione, perdita massima 15 minuti, ripristino in 4 ore.

SkyTower si apre dal **Portale** della suite; le altre app (InCampo, Magazzino Operativo, Confronto Documenti,
Verifica Requisiti) dialogano con SkyTower tramite il token di servizio della suite.

## 13.2 Backup: cosa non dimenticare

- Copiare ogni giorno la cartella `infra/docker/backup/` fuori dal server (NAS o backup aziendale).
- Il backup delle **chiavi** (`backup/chiavi/CHIAVI-SEGRETE-<data>.tar`) va cifrato e tenuto **separato** dal dump
  del database: senza le chiavi i secondi fattori degli utenti sono persi; insieme al dump permetterebbero di
  firmare accessi per chiunque.
- Prova di ripristino una volta a trimestre su una copia separata, misurando il tempo.
- Dopo un ripristino da un backup uscito dal controllo dell'IT, ruotare la chiave di firma degli accessi: tutti
  rifanno il login.

## 13.3 Operazioni ricorrenti

| Situazione | Cosa fare |
|---|---|
| Utente che ha perso telefono/chiave e recovery code | Lo gestisce l'amministratore della sua organizzazione con **Azzera MFA** ([capitolo 10](10-amministrazione.md#107-la-mia-organizzazione-e-gli-utenti)), dopo aver verificato l'identità per telefono. Se è irraggiungibile, l'amministratore della piattaforma dalla stessa pagina. |
| Single sign-on con Microsoft Entra ID | In Entra: nuova registrazione di app web con l'URI di reindirizzamento mostrato nella pagina Organizzazione; segreto client. In SkyTower: issuer, client ID, segreto, domini, **Prova la connessione**, un accesso di prova, solo dopo l'obbligo. Alla scadenza del segreto in Entra va inserito quello nuovo. |
| Modifica di Word/Excel in piattaforma | Serve un Document Server OnlyOffice raggiungibile, con lo stesso segreto JWT configurato in SkyTower. La versione Community ammette 20 connessioni contemporanee. |
| Visualizzazione dei DWG | Installare ODA File Converter sul server del worker; senza, i DWG mostrano il motivo e si scaricano, i DXF si vedono sempre. |
| Email | Server SMTP aziendale (`CDE_MAILER=smtp` e variabili `CDE_SMTP_*`). |
| Allarme «hash chain ALTERATA» nel log del worker | Il registro attività è stato manomesso: seguire la procedura di incidente, non toccare il database. |

## 13.4 Limiti contro gli abusi (valori predefiniti)

| Limite | Valore | Effetto per l'utente |
|---|---|---|
| Tentativi di login | 5 al minuto per email e indirizzo | «Troppi tentativi: riprovare tra un minuto» |
| Ricerca organizzazione per codice | 30 all'ora | l'invito di un'organizzazione si blocca per un po' |
| Inviti di utenti | 60 all'ora per amministratore | |
| Verifica ed export del registro | 10 al minuto | |
| Schede con notifiche in tempo reale | 5 per utente | oltre, le notifiche si aggiornano solo a intervalli |
| Durata della sessione senza HTTPS (fuori sviluppo) | 12 ore invece di 14 giorni | login più frequente: la soluzione è pubblicare SkyTower con un dominio e TLS |

## 13.5 Dati demo

Le commesse dimostrative si caricano con il comando `cde demo-contenuti`; il processo RdA della Galleria Fortolese
con `cde workflow-rda --progetto GALFOR` (con `--in-libreria` ne copia il modello nella libreria dell'organizzazione,
con `--rimuovi` lo toglie). Gli utenti demo hanno indirizzi `*.example` e una password comune comunicata a parte.
