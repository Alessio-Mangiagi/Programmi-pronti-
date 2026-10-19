<!-- "><(((º> sabusabu <º)))><" -->
# Miglioramenti consigliati

Proposte per il programma di trasferimento documenti verso Viewpoint For Projects, in ordine di priorità.

**Stato attuale:** logica, interfaccia, posta, cassaforte e smistamento con Claude sono stati provati solo con
servizi simulati. Non sono mai stati usati con Viewpoint, Microsoft 365, le caselle email o Claude reali.

---

## 1. Prima dell'uso reale

| # | Proposta | Perché |
|---|---|---|
| 1 | **Prova pilota con i servizi veri**: progetto Viewpoint di prova e casella email dedicata, per una settimana con pochi documenti, confrontando a mano il risultato | È il rischio più grande. Da verificare: formato delle risposte di Viewpoint, rinnovo automatico dell'accesso (`offline_access`), PKCE, spostamento delle email, invio dei codici all'amministratore |
| 2 | **Copia di recupero della cassaforte**: esportazione cifrata con una chiave di recupero, conservata stampata o in un posto sicuro, separata dal PC | Se un amministratore reimposta la password Windows dell'utente del servizio, utenti e credenziali vanno persi |
| 3 | **Servizio Windows con un account dedicato** al posto dell'avvio all'accesso dell'utente | Oggi il programma parte quando un utente entra nel PC: se nessuno accede dopo un riavvio, la posta si ferma. Un servizio parte all'accensione, gira con un account senza altri privilegi e rende la cassaforte indipendente dalla persona |
| 4 | **Avvisi all'amministratore via email** | Oggi i problemi si vedono solo aprendo l'interfaccia. Il meccanismo di invio esiste già |

Avvisi da prevedere (punto 4):

- **immediati:** accesso a Viewpoint scaduto, email bloccate o in errore, casella irraggiungibile, antivirus non disponibile;
- **riepilogo giornaliero** alle 8.

---

## 2. Funzioni utili

| # | Proposta | Beneficio |
|---|---|---|
| 5 | **Smistamento automatico anche per la posta**, oggi tutta in un'unica cartella | Gli allegati finiscono subito nella cartella giusta |
| 6 | **Colonna "Da smistare" con il pulsante "Assegna"**: l'amministratore sceglie la cartella e il programma propone di salvarla come nuova regola | Col tempo serve sempre meno intervento manuale |
| 7 | **Niente doppioni**: impronta di ogni file per riconoscere e saltare gli allegati già caricati | Lo stesso allegato inoltrato da più persone oggi diventa più revisioni |
| 8 | **Compilare i dati del documento in Viewpoint** (commessa, disciplina, tipo, revisione) partendo dal nome del file o dai dati del DMS | Documenti ricercabili e filtrabili, non solo nome e cartella |
| 9 | **Collegamento diretto al DMS** al posto dell'export su disco | Niente export manuali. Per valutarlo serve sapere quale prodotto è il DMS e se ha delle API |

Ordine dello smistamento della posta (punto 5):

1. regole fisse descritte in `COLLEGAMENTO_CARTELLE_TRIMBLE.md` (codice commessa, codifica del file, mittente);
2. Claude, solo per i casi non riconosciuti;
3. quello che resta va in "Da smistare".

---

## 3. Sicurezza e manutenzione

| # | Proposta | Beneficio |
|---|---|---|
| 10 | **Doppio controllo all'accesso dell'amministratore**: password più codice via email | Riusa il meccanismo dei codici che c'è già: costa poco |
| 11 | **Pagina "Registro attività" per l'amministratore**: accessi, modifiche, codici richiesti | Oggi queste informazioni sono solo nel file di log |
| 12 | **Pulizia automatica** di `posta_in_arrivo/`, del registro e dei log dopo un numero di mesi deciso con chi si occupa della privacy, più un controllo dello spazio su disco | Conservazione dei dati sotto controllo, disco mai pieno |
| 13 | **Installazione chiusa**: Python incluso nel pacchetto e librerie a versione bloccata | Il primo avvio non scarica niente da Internet |
| 14 | **Font salvati nel programma** al posto di quelli di Google | Funziona anche senza Internet e nessun dato va a Google |
| 15 | **Test nel repository**: i circa 120 test scritti finora, da far girare a ogni modifica | Oggi sono in una cartella temporanea e andrebbero persi |

---

## 4. Realizzati (ottobre 2026)

- Pagina **Attività utenti** (punto 11).
- **Test nel repository** (punto 15): `tests/`, 50 test con la sola libreria standard.
- **PEC**: lettura di `daticert.xml`, verifica della firma del gestore, **ricevute** di accettazione e consegna
  registrate per il tracciamento.
- **Protocollo PEC**: regola configurabile con prova, correzione a mano, **controllo di numeri mancanti e doppi**
  per anno in Panoramica, registro annuale in Excel, protocollo nella descrizione del documento in Viewpoint.
- **Uso quotidiano**: ricerca unica (`Ctrl+K`), *Riprova adesso* sulle email in errore, anteprima degli allegati,
  link ai documenti in Viewpoint (`VFP_DOC_URL`).
- **Affidabilità**: controllo dello stato `/api/salute` e sorveglianza che riavvia il programma se la posta si blocca.
- **Accesso dalla rete** facoltativo, solo in HTTPS con certificato.
- **Codice**: API della posta in `api_posta.py`, interfaccia divisa in `ui/js/` per pagina.

Da verificare con i servizi veri: formato reale degli oggetti delle vostre PEC (regola del protocollo), firma di
una PEC vera, indirizzo web dei documenti di Viewpoint per `VFP_DOC_URL`, "Riprova adesso" su IMAP/Microsoft 365.

## 5. Ordine consigliato

| Fase | Punti | Motivo |
|---|---|---|
| Prima | 1, 3, 4 | Decidono se il programma regge nell'uso quotidiano |
| Subito dopo | 15 | Veloce, protegge tutte le modifiche successive |
| Poi | 5, 6 | Fanno risparmiare più tempo al personale |
| In seguito | 2, 7–14 | Completano sicurezza, qualità dei dati e manutenzione |
