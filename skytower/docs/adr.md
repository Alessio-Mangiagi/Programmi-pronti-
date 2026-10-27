<!-- "><(((º> sabusabu <º)))><" -->
# Architecture Decision Records

Registro delle decisioni architetturali del CDE ISO 19650. Le decisioni ADR-01…12 vengono dal piano di
sviluppo; qui sono riportate con lo stato attuale e le motivazioni di ogni scostamento.

| # | Decisione | Stato | Note |
|---|---|---|---|
| ADR-01 | Monolite modulare | Accettata | Moduli in `apps/api/cde_api/modules/` (auth, me, organizations, projects, containers) |
| ADR-02 | Backend | **Modificata** | **Python 3.12 + FastAPI** al posto di Node.js + NestJS (vedi sotto) |
| ADR-03 | PostgreSQL 16 | Accettata | RDS Multi-AZ in prod; in sviluppo Postgres 16 embedded (`pgserver`) |
| ADR-04 | DB condiviso + RLS | Accettata | Policy in `db/migrations/0003_rls.sql` |
| ADR-05 | Auth interno | Accettata, con precisazioni | Chiave JWT in Secrets Manager (cifrata con KMS), non firma via KMS |
| ADR-06 | S3 + Object Lock | Accettata | Bucket in `infra/terraform/envs/dev`; GOVERNANCE in dev, COMPLIANCE in prod; moto in dev/test |
| ADR-07 | Code / job | **Modificata** | **Procrastinate su PostgreSQL** (schema `jobs`) al posto di Redis + BullMQ |
| ADR-08 | React 18 + TS + Vite + TanStack Query + MUI | Accettata | `apps/web`; React Router v7 in modalità libreria |
| ADR-09 | Viewer | Invariata | Sprint 5 |
| ADR-10 | ECS Fargate, Terraform, GitHub Actions | Accettata | Terraform basato su `terraform-aws-modules` |
| ADR-11 | OpenTelemetry + Grafana | Invariata | Sprint successivi |
| ADR-13 | Macchina a stati CDE | Accettata | Transizioni in tabella, ricodifica con nuove revisioni immutabili |
| ADR-12 | Migrazioni SQL versionate | **Modificata** | **yoyo-migrations** (file `.sql` puri) al posto di dbmate |

---

## ADR-02 (rev. 1) — Backend Python + FastAPI

**Contesto.** Il team ha indicato Python come linguaggio preferito e la regola "usare librerie mature
invece di scrivere codice quando esistono".

**Decisione.** API in Python 3.12 con FastAPI, accesso a PostgreSQL con psycopg 3 (SQL esplicito, nessun ORM)
e pool di connessioni `psycopg_pool`.

| Esigenza | Libreria |
|---|---|
| Hash password Argon2id | `argon2-cffi` |
| JWT RS256 + JWKS | `PyJWT[crypto]` |
| TOTP | `pyotp` (+ `qrcode` per il QR in SVG) |
| WebAuthn (backlog) | `webauthn` |
| Rate limiting (memoria/Redis) | `limits` |
| Envelope encryption | `cryptography` (Fernet) + AWS KMS `GenerateDataKey` |
| Configurazione | `pydantic-settings` |
| Migrazioni SQL | `yoyo-migrations` |

**Conseguenze.** Il guard `@RequirePermission` di NestJS diventa la coppia `require_project()` /
`require_container()` in `deps.py`. OpenAPI resta nativo (FastAPI, `/docs`). Per i job asincroni
BullMQ non è utilizzabile: decisione rinviata ad ADR-07 rev. 1 (Sprint 2).

## ADR-05 (precisazioni chiuse in G5)

- **Chiave di firma JWT**: PEM RSA 3072 in Secrets Manager cifrato con KMS. La firma tramite
  `kms:Sign` aggiungerebbe una chiamata di rete a ogni emissione di token senza vantaggi pratici sul
  rischio (la chiave vive comunque nella memoria del processo API per la verifica).
- **`cde_auth` e RLS**: invece di `row_security = off` (che fa *fallire* le query sulle tabelle con
  RLS) il ruolo ha policy dedicate `USING (true)` limitate a `users`, `organizations`, `user_tokens`,
  più privilegi a livello di colonna. Nessun privilegio sulle tabelle di progetto.
- **Token di refresh**: rotazione a ogni uso; il riuso di un token già ruotato revoca l'intera
  famiglia ed emette `TOKEN_REUSE`. Nessun periodo di grazia: due tab che rinnovano in parallelo
  possono causare un logout (accettato per l'MVP).
- **MFA obbligatoria per tenant**: se `organizations.mfa_required` e l'utente non ha fattori, il login
  rilascia solo un token parziale `mfa_pending` (5') valido esclusivamente per l'enrollment TOTP.
- **TOTP anti-replay**: si memorizza l'ultimo time-step accettato (`last_used_step`).

## ADR-04 — Correzioni emerse nei test (Sprint 1)

1. **Ricorsione delle policy.** La bozza faceva interrogare `project_memberships` dalla policy di
   `users` e `users` dalla policy di `project_memberships` → `infinite recursion detected in policy`.
   Tutte le policy ora usano solo helper `SECURITY DEFINER` (`user_visible`, `org_visible`,
   `can_manage_membership`, …), che leggono come proprietario senza RLS.
2. **Escalation di privilegi.** Con la bozza un ORG_ADMIN (ADMIN su `OWN_ORGANIZATION`) poteva
   assegnare a un collega — o a se stesso — il ruolo PROJECT_ADMIN. `can_manage_membership()` vieta agli
   admin di organizzazione l'assegnazione di ruoli che contengono permessi con scope `PROJECT`.
3. **T7 (nessun contesto ⇒ zero righe).** I ruoli template erano visibili anche senza `app.user_id`;
   ora richiedono un utente attivo.
4. **`INSERT … RETURNING` sui container.** La policy SELECT usa `has_permission()` (STABLE), che non
   vede la riga inserita nello stesso comando: l'API genera l'UUID e rilegge con una SELECT.
5. **Creazione progetto.** Prima dell'inserimento il creatore non è membro, quindi nessuna policy può
   autorizzarlo: la funzione `cde.create_project()` crea atomicamente progetto, partecipazione del
   committente e membership PROJECT_ADMIN, solo per gli admin di organizzazione.
6. **Flag di organizzazione.** Aggiunti `users.is_org_admin` (gestione utenti e creazione progetti della
   propria azienda) e `users.is_platform_admin` (creazione organizzazioni), assenti nella bozza.
7. **`citext` non garantita** in tutti gli ambienti: email normalizzate minuscole con `CHECK` e indice
   unico.

## ADR-07 (rev. 1) — Coda job su PostgreSQL (Procrastinate)

**Contesto.** BullMQ esiste solo per Node.js. Il piano prevede comunque il pattern Transactional Outbox.

**Decisione.** [Procrastinate](https://procrastinate.readthedocs.io) con le tabelle nello schema `jobs` dello
stesso PostgreSQL. L'API accoda i job **nella propria transazione** tramite `cde.enqueue_job()`
(`SECURITY DEFINER`, whitelist dei task): se la transazione fa rollback il job non esiste — è l'outbox,
senza tabella né relay da scrivere. Il worker gira con il ruolo `cde_worker`, che vede solo la coda e le
colonne di esito di `cde.file_objects`.

**Conseguenze.**
- Niente Redis per le code (Redis resta opzionale per il rate limiting multi-istanza).
- Task periodici (promemoria e scadenze, Sprint 4) con `@app.periodic` di Procrastinate.
- La pipeline post-upload parte dal `complete` dell'API, non da un evento S3 → SQS: un solo percorso,
  testabile end-to-end in locale. Un upload completato "fuori banda" su S3 non esiste: l'API chiude il
  multipart.
- Gli aggiornamenti di versione di Procrastinate richiedono di applicarne le migrazioni SQL (da
  includere come migrazione yoyo).

## Sprint 2 — Scelte di dettaglio

- **Upload**: multipart presigned con `ChecksumAlgorithm=SHA256`; ogni URL di parte (15') è firmato con
  il checksum della parte, quindi S3 rifiuta contenuti diversi da quelli dichiarati. Il `complete` usa
  `ListParts` lato server (non si fida dell'elenco del client) e verifica numero parti e dimensione.
- **Integrità**: il worker ricalcola lo SHA-256 dell'oggetto intero a stream e lo confronta con quello
  dichiarato all'avvio; esito `ERROR` ⇒ download bloccato (423) e tag `cde-quarantine` sull'oggetto.
- **Antivirus**: `clamd` (sidecar ClamAV del worker) in staging/prod; scanner EICAR in dev/test.
- **Revisioni**: tabella append-only (trigger su UPDATE/DELETE/TRUNCATE, anche per il proprietario);
  lock ottimistico con `expected_revision` e vincolo `UNIQUE (document_id, sequence)`.
- **Naming**: pacchetto `packages/iso19650` (pydantic) con schema configurabile per progetto; di default
  ISO 19650-2 UK NA con originatore limitato alle organizzazioni partecipanti e, in caricamento,
  all'organizzazione dell'utente.
- **Metadati**: attributi custom JSONB validati con JSON Schema (`jsonschema`) definito per progetto.
- **Ricerca**: `tsvector` generato (identificativo con dizionario `simple`, titolo/descrizione `italian`).
- **Hash nel browser**: `hash-wasm` per lo SHA-256 incrementale di file da GB (WebCrypto non supporta
  lo streaming).
﻿
## ADR-13 — Macchina a stati del CDE (Sprint 3)

**Decisione.** Le transizioni ammesse stanno nella tabella `cde.state_transitions` (default con
`project_id NULL`, override per progetto), non nel codice: per ciascuna si configurano azione richiesta,
"solo organizzazione autrice", codici di idoneità ammessi, motivazione obbligatoria. La logica vive in
un'unica funzione `cde.transition_revision()` (`SECURITY DEFINER`), usata sia dalla transizione singola
sia da quella massiva.

| Da → A | Azione | Vincoli di default |
|---|---|---|
| WIP → SHARED | APPROVE | solo org autrice; idoneità S1–S4; file verificato (SHA-256 + antivirus) |
| SHARED → PUBLISHED | APPROVE | idoneità A1–A7, B1–B3, CR; motivazione obbligatoria |
| SHARED/PUBLISHED → ARCHIVED | ADMIN | motivazione obbligatoria; documento in sola lettura |

**Revisioni immutabili anche nel cambio di stato.** Una transizione non modifica la revisione: ne crea
una nuova, ricodificata, che punta allo stesso file (`P01.03` WIP → `P01` SHARED → `C01` PUBLISHED;
la WIP successiva riparte da `P02.01`). Lo storico è quindi intrinseco; `cde.state_change_log`
(append-only) registra chi, quando e perché. L'archiviazione è invece un attributo del documento.

**Visibilità per stato** (policy RLS su `document_revisions`, un documento è visibile se almeno una sua
revisione lo è):

| Stato | Chi vede |
|---|---|
| WIP | solo l'organizzazione autrice, anche contro scope PROJECT (Project Admin, Information Manager) |
| SHARED | chi ha READ sul container (ruolo o grant): il team di coordinamento |
| PUBLISHED / archiviato | tutti i membri del progetto |

Download: WIP/SHARED richiedono DOWNLOAD sul container; PUBLISHED richiede DOWNLOAD in qualsiasi ambito del
progetto. La pubblicazione da parte del DL di un documento del progettista avviene tramite grant
`READ + APPROVE` (il grant estende la visibilità, il ruolo DL possiede già APPROVE).

## G25 — Prestazioni dei permessi: insieme per query invece di tabella materializzata

Il piano prevedeva una tabella `effective_permissions` aggiornata da trigger. Scartata: la cardinalità è
utenti × container × azioni (milioni di righe su un grande progetto) e grant/membership con scadenza
la renderebbero obsoleta col passare del tempo senza alcun evento che la aggiorni.

Al suo posto `cde.my_containers(azione)` e `cde.my_projects()` calcolano **una volta per query** l'insieme
dei container/progetti accessibili all'utente corrente; le policy usano `container_id IN (SELECT …)`,
che PostgreSQL esegue come hashed subplan. Container e originatore sono denormalizzati (immutabili) sulle
revisioni per evitare join per riga.

Verifiche (`tests/test_db_permissions_perf.py`):
- **equivalenza esatta** con `has_permission()` per ogni utente demo e azione, anche con grant
  ereditati, non ereditati, scaduti e revocati;
- **benchmark** (`CDE_PERF=1`), 100.000 documenti, prima pagina (51 righe) con RLS attiva, PostgreSQL 16
  locale: **23–32 ms** di mediana per Project Admin, progettista e subappaltatori (obiettivo < 200 ms).

## ADR-16 — Aree riservate e richieste di accesso (migrazione 0009)

**Contesto.** Serve un'area per commessa (offerte, contratti, documenti interni) che resti chiusa anche a
chi ha ruoli con scope PROJECT, con accesso concesso caso per caso.

**Decisione.**
- `containers.is_private` sulla cartella radice; le sottocartelle lo ereditano e nessuna cartella si sposta
  dentro o fuori dall'area (altrimenti un grant su un antenato non riservato "filtrerebbe" dentro).
- In `has_permission()` e `my_containers()` il ruolo vale, sulle cartelle riservate, solo se concede ADMIN
  (Project Admin; admin dell'organizzazione proprietaria con scope OWN_ORGANIZATION). Tutti gli altri
  passano da un grant esplicito, che resta soggetto alla regola generale "il grant estende la visibilità,
  non i privilegi del ruolo". Le due funzioni restano equivalenti (test di equivalenza invariato).
- PUBLISHED/archiviato, altrove visibile a tutto il progetto, in un'area riservata richiede READ sulla
  cartella (policy `revisions_select`), e il download richiede DOWNLOAD sulla cartella.
- `access_requests`: il membro chiede (motivazione, permessi, scadenza facoltativa), gli admin dell'area
  ricevono una notifica e decidono; l'approvazione crea un grant `USER` con la scadenza scelta, revocabile
  come ogni grant. Scritture solo tramite funzioni `SECURITY DEFINER`; eventi di sicurezza su richiesta e
  decisione.
- `private_areas(progetto)` mostra a ogni membro anche le aree chiuse (nome e stato della propria richiesta):
  il nome dell'area non è considerato riservato, il contenuto sì.

## ADR-17 — Viewer e annotazioni (migrazione 0011)

**Decisione.**
- **PDF** con PDF.js su canvas, pagine rese solo quando entrano in vista; resta disponibile il
  visualizzatore del browser (ricerca nel testo, stampa). Il confronto tra due revisioni sovrappone le
  pagine pixel per pixel: rosso = solo nella revisione aperta, blu = solo in quella di confronto.
- **IFC** letto nel browser con web-ifc (WASM) e mostrato con three.js, invece della conversione in
  "fragments" lato worker prevista dal piano: niente derivati da conservare e versionare, stesso URL
  firmato del download. Da rivedere se il test di carico mostra modelli troppo grandi per il browser
  (> 300–500 MB): allora conversione nel worker.
- **DWG** non gestito: richiede Autodesk APS (licenza, invio del file a un servizio esterno). Si scarica.
- **Annotazioni** (`revision_markups`, `markup_replies`): ancorate a pagina + rettangolo in coordinate
  0..1 (indipendenti dallo zoom) oppure a un elemento del modello (GUID IFC); facoltativamente legate al
  task di revisione. La visibilità riusa la RLS delle revisioni con sottoquery nelle policy; il testo è
  immutabile, si risolve o si riapre (autore, organizzazione emittente, Project Admin).

## ADR-18 — Cruscotto, transmittal e report (migrazioni 0012–0013)

**Decisione.**
- **KPI** calcolati live da `cde.project_dashboard()` (SECURITY DEFINER, solo Project Admin) invece di viste
  materializzate: numeri sempre allineati, nessun job di refresh. Gli aggregati comprendono il WIP delle
  altre organizzazioni solo come conteggi; il drill-down passa dalle API dei documenti, soggette alla RLS.
  Se il test di carico (G56) lo richiede si passa a viste materializzate senza cambiare il contratto.
- **Transmittal**: registro append-only con numero `TRM-nnnn` per commessa; le revisioni trasmesse sono
  fotografate all'emissione (identificativo, revisione, idoneità, stato, file, SHA-256), così il protocollo
  resta fedele anche dopo nuove revisioni. Si trasmettono solo revisioni condivise o pubblicate e
  verificate. La trasmissione non concede accesso: il destinatario scarica secondo i propri permessi.
  PDF generato al volo (fpdf2, font standard Latin-1).
- **Report Excel** generati in modo sincrono nella transazione dell'utente (stessa RLS delle pagine), con
  tetto di 50.000 righe; i testi che iniziano con `=` restano testo. Il passaggio a job asincrono con link a
  scadenza è rimandato a quando i volumi lo richiederanno.

## ADR-19 — Valore legale del registro (migrazione 0014)

**Decisione.** L'ancora giornaliera dell'hash di testa viene scritta dal worker su S3 come JSON con
Object Lock (`COMPLIANCE` in produzione, `GOVERNANCE` in sviluppo, 10 anni) e, se `CDE_TSA_URL` è
configurato, marcata da una TSA RFC 3161 (in produzione una TSA qualificata eIDAS). La prova
(`audit_anchor_proofs`) è append-only. La verifica confronta le ultime 14 ancore con l'hash attuale della
catena e con la copia su S3: una riscrittura completa della catena da parte di chi ha accesso al database
non passa inosservata. Il token TSA si verifica con strumenti standard (`openssl ts -verify`).


## ADR-20 — Rinomina automatica in caricamento (migrazione 0015)

**Decisione.** Il Project Admin attiva in `document-settings.auto_number` un progressivo su un campo della
naming convention (di norma *Numero*), con primo numero, serie e valori proposti per gli altri campi. La
serie predefinita è una per ogni combinazione degli altri campi (prassi ISO 19650); in alternativa una
sola per commessa o per i campi scelti. Chi carica un file con un nome qualsiasi attiva "Rinomina secondo
naming", sceglie i campi, e l'API compone il nome: l'originatore è sempre la propria organizzazione, il
progressivo si **riserva** all'avvio del caricamento con `cde.reserve_document_number()` (SECURITY DEFINER,
lock di riga per serie). Il conteggio considera anche i documenti che chi carica non vede, quindi
l'identificativo resta univoco nella commessa senza rivelare nulla oltre al numero. L'anteprima
(`/naming/propose`) non riserva. Un caricamento annullato dopo la riserva lascia un buco: i numeri non si
riusano. Il nome di partenza resta sulla revisione (`source_filename`) e nelle sue note; il file si scarica
con il nome conforme.

**Prenotazione (migrazione 0016).** Chi ha permesso di scrittura nella commessa prenota fino a 50 identificativi
alla volta dallo stesso contatore della rinomina (`naming_reservations`, visibili solo alla propria
organizzazione). Finché non è usato o rilasciato, un identificativo prenotato non è caricabile da altre
organizzazioni (`cde.identifier_reserved_elsewhere()`, conta per gli schemi senza originatore); il primo
caricamento della propria organizzazione lo consuma. Il massimo della serie include i prenotati, quindi i numeri
non si sovrappongono neanche cambiando la configurazione della serie.
