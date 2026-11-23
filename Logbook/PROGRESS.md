<!-- "><(((º> sabusabu <º)))><" -->

# Logbook — avanzamento lavori

Gestionale ore e presenze dipendenti (ore per fasce e progetti, ferie, permessi,
malattia, festività, import/export Excel). Questo file si legge all'inizio di ogni
sessione per riprendere da dove si era rimasti.

## Stato

- **Giorno corrente:** 9 — Dashboard e rifiniture ✅ completato
- **Modalità:** il 23/11 l'utente ha chiesto di proseguire coi giorni successivi senza fermarsi ("continua fino a che non finisci i crediti")
- **Prossimo:** Giorno 10 — Test e consegna (verifica flussi, README completo, guida d'uso, card nel Portale)
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
| 23/11 | Totali sempre da `comune/riepiloghi.ts#calcolaTotali` (calendario oggi, report Excel al Giorno 8) | I totali dei report coincidono per costruzione con quelli del calendario |
| 23/11 | Calendario: assenze APPROVATE piene, RICHIESTE tratteggiate "(in attesa)", RIFIUTATE mai | La richiesta in attesa è utile da vedere; la rifiutata no (criterio del Giorno 6) |
| 23/11 | Vista HR "Tutti i dipendenti": clic sul giorno → riepilogo per dipendente → editor | Con un dipendente filtrato il clic apre subito l'editor |
| 23/11 | Permesso = un solo giorno con durata (15 min – 10 h); ferie/malattia = giorni interi | Modello semplice e chiaro per chi compila |
| 23/11 | Malattia: niente note del dipendente (solo protocollo) | Evita che si scrivano informazioni sanitarie nel campo libero |
| 23/11 | Rifiuto sempre con motivo; HR può cambiare decisione e registrare assenze già approvate | Tracciabilità; malattia comunicata a voce |
| 23/11 | Non si approvano ferie/malattia su giorni con ore registrate (409 con l'elenco dei giorni) | Niente giorni con ore e assenza insieme |
| 23/11 | Festività "del paese" = tipo LOCALE inserito da HR, una festività per giorno | Interpretazione di "paese specifico" come città della sede (da confermare) |
| 23/11 | Import "tutto o niente": con un solo errore non si importa nulla | Criterio della specifica; niente file importati a metà |
| 23/11 | Il file viaggia due volte (anteprima e conferma), nessuno stato sul server | La conferma ricontrolla sui dati aggiornati |
| 23/11 | Riga di esempio del modello marcata "RIGA DI ESEMPIO" e ignorata all'import | Dimenticarsi di cancellarla non crea ore finte |
| 23/11 | Colonne riconosciute per nome (anche in ordine diverso); date/orari accettati come testo o valori Excel | File compilati a mano o esportati da altri programmi |
| 23/11 | Import solo per HR | Il menu Importa è di HR; i dipendenti inseriscono dal calendario |
| 23/11 | Ore nei report come durate Excel `[h]:mm` (minuti/1440) | Si leggono come nel calendario (7:30) e si sommano in Excel |
| 23/11 | Report: solo assenze APPROVATE; dipendenti = scelti, oppure attivi nel periodo o con ore | Le richieste in attesa non sono assenze |
| 23/11 | Report progetti con costo lordo (ore × costo orario lordo della scheda) e foglio dipendenti × progetti | Usa i costi chiesti il 23/11; utile a HR per le commesse |
| 23/11 | Calendario lavorato con ore contrattuali attese (giorni lavorativi × ore sett. / 5) | Confronto rapido lavorato/atteso; nessuna "differenza" calcolata per non dare numeri ambigui |
| 23/11 | Dashboard: "giorni senza ore" fino a ieri (oggi può essere in corso); ore attese = giorni lavorativi a oggi × ore sett./5, meno ferie/malattia e permessi | HR vede subito chi deve ancora registrare |
| 23/11 | Il dipendente registra i giorni mancanti direttamente dalla dashboard | Un clic dal promemoria all'editor della giornata |
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

### Giorno 5 — Calendario (23/11/2026) ✅

Fatto:
- `comune/riepiloghi.ts`: `calcolaTotali` (per giorno, progetto, dipendente,
  dipendente+progetto), giorni lavorativi, inizio settimana.
- API `GET /api/calendario?da&a&dipendenteId&progettoId&tipoAssenza` (max 62 giorni):
  fasce, assenze (approvate e in attesa), festività e totali sulle fasce filtrate.
- Pagina Calendario: vista mese e settimana, navigazione, filtri dipendente/progetto/tipo
  di assenza, colori per progetto, assenze e festività, legenda, totali del mese per
  progetto, clic sul giorno → editor della giornata (Giorno 4) con gli avvisi del giorno.

Verifiche:
- `npm test`: 91/91 (nuovo `calendario.test.ts`: col filtro progetto solo quel progetto e
  totali del giorno uguali a quelli ricalcolati dal database).
- Screenshot reale (Edge headless) del mese di novembre come admin: totali giornalieri,
  progetti colorati, Ognissanti, ferie in attesa tratteggiate, totale mese 576:00.

### Giorno 6 — Assenze e festività (23/11/2026) ✅

Fatto:
- `comune/assenze.ts`: schemi di assenza, decisione e festività; sovrapposizione di periodi.
- API `/api/assenze`: elenco (con giorni lavorativi coperti), richiesta, modifica, decisione
  HR (`POST /:id/decisione`), ritiro/eliminazione; controlli di sovrapposizione e di ore
  già registrate.
- API `/api/festivita`: elenco per anno, crea/modifica/elimina (HR), `carica-nazionali`.
- Pagina Assenze: per il dipendente le sue richieste; per HR schede "Da approvare",
  "Tutte", "Festività" con approva/rifiuta/modifica e gestione delle festività.

Verifiche:
- `npm test`: 106/106 (nuovo `assenze.test.ts`: approvata → nel calendario come APPROVATA,
  rifiutata → assente dal calendario; controlli su malattia, permessi, sovrapposizioni).
- Screenshot reale della scheda "Da approvare" (2 richieste demo).

### Giorno 7 — Importazione Excel (23/11/2026) ✅

Fatto:
- `server/servizi/excel.ts`: stile intestazioni, download, lettura tollerante di testo,
  date e orari dalle celle.
- `server/servizi/import-ore.ts`: modello (fogli Ore con esempio e menu a tendina,
  Istruzioni, Dipendenti, Progetti) e analisi riga per riga: campi mancanti, date e orari
  non validi, dipendente/progetto inesistenti, regole di contesto (riuso di regole-ore),
  sovrapposizioni con il database e fra righe del file.
- API `/api/importa/modello`, `/anteprima`, `/conferma` (solo HR).
- Pagina Importa: modello, scelta del file, anteprima con errori per riga, conferma.

Verifiche:
- `npm test`: 112/112 (nuovo `importa.test.ts`: file con 8 righe sbagliate su 9 rifiutato
  con l'errore giusto per ogni riga e nessuna scrittura; file corretto con date/orari come
  valori Excel e colonne in altro ordine importato e visibile nel calendario).
- Dal vivo: modello scaricato tramite Vite; la sua anteprima ignora la riga di esempio.

### Giorno 8 — Estrazioni (23/11/2026) ✅

Fatto:
- `server/servizi/report.ts`: filtri (periodo max 400 giorni, dipendenti, progetti),
  caricamento dati con `calcolaTotali`, report "Calendario lavorato" (un foglio per
  dipendente: anagrafica, giorno per giorno con fasce/progetto/ore/assenze/festività,
  totali per progetto, giorni lavorativi, ore attese, ferie, malattia, permessi) e report
  "Ore per progetto" (blocchi per dipendente con costo lordo + foglio Riepilogo).
- API `/api/esporta/riepilogo`, `/calendario`, `/progetti` (solo HR).
- Pagina Esporta: periodo con scorciatoie, scelta di dipendenti e progetti, riepilogo
  aggiornato in automatico, due pulsanti di download.

Verifiche:
- `npm test`: 119/119 (nuovo `esporta.test.ts`: totali di entrambi i report riletti dal
  file .xlsx e confrontati con `/api/calendario`, anche col filtro progetto).
- Dal vivo, ottobre 2026: riepilogo report 48060 minuti = totale calendario 48060.

### Giorno 9 — Dashboard e rifiniture (23/11/2026) ✅

Fatto:
- API `GET /api/dashboard`: ore del mese lavorate e attese per dipendente, giorni senza
  ore, richieste in attesa, assenze dei prossimi 14 giorni, prossime festività, ore per
  progetto (HR: tutti gli attivi; dipendente: sé stesso).
- Dashboard HR: quattro riquadri (ore del mese, richieste da approvare, giorni senza ore,
  assenti oggi) evidenziati quando serve intervenire; pannelli con richieste, giorni
  mancanti per dipendente, avanzamento lavorate/attese, assenze e festività in arrivo.
- Dashboard dipendente: le proprie ore e i giorni da registrare con "Registra ore".
- `BloccoErrori`: un errore in una pagina mostra un messaggio con "Riprova" invece della
  pagina bianca. Stati di caricamento ed errore già presenti in tutte le pagine (`usaDati`).

Verifiche:
- `npm test`: 123/123 (nuovo `dashboard.test.ts`: totali uguali al calendario, giorni
  mancanti, ore attese anche part-time, visibilità per ruolo).
- Screenshot reale della dashboard HR: 2 richieste da approvare evidenziate, 576:00 ore
  su 608:00 attese, nessun giorno mancante.
