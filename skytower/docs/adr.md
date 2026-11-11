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
- Vedi ADR-52: i **modelli di commessa** dell'organizzazione (struttura separata dalla commessa, con
  persone e documenti di modello, scaricabile in un file) sono la via consigliata per le commesse nuove.

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

## ADR-40 — Derivati IFC in un solo file divisi per piano

**Contesto.** I derivati .glb fatti prima della divisione per piano (ADR-36, migrazione 0031) sono rimasti in un
solo file: il viewer li apre, ma senza il caricamento un piano alla volta.

**Decisione.**
- Il job periodico dei derivati (ogni 5') rifà, **uno per giro**, i derivati `READY` con `parts` nullo
  (`cde.derivatives_split_claim`, migrazione 0033, solo per `cde_worker`).
- Durante la conversione e in caso di errore resta valido il derivato intero: lo stato non passa da `PENDING`
  e `derivative_done` si chiama solo a conversione riuscita. I tentativi sono contati insieme a quelli della prima
  conversione: a tre il file resta com'è.

## ADR-41 — Viewer DWG senza licenza: DWG → DXF → SVG nel worker

**Contesto.** Il piano (G44) prevedeva Autodesk APS (Model Derivative + APS Viewer, a consumo) per vedere i DWG
nel browser; la licenza non è mai arrivata e i DWG restavano solo scaricabili. Il 03/11/2026 l'utente ha scelto
la strada senza licenza.

**Decisione.**
- Stesso meccanismo dei derivati .glb degli IFC (ADR-31): tabella `cde.file_derivatives` con il nuovo `kind`
  `SVG` (migrazione 0035, funzioni `derivative_request_svg`, `derivatives_claim_svg`, `derivative_done_svg`
  solo per `cde_worker`), richiesto subito dopo la verifica antivirus di ogni `.dwg`/`.dxf` e ripreso dal job
  periodico dei derivati. Nessuna soglia di dimensione: un DWG non si apre comunque nel browser.
- **DWG → DXF** con ODA File Converter (gratuito, dell'Open Design Alliance; non ridistribuibile: si installa
  sul server, `CDE_DWG_CONVERTER_CMD` o PATH o `C:\Program Files\ODA\...`). Senza, il derivato dei DWG fallisce
  con il motivo scritto in `detail` e mostrato nel viewer; un **DXF** salta il passo e si vede sempre.
- **DXF → SVG** con `ezdxf` (MIT), senza matplotlib: un `<g data-layer>` per layer (nascosto se spento, congelato
  o `Defpoints`), blocchi/quote/leader scomposti (ciò che nel blocco sta sul layer `0` prende il layer
  dell'INSERT, come in AutoCAD), testi come `<text>`, hatch con riempimento leggero, Y invertito, tratti
  `non-scaling-stroke`, `viewBox` e `data-units` ($INSUNITS) nelle unità del disegno. L'elenco dei layer (nome,
  colore, visibile, entità) finisce in `parts` e l'API lo dà al viewer con l'URL firmato dell'SVG.
- Viewer (`DxfView`): l'SVG passa da DOMParser e si tengono solo gli elementi grafici (niente script, `on*`,
  riferimenti esterni), pan e zoom, spunte dei layer, misura di una distanza con due clic nelle unità del
  disegno, annotazioni della revisione in coordinate 0..1 sul riquadro del disegno (come per le immagini).
- Limite: disegni oltre 400.000 entità non si convertono (l'SVG sarebbe ingestibile); i lineweight e i tipi di
  linea non si riproducono; i font sono sostituiti da Arial.

**Alternative scartate.** APS (costo per vista, dipendenza dal cloud Autodesk); LibreDWG (GPL, parser DWG
meno affidabile sui file recenti); conversione nel browser (nessuna libreria DWG affidabile in JavaScript).

## ADR-43 — Rilascio sul server aziendale con Docker Compose, senza AWS

**Contesto.** L'infrastruttura Terraform (ADR precedenti) presuppone un account AWS che non c'è ancora;
intanto i colleghi devono usare SkyTower dal server della suite come le altre app, con gli stessi
vincoli di immutabilità dei documenti e del registro.

**Decisione.**
- `infra/docker/docker-compose.yml`: PostgreSQL 16, **MinIO con Object Lock** (bucket creato con il lock da
  `minio-init`, retention di default GOVERNANCE, ancore del registro in COMPLIANCE), ClamAV per il worker,
  API e worker dalla stessa immagine di produzione, Caddy con la SPA compilata (`Dockerfile.web`) e la
  CSP di produzione, `pg_dump` giornaliero. Porte del registro del portale: 5195 web, 8100 API, 9100 S3.
- `CDE_ENV=staging` e non `prod`: il codice in `prod` esige AWS KMS e vieta le chiavi su file. Le chiavi
  (master Fernet, JWT RSA) vivono nel volume `segreti`, 0700, intestato all'utente non privilegiato del
  container; `backup.*` le salva insieme a DB e documenti. Portare un provider KMS "file" ammesso in
  `prod` resta un passo successivo se il server diventa l'ambiente definitivo.
- Gli URL firmati di S3 portano l'host dell'endpoint: l'API usa lo stesso indirizzo pubblico che il
  browser raggiunge (`S3_ENDPOINT_PUBBLICO`, risolto dentro i container verso il server con
  `extra_hosts`). Con il Caddy della suite l'S3 diventa `s3-skytower.<dominio>` e l'API si fida della
  CA interna (`AWS_CA_BUNDLE`); senza dominio si resta in HTTP nella LAN con cookie non `Secure`.
- `shared/` della suite è montato in sola lettura in `/shared` (il codice lo importa da lì: `suite_link`,
  `cosedil_sso`); il token di servizio arriva da `SUITE_TOKEN`, copiato da `shared/suite/.token`.
- Password del primo admin e dell'account personale chieste a video dagli script e passate al container
  solo come variabili d'ambiente del comando (`prepara_db.py`), mai su file.

**Conseguenze.** Un solo nodo: niente alta disponibilità né PITR (RPO 24 h col dump, RTO ~1 h con
`ripristina.*`); email solo nel log finché non c'è un invio SMTP; il portale vede la 5195 accesa e non
avvia la copia di sviluppo. Il percorso AWS (ADR precedenti, runbook §1–§4) resta quello per il rilascio
pubblico. Scenario UAT U48.

## ADR-44 — Escalation dei compiti scaduti ai responsabili, ripetuta

**Contesto.** Un compito di revisione scaduto (G35) produceva un solo avviso all'incaricato e una sola
escalation a chi era indicato nel template o, in mancanza, a chi aveva avviato il workflow: spesso la stessa
persona che aspettava l'approvazione. Dopo quel giorno nessuno veniva più avvisato, anche per settimane.

**Decisione.**
- `cde.process_deadlines(p_now, p_repeat_hours)` (migrazione 0036) manda l'escalation alla persona indicata nel
  template (`escalation_user_id`) se c'è; altrimenti a **tutti i Project Admin** del progetto e a chi ha avviato
  il workflow, mai all'incaricato (a lui arriva `TASK_OVERDUE`, una volta sola).
- Finché il compito resta aperto l'escalation si **ripete** ogni `p_repeat_hours` (default 72; nel worker
  `CDE_DEADLINE_ESCALATION_REPEAT_HOURS`, 0 = una sola volta). Il testo dice chi è in ritardo, su che step e
  documento, da quanti giorni e il numero del sollecito; `data` porta `days_late`, `escalation`, `assignee_id`.
- `tasks.escalated_at` e `tasks.escalation_count` dicono alla UI quando e quante volte si è sollecitato:
  inbox compiti ("Responsabili avvisati il …, sollecito n."), colonna *Sollecito* nel cruscotto KPI, e nel
  "da fare" del portale le notifiche `TASK_OVERDUE`/`TASK_ESCALATED`/`RFI_OVERDUE` sono compiti di priorità 1.
- Le notifiche passano da `cde.notify`, quindi email secondo le preferenze dell'utente, come tutte le altre.

**Conseguenze.** I responsabili vedono i ritardi senza aprire il cruscotto; un compito dimenticato torna a galla
ogni tre giorni. Le RFI restano come prima (promemoria −24 h, scadenza superata una volta). Test con "time
travel": `test_escalation_ai_project_admin_e_ripetuta`, `test_escalation_user_id_del_template_esclude_gli_admin`.

**Alternative scartate.** Escalation al solo avviatore (è spesso l'autore del documento); ripetizione
giornaliera (troppo rumore: 72 h è il ritmo delle revisioni); un job separato per i solleciti (basta il
job `deadlines` ogni 15').

## ADR-45 — Verifica della firma degli export del registro attività

**Contesto.** CSV e PDF del registro (G49) escono firmati RS256 (`X-CDE-Signature`, `X-CDE-SHA256`), ma chi
riceveva il file non aveva un modo semplice per controllare che fosse autentico e non alterato: serviva
decodificare il JWT a mano con la chiave di `/.well-known/jwks.json`.

**Decisione.**
- `POST /projects/{id}/audit/export/verify {signature, sha256?}` (permesso ADMIN sulla commessa, come l'export)
  verifica la firma con la chiave del server (`TokenService.decode_export`: RS256, `typ` export, `iss`),
  che l'export sia di **quella** commessa (`sub`) e, se si manda lo SHA-256 del file in mano, che il file sia
  quello firmato. Risposta sempre 200 con `valid` e `reason` (`firma_non_valida`, `altra_commessa`,
  `file_diverso`), i claim (eventi, catena integra o no al momento dell'export) e la data di emissione.
- Nella scheda *Registro attività* dopo un export compaiono firma e impronta ("Copia nella verifica") e una
  sezione *Verifica una firma* dove incollarle; il PDF spiega nel riquadro iniziale dove stanno firma e
  impronta e come controllarle. La firma resta nell'header (non dentro il file): un dato dentro il file non
  può firmare il file che lo contiene.

**Conseguenze.** Un export passato di mano in mano si può ricontrollare in piattaforma o fuori (JWKS pubblica).
Test: `test_verifica_firma_export`.

## ADR-46 — Email via SMTP aziendale e chiavi su file ammesse in produzione

**Contesto.** Il rilascio sul server aziendale (ADR-43) girava con `CDE_ENV=staging` perché in `prod` il codice
pretendeva AWS KMS, e con `CDE_MAILER=console`: inviti, reset password, avvisi di sicurezza e notifiche dei
workflow finivano solo nel log. Per usare SkyTower davvero dal server servivano email vere e le guardie di
produzione (documentazione API spenta, antivirus obbligatorio) senza un account AWS.

**Decisione.**
- `SmtpMailer` (`cde_api/mail.py`): `CDE_MAILER=smtp` con `CDE_SMTP_HOST`, `CDE_SMTP_PORT` (587),
  `CDE_SMTP_SECURITY` (`starttls` di default, `ssl` per la 465, `none` solo verso un relay in LAN),
  `CDE_SMTP_USER`/`CDE_SMTP_PASSWORD` facoltativi (relay che autenticano per IP). Certificato del server
  verificato con il contesto TLS di sistema. Una connessione per messaggio: i volumi sono di poche decine di
  email al giorno. Un invio fallito è registrato nel log (senza il corpo, che può contenere link di reset) e
  **non fa fallire l'operazione** che lo ha causato: l'invito o il reset restano validi e si possono rimandare.
  Un valore sconosciuto di `CDE_MAILER` è un errore all'avvio, non un ripiego silenzioso su console.
- `FileKms` (`cde_api/security/kms.py`): `CDE_KMS_PROVIDER=file`, ammesso anche in `prod`. Stesso formato
  di `LocalKms` (master Fernet + chiave RSA del JWT su file), ma la cartella deve **esistere già** (un percorso
  sbagliato non deve creare chiavi nuove in silenzio, che renderebbero illeggibili i segreti cifrati prima) e,
  dove i permessi POSIX esistono, non essere leggibile da gruppo e altri; i file nascono con 0600.
  `local` resta vietato in `prod`. Il rilascio Docker passa a `CDE_ENV=prod` + `file`; `prepara_db.py`
  intesta il volume `segreti` all'utente 10001 con permessi 700.

**Alternative scartate.** SES anche sul server (richiede AWS); un mailer che rilancia l'errore (un server di
posta giù bloccherebbe inviti e approvazioni); chiavi in variabili d'ambiente (finirebbero in `docker inspect`
e nei log di compose).

**Conseguenze.** `backup.*` salva il volume delle chiavi insieme al database: senza quelle chiavi i segreti
MFA non si decifrano e i token non si firmano. Test: `tests/test_mail_kms.py` (SMTP finto: STARTTLS, SSL,
relay senza credenziali, errore che non blocca e non logga il corpo; FileKms in prod, cartella mancante o
aperta rifiutata, chiavi rilette al secondo avvio).

## ADR-47 — Login dal portale e token di servizio ristretti all'organizzazione della suite

**Contesto.** La revisione di sicurezza del 03/11/2026 ha trovato tre falle alte nel collegamento con la suite.
`POST /auth/portale` cercava l'utente per email e, in subordine, per la parte prima della `@` **su tutte le
organizzazioni**, e apriva una sessione completa saltando MFA, SSO obbligatorio e blocco dell'account: chi
amministra il portale poteva entrare come qualunque utente, anche come platform admin o in un altro tenant.
Il token di servizio della suite (uno solo, condiviso da tutte le app) permetteva di dichiarare qualunque
utente con `X-Suite-Email`/`X-Suite-Utente` e ripiegava sul primo platform admin. Il login dal portale iscriveva
l'utente a **tutti** i progetti con un codice commessa, di qualunque proprietario, e da PROJECT_ADMIN se era
admin del portale; il codice commessa era un campo libero.

**Decisione.** Il portale rappresenta una sola organizzazione, quella della suite (`CDE_SUITE_ORG_ID`, altrimenti
quella dell'utente tecnico, altrimenti quella del primo platform admin).
- `POST /auth/portale`: utente solo per **email esatta** e solo in quell'organizzazione (la parte prima della `@`
  serve solo a comporre l'email di un utente nuovo); 403 per altre organizzazioni, platform admin, SSO
  obbligatorio, account bloccati o disattivati; con un fattore MFA o `mfa_required` la risposta è
  `mfa_required`/`mfa_enrollment_required` come il login con password; nessun azzeramento di `locked_until`;
  al portale va solo `sid=<valore>` (non il refresh token di SkyTower); 30 richieste/minuto per IP e cache di
  30 s dell'esito per `sid`.
- Iscrizione automatica solo ai progetti **di proprietà** dell'organizzazione della suite, sempre col ruolo
  `CDE_SUITE_RUOLO_PORTALE` (default DESIGNER, PROJECT_ADMIN rifiutato).
- `settings.commessa` deve stare nel registro della suite quando c'è (422 `commessa_sconosciuta`) ed è univoco
  fra i progetti attivi della stessa organizzazione (trigger della migrazione 0038, 409); a parità di codice la
  suite usa il progetto dell'organizzazione della suite.
- Rotte `/suite/*`: l'utente dichiarato vale solo se attivo, dell'organizzazione della suite e non platform
  admin; poi l'utente tecnico con le stesse regole; altrimenti 403. Ogni chiamata lascia un evento
  `SUITE_CALL` con l'app dichiarata (`X-Suite-App`), l'utente dichiarato e la rotta.

**Alternative scartate.** Asserzione firmata dal portale (HMAC per app) al posto del JSON di `/api/verify`: più
solida, ma cambia portale e tutte le app; resta il passo successivo insieme a **un token di servizio per app**
(`SUITE_TOKEN_<APP>`), così un'app compromessa non agisce a nome delle altre. Indice univoco sul codice commessa:
fallirebbe su installazioni con doppioni già presenti; il trigger blocca solo i nuovi.

**Conseguenze.** L'account personale del platform admin non entra più dal portale: entra con password e secondo
fattore. Gli utenti di altre organizzazioni (consulenti, imprese) entrano solo con le loro credenziali. Un
progetto di un altro committente in cui l'azienda partecipa non riceve più membri dal portale: li invita il suo
Project Admin. Test: `test_api_portale.py`, `test_api_suite.py` (impersonazione ristretta, eventi), `test_security_fix.py`.

## ADR-48 — Workflow a grafo su foglio a scacchiera, per documenti e processi

**Contesto.** I workflow erano una lista di passi in fila (fino a 20), sempre su una revisione di documento, con
tre esiti fissi; un rifiuto tornava all'autore. L'utente usa per gli acquisti uno schema diverso (RdA → gara →
affidamento): un passo si apre su più rami paralleli (un ramo per buyer), ogni esito porta a un nodo diverso,
i rami si riuniscono, un "Respinto" passa da una conformità e finisce in "Fallito", c'è una notifica automatica.
Il 03/11/2026 ha scelto: grafo vero, documenti e processi, esiti liberi per nodo, nodi su una griglia a scacchiera.

**Decisione.** Definizione versione 2 (`docs/workflow-grafo.md`): nodi `start`, `decision`, `activity`,
`notification`, `end` in caselle della griglia; esiti con codice, etichetta e colore (un esito **rosso decide
subito**, gli altri al quorum; senza quorum vince il più votato); archi per esito, più archi con lo stesso esito
sono rami paralleli, gli archi all'indietro sono ritorni (massimo 20 giri per nodo, poi l'istanza si interrompe
col motivo). Riunione dei rami: `ANY` al primo arrivo; `ALL` (predefinito, tranne per gli stati finali che sono
`ANY`) quando nessun nodo attivo — né un'altra riunione in attesa — può ancora raggiungerla: aspetta i rami in
corso ma non un ramo mai partito. Il primo stato finale raggiunto chiude l'istanza e annulla i compiti aperti;
per i documenti `on_completed` applica il passaggio di stato CDE (OK), il KO sblocca il documento. Un modello
`PROCESS` si avvia senza documento (`POST /projects/{id}/processes`) con titolo, descrizione e documenti allegati
(visibili solo a chi può vederli); i processi li vede ogni membro del progetto.

Il motore resta nel database (migrazione 0039, funzioni `wf_*` SECURITY DEFINER con lock dell'istanza): ogni
completamento, con i rami che fa partire e le riunioni che sblocca, è una sola transazione. I giri dei nodi
(`workflow_node_runs`) sostituiscono i passi; gli archi percorsi (`workflow_edges_taken`) servono alla vista finale
e, non ancora consumati, sono gli arrivi che una riunione `ALL` sta aspettando. La versione 1 è convertita dalla
migrazione (modelli e istanze in corso, stessi id) e l'API la accetta ancora in ingresso; `/workflows/{id}`
mantiene la forma a passi per le pagine esistenti, `/workflow-instances/{id}` dà il grafo completo.

**Alternative scartate.** Motore BPMN esterno (Camunda/Flowable): un servizio in più da gestire e i permessi
(RLS) andrebbero rifatti fuori dal database. Disegnare la lista di passi come grafo senza cambiare il motore:
non avrebbe permesso i rami per esito né i ritorni dello schema RdA. Join ALL "su tutti gli archi in entrata"
(gateway parallelo BPMN): resterebbe bloccato quando un ramo non parte, come i buyer non coinvolti.

**Conseguenze.** Il modello RdA → gara → affidamento dell'utente si carica con `cde workflow-rda --progetto
<codice>` (27 nodi, `cde_api/tooling/workflow_rda.py`). Le notifiche nuove sono `WORKFLOW_NOTIFICATION` e
`WORKFLOW_CANCELLED`. Le schermate (editor a scacchiera, vista finale, scheda Processi) seguono il contratto.
Test: `tests/test_workflow_grafo.py`; scenari U50 e U51.

## ADR-49 — Falle "basse" della revisione di sicurezza del 03/11/2026

**Contesto.** La revisione del 03/11/2026 (ADR-47 per le falle alte e medie) aveva rimandato sette punti bassi:
enumerazione di organizzazioni ed email (B3), verifica completa del registro a ogni richiesta (B4), JSON liberi
senza tetto (B5), ticket dei link riutilizzabili (B6), refresh token in chiaro con l'installazione in HTTP (B8),
domini del single sign-on presi da chiunque (B9), stream SSE illimitati (B11).

**Decisione.**
- **B3** `GET /organizations/lookup/{code}` risponde solo a platform admin, admin di organizzazione e Project
  Admin di almeno una commessa (filtro in `cde.lookup_organization`, migrazione 0040; gli altri hanno 404) e con
  un tetto per utente (`CDE_ORG_LOOKUP_RATE_LIMIT`, 30/ora). `POST /organizations/{id}/users` risponde sempre
  **202** `{"status": "INVITATION_SENT", "email", "message"}`: un'email già di un altro tenant non crea nulla, non
  manda email e lascia `USER_INVITE_CONFLICT` nel registro (escluso dal registro di sicurezza dell'organizzazione
  che invita). 409 solo per un'email già nella stessa organizzazione. Tetto `CDE_INVITE_RATE_LIMIT` (60/ora).
- **B4** La verifica completa della hash chain la fa il worker ogni ora (job `audit-verify`,
  `cde.audit_verify_full`) e ne salva l'esito in `cde.audit_chain_status`; `GET /audit/verify` e gli export
  leggono l'esito con `cde.audit_verify_latest()`, che ricontrolla la testa già verificata e solo gli eventi
  sigillati dopo. Esito più vecchio di `CDE_AUDIT_VERIFY_MAX_AGE_MINUTES` (120) → la richiesta rifà la verifica
  completa, una sola alla volta (advisory lock). L'API non può più eseguire `cde.audit_verify()`. Tetto per utente
  `CDE_AUDIT_VERIFY_RATE_LIMIT` (10/minuto) su verifica ed export. Risposta e firma degli export riportano
  `verified_at` / `chain_verified_at`.
- **B5** `attributes` (caricamento e modifica dei documenti, caricamento dalla suite), `settings` dei progetti e
  `metadata_schema`: al massimo 64 KB di JSON compatto (`cde_api/validation.py`), oltre 422.
- **B6** Ticket SSE monouso (il frontend ne chiede già uno a ogni connessione). Ticket di download filigranato:
  come allegato monouso; nel visualizzatore fino a 10 usi nei 5', tutti dallo stesso IP del primo (il frontend
  tiene il link in cache 4' e React StrictMode lo apre due volte); un uso da un altro IP lo invalida per tutti.
  L'uso si conta dopo i controlli dei permessi. Contatori nello storage del rate limit (memoria o Redis).
- **B8** Con `CDE_COOKIE_SECURE=false` fuori da dev/test il refresh dura `CDE_INSECURE_REFRESH_TOKEN_TTL_S`
  (12 ore) invece di 14 giorni e all'avvio l'API scrive un avviso. HTTP in LAN resta una scelta temporanea: la
  strada è `SUITE_DOMINIO` + Caddy con TLS (`installa.*` lo ricorda).
- **B9** Un dominio nuovo del single sign-on si registra solo se l'organizzazione ha un utente ATTIVO con email
  in quel dominio (`cde.org_has_email_domain`); quelli già registrati restano. Niente verifica DNS.
- **B11** Al massimo `CDE_SSE_MAX_STREAMS_PER_USER` (5) stream SSE insieme per utente, contatore in memoria del
  processo rilasciato alla chiusura dello stream; oltre → 429.

**Alternative scartate.** Ticket di download monouso anche nel visualizzatore: romperebbe la riapertura di un
documento dalla cache del frontend. Verifica DNS (record TXT) per i domini SSO: più robusta ma richiede all'impresa
di toccare il DNS; rimandata. Verifica incrementale pura senza giro completo: non scoprirebbe la manomissione di un
evento vecchio.

**Conseguenze.** Una manomissione di un evento vecchio del registro emerge al giro orario successivo del worker
(o subito, se tocca la testa già verificata). Con l'API su più processi (oggi uno) il tetto degli stream vale per
processo. Chi invita non vede più i dati dell'utente nella risposta (la SPA non li usava). Test:
`tests/test_security_bassi.py`; scenario U53.

## ADR-50 — Libreria dei workflow dell'organizzazione, con collegamento vivo alle commesse

**Contesto.** Fino al 04/11/2026 un modello di workflow viveva solo dentro una commessa; per riusarlo si importava
(ADR-39) o si partiva da una commessa modello (ADR-43), ottenendo copie che poi divergono. L'utente chiede che "i
workflow si creino ad alto livello e si possano usare come template su tutte le commesse caricate".

**Decisione.** Scelte dell'utente:
- **libreria per organizzazione**: `workflow_templates` ha `project_id` *oppure* `organization_id` (vincolo
  `workflow_templates_scope`, migrazione 0041); un modello di libreria è visibile in tutte le commesse di cui
  l'organizzazione è proprietaria (`projects.owner_organization_id`) e a chi è dell'organizzazione; le altre
  organizzazioni non lo vedono (RLS con `cde.my_library_orgs()`);
- **collegamento vivo**: `GET /projects/{id}/workflow-templates` restituisce anche i modelli attivi della libreria
  (`scope: "LIBRARY"`, `organization_name`); la commessa li avvia direttamente, da Processi e da "Avvia approvazione".
  Una nuova versione in libreria vale per gli avvii successivi; le istanze in corso restano sul `template_id` con cui
  sono partite. Una variante locale si fa con "Copia nella commessa" (`POST …/workflow-templates/from-library`,
  stessa logica di adattamento dell'import), che ricorda la provenienza in `source_template_id`;
- **solo l'amministratore dell'organizzazione** (`cde.can_manage_org`: org admin o platform admin) crea, versiona,
  disattiva e pubblica in libreria (`/organizations/{id}/workflow-library`, `…/from-project`,
  `PATCH /workflow-library/{id}`); Project Admin e chi avvia i workflow li vedono e li usano;
- **solo ruoli**: in libreria assegnatari e destinatari sono `role` / `originator_role`, senza persone, senza ruoli
  limitati a un'organizzazione e senza `escalation_user_id` (le persone cambiano da commessa a commessa); lo
  controllano l'API (errori per nodo) e un CHECK nel database. All'avvio in una commessa ogni decisione e attività
  deve avere qualcuno con quel ruolo: altrimenti 422 `roles_missing` con l'elenco dei nodi (lo ripetono
  `cde.workflow_start` e `cde.workflow_start_process` con `cde.wf_check_library_roles`), perché un compito senza
  assegnatari bloccherebbe il flusso a metà;
- il modello RdA → gara → affidamento della Galleria Fortolese è **copiato** in libreria della COM
  (`cde workflow-rda --progetto GALFOR --in-libreria`); quello della commessa e il processo di prova restano.

Il motore non cambia: tutte le sue funzioni usano già `i.project_id` dell'istanza; cambiano i due avvii (il modello
si cerca anche nella libreria dell'organizzazione proprietaria; `workflow_start_process` riceve il progetto). Gli
errori di validazione sugli assegnatari ora partono dall'API già riferiti al nodo ("«Verifica»: scegliere il ruolo
dell'assegnatario") e un nodo incompleto resta nel grafo come segnaposto, così non genera errori a cascata.

**Alternative scartate.** Libreria della piattaforma, comune a tutte le organizzazioni: i workflow sono il modo di
lavorare di un'impresa, non vanno mostrati alle altre. Copia automatica in ogni commessa (collegamento "morto"):
le copie divergono e una correzione andrebbe ripetuta commessa per commessa. Persone nei modelli di libreria con
sostituzione all'avvio: in ogni commessa sono altre, e un nome sbagliato darebbe un compito (e l'accesso al
documento) a chi non c'entra. Avvisare invece di bloccare quando un ruolo non ha nessuno: il processo si fermerebbe
al nodo senza assegnatari, più avanti e con un errore meno chiaro.

**Conseguenze.** Disattivare una versione in libreria la toglie da tutte le commesse insieme; i processi già partiti
proseguono. Un'istanza di libreria si legge con la definizione del modello: chi vede l'istanza (membro della
commessa) vede anche il modello, tramite `my_library_orgs`. La pagina è "Libreria workflow" (`/organizzazione/workflow`,
dal menu del profilo e dalla pagina Organizzazione); nella scheda Workflow della commessa la sezione "Dalla libreria
dell'organizzazione". Contratto in `docs/workflow-grafo.md` §5; test `tests/test_workflow_libreria.py`,
`e2e/workflow-libreria.spec.ts`; scenario U52.

## ADR-51 — Tornare indietro da ogni nodo: chiarimenti e richieste di modifiche

**Contesto.** Il 04/11/2026 l'utente chiede che "in tutti i nodi" si possa tornare indietro "per richiedere chiarimenti
o modifiche ai file". Fino ad allora un ritorno era solo un arco disegnato nel modello (ADR-48): chi non lo aveva
previsto non poteva fermarsi a chiedere, né far rifare un passo precedente senza respingere tutto.

**Decisione.** Due azioni su ogni compito di decisione o attività, sempre con un commento, verso un nodo **già fatto
del ramo** (risalendo gli archi percorsi dell'istanza; proposto il passo subito prima) o verso **chi ha avviato**
(migrazione 0042, contratto §6):
- **Chiedi chiarimento**: compito di chiarimento (`tasks.kind = 'CLARIFICATION'`) a chi ha deciso nel giro scelto (o a
  chi ha avviato), risposta con un commento; il compito di chi chiede è "in attesa di chiarimento": non si completa e
  scadenze/escalation sono sospese, alla risposta la scadenza scorre avanti del tempo di attesa. Il flusso non si sposta.
- **Richiedi modifiche**: il nodo scelto si riapre in un nuovo giro (motore di sempre: stessi assegnatari, 20 giri al
  massimo); si annullano il giro di chi chiede e quelli ancora aperti dello stesso ramo fra i due ("rimandato
  indietro"); completato, il flusso riprende seguendo gli archi e rifà i nodi intermedi fino a chi ha chiesto. Per chi
  ha avviato si riapre il nodo di avvio con un compito per lui ("Modifiche fatte").
- **Biforcazioni**: un giro riaperto o rifatto per una richiesta (`workflow_node_runs.send_back_id`) segue solo gli
  archi dell'esito che portano verso il nodo che ha chiesto; se nessuno ci porta (esito diverso, es. "Respinto") segue
  tutti gli archi di quell'esito. Riaprire "Scelta procedura" non riattiva gli altri buyer. Nella regola del join ALL
  un giro "diretto" conta solo verso il cammino fino a chi ha chiesto e oltre (`cde.wf_reaches_toward`): la riunione
  QdR aspetta il ramo tornato indietro, i join interni agli altri rami no.
- **File**: nei workflow su documento chi ha il compito riaperto (solo lui) può caricare una nuova revisione nonostante
  il blocco; completando, il workflow passa su di lei (se era su una SHARED e la nuova è WIP, la si condivide con la
  stessa idoneità), il blocco resta sul documento, il passaggio di stato finale va sulla nuova, la vecchia resta nello
  storico e la richiesta registra il passaggio fra le due. Nei processi chi ha il compito riaperto cambia gli allegati.
- Notifiche `WORKFLOW_CLARIFICATION_REQUESTED`, `WORKFLOW_CLARIFICATION_ANSWERED`, `WORKFLOW_CHANGES_REQUESTED` (in
  piattaforma ed email, sezione "Approvazioni e compiti" del riepilogo).

**Alternative scartate.** Archi di ritorno disegnati automaticamente verso ogni nodo: grafi illeggibili e nessun posto
per il commento o la risposta. Riaprire il nodo scelto e lasciare che segua tutti i suoi archi: da "Scelta procedura"
ripartirebbero tutti e 7 i buyer, rifacendo lavoro già fatto. Chiarimento come RFI separata: il compito non saprebbe di
essere in attesa e la scadenza continuerebbe a correre. Nuova revisione caricata da chiunque durante il workflow: il
blocco del documento (0007) serve proprio a non cambiare il file sotto chi lo sta esaminando; l'eccezione vale solo per
chi ha ricevuto la richiesta, e la revisione entra nel workflow solo quando lui completa. Contare i ritorni a parte: i
20 giri per nodo bastano già a fermare un rimpallo senza fine.

**Conseguenze.** Un compito di chiarimento sta sul giro di chi chiede (stesso `node_run_id`) ma non vota: il motore
filtra `kind = 'WORKFLOW'`; l'unicità per giro e assegnatario vale solo per i compiti del workflow. Il completamento
(`cde.workflow_complete_task`), i join (`cde.wf_check_joins`), le scadenze (`cde.process_deadlines`) e il controllo
delle revisioni (`cde.check_revision`) sono riscritti nella 0042 a partire dalla 0039/0007. I nodi già fatti si
ricostruiscono dagli archi percorsi (`cde.wf_upstream`), senza nuove colonne sugli archi. Contratto in
`docs/workflow-grafo.md` §6; test `tests/test_workflow_ritorno.py`, `e2e/workflow-ritorno.spec.ts`; scenario U54.

## ADR-52 — Modelli di commessa dell'organizzazione, scaricabili in un file

**Contesto.** Il 04/11/2026 l'utente chiede di "rendere i progetti trasformabili in template per poterci copiare e
avere la struttura pronta per una nuova commessa della stessa azienda". Fino ad allora c'era solo "Parti da" una
commessa di cui si è Project Admin (ADR-38): la commessa di partenza continua a vivere e a cambiare, e non porta con
sé né persone del modello né documenti tipo.

**Decisione.** Scelte dell'utente:
- **"Salva come modello" crea un modello di commessa separato** (la commessa resta com'è), elencato nella pagina
  "Modelli di commessa" (`/organizzazione/modelli`). Il modello è un progetto con `projects.is_model` (migrazione
  0043): si apre e si ritocca con le stesse pagine di una commessa (cartelle, naming, metadati, ruoli, filigrana,
  workflow, organizzazioni, persone, documenti di modello), con una barra "Modello di commessa" e senza le schede
  operative. Non entra negli elenchi (`/me/projects`, `/projects`, `/projects/templates`, rotte della suite) e il
  database rifiuta workflow avviati, RFI e transmittal (trigger `forbid_in_model`, 422 col motivo) e non scrive
  notifiche. Non ha mai un codice commessa della suite (CHECK); il codice ISO è un segnaposto e può coincidere con
  quello di una commessa (l'unicità per organizzazione vale solo fra le commesse, indice parziale).
- **Li usano, li creano e li modificano gli amministratori dell'organizzazione proprietaria**: aprendo l'elenco
  (`cde.model_join`) diventano Project Admin dei modelli attivi, e chi non è più admin ne esce. Altre organizzazioni:
  404 (RLS di progetto). Nel dialog "Nuovo progetto" → "Parti da" prima i modelli dell'organizzazione, poi i progetti
  di cui si è Project Admin.
- **Contenuto**: tutto ciò che copia `create_project_from_template` (funzione comune `cde.copy_project_structure`)
  più le **organizzazioni partecipanti** e le **persone con i ruoli**, che nel modello stanno in
  `project_model_people` e *non* sono membri (non vedono il modello: un consulente di un'altra organizzazione non
  deve vederlo); all'uso restano opzionali come in ADR-38. Più i **documenti di modello**: un Project Admin li marca
  (`model_documents`, interruttore "Documento di modello" nel pannello del documento); si copiano come prima revisione
  WIP (P01.01) nella cartella corrispondente, con naming rigenerato col codice nuovo e un file nuovo su S3
  (`cde.model_insert_document`, solo nel progetto appena creato da chi chiama). I workflow della libreria non si
  copiano: sono già vivi in ogni commessa (ADR-50).
- **File "per sicurezza"**: "Scarica il modello" (da un modello o da una commessa, `GET /projects/{id}/model-file`)
  produce un `.cdemodello`: ZIP con `modello.json` (formato `cdemodello`, versione 1: progetto, impostazioni,
  schemi per cartelle, cartelle, ruoli, organizzazioni, persone per email, workflow, documenti, persone e
  organizzazioni citate nei workflow, e in appendice i workflow della libreria dell'organizzazione), `files/…`,
  `LEGGIMI.txt` e `manifest.json` con lo SHA-256 di ogni file. "Carica un modello da file"
  (`POST /organizations/{id}/project-models/import`, solo admin) controlla zip, percorsi, tetti (200 MB,
  `CDE_MODEL_FILE_MAX_BYTES`; 600 voci; JSON 8 MB e profondità 64; compressione oltre 200:1), impronte, versione e
  ogni campo (modelli pydantic con tetti, gli stessi controlli di naming, metadati e filigrana delle pagine), poi
  ricrea il modello rimappando gli id: organizzazioni per codice, persone per email solo se della propria
  organizzazione o di un'organizzazione del modello, ruoli per codice, workflow riportati e ri-validati col
  validatore del grafo (persona assente tolta; nodo rimasto vuoto al ruolo Project Admin), workflow di libreria
  mancanti aggiunti. Restituisce l'elenco degli adattamenti.
- Il **codice commessa della suite** della commessa nuova si sceglie dopo, dal registro, come per ogni commessa
  (ADR-47).

**Alternative scartate.** Modello come JSON in una tabella a parte: niente pagine per ritoccarlo, si sarebbe dovuto
rifare ogni editor. Persone del modello come membri veri: vedrebbero il modello (e le altre organizzazioni con
loro). `has_project_permission` esteso agli admin dell'organizzazione sui modelli: tocca la funzione più usata dalla
RLS; l'ingresso esplicito (`model_join`) ha lo stesso effetto senza costi sulle altre query. Firma HMAC del file:
non si potrebbe ricaricare in un'altra installazione; lo SHA-256 nel manifest basta ad accorgersi di un file rovinato
e l'import ricontrolla comunque tutto. `CopyObject` per i file: con l'Object Lock alcuni S3 compatibili vogliono
intestazioni che la copia non manda; si rilegge e si ricarica in streaming.

**Conseguenze.** Un modello archiviato sparisce da elenco e "Parti da"; le commesse già create non cambiano. I file
dei documenti di modello sono copie: cancellarli o cambiarli nel modello non tocca le commesse. Un `.cdemodello`
contiene nomi ed email delle persone: va conservato come un documento riservato. Rotte nel modulo
`project_models.py`; test `tests/test_modelli_commessa.py`, `e2e/modelli-commessa.spec.ts`; scenario U55.

## ADR-53 — La password del portale vale anche nel login di SkyTower

**Stato:** accettata (06/11/2026).

**Contesto.** La suite Cosedil vuole una password sola per persona: quella del Portale. L'ingresso dal portale
(ADR-47) copre chi apre SkyTower dal portale, ma restano i casi in cui si scrive email e password (link diretto,
sessione del portale scaduta, utente creato dal portale e quindi senza password di SkyTower).

**Decisione.**
- `POST /auth/login`: se la password non è quella di SkyTower, o l'utente non ne ha una, o l'email non esiste,
  `_login_tx` chiede al portale `POST /api/verifica-password` (token di servizio della suite, IP della persona) **prima**
  di contare il tentativo fallito; il portale applica i suoi blocchi (15 errori per utente da quel PC, 50 per PC) e
  risponde 403 se l'account del portale è disattivato, se la password è ancora quella temporanea o se SkyTower non è fra
  i programmi della persona (`portale_non_abilitato` qui).
- Se il portale la riconosce, il login prosegue in `portale.entra(via="password")`: le stesse regole di ADR-47
  (solo email esatta, solo organizzazione della suite, niente platform admin, niente SSO obbligatorio, account
  disattivato o bloccato fuori, MFA come nel login), utente creato se manca; in più il contatore dei tentativi riparte
  da zero (la password è stata provata) e `amr = ["pwd", "portale"]`.
- Un account bloccato da SkyTower resta bloccato: la domanda al portale parte solo dopo il controllo del blocco.
- La password di SkyTower resta valida (riserva, per esempio col portale spento).

**Alternative scartate.** Copiare l'impronta della password del portale in `cde.users` a ogni cambio: due formati
(scrypt e argon2), una copia della credenziale in più da proteggere e un canale portale → SkyTower da tenere
allineato. Contare comunque il tentativo fallito e azzerarlo dopo: col tentativo che fa scattare il blocco, chi ha la
password del portale giusta resterebbe fuori. Chiedere il portale anche per gli account bloccati: aggirerebbe il blocco.

**Conseguenze.** Una persona con due password (SkyTower e portale) ha due segreti indovinabili, entrambi con freno ai
tentativi. Se il portale non risponde il login costa al massimo il timeout della chiamata (4 s) e poi fallisce come
prima. Nei test il portale è finto (`conftest.password_portale_spenta`); test in `tests/test_api_portale.py`.

## ADR-54 — OnlyOffice durante le modifiche richieste e ritorni nel "da fare" del portale

**Contesto.** Dopo ADR-51 restavano due buchi. Chi riceveva "Richiedi modifiche" su un Word o un Excel poteva solo
scaricarlo, correggerlo e ricaricarlo: `office.py` chiamava il blocco secco `cde.assert_not_in_review` e accettava solo
l'ultima WIP, mentre il workflow sta spesso su una revisione condivisa. Il "da fare" della suite elencava i compiti di
chiarimento come "Approvare …", senza dire che c'era una domanda a cui rispondere.

**Decisione.**
- `POST /revisions/{id}/office-session` usa `cde.assert_can_add_revision` (la stessa eccezione del caricamento, 0042):
  entra solo chi ha il giro riaperto. Per lui vale anche l'ultima revisione **condivisa** su cui sta il workflow; fuori
  dalle modifiche richieste resta la regola di ADR-37 (solo l'ultima WIP). La risposta ha `in_modifica`.
- In quel caso l'editor ha **forcesave**: "Salva" manda subito la callback di stato 6 e la WIP nasce prima che la
  persona completi "Modifiche fatte". Senza, il file arriverebbe solo alla chiusura dell'editor e, se il compito fosse
  già completato, il salvataggio verrebbe rifiutato dal blocco.
- `save_edit` crea la WIP sempre con idoneità **S0** (prima copiava quella di partenza, che da una SHARED violava il
  vincolo `revision_code_matches_state`); l'idoneità la rimette il workflow condividendo la revisione nuova.
- Nel compito (posta "Compiti") "Modifica con OnlyOffice" sta accanto a "Carica nuova revisione"; `/me/tasks` dà
  `filename`.
- `GET /suite/da-fare`: "Chiarimento: …" (chi chiede, da quale passo, la domanda), "Modifiche richieste: …" (chi le
  chiede, il commento), compito fermo in attesa di chiarimento a priorità 3 e mai "in ritardo"; l'indirizzo apre il
  compito (`/compiti?instance=…&task=…`).

**Alternative scartate.** Togliere il blocco a chiunque abbia WRITE durante il workflow: è proprio ciò che il blocco
evita (ADR-51). Forcesave sempre: per le modifiche normali ogni "Salva" creerebbe una revisione in più.

**Conseguenze.** Il Document Server resta da installare sul server (U42). Test: `tests/test_api_office.py`
(`test_modifiche_richieste_con_onlyoffice`), `tests/test_api_suite.py` (`test_da_fare_chiarimenti_e_modifiche`), e2e
`onlyoffice.spec.ts`; scenario U56.

## ADR-55 — PDF firmati digitalmente in busta .p7m: si conserva la busta, si legge il documento contenuto

**Contesto.** Il 06/11/2026 l'utente chiede che tutti i programmi della suite che aprono PDF leggano anche i
**PDF firmati con firma digitale** in busta `.p7m` (CAdES), con la **verifica completa** della firma sui certificati
degli enti riconosciuti. Fino ad allora un `.pdf.p7m` in SkyTower era rifiutato dal naming (l'identificativo
risultava `X.pdf`) e comunque restava un file da scaricare: niente visualizzatore, ricerca, annotazioni,
confronto, verifica requisiti. Il motore comune della suite è in `shared/firma` (contratto §10 di
`shared/suite/CONTRATTI.md`): apre la busta e verifica integrità, catena fino a un ente qualificato degli elenchi
eIDAS, revoca, scadenza e marca temporale.

**Decisione.**
- **Naming**: `.p7m` (anche ripetuto, firme "a matrioska") fa parte dell'estensione. `iso19650.split_extension`:
  `X.pdf.p7m` → identificativo `X`, estensione `pdf.p7m`; vale in validazione, rinomina automatica, nuova
  revisione e modelli di commessa. Un documento può avere una revisione `.pdf` e la successiva `.pdf.p7m` (il PDF
  rivisto e poi firmato). Nessuna lista di estensioni ammesse da cambiare: SkyTower non ne ha.
- **Conservazione**: la revisione conserva la busta originale, integra (è lei ad avere valore legale). Il download
  "allegato" dà il `.p7m`.
- **Lettura**: dopo l'antivirus il worker apre la busta con `shared/firma` (`cde_api/firma.py` → `busta.py` →
  `firma.py` nell'ambiente del motore) e mette il **documento contenuto** in un derivato `P7M` (migrazione 0044),
  come i `.glb` degli IFC (ADR-31) e gli SVG dei disegni (ADR-41): stesso ciclo PENDING/READY/FAILED, tre tentativi,
  giro periodico. Visualizzatore (con annotazioni sulle pagine), ricerca nel testo (il testo viene dal PDF
  contenuto), confronto con Confronto Documenti, checklist di Verifica Requisiti e `/suite/revisioni/{id}/file`
  leggono il derivato. Scelto il derivato e non l'estrazione al volo: la busta si apre una volta, la verifica
  (con OCSP/CRL verso gli enti) non si ripete a ogni apertura e il risultato è uno, per tutti.
- **Verifica**: il rapporto del motore (esito `valida` / `non valida` / `da verificare`, riepilogo, firmatari con
  codice fiscale, ente, tipo di firma, marca temporale, motivi, data della verifica) sta nella colonna nuova
  `file_derivatives.firma`. Il dettaglio del documento lo mostra per revisione (`firma_stato`, `firma`), il
  visualizzatore con un badge colorato e i dettagli. Una firma non valida **non blocca**: il documento si carica e
  si legge, la firma è segnalata. "Verifica di nuovo" (`POST /revisions/{id}/firma/verifica`, 6 al minuto per
  utente) rifà la verifica con l'esito di oggi (es. revoca non controllabile al caricamento); l'API aggiorna solo
  `firma`, `detail` e `updated_at` dei derivati P7M dei file che l'utente vede (privilegio di colonna + RLS).
- **Motore assente o busta rotta**: mai un 500. Il derivato va FAILED con il motivo; il `.p7m` resta scaricabile.
  Le buste fermate per "motore non installato" ripartono da sole quando il motore c'è
  (`cde.derivatives_retry_p7m_motore` nel giro periodico). `avvia.bat` installa il motore se manca
  (`shared\firma\installa.bat`, silenzioso); nell'immagine Docker le librerie sono nel venv dell'API,
  `FIRMA_PYTHON` lo indica e il codice arriva da `/shared` (già montato per suite_link).
- **Filigrana**: la busta non si può timbrare senza rompere la firma. Negli stati in cui il Project Admin ha
  attivato la filigrana, visualizzatore e download danno il PDF contenuto timbrato (nome `X.pdf`); il `.p7m`
  originale resta nel CDE con il suo rapporto ma in quegli stati non si scarica così com'è: se deve circolare, il
  Project Admin toglie la filigrana da quello stato.
- **Altre app**: `/suite/revisioni/{id}/file` dà di default il documento contenuto (InCampo, Ponte Trimble lo
  leggono come un PDF), `?originale=true` la busta, header `X-Firma-Esito`.
- Impostazioni: `CDE_FIRMA_RETE` (default true; false = niente download: elenchi dalla cache del motore, revoca "da
  verificare"), `CDE_FIRMA_MAX_BYTES` (200 MB: la busta si legge tutta in memoria).

**Alternative scartate.** Estrarre il PDF al caricamento e conservare quello: si perderebbe il documento con
valore legale. Aprire la busta a ogni visualizzazione: verifica ripetuta (rete verso gli enti), lenta e con esiti
diversi nel tempo. Verifica nel processo dell'API con librerie proprie: le stesse regole andrebbero tenute in sei
programmi; il motore comune le tiene in un posto solo. Rifiutare il caricamento di una firma non valida: in un CDE
il documento ricevuto va comunque archiviato, la firma va segnalata.

**Conseguenze.** La verifica è quella del momento del caricamento (con la data in `verificato_il`); "Verifica di
nuovo" dà quella di oggi. Non gestiti per ora: firme staccate (`.p7s`), buste con marca separata (`.tsd`, `.m7m`),
verifica della firma PAdES dentro un PDF (il PDF si legge già come prima). Test: `tests/test_firma_p7m.py`
(motore finto per il flusso, motore vero con l'ente certificatore di prova se `shared/firma/.venv` c'è),
`packages/iso19650/tests`, e2e `firma.spec.ts`; scenario U57.

## ADR-56 — Timbri sui PDF: il PDF timbrato è una nuova revisione WIP, con traccia di chi e quando

**Contesto.** Il 09/11/2026 l'utente chiede di "inglobare una versione di Timbri in SkyTower" (scelta 4a): mettere
sulle pagine dei PDF la firma scansionata, il logo, «Approvato», il timbro dell'impresa con lo sfondo reso
trasparente come fa il programma della suite *Timbri per VFP* (`timbri-vfp/`, che resta com'è: produce file
`.stamp` per le annotazioni di VFP), e avere il PDF timbrato come nuova revisione con traccia di chi ha timbrato e
quando. Fino ad allora in SkyTower c'erano le annotazioni (fuori dal file) e la filigrana (sul file scaricato, non
archiviata).

**Decisione.**
- **Libreria dei timbri** (migrazione 0045, tabella `cde.stamps`, `modules/stamps.py`): un timbro è un PNG con
  trasparenza su S3 (`stamps/<organizzazione>/<id>.png`). Tre ambiti: **personale** (la propria firma: la vede e
  la usa solo il proprietario, in tutte le sue commesse), **dell'organizzazione** (logo, timbro dell'impresa: lo
  crea l'amministratore dell'organizzazione, lo usano tutti i colleghi in tutte le commesse), **della commessa**
  («Approvato DL», «Visto CSE»: lo crea il Project Admin, lo usano tutti i membri, di ogni organizzazione). RLS:
  visibilità = chi lo può usare; creazione e modifica solo da chi lo gestisce (`cde.stamp_manageable`), sempre
  nella propria organizzazione. I timbri **non si cancellano**: si disattivano (le revisioni già timbrate e il
  registro restano sensati); si cambiano solo nome e attivazione (privilegio di colonna), l'immagine no.
- **Scontorno**: lo stesso algoritmo di Timbri per VFP ("color to alpha" sul colore di sfondo stimato dal bordo,
  tolleranza 0–60%). Il PNG salvato lo prepara l'**API** (`cde_api/timbri.py`, Pillow + numpy; immagini oltre
  2000 px rimpicciolite, oltre 40 Mpx rifiutate); il browser fa la stessa cosa solo per l'anteprima
  (`components/timbri/scontorno.ts`, test unitari con lo stesso risultato del server). L'immagine arriva in
  base64 dentro il JSON (8 MB, `CDE_TIMBRO_IMMAGINE_MAX_BYTES`): l'API non accetta multipart.
- **Timbrare** (`POST /revisions/{id}/timbra`): il visualizzatore manda, per ogni timbro, pagina e rettangolo in
  **frazioni della pagina come la si vede** (origine in alto a sinistra, come le annotazioni). Il server trasferisce
  l'eventuale /Rotate nel contenuto (come la filigrana) e disegna una sovrapposizione grande quanto l'area visibile
  (intersezione CropBox/MediaBox, la stessa che mostra pdf.js) con fpdf2, fusa con pypdf solo sulle pagine
  timbrate; l'immagine sta nel rettangolo senza deformarsi. A richiesta, sotto il timbro, la didascalia «Timbrato
  da Nome Cognome il gg/mm/aaaa hh:mm»: la scrive il server (nome dell'utente, ora nel fuso della commessa), non il
  browser.
- **Nuova revisione**: il PDF timbrato diventa la **WIP successiva** (sempre S0, come il salvataggio di OnlyOffice)
  con lo stesso nome di file e il commento «Timbrata in piattaforma (timbri) a partire dalla P01.01»; antivirus,
  impronta, testo per la ricerca e anteprime come per ogni file (job `cde.verify_file`). La revisione di partenza
  resta com'era. Regole di una revisione nuova: si timbra l'**ultima** revisione del documento (qualunque stato:
  «Approvato» su una tavola pubblicata dà una WIP da condividere e pubblicare di nuovo), serve **WRITE** sulla
  cartella, documento non archiviato, e durante un **workflow** vale `cde.assert_can_add_revision`: bloccato (423)
  tranne per chi ha il compito riaperto da una richiesta di modifiche (ADR-51), come per OnlyOffice (ADR-54).
  Il controllo si ripete al salvataggio (se nel frattempo è arrivata un'altra revisione: 409).
- **Traccia**: nel registro attività (catena di hash) `REVISION_UPLOADED` con `via: timbri` e `REVISION_STAMPED` con
  revisione di partenza e nuova, timbri usati (id, nome, ambito, pagina), didascalia; `STAMP_CREATED` e
  `STAMP_UPDATED` per la libreria.
- **Documenti firmati**: una busta **.p7m non si timbra** (409 `firmato`): la firma riguarda il file originale e il
  timbro la romperebbe; il visualizzatore non offre «Timbra» sul documento contenuto. Si timbra il PDF prima di
  firmarlo, o se ne carica una copia non firmata. Un **PDF con firma PAdES** (campo /Sig compilato) si timbra solo
  dopo una conferma esplicita (409 `pdf_firmato`, poi `accetta_firma_pdf`): la revisione timbrata non ha più una
  firma valida (la conserva quella di partenza) e il registro lo dice (`pdf_signature_dropped`).
- Impostazioni: `CDE_TIMBRI_PDF_MAX_BYTES` (100 MB: il PDF si legge tutto in memoria); PDF protetti da password
  rifiutati con un messaggio.

**Alternative scartate.** Timbri come annotazioni sovrapposte (fuori dal file): non viaggerebbero con il PDF
scaricato o trasmesso, e un timbro di approvazione deve stare sul documento. Timbrare la revisione sul posto: le
revisioni sono immutabili (impronta SHA-256, ISO 19650). Scontorno solo nel browser con il PNG già pronto dal
client: il server non potrebbe garantire cosa archivia; per l'anteprima il browser basta. Timbri solo
dell'organizzazione: la firma personale non deve essere usabile dai colleghi, «Approvato DL» deve valere per tutte
le organizzazioni della commessa.

**Conseguenze.** Un PDF timbrato durante una richiesta di modifiche entra nel workflow come una revisione
caricata. Le revisioni timbrate restano anche se il timbro viene poi disattivato. Non gestiti per ora: timbri
ruotati, timbri su immagini o disegni CAD (solo PDF), copia dei timbri della commessa nei modelli di commessa
(ADR-52). Test: `tests/test_api_timbri.py` (scontorno, posizione con pagine ruotate e CropBox controllata
rendendo il PDF con pdfium, firma PAdES, permessi e visibilità, nuova revisione e registro, revisione pubblicata,
buste .p7m, workflow), `unit/scontorno.test.ts`, e2e `timbri.spec.ts`; scenario U58.

## ADR-57 — Amministratore del portale = amministratore dell'organizzazione della suite e Project Admin

**Contesto.** Il 09/11/2026 l'utente ha chiesto un solo login e che le sue credenziali valgano "come admin
ovunque". Con ADR-47 un amministratore del portale che entrava dal portale diventava admin dell'organizzazione solo
alla **creazione** dell'account e, nei progetti, sempre `DESIGNER` (i ruoli forti li dava un Project Admin a mano):
un account già esistente, o nato utente, restava senza diritti di amministrazione.

**Decisione.** In `portale.entra` (cookie del portale e password del portale) chi ha **ruolo `admin` nel portale**
(`admin_del_portale`: `ruolo == "admin"` e `admin` vero nella risposta di `/api/verify`) a ogni ingresso:
- diventa `is_org_admin` dell'organizzazione della suite, se non lo è già (aggiornamento a nome del platform admin,
  evento `ORG_ADMIN_DAL_PORTALE`);
- riceve la membership `PROJECT_ADMIN` in **tutti i progetti non archiviati di proprietà** dell'organizzazione della
  suite dove non l'ha già, in aggiunta ai ruoli che ha (la chiave è progetto + utente + ruolo), inserita a nome di un
  Project Admin del progetto come prima (evento `MEMBER_ADDED` con `portale=True`).

Restano tutte le altre regole di ADR-47: solo email esatta e solo nell'organizzazione della suite; platform admin,
altre organizzazioni, SSO obbligatorio, account bloccati o disattivati non entrano da qui; MFA come nel login con
password; progetti di altri committenti mai toccati. Solo promozione: chi smette di essere admin nel portale non
perde nulla in SkyTower (lo toglie un admin dalla pagina Utenti o Membri). **Superato da ADR-58** (11/11/2026):
l'admin ora si dà e si toglie a ogni ingresso, e alla creazione la regola IP non basta più. L'admin per l'app concesso da una regola
IP del portale (`data/ip-admin.json`, ruolo `utente`) **non** basta: vale solo davanti a quel PC, mentre il ruolo
in SkyTower resterebbe ovunque. Gli utenti non admin del portale restano come prima (`CDE_SUITE_RUOLO_PORTALE`).

**Alternative scartate.** Collegare l'amministratore del portale al suo account personale di platform admin: il
portale gestisce le email dei suoi utenti, quindi un portale compromesso darebbe la piattaforma intera (tutti i
tenant); il platform admin resta con password e secondo fattore. Ruoli calcolati a ogni richiesta dal portale
invece che salvati: cambierebbe RLS e ogni rotta, e SkyTower dipenderebbe dal portale acceso.

**Conseguenze.** Un portale compromesso può amministrare l'organizzazione della suite in SkyTower (non le altre
organizzazioni né la piattaforma): l'account admin del portale va protetto come quello di SkyTower. L'account
personale di platform admin (es. quello dell'utente, con email diversa da quella del portale) non cambia ed entra
come sempre con password e secondo fattore. Test: `tests/test_api_portale.py`
(`test_admin_del_portale_diventa_org_admin_e_project_admin`, `test_utente_esistente_promosso_quando_e_admin_del_portale`,
`test_admin_solo_da_regola_ip_non_promosso`).

## ADR-58 — Il profilo del portale vale in SkyTower: account collegato, admin dato e tolto, controllo al login

**Contesto.** L'11/11/2026 l'utente ha deciso che "il profilo del portale vale per ogni programma" e che "gli admin
devono essere creati solo da me, io posso creare e cancellare gli admin" (scelte 2b: il portale si controlla solo al
login; 3b: le password proprie dei programmi restano, ma ogni login chiede anche al portale; 4a: i ruoli sotto
l'admin restano decisi dentro ogni programma). Con ADR-57 SkyTower prendeva dal portale solo la **promozione**
all'admin, e solo all'ingresso dal portale: l'account era legato al portale per email (un'email cambiata nel portale
creava un secondo account, il vecchio con i suoi diritti), un admin tolto nel portale restava admin in SkyTower, una
persona disattivata nel portale continuava a entrare con la password di SkyTower, una passkey o una sessione
rinnovata all'infinito (il refresh token si allungava a ogni rinnovo), e alla creazione bastava l'admin dato da una
regola IP del portale. Qualunque admin dell'organizzazione poteva nominarne altri.

**Decisione.**
- **Collegamento per username** (migrazione 0046, `users.portale_username`, unico): l'account che entra dal portale
  (cookie o password del portale) o che il portale riconosce al login si collega allo username della persona; poi lo
  si cerca prima per username e poi per email. A ogni ingresso nome, cognome ed email si allineano al portale (un nome
  già giusto ma diviso diversamente non si riscrive; un'email di un altro account non si copia). Se l'email del
  portale appartiene a un account già collegato a un'altra persona: 403 `portale_collegato_ad_altro`. Per i dati già
  esistenti il collegamento è ricostruito dal registro di sicurezza (ultimo `LOGIN_PORTALE`/`USER_CREATED_PORTALE`).
- **Admin dato e tolto** (`portale.allinea_profilo`): per un account collegato `is_org_admin` = ruolo `admin` del
  portale a ogni ingresso; il declassamento (`ORG_ADMIN_TOLTO_DAL_PORTALE`) toglie anche i `PROJECT_ADMIN` aggiunti
  dalla regola di ADR-57, ora segnati `project_memberships.dal_portale_admin` (ricostruiti dagli eventi
  `MEMBER_ADDED` con `portale=true`); gli altri ruoli della persona restano (la chiave è progetto + utente + ruolo),
  e chi resta senza ruolo in una commessa con codice torna `CDE_SUITE_RUOLO_PORTALE`. Se la persona è l'unico Project
  Admin di una commessa il ruolo resta (`PROJECT_ADMIN_DAL_PORTALE_TENUTO`). Alla creazione dell'account conta solo il
  ruolo `admin`, mai la regola IP.
- **Controllo al login** (`portale.controlla_ingresso`, `POST <portale>/api/suite/profilo` col token della suite):
  dopo la password giusta di SkyTower, la passkey, il single sign-on e prima di mandare o usare un link di reset della
  password, per gli account dell'organizzazione della suite (non platform admin): persona disattivata nel portale →
  403 `portale_disattivato`; SkyTower non fra i suoi programmi → 403 `portale_non_abilitato`; account collegato ma
  persona eliminata dal portale → admin tolti e 403 `portale_eliminato`; portale spento → si entra (3b), evento
  `PROFILO_PORTALE_NON_VERIFICATO`; persona sconosciuta e account non collegato → account solo-SkyTower, nulla cambia.
  Con la persona attiva il profilo si copia anche da qui (collegamento, nome, email, admin, commesse con codice). Il
  single sign-on fa solo il controllo (tiene bloccata la riga dell'utente): l'allineamento avviene al login seguente.
- **Rinnovo con tetto assoluto** (`auth._refresh_tx`): il refresh token nuovo eredita la scadenza del precedente,
  cioè quella fissata dal login (14 giorni; 12 ore in HTTP, ADR-49). Prima ogni rinnovo la spostava avanti e la SPA
  prova il rinnovo prima del portale: una persona disattivata non sarebbe mai tornata al login. Scaduto il tetto la
  SPA ricade da sola su `POST /auth/portale` (`api.refreshSession` → `sessioneDalPortale`): per chi viene dal portale
  non cambia nulla, gli altri rifanno il login. Fra un login e l'altro il portale non si chiede (2b).
- **Admin solo dal proprietario** (`portale.richiedi_proprietario`, `GET /me/proprietario`): nominare, togliere,
  disattivare o riattivare un amministratore dell'organizzazione (pagina Organizzazione, invito con
  «Amministratore», in **qualunque** organizzazione) può solo chi è collegato al portale e per cui il portale dice
  `proprietario` (oggi l'utente), verificato dal vivo: altrimenti 403 `solo_proprietario`, portale spento 503. Su un
  account collegato l'admin non si cambia nemmeno dal proprietario: 409 `deciso_dal_portale` (lo si cambia nel
  portale). Gli strumenti da riga di comando (`tooling/`, seed, demo, account personali) restano liberi.

**Alternative scartate.** Chiedere il portale a ogni richiesta (2a): cache e dipendenza continua dal portale acceso,
scartata dall'utente. Togliere le password di SkyTower ai collegati (3a): scartata dall'utente, il portale spento non
deve fermare SkyTower. Riconoscere come proprietario anche il platform admin: il platform admin non è una persona del
portale (account personale con altra email) e il proprietario va verificato dove lo decide l'utente, cioè nel
portale; il primo admin di una nuova organizzazione esterna lo nomina il proprietario entrando dal portale, oppure da
riga di comando. Togliere solo l'admin dato dal portale lasciando quello dato in SkyTower (1b): scartata, "gli admin li
creo e li cancello solo io".

**Conseguenze.** Il portale è la fonte dell'identità e dell'admin per i suoi utenti; un portale compromesso continua a
poter amministrare l'organizzazione della suite (ADR-57), non la piattaforma. Gli admin delle organizzazioni esterne
non possono più nominare colleghi admin: lo fa il proprietario. Una persona disattivata nel portale perde SkyTower al
login successivo, al più entro la scadenza della sessione (14 giorni; 12 ore in HTTP). Portale spento: si entra, ma
nessuno può dare o togliere admin finché non torna. Migrazione 0046 (applicata da `cde dev` all'avvio). Test:
`tests/test_api_profilo_portale.py` (collegamento ed email cambiata, admin dato e tolto con i ruoli di prima, regola IP
alla creazione, login con password propria disattivato / non abilitato / eliminato / portale spento, account trovato
per email, reset della password, tetto del rinnovo, admin solo dal proprietario), `tests/test_api_portale.py`.
