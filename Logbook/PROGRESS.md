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
- **Giorno 16 (24/11):** calendario Lun–Ven e niente ore il sabato, la domenica e i festivi ✅
- **Giorno 17 (24/11):** assegnazione dei dipendenti ai progetti, pagina del progetto con documentazione di avanzamento, grafico e note ✅
- **Giorno 18 (24/11):** scheda dipendente in una sola pagina, omonimi distinti dal codice fiscale, scelte con ricerca a caratteri, assenze in pagina ✅
- **Giorno 19 (24/11):** il dipendente registra solo oggi, i giorni passati solo HR; "oggi" è la data del server, avviso se il PC ha un'altra data ✅
- **Giorno 20 (24/11):** le ore e la documentazione le inserisce solo HR; segnalazioni dei dipendenti con finestra a HR all'accesso e campanella ✅
- **Giorno 21 (24/11):** menu laterale fermo durante lo scorrimento, voci sempre visibili ✅
- **Giorno 22 (24/11):** allegato facoltativo alle assenze ✅
- **Giorno 23 (24/11):** verifica di codice, librerie e sicurezza; corrette le falle confermate, tranne la password dell'admin predefinito (da decidere) ✅
- **Giorno 24 (24/11):** password provvisoria da cambiare al primo accesso, tolte le rotte mai usate (HR elimina la singola fascia), better-sqlite3 dichiarato ✅
- **Giorno 25 (24/11):** sabato e domenica esclusi da tutte le estrazioni (report, estratti, Excel, stampa) ✅
- **Giorno 26 (24/11):** matricola sigla del contratto + numero, mansioni da elenco che si arricchisce ✅
- **Giorno 27 (24/11):** pannello a destra del calendario: più giorni (Ctrl/Maiusc) e più dipendenti insieme, tutto o niente ✅
- **Giorno 28 (24/11):** documentazione del giorno (file, nota, avanzamento) dalla finestra delle ore, nella documentazione del progetto ✅
- **Giorno 29 (24/11):** grafici dell'avanzamento dei progetti in dashboard ✅
- **Giorno 30 (25/11):** copia dimostrativa separata provata e tolta su richiesta (un solo database); restano le festività nazionali caricate da sole su un database nuovo ✅
- **Giorno 31 (25/11):** proprietario (LOGBOOK_PROPRIETARIO): dati di esempio e "Cancella tutti i dati" con codice via email ✅ (manca il server di posta nel .env)
- **Giorno 32 (25/11):** Logbook dentro e fuori dalla suite: InstallaLogbook.exe (installa-logbook.py), InstallaSuite.exe ricompilato, .env col proprietario anche dalla suite ✅
- **Posta (25/11):** casella Aruba, smtps.aruba.it porta 465 SSL nel .env locale; password scritta dall'utente nel file. Provati l'accesso al server e l'invio di un'email di prova con la funzione di Logbook ✅
- **Codice via email provato dall'utente (25/11):** arrivato ✅
- **Giorno 33 (25/11):** seconda verifica di sicurezza su tutta l'app, quattro correzioni ✅
- **Giorno 34 (25/11):** copie di sicurezza con SQL, blocco progressivo, sessioni a 15 minuti, codice via email per gli amministratori, primo admin all'installazione e ruolo dato solo dal proprietario, registro attività nel menu ✅
- **Giorno 35 (25/11):** Logbook pubblicabile su Vercel: PostgreSQL esterno, file/codici/blocchi nel database, pacchetto con scripts/vercel-build.mjs ✅ (provato in locale, da pubblicare con l'account dell'utente)
- **26/11:** Logbook online su https://programmi-pronti.vercel.app (pubblica solo `main`); recupero amministratore con LOGBOOK_ADMIN_REIMPOSTA ✅
- **Giorno 36 (26/11):** avvisi via email: richieste a HR, esiti al dipendente, giorni senza ore, attestati in scadenza ✅
- **Giorno 37 (26/11):** chiusura del mese: HR blocca ore, assenze e festività di un mese finito; riapertura ✅
- **Giorno 38 (26/11):** saldo ferie e permessi: quota per dipendente scritta da HR, maturato/goduto/residuo calcolati ✅
- **Giorno 39 (26/11):** Logbook installabile sulla schermata del telefono (manifest e icone) ✅
- **Giorno 40 (26/11):** password dimenticata: codice via email e password nuova dalla pagina di accesso ✅
- **Giorno 41 (26/11):** costo della manodopera per commessa con preventivo (euro e ore), solo HR ✅
- **In coda (richiesta del 26/11, "implementa tutto partendo dal primo punto"):** 4 timbratura da telefono (serve una decisione dell'utente: dal Giorno 20 le ore le inserisce solo HR), 6 caposquadra, 7 straordinari/trasferte/rimborsi, 8 esportazione per il consulente paghe, 9 costo manodopera per commessa, 10 password dimenticata, 11 file oltre 4 MB su Vercel
- **Fatto prima:** pubblicazione su Vercel seguendo docs/vercel.md (progetto, database Neon a Francoforte, variabili); poi prova dal vivo sull'indirizzo pubblico
- **Risposte del 25/11 (1a 2a 3a):** indirizzo del proprietario corretto nel .env (quello con la n, scritto solo lì); copia vecchia in Documents\suite cosedil lasciata com'è
- **Conferma dell'utente (24/11):** Giorni 11 e 12 accettati; confermate le tre scelte aperte (festività del paese = città della sede, 4 ottobre festa nazionale, festività senza costo negli estratti)
- **Ultimo aggiornamento:** 25/11/2026

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
| 24/11 | Assegnazione dipendente-progetto **obbligatoria** per registrare ore (calendario, import, anche HR), semplice dentro/fuori senza date; la migrazione assegna chi aveva già ore | Risposte 1a 2a 3a 4a del 24/11 |
| 24/11 | Togliere un'assegnazione lascia le ore fatte e le lascia correggibili nella loro giornata | Stessa tolleranza dei progetti chiusi: niente ore "bloccate" da correggere |
| 24/11 | Progetto in **pagina** (non finestra), tutto visibile senza schede: dati, assegnati, note interne, avanzamento, documentazione | "l'inserimento progetto deve aprire una nuova pagina…" + "tutte le aree nella stessa pagina" |
| 24/11 | Documentazione: il dipendente carica sui progetti ATTIVI assegnati, elimina il suo finché HR non l'ha visto; la risposta di HR segna anche "visto" | Risposta 2c; scelte mie sui casi limite |
| 24/11 | "Invia a SkyTower" solo per documenti con file, una volta sola | Mia scelta: SkyTower archivia file; nessun doppione |
| 24/11 | Scheda dipendente senza schede: sezioni sempre visibili, modulo dell'attestato dentro la sezione | "tutte le aree devono essere nella stessa pagina, senza cambiare sezione e perdere la visualizzazione dei dati precedenti" |
| 24/11 | Omonimi: al nome si aggiunge il prefisso più corto (≥ 6) del codice fiscale che li distingue, in interfaccia e dashboard; avviso nella scheda nuova | "se ci sono omonimie il sistema distingue partendo dal codice fiscale" |
| 24/11 | Assenze in una pagina (/assenze/nuova, /assenze/:id) con le altre assenze del dipendente a destra; nessun allegato alle assenze per ora | "vale ugualmente per assenze e ferie"; allegati non chiesti (domanda aperta) |
| 24/11 | Il dipendente scrive ore e documentazione solo con la data di oggi; i giorni passati (aggiungere, modificare, togliere) solo HR; i futuri nessuno | "solo gli admin devono poter inserire i dati nelle giornate già passate … per evitare pagamenti errati" (precisa il messaggio "solo gli admin possono inserire elementi nelle giornate") |
| 24/11 | "Oggi" = data del server (GET /api/oggi); l'interfaccia la usa e avvisa se il PC ha un'altra data | "sincronizzando il calendario del pc con quello dell'app": cambiare la data del PC non deve aprire i giorni passati |
| 24/11 | Le ore le inserisce **solo HR**, anche oggi; il dipendente vede in sola lettura | Risposta 1b (supera la regola "solo oggi" del Giorno 19) |
| 24/11 | Documentazione di progetto solo HR, nasce già "vista"; il dipendente vede i suoi progetti senza documentazione | Risposta 2 "tutti i dati li inserisce HR" |
| 24/11 | Segnalazioni del dipendente su un suo giorno (mai futuro); HR le vede in una finestra all'accesso (una volta per sessione e dopo ogni login), nella campanella e in dashboard; le chiude con una risposta | Risposta 4 "HR decide e interviene su segnalazione ma il sistema notifica a HR quando accede" |
| 24/11 | Le richieste di ferie/permessi/malattia restano al dipendente | Flusso di richiesta e approvazione, non dati nelle giornate (detto all'utente) |
| 24/11 | Allegato facoltativo alle assenze; il dipendente lo cambia solo a richiesta in attesa; lo aprono HR, chi l'ha caricato e il dipendente dell'assenza | Risposta 3b; per la malattia avviso "mai diagnosi" (GDPR art. 9) |
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

### Giorno 16 — Calendario: solo lunedì-venerdì, niente ore nel fine settimana e nei festivi (24/11/2026) ✅

Richiesta (arrivata durante il Giorno 15): "il calendario deve avere anche la possibilità di
selezionare solo la settimana lavorativa e nei giorni festivi, sabato e domenica non deve
poter essere possibile inserire nulla". Il resto della stessa richiesta (pannello a destra
con progetti e dipendenti filtrati, assegnazione dei dipendenti ai progetti) aspetta le
risposte alle domande del 24/11.

Fatto:
- `server/servizi/regole-ore.ts`: il contesto carica le festività del periodo; errore per
  sabato, domenica e festivi (con il nome della festa). Vale per giornata, fascia singola e
  import Excel; togliere ore già presenti resta possibile (giornata vuota).
- Calendario: interruttore **Lun–Ven** (mese e settimana, preferenza in localStorage);
  celle dei giorni non lavorativi senza ore non cliccabili, con il motivo nel suggerimento;
  l'editor in quei giorni permette solo di togliere le ore rimaste (`nonLavorativo`).
- Guida (immagine 25).

Verifiche: `npm test` 166/166 (5 nuovi in `giorni-lavorativi.test.ts`), typecheck e build
ok; Playwright su Edge 8/8 (sabato e domenica chiusi, Lun–Ven a cinque colonne e
ricordato, venerdì normale).

### Giorno 17 — Assegnazioni, pagina del progetto, documentazione di avanzamento (24/11/2026) ✅

Risposte dell'utente: 1a 2a 3a 4a; in più "l'inserimento progetto deve aprire una nuova
pagina in cui sono presenti anche le note e la documentazione del progetto" e "quando sono
presenti più soggetti dobbiamo poter filtrare tramite filtro a inserimento di caratteri".

Fatto:
- Schema: tabella `AssegnazioneProgetto` (progetto, dipendente, unica per coppia).
  Migrazione `20261124120000_assegnazioni` che assegna chi ha già ore (4a). Seed: ognuno
  ai suoi due progetti.
- `server/servizi/regole-ore.ts`: niente ore su progetti non assegnati (giornata, fascia,
  import, anche HR); tolleranza per le ore già presenti nel giorno.
- `server/rotte/progetti.ts`: `?assegnatiA=`, conteggio `assegnati`, GET/POST/DELETE
  `/:id/dipendenti`; il dipendente legge solo i progetti a cui è assegnato. Schema progetto
  con `descrizione` e `commessaSkytower`.
- `server/rotte/documentazione-progetto.ts`: `/api/documenti-progetto` (elenco, carica,
  revisione HR, elimina, invio a SkyTower) e `/api/note-progetto` (solo HR). Dashboard HR:
  `documentazioneDaVedere`.
- Interfaccia: `pagine/SchedaProgetto.tsx` (dati, assegnati, note, avanzamento,
  documentazione), `Progetti.tsx` apre la pagina e per il dipendente è "I miei progetti",
  `componenti/SceltaConRicerca.tsx` (scelta con ricerca a caratteri),
  `componenti/GraficoAvanzamento.tsx` (SVG fatto a mano, regole dataviz),
  `componenti/DocumentazioneProgetto.tsx`, `omonimi.ts` (nome + codice fiscale per gli
  omonimi); l'editor della giornata propone solo i progetti assegnati; dashboard con riquadro
  e pannello "Documentazione da vedere".
- Guida (immagini 26, 27, 28).

Verifiche: `npm test` 179/179 (13 nuovi in `progetti-giorno17.test.ts`, due test vecchi
spostati su progetti assegnati), typecheck e build ok; Playwright su Edge 21/21 (sezioni
della pagina, ricerca "ros" con codice fiscale, assegnazione, "I miei progetti",
documentazione con grafico, dashboard, risposta HR letta dal dipendente, telefono senza
scorrimento orizzontale). Corretto durante la prova: la tabella per i lettori di schermo
del grafico allargava la pagina sul telefono.

### Giorno 18 — Scheda dipendente in una pagina, omonimi, ricerca a caratteri, assenze in pagina (24/11/2026) ✅

Richieste del 24/11: "l'inserimento dei dati del dipendente tutte le aree devono essere nella
stessa pagina", "se ci sono omonimie il sistema distingue partendo dal codice fiscale",
"vale ugualmente per assenze e ferie", "filtrare tramite filtro a inserimento di caratteri".

Fatto:
- `pagine/SchedaDipendente.tsx` senza schede: modulo anagrafica/contratto/costi, poi
  account, stato, **progetti assegnati** (nuova sezione, stessa API del Giorno 17), attestati
  e documenti; collegamenti alle sezioni in cima; `?scheda=` scorre alla sezione; avviso
  degli omonimi con matricola e codice fiscale. Tolto il componente `Schede` da ui.tsx.
- `componenti/DocumentiDipendente.tsx`: modulo dell'attestato dentro la sezione (non più
  finestra), Esc lo chiude.
- `comune/omonimi.ts` (spostato da src/): usato in calendario, assenze, esporta, pagina
  del progetto e nella dashboard del server.
- `SceltaConRicerca` nei filtri dipendente/progetto del calendario e nella scelta del
  dipendente delle assenze; filtro a caratteri nelle liste di Esporta (oltre 6 voci).
- `pagine/SchedaAssenza.tsx` (/assenze/nuova, /assenze/:id) con le altre assenze del
  dipendente; `GET /api/assenze/:id`; elenco assenze che apre la pagina, ricerca anche per
  codice fiscale.
- Guida (immagini 06 e 22 rifatte, 29, 30, 31).

Verifiche: `npm test` 185/185 (4 in `comune/__tests__/omonimi.test.ts`, 2 in
`giorno18.test.ts`), typecheck e build ok; Playwright su Edge 23/23 (sezioni tutte
visibili, attestato senza finestra, progetto assegnato e tolto dalla scheda, `?scheda=`,
omonimo con CF, filtro "bian" nel calendario, assenza in pagina con le altre assenze,
ricerca per matricola, telefono senza scorrimento orizzontale).

### Giorno 19 — Giorni passati solo a HR, data di Logbook dal server (24/11/2026) ✅

Richieste del 24/11: "solo gli admin possono inserire elementi nelle giornate", precisata
subito dopo: "solo gli admin devono poter inserire i dati nelle giornate già passate
sincronizzando il calendario del pc con quello dell'app, per evitare che chiunque possa
inserire nei giorni passati lavorazioni che potrebbero non essere avvenute a scopo di
evitare pagamenti errati".

Fatto:
- `server/rotte/registrazioni.ts`: `soloOggiPerDipendente` → 403 per il dipendente su
  giornata, fascia nuova, modifica (anche spostando a oggi una fascia vecchia) e
  cancellazione di un giorno passato. I futuri restano 400 per tutti (regole-ore).
- `server/rotte/documentazione-progetto.ts`: il dipendente documenta solo con la data di oggi.
- `GET /api/oggi` (data e ora del server); `src/auth.tsx` la espone come `oggi`, si
  riallinea ogni 5 minuti e al ritorno sulla finestra; `Layout` mostra l'avviso giallo se
  il PC ha un'altra data.
- Calendario: "oggi" del server; i giorni passati per il dipendente (e i futuri per tutti)
  si aprono in sola lettura (`EditorGiornata` con `solaLettura`: niente Salva, campi spenti).
- Dashboard del dipendente: "Giorni passati senza ore" da segnalare a HR (via "Registra
  ore" sui giorni passati) e "Registra le ore di oggi".
- Documentazione di progetto: per il dipendente la data è fissa a oggi.
- Guida aggiornata (sezioni dipendente e HR).

Verifiche: `npm test` 191/191 (6 nuovi in `giorno19.test.ts`; nei test precedenti le
scritture nei giorni passati ora le fa l'admin), typecheck e build ok; Playwright su Edge
11/11 (giorno passato del dipendente in sola lettura, oggi scrivibile, 403 dal server, dashboard
senza "Registra ore" sul passato, HR scrive il passato, PC con data 10/11: avviso con le due
date e calendario sul 24/11 di Logbook). Guida: immagini 32 e 33.

### Giorno 20 — Ore e documentazione solo HR, segnalazioni con notifica all'accesso (24/11/2026) ✅

Risposte del 24/11: "1b 2 tutti i dati li inserisce hr 3 b 4 hr decide e interviene su
segnalazione ma il sistema notifica a hr quando accede".

Fatto:
- `server/rotte/registrazioni.ts`: scritture (giornata, fascia, modifica, cancellazione) con
  `richiediAdmin`; tolta la regola "solo oggi" del Giorno 19. La lettura resta al dipendente
  per le sue ore.
- `server/rotte/documentazione-progetto.ts`: carica ed elimina solo HR; il documento di HR
  nasce "visto".
- Segnalazioni: modello `Segnalazione` (migrazione `20261124140000_segnalazioni`),
  `comune/segnalazioni.ts`, `server/rotte/segnalazioni.ts` (elenco, conteggio, nuova,
  chiusura con risposta, ritiro), dashboard con `segnalazioni`.
- Interfaccia: `componenti/Segnalazioni.tsx` — `SegnalazioniGiorno` nella finestra della
  giornata (il dipendente segnala, HR chiude) e `Notifiche` (campanella nell'intestazione,
  finestra all'accesso); calendario sempre in sola lettura per il dipendente; dashboard con
  "Segnalazioni aperte" (HR) e "Le mie segnalazioni" (dipendente); pagina del progetto senza
  documentazione per il dipendente; `DocumentazioneProgetto` senza i rami del dipendente.
- `ui.tsx`: `Modale` disegnata in un portale su <body>: dentro l'intestazione sfocata
  (backdrop-filter) la finestra delle segnalazioni restava chiusa nell'intestazione.
- Guida riscritta per dipendenti e HR (immagini 12, 28, 32 rifatte, 34 nuova).

Verifiche: `npm test` 195/195 (4 in `giorno20.test.ts`, `giorno19.test.ts` riscritto per
la regola "solo HR"; nei test vecchi le scritture di ore le fa l'admin), typecheck e build
ok; Playwright su Edge 13/13 (giornata del dipendente in sola lettura anche oggi,
segnalazione inviata, progetto senza documentazione, finestra a HR all'accesso e non al
ricaricamento, campanella, chiusura con risposta letta dal dipendente).

### Giorno 21 — Menu laterale fermo (24/11/2026) ✅

Richiesta: "quando scrollo le pagine la barra di sinistra deve rimanere ferma e con tutte le
scelte ben visibili". `componenti/Layout.tsx`: da 768px il menu è sticky in alto e alto
quanto la finestra; le voci scorrono dentro il menu se lo schermo è basso. Sul telefono
resta il menu a scomparsa. Verifica Playwright su Edge 6/6 (1440×900, 1280×560 e
3440×1440: menu fermo in alto e «Impostazioni» visibile con la pagina scorsa in fondo).

### Giorno 22 — Allegato alle assenze (24/11/2026) ✅

Risposta 3b: allegato facoltativo alle assenze, mai certificati con diagnosi.

Fatto:
- Schema: `Assenza.fileId` (migrazione `20261124160000_allegato_assenze`, tabella ricreata
  da Prisma copiando le righe); `schemaAssenza` con `fileId`.
- `server/rotte/assenze.ts`: collega il file (`fileCollegabile`), lo sostituisce cancellando
  il vecchio, lo cancella con l'assenza; risposte con il file "pulito" (`vistaFile`).
- `server/rotte/file.ts`: il dipendente apre l'allegato della sua assenza anche se l'ha
  caricato HR; `archivio-file.ts`: un file di un'assenza conta come "usato" (niente riuso,
  niente pulizia degli orfani).
- Interfaccia: "Allegato" nella pagina dell'assenza con l'avviso per la malattia;
  graffetta nell'elenco. Guida aggiornata.

Verifiche: `npm test` 200/200 (5 in `giorno22.test.ts`), typecheck e build ok; migrazione
applicata al database demo all'avvio; Playwright su Edge 6/6 (avviso per la malattia,
richiesta con allegato, il dipendente apre il file, graffetta e allegato per HR, ritiro).
Guida: immagine 35.

### Giorno 23 — Verifica del codice e della sicurezza (24/11/2026) ✅

Richiesta: "una volta finito di implementare avvia una verifica per trovare le falle di
sicurezza e le parti di codice che non vengono chiamate e le librerie non in uso".

**Parte 1, codice e librerie** (commit `5d2cc3d`):
- `npm audit` non trova vulnerabilità, né nelle librerie di produzione né in quelle di sviluppo.
- knip 5 segnala come inutilizzata solo `@prisma/client`: è un falso allarme, perché la importa il client generato.
- Codice morto eliminato: `oreDecimali`, `InArrivo`, la rotta `/api/segnalazioni/conteggio` e quattro tipi.
- Duplicati unificati: la ricerca delle tabelle usa `corrisponde()`, poi il prefisso delle notifiche, le etichette e il link al giorno.
- Tolti 36 `export` inutili.

**Parte 2, sicurezza.** Una revisione indipendente in sola lettura ha trovato 14 punti, tutti ricontrollati sul codice.

Corretti:
- **Assenze fino al 9999.** Un dipendente poteva bloccare il server per secondi e rompere l'elenco di HR. Ora:
  - le date oltre il 31/12/2100 non sono valide (`isDataValida`);
  - i giorni lavorativi di un'assenza si contano senza ciclo (`contaGiorniLavorativi`).
- **Login.**
  - Il tentativo si conta prima di ogni `await`: prima, 500 richieste in parallelo valevano come una.
  - Il nome utente ha un massimo di 60 caratteri e il registro dei tentativi ha un tetto, per non riempire la memoria.
  - Per un utente inesistente si verifica una password finta, così il tempo di risposta è lo stesso.
  - Il cambio password ha lo stesso limite di 5 tentativi.
- **Cookie malformato.** Prima ogni chiamata dava 500, ora vale come "non collegato".
- **SkyTower.**
  - L'indirizzo non può contenere `?`, `#` o credenziali.
  - Se cambia il server, il token va reinserito.
  - URL composto con `URL` e `redirect: 'error'`.
  - Il token viene oscurato nei messaggi d'errore, tagliati a 200 caratteri.
  - Il link restituito da SkyTower si salva solo se è http(s).
- **Progetti.** Il dipendente vede solo quelli assegnati o con sue ore, senza commessa SkyTower e numero di assegnati.
- **File.**
  - Al massimo 20 file caricati e non ancora collegati per utente, controllati prima di leggere il corpo.
  - La pulizia degli orfani gira anche ogni 6 ore.
  - Il download usa `pipeline`: prima un errore di lettura faceva cadere il server.
- **Allegati delle assenze.** Solo PDF, .p7m e immagini (`ESTENSIONI_ALLEGATO_ASSENZA`): niente .doc/.xls con macro aperti da HR.
- **Limiti di quantità.**
  - Al massimo 20 segnalazioni aperte per dipendente.
  - La nota di HR sulle assenze ha un massimo di 500 caratteri.
- **Intestazioni.**
  - Su ogni risposta: `nosniff` e `Referrer-Policy`.
  - Sull'interfaccia: Content-Security-Policy con `frame-ancestors 'none'` e `X-Frame-Options: DENY`.

Non corretti, e perché:
- **Amministratore `admin` / `Admin2026!`.** Viene creato all'avvio se manca un admin e la password è scritta nel README. È una domanda aperta all'utente: obbligare il cambio al primo accesso, oppure esigere `LOGBOOK_ADMIN_PASSWORD`. Il database demo ha anche gli account di prova.
- **`trust proxy 'loopback'`.** Il limite dei tentativi si può aggirare solo dietro un proxy sullo stesso PC che inoltra `X-Forwarded-For` senza riscriverlo. Vale per Vite in sviluppo, raggiungibile solo in locale.
- **Cookie senza `Secure` su HTTP in rete.** È un tema di configurazione, da risolvere con HTTPS e `LOGBOOK_COOKIE_SECURE=1`.
- **Email di SkyTower.** Chi è admin di Logbook sceglie con quale utente SkyTower agire. È così per contratto della suite.

Verifiche:
- `npm test` 216/216, di cui 16 nuovi in `sicurezza-giorno23.test.ts`. Fra questi: 20 login in parallelo, di cui 5 rifiutati con 401 e 15 con 429, e un finto SkyTower che ripete il token o reindirizza.
- Typecheck ok.
- Nel database demo nessuna data oltre il 2100.
- Playwright su Edge 7/7: nessun blocco della CSP su 11 pagine (HR e dipendente), font caricati, Mario vede solo PRG-001 e PRG-003, e l'allegato delle assenze accetta solo PDF e immagini.

### Giorno 24 — Password provvisoria, rotte non usate, dipendenza dei test (24/11/2026) ✅

Risposte dell'utente alle domande del Giorno 23: "1a 2 tengo solo la cancellazione della
fascia oraria e le altre le tolgo inserendo la possibilità di usarla per HR 3a".

**1a, password provvisoria da cambiare al primo accesso.**
- `Utente.passwordDaCambiare`, aggiunto con la migrazione `20261124180000_password_da_cambiare`.
- Il segno viene messo:
  - quando HR crea un account o ne reimposta la password;
  - sull'amministratore creato all'avvio (`assicuraAdmin`);
  - a ogni avvio in produzione, sugli account che hanno ancora le password del README (`segnaPasswordPubblicate`, con admin e `USERNAME_DEMO`).
- Il codice sta in `server/auth/password-provvisorie.ts`.
- Finché il segno c'è, `richiediPasswordCambiata` (`server/middleware.ts`) risponde 403 a ogni API tranne `/api/auth`. L'interfaccia mostra solo `src/pagine/PasswordProvvisoria.tsx`, che usa il `ModuloPassword` estratto da `CambiaPassword.tsx`.
- La nuova password deve essere diversa da quella attuale.
- HR vede nella scheda se la password è ancora provvisoria.

**2, rotte mai chiamate dall'interfaccia.**
- Tolte:
  - `POST /api/registrazioni` e `PUT /api/registrazioni/:id`, con `schemaRegistrazione`, `primaSovrapposizione` e `messaggioSovrapposizione`;
  - `PUT /api/festivita/:id`;
  - `DELETE /api/file/:id`;
  - `GET /api/stato-dati`.
- Resta `DELETE /api/registrazioni/:id`, che ora è un pulsante per HR: nell'editor della giornata la ✕ di una fascia già salvata la elimina subito, dopo una conferma. Le altre righe e le modifiche in corso restano, e il calendario si aggiorna con `onModificato`.
- I test che usavano le rotte tolte ora passano dalla giornata intera.

**3a.** `better-sqlite3` è dichiarato tra le dipendenze di sviluppo (`^12.11.1`, la versione già installata), perché lo importa `server/__tests__/db-prova.ts`.

Verifiche:
- `npm test` 219/219, di cui 6 nuovi in `giorno24.test.ts`; typecheck ok.
- knip segnala solo il falso allarme di `@prisma/client`.
- Playwright su Edge 8/8, su una copia del database su un'altra porta, per non cambiare la password vera:
  - admin e mario vedono solo la pagina della password e le API rispondono 403;
  - con la stessa password il server rifiuta;
  - cambiata, Logbook si apre;
  - HR elimina 07:30-12:30 del 20/11 e resta 13:30-16:30.
- Avvio sulla copia: segnati admin e i 5 account di esempio.
- Guida aggiornata con le immagini 36 e 37; README aggiornato.

**Da sapere.** Sul Logbook dimostrativo, al prossimo accesso `admin` e gli account di esempio devono scegliere una password nuova.

**Domande aperte** (nuove richieste dello stesso messaggio):
- la matricola alfanumerica con riferimento al tipo di contratto;
- il tipo di mansione da scegliere da un elenco, con le mansioni nuove che restano disponibili.

### Giorno 25 — Estrazioni senza sabato e domenica (24/11/2026) ✅

Richiesta: "nelle estrazioni per la stampa deve sempre essere escluso sabato e domenica".
- `costruisciEstratto` (`comune/estratto-mese.ts`) restituisce solo i giorni da lunedì a venerdì. Vale per i due Excel mensili, l'anteprima e la stampa/PDF.
- La griglia "mese a calendario" ha cinque colonne (`GIORNI_GRIGLIA`, `settimaneDelMese`). In Excel anagrafica e riepilogo sono passati in G-H.
- Il report "calendario lavorato" non ha più righe di sabato e domenica.
- I totali restano calcolati su tutto il periodo: dal Giorno 16 nel fine settimana non si registrano ore.

Commit `5f72a70` e `27adc99` (guida, immagini 15 e 16 rifatte). Test 219/219. Playwright su Edge, a schermo e in stampa: griglia Lun-Ven e 22 righe in ottobre 2026.

### Giorno 26 — Matricola legata al contratto, mansioni da elenco (24/11/2026) ✅

Richiesta: "la matricola deve essere alfanumerica con riferimento al tipo di contratto per identificare prima il personale; deve essere possibile inserire il tipo di mansione e anche segnalarla come nuovo campo disponibile dopo l'inserimento". Risposte "tutti i suggeriti" (1a 2a 3a 4a).

**Matricola** (`comune/matricola.ts`):
- forma SIGLA-NUMERO: IND, DET, APP, SOM, COL, TIR, più un numero di almeno 4 cifre;
- il numero è unico fra tutti i dipendenti, qualunque sia la sigla;
- `schemaDipendente` accetta anche il solo numero ("7" diventa "IND-0007") e mette sempre la sigla del contratto;
- `GET /api/dipendenti/prossima-matricola` propone il prossimo numero libero;
- nella scheda, cambiando il contratto cambia subito la sigla;
- l'import delle ore riconosce il dipendente dal numero: valgono anche "0004" e "DET-0004" per chi ora è IND-0004.

**Mansioni**:
- nuova tabella `Mansione`;
- `GET /api/dipendenti/mansioni`;
- nella scheda la mansione si sceglie da un `datalist` con ricerca; per una mansione nuova compare l'avviso e al salvataggio entra nell'elenco;
- una mansione già presente scritta con altre maiuscole prende la grafia dell'elenco.

**Migrazione `20261124200000_matricola_contratto_mansioni`**:
- crea `Mansione` e la riempie con le mansioni già presenti, senza doppioni per maiuscole;
- converte le matricole solo numeriche nella forma nuova;
- salta quelle non numeriche e quelle che darebbero un numero doppio.

Seed: IND-0001, IND-0002, IND-0003, DET-0004, IND-0005 e l'elenco delle mansioni.

Verifiche:
- `npm test` 228/228, di cui 9 nuovi in `giorno26.test.ts`; fra questi c'è la migrazione eseguita sul database di prova;
- typecheck ok;
- Playwright su Edge, su una copia del database:
  - matricole convertite (Ferrari DET-0004);
  - proposta IND-0006, che diventa DET-0006 cambiando contratto;
  - elenco delle mansioni e avviso per "Gruista".
- Guida: immagine 38.

### Giorno 27 — Pannello a destra del calendario: più giorni e più dipendenti insieme (24/11/2026) ✅

Risposta 1a del 24/11: "clic su un giorno, oppure su più giorni tenendo premuto Ctrl o Maiusc; nel pannello a destra scegli progetto, dipendenti e orari, che vengono inseriti su tutti i giorni scelti". Le ore le inserisce solo HR (Giorno 20).

**Server**
- `POST /api/registrazioni/blocco`, solo HR, con `schemaBlocco` in `comune/registrazioni.ts`: progetto, da 1 a 200 dipendenti, da 1 a 62 giorni, da 1 a 6 fasce che non si sovrappongono fra loro, e una nota.
- Per ogni dipendente e ogni giorno si controllano le regole della giornata (`erroriRegole`): assegnazione, giorni futuri, festivi, ferie e malattia. Si controllano anche la sovrapposizione con le ore già registrate e il massimo del progetto.
- Tutto o niente: con anche un solo problema la risposta è 400, con `problemi` (chi, quale giorno, perché) e nessuna riga inserita. Altrimenti le fasce si aggiungono a quelle esistenti, in una transazione.

**Interfaccia**
- Calendario, solo per HR: clic sceglie un giorno, Ctrl+clic ne aggiunge o toglie uno, Maiusc+clic sceglie l'intervallo (solo i giorni che ricevono ore). Le celle scelte sono evidenziate.
- `src/componenti/PannelloGiorni.tsx`: affiancato da 1280px, sotto il calendario sugli schermi più stretti. Contiene:
  - i giorni scelti, con i giorni esclusi (futuri, non lavorativi) indicati;
  - progetto con ricerca, dipendenti assegnati e attivi (Tutti, Nessuno, filtro), fasce, nota e il conto delle ore;
  - l'elenco dei problemi del server;
  - con un solo giorno, "Ore del giorno" con "Apri" verso l'editor della giornata.
- Il pannello sostituisce la vecchia finestra "riepilogo del giorno". Il collegamento `?giorno=` della dashboard apre ancora l'editor.
- `ErroreApi` porta anche il corpo della risposta (`dati`).

**Verifiche**
- `npm test` 233/233, di cui 5 nuovi in `giorno27.test.ts`: inserimento, tutto o niente con tre motivi diversi, assegnazione, massimo del progetto, forma e 403 per il dipendente. Typecheck ok.
- Playwright su Edge 10/10, su una copia del database:
  - clic, Ctrl+clic e Maiusc+clic;
  - giorno futuro escluso;
  - inserimento di PRG-003 08:00-12:00 per Mario, visibile subito nella cella;
  - doppione rifiutato con il motivo;
  - "Apri" verso l'editor.
- Guida: immagine 39.

### Giorno 28 — Documentazione del giorno nella finestra delle ore (24/11/2026) ✅

Risposta 3c del 24/11 (allegati e nota nella finestra delle ore, "che finiscono anche nella documentazione del progetto della fascia"). Dal Giorno 20 la inserisce solo HR.
- `GET /api/documenti-progetto?data=` restituisce la documentazione di un giorno.
- `src/componenti/DocumentazioneGiorno.tsx`, nell'editor della giornata per chi può scrivere:
  - elenco della documentazione del giorno per i progetti delle fasce, con file ed "Elimina";
  - "+ Aggiungi documentazione": progetto (solo se nel giorno ce n'è più d'uno), titolo proposto, avanzamento facoltativo, nota e file;
  - si salva come documentazione del progetto con origine GIORNATA, e nella pagina del progetto compare "dalla giornata".
- La documentazione va sul progetto SALVATO della fascia (`progettoSalvato` in `EditorGiornata`), non su quello appena cambiato nel menu e non ancora salvato. È un difetto trovato dalla prova dal vivo e corretto.

Verifiche:
- `npm test` 235/235, di cui 2 nuovi in `giorno28.test.ts`: filtro per giorno, origine, file, il dipendente non vede né crea. Typecheck ok.
- Playwright su Edge 6/6, su una copia del database: titolo proposto, salvataggio con file, progetto salvato anche dopo un cambio non salvato, "dalla giornata" nella pagina del progetto.
- Guida: immagine 40.

### Giorno 29 — Grafici dell'avanzamento in dashboard (24/11/2026) ✅

Dal piano: "grafici di avanzamento in dashboard" (risposte del 24/11 sulla documentazione dei progetti, 2c).
- `GET /api/dashboard`, solo HR: `avanzamentoProgetti`. Per ogni progetto attivo o sospeso dà le percentuali dichiarate nella documentazione, in ordine di data, un punto per giorno (vale l'ultimo caricato). Al dipendente arriva vuoto.
- `src/componenti/AvanzamentoProgetti.tsx`, riquadro "Avanzamento dei progetti" in dashboard. Una riga per progetto, cliccabile verso la pagina del progetto, con:
  - un grafico a linea piccolo con asse 0-100% uguale per tutti, nel colore del progetto e con l'ultimo punto marcato;
  - un suggerimento su ogni punto e una descrizione per i lettori di schermo;
  - l'ultima percentuale con barra 0-100 e la data;
  - per i progetti senza dati, "nessun avanzamento dichiarato".
- SVG fatto a mano, regole della skill dataviz: una serie per riga senza legenda, testi nei colori del testo.

Verifiche:
- `npm test` 237/237, di cui 2 nuovi in `giorno29.test.ts`: ordine, un punto per giorno, documenti senza percentuale esclusi, progetti chiusi esclusi, niente per il dipendente. Typecheck ok.
- Playwright su Edge 5/5, su una copia del database con dichiarazioni di prova poi tolte. La prova ha portato a spostare la data sotto la percentuale, perché a riquadro stretto andava a capo.
- Guida: immagine 41.

### Giorno 30 — Un solo database, festività nel database nuovo (25/11/2026) ✅

Prima richiesta: "quello d'esempio tienilo solo per fare vedere come si visualizzano i dati e creane uno vuoto per quando andrà in produzione". Fatto con due database separati (commit 751bbd5, 45e1a0c, dad2fa9):
- copia dimostrativa in `data/demo`, porta 5211, `avvia-demo.bat`;
- fascia "Copia dimostrativa" nell'interfaccia.

Subito dopo l'utente ha cambiato idea: "il programma deve potersi popolare con i dati per farmi capire come sta funzionando, all'occorrenza devo poter cancellare tutto. Quindi avere 2 copie distinte non serve a nulla". Le tre modifiche sono state tolte con un revert. Il database con i dati di esempio è tornato a essere l'unico (`data/logbook.db`); quello vuoto è stato messo da parte fuori dal progetto.

Resta, perché serve comunque:
- `server/servizi/festivita.ts`, `aggiungiFestivitaNazionali`, usata dal pulsante di HR e da `prepara-db`;
- quando il database parte vuoto e senza festività, `prepara-db` carica quelle nazionali dell'anno in corso e del successivo. Senza, il calendario e il conteggio delle ferie tratterebbero i festivi come giorni lavorativi.

Verifiche: `npm test` 238/238, di cui 1 nuovo in `giorno30.test.ts` (festività aggiunte una volta sola, quelle di HR non toccate). Typecheck ok.

Prossimo, con domande aperte all'utente:
- comando riservato al proprietario per caricare i dati di esempio;
- comando per cancellare tutti i dati, con codice inviato via email;
- Logbook avviabile dentro e fuori dalla suite.

### Giorno 31 — Dati di esempio e "Cancella tutti i dati" con codice via email (25/11/2026) ✅

Richiesta: "il programma deve potersi popolare con i dati per farmi capire come sta funzionando, all'occorrenza devo poter cancellare tutto … un comando … usabile solo da me … invio di un codice via mail".

Risposte dell'utente:
- 1b: il codice va a un suo indirizzo, scritto solo nel `.env`;
- 2a: lo spedisce la casella aziendale, la password la scrive lui nel `.env`;
- 3a: restano il suo account, il collegamento a SkyTower e le festività nazionali;
- 4b: Logbook deve partire dentro e fuori dalla suite.

Cosa è stato fatto:
- **Proprietario** = account di `LOGBOOK_PROPRIETARIO` nel `.env`, amministratore e attivo. Logbook non lo chiede al Portale, perché deve funzionare anche fuori dalla suite. Non si cambia dall'interfaccia. Il codice va a `LOGBOOK_PROPRIETARIO_EMAIL`.
- **`server/rotte/proprietario.ts`**, rotte sotto `/api/proprietario`:
  - `GET /stato`: agli altri risponde solo `{ proprietario: false }`;
  - `POST /dati-esempio`: solo con Logbook vuoto; account di esempio con password provvisoria;
  - `POST /cancellazione/codice`;
  - `POST /cancellazione` con `{ codice, conferma: "CANCELLA" }`, poi un'email di avviso a cose fatte.
- **`server/servizi/codice-conferma.ts`**: 6 cifre da `crypto.randomInt`. In memoria resta solo l'impronta SHA-256, confrontata a tempo costante. Valido 10 minuti, una volta sola, 5 tentativi, al massimo 5 codici all'ora.
- **`server/servizi/cancella-dati.ts`**: una sola transazione nell'ordine dei vincoli. Poi i file sul disco, solo quelli elencati nel database, e le festività nazionali dell'anno in corso e del successivo.
- **`server/servizi/email.ts`**: `nodemailer` 10.4.1 (nuova dipendenza, con versione fissa), variabili `LOGBOOK_SMTP_*`. Con starttls la cifratura è obbligatoria. Senza server di posta non c'è una strada di riserva: la cancellazione resta spenta.
- **`prisma/seed.ts`**: usa l'amministratore che c'è già e aggiunge solo festività e mansioni mancanti.
- **Interfaccia**: `src/componenti/DatiProgramma.tsx`, riquadro "Dati del programma" in Impostazioni, solo per il proprietario.
- **`.env`** locale creato (non nel repository): proprietario `admin`, indirizzo del codice, campi del server di posta da completare.

Verifiche:
- `npm test` 249/249, di cui 11 nuovi in `giorno31.test.ts`:
  - solo il proprietario: un altro amministratore e un dipendente ricevono 403;
  - senza server di posta il codice non si chiede;
  - codice sbagliato, scaduto, esaurito, usato due volte; limite di 5 all'ora;
  - cosa resta e cosa va via, file sul disco compresi;
  - dati di esempio dopo la cancellazione.
- Typecheck ok.
- Playwright su Edge 8/8, su una copia del database con un finto server di posta locale: l'email passa davvero da `nodemailer`.
- Guida: immagini 42 e 43.

### Giorno 32 — Logbook dentro e fuori dalla suite (25/11/2026) ✅

Richiesta: "mi serve che il programma possa funzionare fuori dalla suite e quindi si deve poter avviare sia dentro che fuori". Risposta 4b: oltre alla suite, un installatore solo per Logbook.

Cosa è stato fatto:
- **Fuori dalla suite**: `installa-logbook.py`, compilato in `InstallaLogbook.exe` (PyInstaller 6.22.3 in un ambiente separato, niente installato nel sistema; l'exe è in `.gitignore`). Passi:
  - controlla Node.js 20.19+, ma non lo installa;
  - `npm ci`;
  - crea il `.env` con `LOGBOOK_PROPRIETARIO=admin` e chiede email del proprietario e accesso dalla rete;
  - `npm run prestart`: database vuoto con admin e festività, interfaccia compilata;
  - icona "Logbook" sul desktop verso `avvia.bat`.
  - Opzioni: `--si`, `--senza-collegamento`, `--dry-run`.
- **Dentro la suite**:
  - `installa-suite.py` (radice del repository): il `.env` di Logbook nasce con `LOGBOOK_PROPRIETARIO=admin`;
  - `InstallaSuite.exe` ricompilato nella radice della suite; il vecchio (9/11) è in `Documents\suite cosedil\_backup-installer\InstallaSuite-20261109.exe`;
  - la card Logbook del Portale c'era già.
- **Copia `Documents\suite cosedil`**: Logbook NON è stato copiato lì. La suite vera gira dal repository: il Portale parte da `Programmi-pronti-\portale\avvia.bat` e da quella copia prende solo i dati, con `PORTALE_DATA_DIR`. Il codice del Portale in quella copia è di settembre. Una seconda cartella Logbook avrebbe avuto un secondo database. Risposta dell'utente 3a: la copia resta com'è.

Verifiche:
- Fuori dalla suite: copia di Logbook in una cartella vuota (senza `node_modules`, `data`, `.env`), poi `InstallaLogbook.exe --si --senza-collegamento`, in 1 minuto e mezzo. Server avviato su una porta di prova: interfaccia servita, `admin`/`Admin2026!` entra con la password da cambiare.
  - Nota di metodo: in PowerShell in background `Set-Location` non vale. La prima prova era partita dal repository e aveva fallito per questo, non per l'installatore; rifatta con bash.
- Dentro la suite: Logbook avviato come fa il Portale (`wscript avvia.vbs` con `PORTALE_APRE_BROWSER=1` e `HOST`); risponde in 5 secondi.
- `InstallaSuite.exe --dry-run --app logbook` ok; controllata la riga `LOGBOOK_PROPRIETARIO` del `.env`.

### Giorno 33 — Seconda verifica di sicurezza (25/11/2026) ✅

Richiesta: "dobbiamo lavorare sulla sicurezza. Scandaglia tutta l'app e verifica se ci sono dei problemi e chiudili".

Cosa è stato guardato:
- librerie: `npm audit`, 0 vulnerabilità;
- tutte le rotte di `server/rotte` con i loro controlli di accesso (chi non è HR vede solo i propri dati, costi e commessa SkyTower nascosti);
- accesso, sessioni, password, protezione CSRF, gestore degli errori;
- file caricati e scaricati;
- il codice nuovo dei Giorni 24-32 (proprietario, codice via email, cancellazione, inserimento a blocchi, installatori);
- interfaccia: nessun HTML inserito a mano, collegamenti esterni solo http(s);
- repository: nessun segreto versionato (`.env` e database sono in `.gitignore`).

Problemi trovati e chiusi:
- **Login senza limite per indirizzo** (`server/rotte/auth.ts`). Il limite era per coppia indirizzo+utente: si poteva provare la stessa password su tanti nomi, o tenere occupato il server cambiando nome a ogni richiesta (ogni verifica costa 16 MB). Ora 30 tentativi falliti in 15 minuti fermano l'indirizzo; i login riusciti non contano.
- **Cookie di sessione in chiaro dietro HTTPS se si dimenticava `LOGBOOK_COOKIE_SECURE`** (`server/auth/sessioni.ts`). Ora è Secure da solo quando la richiesta arriva in HTTPS. In HTTPS si manda anche `Strict-Transport-Security` (`server/app.ts`).
- **Risposte delle API conservabili da browser e proxy** (`server/app.ts`): ora `Cache-Control: no-store` su tutte le API.
- **Account del proprietario modificabile da un altro amministratore** se collegato a una scheda dipendente (`server/rotte/dipendenti.ts`, `proteggiProprietario`): reimpostare la password o disattivarlo ora risponde 403. Il nome del proprietario nel `.env` si legge in minuscolo, come gli username.

Lasciati come sono, con il motivo:
- `Admin2026!` su un'installazione nuova: provvisoria e da cambiare al primo accesso, ma fino ad allora chi è in rete può entrare per primo. Su un PC nuovo conviene scrivere `LOGBOOK_ADMIN_PASSWORD` nel `.env` prima del primo avvio.
- La password della casella di posta sta in chiaro in `Logbook\.env`: il file è fuori dal repository e lo legge solo chi accede a questo PC. Aruba non offre una password separata per le applicazioni.
- Sulla rete locale senza il proxy HTTPS della suite il traffico è in chiaro, come per gli altri programmi della suite.

Verifiche: `npm test` 252/252, di cui 3 nuovi in `giorno33.test.ts` (blocco dell'indirizzo, cookie Secure e HSTS in HTTPS e non in HTTP, niente cache, proprietario protetto). Typecheck ok.

### Giorno 34 — Rafforzamento della sicurezza (25/11/2026) ✅

Richiesta: "implementa tutto e come credenziali admin fai in modo che durante l'installazione venga creato il primo admin con le credenziali inserite e poi solo lui possa dare quel ruolo. Parti dal primo punto e crea il db utilizzando sql. Le password dopo 10 tentativi fai aspettare 5 minuti e dopo sali a 10 e così via. Registro attività deve essere visibile nella barra sinistra solo ad admin. Sessioni solo 15 minuti se l'utente non sta facendo nulla".

Interpretazione di "crea il db utilizzando sql": la copia di sicurezza del database è creata con il comando SQL `VACUUM INTO`. Segnalato all'utente perché la corregga se intendeva altro.

Cosa è stato fatto:
- **Copie di sicurezza** (`server/servizi/backup.ts`): `VACUUM INTO` una volta al giorno (all'avvio e ogni ora, `server/index.ts`), file caricati copiati accanto, 30 giorni; cartella `LOGBOOK_BACKUP_DIR` o `data/backup`. Una copia `prima-cancellazione-…` parte prima di "Cancella tutti i dati": se non riesce non si cancella niente. Copia a mano dal riquadro del proprietario.
- **Blocco progressivo** (`server/rotte/auth.ts`): 10 password sbagliate per coppia indirizzo+utente, poi 5 minuti, 10, 20… fino a 24 ore; vale anche per il cambio password. Resta il limite di 30 per indirizzo.
- **Sessioni a 15 minuti** (`server/auth/sessioni.ts`, `src/api.ts`, `src/auth.tsx`): `Sessione.ultimoUsoIl` si aggiorna solo con le richieste che portano `X-Logbook-Attivo: 1`, aggiunta dall'interfaccia se l'utente ha mosso mouse o tastiera nell'ultimo minuto. Le chiamate automatiche non tengono aperta la sessione. La pagina di accesso spiega la chiusura.
- **Codice via email per gli amministratori**: da un PC non fidato, dopo la password serve il codice (`POST /api/auth/codice`); PC fidato 30 giorni (tabella `DispositivoFidato`), dimenticato al cambio o al reset della password. Solo con posta configurata e indirizzo noto; `LOGBOOK_CODICE_ACCESSO=0` lo spegne.
- **Primo amministratore** (`server/auth/password-provvisorie.ts`, `scripts/prepara-db.ts`, i due installatori): credenziali chieste all'installazione e passate solo al comando che crea il database; è il proprietario (`LOGBOOK_PROPRIETARIO` nel `.env`). Senza, `admin` con password casuale mostrata una volta. Via `Admin2026!` dalle installazioni vere.
- **Ruolo di amministratore** (`server/rotte/proprietario.ts`, `src/componenti/AccountAmministratori.tsx`): solo il proprietario lo dà e lo toglie.
- **Password**: 12 caratteri per gli amministratori, rifiutate le più comuni.
- **Registro attività** (`server/servizi/registro.ts`, `src/pagine/Registro.tsx`): tabella `RegistroAttivita`, voce del menu solo per gli amministratori, 400 giorni. "Cancella tutti i dati" non lo cancella.
- Migrazione SQL `20261125120000_registro_dispositivi_inattivita`.

Verifiche:
- `npm test` 260/260, di cui 8 nuovi in `giorno34.test.ts`; aggiornati i test dei vecchi limiti. Typecheck ok.
- Playwright su Edge 10/10 su una copia del database con finto server di posta: accesso in due passi, codice sbagliato rifiutato, PC fidato, registro, ruolo dato e tolto, copia a mano.
- Installatori: controllo sintattico e prova a secco. La domanda delle credenziali è interattiva e va provata a mano su un PC nuovo.
- Guida: immagini 44, 45, 46.

### Giorno 35 — Logbook su Vercel (25/11/2026) ✅

Richiesta: "il programma verrà caricato su Vercel per il momento", confermato dopo l'avviso che serviva cambiare struttura (risposta 1b: Vercel con database esterno; 2b: accesso da fuori per HR e dipendenti). Scadenza: il giorno dopo.

Scelta di fondo: **uno schema, due database**. In locale e nella suite resta SQLite con tutti i test; su Vercel PostgreSQL. `scripts/schema-postgres.mjs` copia `prisma/schema.prisma` cambiando solo il provider (`prisma/postgres/schema.prisma`, generato e non versionato); `prisma.config.ts` e `server/db.ts` scelgono dal `DATABASE_URL` (`suPostgres()` in `server/database-url.ts`).

Cosa è stato fatto:
- **Database**: `server/db.ts` usa l'adapter `pg` con PostgreSQL (nuove dipendenze `@prisma/adapter-pg` 7.10.1, `pg` 8.23.1). Su PostgreSQL la struttura si allinea con `prisma db push` (`scripts/prepara-db.ts`).
- **Niente memoria che dura**: tre tabelle nuove (migrazione SQLite `20261125150000_stato_per_vercel`).
  - `StatoTemporaneo` (`servizi/stato-temporaneo.ts`): codici via email e accessi in attesa del codice, ora sempre nel database anche in locale;
  - `TentativoAccesso` (`servizi/limitatore.ts`): blocco progressivo con incremento in un'operazione sola; in locale resta la versione in memoria;
  - `ContenutoFile` (`servizi/archivio-file.ts`): contenuto dei file caricati, massimo 4 MB (limite delle richieste su Vercel).
- **Funzione Vercel**: `server/vercel-funzione.ts` esporta l'app Express; `server/vercel.ts` con `tieniVivo` (waitUntil di `@vercel/functions` 3.11.0) per registro ed email scritti a risposta già inviata; pulizia periodica alla prima richiesta di ogni processo.
- **Build**: `scripts/vercel-build.mjs` produce `.vercel/output` (Build Output API v3): interfaccia statica, server in un file con esbuild, instradamento e intestazioni di sicurezza; `vercel.json` con regione `fra1`. `scripts/vercel-prova.mjs` lo serve in locale.
- **Dettagli**: data di oggi nel fuso italiano (`oggiItalia`, su Vercel l'orologio è UTC); `trust proxy` adatto a Vercel; su PostgreSQL niente copia locale (la fa il servizio del database) e il riquadro del proprietario lo dice.
- `docs/vercel.md`: passi di pubblicazione, variabili, limiti.

Verifiche:
- `npm test` 264/264 su SQLite, di cui 4 nuovi in `giorno35.test.ts` (file nel database, blocco su database anche in parallelo, stato a scadenza, fuso italiano). Typecheck ok.
- Prova completa del percorso Vercel in una cartella pulita, contro un PostgreSQL incorporato (PGlite, perché Docker su questo PC non partiva): `npm ci`, `vercel-build` (tabelle, amministratore, festività), poi il pacchetto servito da `vercel-prova`. 14 verifiche su 14 utili: accesso, sessione, dati di esempio (341 fasce), dashboard, calendario, esportazione Excel, file nel database, limite di 4 MB, registro, blocco dopo 10 errori, uscita.
- NON provato: la pubblicazione vera su Vercel (serve l'account dell'utente) e l'invio email da lì.

### Giorno 36 — Avvisi via email (26/11/2026) ✅

Richiesta: dopo l'elenco di 11 funzioni consigliate, "implementa tutto partendo dal primo punto". Questo è il punto 1.

Cosa è stato fatto:
- `server/servizi/avvisi.ts` (`creaAvvisi`): `nuovaRichiesta` (a HR), `esitoRichiesta` (al dipendente), `giornaliero(oggi)` (ore mancanti una volta alla settimana sugli ultimi 14 giorni; attestati a 30 e 7 giorni e alla scadenza), `prova`. Mai un errore verso chi chiama: un avviso non partito non blocca il lavoro.
- "Già mandato": righe `avviso:…` in `StatoTemporaneo` create con una insert sulla chiave unica, così due processi insieme non spediscono due volte. Nessuna migrazione nuova.
- Scelte in `Impostazione` (`avvisi.*`): indirizzi di HR (vuoto = email del proprietario) e quattro interruttori, tutti accesi finché nessuno li tocca. API `PUT /api/impostazioni/avvisi`, `POST /api/impostazioni/avvisi/prova`; riquadro `src/componenti/AvvisiEmail.tsx`.
- Agganci: `server/rotte/assenze.ts` (richiesta del dipendente e decisione di HR, a risposta inviata con `tieniVivo`).
- Pianificazione: ogni ora dopo le 7 in `server/index.ts`; su Vercel cron `0 6 * * *` su `/api/cron/avvisi` (scritto da `scripts/vercel-build.mjs`, protetto da `CRON_SECRET`) più la riserva nella manutenzione di `server/vercel-funzione.ts`.
- `server/servizi/email.ts`: `invioDaAmbiente` salta gli indirizzi dei dati di esempio (`@esempio.it`).

Verifiche:
- `npm test` 271/271, di cui 6 nuovi in `avvisi.test.ts` (posta finta): destinatari e testi, interruttori, indirizzo non valido, una volta al giorno anche con due chiamate insieme, soglie degli attestati, cron con e senza segreto. Typecheck ok.
- Prova dal vivo sulla copia senza posta (`scratchpad/giorno36.mjs`, 7 su 7): riquadro, salvataggio, messaggio d'errore, telefono. Immagine 47 della guida.
- NON provato dal vivo: l'arrivo vero di un avviso in una casella (in locale e su Vercel la posta è quella vera: lo prova l'utente con "Invia email di prova").

### Giorno 37 — Chiusura del mese (26/11/2026) ✅

Punto 2 della richiesta "implementa tutto partendo dal primo punto".

Cosa è stato fatto:
- Modello `MeseChiuso` (mese "AAAA-MM", chiusoIl, chiusoDa come testo) e migrazione SQLite `20261126090000_mese_chiuso`; su PostgreSQL arriva con `prisma db push` alla build.
- `server/servizi/mesi-chiusi.ts`: `controllaMesiAperti` / `controllaPeriodoAperto` (409 con il nome del mese) e `rotteMesiChiusi` (`GET /`, `GET /:mese/controllo`, `POST /`, `DELETE /:mese`). Si chiude solo un mese finito e senza richieste di assenza in attesa; i giorni senza ore sono un avviso.
- Controllo aggiunto in `rotte/registrazioni.ts` (giornata, blocco, cancellazione), `rotte/importa.ts` (conferma), `rotte/assenze.ts` (richiesta, modifica su periodo vecchio e nuovo, decisione, cancellazione), `rotte/festivita.ts` (aggiunta, cancellazione). "Carica festività nazionali" non è bloccato: aggiunge solo quelle mancanti.
- `servizi/cancella-dati.ts` toglie anche le chiusure; `servizi/registro.ts` con le etichette "Mese chiuso" / "Mese riaperto".
- Interfaccia: `src/componenti/ChiusuraMese.tsx` dentro `EstrattiMensili.tsx` (stato, finestra con i controlli, riapertura); lucchetto "Mese chiuso" in `src/pagine/Calendario.tsx`; icona `lucchetto`.

Verifiche:
- `npm test` 274/274, di cui 3 nuovi in `mesi-chiusi.test.ts` (chi può chiudere, mese non finito, richieste in attesa, ogni scrittura rifiutata nel mese chiuso, mese dopo libero, riapertura, cancellazione dati). Typecheck ok.
- Prova dal vivo sulla copia (`scratchpad/giorno37.mjs`, 8 su 8): chiusura di ottobre 2026 dalla finestra, novembre non chiudibile, lucchetto nel calendario, cancellazione di un'ora rifiutata con il messaggio, riapertura, telefono. Immagini 48 e 49 della guida.

### Giorno 38 — Saldo ferie e permessi (26/11/2026) ✅

Punto 3 della richiesta "implementa tutto partendo dal primo punto". Alla domanda "quanto matura ogni dipendente" l'utente non aveva ancora risposto: fatta la strada che non inventa numeri (quota scritta da HR per ogni dipendente, vuota di partenza), che copre anche il caso "uguale per tutti".

Cosa è stato fatto:
- Modello `QuotaAssenze` (uno per dipendente: giorni di ferie e ore di permesso all'anno, `contaDal`, residui di partenza) e migrazione SQLite `20261126110000_quota_assenze`; su PostgreSQL con `prisma db push`.
- `comune/saldi.ts`: `mesiMaturati` (un mese conta se coperto almeno 15 giorni) e `calcolaSaldo` (di partenza, maturato, goduto, residuo, programmato, in attesa, disponibile). Il saldo non si salva: si ricalcola dalle assenze.
- `server/rotte/saldi.ts` su `/api/saldi`: GET (HR tutti gli attivi, dipendente solo il suo), PUT e DELETE della quota (HR). `cancella-dati.ts` toglie anche le quote; etichette nel registro attività.
- Interfaccia: `src/componenti/SaldiAssenze.tsx` in cima a `src/pagine/Assenze.tsx` (tessere per il dipendente, riquadro richiudibile e modulo "Quota" per HR).

Verifiche:
- `npm test` con 4 test nuovi in `saldi.test.ts`: mesi che maturano (soglia dei 15 giorni, cavallo d'anno), conto completo con ferie a cavallo di oggi e di una festività, assunto dopo e cessato, API (permessi, validazione, richiesta nuova che entra "in attesa", quota tolta). Typecheck ok.
- Prova dal vivo sulla copia (`scratchpad/giorno38.mjs`, 7 su 7): quota di Rossi Mario dal modulo, saldo 21,5 giorni = 2,5 + 22 − 3, tessere del dipendente da telefono. Immagini 50, 51, 52 della guida.
- Regola da confermare con l'utente: la soglia dei 15 giorni per far maturare un mese è la prassi usuale delle buste paga, non una scelta dichiarata dall'utente.

### Giorno 39 — Logbook sulla schermata del telefono (26/11/2026) ✅

Punto 5 della richiesta "implementa tutto partendo dal primo punto" (il punto 4, timbratura, aspetta una decisione dell'utente).

- `public/logbook.webmanifest` (nome, colori, `display: standalone`, icone 192 e 512 anche "maskable"), `public/icona-192.png`, `icona-512.png`, `icona-180.png` create dal logo chiaro della suite su fondo blu Cosedil; richiami in `index.html` (manifest, apple-touch-icon, meta per iPhone).
- Nessun service worker: Logbook non lavora senza connessione, e i browser attuali non lo chiedono più per proporre l'installazione.
- Verifiche: `installabile.test.ts` (manifest valido, misure vere dei PNG, richiami nella pagina); prova nel browser (`scratchpad/giorno39.mjs`, 7 su 7): manifest letto senza errori, nessun ostacolo all'installazione, icone servite, nessun errore di sicurezza in console. NON provato su un telefono vero.

### Giorno 40 — Password dimenticata (26/11/2026) ✅

Punto 10 della richiesta "implementa tutto partendo dal primo punto" (fatto prima dei punti 4, 6, 7, 8, che aspettano risposte dell'utente).

- `server/rotte/auth.ts`: `POST /api/auth/dimenticata` (codice a 6 cifre all'email dell'account, risposta identica in ogni caso, invio a risposta già partita) e `POST /api/auth/reimposta` (codice + password nuova; la password si controlla prima del codice, così una password debole non lo consuma). Codici con scopo `reimposta` in `StatoTemporaneo`, nessuna migrazione.
- Dopo il cambio: password non più provvisoria, sessioni e PC fidati dimenticati, blocco del login azzerato; nessuna sessione aperta (si rientra dal login, gli amministratori ripassano dal codice di accesso).
- Interfaccia: `src/componenti/PasswordDimenticata.tsx` e collegamento "Password dimenticata?" in `src/pagine/Login.tsx`.
- Verifiche: `password-dimenticata.test.ts` (4 test: stessa risposta per account esistente, inesistente e senza email; codice sbagliato, di un altro account, già usato; password debole; sessioni chiuse; 12 caratteri per gli amministratori; 5 codici all'ora; senza posta). Prova dal vivo sulla copia con finta posta (`scratchpad/giorno40.mjs`, 7 su 7). Immagine 53 della guida.

### Giorno 41 — Costo della manodopera per commessa (26/11/2026) ✅

Punto 9 della richiesta "implementa tutto partendo dal primo punto".

- `Progetto.preventivoManodoperaCent` e `preventivoOre` (migrazione SQLite `20261126140000_preventivo_manodopera`; PostgreSQL con `prisma db push`).
- `server/rotte/costi-progetti.ts` su `/api/costi-progetti`, solo amministratori: elenco di tutti i progetti, dettaglio per dipendente e per mese, `PUT /:id/preventivo`. Chi non ha il costo orario è contato nelle ore e segnalato (`senzaCosto`).
- `server/rotte/progetti.ts`: i preventivi sono tolti dalle risposte ai dipendenti (elenco e scheda), come già la commessa SkyTower.
- Interfaccia: `src/componenti/CostoManodopera.tsx` nella scheda del progetto (totali, barre di consumo, modulo del preventivo, due tabelle).
- Limite dichiarato: si usa il costo orario attuale anche per le ore passate (non c'è storico dei costi).
- Verifiche: `costi-progetti.test.ts` (conti a mano su un progetto nuovo: 810 minuti, 291,00 € lordi, 190,00 € netti, 29,1% e 67,5% del preventivo; permessi; preventivo tolto; nessun preventivo ai dipendenti). Prova dal vivo sulla copia (`scratchpad/giorno41.mjs`, 8 su 8). Immagine 54 della guida. Trovato e corretto durante la prova: un importo scritto male nel preventivo non mostrava nessun messaggio.

### 26/11/2026 — L'app si chiama Copilota

Richiesta dell'utente: "cambia il nome della app in 'copilota'". Da qui in avanti il nome che si legge è **Copilota** (interfaccia, titolo, icona sul telefono, email, messaggi, guida, scheda nel Portale, domande degli installatori). In questo file le voci precedenti restano scritte com'erano, con il nome Logbook.

Non sono cambiati i nomi tecnici, perché cambiarli romperebbe installazioni e pubblicazione: cartella `Logbook/` (è la Root Directory su Vercel), variabili `LOGBOOK_*`, cookie `logbook_*`, intestazione `X-Logbook`, etichetta `[logbook]` nei log, `data/logbook.db`, `InstallaLogbook.exe`, `logbook.webmanifest`, progetto Vercel `programmi-pronti`. La password degli account di esempio resta `Logbook2026!`.

Come: sostituzione della parola con regola (mai dopo `X-` o `Installa`, mai dentro un percorso) su 74 file, poi controllo a mano dei riferimenti alla cartella. Verifica: typecheck, 285 test su 285 (i test che controllano oggetto e testo delle email ora aspettano "Copilota: …").
