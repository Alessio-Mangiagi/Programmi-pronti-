<!-- "><(((º> sabusabu <º)))><" -->

# Copilota su Vercel

Dal 25/11/2026 Copilota si può pubblicare su Vercel, oltre che installare su un PC o nella
suite. Il programma è lo stesso; cambia dove tiene i dati, perché su Vercel non c'è un disco
che dura né un server sempre acceso.

| | Su un PC / nella suite | Su Vercel |
|---|---|---|
| Database | file `data/logbook.db` (SQLite) | PostgreSQL esterno (es. Neon) |
| File caricati | cartella `data/documenti`, fino a 20 MB | nel database, fino a 4 MB l'uno |
| Codici via email, blocco dei tentativi | memoria del server e database | database |
| Copie di sicurezza | una al giorno in `data/backup` | le fa il servizio del database |
| Indirizzo | `http://127.0.0.1:5210` | `https://<progetto>.vercel.app`, sempre HTTPS |

## Pubblicare: i passi

1. **Progetto.** Su vercel.com: *Add New → Project*, scegliere il repository GitHub
   `Programmi-pronti-`. In **Root Directory** indicare `Logbook`. Come *Framework Preset*
   lasciare **Other**: i comandi li dà già `Logbook/vercel.json`.
   **La prima pubblicazione fallisce, ed è normale**: Vercel la fa partire subito, quando il
   database non è ancora collegato, e la build si ferma con "manca DATABASE_URL". Si collega
   il database (passo 3), si mettono le variabili (passo 4) e si ripubblica (passo 5).
2. **Ramo.** Dal 25/11/2026 il codice è su `main`, che è già il ramo di produzione di Vercel:
   non serve cambiare nulla.
3. **Database.** Nella scheda *Storage* del progetto: *Create Database → Neon (Postgres)*,
   regione **Frankfurt (eu-central-1)**, e collegarlo al progetto. Vercel aggiunge da solo
   `DATABASE_URL` (e `DATABASE_URL_UNPOOLED`) alle variabili d'ambiente.
4. **Variabili d'ambiente** (*Settings → Environment Variables*), per l'ambiente Production:

   | Variabile | Valore |
   |---|---|
   | `LOGBOOK_ADMIN_USERNAME` | nome utente del primo amministratore, es. `alessio` |
   | `LOGBOOK_ADMIN_PASSWORD` | la sua password: almeno 12 caratteri, lettere e numeri |
   | `LOGBOOK_PROPRIETARIO` | lo stesso nome utente: è il proprietario |
   | `LOGBOOK_PROPRIETARIO_EMAIL` | indirizzo che riceve i codici |
   | `LOGBOOK_SMTP_HOST` | `smtps.aruba.it` |
   | `LOGBOOK_SMTP_PORT` | `465` |
   | `LOGBOOK_SMTP_SICUREZZA` | `ssl` |
   | `LOGBOOK_SMTP_UTENTE` | la casella che spedisce |
   | `LOGBOOK_SMTP_PASSWORD` | la sua password (segnare la variabile come *Sensitive*) |
   | `CRON_SECRET` | una stringa casuale lunga: la usa Vercel Cron per far partire ogni mattina gli avvisi via email |

   La password dell'amministratore scritta qui è **provvisoria**: al primo accesso Copilota
   chiede di sceglierne una nuova. Dopo il primo accesso si può togliere
   `LOGBOOK_ADMIN_PASSWORD` dalle variabili.
5. **Deploy.** Scheda *Deployments* → i tre puntini sull'ultima riga → *Redeploy*. La build (`scripts/vercel-build.mjs`) crea le tabelle nel
   database, il primo amministratore e le festività nazionali, compila l'interfaccia e
   impacchetta il server. Dura due o tre minuti.
6. **Primo accesso.** Aprire l'indirizzo dato da Vercel, entrare con l'amministratore,
   scegliere la password nuova. Con la posta configurata, al primo accesso da ogni PC arriva
   anche il codice di 6 cifre per email.

A ogni `git push` sul ramo di produzione Vercel ripubblica da solo. I dati restano: stanno
nel database, non nel progetto.

## Password dell'amministratore persa

1. In *Settings → Environment Variables* mettere `LOGBOOK_ADMIN_USERNAME`,
   `LOGBOOK_ADMIN_PASSWORD` (nuova, almeno 12 caratteri con lettere e numeri) e
   `LOGBOOK_ADMIN_REIMPOSTA` = `1`. `LOGBOOK_PROPRIETARIO` deve avere lo stesso nome utente.
2. *Deployments → Redeploy*. La build reimposta la password di quell'account (o lo crea) e
   chiude le sue sessioni.
3. Entrare: Copilota chiede subito una password nuova. Con `LOGBOOK_ADMIN_DEFINITIVA` = `1`
   la password scritta nella variabile vale invece come definitiva e non viene chiesto nulla.
4. **Togliere `LOGBOOK_ADMIN_REIMPOSTA`** (e `LOGBOOK_ADMIN_PASSWORD`) dalle variabili,
   altrimenti ogni build rimette quella password.

## Da sapere

- **Dati dei dipendenti.** La funzione gira a Francoforte (`regions: fra1`) e il database
  va creato nella stessa regione: i dati restano nell'Unione europea.
- **Dati di esempio.** Dopo il primo accesso, in *Impostazioni → Dati del programma* il
  proprietario li carica con un pulsante e li cancella con "Cancella tutti i dati".
- **File oltre 4 MB.** Vercel rifiuta le richieste più grandi di 4,5 MB: Copilota lo dice con
  un messaggio. I documenti grandi vanno ridotti (PDF compresso) o tenuti in SkyTower.
- **Copie di sicurezza.** Neon permette di riportare il database a un momento precedente
  (*Restore*): nel piano gratuito per poche ore, nei piani a pagamento per giorni. Prima di
  "Cancella tutti i dati" su Vercel **non** parte la copia automatica che c'è sul PC.
- **Modifiche allo schema.** A ogni build la struttura del database si allinea allo schema
  con `prisma db push`. Se una modifica farebbe perdere dati la build si ferma senza toccare
  nulla, e va decisa a mano.
- **Limite per indirizzo.** Il blocco progressivo dei tentativi (10 errori, poi 5, 10, 20
  minuti…) sta nel database e vale ovunque. Il limite in più "30 tentativi per indirizzo"
  resta nella memoria di ogni processo: su Vercel è meno preciso.
- **Solo `main` pubblica.** `vercel.json` (`git.deploymentEnabled`) spegne le pubblicazioni
  di anteprima del ramo di lavoro `feat/estrazione-dms`: ogni anteprima rifaceva la build, e
  la build allinea la struttura del database. Con un solo database, una modifica allo schema
  ancora in lavorazione lo avrebbe toccato prima di arrivare su `main`.
- **SkyTower.** Il collegamento funziona solo se SkyTower è raggiungibile da internet: dal
  server di Vercel `http://127.0.0.1:8100` non esiste.

## Provare in locale il pacchetto

Serve un PostgreSQL raggiungibile (anche quello di Neon):

```bash
# PowerShell: $env:DATABASE_URL = "postgres://…"
DATABASE_URL=postgres://utente:password@host/db npm run vercel-build   # crea .vercel/output
DATABASE_URL=postgres://utente:password@host/db npm run vercel-prova   # http://127.0.0.1:5298
```

Attenzione: la build rigenera il client del database per PostgreSQL. Per tornare a lavorare
in locale su SQLite: `npm install` (senza `DATABASE_URL` impostata).
