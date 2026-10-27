<!-- "><(((º> sabusabu <º)))><" -->
# Collaudo con gli utenti pilota (UAT, G59)

Ambiente: staging con la commessa demo popolata (`cde demo-contenuti --api <staging>/api`).
Password degli utenti demo: quella del seed, comunicata a parte. Ogni scenario si esegue nel browser, senza
strumenti tecnici. Compilare **Esito** (OK / KO / Osservazione) e, se KO, descrivere cosa si è visto.

Criterio di accettazione: nessun KO **bloccante** (perdita o fuga di dati, impossibilità di completare un flusso
principale). I KO non bloccanti vanno nel piano di rientro con una data.

## Ruoli pilota

| Ruolo | Utente demo | Organizzazione |
|---|---|---|
| BIM Manager / Project Admin | `com.admin@com.example` | Committente (COM) |
| Direttore dei lavori | `com.dl@com.example` | Committente (COM) |
| Progettista capogruppo | `des.lead@des.example` | Studio di progettazione (DES) |
| Subappaltatore | `sub1.user@sub1.example` | Impianti elettrici (SUB1) |

## Scenari

| ID | Ruolo | Passi | Risultato atteso | Esito |
|---|---|---|---|---|
| U01 | Progettista | Carica un PDF con nome conforme (es. `PRJ01-DES-ZZ-01-DR-A-0101.pdf`) in "Tavole architettoniche" | Revisione P01.01 in WIP, badge "In verifica" poi "Verificato" | |
| U02 | Progettista | Carica un file con nome qualsiasi e usa "Rinomina con progressivo" | Nome conforme proposto col progressivo; dopo il caricamento il nome originale è nelle note della revisione | |
| U03 | Progettista | Carica tre file non conformi insieme | Numeri consecutivi nell'anteprima e identici dopo il caricamento | |
| U04 | Subappaltatore | Cerca il documento di U01 | Non visibile (WIP di un'altra organizzazione) | |
| U05 | Progettista | Condivide il documento di U01 (WIP → SHARED) con motivazione | Revisione P01, visibile al team di coordinamento | |
| U06 | Direttore dei lavori | Apre il documento condiviso, cerca una parola nel testo del PDF, aggiunge un'annotazione | Occorrenze evidenziate; annotazione visibile agli altri con numero e stato | |
| U07 | BIM Manager | Avvia il workflow di revisione sul documento | Compito nella colonna "Per me" del verificatore; il documento non accetta nuove revisioni | |
| U08 | Direttore dei lavori | Rifiuta con commento | Il progettista riceve la notifica; il documento torna modificabile | |
| U09 | Progettista | Carica la nuova revisione e la riconduce in approvazione; il DL approva | Revisione approvata, pubblicabile | |
| U10 | BIM Manager | Pubblica (SHARED → PUBLISHED) | Revisione C01 visibile a tutti i membri, subappaltatore incluso | |
| U11 | Progettista | Confronta due revisioni PDF | Rosso solo nella revisione aperta, blu solo in quella di confronto | |
| U12 | Progettista | Apre il modello IFC, seleziona un elemento, lascia un'annotazione sull'elemento | Albero spaziale, proprietà e sezione funzionano; annotazione legata all'elemento | |
| U13 | Subappaltatore | Apre una RFI verso il progettista allegando un documento già caricato | Numero progressivo, destinatario notificato, scadenza visibile | |
| U14 | Progettista | Risponde alla RFI e la chiude | Thread completo, stato chiuso, notifica al richiedente | |
| U15 | BIM Manager | Emette un transmittal con due documenti pubblicati | Protocollo TRM-nnnn, PDF con elenco e impronte, ricevute dei destinatari | |
| U16 | BIM Manager | Cruscotto: individua il collo di bottiglia e apre l'elenco dei documenti | Numeri coerenti con i documenti di prova, drill-down funzionante | |
| U17 | BIM Manager | Esporta Excel registro documenti, approvazioni, RFI aperte | File apribili, colonne leggibili, nessuna formula eseguibile | |
| U18 | BIM Manager | Registro attività: filtra per documento, verifica integrità, esporta CSV e PDF firmati | Catena integra, eventi degli scenari precedenti presenti | |
| U19 | BIM Manager | Scheda Naming: cambia il primo numero del progressivo e un valore proposto | Il successivo caricamento rinominato rispetta le nuove impostazioni | |
| U20 | BIM Manager | Crea un'area riservata; il progettista ne chiede l'accesso; l'admin approva | Accesso concesso solo dopo approvazione, revocabile | |
| U21 | Subappaltatore | Prova ad aprire l'indirizzo di un documento DES copiato da un collega | "Non trovato", nessun dettaglio rivelato | |
| U22 | Tutti | Profilo: cambia nome e preferenze notifiche; attiva l'MFA | Modifiche salvate; il login successivo chiede il codice | |
| U23 | Tutti | Uso da tablet in cantiere: apre un PDF, zoom, annotazione | Leggibile e utilizzabile senza zoom del browser | |

## Verbale

| Voce | Valore |
|---|---|
| Date del collaudo | |
| Partecipanti (nome, ruolo, organizzazione) | |
| Scenari OK / KO / osservazioni | |
| KO bloccanti aperti | |
| Esito del pentest esterno (G57) | |
| Prova di disaster recovery: RPO/RTO misurati (runbook §4) | |
| Decisione | ☐ Go-live ☐ Go-live con riserva ☐ Rinvio |
| Firme | |
