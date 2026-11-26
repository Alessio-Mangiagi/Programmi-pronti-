<!-- "><(((º> sabusabu <º)))><" -->

# Logbook — ore e presenze dipendenti

Gestionale web per registrare e consultare le ore lavorate dai dipendenti, divise per
fasce orarie e progetti, e per gestire ferie, permessi, malattia e festività. Import delle
ore da Excel ed estrazioni in Excel.

- **Guida d'uso** (per chi usa l'app, con immagini): [docs/guida/README.md](docs/guida/README.md)
- **Storia dello sviluppo e decisioni**: [PROGRESS.md](PROGRESS.md)

## Requisiti

- **Node.js 20.19 o successivo** (sviluppato con Node 24) e npm.
- Nient'altro: il database è un file SQLite dentro la cartella dell'app, non c'è un server
  di database da installare. Serve internet solo per `npm install`.

## Installazione e avvio

```bash
npm install     # dipendenze + client del database (Prisma)
npm start       # prepara il database, compila l'interfaccia e avvia Logbook
```

Poi aprire **http://127.0.0.1:5210**.

Su Windows basta il doppio clic su **`avvia.bat`**: la prima volta installa le dipendenze,
poi avvia tutto e apre il browser. **`avvia.vbs`** fa lo stesso senza finestra (è il
launcher usato dal Portale della suite).

### Dentro e fuori dalla suite (dal 25/11/2026)

Logbook non usa niente della suite (né `shared/` né il login del Portale): la stessa
cartella parte nei due modi, con lo stesso database e lo stesso `.env`.

- **Fuori dalla suite**, su un PC qualsiasi con Node.js 20.19 o successivo:
  1. copiare la cartella `Logbook` (senza `node_modules` e `data`);
  2. fare doppio clic su **`InstallaLogbook.exe`**. Controlla Node.js, installa le
     dipendenze e crea il `.env` (proprietario `admin`; chiede l'email del proprietario e
     se Logbook va raggiunto dagli altri PC). Poi prepara database e interfaccia e mette
     l'icona **Logbook** sul desktop, che avvia `avvia.bat`.

  Node.js non lo installa: se manca dice dove scaricarlo. `InstallaLogbook.exe` si
  ricompila da `installa-logbook.py` (comando in testa al file) e non sta nel repository,
  come `InstallaSuite.exe`.
- **Dentro la suite**: lo installa `InstallaSuite.exe` dalla radice della suite (voce
  Logbook) e lo apre la card **Logbook** del Portale (`avvia.vbs`, senza finestra). Vedi
  "Nella suite Cosedil" più sotto.

Al primo avvio viene creato `data/logbook.db`:

- con **`npm start` / `avvia.bat`** (produzione) il database parte **vuoto**, con il solo
  amministratore `admin` (password di `LOGBOOK_ADMIN_PASSWORD`, oppure `Admin2026!`) e le
  festività nazionali dell'anno in corso e del successivo (dal 25/11/2026): al primo
  accesso Logbook obbliga a scegliere una password nuova, poi HR inserisce dipendenti e
  progetti veri;
- con **`npm run dev`** (sviluppo) arrivano i **dati di esempio** (5 dipendenti, 3 progetti,
  ore dal primo giorno del mese scorso a ieri, qualche assenza, festività nazionali).

`LOGBOOK_DATI_DEMO=1` carica i dati di esempio anche in produzione (copia dimostrativa),
`LOGBOOK_DATI_DEMO=0` li esclude anche in sviluppo. Agli avvii successivi i dati non
vengono mai toccati: le nuove versioni applicano solo le migrazioni mancanti.

### Credenziali di prova (dati di esempio)

| Ruolo | Nome utente | Password |
|---|---|---|
| Amministratore / HR (solo con i dati di esempio di `npm run dev`) | `admin` | `Admin2026!` |
| Dipendente | `mario.rossi`, `giulia.bianchi`, `luca.esposito`, `chiara.ferrari`, `giuseppe.russo` | `Logbook2026!` |

Sono **provvisorie** (Giorno 24): con `npm start` / `avvia.bat`, a ogni avvio Logbook
controlla se l'amministratore o gli account di esempio hanno ancora queste password e,
se sì, al prossimo accesso chiede di sceglierne una nuova prima di mostrare qualsiasi
dato. Lo stesso vale per le password che HR assegna o reimposta ai dipendenti. Se nel
database non c'è nessun amministratore attivo, all'avvio ne viene creato uno (`admin`, con
la password di `LOGBOOK_ADMIN_PASSWORD` o `Admin2026!`), anche lui da cambiare al primo
accesso.

### Partire senza dati di esempio

È il comportamento di `npm start` / `avvia.bat` su un database nuovo (dal 24/11/2026). Un
database che contiene già i dati di esempio non viene svuotato da solo: per ripartire
puliti, fermare Logbook, spostare altrove `data/logbook.db` e riavviare.
`npm run db:reset` invece riporta il database ai **soli** dati di esempio (**cancella tutto**).

### Dati di esempio e "Cancella tutti i dati" (solo il proprietario)

Dal 25/11/2026 il **proprietario** di Logbook trova in **Impostazioni → Dati del programma**
due comandi, senza bisogno del terminale:

- **Carica dati di esempio**: gli stessi dati di `npm run dev`, solo con Logbook vuoto.
  Usano l'amministratore che c'è già e gli account dei dipendenti di esempio chiedono di
  cambiare la password al primo accesso.
- **Cancella tutti i dati**: prima Logbook manda un **codice di 6 cifre per email**
  all'indirizzo del proprietario (valido 10 minuti, una volta sola, 5 tentativi, al massimo
  5 codici all'ora). Poi servono il codice e la parola `CANCELLA`. A cose fatte arriva
  un'email di avviso.
  - Restano l'account del proprietario con la sua password, il collegamento a SkyTower e
    le festività nazionali.
  - Va via tutto il resto: dipendenti, progetti, ore, assenze, documenti e file
    caricati, mansioni, festività locali e aziendali, gli altri account.

Il proprietario è l'account scritto in `LOGBOOK_PROPRIETARIO` nel `.env` del server (deve
essere un amministratore). Non si cambia dall'interfaccia, quindi nessun altro
amministratore può diventarlo, e il codice arriva solo a `LOGBOOK_PROPRIETARIO_EMAIL`.
Logbook non lo chiede al Portale, così funziona allo stesso modo dentro e fuori dalla suite.
Senza server di posta (`LOGBOOK_SMTP_*`) la cancellazione resta spenta: il codice non
finisce mai nel log.

### Saldo ferie e permessi (dal 26/11/2026)

HR scrive per ogni dipendente la quota annua e il residuo di partenza (tabella `QuotaAssenze`,
API `/api/saldi`, riquadro in cima alla pagina Assenze). Il saldo non è salvato: lo calcola
`comune/saldi.ts` a ogni lettura (un dodicesimo della quota per ogni mese lavorato almeno 15
giorni; goduto = assenze approvate fino a oggi, ferie in giorni lavorativi e permessi in
ore). Senza quota non c'è saldo: Logbook non conosce il contratto.

### Chiusura del mese (dal 26/11/2026)

HR chiude un mese finito da *Esporta → Estratti mensili*: tabella `MeseChiuso`, API
`/api/mesi-chiusi` (`server/servizi/mesi-chiusi.ts`). In un mese chiuso il server rifiuta con
409 ore (giornata, blocco, cancellazione, import), assenze (richiesta, modifica, decisione,
cancellazione) e festività; la chiusura è rifiutata se nel mese ci sono richieste di assenza
ancora in attesa. Riaprire è sempre possibile e resta nel registro attività.

### Avvisi via email (dal 26/11/2026)

`server/servizi/avvisi.ts` manda quattro avvisi, ognuno si spegne da *Impostazioni → Avvisi
via email*: richiesta di assenza (a HR), esito (al dipendente), giorni senza ore (una volta
alla settimana) e attestati in scadenza (a 30 e 7 giorni e alla scadenza). Gli avvisi del
giorno partono dal primo controllo dopo le 7: ogni ora sul PC (`server/index.ts`), con Vercel
Cron su Vercel (`/api/cron/avvisi`, protetta da `CRON_SECRET`). Un segno nel database
(tabella `StatoTemporaneo`, chiavi `avviso:…`) evita di mandare due volte la stessa email.
Senza posta configurata non parte nulla.

### Su Vercel (dal 25/11/2026)

Logbook si pubblica anche su Vercel, con un database PostgreSQL esterno al posto del file
SQLite e i file caricati dentro il database: passi, variabili e limiti in
[docs/vercel.md](docs/vercel.md). In locale e nella suite non cambia nulla.

### Sicurezza (dal 25/11/2026)

- **Primo amministratore**: nome utente e password si scelgono all'installazione
  (`InstallaLogbook.exe`, `InstallaSuite.exe`). È il **proprietario**: solo lui dà o toglie
  il ruolo di amministratore (Impostazioni → Dati del programma → Amministratori). Senza
  installatore (`npm start` su un database nuovo) nasce `admin` con una password casuale
  scritta una volta nella finestra di avvio, da cambiare al primo accesso.
- **Password**: almeno 8 caratteri, 12 per gli amministratori, con lettere e numeri; rifiutate
  quelle più comuni.
- **Tentativi sbagliati**: dopo 10 password sbagliate si aspettano 5 minuti; dopo altre 10 il
  doppio (10, 20, 40 minuti… fino a 24 ore). Un accesso riuscito azzera il conto.
- **Codice via email per gli amministratori**: da un PC non ancora riconosciuto, dopo la
  password serve un codice di 6 cifre mandato per email; quel PC resta riconosciuto 30
  giorni. Vale per gli amministratori di cui si conosce l'indirizzo (il proprietario; gli
  altri con l'email della loro scheda dipendente) e solo con la posta configurata.
- **Sessioni**: si chiudono dopo 15 minuti senza toccare mouse o tastiera, e comunque dopo
  12 ore.
- **Registro attività** (menu, solo amministratori): accessi riusciti e falliti, blocchi,
  ruoli, e ogni operazione che modifica o esporta dati, per 400 giorni. Non contiene
  password né il contenuto dei moduli.
- **Copie di sicurezza**: il database si copia con il comando SQL `VACUUM INTO` (copia
  coerente anche a programma acceso) una volta al giorno in `data/backup`
  (`LOGBOOK_BACKUP_DIR`), con i file caricati; restano 30 giorni. Una copia in più parte
  prima di "Cancella tutti i dati" e il proprietario può farne una a mano.
  **Ripristino**: fermare Logbook, copiare il file scelto (es. `logbook-2026-11-25.db`) su
  `data/logbook.db`, riavviare.

## Il modello Excel per importare le ore

1. In Logbook (HR): **Importa → Scarica il modello .xlsx**.
2. Foglio **Ore**, una riga per fascia oraria:

   | Matricola | Data (gg/mm/aaaa) | Ora inizio (HH:MM) | Ora fine (HH:MM) | Codice progetto | Note |
   |---|---|---|---|---|---|
   | 0001 | 20/11/2026 | 08:00 | 12:30 | PRG-001 | facoltative |

   I fogli **Dipendenti** e **Progetti** elencano matricole e codici validi (anche come
   menu a tendina); **Istruzioni** riassume le regole. La riga con la nota
   "RIGA DI ESEMPIO" viene ignorata.
3. **Importa → scegli il file**: l'anteprima controlla ogni riga (campi mancanti, date e
   orari non validi, dipendente o progetto inesistente, sovrapposizioni con altre righe o
   con ore già registrate, giorni futuri, ferie/malattia, progetti chiusi).
4. Con anche un solo errore il file è **rifiutato** con l'elenco delle righe da correggere;
   altrimenti **Conferma e importa** salva tutte le righe insieme.

Le colonne si riconoscono dal nome (l'ordine può cambiare); date e orari vanno bene sia
come testo sia come valori data/ora di Excel.

## Funzioni

| Area | Cosa fa |
|---|---|
| Accesso | Login proprio, ruoli HR e Dipendente, sessioni di 12 ore, blocco dopo 5 tentativi |
| Dashboard | HR: richieste da approvare, giorni senza ore, ore del mese per dipendente e progetto. Dipendente: ore del mese e giorni da registrare |
| Calendario | Mese/settimana, filtri dipendente/progetto/tipo assenza, colori per progetto e assenze, totali, dettaglio del giorno modificabile |
| Ore | Più fasce al giorno, ore calcolate, sovrapposizioni bloccate con messaggio chiaro |
| Anagrafiche | Dipendenti (codice fiscale validato, matricola unica, costo orario netto e lordo, account) e progetti |
| Assenze | Ferie, permessi (ore), malattia (solo protocollo); richiesta → approvazione/modifica/rifiuto di HR |
| Festività | Nazionali calcolate per anno, locali (patrono) e aziendali inserite da HR |
| Import | Modello Excel, anteprima con errori riga per riga, import "tutto o niente" |
| Export | Calendario lavorato (un foglio per dipendente) e ore per progetto (con costo lordo) |
| Estratti mensili | Per mese e dipendente: "mese a calendario" (calendario + anagrafica + progetti) e "giorni e costi" (una riga per giorno con costo netto/lordo, ferie e malattia comprese); anteprima, Excel e stampa/PDF |
| Limiti | Nessun inserimento prima del 01/01/2020; ore massime al giorno per progetto (per dipendente, salvataggio bloccato oltre il limite) |
| Attestati e documenti | Scheda dipendente divisa in schede; attestati con tipo, rilascio, scadenza e file (in dashboard 30 giorni prima della scadenza), documenti del dipendente; file fino a 20 MB in `data/documenti`, controllati anche nel contenuto |
| Impostazioni | Solo admin: collegamento facoltativo a SkyTower (indirizzo, token di servizio della suite, email), con prova |
| Schermi | Interfaccia in flexbox che si adatta da sola: dal cellulare (360px: tabelle a schede, calendario con pallini, editor a riquadri) agli schermi ultra wide (contenuto a tutta larghezza, riquadri affiancati). Regola spiegata in `src/index.css` |

## Accesso e sicurezza

- Utenti e password propri di Logbook (non quelli del Portale della suite).
- Password salvate come impronta scrypt; sessione in un cookie HttpOnly; nel database
  solo l'impronta SHA-256 del token di sessione.
- Un **dipendente** vede e modifica solo i propri dati: il controllo è nelle API, quindi
  vale anche chiamandole direttamente. I costi orari sono visibili solo a HR.
- Ogni richiesta che modifica dati deve avere l'intestazione `X-Logbook: 1` (protezione CSRF).
- Malattia: si conserva solo il numero di protocollo del certificato, mai la diagnosi.

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm start` | Produzione: prepara il DB, compila l'interfaccia, un solo server sulla 5210 |
| `npm run dev` | Sviluppo: API sulla 3012 e interfaccia Vite sulla 5210, si ricaricano a ogni modifica |
| `npm test` | Test automatici (Vitest) |
| `npm run typecheck` | Controllo dei tipi TypeScript di interfaccia e server |
| `npm run build` | Controllo tipi + build dell'interfaccia in `dist/` |
| `npm run db:reset` | **Cancella tutti i dati** e ricarica quelli di esempio (Prisma chiede conferma se lanciato da un assistente AI) |
| `npm run db:seed` | Carica i dati di esempio (solo su database senza dipendenti) |
| `npm run db:migra` | Crea una nuova migrazione dopo una modifica a `prisma/schema.prisma` |
| `npm run db:studio` | Apre Prisma Studio per guardare le tabelle |

`npm start` e `npm run dev` usano entrambi la porta 5210: uno alla volta.

## Configurazione

Tutto ha un default; per cambiarlo copiare `.env.example` in `.env`.

| Variabile | Default | Effetto |
|---|---|---|
| `DATABASE_URL` | `data/logbook.db` | Percorso del database (`file:C:/percorso/logbook.db`) |
| `LOGBOOK_PORT` | `5210` | Porta in produzione (`npm start`) |
| `LOGBOOK_API_PORT` | `3012` | Porta delle API in sviluppo (`npm run dev`) |
| `HOST` / `LOGBOOK_API_HOST` | `127.0.0.1` | Indirizzo di ascolto; `0.0.0.0` per la rete locale |
| `LOGBOOK_ADMIN_REIMPOSTA` | — | `1` = alla preparazione del database reimposta la password dell'amministratore indicato (provvisoria). Per il recupero, da togliere subito dopo: docs/vercel.md |
| `LOGBOOK_ADMIN_USERNAME` / `LOGBOOK_ADMIN_PASSWORD` | `admin` / casuale | Primo amministratore, creato solo se non ne esiste nessuno. Li chiede l'installatore; senza password ne nasce una casuale mostrata una volta all'avvio |
| `DATABASE_URL` (PostgreSQL) | — | Con un indirizzo `postgres://…` Logbook usa PostgreSQL: è la configurazione di Vercel (docs/vercel.md) |
| `LOGBOOK_INDIRIZZO_PUBBLICO` | — | Indirizzo a cui si apre Logbook, messo in fondo alle email di avviso (su Vercel lo trova da solo) |
| `CRON_SECRET` | — | Solo su Vercel: segreto con cui Vercel Cron chiama `/api/cron/avvisi`. Senza, la rotta non risponde e gli avvisi del giorno partono alla prima visita dopo le 7 |
| `LOGBOOK_BACKUP_DIR` | `data/backup` | Cartella delle copie di sicurezza (una al giorno, 30 giorni): meglio un altro disco |
| `LOGBOOK_CODICE_ACCESSO` | attivo | `0` spegne il codice via email all'accesso degli amministratori |
| `LOGBOOK_DATI_DEMO` | sì in sviluppo, no in produzione | `1` / `0`: dati di esempio su un database vuoto (mai su uno già in uso) |
| `LOGBOOK_DOCUMENTI_DIR` | `data/documenti` | Cartella dei file caricati (attestati, documenti, documentazione dei progetti): va nel backup insieme al database |
| `LOGBOOK_COOKIE_SECURE` | — | `1` forza il cookie solo cifrato; dal 25/11/2026 lo diventa da solo quando la richiesta arriva in HTTPS |
| `LOGBOOK_PROPRIETARIO` | — | Username del proprietario (un amministratore): dati di esempio e "Cancella tutti i dati" |
| `LOGBOOK_PROPRIETARIO_EMAIL` | — | Indirizzo che riceve il codice di conferma |
| `LOGBOOK_SMTP_HOST` / `_PORT` / `_SICUREZZA` | — / `587` / `starttls` | Server di posta che spedisce il codice (`ssl` sulla 465) |
| `LOGBOOK_SMTP_UTENTE` / `_PASSWORD` | — | Credenziali della casella che spedisce |
| `LOGBOOK_EMAIL_MITTENTE` | utente SMTP | Indirizzo "Da:" delle email |

## Nella suite Cosedil

Logbook ha la sua card nel **Portale** (id `logbook`, porta 5210, launcher `avvia.vbs`):
il Portale la avvia e la apre, poi si entra con l'account Logbook. Il Portale passa
`HOST` e, con `SUITE_DOMINIO`, Logbook risponde su `https://logbook.<dominio>` dietro Caddy
(`deploy/Caddyfile`) con cookie `Secure`. La cartella nel repository si chiama `Logbook/`;
nel registro del Portale `dir` è `logbook` perché fa anche da sottodominio (su Windows i
percorsi non distinguono maiuscole).

## Struttura

```
comune/      logica pura usata da server e interfaccia: date, orari, codice fiscale,
             festività, regole dei moduli, sovrapposizioni, totali
server/      API Express: app.ts (rotte), index.ts (avvio), rotte/, servizi/ (regole ore,
             Excel, import, report), auth/ (password, sessioni), middleware.ts (ruoli, CSRF)
src/         interfaccia React + Tailwind: pagine/, componenti/
prisma/      schema del database, migrazioni, dati di esempio (seed.ts)
scripts/     prepara-db.ts: migrazioni + dati di esempio prima dell'avvio
docs/guida/  guida d'uso con immagini
data/        database SQLite (fuori da git)
generated/   client Prisma generato (fuori da git, lo ricrea npm install)
```

## Convenzioni dei dati

- Date di calendario salvate come testo `AAAA-MM-GG`, mostrate come `gg/mm/aaaa`.
- Orari `HH:MM` a 24 ore. Una fascia non attraversa la mezzanotte.
- Le ore lavorate non si salvano: si calcolano sempre da inizio e fine della fascia; tutti
  i totali (calendario, dashboard, report) passano da `comune/riepiloghi.ts`.
- Importi (costo orario netto e lordo) in centesimi di euro.

## Stack

React 19 + Vite 7 + TypeScript + Tailwind CSS 4 · Node.js + Express 5 · SQLite con
Prisma 7 (adapter better-sqlite3) · ExcelJS · Zod · Vitest.
