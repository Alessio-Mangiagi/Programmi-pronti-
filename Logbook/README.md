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

Al primo avvio viene creato `data/logbook.db`:

- con **`npm start` / `avvia.bat`** (produzione) il database parte **vuoto**, con il solo
  amministratore `admin` (password di `LOGBOOK_ADMIN_PASSWORD`, oppure `Admin2026!` da
  cambiare subito): HR inserisce dipendenti e progetti veri;
- con **`npm run dev`** (sviluppo) arrivano i **dati di esempio** (5 dipendenti, 3 progetti,
  ore dal primo giorno del mese scorso a ieri, qualche assenza, festività nazionali).

`LOGBOOK_DATI_DEMO=1` carica i dati di esempio anche in produzione (copia dimostrativa),
`LOGBOOK_DATI_DEMO=0` li esclude anche in sviluppo. Agli avvii successivi i dati non
vengono mai toccati: le nuove versioni applicano solo le migrazioni mancanti.

### Credenziali di prova (dati di esempio)

| Ruolo | Nome utente | Password |
|---|---|---|
| Amministratore / HR | `admin` | `Admin2026!` |
| Dipendente | `mario.rossi`, `giulia.bianchi`, `luca.esposito`, `chiara.ferrari`, `giuseppe.russo` | `Logbook2026!` |

Su un database vero cambiarle subito da **Cambia password** (in alto a destra). Se nel
database non c'è nessun amministratore attivo, all'avvio ne viene creato uno (`admin`, con
la password di `LOGBOOK_ADMIN_PASSWORD` o `Admin2026!`).

### Partire senza dati di esempio

È il comportamento di `npm start` / `avvia.bat` su un database nuovo (dal 24/11/2026). Un
database che contiene già i dati di esempio non viene svuotato da solo: per ripartire
puliti, fermare Logbook, spostare altrove `data/logbook.db` e riavviare.
`npm run db:reset` invece riporta il database ai **soli** dati di esempio (**cancella tutto**).

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
| `LOGBOOK_ADMIN_PASSWORD` | `Admin2026!` | Password dell'admin creato solo se non ne esiste nessuno |
| `LOGBOOK_DATI_DEMO` | sì in sviluppo, no in produzione | `1` / `0`: dati di esempio su un database vuoto (mai su uno già in uso) |
| `LOGBOOK_COOKIE_SECURE` | — | `1` dietro HTTPS: il cookie viaggia solo cifrato |

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
