<!-- "><(((º> sabusabu <º)))>< -->
# 8. Se qualcosa non va

[← Indice](README.md)

| Cosa succede | Cosa fare |
|---|---|
| Non ricordo la password / account bloccato | Dopo 5 errori si sblocca da solo in 15 minuti. Altrimenti chiedi all'amministratore di reimpostarla. |
| Tutti i pallini in alto a sinistra sono rossi | Nessun motore di AI è raggiungibile: le domande non possono partire. Avvisa l'amministratore. |
| *«Ho provato a interrogare il database ma non ci sono riuscito: …»* | Il programma ha ritentato da solo fino a 3 volte senza riuscirci. Riformula la domanda in modo più preciso (periodo, nomi esatti) o prova in modalità **Query**. |
| Risposta con zero righe | Il filtro probabilmente non corrisponde ai valori reali (es. un nome scritto diversamente). Guarda l'elenco colonne a sinistra e riformula. |
| *«Nessun DB connesso»* | Collega prima una sorgente ([capitolo 2](02-sorgenti.md)). |
| La domanda viene rifiutata come fuori ambito | Il programma risponde solo su dati, documenti e app della suite. |
| Il numero non torna | Guarda **SQL GENERATO** e la tabella: spesso il periodo o il raggruppamento non è quello che intendevi. Premi 👎 e riformula. |
| *«Il foglio … ha … righe: il limite è …»* o *«File Excel di … MB: il limite è …»* | L'Excel è troppo grande per essere letto in sicurezza. Dividilo o filtra i dati prima di caricarlo, oppure chiedi all'amministratore di alzare il limite. |
| *Dati parziali* in cima alla pagina | Con **DB + Excel** una tabella superava il limite di righe ed è stata troncata: i totali sono parziali. |
| PDF scansionati non letti nei Documenti | Serve Claude configurato (vedi l'avviso nel modulo). |
| Il report Excel non ha grafici | Il servizio dei grafici è spento: il report contiene comunque tutte le tabelle. |
| L'agente dice che un'app è spenta | Aprila dal Portale e ripeti la richiesta. |
| Pagina bianca o "Non autenticato" | Ricarica la pagina; se persiste, esci e rientra dal Portale. |

[← Pannello Admin](07-pannello-admin.md) · [Avanti: Per l'amministratore di sistema →](09-amministratore-sistema.md)
