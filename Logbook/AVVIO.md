<!-- "><(((º> sabusabu <º)))><" -->

# Copilota: come installarlo e avviarlo

Copilota è il programma per le ore e le presenze dei dipendenti. Si installa su **un solo PC**,
che fa da "centrale": gli altri PC e i telefoni dell'ufficio lo aprono dal browser, senza
installare niente.

Questo foglio serve a chi fa l'installazione. Per usare il programma c'è la guida con le
immagini: `Copilota\docs\guida\README.md`.

## Cosa serve

- Un PC con **Windows 10 o 11** che resti acceso negli orari di lavoro.
- **Node.js 20.19 o successivo** (gratuito, da <https://nodejs.org>, versione "LTS").
  Per controllare se c'è già: aprire il Prompt dei comandi e scrivere `node --version`.
- **Internet solo durante l'installazione**: servono circa 5 minuti per scaricare i componenti.
- Circa 1 GB di spazio libero.

## Installazione

1. Copiare la cartella **`Copilota`** dove deve restare, per esempio `C:\Copilota`.
   Non lasciarla in una cartella provvisoria o su una chiavetta: i dati finiscono lì dentro.
2. Aprire la cartella e fare doppio clic su **`InstallaLogbook.exe`**.
   Se Windows mostra "PC protetto", scegliere *Ulteriori informazioni → Esegui comunque*.
3. Rispondere alle domande:

   | Domanda | Cosa rispondere |
   |---|---|
   | Nome utente del primo amministratore | Il nome di chi gestirà il programma. È il **proprietario**: solo lui potrà nominare altri amministratori |
   | Password | Almeno **12 caratteri**, con lettere e numeri. Non compare mentre la si scrive |
   | Email del proprietario | L'indirizzo che riceverà i codici di sicurezza. Si può saltare e scriverla dopo |
   | Raggiungibile dagli altri PC e dai telefoni dell'ufficio? | **s** se devono usarlo anche i colleghi. Windows chiede un consenso da amministratore: rispondere *Sì* |
   | Si apre per nome, senza numero di porta? | **s** per avere un indirizzo come `http://nome-del-pc/copilota` |
   | Provarlo anche da fuori ufficio? | Di norma **n**. Serve solo per una prova dal telefono con un indirizzo provvisorio |

4. Alla fine l'installatore scrive **l'indirizzo da dare ai colleghi**: annotarlo.
   Sul desktop compare l'icona **Copilota**.

L'installazione non tocca altro sul PC: tutto resta nella cartella `Copilota`.

## Avvio

- **Sul PC dove è installato**: doppio clic sull'icona **Copilota** del desktop. Si apre in
  una finestra sua, come un programma qualsiasi. La prima volta può volerci un minuto.
- **Dagli altri PC e dai telefoni dell'ufficio**: aprire il browser e scrivere l'indirizzo
  dato dall'installatore, per esempio `http://nome-del-pc/copilota`.
  Sui telefoni il nome del PC spesso non funziona: usare l'indirizzo con i numeri, per
  esempio `http://192.168.1.50:5210`.

Copilota **non parte da solo** quando si accende il PC: dopo ogni riavvio va fatto un doppio
clic sull'icona. Chiudere la finestra non lo spegne: resta acceso per i colleghi.

## Primo accesso

1. Entrare con il nome utente e la password scelti durante l'installazione.
2. In **Dipendenti** inserire le persone, oppure caricarle da Excel con **Importa**.
3. Per ogni dipendente creare l'account dalla sua scheda: riceve una password provvisoria,
   che dovrà cambiare al primo accesso.
4. In **Progetti** inserire le commesse e assegnare i dipendenti.

Il database parte vuoto, con le sole festività nazionali.

## Posta: codici di sicurezza e avvisi

Senza posta Copilota funziona, ma non manda né i codici di sicurezza né gli avvisi
(richieste di ferie, ore mancanti, attestati in scadenza, password dimenticata).

Per attivarla aprire con il Blocco note il file **`.env`** nella cartella `Copilota` e
compilare queste righe (togliendo il `#` iniziale), poi riavviare Copilota:

```
LOGBOOK_PROPRIETARIO_EMAIL=chi.riceve.i.codici@azienda.it
LOGBOOK_SMTP_HOST=smtps.aruba.it
LOGBOOK_SMTP_PORT=465
LOGBOOK_SMTP_SICUREZZA=ssl
LOGBOOK_SMTP_UTENTE=casella.che.spedisce@azienda.it
LOGBOOK_SMTP_PASSWORD=la password di quella casella
```

I valori dell'esempio sono quelli di una casella Aruba: con un altro fornitore cambiano
indirizzo del server e porta. Il file `.env` contiene una password: non va mandato a nessuno.

## Dove stanno i dati, e le copie di sicurezza

| Cosa | Dove |
|---|---|
| Tutti i dati (dipendenti, ore, assenze) | `Copilota\data\logbook.db` |
| File caricati (attestati, scontrini, documenti) | `Copilota\data\documenti` |
| Copie di sicurezza automatiche, una al giorno, tenute 30 giorni | `Copilota\data\backup` |
| Impostazioni e password della posta | `Copilota\.env` |

Le copie automatiche stanno **sullo stesso disco**: se il disco si rompe si perdono anche
quelle. Conviene copiare ogni tanto l'intera cartella `Copilota\data` su un altro disco o in
rete, oppure indicare un'altra cartella nella riga `LOGBOOK_BACKUP_DIR` del `.env`.

## Spegnere, riavviare, aggiornare

- **Spegnere**: riavviare il PC, oppure chiudere il processo "Node.js" dalla Gestione attività.
- **Riavviare** (dopo una modifica al `.env`): spegnere come sopra, poi doppio clic sull'icona.
- **Aggiornare a una versione nuova**: spegnere Copilota, copiare i file nuovi sopra quelli
  vecchi **senza toccare la cartella `data` e il file `.env`**, poi doppio clic sull'icona.
  Le modifiche al database vengono applicate da sole e i dati restano.

## Se qualcosa non va

| Cosa succede | Cosa fare |
|---|---|
| L'installatore dice che serve Node.js | Installarlo da <https://nodejs.org> e rilanciare `InstallaLogbook.exe` |
| L'icona non apre nulla dopo tre minuti | Doppio clic su `avvia.bat` nella cartella: la finestra nera mostra l'errore |
| "La porta 5210 è già occupata" | Copilota è già acceso: aprire `http://127.0.0.1:5210` |
| I colleghi non riescono ad aprirlo | Controllare che il PC sia acceso e Copilota avviato; che siano sulla stessa rete; rilanciare `InstallaLogbook.exe` per ricreare la regola del firewall |
| Dal telefono il nome del PC non funziona | Usare l'indirizzo con i numeri scritto dall'installatore |
| L'indirizzo con i numeri ha smesso di funzionare | Il router ha dato al PC un indirizzo nuovo: chiedere a chi gestisce la rete di renderlo fisso |
| Password dell'amministratore dimenticata | Dalla pagina di accesso: *Password dimenticata* (serve la posta configurata) |
| Troppi tentativi sbagliati | Aspettare il tempo indicato: il blocco si toglie da solo |

## Limiti da conoscere

- **Solo rete dell'ufficio.** Così installato Copilota non è raggiungibile da casa o dal
  cantiere. Per quello serve un indirizzo `https` pubblico: è un lavoro a parte.
- **Senza `https` la password viaggia in chiaro** sulla rete dell'ufficio, e il telefono non
  propone di installare Copilota sulla schermata.
- **Capienza**: provato fino a 600 persone collegate insieme senza rallentamenti.

## Per chi fa assistenza

`InstallaLogbook.exe` accetta opzioni dal Prompt dei comandi: `--si` (nessuna domanda, crea
`admin` con una password casuale mostrata a video), `--rete`, `--nome`, `--tunnel`,
`--senza-collegamento`, `--dry-run` (mostra i passi senza eseguirli). Tutte le impostazioni
sono spiegate in `Copilota\.env.example` e in `Copilota\README.md`.
