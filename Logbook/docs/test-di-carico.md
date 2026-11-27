<!-- "><(((º> sabusabu <º)))><" -->

# Copilota installato su un PC: quanti utenti regge

Prova di carico del 27/11/2026 sulla versione che gira su un PC (un solo processo Node,
database SQLite), fatta su una **copia** del database e su una porta separata: il Copilota
vero non è stato toccato.

## In breve

| Domanda | Risposta |
|---|---|
| Utenti che lo usano insieme senza accorgersene | **fino a 600** (pagine sotto il mezzo secondo, nessun errore) |
| Dove comincia a soffrire | fra 600 e 1000: a 1000 le pagine passano i 4 secondi e il 7% delle richieste viene rifiutato |
| Richieste al secondo che il server riesce a servire | **circa 295**, e non di più: usa un solo core del processore |
| Accessi (login) al secondo | **circa 65**: 300 persone che entrano nello stesso istante aspettano fino a 4,4 secondi |
| Timbrature al secondo | **circa 70**: 300 timbrature nello stesso istante si smaltiscono in 4,3 secondi, senza errori |
| Memoria del server | 600–800 MB in uso normale, 1,4 GB sotto sovraccarico |

Per un'azienda di qualche centinaio di dipendenti il PC basta con largo margine: il caso
peggiore reale (tutti che timbrano alle 8:00) è lontano dal limite.

## Come è stata fatta

- **Macchina**: questo PC, 20 processori logici, Node 24, Copilota avviato come in produzione
  (`tsx server/index.ts --produzione`) sulla porta 5299. Il programma di prova girava sullo
  stesso PC: i tempi non comprendono la rete dell'ufficio.
- **Dati**: 300 dipendenti con account, 5 amministratori (HR), 12 progetti, sei mesi di ore
  (77.400 fasce). Sono i dati di `scripts/carico/semina.cjs`.
- **Utenti virtuali**: ognuno con la sua connessione, il suo cookie di sessione e un suo
  indirizzo (`scripts/carico/carico.mjs`).
- "p95" = il tempo entro cui sta il 95% delle richieste: è quello che si avverte usando il programma.

## Risultati

### Uso normale: una pagina ogni 3–10 secondi, 2% degli utenti è HR

Ogni dipendente apre a caso dashboard, calendario, timbratura, assenze, note spese; HR apre
dashboard, calendario di tutti, elenco dipendenti, costi e ogni tanto scarica un Excel.

| Utenti insieme | Richieste/s | Pagina: tempo tipico | Pagina: p95 | Errori | CPU del server |
|---:|---:|---:|---:|---:|---:|
| 100 | 27 | 8 ms | 34 ms | 0 | 14% di un core |
| 300 | 78 | 12 ms | 101 ms | 0 | 38% |
| 600 | 153 | 54 ms | 375 ms | 0 | 69% |
| 1000 | 208 | 726 ms | 4,1 s | 7,1% | 86% |

A 1000 utenti gli errori sono connessioni rifiutate: il server era fermo su un Excel di HR
(41 secondi invece di mezzo) e la coda delle connessioni in attesa si è riempita. Il server
non è caduto: finita la prova rispondeva normalmente.

### Portata massima: utenti che chiedono senza mai fermarsi

| Utenti insieme | Richieste/s | Tempo tipico | p95 |
|---:|---:|---:|---:|
| 1 | 274 | 2 ms | 14 ms |
| 10 | 294 | 31 ms | 57 ms |
| 50 | 295 | 164 ms | 218 ms |
| 100 | 293 | 331 ms | 411 ms |
| 300 | 297 | 965 ms | 1,1 s |

La portata non cresce con gli utenti: il server lavora su un core solo (sempre al 97%),
gli altri 19 restano fermi. Più utenti significa solo più coda.

### Accessi insieme

| Login nello stesso istante | Tempo totale | Attesa tipica | Attesa peggiore |
|---:|---:|---:|---:|
| 25 | 0,7 s | 0,3 s | 0,4 s |
| 100 | 2,0 s | 1,0 s | 1,7 s |
| 300 | 4,6 s | 2,7 s | 4,4 s |

Il costo è la verifica della password (scrypt), voluta lenta per sicurezza.

**Limite trovato**: con 60 accessi nello stesso istante **dallo stesso indirizzo**, 30 vengono
respinti con "Troppi tentativi sbagliati da questo indirizzo" anche se le password sono
giuste. È il freno dei 30 tentativi per indirizzo in 15 minuti (`registraIndirizzo` in
`server/rotte/auth.ts`): il tentativo si conta subito e si scala solo a login riuscito, quindi
più di 30 accessi contemporanei dallo stesso indirizzo sbattono contro il tetto. In rete
locale ogni PC e telefono ha il suo indirizzo e non succede. Può succedere se Copilota è
raggiunto da internet e molti dipendenti entrano insieme dal Wi-Fi dello stesso cantiere o
ufficio, che esce con un indirizzo solo.

### Picco delle timbrature (300 dipendenti)

| Prova | Tempo tipico | p95 | Peggiore | Errori |
|---|---:|---:|---:|---:|
| 300 entrate sparse in 30 secondi | 11 ms | 25 ms | 58 ms | 0 |
| 300 uscite sparse in 5 secondi | 36 ms | 310 ms | 347 ms | 0 |
| 300 uscite nello stesso istante | 2,0 s | 3,9 s | 4,1 s | 0 |
| 300 entrate nello stesso istante | 2,1 s | 4,2 s | 4,4 s | 0 |

Le scritture passano una alla volta: SQLite è in modalità `journal_mode=delete` con
`synchronous=FULL`, cioè ogni scrittura aspetta che il disco confermi (circa 14 ms l'una).
Nessuna timbratura persa o doppia.

### Operazioni pesanti di HR, e quanto fermano gli altri

Mentre HR faceva l'operazione, un dipendente chiedeva l'ora al server ogni 25 ms.

| Operazione (300 dipendenti) | Durata | Dimensione | Gli altri restano fermi fino a |
|---|---:|---:|---:|
| Calendario di tutti, un mese | 174 ms | 5,0 MB | 145 ms |
| Estratto del mese a schermo | 123 ms | 3,1 MB | 112 ms |
| Excel per il consulente, un mese | 544 ms | 449 kB | 385 ms |
| Excel calendario lavorato, un mese | 641 ms | 841 kB | 430 ms |
| Excel per il consulente, tre mesi | 1,5 s | 1,3 MB | 1,0 s |
| Costi dei progetti | 89 ms | 4 kB | 74 ms |

Mentre il server costruisce un Excel non risponde a nessun altro. Con un HR che scarica ogni
tanto non si nota; con tanti Excel lunghi insieme sì.

## Cosa limita, in ordine

1. **Un core solo.** Tutto il lavoro (richieste, database, Excel) passa da un unico filo di
   esecuzione: il tetto è circa 295 richieste al secondo qualunque sia il PC.
2. **Excel e calendari grandi fermano tutti** per la loro durata.
3. **Scritture una alla volta**, circa 70 al secondo.
4. **Tetto dei 30 accessi per indirizzo** quando tanti entrano insieme da dietro lo stesso router.

Nessuno dei quattro è un problema alle dimensioni attese (qualche centinaio di dipendenti).
Se servisse più margine, in ordine di resa: SQLite in modalità WAL (scritture più rapide e
letture che non aspettano), contare per indirizzo solo i tentativi falliti, spostare la
costruzione degli Excel fuori dal filo principale.

## Limiti della prova

- Prova e server sullo stesso PC: niente rete, e il programma di prova ha tolto un po' di
  processore al server.
- Solo le chiamate al server: non il caricamento di pagine, script e immagini (600 kB la
  prima volta, poi in memoria del browser).
- File allegati (scontrini, documenti) non compresi.
- Durata breve (40 secondi per livello): non dice nulla su giorni di uso continuo.
- Non provata la versione su Vercel: lì database e limiti sono altri.

## Rifarla

Dalla cartella `Logbook`, con una cartella di lavoro `X` fuori dal repository:

```bash
# 1. copia del database (mai lavorare sull'originale) e dati di prova
node -e 'const D=require("better-sqlite3");new D("data/logbook.db",{readonly:true}).backup(process.argv[1])' X/copia.db
H=$(npx tsx -e 'import("./server/auth/password.ts").then(async m=>process.stdout.write(await m.creaImpronta("Carico2026!prova")))')
node scripts/carico/semina.cjs X/copia.db "$H"

# 2. Copilota di prova sulla 5299: niente posta, niente codice via email, solo questo PC
DATABASE_URL="file:X/copia.db" LOGBOOK_PORT=5299 LOGBOOK_API_HOST=127.0.0.1 \
LOGBOOK_DOCUMENTI_DIR=X/documenti LOGBOOK_BACKUP_DIR=X/backup \
LOGBOOK_SMTP_HOST= LOGBOOK_CODICE_ACCESSO=0 npx tsx server/index.ts --produzione

# 3. le fasi, una alla volta (i numeri finiscono anche in scripts/carico/esito-<fase>.json)
node scripts/carico/carico.mjs pesanti
node scripts/carico/carico.mjs login
node scripts/carico/carico.mjs portata
node scripts/carico/carico.mjs picco        # prima di ripeterla: cancellare le timbrature di oggi dalla copia
node scripts/carico/carico.mjs realistico
```

`LOGBOOK_SMTP_HOST=` vuoto è indispensabile: senza, la prova userebbe la posta vera del `.env`.
