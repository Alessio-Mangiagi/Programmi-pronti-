<!-- "><(((º> sabusabu <º)))><" -->
# Contesto del progetto

Programma Python che trasferisce documenti da un altro DMS (esportato su disco) a
**Viewpoint For Projects** (VFP, Trimble), tramite le API pubbliche VFP.

- Codice: `vfp_transfer.py` (logica + CLI). Istruzioni utente: `README.md`.
- Impostazioni e credenziali: `.env` (modello `.env.example`), letto da `env_config.py` (parser stdlib,
  variabili Windows con precedenza, migrazione automatica dal vecchio `config.json`). Il token VFP resta
  in `.vfp_token.json` perche' viene riscritto a ogni rinnovo.
- GUI per il personale: `vfp_gui.py` (server stdlib su 127.0.0.1:8770, API JSON; dalla rete solo HTTPS con
  `GUI_BIND`/`GUI_HOSTNAME`/`GUI_TLS_*`, vedi `_network_setup`) + `ui/` (HTML/CSS senza build, design system
  Cosedil; JS in `ui/js/*.js`, script classici caricati in ordine da `index.html` che condividono le variabili
  globali: una funzione chiamata al caricamento deve stare in un file precedente, es. `bindChips` in `base.js`).
  API di posta, protocolli e ricerca in `api_posta.py` (`WATCHER` e `PATHS` impostati da `vfp_gui`).
  `/api/salute` senza sessione solo da 127.0.0.1; `_watchdog` esce con codice 3 se il ciclo posta si blocca.
- Posta automatica: `vfp_mail.py` (Microsoft Graph con client credentials, IMAP, PEC con postacert.eml).
  Il `MailWatcher` gira come thread dentro `vfp_gui.py` e non termina mai; condivide con la GUI il
  `TokenManager` (non interattivo per la posta) e un lock, cosi' trasferimenti manuali e da email non
  scrivono mai insieme su `stato_trasferimento.json`.
- Cassaforte: `cassaforte.py` (DPAPI via ctypes, file `cassaforte.dat`) con utenti e `env_config.VAULT_KEYS`;
  `load_settings` sposta le credenziali dal `.env` alla cassaforte, `save_settings` scrive le due parti.
  Le modifiche a `OTP_KEYS` e agli utenti passano da `auth.require_approval` (codice via email all'admin,
  HTTP 428 gestito da `api()` in `ui/js/base.js`); attivo solo quando `mail_send.send_problems` e' vuoto.
- Attività utenti: `attivita.py` (JSONL con catena di impronte SHA-256, `record()` non solleva mai). Eventi
  scritti in `vfp_gui.py` (login, rifiuti in `_allowed`, `_post_event` per le chiamate semplici) e in `auth.py`
  (codici). Pagina `/api/activity`, export `/api/activity.xlsx`, chiusura sessioni `auth.close_session`.
- Accesso: `auth.py` (utenti nella cassaforte, PBKDF2, sessioni in memoria con cookie HttpOnly SameSite=Strict,
  blocco dopo 5 errori). Ruoli `admin` (tutto) e `utente` (solo Panoramica + `/api/report/send`); i permessi
  per rotta sono in `Handler.do_GET`/`do_POST` di `vfp_gui.py`, l'interfaccia nasconde le voci `[data-admin]`.
- Invio email (report Excel all'admin + indirizzo scelto): `mail_send.py`, SMTP con TLS verificato o Graph sendMail.
- PEC: `pec.py` legge `daticert.xml` (ElementTree, niente DOCTYPE/ENTITY) e verifica `smime.p7s` con crypt32
  (`CryptVerifyDetachedMessageSignature`) sui byte originali della prima parte del multipart/signed
  (`signed_content`). Firma "non valida" = quarantena; ricevute (`RECEIPT_TYPES`) = esito `ricevuta`, restano in casella.
- Protocollo PEC: `protocollo.py` (regole predefinite + `PEC_PROTOCOL_REGEX`, anno aggiunto se manca, correzioni in
  `protocolli_manuali.json`, `check()` mancanti/doppi per anno). Calcolato in lettura (`read_mail_log`, `snapshot`),
  mai salvato nel registro. Il registro `registro_posta.csv` ha colonne nuove in coda (`MAIL_LOG_FIELDS`):
  `_upgrade_log` riscrive i file vecchi. "Riprova adesso": `request_retry` mette in coda, `_do_retries` gira nel
  thread della posta (unico che scrive `stato_posta.json`) e usa `restore()` delle caselle via Message-ID.
- Test: `python -m unittest discover -s tests -t .` (stdlib; `tests/test_api.py` avvia `vfp_gui.Handler` su una porta libera).
- Sicurezza posta in `vfp_mail.py`: `screen()` (dimensione, allegati pericolosi `BLOCKED_EXT`, mittenti autorizzati,
  SPF/DKIM/DMARC) e `scan_folder()` (Windows Defender); esito `bloccata` = spostata in quarantena, nulla caricato.
- Impostazioni da interfaccia validate da `env_config.validate_settings` (niente a capo, URL VFP solo https su
  domini Viewpoint/Trimble); una password mascherata non resta valida se cambia il suo server (`SECRET_BINDINGS`).
  I CSV passano da `vt.csv_cell`/`vt.csv_plain` (anti formule Excel).
- Smistamento AI (solo admin): `ai_smistamento.py` chiama la Messages API di Anthropic (URL fisso, tool use
  forzato `assegna_cartelle`) con i soli nomi dei file e l'albero delle cartelle VFP (`VfpClient.list_child_folders`);
  le risposte fuori dall'albero diventano "Da smistare". Endpoint `/api/ai/analyze|status|start` in `vfp_gui.py`.
- Sempre attivo: `installa_avvio_automatico.ps1` crea un'operazione pianificata (pythonw `--service`,
  all'accesso + controllo ogni 5 minuti con IgnoreNew, riavvio su errore). Log in `logs/vfp_servizio.log`.
- Documentazione API: Swagger https://api-uk.vfp.viewpoint.com/swagger/ui/index
  (spec JSON: https://api-uk.vfp.viewpoint.com/swagger/docs/latest).
- Autenticazione: OAuth2 Authorization Code, authorize su identity-uk.team.viewpoint.com,
  token su api-uk.vfp.viewpoint.com/token, scope `vfp.fullaccess`.
- Flusso: cartelle (`/v5/documentfolders`) -> documento (`/v3/documents`, richiede Name e ParentId
  di una Document Folder) o nuova revisione (`/v4/documents/{id}/revisions`) -> upload
  (`/v1/documents/{id}/files` restituisce un URL S3 temporaneo per una PUT; sopra 100 MB
  `/files/multipart` + `/files/completemultipartupload`).
- Le modifiche a un documento esistente richiedono l'header `If-Match` con l'ETag letto da
  `GET /v2/documents/{id}`.

## Stato

- Logica, GUI e posta provate solo con client VFP e caselle finti (mai contro VFP/Microsoft 365 reali).
- Da verificare alla prima prova reale: formato delle risposte delle liste (gestito in `_items`),
  dettagli dello scambio token, disponibilita' dello scope `offline_access`.
- Credenziali API (client_id) da richiedere a Trimble/Viewpoint (support@4projects.com).
- Possibile sviluppo: leggere direttamente dal DMS di origine (es. SharePoint) invece che da un export.

Commenti e messaggi del programma sono in italiano.
