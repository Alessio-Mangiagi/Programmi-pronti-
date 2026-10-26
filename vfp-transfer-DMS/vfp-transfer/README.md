<!-- "><(((º> sabusabu <º)))><" -->
# Trasferimento documenti verso Viewpoint For Projects (Trimble)

Programma Python che carica documenti in Viewpoint For Projects (VFP) in due modi:

- **trasferimento manuale** dei file esportati da un altro DMS: ricrea le cartelle, crea i documenti con la
  loro revisione e carica i file;
- **posta automatica**: controlla di continuo una o più caselle email (Microsoft 365, IMAP, PEC) e carica
  in VFP gli allegati che arrivano. Resta sempre attivo.

## Prerequisiti

1. **Python 3.9+** e la libreria `requests`:
   ```
   pip install -r requirements.txt
   ```
2. **Accesso alle API VFP**: chiedere a Trimble/Viewpoint (support@4projects.com o il proprio referente)
   la registrazione di un'applicazione OAuth2 con:
   - `client_id` (ed eventualmente `client_secret`);
   - redirect URI `http://localhost:8765/callback` (o quello indicato in `VFP_REDIRECT_URI`);
   - scope `vfp.fullaccess offline_access` (`offline_access` è indispensabile per la posta automatica:
     senza, l'accesso scade dopo un'ora e va rifatto a mano).
3. L'utente con cui si fa il login deve avere i permessi di scrittura sul progetto o cartella di destinazione.
4. Per la posta, a seconda della casella:
   - **Microsoft 365 / Outlook**: un'app registrata in Azure (Entra ID) con permesso *applicativo*
     `Mail.ReadWrite` e consenso dell'amministratore (servono tenant ID, client ID, client secret).
     IMAP con password non funziona su Microsoft 365 perché Microsoft lo ha disattivato;
   - **IMAP** (Aruba, Gmail con password per app, ...): server, utente, password;
   - **PEC**: server IMAP della PEC, utente, password.

## Impostazioni e credenziali: `.env` e cassaforte cifrata

Le impostazioni stanno nel file **`.env`** accanto al programma; si compilano dall'interfaccia (scheda
*Impostazioni*) oppure copiando `.env.example` in `.env`, dove ogni voce è spiegata.

**Utenti, password, chiavi e ID delle API** non stanno mai in chiaro: sono nella **cassaforte cifrata**
`cassaforte.dat` (Windows DPAPI, legata all'utente Windows che esegue il programma: copiata su un altro PC o
aperta da un altro utente non si legge). Anche il token di accesso a Viewpoint (`.vfp_token.json`) è cifrato.
Se una credenziale viene scritta nel `.env` (anche a mano), alla prima lettura il programma la sposta nella
cassaforte e la cancella dal file. Entrambi i file sono esclusi da git.

**Codice di autorizzazione via email.** Ogni modifica a utenti, password, credenziali e impostazioni di sicurezza
(indirizzi dei server, mittenti autorizzati, antivirus, invio email...) richiede un codice monouso che il programma
invia **solo all'email dell'amministratore** (`ADMIN_EMAIL`): vale 10 minuti, solo per quella modifica, con 5
tentativi. Finché l'invio email non è configurato la protezione non è attiva (serve per la prima configurazione) e
le Impostazioni lo segnalano in rosso.

- Da terminale: `python cassaforte.py elenco` (voci salvate, mai i valori), `python cassaforte.py imposta CHIAVE`.
  Se l'invio email non funziona, i comandi accettano `--emergenza`: la modifica avviene senza codice e resta
  registrata in `logs/vfp_servizio.log`.
- **Attenzione:** se la password di Windows dell'utente che esegue il programma viene *reimpostata* da un
  amministratore (non cambiata dall'utente stesso), Windows perde le chiavi e la cassaforte non si apre più:
  vanno reinseriti utenti e credenziali.
- Una variabile d'ambiente di Windows con lo stesso nome (es. `VFP_CLIENT_SECRET`) ha la precedenza.
- Il vecchio `config.json`, se presente, viene convertito automaticamente al primo avvio.

## Accesso e utenti

L'interfaccia chiede **nome utente e password**. Due ruoli:

| Ruolo | Cosa vede e fa |
|---|---|
| **Amministratore** | Tutto, in entrambe le aree (Documenti e Posta): impostazioni, trasferimenti, posta, storico, download dei report, gestione utenti |
| **Utente** | La Panoramica **della sua area**, la richiesta del report (indica l'indirizzo email e il report Excel arriva lì e, in copia, all'amministratore: non viene scaricato) e **Confronta documenti** |

**Aree.** Il programma ha due aree: **Documenti** (trasferimento, smistamento, storico, moduli) e **Posta** (flusso
posta, caselle email). L'amministratore passa dall'una all'altra con il selettore in alto a sinistra. Ogni utente
normale ha **una sola area**, scelta dall'amministratore (*Impostazioni > Utenti*, colonna *Area*): vede solo quella,
senza selettore, e il programma gli rifiuta i dati dell'altra area anche se li chiede direttamente. Anche il report
che riceve via email contiene solo la sua area. Gli utenti creati prima delle aree hanno l'area Documenti.

- Gli utenti stanno nella cassaforte cifrata, con la password ridotta a impronta irreversibile (PBKDF2).
  Creare, eliminare un utente o cambiarne password o ruolo richiede il codice inviato all'amministratore.
- Primo amministratore, da terminale nella cartella del programma (la password viene chiesta senza mostrarla):
  ```
  python auth.py aggiungi nome.cognome --ruolo admin
  ```
  Un utente normale con la sua area: `python auth.py aggiungi nome.cognome --area posta` (oppure `documenti`).
  Altri comandi: `python auth.py password NOME`, `python auth.py elimina NOME`, `python auth.py elenco`.
  Gli altri utenti si creano anche dall'interfaccia (*Impostazioni > Utenti*).
- Dopo 5 password sbagliate l'utente viene bloccato per 15 minuti. La sessione scade dopo un'ora di inattività
  e comunque dopo 12 ore; cambiando password o ruolo l'utente deve rientrare.
- Accessi, modifiche alle impostazioni (solo i nomi dei campi, mai i valori), utenti e invii dei report
  vengono scritti in `logs/vfp_servizio.log`.
- Per inviare i report compilare *Impostazioni > Invio del report via email* (email dell'amministratore,
  server SMTP oppure Microsoft 365) e provare con *Invia email di prova*.

## Interfaccia grafica (per il personale)

Doppio clic su **`avvia_interfaccia.bat`**: si apre il browser su `http://127.0.0.1:8770`
(in alternativa `python vfp_gui.py`). Di serie l'interfaccia funziona solo sul PC locale (vedi
*Accesso dagli altri PC* per aprirla dalla rete, solo in HTTPS).

1. **Impostazioni** (una volta sola): credenziali, destinazione (progetto o cartella e relativo ID),
   revisione predefinita, comportamento se il documento esiste, posta e caselle email (con *Prova connessione*).
   Da qui si fa anche l'**accesso a Viewpoint**.
2. **Trasferimento**: si sceglie la cartella esportata (pulsante *Sfoglia*) ed eventualmente il CSV,
   si preme *Analizza file* e si controlla l'anteprima. *Esegui prova* simula tutto senza scrivere in VFP;
   *Avvia trasferimento* carica davvero, con avanzamento ed esito per file.
3. **Panoramica** e **Flusso posta**: situazione del giorno e bacheca delle email (in attesa, in caricamento,
   trasferite, da verificare). **Caselle email**: stato del controllo automatico.
4. **Storico**: il contenuto di `report_trasferimento.csv`, filtrabile e scaricabile in CSV o Excel.
5. In cima alle **Impostazioni**, *Caselle collegate e posta ricevuta*: per ogni casella i conteggi e l'elenco
   delle email arrivate (da chi, oggetto, allegati, esito, tentativi), con filtri per casella, periodo e ricerca,
   e il pulsante **Scarica report Excel**. Un clic su una riga apre il dettaglio dell'email.
6. **Annulla / ripeti** (frecce in alto a destra, oppure `Ctrl+Z` / `Ctrl+Y`): tornano indietro o avanti tra le
   modifiche fatte ai campi delle Impostazioni e della sorgente del Trasferimento, portando al campo e
   evidenziandolo. Le modifiche annullate vanno poi salvate come sempre. Dentro un campo di testo `Ctrl+Z` resta
   l'annulla del browser, lettera per lettera.
   Il pulsante **?** accanto alle frecce (o il tasto `?`) mostra tutte le scorciatoie da tastiera.
   Nelle Impostazioni un indice in alto porta ai settori, i campi modificati e non ancora salvati sono segnati in
   giallo, i campi sbagliati (email, server, porte, indirizzi) vengono segnalati mentre si scrive e le parole
   tecniche hanno una spiegazione al passaggio del mouse sulla "i".
7. **Ricerca unica** (in alto nella barra laterale, oppure `Ctrl+K`): cerca in tutte le email ricevute (mittente,
   oggetto, protocollo, allegati, identificativo PEC) e in tutti i documenti trasferiti (nome, cartella, ID).
8. **Dettaglio di un'email** (clic su una scheda del Flusso posta o su una riga): dati della busta PEC e della
   firma, **anteprima e download degli allegati** salvati, link ai **documenti creati in Viewpoint**
   (con `VFP_DOC_URL`), correzione a mano del protocollo e, per le email in errore, **Riprova adesso**: l'email
   viene rimessa dalla cartella degli errori in quella controllata e ricaricata subito.

## Confronta documenti (tutti gli utenti)

Voce **Confronta documenti** nel menu di sinistra, sotto *Strumenti*: la vedono tutti gli utenti, di qualsiasi
area. Mette a confronto due versioni di un documento (PDF, scansioni con OCR, immagini, Word `.docx`, testo) e
mostra pagina per pagina le righe tolte, aggiunte e cambiate, con le parole modificate evidenziate e in cima il
riepilogo dei **numeri e date cambiati**.

- **Scelta dei file**: trascinandoli nei riquadri A (originale) e B (da controllare), oppure aprendo una cartella
  del PC e usando i pulsanti A/B accanto a ogni file. Dalla cartella si possono avviare **più confronti insieme**:
  *Abbina le versioni* (computo_rev1 / computo_rev2…) o *Confronta con un'altra cartella* (file con nome uguale o
  simile).
- **Impostazioni**: confronto tollerante per le scansioni, intestazioni ripetute ignorate, motore OCR,
  risoluzione, lingua, righe da ignorare; si salvano come **profili** con un nome (nel browser).
- **Risultato**: navigazione tra le differenze (pulsanti o tasti `N` / `P`), filtro *Solo numeri e date*,
  **anteprima** delle pagine affiancate o sovrapposte con le zone diverse riquadrate, vista OCR, zoom.
  Ogni differenza si segna come *vista*, *accettata* o *da chiarire*, con una nota.
- **Report** in PDF e Word, **elenco Excel** delle differenze con la revisione.
- **I miei confronti**: restano 30 giorni. Ogni utente vede solo i suoi, l'amministratore tutti (con il nome
  di chi li ha fatti). Avvio, eliminazione e report scaricati finiscono nel registro attività (categoria Confronti).

Il motore è l'app **confronto-documenti** (cartella accanto a `vfp-transfer-DMS`), con il suo `.venv`: il programma
la avvia da solo, nascosta, solo su `127.0.0.1` e con una password casuale, e la chiude quando si chiude. I file
caricati restano solo il tempo del confronto; risultati e anteprime stanno in `confronti\` (esclusa da git).
Se il motore manca o non parte la pagina lo dice (dettagli in `logs\confronto_motore.log`). Percorsi diversi:
`CONFRONTO_DIR` e `CONFRONTO_PYTHON` nel `.env` (solo sviluppatori, non dall'interfaccia). Per leggere le
scansioni serve Tesseract installato, come per l'app da sola.

## Attività utenti (solo amministratori)

Pagina **Attività utenti**:

- **Sessioni attive**: chi è collegato in questo momento, da quando e ultima richiesta; pulsante *Disconnetti*
  per chiudere subito la sessione di un altro utente.
- **Utenti**: ruolo, ultimo accesso e ultima attività di ciascuno.
- **Contatori**: collegati ora, accessi di oggi, tentativi respinti nelle ultime 24 ore (password sbagliate e
  funzioni riservate tentate da chi non è amministratore), modifiche di oggi.
- **Registro**: accessi, uscite, modifiche a impostazioni e utenti (solo i nomi dei campi, mai i valori),
  codici di autorizzazione, trasferimenti, smistamento AI, report inviati o scaricati, tentativi negati.
  Filtri per categoria, periodo, utente, esito e testo; **Scarica Excel**.

Il registro è in `registro_attivita.jsonl` (escluso da git). Ogni riga contiene l'impronta della precedente:
se qualcuno modifica o toglie righe in mezzo al file, la pagina mostra un avviso rosso. Le ultime righe tolte in
fondo al file non sono rilevabili. Il personale va informato che l'uso del programma viene registrato.

## Smistamento automatico con Claude (solo amministratori)

Pagina **Smistamento AI**: si sceglie la cartella del DMS (export o cartella condivisa), si preme *Proponi le
cartelle* e Claude, leggendo il nome di ogni file e il suo percorso di origine, propone la cartella di Viewpoint
in cui archiviarlo, con un grado di sicurezza e il motivo.

- Claude sceglie solo tra le cartelle **già esistenti** sotto la destinazione VFP (lette all'avvio dell'analisi),
  oppure "Da smistare". Qualsiasi altra risposta viene scartata: un nome di file scritto apposta non può far
  creare cartelle o spostare documenti altrove.
- Le proposte si rivedono in tabella (filtri *Da controllare* e *Da smistare*), si corregge la cartella dove serve,
  si tolgono i file da escludere, poi *Esegui prova* o *Trasferisci selezionati* (stesso avanzamento e ripresa del
  trasferimento normale).
- Ad Anthropic vengono inviati **solo nomi di file, percorsi e nomi delle cartelle VFP**, mai il contenuto.
- Serve la chiave API di Anthropic (*Impostazioni > Smistamento con Claude*, `ANTHROPIC_API_KEY`); modello in
  `CLAUDE_MODEL`. Fino a 2.000 file per analisi, 80 per richiesta.

## Posta automatica

Con `MAIL_ENABLED=true` il programma controlla le caselle attive (`MAIL_SOURCES`) ogni `MAIL_POLL_SECONDS` secondi.
Per ogni email con allegati:

1. salva gli allegati in `posta_in_arrivo/` (copia locale);
2. li carica in VFP nella cartella `MAIL_VFP_FOLDER` (sotto la destinazione), con nome
   `AAAA-MM-GG HHMM nomefile` (data di arrivo, disattivabile con `MAIL_DATE_PREFIX=false`) e descrizione
   "Email da mittente: oggetto";
3. sposta l'email nella cartella `MAIL_DONE_FOLDER` ("Trasferite a VFP"), creata se non esiste.

Se un caricamento fallisce l'email resta dov'è e viene ritentata al giro successivo, ricaricando solo i file
mancanti; dopo `MAIL_MAX_ATTEMPTS` tentativi viene spostata in `MAIL_ERROR_FOLDER` ("Errori VFP").
Per la PEC i documenti vengono presi dalla busta `postacert.eml` (vedi *PEC: busta, firma, ricevute e
protocollo*). Le email senza allegati utili (o con sole immagini della firma) restano nella casella e non
vengono più riesaminate. Consigliata una casella dedicata (es. documenti@...): vengono elaborate tutte le
email con allegati presenti nella cartella letta.

### Controlli di sicurezza sulla posta

Prima di caricare qualunque cosa ogni email viene controllata. Se non supera i controlli **nessun file entra in
VFP**: l'email viene spostata nella cartella `MAIL_QUARANTINE_FOLDER` ("Bloccate VFP") della casella, compare come
*Bloccata* con il motivo, e va controllata a mano. Motivi di blocco:

- mittente non presente in `MAIL_ALLOWED_SENDERS` (indirizzi o domini; se vuoto si accetta chiunque: sconsigliato);
- mittente segnato come falsificato dal server di posta (SPF/DKIM/DMARC, `MAIL_REQUIRE_AUTH`); per la PEC
  l'identità è garantita dal gestore e il mittente considerato è quello dentro la busta;
- allegato pericoloso: eseguibili, script, pagine web, documenti con macro (sempre, qualunque cosa dica
  `MAIL_ALLOWED_EXT`); gli allegati con estensioni non in elenco vengono invece solo scartati;
- email più grande di `MAIL_MAX_MB` (non viene nemmeno scaricata);
- minaccia trovata da **Windows Defender** (`MAIL_ANTIVIRUS`); la copia locale viene cancellata. Se Defender non
  è disponibile l'email resta in casella e la casella segnala l'errore: con un altro antivirus disattivare
  `MAIL_ANTIVIRUS` solo se quell'antivirus controlla la cartella `posta_in_arrivo`.

Le connessioni IMAP, SMTP e HTTPS verificano sempre il certificato del server.

Se l'accesso a Viewpoint scade (refresh token revocato), le email restano in attesa e l'interfaccia lo segnala:
basta premere *Accedi a Viewpoint* e la posta riparte da sola.

### PEC: busta, firma, ricevute e protocollo

Per ogni PEC il programma legge `daticert.xml` (tipo, gestore, data certificata, identificativo, destinatari) e
verifica la **firma del gestore** (`smime.p7s`) con le funzioni crittografiche di Windows: *valida* = la busta è
integra; *NON valida* = la busta è stata modificata, e l'email finisce in quarantena senza caricare nulla. La
verifica non controlla che il gestore sia nell'elenco AgID. Tipo, firma e identificativo finiscono nel registro e
nel report Excel.

Le **ricevute** (accettazione, avvenuta consegna, mancata consegna...) non contengono documenti: restano nella
casella e vengono registrate come *Ricevuta PEC* con destinatario e data, per il tracciamento.

Il **numero di protocollo** si legge dall'oggetto (`protocollo.py`): "Prot. n. 0012345/2026", la numerazione
annuale da 001 in testa all'oggetto ("001 - ...", anche oltre 999), "PG/2026/123", "REGISTRO UFFICIALE(U).123" e
altri formati comuni. Se il numero non contiene l'anno si aggiunge quello di arrivo (001/2026). Il protocollo:

- compare in tutte le pagine, è cercabile ed è nella descrizione del documento in Viewpoint ("Prot. 001/2026 - Email da ...");
- si può **correggere a mano** dal dettaglio dell'email (salvato in `protocolli_manuali.json`, registrato nelle attività);
- si può adattare con una **regola personalizzata** (`PEC_PROTOCOL_REGEX`), da provare in Impostazioni ›
  *Protocollo PEC* prima di salvarla: la prova mostra come cambierebbero le ultime PEC;
- è **controllato**: in Panoramica, per ogni anno, numeri mancanti e doppi. Se i numeri non formano una
  sequenza (protocolli di enti diversi) il controllo dei mancanti non si applica;
- è esportabile nel **registro dei protocolli** in Excel (`/api/protocolli.xlsx?anno=2026`), con il foglio del controllo.

## Sempre attivo: avvio automatico con Windows

Eseguire **`installa_avvio_automatico.ps1`** (tasto destro > *Esegui con PowerShell*). Crea l'operazione
pianificata "Cosedil - Trasferimento VFP" che:

- avvia il programma all'accesso a Windows, senza finestre (`pythonw vfp_gui.py --service`);
- ogni 5 minuti controlla che sia in esecuzione e, se si è chiuso, lo riavvia;
- se termina per un errore lo riavvia dopo un minuto.

Dentro il programma ogni errore (rete, casella, VFP) viene registrato e si riprova al giro successivo: il
controllo della posta non si ferma. Registro: `logs/vfp_servizio.log` (5 file da 5 MB a rotazione).
Il PC non deve andare in sospensione. Per togliere l'avvio automatico: `rimuovi_avvio_automatico.ps1`.

**Controllo dello stato**: `http://127.0.0.1:8770/api/salute` (solo da questo PC, senza accesso) risponde 200 se
tutto gira e 503 con l'elenco dei problemi (controllo posta fermo o bloccato, accesso a Viewpoint da rifare,
impostazioni incomplete): utile per un monitoraggio esterno. Lo stesso stato è in Impostazioni › *Stato del
programma*. Una **sorveglianza interna** chiude il programma se il controllo della posta si blocca per più di
30 minuti (mai durante un caricamento): l'operazione pianificata lo riavvia dopo un minuto.

### Accesso dagli altri PC

Di serie il server ascolta solo su `127.0.0.1`. Per aprirlo alla rete dell'ufficio (Impostazioni › *Accesso dalla
rete*, protetto dal codice all'amministratore): `GUI_BIND=0.0.0.0`, `GUI_HOSTNAME` (nome con cui gli altri PC
raggiungono questo) e un **certificato HTTPS** per quel nome (`GUI_TLS_CERT`, `GUI_TLS_KEY`, file .pem forniti
dall'IT). Senza certificato valido il programma resta solo locale e lo scrive nel registro. Vale dal riavvio.
Sul firewall di Windows aprire solo la porta dell'interfaccia e solo verso la rete dell'ufficio.
Avviando `avvia_interfaccia.bat` mentre il servizio è già attivo si apre solo la pagina, senza un secondo programma.

## Uso da riga di comando

**Modalità cartella.** La struttura delle sottocartelle diventa la struttura delle Document Folders.
Ogni file diventa un documento con nome uguale al nome del file senza estensione.
```
python vfp_transfer.py --source "D:\export_dms"
```

**Modalità manifest.** Il CSV indica per ogni file la cartella di destinazione, il nome, la revisione e la descrizione
(vedi `manifest.example.csv`). Più righe con la stessa cartella e lo stesso nome, in ordine, diventano lo
**storico delle revisioni** dello stesso documento.
```
python vfp_transfer.py --source "D:\export_dms" --manifest manifest.csv
```

**Prova senza scrivere nulla in VFP:** aggiungere `--dry-run`. Le impostazioni vengono lette da `.env`
(un file diverso con `--env percorso\.env`). Solo posta, senza interfaccia: `python vfp_mail.py`.

## Estrazione dal DMS di origine via API (sola lettura)

`estrai_dms.py` scarica documenti e revisioni dal DMS di origine in una cartella locale con `manifest.csv`, da
caricare poi con la modalità manifest. Il DMS viene letto **una sola volta per file**: se il caricamento su VFP va
rifatto, si riparte dalla copia locale. Per ora c'è l'adattatore per **SeedDMS** (`SorgenteSeedDms`).
```
python estrai_dms.py --url https://dms/restapi/index.php --user lettore --cartella 12 --dry-run
python estrai_dms.py --url https://dms/restapi/index.php --user lettore --cartella 12 --dest D:\estrazione
python vfp_transfer.py --source D:\estrazione --manifest D:\estrazione\manifest.csv --dry-run
```
La password si chiede a video (oppure variabile `SEEDDMS_PASSWORD`). `--cartella` è l'ID della cartella da estrarre
(per esempio una commessa); le sue sottocartelle diventano le cartelle in VFP.

Protezioni per il DMS:
- **solo lettura**: il programma blocca da sé ogni chiamata che non sia una lettura (l'unica eccezione è il login);
  conviene comunque un utente tecnico con i soli permessi di lettura;
- **carico basso**: una richiesta alla volta, al massimo `--richieste-al-secondo` (predefinito 2), dimezzate da sole
  se il DMS chiede di rallentare (429); nuovi tentativi con attesa crescente su errori temporanei;
- **stop automatico** dopo `--max-errori` errori di fila (predefinito 10): rilanciando riprende da dove si era fermato;
- **finestra oraria**: `--orario 20:00-07:00` lavora solo di notte, fuori aspetta;
- **integrità**: download in `.part`, controllo della dimensione dichiarata dal DMS, SHA-256 in `stato_estrazione.json`.
  Rilanciando si scaricano solo le versioni mancanti o nuove. Esito di ogni file in `report_estrazione.csv`.

Le cartelle vuote non compaiono nel manifest (in VFP si creano solo le cartelle che contengono documenti).

### DMS di prova

Per provare senza toccare il DMS vero: SeedDMS portabile su questo PC (`avvia_seeddms.bat`, http://127.0.0.1:8780,
utente `admin`). `python strumenti_prova\popola_seeddms.py` lo riempie con due commesse finte (cartelle, revisioni,
nomi con caratteri speciali, un file da 12 MB); scrive nel DMS e per questo funziona solo verso 127.0.0.1.

## Moduli autocompilati (in costruzione)

Da un documento che non è una lettera (DDT, verbale, certificato, fattura...) il programma compila una maschera, la
fa rivedere all'utente e salva il **PDF del modulo compilato**. Per ora c'è la logica, con una prova da riga di comando;
la pagina arriverà insieme ai moduli veri.
```
python moduli.py --modulo esempio_ddt --file D:\documenti\ddt.pdf          (solo lettura sul PC)
python moduli.py --modulo esempio_ddt --file D:\documenti\ddt.pdf --ai     (completa con Claude i campi mancanti)
```
- **Prima senza AI**: il testo del documento (PDF con testo, Word .docx, .txt) viene letto sul PC e i campi si trovano
  con le regole del modulo (etichette come "DDT n.", "Data documento", oppure un'espressione regolare).
- **Poi, solo se serve, Claude**: per i soli campi mancanti (o per scansioni e foto, che sul PC non si leggono).
  Il documento viene inviato ad Anthropic **solo** se `MODULI_AI` lo permette: `no` = mai, `conferma` (predefinito)
  = solo quando l'utente lo chiede, `auto` = subito. Cambiarlo richiede il codice inviato all'amministratore.
- **Controlli su ogni valore**, letto sul PC o da Claude: date vere, importi, partite IVA con cifra di controllo,
  scelte tra le opzioni del modulo. Un valore che non torna viene scartato e il campo resta da compilare.
- **Revisione e conferma**: l'utente corregge e conferma; servono tutti i campi obbligatori. Per ogni campo resta
  scritto da dove viene (documento, AI, manuale). Archivio in `moduli_compilati/` con la copia del documento.
- **Origini dei documenti**: file caricato, allegati della posta, una cartella (anche un'estrazione dal DMS), il DMS
  direttamente via API (`DMS_URL`, `DMS_USER`, `DMS_PASSWORD`, in sola lettura). CPM e Alyante sono previsti: per
  collegarli servono la documentazione e le credenziali delle loro API.

**Dati del fornitore.** I campi con ambito `fornitore` (ragione sociale, IBAN del conto dedicato, persone delegate...)
valgono solo per quel fornitore, riconosciuto dalla partita IVA: alla prima conferma vanno nella sua **anagrafica**
(`moduli_compilati/fornitori/`) e dal documento successivo si compilano da soli. Un dato registrato non viene mai
sostituito da quello letto in un documento: se è diverso (per esempio un IBAN cambiato, tipico delle truffe) resta
quello registrato con un avviso, e per cambiarlo alla conferma serve una scelta esplicita; resta lo storico di chi
l'ha cambiato e quando. I campi `fisso` (per esempio il committente) sono uguali per tutti.

**Sezioni con testo fisso.** Una sezione (per esempio *Art. 1 - Obblighi di tracciabilità finanziaria*) ha lo stesso
testo per tutti i fornitori, con i dati del singolo fornitore al posto di `{iban_dedicato}`, `{delegati}`, `{cig}`...
Vedi `moduli/esempio_tracciabilita.json` (testo indicativo, da sostituire con quello dei vostri contratti).

Un modulo è un file `moduli/<id>.json` (vedi `moduli/esempio_ddt.json`): nome, campi (tipo, obbligatorio, etichette da
cercare, regex facoltativa) e, se c'è, il PDF compilabile da riempire (`pdf` + `pdf_campo` per ogni campo). Senza PDF
compilabile il programma genera una scheda PDF con tutti i campi.

## Archivio SQL in sola lettura (Alyante, data lake)

`sorgente_sql.py` legge i documenti direttamente da un database SQL Server (es. quello di Alyante o un data lake con
endpoint SQL) e li carica in VFP, senza export manuali. **Non scrive mai nel database**: esegue solo `SELECT`, apre
la connessione in sola lettura e va usato con un utente SQL che ha **solo** il ruolo `db_datareader`.

**Cosa chiedere all'IT**
1. il driver **ODBC Driver 18 for SQL Server** installato su questo PC (serve l'amministratore; senza, si usa il
   vecchio driver "SQL Server" di Windows, che non va bene per i database in cloud);
2. server, nome del database e un utente di sola lettura (oppure accesso con l'utente Windows o un'app Entra ID);
3. una **vista** dedicata con queste colonne (i nomi contano, le maiuscole no):

| colonna | contenuto | |
|---|---|---|
| `id` | identificativo del documento | obbligatoria |
| `nome_file` | nome del file con estensione | obbligatoria |
| `contenuto` | il file (varbinary) — con `SQL_FILE_MODE=contenuto` | una delle due |
| `percorso` | percorso del file in rete — con `SQL_FILE_MODE=percorso` | una delle due |
| `cartella` | cartella di destinazione in VFP, separata da `/` | facoltativa |
| `nome` | nome del documento in VFP (vuota = nome del file) | facoltativa |
| `revisione` | revisione (vuota = `VFP_DEFAULT_REVISION`) | facoltativa |
| `descrizione` | descrizione | facoltativa |
| `modificato` | data di modifica: a ogni giro si leggono solo le novità | facoltativa |

Così il programma non dipende dalle tabelle interne del gestionale: se cambiano, basta aggiornare la vista.

**Impostazioni** nel `.env`, sezione *archivio SQL* (`SQL_SERVER`, `SQL_DATABASE`, `SQL_VIEW`, `SQL_AUTH`...);
utente e password finiscono nella cassaforte cifrata. Con `SQL_FILE_MODE=percorso` i file devono stare sotto
`SQL_PATH_ROOT`: quelli fuori vengono saltati.

```
python sorgente_sql.py prova                    # collegamento, colonne della vista, numero di documenti
python sorgente_sql.py trasferisci --dry-run    # scarica e mostra cosa verrebbe caricato
python sorgente_sql.py trasferisci              # carica in VFP
```

I file presi dal database vengono scritti in `specchio_sql\<id>\<revisione>\` (`SQL_CACHE_DIR`). La data dell'ultima
modifica letta sta in `stato_sql.json` e avanza solo se il giro finisce senza errori; i documenti già caricati vengono
riconosciuti da `stato_trasferimento.json`, lo stesso dell'interfaccia. Non lanciarlo mentre dall'interfaccia è in
corso un trasferimento.

## Avvio in VS Code

1. Installare Python da https://www.python.org/downloads/ (spuntare "Add python.exe to PATH").
2. Aprire la cartella del progetto in VS Code e, nel terminale, creare l'ambiente virtuale:
   ```
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```
   L'avvio automatico e `avvia_interfaccia.bat` usano `.venv` se presente.

## Output e ripresa

- `report_trasferimento.csv`: esito di ogni file (caricato, saltato, errore) con l'ID del documento,
  sia dei trasferimenti manuali sia della posta.
- `stato_trasferimento.json`: file già caricati e file con documento creato ma upload non concluso.
  Se il programma si interrompe riparte da dove si era fermato e, per i file a metà, ricarica solo il file
  senza creare un'altra revisione. Se una revisione di un documento fallisce, le successive dello stesso
  documento non vengono caricate (altrimenti alla ripresa la revisione mancante finirebbe sopra di loro).
- `stato_posta.json`: tentativi in corso, email ignorate e cronologia recente delle email elaborate.
- `registro_posta.csv`: registro permanente di tutte le email viste, anche quelle senza allegati (data, casella,
  mittente, oggetto, allegati, esito, dettaglio, Message-ID, documenti creati in VFP, dati della busta PEC).
  È la base dell'elenco nelle Impostazioni, della ricerca e del report Excel. Un registro scritto da una versione
  precedente viene riscritto da solo con le colonne nuove.
- `protocolli_manuali.json`: protocolli corretti a mano.
- **Report Excel** (`/api/report.xlsx`, dai pulsanti dell'interfaccia): fogli *Riepilogo*, *Email* (una riga per
  email, con tentativi) e *Trasferimenti* (una riga per file, con origine Email o Cartella), con filtri e date
  ordinabili. Generato senza librerie aggiuntive; rispetta periodo e casella scelti nell'elenco.

## Sicurezza: cosa configurare fuori dal programma

Il programma è protetto da login, accetta solo collegamenti dallo stesso PC, rifiuta le richieste di altri siti e
impedisce di dirottare le password cambiando l'indirizzo di un server (va reinserita). Restano da fare a cura
dell'IT:

1. **App Azure limitata alla sola casella** (Application Access Policy o RBAC for Applications di Exchange Online):
   senza, il permesso `Mail.ReadWrite`/`Mail.Send` vale per tutte le caselle dell'azienda.
2. **Account Viewpoint dedicato** al programma, con i soli permessi sui progetti di destinazione.
3. **Permessi della cartella del programma**: lettura e scrittura solo per l'utente Windows che lo esegue e per
   gli amministratori. Contiene `.env`, `cassaforte.dat` e `.vfp_token.json`. Disco cifrato con BitLocker.
4. **Python installato per tutti** (in `Program Files`) e libreria `requests` installata dall'IT, non al primo avvio.
5. **Conservazione dei dati**: decidere per quanto tenere `posta_in_arrivo/`, `registro_posta.csv` e i log.

## Test

Dalla cartella `vfp-transfer`: `python -m unittest discover -s tests -t .` (nessuna libreria aggiuntiva).
I test non toccano Viewpoint, le caselle o i file del programma. La PEC firmata di prova
(`tests/fixtures/pec_firmata.eml`) si rigenera con `python tests/fixtures/genera_pec_firmata.py`.

## Note

- I file sopra i 100 MB vengono caricati in multipart (parti da 64 MB) e VFP non li scansiona per virus.
- Dopo l'upload VFP elabora il file per qualche minuto: nel frattempo appare con dimensione 0 e stato "Pending".
- I nomi di documenti e cartelle sono troncati a 100 caratteri (limite di VFP).
- In modalità cartella vengono ignorati i file di sistema (`Thumbs.db`, `desktop.ini`, file nascosti, temporanei Office `~$...`).
- Con destinazione `project` i file nella radice dell'export vengono segnalati come errore: in VFP un documento
  deve stare in una cartella.
- Su alcuni server IMAP (es. Aruba) le cartelle create stanno sotto la Posta in arrivo: in quel caso indicare
  `MAIL_DONE_FOLDER="INBOX.Trasferite a VFP"`.
