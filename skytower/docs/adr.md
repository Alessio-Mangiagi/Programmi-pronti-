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

**Scadenza (migrazione 0017).** Con `auto_number.reservation_days` le prenotazioni non usate oltre quel numero di
giorni vengono rilasciate dal job giornaliero del worker (`cde.naming_release_expired()`, 02:40); ogni rilascio
automatico è un evento `NAMING_RESERVATIONS_EXPIRED` nel registro della commessa. Massimo 500 prenotazioni
aperte per organizzazione e commessa.

## ADR-21 — Test nel browser, accessibilità e layout come regressioni

**Decisione.** I flussi utente si verificano con Playwright contro un ambiente usa-e-getta avviato dai test
stessi (`cde dev --reset --data-dir <tmp>` su porte dedicate + build di produzione servita da `vite preview`):
nessuna dipendenza dall'istanza di sviluppo né dai suoi dati. Unica differenza dalla configurazione reale:
il limite di login per IP è alzato in quell'ambiente, perché ogni test fa il proprio accesso.
Ogni scenario del collaudo (`docs/uat.md`) ha un test; la resa grafica di PDF e IFC si controlla sui pixel
(differenze rosso/blu, canvas 3D non uniforme), il giudizio estetico resta al collaudo.
Accessibilità: axe-core con regole WCAG 2.1 A/AA su pagine e dialog principali, soglia **zero violazioni** di
qualsiasi livello; i dialog si analizzano da soli e a dissolvenza finita. Navigazione da sola tastiera
verificata su cartelle e documenti. Layout: nessuno scroll orizzontale a 1280 e 820 px in tutte le schede.
Nel tema MUI i comandi non vanno a capo e i titoli seguono una gerarchia h1→h3.

## ADR-22 — Viewer IFC e Content-Security-Policy

**Contesto.** Gli e2e servono la SPA con la CSP di produzione. Con web-ifc 0.0.57 il viewer IFC non partiva:
embind (Emscripten) creava gli invoker delle funzioni C++ con il costruttore `Function`, e la CSP non ammette
`'unsafe-eval'`. In sviluppo, senza CSP, funzionava: dietro CloudFront sarebbe stato rotto.

**Decisione.** Aggiornare web-ifc a **0.0.77**, compilato con invoker senza generazione di codice (nessun
`Function(`/`eval(` nel pacchetto): il viewer funziona con la CSP invariata, senza eccezioni né iframe.
Le alternative valutate (`'unsafe-eval'` su tutta la SPA, viewer isolato in un iframe con CSP propria,
ricompilazione propria con `-sDYNAMIC_EXECUTION=0`) non servono più. L'e2e `ifc.spec.ts` gira sotto la CSP e
verifica albero spaziale, vista 3D e selezione di un elemento; se una versione futura reintroducesse `eval`,
il test lo segnala e il viewer mostra un messaggio comprensibile invece dell'errore tecnico.

## ADR-23 — Filigrana sui PDF scaricati

**Contesto.** Un PDF condiviso o pubblicato, una volta scaricato, esce dal CDE senza traccia di chi lo ha
preso. Il piano (G19) lasciava la filigrana in backlog.

**Decisione.** Il Project Admin sceglie gli stati CDE in cui i PDF si scaricano e si visualizzano solo
filigranati (scheda Naming, `PUT /projects/{id}/watermark`). Per quei PDF `/download` non restituisce l'URL
firmato di S3 ma un URL dell'API con un ticket RS256 di 5' (utente + revisione + inline/allegato, perché il
browser apre il link senza header `Authorization`). L'API ricontrolla utente attivo, permessi, verifica
antivirus e impostazione, legge l'oggetto da S3 e timbra ogni pagina: scritta diagonale semitrasparente con
nome, organizzazione e data, piè di pagina con email, data e ora UTC, IP, identificativo, revisione e stato,
più una riga facoltativa dell'admin. La sovrapposizione si disegna con fpdf2 alla misura di ogni pagina
(rotazione e mediabox gestite) e si fonde con **pypdf**: il contenuto originale resta, il file archiviato
nello storage immutabile non cambia. Ogni apertura resta nel registro (`REVISION_VIEWED`/`DOWNLOADED`
con `watermark: true`).

**Limiti.** La filigrana si calcola in memoria: oltre `CDE_WATERMARK_MAX_BYTES` (200 MB) il download del PDF
filigranato è rifiutato con un messaggio, perché consegnare l'originale annullerebbe la scelta dell'admin.
PDF protetti da password o danneggiati: errore 422, da risolvere ricaricando il file. Dissuade e traccia,
non impedisce: chi ha il permesso di scaricare può comunque fotografare o ricopiare il contenuto.
Il ticket viaggia nella query string, quindi compare nei log di accesso di CloudFront e ALB: vale 5', solo
per quella revisione e quell'utente, e a ogni uso si ricontrollano permessi e stato dell'utente; chi legge
quei log ha comunque accesso privilegiato all'infrastruttura.

## ADR-24 — Chiavi di sicurezza e passkey (WebAuthn) come secondo fattore

**Contesto.** ADR-05 prevedeva MFA TOTP **e WebAuthn**; le colonne della credenziale erano nello schema dalla
0001 ma mancavano API e interfaccia. Un codice TOTP può essere carpito da una pagina di phishing che lo inoltra
in tempo reale; una chiave FIDO2 firma solo per l'origin vero.

**Decisione.** WebAuthn (libreria `py_webauthn`) come secondo fattore, accanto al TOTP e ai recovery code:
- registrazione dal profilo (sessione già autenticata) o durante il login se l'organizzazione impone l'MFA;
  accesso dopo la password con amr `pwd,hwk` (sessione "con MFA", anche dopo il refresh);
- ogni cerimonia usa una challenge casuale di 32 byte salvata nel DB, valida 5' e **monouso**
  (`webauthn_challenges`, solo `cde_auth`): un'asserzione intercettata non si riusa neanche con
  autenticatori che non incrementano il contatore; il contatore che torna indietro (chiave clonata) è
  rifiutato;
- RP ID = host di `CDE_WEB_BASE_URL` (il dominio CloudFront in produzione), origin ammessi = SPA, CORS e
  `CDE_WEBAUTHN_ORIGINS`; attestazione `none` (nessun vincolo sul modello di chiave), verifica utente
  "preferred" perché la password è già il primo fattore;
- i recovery code nascono con il primo fattore; aggiungere una chiave a un TOTP esistente non li cambia.

Il login senza password con le passkey residenti è venuto dopo (ADR-27).

## ADR-25 — Single sign-on OpenID Connect per organizzazione

**Contesto.** ADR-05 lasciava in backlog la federazione con l'identità aziendale (Entra ID in testa). Imprese e
studi vogliono che chi lascia l'azienda perda l'accesso al CDE quando l'IT ne disattiva l'account.

**Decisione.** OpenID Connect (non SAML), configurato da ciascuna organizzazione per i propri domini email:
- authorization code + **PKCE S256**, `state` (salvato come hash) e `nonce` casuali **monouso**, 10', legati al
  browser che ha iniziato con un cookie HttpOnly SameSite=Lax: un link di callback inoltrato da altri non apre
  una sessione (login CSRF);
  id_token verificato con la JWKS dell'IdP (firma, `iss`, `aud`, `exp`, `nonce`), discovery e chiavi in cache 1 h
  con rilettura alla rotazione; segreto del client cifrato con la KMS, mai restituito;
- l'email si prende da `email` (o da `preferred_username`/`upn` per Entra ID), mai se `email_verified` è falso,
  e deve stare nei domini dell'organizzazione; **nessun account creato dall'IdP**: l'utente dev'essere già
  invitato (al primo accesso l'invito vale come attivazione) e attivo;
- l'esito torna alla SPA nel frammento `#sso=...` (non arriva ai server né ai log); la sessione è il solito
  cookie di refresh impostato dalla callback;
- MFA: se l'IdP la impone (accesso condizionale) la sessione vale come "con MFA" (amr `fed,mfa`), altrimenti
  resta il secondo fattore del CDE; un dominio appartiene a una sola organizzazione (trigger);
- obbligo opzionale: con `enforce` la password degli utenti dell'organizzazione non vale più (il login con
  password prosegue verso l'IdP); il platform admin ne è escluso per non chiudersi fuori.

L'e2e usa un IdP finto (`e2e/mock-idp.mjs`) che fa davvero PKCE, firma RS256 e nonce.

## ADR-26 — Ricerca nel contenuto dei file

**Decisione.** Full-text di PostgreSQL (configurazione `italian`), senza un motore esterno: il worker, dopo la
verifica antivirus, estrae il testo (PDF con pypdf, Word ed Excel dall'XML OOXML con defusedxml, testo semplice)
e lo salva in `revision_text` con un tsvector indicizzato GIN; un job ogni 10' recupera i file rimasti indietro
e quelli caricati prima della funzione. Le revisioni SHARED/PUBLISHED riusano il file della WIP, quindi il
testo si copia senza riscaricare nulla.

**Sicurezza.** `revision_text` ha la stessa visibilità di `document_revisions` (RLS): cercare nel contenuto
non rivela il testo di una WIP di un'altra organizzazione né di un'area riservata. Tetti contro i file ostili:
100 MB, 500 pagine, 300.000 caratteri, 20 MB di XML decompresso, nessuna entità XML esterna.

**Limiti.** I PDF solo immagine (scansioni) non hanno testo: servirebbe l'OCR, da valutare a parte; i DWG e
gli IFC binari non si indicizzano. Se il volume crescesse oltre qualche milione di pagine si valuterà
OpenSearch, mantenendo lo stesso filtro di visibilità.

## ADR-27 — Accesso senza password con passkey

**Contesto.** ADR-24 ha portato le passkey come secondo fattore dopo la password. Le passkey moderne (iCloud,
Google, Windows Hello, YubiKey recenti) conservano l'account sul dispositivo (credenziali residenti): possono
fare da sole l'intero accesso, con meno phishing e senza password da ricordare.

**Decisione.** Pulsante "Usa una passkey (senza password)" nella pagina di accesso:
- `POST /auth/passkey/options` crea una challenge **anonima** (32 byte, 5', monouso, limite 30/min per IP) e
  chiede al browser una credenziale per l'RP senza `allowCredentials`: il browser propone le passkey salvate;
- `POST /auth/passkey/verify` trova la chiave dal suo id, controlla che lo `userHandle` dichiarato
  dall'autenticatore sia l'utente a cui è registrata, poi firma, origin, RP e contatore come in ADR-24;
- la **verifica dell'utente** (PIN o biometria sul dispositivo) è obbligatoria: possesso della chiave + PIN o
  impronta = due fattori, quindi la sessione vale come "con MFA" (amr `hwk,mfa`) e soddisfa l'obbligo MFA
  dell'organizzazione;
- utente o organizzazione non attivi → rifiuto; organizzazione con **SSO obbligatorio** → rifiuto
  (`sso_required`), perché chi è stato disattivato sull'IdP non deve rientrare dalla passkey; il blocco per
  password sbagliate non si applica (una firma non si indovina per tentativi);
- in registrazione si chiede l'estensione `credProps`: `webauthn_discoverable` dice se la chiave conserva
  l'account; diventa vero anche al primo accesso riuscito così. Il profilo lo mostra accanto alla chiave.

Nessuna nuova impostazione per organizzazione: chi ha una passkey ce l'ha già come secondo fattore, e il modo
per vietare l'accesso fuori dall'IdP resta l'SSO obbligatorio.

## ADR-28 — Dal modello BIM alle tavole: misure e documenti che citano l'elemento

**Contesto.** Nel viewer IFC chi seleziona un elemento vuole sapere quanto è grande e dove compare negli
elaborati, senza aprire a mano le tavole una per una.

**Decisione.**
- **Misure** calcolate nel browser dalla geometria già caricata: ingombro nel sistema locale dell'elemento
  (un muro ruotato non risulta più largo), l'asse più verticale è l'altezza (lo spessore per solai e coperture),
  degli altri due il maggiore è la lunghezza; volume dalla mesh chiusa (somma dei tetraedri con l'origine).
  Le quantità scritte nel file (IfcElementQuantity) restano visibili accanto, come Pset.
- **Citato in**: `GET /projects/{id}/model-element/documents` cerca nel testo indicizzato (ADR-26) il nome
  dell'elemento o il suo GlobalId come **frase esatta** ("Muro perimetrale sud P0" non trova "... P1"),
  esclusi il modello stesso e gli altri modelli (M2, M3, MR: il loro testo STEP ripete i nomi). Estratto
  evidenziato; un clic apre il documento in una nuova scheda del browser (`/documenti/:id?cerca=`), accanto al
  modello, con il nome già cercato nel PDF.
- **Tavole del piano**: il piano dell'elemento (albero spaziale IFC) dà il codice livello della naming
  convention — dal nome ("Piano terra" 00, "Piano 2" 02, "Interrato" B1, "Copertura" RF) o, se il nome non
  lo dice, dall'ordine per quota rispetto al piano più vicino a quota 0 — e si elencano le tavole (tipo DR)
  con quel livello.
- Visibilità: la RLS su documenti, revisioni e testo vale anche qui; nessuna tabella nuova.

**Limiti.** Il collegamento è testuale: funziona se le tavole riportano nome o GUID degli elementi (legende,
abachi, cartigli esportati dal software BIM). I PDF scansionati non hanno testo (vedi ADR-26). Un
collegamento esplicito elemento ↔ tavola, salvato nel CDE, si potrà aggiungere se il testo non basta.

## ADR-29 — Modelli glTF/GLB (Blender) nel viewer 3D

**Contesto.** Parte dei modelli arriva da Blender, che non salva IFC senza componenti aggiuntivi (Bonsai). Il
formato .blend è interno a Blender e leggerlo lato server richiederebbe Blender installato; glTF 2.0 è invece
l'esportazione standard di Blender, aperta e già letta da three.js.

**Decisione.**
- `.glb` (`model/gltf-binary`) e `.gltf` (`model/gltf+json`) sono visualizzabili in piattaforma come l'IFC.
- Il viewer 3D separa la scena (sezioni, misure, selezione, annotazioni, tavole collegate) dal lettore del
  formato (`ModelSource`): `ifcSource` (web-ifc) e `gltfSource` (GLTFLoader), caricati a richiesta: chi apre
  un GLB non scarica web-ifc.
- Nel glTF ogni nodo con una mesh è un elemento; le proprietà personalizzate di Blender (`extras`) sono il
  "Pset"; la chiave delle annotazioni è il nome dell'oggetto (unico in Blender; se manca o si ripete, anche
  l'indice del nodo). I nodi vuoti sono gruppi e, se il nome è quello di un piano, fanno da piano con quota e
  codice livello (ADR-28): "Citato in" e "Tavole del piano" funzionano anche per i modelli Blender.
- Le misure tengono conto della scala dell'oggetto (in Blender le dimensioni stanno spesso lì).
- CSP invariata: le texture si caricano come immagini (`img-src blob:`) e non con `fetch`; un .gltf con i
  buffer in data: URI si ricompone in .glb nel browser prima della lettura.
- Un .blend resta scaricabile; il viewer spiega come esportarlo in .glb.

**Limiti.** Non supportati: .gltf con file esterni (.bin, texture separate), compressione Draco/meshopt, texture
KTX2 — il messaggio dice come riesportare. Nessuna conversione lato server (servirebbe Blender sul worker).

## ADR-30 — Naming per cartella

**Contesto.** Una sola naming convention per commessa non basta: foto di cantiere, modelli BIM o verbali hanno
codifiche diverse da quelle delle tavole. Il Project Admin vuole decidere gli schemi nella scheda Naming e
applicarli alle cartelle che sceglie.

**Decisione.**
- Tabella `naming_profiles` (migrazione 0026): schemi con nome per commessa, ognuno con la sua rinomina
  automatica; `containers.naming_profile_id` indica lo schema di una cartella (NULL = schema della commessa).
  Nessuna ereditarietà implicita (opzionale da ADR-35): lo schema vale per le cartelle spuntate; il popup con l'albero spunta di
  norma anche le sottocartelle, e si può togliere la spunta a quelle che non lo devono usare.
- Assegnazione con `cde.set_container_naming` (SECURITY DEFINER): serve il Project Admin e la cartella deve
  essergli visibile; la policy UPDATE dei container chiederebbe l'ADMIN sulla singola cartella.
  `PUT /naming-profiles/{id}/containers` imposta esattamente l'elenco (quelle tolte tornano alla commessa,
  quelle con un altro schema passano a questo).
- Verifica del nome, proposta di rinomina, caricamento e `GET /containers/{id}/naming` usano lo schema della
  cartella di destinazione; le prenotazioni quello scelto nella scheda.
- L'identificativo resta univoco nella commessa. Un documento già presente nella cartella tiene il suo
  identificativo anche se lo schema cambia dopo: le nuove revisioni non si bloccano.
- Progressivo: per gli schemi per cartelle i campi fissi entrano nella serie (le foto "FT" e i rilievi "RL"
  numerano ciascuno da sé); lo schema della commessa resta com'era (i contatori esistenti non cambiano chiave).

**Limiti.** Le aree riservate che il Project Admin non vede non compaiono nell'albero e non si possono
assegnare. Un nuovo schema parte come copia di quello della commessa.

## ADR-31 — Derivato .glb per gli IFC pesanti (G43)

**Contesto.** Il viewer IFC (ADR-22) triangola il modello nel browser con web-ifc: oltre qualche centinaio di MB il
caricamento dura minuti e la memoria del browser non basta. Il piano (G43) prevedeva la conversione lato worker
in "fragments" di That Open Engine; il viewer però legge già il glTF (ADR-29) e il worker è in Python.

**Decisione.**
- Dopo la verifica (impronta, antivirus) il worker converte gli IFC di almeno `ifc_derivative_min_bytes`
  (100 MB in produzione, 2 MB in `cde dev`) in glTF binario con **IfcOpenShell** (`ifc2glb.py`, più thread).
  Il .glb conserva albero spaziale (tipi IFC, quota dei piani), un nodo per elemento con GlobalId, tipo e Pset,
  geometria nel sistema locale con la matrice di posizionamento (misure vere degli elementi ruotati,
  geometrie ripetute scritte una volta), colori e trasparenze degli stili. Assi e spostamento come web-ifc.
- Tabella `file_derivatives` (migrazione 0027), legata al file: le revisioni condivise e pubblicate che riusano
  il file della WIP hanno lo stesso derivato. Visibilità = quella del file (RLS). Il worker lavora solo tramite
  funzioni SECURITY DEFINER; tre tentativi (job periodico ogni 5'), poi FAILED.
- `GET /revisions/{id}/download?disposition=inline` per un IFC restituisce anche `derivative`
  (`READY` con URL firmato, `PENDING`, `FAILED`). Il viewer apre il derivato se pronto, con un interruttore
  "Versione ottimizzata / IFC originale"; annotazioni, "Citato in" e tavole del piano usano gli stessi GUID.
- L'originale resta il documento (download, impronta, registro): il derivato è solo una vista, mai scaricato
  come documento.

**Limiti.** Il derivato riflette quanto IfcOpenShell sa triangolare (aperture, spazi esclusi come nel viewer).
Per modelli enormi conviene in seguito il caricamento progressivo per piano (più file .glb). Dipendenza nuova:
`ifcopenshell` (ruote per Windows e Linux ARM64, immagine Docker invariata).

## ADR-32 — Documenti seguiti nel riepilogo giornaliero

**Contesto.** Con "Segui documento" ogni nuova revisione e ogni cambio di stato generano un avviso: chi segue
molti documenti riceverebbe decine di email al giorno, confuse tra compiti e RFI che richiedono un'azione.

**Decisione.**
- Preferenza `follow_digest` (migrazione 0028, **attiva di serie**): gli avvisi `DOCUMENT_FOLLOWED` non partono
  come email immediate ma arrivano nel riepilogo delle 7; compiti, RFI e transmittal restano immediati.
  Con il riepilogo unico (`daily_digest`) tutto arriva al mattino, come prima.
- Il riepilogo è diviso per tipo (approvazioni e compiti, RFI, transmittal, documenti seguiti, richieste di
  accesso, altro), in italiano o inglese; il pannello notifiche mostra il tipo di ogni avviso e filtra per tipo.
- La notifica in-app resta immediata per tutti: cambia solo il canale email.

## ADR-33 — OCR dei PDF scansionati

**Contesto.** La ricerca nel contenuto (ADR-26) e "Citato in" (ADR-28) leggono il testo dei PDF con pypdf: verbali
firmati e tavole scansionate sono solo immagini e restavano invisibili alla ricerca.

**Decisione.**
- Nel worker, le pagine di un PDF con meno di 20 caratteri di testo si rendono in immagine (pypdfium2, 200 dpi,
  scala di grigi) e si leggono con **Tesseract** (`ita+eng`) in un processo separato, con 60 secondi al massimo
  per pagina e fino a 30 pagine per file (`ocr_max_pages`). Le pagine con testo non passano dall'OCR.
- Tesseract è nell'immagine Docker (`tesseract-ocr`, `tesseract-ocr-ita`) e nella CI; in sviluppo si cerca nel
  PATH o in `C:\Program Files\Tesseract-OCR`. Senza eseguibile l'OCR si salta e il resto funziona.
- "Citato in" cerca anche il nome con lo zero dei codici letto come la lettera O ("P0" → "PO"), l'errore più
  comune dell'OCR sulle legende.
- Il testo letto finisce nello stesso indice (RLS invariata).

**Limiti.** Vale per i nuovi caricamenti (e per i file ancora senza testo ripresi dal job periodico); i PDF già
indicizzati con testo vuoto non si rileggono da soli (superato da ADR-34). Scritture a mano e scansioni molto storte
restano poco leggibili.

## ADR-34 — Ri-OCR dei PDF indicizzati prima dell'OCR

**Contesto.** I PDF caricati prima di ADR-33, o letti dal worker quando Tesseract non c'era, hanno nell'indice solo
il testo di pypdf: le pagine scansionate restano invisibili alla ricerca.

**Decisione.**
- `revision_text.ocr_at` (migrazione 0029) segna il testo estratto con l'OCR attivo; vuoto = letto senza.
- Il job periodico `cde.index_text` (ogni 10') dopo i file senza testo rilegge fino a 10 PDF con `ocr_at` vuoto,
  i più vecchi prima (`cde.text_ocr_pending`). Solo le pagine senza testo passano da Tesseract, quindi un PDF
  vettoriale costa una lettura con pypdf.
- Senza Tesseract il ri-OCR non parte e `ocr_at` resta vuoto: installato Tesseract, i PDF si riprendono da soli.
- Un file illeggibile (S3 non raggiungibile) torna in fondo alla coda (`cde.text_ocr_later`) senza bloccare gli altri.
- Le revisioni che condividono il file copiano anche `ocr_at`.

**Conseguenze.** Nessun comando da lanciare dopo l'aggiornamento: un archivio di N PDF si rilegge in circa N/60 ore.

## ADR-35 — Ereditarietà opzionale dello schema di naming

**Contesto.** Con ADR-30 una sottocartella creata dopo l'applicazione di uno schema usa quello della commessa:
il Project Admin deve ricordarsi di riaprire il popup. Per cartelle come "Foto di cantiere", divise per mese,
le sottocartelle nuove sono la norma.

**Decisione.**
- `naming_profiles.inherit` (migrazione 0030, predefinito **no**): spunta "Vale anche per le sottocartelle create
  dopo in queste cartelle" nella scheda Naming, solo Project Admin.
- Il trigger `containers_inherit_naming` (BEFORE INSERT, SECURITY DEFINER) assegna alla cartella nuova lo schema
  del padre se questo ha la spunta: chi crea la cartella non deve essere Project Admin. A catena: la sottocartella
  ha lo schema, quindi lo passa alle sue.
- Solo alla creazione: spostare una cartella o togliere la spunta non cambia le cartelle esistenti (si gestiscono
  dal popup, come prima). Un PUT dello schema senza `inherit` lo lascia com'è.

## ADR-36 — Derivato IFC diviso per piano, caricato progressivamente

**Contesto.** Con ADR-31 il derivato è un solo .glb: su un modello enorme il browser scarica e legge tutto prima
di mostrare qualcosa, e la memoria del parse cresce col modello intero.

**Decisione.**
- `ifc2glb.convert(..., parts_dir=...)` scrive un **indice** (albero spaziale, nomi, GUID, Pset; nessuna mesh) e
  un .glb per piano con i soli nodi "part", che in `extras.owner` indicano l'elemento dell'indice. Gli elementi
  fuori dai piani vanno in un pezzo finale. L'elenco, in ordine di quota, è in `scenes[0].extras.parts`.
- `file_derivatives.parts` (migrazione 0031) conserva chiavi e versioni S3 dei piani; l'API restituisce `parts`
  con un URL firmato per piano (15', perché si scaricano in sequenza).
- Il viewer legge l'indice, poi aggiunge i piani dal più basso, scaricando il successivo mentre legge il corrente.
  Dopo il primo piano la camera inquadra il modello e l'utente può già orbitare; una barra in basso dice quanti
  piani sono arrivati. Albero, selezione e sezioni si attivano a caricamento finito, con lo stesso comportamento
  di prima (GUID, Pset, misure, tavole collegate).
- I derivati fatti prima (un solo file, `parts` NULL) si aprono come prima.

**Limiti.** Un piano molto pesante resta un blocco unico; non c'è ancora lo scaricamento dei piani nascosti
(tutti i piani si caricano comunque).

## ADR-37 — Modifica di Word, Excel e PowerPoint con OnlyOffice Docs

**Contesto.** Fino a qui Word ed Excel si vedevano in anteprima (sola lettura): per correggere una relazione
bisognava scaricarla, modificarla e ricaricarla. Scelta dell'utente: **OnlyOffice Docs** (fedeltà OOXML, co-editing),
non Collabora.

**Decisione.**
- Document Server separato (container ufficiale, edizione Community fino a 20 connessioni contemporanee, oltre
  serve la licenza), con JWT attivo e segreto condiviso con l'API (`CDE_ONLYOFFICE_URL`,
  `CDE_ONLYOFFICE_JWT_SECRET`; senza la funzione è spenta e il pulsante non compare).
- Si modifica **solo l'ultima revisione, in WIP**, con il permesso WRITE sulla cartella e il documento non in
  revisione: `POST /revisions/{id}/office-session` restituisce la configurazione dell'editor firmata (HS256).
  Chiave del documento = id della revisione: chi apre la stessa revisione modifica insieme agli altri.
- Il Document Server legge il file da `GET /office/files/{id}?ticket=` (ticket RS256 di 5' per utente e
  revisione, permessi ricontrollati), non da un URL S3: funziona anche se il Document Server non vede S3.
- `POST /office/callback/{id}`: valida solo con il JWT del segreto condiviso (nel corpo o nell'intestazione) e con
  la chiave giusta. A modifiche finite (stato 2 o 6) l'API scarica il file **solo dall'origine del Document Server
  configurato** (niente SSRF), con un tetto di 100 MB, e crea la WIP successiva (P01.02 → P01.03) con i permessi
  (RLS) dell'ultimo utente che ha modificato, nota "Modificata in piattaforma (OnlyOffice)", verifica antivirus
  come un caricamento. Callback ripetuta con lo stesso file: nessuna revisione doppia.
- Frontend: "Modifica con OnlyOffice" nel visualizzatore apre `/documenti/:id/modifica` in una nuova scheda, che
  carica lo script del Document Server (CSP: `script-src` e `frame-src` con il suo indirizzo, variabile Terraform
  `onlyoffice_url`).

**Limiti.** In questa macchina di sviluppo non c'è Docker: l'integrazione è provata con un Document Server finto
(test API e e2e); la prova con quello vero va fatta su staging o installando Docker. PowerPoint si modifica ma
non ha anteprima nel visualizzatore (il pulsante compare per Word ed Excel).

## ADR-38 — Progetti esistenti come template per i nuovi

**Contesto.** Ogni commessa nuova ripeteva a mano la stessa impostazione: albero delle cartelle, naming, schemi
per cartelle, filigrana, ruoli, workflow. Richiesta dell'utente: usare i progetti esistenti come template.

**Decisione.**
- Nel dialog "Nuovo progetto" si sceglie "Parti da": un progetto di cui si è **Project Admin** (`GET
  /projects/templates`, con il numero di cartelle, schemi e workflow). Serve comunque essere admin della propria
  organizzazione, come per un progetto vuoto.
- `cde.create_project_from_template` (migrazione 0032, SECURITY DEFINER, una sola transazione) copia: impostazioni,
  naming (il campo fisso `project` prende il codice nuovo, anche negli schemi per cartelle), metadati, rinomina
  automatica, filigrana, schemi per cartelle con ereditarietà e assegnazioni, albero delle cartelle con aree
  riservate, ruoli personalizzati con i permessi, ultima versione di ogni workflow attivo (che riparte da 1).
- A scelta: **organizzazioni partecipanti** con le loro cartelle (senza, solo i rami della propria organizzazione)
  e, solo insieme a queste, **persone con i ruoli** (utenti attivi, membership non scadute).
- Mai copiati: documenti e revisioni, contatori e prenotazioni del naming, grant espliciti, RFI, transmittal,
  registro. Gli assegnatari "utente" dei workflow restano: se quella persona non è nel progetto nuovo, il
  workflow va rivisto.

## ADR-39 — Import dei workflow da un altro progetto

**Contesto.** I workflow si sviluppano e si collaudano in un progetto (anche uno di prova) e poi servono in altri
già avviati, dove il template di progetto (ADR-38) non si può più usare.

**Decisione.**
- Scheda Workflow → "Importa da un altro progetto": `GET /projects/{id}/workflow-templates/importable` elenca i
  workflow attivi dei progetti di cui si è **Project Admin**; `POST .../workflow-templates/import` serve il Project
  Admin sia di partenza sia di destinazione.
- Il workflow si **adatta** al progetto di destinazione e l'API restituisce l'elenco delle modifiche:
  - persone non membri (assegnatari ed escalation) e ruoli limitati a organizzazioni che non partecipano si
    tolgono: un compito darebbe accesso al documento a chi non è nel progetto;
  - i ruoli personalizzati mancanti si creano uguali a quelli di partenza, con gli stessi permessi (si possono
    disattivare con `copy_roles: false`, e allora si segnalano);
  - uno step che resterebbe senza assegnatari blocca l'import (422) con il motivo.
- Stesso codice di un workflow già presente ⇒ nuova versione, come un salvataggio dal designer; si può dare un
  codice diverso per tenerli separati. Registro: `WORKFLOW_TEMPLATE_IMPORTED` con il workflow di partenza.
