<!-- "><(((º> sabusabu <º)))><" -->

# Logbook — avanzamento lavori

Gestionale ore e presenze dipendenti (ore per fasce e progetti, ferie, permessi,
malattia, festività, import/export Excel). Questo file si legge all'inizio di ogni
sessione per riprendere da dove si era rimasti.

## Stato

- **Giorno corrente:** 4 — Registrazione ore ✅ completato
- **Modalità:** il 23/11 l'utente ha chiesto di proseguire coi giorni successivi senza fermarsi ("continua fino a che non finisci i crediti")
- **Prossimo:** Giorno 5 — Calendario (mese e settimana, filtri)
- **Ultimo aggiornamento:** 23/11/2026

## Cosa c'era nella cartella

- `Logbook/` era **vuota**: nessun modello Excel, logo o codice da riusare.
- Sta dentro il monorepo della Suite Cosedil (`Programmi-pronti-`). Riusati solo i colori
  del marchio Cosedil (blu `#0c4577`, verde `#65bc7b`); il login del Portale (`shared/sso`)
  NON si usa per scelta (1c).

## Decisioni prese

| Data | Decisione | Perché |
|---|---|---|
| 23/11 | **Login proprio** di Logbook (utenti e password nel suo DB), nessun legame col Portale | Risposta 1c |
| 23/11 | App **autonoma** (`npm run dev` / `avvia.bat`) **e** card nel Portale al Giorno 10 | Risposta 2 "entrambe" |
| 23/11 | Commit **"Giorno N: <descrizione>"**, uno al giorno, sul branch corrente (`feat/estrazione-dms`) | Risposta 3b (nessun branch nuovo) |
| 23/11 | Precaricate solo le festività **nazionali**; HR aggiunge a mano quelle del paese (tipo `LOCALE`, es. patrono) e le chiusure (`AZIENDALE`) | Risposta 4b; aggiunto il tipo `LOCALE` allo schema |
| 23/11 | **Costo orario netto e lordo** nella scheda dipendente, in centesimi, visibili solo a HR | Richiesta del 23/11; "solo HR" è una mia scelta (dati retributivi) |
| 23/11 | Stack: React 19 + Vite 7 + TS + Tailwind 4, Express 5 + TS, SQLite via Prisma 7.10 (adapter better-sqlite3), ExcelJS, Vitest | Specifica + baseline della suite (Vite 7). Prisma 8 su npm è ancora release candidate |
| 23/11 | Porte: interfaccia **5210**, API **3012** (solo 127.0.0.1) | Libere nella suite |
| 23/11 | Date `AAAA-MM-GG` come testo, orari `HH:MM`, ore **calcolate** e non salvate | Niente slittamenti di fuso; ore mai in disaccordo con gli orari |
| 23/11 | Fasce che non attraversano la mezzanotte (turno notturno = due fasce) | Semplifica calcolo e sovrapposizioni |
| 23/11 | Festività nazionali calcolate (Pasqua con algoritmo), 4 ottobre dal 2026 | Nessuna lista da aggiornare a mano |
| 23/11 | `npm run dev` prepara il DB da solo (migrazioni + seed solo se vuoto) | "Un solo comando"; non tocca mai dati esistenti |
| 23/11 | Override npm `effect` ≥3.22.5 e `uuid` ≥11.1.1 | `npm audit` a 0 vulnerabilità (venivano da Prisma CLI ed ExcelJS) |
| 23/11 | Sessioni lato server (tabella `Sessione`, solo impronta SHA-256 del token), cookie HttpOnly 12 h, scrypt per le password | Revocabili (logout, utente disattivato), niente dipendenze esterne |
| 23/11 | CSRF: intestazione `X-Logbook: 1` obbligatoria su POST/PUT/PATCH/DELETE | Un sito esterno non può aggiungerla senza CORS |
| 23/11 | Limite login: 5 errori in 15 min per IP+utente → 429 | Contro i tentativi a forza bruta |
| 23/11 | Menu dipendente: Dashboard, Calendario, Le mie assenze | Il resto è HR; i permessi veri sono nelle API |
| 23/11 | Regole dei moduli in `comune/schemi.ts` (Zod), usate da server e interfaccia | Stessi messaggi d'errore ovunque; il server resta l'unico controllo vincolante |
| 23/11 | Niente cancellazione di dipendenti e progetti: "disattiva" = CESSATO / CHIUSO | Le ore storiche restano nei report |
| 23/11 | Dipendente cessato → account disattivato e sessioni chiuse; la riattivazione NON riapre l'account | Scelta prudente: HR riapre l'accesso esplicitamente |
| 23/11 | Costo lordo ≥ costo netto (controllo) | Evita inversioni dei due campi |
| 23/11 | Tabelle con ricerca/ordinamento/paginazione lato browser | Anagrafiche di poche centinaia di righe: immediato e senza API in più |
| 23/11 | Fasce contigue (12:00 e 12:00) ammesse; sovrapposizione = almeno un minuto in comune | Pausa pranzo e cambi progetto senza buchi |
| 23/11 | Niente ore nei giorni futuri, nei giorni di ferie/malattia approvate, fuori dal periodo di assunzione o di apertura del progetto; progetti CHIUSI solo se già presenti quel giorno | Dati coerenti; si possono ancora correggere ore vecchie |
| 23/11 | L'editor salva la giornata intera in modo atomico (`PUT /api/registrazioni/giornata`) | Nessun giorno lasciato a metà se una riga è sbagliata |
| 23/11 | Regole di contesto in `server/servizi/regole-ore.ts` con errori in elenco | Riusate dall'import Excel per gli errori riga per riga |
| 23/11 | Cartella lasciata `Logbook/` (maiuscola) | È la cartella aperta in VS Code: rinominarla ora romperebbe la sessione. Da decidere al Giorno 10 con la card del Portale |

## Problemi aperti

- Il branch `feat/estrazione-dms` contiene anche lavoro OCR (5 commit non ancora in `main`
  e modifiche non committate non mie): nei commit di Logbook si aggiungono **solo** file
  di `Logbook/`.
- Da confermare: "festività del paese specifico" interpretato come **paese/città della sede**
  (patrono). Se invece si intendeva lo **Stato** (dipendenti all'estero), serve un campo
  "paese" su festività e dipendente.
- `prisma migrate reset` lanciato da un assistente AI viene bloccato da Prisma finché
  l'utente non dà il consenso: il DB di sviluppo del Giorno 1 è stato aggiornato senza
  reset (account aggiunti, nessun dato cancellato).

## Registro giornaliero

### Giorno 1 — Fondamenta (23/11/2026) ✅

Fatto:
- Struttura del progetto: `comune/` (logica pura), `server/` (Express), `src/` (React),
  `prisma/` (schema, migrazione `iniziale`, seed), `scripts/prepara-db.ts`, `avvia.bat`.
- Schema DB: `Utente`, `Dipendente` (con costo orario netto/lordo), `Progetto`,
  `RegistrazioneOraria`, `Assenza` (solo protocollo per la malattia), `Festivita`
  (nazionale/locale/aziendale).
- Logica comune con test: date ISO ↔ gg/mm/aaaa, orari e durate, validazione codice
  fiscale (con omocodia), festività nazionali con Pasqua.
- Dati di esempio: 5 dipendenti (CF validi, uno part-time 30h), 3 progetti, ore dal
  01 del mese scorso a ieri (oggi: 323 fasce, 01/10 → 20/11), 6 assenze (approvate,
  richieste, rifiutata), 13 festività 2026.
- API: `GET /api/salute`, `GET /api/stato-dati`; pagina provvisoria che mostra i conteggi.
- README iniziale.

Verifiche:
- `npm test`: 29/29 test passati (4 file).
- `npm run typecheck`: nessun errore.
- Prova dal vivo: cancellato `data/logbook.db`, `npm run dev` → DB ricreato e popolato,
  API su 3012, interfaccia su 5210, `/api/stato-dati` tramite Vite: 5 dipendenti,
  3 progetti, 323 fasce, 6 assenze, 13 festività, 1377 ore totali.

### Giorno 2 — Accesso e layout (23/11/2026) ✅

Fatto:
- Migrazione `sessioni`; `server/auth/` (password scrypt, sessioni), `server/middleware.ts`
  (caricaUtente, richiediLogin, richiediAdmin, dipendenteAmmesso, controlloCsrf),
  `server/errori.ts` (risposte d'errore uniformi con errori per campo).
- API: `/api/auth/login|logout|io|password`; `/api/dipendenti` e `/api/registrazioni` in
  lettura con filtro per ruolo; `/api/stato-dati` solo HR.
- Seed: account `admin` + uno per dipendente; `prepara-db` crea un admin se manca.
- Interfaccia: login, layout con menu laterale diverso per ruolo, intestazione con utente,
  cambio password e logout, pagine segnaposto per i giorni successivi.

Verifiche:
- `npm test`: 42/42 (nuovo `accesso.test.ts`: 401 senza login, 403 sui dati altrui,
  CSRF, blocco dopo 5 tentativi, logout, utente disattivato, cambio password).
- Dal vivo tramite Vite: mario.rossi vede 1 dipendente, 403 su scheda e ore di un collega
  e su `/api/stato-dati`; admin vede 5 dipendenti.

### Giorno 3 — Anagrafiche (23/11/2026) ✅

Fatto:
- `comune/schemi.ts` (dipendente, account, progetto) e `comune/importi.ts` (euro ↔ centesimi).
- API dipendenti: crea, modifica, disattiva/riattiva, account di accesso (crea, reimposta
  password, attiva/disattiva); unicità di matricola e CF con errore sul campo (409).
- API progetti: elenco (anche ai dipendenti, per scegliere il progetto), crea, modifica,
  chiusura via stato; codice unico in maiuscolo.
- Interfaccia: componente `Tabella` (ricerca su più parole senza accenti, ordinamento,
  paginazione), elenco e scheda dipendente con costi in euro e blocchi account/stato,
  pagina progetti con finestra di modifica e colore nel calendario.

Verifiche:
- `npm test`: 60/60 (nuovi `schemi.test.ts` e `anagrafiche.test.ts`).
- Dal vivo: POST di un dipendente con CF sbagliato → 400 con l'errore sul campo `codiceFiscale`.

### Giorno 4 — Registrazione ore (23/11/2026) ✅

Fatto:
- `comune/registrazioni.ts`: sovrapposizioni, totali, schemi di fascia e giornata.
- `server/servizi/regole-ore.ts`: regole di contesto (dipendente/progetto esistenti, date,
  ferie/malattia, giorni futuri).
- API `/api/registrazioni`: POST, PUT /:id, DELETE /:id, PUT /giornata; 409 con messaggio
  che indica la fascia in conflitto; il dipendente lavora solo sulle proprie.
- `creaApp(prisma, { oggi })`: la data corrente si può fissare nei test.
- Interfaccia: `EditorGiornata` (più fasce, ore per riga e totale, righe sovrapposte in
  rosso, salvataggio della giornata intera); si apre dal calendario (Giorno 5).

Verifiche:
- `npm test`: 84/84 (nuovi `registrazioni.test.ts` sulla logica e `ore.test.ts` sulle API).
- Dal vivo: mario.rossi prova 10:00-11:00 il 20/11 → "La fascia 10:00-11:00 si sovrappone a
  quella già registrata 07:30-12:30 (progetto PRG-001) del 20/11/2026".
