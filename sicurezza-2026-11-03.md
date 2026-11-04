<!-- "><(((º> sabusabu <º)))>< -->
# Controllo di sicurezza della suite — 3 novembre 2026

Revisione del codice di tutte le app della suite Cosedil, fatta in sola lettura da quattro revisori
(portale e moduli condivisi, SkyTower, app Python, app Node), seguita dalle correzioni.
Obiettivo: trovare ciò che può compromettere dati o accessi e chiuderlo.
Ogni correzione ha i suoi test; i commit sono sul branch `feat/estrazione-dms`.

## Le falle più gravi, e com'erano sfruttabili

1. **Il controllo d'accesso comune lasciava passare troppo.** Proteggeva solo le pagine HTML e i
   percorsi che iniziano per `/api`. Da un PC della rete rispondevano senza login le rotte con dati fuori
   da `/api` (Lettore DDT, etichette del Magazzino), `/API` scritto in maiuscolo e i file dei server di
   sviluppo (database di Analista Dati, token della suite via OCR). Ora passa senza login solo ciò che è
   un file statico.
2. **Il login dal portale agganciava l'account sbagliato.** SkyTower e InCampo cercavano l'utente anche per
   la parte prima della `@`, in tutte le organizzazioni: un admin del portale poteva entrare come chiunque,
   anche come platform admin, senza password né secondo fattore. Ora solo email esatta, solo
   nell'organizzazione della suite, mai account admin; con l'MFA si passa dal login normale.
3. **Il token di servizio della suite apriva tutto.** Chi lo aveva agiva a nome di chiunque su ogni
   progetto. Ora in SkyTower vale solo per gli utenti dell'organizzazione della suite e lascia traccia, in
   Verifica requisiti apre cinque rotte, Ponte Trimble importa solo revisioni della commessa scelta.
4. **Modifiche ai cantieri altrui in InCampo**, tramite la sincronizzazione dell'app mobile.
5. **Analista Dati apriva qualunque database del server** su richiesta di un utente comune.
6. **Pagine di altre app potevano agire sul portale** a nome dell'admin (richieste forgiate).

## Esito per app

| App | Commit | Corretto | Rimandato |
|---|---|---|---|
| Moduli condivisi | 23ab99e | controllo d'accesso fail-closed, memoria con tetto, confronto del token | — |
| Portale | 13cf75c, 80bcd89 | richieste forgiate, IP del proxy, app accese non più spente, logout che chiude le sessioni, freno ai tentativi, header, nomi utente; dal 04/11 presenze ed eventi solo col token della suite | secondo cookie per l'area admin |
| Caddy | 2287428 | HSTS e nosniff | — |
| InCampo | aac0bac | sync sui cantieri altrui, login dal portale, IP non falsificabile, elenco utenti, credenziali nel repository, password della demo | ruolo predefinito dal portale (`manager`) |
| SkyTower | 6255b19, 104a6dd, 96cb534 | login dal portale e token ristretti, iscrizione automatica, OnlyOffice e filigrana, link nei metadati, limiti di dimensione, DXF e regex che bloccavano il server, log delle email, backup e API in Docker; dal 04/11 anche enumerazione delle organizzazioni e degli inviti, verifica del registro fatta dal worker, tetto sui metadati, ticket monouso o legati all'IP, sessione breve in HTTP, domini SSO verificati, massimo 5 stream di notifiche per utente | nessuna verifica DNS dei domini SSO; tetti degli stream per singolo processo |
| Magazzino | b786402 | etichette senza login, importazioni e percorsi solo admin, foto enormi | ruolo di sola lettura |
| Scadenzario | 199358a | export dell'anagrafica solo admin, estensioni degli allegati | — |
| Confronto documenti | db361b1 | proprietario dei confronti, coda per utente, avvio in rete senza login | — |
| VFP Transfer | 82111c3 | mittenti della posta obbligatori, archivi e Office binari, query del ponte | — |
| Lettore DDT | 70b6f4a | accesso solo dal portale, backup senza chiavi, corpi grandi | — |
| Verifica requisiti | 1b258c3 | token su cinque rotte, regex delle checklist, stato e metriche | timeout per singola regola |
| Ponte Trimble | 5992116 | revisioni fuori commessa, CSV con formule, header | — |
| Auguri | f11537d | socket ricontrollati, cartelle confinate, CSP | aggiornamenti di puppeteer e whatsapp-web.js (7 vulnerabilità alte) |
| Analista Dati | 5b93018 | server di sviluppo in rete, database a percorso libero, sessioni condivise, istruzioni nascoste nei documenti, CORS | — |
| OCR Documenti | f36b012 | accesso al monorepo dal server di sviluppo, lavori altrui, anteprima Word | dipendenze di sviluppo (eslint) |

Documenti collegati: `skytower/docs/adr.md` (ADR-47), `shared/suite/CONTRATTI.md` (paragrafi 2 e 4).

## Decisioni da prendere

- **Area admin del portale.** Il cookie del portale arriva a tutte le app; un'app compromessa potrebbe
  riusarlo per amministrare il portale. Due strade: un secondo cookie che resta solo al portale (più
  semplice), oppure un'identità firmata dal portale per ogni app.
- **Un token per ogni app** invece di uno unico per tutta la suite. Più sicuro, ma tocca tutte le app.

## Azioni manuali

- **App Node avviate prima del 04/11** (Lettore DDT, Verifica requisiti, Analista Dati, OCR Documenti, Auguri):
  finché non ripartono non registrano presenze e azioni nella plancia, perché il portale ora chiede il token
  della suite. Basta riavviarle dal portale.

- **Auguri** sulla porta 3000 gira dalla copia in `Documents\suite cosedil\whatss'app_web_Compleanni`, non dal
  repository: le correzioni lì non sono attive finché non la si sostituisce.
- **Lettore DDT**: le chiavi `.users.key` e `.session.key` non vanno più nel backup automatico; vanno
  conservate a parte, altrimenti un backup degli utenti non si rilegge.
- **Account personale di SkyTower**: essendo platform admin non entra più dal portale; entra con password
  e secondo fattore.
- **Demo di InCampo**: gli utenti demo già caricati hanno ancora la password pubblica del repository.
  Rilanciando `incampo\crea-demo.bat` ne viene messa una casuale, stampata a fine caricamento.
- **File con i segreti** (`shared\suite\.token`, `.env` delle app, `portale\data`): su un server condiviso
  vanno protetti con permessi NTFS riservati all'account che fa girare la suite.
