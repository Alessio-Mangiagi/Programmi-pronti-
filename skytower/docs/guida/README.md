<!-- "><(((º> sabusabu <º)))>< -->
# Guida utente di SkyTower

SkyTower è l'ambiente comune dei dati (CDE, *Common Data Environment*) della suite Cosedil: il posto unico dove
le imprese e i professionisti di una commessa caricano, condividono, approvano e pubblicano tavole, modelli BIM,
relazioni e verbali secondo la norma **ISO 19650**. Nella barra in alto il programma si presenta come
**CDE · ISO 19650**.

Questa guida spiega *dove si clicca e cosa succede*. Le immagini vengono dalle commesse dimostrative della suite
(«101-003 - Sede Acireale», «C-2024-015 - Scuola Via Roma», «Nuovo Ospedale Nord», «141-103-2 - Galleria Fortolese»)
con gli utenti di prova (Com Admin, Com Im, Des Lead, Sub1 User…).

## A chi serve

| Se sei… | Leggi soprattutto |
|---|---|
| **Progettista** (carichi tavole e modelli, rispondi alle RFI) | 1, 2, 3, 4, 5, 7, 12 |
| **Direzione lavori / Information Manager** (verifichi, commenti, approvi) | 1, 3, 5, 6, 7, 8, 9 |
| **Subappaltatore / impresa** (consulti i documenti pubblicati, fai domande) | 1, 2, 3, 5, 7, 8 |
| **Project Admin / BIM Manager** (governi la commessa) | tutti, in particolare 2, 4, 6, 10, 11 |
| **Amministratore dell'organizzazione** (gestisci colleghi e accessi della tua azienda) | 1, 10, 11, libreria workflow nel 6 |
| **Committente** (ricevi, approvi, controlli) | 1, 3, 6, 8, 9, cruscotto nel 10 |

## Capitoli

1. [Accesso e interfaccia](01-accesso-e-interfaccia.md) — entrare, la schermata a tre colonne, il profilo
2. [Commesse e cartelle](02-commesse-e-cartelle.md) — progetti, cartelle, condivisioni, aree riservate
3. [Documenti e revisioni](03-documenti-e-revisioni.md) — caricare, condividere, pubblicare, cercare, scaricare
4. [Naming dei file](04-naming.md) — regola dei nomi, rinomina automatica, prenotazioni, filigrana
5. [Visualizzatore e annotazioni](05-visualizzatore-e-annotazioni.md) — PDF, ricerca nel testo, confronto, commenti
6. [Workflow e processi](06-workflow-e-processi.md) — approvazioni, editor a scacchiera, processi, libreria
7. [RFI — richieste di informazioni](07-rfi.md)
8. [Transmittal — trasmissioni ufficiali](08-transmittal.md)
9. [Per me, compiti e notifiche](09-per-me-compiti-notifiche.md)
10. [Amministrazione della commessa e dell'organizzazione](10-amministrazione.md)
11. [Sicurezza dell'account e registro attività](11-sicurezza-e-registro.md)
12. [Modelli BIM, IFC e disegni DWG/DXF](12-bim-ifc-dwg.md)
13. [Appendice per l'amministratore di sistema](13-appendice-amministratore-di-sistema.md)

## Come si entra, in breve

- Dal **Portale** della suite Cosedil: clic sulla tessera di SkyTower, si entra senza password.
- Dall'indirizzo di SkyTower: email e password (più il secondo fattore, se attivo), oppure l'account aziendale
  (single sign-on) o una passkey. Dettagli nel [capitolo 1](01-accesso-e-interfaccia.md).

## Glossario breve (ISO 19650)

| Termine | Cosa vuol dire in SkyTower |
|---|---|
| **Commessa / progetto** | L'insieme di cartelle, documenti, persone e regole di un lavoro. Ha un codice breve (es. `ACI003`) che apre ogni nome di file. |
| **Contenitore (container) / cartella** | Una cartella del CDE. Appartiene a un'organizzazione (la sigla accanto al nome: `DES`, `COM`…), che la gestisce. |
| **Organizzazione / originatore** | L'azienda che produce il documento. Il suo codice (es. `DES`) è il secondo campo del nome del file. |
| **WIP — In lavorazione** | Il documento è in lavorazione: lo vede **solo la tua organizzazione**. Revisioni `P01.01`, `P01.02`… |
| **Shared — Condiviso** | Il documento è messo a disposizione del team di coordinamento (chi ha accesso alla cartella). Revisione `P01`, `P02`… |
| **Published — Pubblicato** | Versione contrattuale, valida per tutti i membri della commessa. Revisione `C01`, `C02`… |
| **Archived — Archiviato** | Documento chiuso: si legge ma non cambia più. |
| **Revisione** | Ogni caricamento crea una revisione nuova e **immutabile** (con la sua impronta SHA-256). Le revisioni vecchie restano sempre consultabili. |
| **Idoneità (suitability)** | Il codice che dice *a cosa serve* una revisione: `S0` lavoro in corso, `S1` coordinamento, `S2` informazione, `S3` revisione e commento, `S4` approvazione di fase; `A1`–`A7` accettato (pubblicato), `B1`–`B3` parziale con commenti, `CR` as-built. |
| **Naming convention** | La regola dei nomi dei file: `PROGETTO-ORIGINATORE-VOLUME-LIVELLO-TIPO-RUOLO-NUMERO`, es. `ACI003-DES-ZZ-00-DR-A-0043`. |
| **Workflow** | Lo schema di chi verifica e approva, con quali esiti e dove porta ogni esito. |
| **Processo** | Un workflow che parte senza documento (es. Richiesta d'Acquisto → gara → affidamento). |
| **RFI** | *Request for Information*: domanda formale con destinatari, scadenza e risposta ufficiale. |
| **Transmittal** | Trasmissione ufficiale di documenti con numero di protocollo, PDF e conferma di ricezione. |
| **Registro attività** | Il diario di tutto ciò che succede nella commessa, sigillato in modo che nessuno possa ritoccarlo. |

## Se qualcosa non va

- **«Non trovato» o cartella invisibile**: non hai i permessi per quell'oggetto. È voluto: SkyTower non rivela
  nemmeno l'esistenza di ciò che non puoi vedere. Chiedi al Project Admin o all'amministratore della cartella.
- **Pulsante grigio**: l'azione non è permessa a te o in quello stato (es. *Trasmetti* su un documento ancora in
  lavorazione). Passa il mouse sopra o leggi il capitolo dell'azione.
- **«Troppi tentativi: riprovare tra un minuto»** al login: hai sbagliato la password più volte; aspetta un minuto.
- Per tutto il resto: amministratore della tua organizzazione, poi l'assistenza IT della suite.
