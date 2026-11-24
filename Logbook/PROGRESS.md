<!-- "><(((º> sabusabu <º)))><" -->

# Logbook — avanzamento lavori

Gestionale ore e presenze dipendenti (ore per fasce e progetti, ferie, permessi,
malattia, festività, import/export Excel). Questo file si legge all'inizio di ogni
sessione per riprendere da dove si era rimasti.

## Stato

- **Giorno corrente:** 10 — Test e consegna ✅ completato: **piano di 10 giorni concluso**
- **Modalità:** il 23/11 l'utente ha chiesto di proseguire coi giorni successivi senza fermarsi ("continua fino a che non finisci i crediti")
- **Giorno 11 (23/11):** richieste aggiuntive ✅ (data minima 2020, ore massime per progetto, estratti mensili)
- **Giorno 12 (23/11):** nuova estetica Cosedil ✅
- **Giorno 13 (24/11):** interfaccia adattabile in flexbox, dal cellulare agli schermi ultra wide ✅
- **Giorno 14 (24/11):** produzione senza dati di esempio, porta 5210 in firewall e installer, dashboard cliccabile, menu dei colori ✅
- **Giorno 15 (24/11):** file, attestati, documenti del dipendente a schede, Impostazioni con collegamento a SkyTower ✅
- **Prossimo:** calendario solo lun-ven e blocco di sabato, domenica e festivi; poi (dopo le risposte) pannello laterale e assegnazioni ai progetti; documentazione dei progetti (2c, 3c); grafici in dashboard
- **Conferma dell'utente (24/11):** Giorni 11 e 12 accettati; confermate le tre scelte aperte (festività del paese = città della sede, 4 ottobre festa nazionale, festività senza costo negli estratti)
- **Ultimo aggiornamento:** 24/11/2026

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
| 23/11 | Festività "del paese" = tipo LOCALE inserito da HR, una festività per giorno | Interpretazione di "paese specifico" come città della sede, confermata dall'utente il 24/11 |
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
| 23/11 | Produzione = un solo server sulla 5210 (`npm start`: prepara DB + build + Express serve `dist/`); `avvia.bat`/`avvia.vbs` usano questa modalità | Una porta, nessun Vite in esercizio; il Portale avvia le app con un .vbs |
| 23/11 | Card nel Portale: id `logbook`, `dir: 'logbook'` minuscolo, blocco Caddy `logbook.{$SUITE_DOMINIO}` | `sottodominio()` del Portale vuole la cartella in minuscolo; su Windows il percorso la trova lo stesso |
| 23/11 | `allowScripts` in package.json per better-sqlite3, esbuild, prisma, @prisma/engines | npm 11 avvisa (e in futuro bloccherà) gli script d'installazione non approvati: senza, il modulo nativo SQLite non si compilerebbe |
| 23/11 | Nessun inserimento prima del 01/01/2020, ovunque (risposta 1b): ore, assenze, festività, import, assunzione/cessazione, date dei progetti. `DATA_MINIMA` in `comune/date.ts` | Richiesta dell'utente; la lettura di dati vecchi resta possibile |
| 23/11 | Ore massime giornaliere sul progetto (`maxMinutiGiorno`), per dipendente, salvataggio bloccato oltre il limite (risposta 2b) da interfaccia, API e import | Richiesta dell'utente; visibili in scheda progetto, calendario ed editor |
| 23/11 | Estratti mensili "mese a calendario" e "giorni e costi" in Excel + anteprima + stampa/PDF dal browser (risposta 3abc) | Un solo calcolo (`comune/estratto-mese.ts`) per tutte e tre le uscite; PDF dalla stampa per avere lo stesso aspetto dell'anteprima senza librerie in più |
| 23/11 | Costo del giorno netto e lordo; ferie/malattia valorizzate a ore di contratto nei giorni lavorativi, permessi alla loro durata, festività senza costo (risposta 4c) | Richiesta dell'utente; festività senza costo confermata dall'utente il 24/11 |
| 23/11 | Estetica secondo la skill Cosedilfrontend: palette del marchio, grigi di Tailwind ridefiniti coi neutri Cosedil, font Ubuntu/Inter/Open Sans, schede con ombra blu, bottoni maiuscoli, icone SVG al posto delle emoji, logo della Suite Cosedil | Richiesta dell'utente ("ristruttura l'estetica usando /Cosedilfrontend") |
| 23/11 | Font del marchio installati in locale (@fontsource) invece di Google Fonts | Funzionano su rete aziendale chiusa e non mandano richieste a servizi esterni |
| 23/11 | Festività in verde (prima viola) e tavolozza progetti senza viola/magenta | Il design system vieta il viola |
| 23/11 | Cartella lasciata `Logbook/` (maiuscola) | È la cartella aperta in VS Code: rinominarla ora romperebbe la sessione. Da decidere al Giorno 10 con la card del Portale |
| 24/11 | 4 ottobre (San Francesco) festa nazionale dal 2026 in `comune/festivita.ts` | Legge approvata a ottobre 2025; confermato dall'utente |
| 24/11 | Layout in flexbox con a capo automatico (base per blocco, nessuna colonna fissa), `<main>` senza larghezza massima, tabelle a schede sotto i 640px | Richiesta dell'utente: cellulare e ultra wide; la base per blocco evita di scrivere un layout per ogni punto di rottura |
| 24/11 | Sul telefono restano a scorrimento orizzontale (dentro il riquadro) solo l'anteprima dell'import e la tabella "giorni e costi" | Hanno 9-10 colonne da confrontare riga per riga: a schede si leggerebbero peggio; la pagina non sfora |
| 24/11 | Dati di esempio su DB vuoto: sì in sviluppo, no in produzione, `LOGBOOK_DATI_DEMO` per forzare | Uso vero per HR senza dati finti, ma chi sviluppa o prova da una copia nuova ha ancora qualcosa da guardare |
| 24/11 | Dashboard: collegamenti con parametri nell'indirizzo (`?apri=`, `?dipendente=&data=&giorno=`), tolti dopo l'apertura | Link normali (anche apribili in una nuova scheda); chiudendo la finestra non si riapre |
| 24/11 | Ore del mese per dipendente → calendario del dipendente (non la scheda anagrafica) | Dal numero di ore ci si aspetta il dettaglio delle ore |
| 24/11 | Menu dei colori con 10 colori del marchio con nome + Automatico + Altro colore | Uniforme alla piattaforma; il codice libero resta possibile ma secondario |
| 24/11 | Giorni 11 e 12 accettati dall'utente insieme alle tre scelte aperte (festività del paese = città della sede, 4 ottobre nazionale, festività senza costo negli estratti) | Conferma esplicita: "confermo giorno 11 e 12 e le tre integrazioni" |

## Problemi aperti

- Il branch `feat/estrazione-dms` contiene anche lavoro OCR (5 commit non ancora in `main`
  e modifiche non committate non mie): nei commit di Logbook si aggiungono **solo** file
  di `Logbook/`.
- `InstallaSuite.exe` (radice del repo) non include ancora Logbook: va ricostruito da
  `installa-suite.py` con PyInstaller.
- Il DB demo in uso (`data/logbook.db`) ha ancora i dati di esempio: per l'uso vero va
  spostato e Logbook riavviato (parte vuoto con il solo admin).
- Portale: le modifiche al registro sono nel repository; il portale in esercizio gira da
  una copia esterna (`Documents\suite cosedil`) e va aggiornato per vedere la card.
- Cartella `Logbook/` → `logbook/`: si può rinominare quando nessun programma la tiene
  aperta (VS Code, server); non è necessario su Windows.
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

### Giorno 10 — Test e consegna (23/11/2026) ✅

Fatto:
- Modalità produzione: `npm start` (prestart: prepara DB + build) e `--produzione` in
  `server/index.ts`; Express serve `dist/` con ritorno a index.html per le pagine.
- `avvia.bat` (produzione, rispetta `PORTALE_APRE_BROWSER`, `HOST`, `SUITE_DOMINIO`) e
  `avvia.vbs` (avvio senza finestra, launcher del Portale).
- Portale: voce `logbook` nel registro (`portale/server.js`), icona (`assets/js/common.js`),
  sigla in plancia, blocco Caddy, righe nel README della suite.
- `allowScripts` per gli script d'installazione necessari (npm 11).
- README completo (installazione, avvio, credenziali, modello Excel, configurazione,
  suite) e guida d'uso con 14 screenshot in `docs/guida/`.

Verifiche:
- `npm test`: 124/124; `npm run typecheck` pulito; test del Portale 125/125.
- **Installazione da zero**: copia pulita della cartella (senza node_modules, data,
  generated, dist) → `npm install` (0 vulnerabilità, nessun avviso sugli script) →
  `npm start` → DB creato e popolato, login admin, pagine e dashboard ok.
- **Prova dell'interfaccia** su quell'istanza (Edge headless): 14 schermate di tutte le
  pagine; mario.rossi ha solo Dashboard / Calendario / Le mie assenze; nell'editor una
  fascia sovrapposta blocca il salvataggio; corretta, le due fasce vengono salvate
  (07:30-12:30 e 13:30-16:30 del 23/11, verificate via API).

### Giorno 11 — Richieste aggiuntive (23/11/2026) ✅

Richiesta: niente inserimenti prima del 01/01/2020; ore massime giornaliere visibili in
calendario e scheda progetto; estratto del mese a calendario con anagrafica a destra e
progetti in basso; estratto con giorni in verticale, ore, costo del giorno, ferie e malattia.
Risposte: 1b 2b 3abc 4c.

Fatto:
- `DATA_MINIMA` (01/01/2020) in tutti gli schemi di inserimento, import, disattivazione,
  festività nazionali; `min` sui campi data dei moduli.
- Migrazione `ore_massime_progetto` (`Progetto.maxMinutiGiorno`); controllo in
  `PUT /giornata`, `POST`/`PUT` fascia e import (`superamentiMassimo`, `messaggioMassimo`);
  campo e colonna in Progetti, riepilogo per progetto e blocco nell'editor, limite nel
  calendario (caselle con dipendente filtrato, tooltip, legenda).
- `comune/estratto-mese.ts` (calcolo puro), `server/servizi/estratto-mese.ts` (due Excel),
  `POST /api/esporta/mese`, `/mese/calendario`, `/mese/giorni`; componente
  `EstrattiMensili` con anteprima dei due layout e stampa (regole `@media print`).
- Seed: assunzioni dal 2020, PRG-001/PRG-002 con massimo 9:00; DB demo in uso aggiornato
  senza cancellare nulla.
- Guida (nuove sezioni e screenshot 15-16) e README.

Verifiche:
- `npm test`: 138/138 (nuovi `regole-giorno11.test.ts` ed `estratto-mese.test.ts`: date
  prima del 2020 rifiutate ovunque, giornata/fascia/import oltre il massimo bloccati,
  ore dell'estratto = calendario, ferie e permessi valorizzati, struttura dei due Excel).
- Anteprima reale e PDF di stampa generato da Edge: una pagina A4 orizzontale per
  dipendente, menu nascosti, colori di ferie e festivi stampati.

### Giorno 12 — Estetica Cosedil (23/11/2026) ✅

Fatto:
- `src/index.css`: token del marchio (@theme), scala dei grigi Cosedil, classi `scheda`,
  `scheda-attiva`, `sopratitolo`, `intestazione-tabella`, `scheletro` (caricamento).
- Font Ubuntu/Inter/Open Sans da @fontsource in `src/main.tsx`; logo e favicon della
  Suite Cosedil (`public/`, copiati da `portale/assets/icon`).
- `ui.tsx` (bottoni, campi, avvisi, etichette, modale, caricamento a segnaposto),
  `icone.tsx` (icone SVG), `Layout.tsx` (menu blu con logo e icone, intestazione
  bianca), `Login.tsx` (pannello del marchio), colori di calendario e assenze, schede e
  tabelle in tutte le pagine; nessuna emoji.
- Screenshot della guida rifatti.

Verifiche: `npm test` 138/138, typecheck ok, controllo a vista di login, dashboard,
calendario, progetti, estratti mensili. Nota: lo script degli screenshot salva sul DB
demo due fasce di Mario Rossi del 23/11 (07:30-12:30 e 13:30-16:30, PRG-001).

### Giorno 13 — Interfaccia adattabile: cellulare e ultra wide (24/11/2026) ✅

Richiesta: "l'interfaccia deve adattarsi anche da cellulare e deve essere in flexbox per
adattarsi anche a schermi ultra wide".

Fatto:
- Regola unica, spiegata in `src/index.css` ("Layout adattabile"): blocchi affiancati in
  contenitori `flex flex-wrap`, ogni blocco con una base (`flex-[1_1_30rem]`…) che cresce
  per riempire la riga. Nessun numero fisso di colonne: uno per riga sul telefono, due o
  tre su un monitor, tutti affiancati su un ultra wide. Tolte tutte le `grid` delle pagine.
- `<main>` senza larghezza massima (era 1400px): a 3440px il contenuto usa 3200px invece di
  1400. Punti di rottura nuovi `3xl` (1920px) e `4xl` (2560px) solo per margini e altezze.
- Telefono: intestazione con il nome del programma e utente troncato; finestre modali
  quasi a tutto schermo; `Tabella` diventa un elenco di schede sotto i 640px (colonna
  `principale` come titolo, menu "Ordina per"); calendario del mese con numero, totale e
  pallini colorati, settimana come elenco verticale; editor della giornata con una fascia
  per riquadro (progetto, orari, note); login con fascia del marchio.
- Ultra wide: dashboard con i pannelli affiancati, scheda dipendente con anagrafica,
  contratto e costi affiancati, estratti mensili due o tre per riga (in stampa `print:block`
  e `print:flex-nowrap`: sempre un dipendente per pagina A4, calendario e anagrafica
  affiancati).
- Guida: capitolo 4 "Dal cellulare e sugli schermi grandi" con le immagini 17-20.

Verifiche:
- Script Playwright (Edge) su tutte le pagine, HR e dipendente, a 360, 768, 1440 e 3440 px:
  nessuna pagina sfora in orizzontale e nessun elemento esce dalla finestra. Prima della
  modifica non sforava nulla, ma a 3440px il contenuto restava a 1400px e sul telefono
  settimana ed editor della giornata erano illeggibili (colonne da 40px, menu dei progetti
  largo un carattere).
- Controllo a vista delle schermate (telefono: calendario, editor, elenco dipendenti;
  1440: scheda dipendente; 3440: dashboard ed estratti).
- PDF di stampa degli estratti rifatto da Edge: stessa impaginazione di prima.
- `npm test` 138/138, typecheck ok, build ok.

### Giorno 14 — Avvio senza dati di esempio, dashboard cliccabile, menu dei colori (24/11/2026) ✅

Richiesta: "fai entrambe" (partenza senza dati finti; porta 5210 in firewall e installer),
"la scelta del colore deve avere un menù più simile esteticamente alla piattaforma",
"cliccando sugli elementi della dashboard devo poter andare all'elemento". La parte su
sezioni, attestati, documenti e note è in attesa delle risposte alle domande del 24/11.

Fatto:
- `server/dati-demo.ts` (`decidiDatiDemo`): su database vuoto i dati di esempio si
  caricano di default in sviluppo e NON in produzione; `LOGBOOK_DATI_DEMO=1/0` forza la
  scelta. `prepara-db.ts --produzione` (da `prestart`), README, `.env.example`, `avvia.bat`.
- Fuori da Logbook: porta 5210 in `firewall-suite.ps1`, `installa_logbook` in
  `installa-suite.py` (npm ci + .env da .env.example). `InstallaSuite.exe` in radice va
  ricostruito con PyInstaller per includerlo.
- Dashboard: richieste e assenze in arrivo → `/assenze?apri=<id>`; giorni senza ore →
  `/calendario?dipendente=&data=` e, sul singolo giorno, `&giorno=` che apre l'editor;
  ore del mese → calendario del dipendente; progetti → `/progetti?apri=<id>` (HR) o
  calendario filtrato (dipendente); festività → scheda Festività o calendario sul giorno;
  tessere "Giorni senza ore" (scorre al pannello) e "Assenti oggi" cliccabili. Assenze,
  Calendario e Progetti leggono i parametri e li tolgono dopo l'apertura.
- `componenti/SceltaColore.tsx`: menu a scheda con i 10 colori del marchio con nome
  (`COLORI_PROGETTO` in `src/colori.ts`), "Automatico" e "Altro colore…"; Esc chiude il
  menu e non la finestra del progetto.

Verifiche:
- `npm test` 143/143 (5 nuovi in `dati-demo.test.ts`), typecheck e build ok.
- `prepara-db` su quattro database nuovi nello scratchpad: produzione → vuoto + admin;
  sviluppo → dati di esempio; `LOGBOOK_DATI_DEMO=1` in produzione → dati di esempio;
  `=0` in sviluppo → vuoto + admin.
- `installa-suite.py --dry-run --app logbook` ok; `firewall-suite.ps1` analizzato dal
  parser di PowerShell senza errori (non eseguito: tocca il firewall del PC).
- Playwright su Edge (HR e dipendente): 12 verifiche sui collegamenti della dashboard e
  sul menu dei colori, tutte ok; nessun dato salvato (progetto chiuso con Annulla).

### Giorno 15 — File, attestati, documenti del dipendente, Impostazioni (24/11/2026) ✅

Richiesta: "dividi in sezioni l'inserimento dei nuovi dipendenti e dei progetti aggiungendo
una sezione di inserimento attestati e documenti", risposte 1c (attestati con tipo da
elenco e avviso 30 giorni prima), 4a + "b come pulsante" (file in Logbook; invio a SkyTower
solo se un admin registra il collegamento in Impostazioni).

Fatto:
- Migrazione `20261124100000_documenti`: FileCaricato, Attestato (TipoAttestato),
  DocumentoDipendente, DocumentoProgetto (OrigineDocumento), NotaProgetto, Impostazione;
  Progetto.descrizione e Progetto.commessaSkytower. Solo tabelle e colonne nuove.
- `server/servizi/archivio-file.ts`: file in `data/documenti` (o `LOGBOOK_DOCUMENTI_DIR`),
  20 MB, estensione + primi byte controllati, nome su disco casuale, pulizia dei file mai
  collegati all'avvio. `POST/GET/DELETE /api/file` (lettura: HR o chi ha caricato).
- `/api/attestati` (stato a oggi con `statoAttestato`), `/api/documenti-dipendente`,
  `/api/impostazioni` (+ `/skytower`, `/skytower/prova`, `/skytower/commesse`; il token non
  esce mai), `server/servizi/skytower.ts` (contratto della suite: X-Suite-Token,
  X-Suite-Email, X-Suite-App, POST /suite/commesse/{codice}/documenti). Dashboard HR:
  `attestatiDaRinnovare`.
- Interfaccia: `Schede` (ui.tsx), `CaricaFile`/`LinkFile` (File.tsx), scheda dipendente
  in cinque schede (Anagrafica, Contratto e costi, Account, Attestati, Documenti; le ultime
  tre dopo il primo salvataggio; `?scheda=`), pagina Impostazioni nel menu degli admin,
  riquadro e pannello "Attestati da rinnovare" in dashboard.

Verifiche:
- `npm test` 161/161 (18 nuovi in `documenti.test.ts`, con un finto SkyTower in ascolto).
- Migrazione applicata al DB demo all'avvio di produzione, dati intatti.
- Playwright su Edge: 9 verifiche (schede, attestato con file in scadenza, apertura del
  file, documento, dashboard → scheda Attestati, Impostazioni con errore "non
  raggiungibile"), con pulizia dei dati di prova a inizio e fine.
