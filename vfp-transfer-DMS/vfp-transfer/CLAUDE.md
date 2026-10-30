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
  Due aree nello stesso programma: Documenti e Posta (`setArea` in `base.js`, `body[data-area]`). Voci di menu e
  schede della panoramica hanno `data-area` documenti/posta/comune e il CSS nasconde quelle dell'altra area;
  `showView` verso una pagina dell'altra area cambia area da solo. Nuove pagine: mettere sempre `data-area`.
  Area per utente: `auth.AREE`, campo `area` dell'utente (`area_di`, predefinita documenti), riletta in `session()`.
  L'admin vede tutto; l'utente solo la sua area (`setArea` forzata, selettore `data-admin`). Sul server i ruoli di
  rotta `area:documenti` / `area:posta` in `_allowed` (`/api/report`, `/api/mail`); `report_excel.build_report(area=)`
  toglie l'altra area dal report inviato da un utente. In UI `canSeeArea()` evita chiamate che darebbero 403.
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
- Confronto documenti (pagina per tutti, `ui/js/confronto.js`): `confronto.py` avvia come processo figlio l'app
  sorella `confronto-documenti` (suo `.venv`, `COSEDIL_SSO=off`, 127.0.0.1, porta libera, `CONFRONTO_PASSWORD` casuale,
  Job Object KILL_ON_JOB_CLOSE) e `vfp_gui` fa da proxy su `/api/confronto/...` (`_confronto_get/_post`, multipart
  inoltrato a blocchi prima del limite JSON). Proprietario di ogni confronto in `confronti/registro.json`
  (`puo_vedere`: proprietario o admin, altrimenti 404). Nessuna copia della logica del motore: le sue rotte sono in
  `confronto-documenti/server.py`. Voci di menu per tutti = `data-tutti` (`showView` le lascia aprire all'utente).
- Accesso: `auth.py` (utenti nella cassaforte, PBKDF2, sessioni in memoria con cookie HttpOnly SameSite=Strict,
  blocco dopo 5 errori). Ruoli `admin` (tutto) e `utente` (Panoramica, Confronta documenti, `/api/report/send`); i permessi
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
- Smistamento AI (solo admin): `ai_smistamento.py` chiede a Claude (via `claude_json.chiedi_json`) i soli nomi dei file
  e l'albero delle cartelle VFP (`VfpClient.list_child_folders`); le risposte fuori dall'albero diventano "Da smistare".
  Endpoint `/api/ai/analyze|status|start` in `vfp_gui.py`.
- Claude: `claude_json.py` (URL fisso, uscita JSON con `output_config.format`, `fallbacks: "default"` sui modelli che
  lo accettano, errori su refusal/max_tokens). MAI `tool_choice` forzato: su claude-opus-5-5 da' 400.
- Moduli autocompilati: `moduli.py` (solo logica + CLI, pagina e API ancora da fare). Definizioni in `moduli/*.json`
  (`valida_modulo`, tipi in `TIPI`), lettura locale (`testo_documento`: pypdf, DOCX via zipfile, TXT) + regole
  (`compila_locale`: regex del campo, etichette `cerca`), poi Claude solo sui campi mancanti secondo `MODULI_AI`
  (no/conferma/auto, in `OTP_KEYS` perche' decide se il contenuto esce verso Anthropic). Ogni valore passa da
  `normalizza` (date ISO, importi Decimal, P.IVA con cifra di controllo). Archivio `moduli_compilati/<id>/`
  (record.json, copia del documento, modulo.pdf); PDF = PDF compilabile del modulo (`pdf` + `pdf_campo`, pypdf)
  oppure `scheda_pdf` generata senza librerie. Origini: `SORGENTI` (caricamento, posta, cartella, dms; cpm e
  alyante `da_collegare`). DMS via `DMS_URL/USER/PASSWORD` e `estrai_dms` (sola lettura).
  Campi con `ambito` documento/fornitore/fisso; `chiave_fornitore` (P.IVA) -> `Anagrafica` in
  `moduli_compilati/fornitori/<chiave>.json`: `_applica_anagrafica` compila i campi del fornitore e NON sovrascrive mai
  il registrato con il letto (avviso "ATTENZIONE", difesa dalle truffe sul cambio IBAN); `Archivio.salva(conferma=True)`
  registra, e cambiare un dato registrato richiede `aggiorna_anagrafica=True` (storico). `sezioni` con testo fisso e
  segnaposto `{id_campo}` (`testo_sezione`, `blocchi_scheda`), es. Art. 1 tracciabilita' (L. 136/2010).
- Modelli .doc: `modelli_doc.py` legge il .doc (OLE/FIB/piece table, aree da PlcfBkfProt/PlcfBklProt in
  FibRgFcLcb2003, aree accavallate unite), LibreOffice converte, `trova_aree` ritrova ogni area per contesto+testo
  (solo se univoca), `metti_aree` rimette permStart/permEnd dividendo i run, `proteggi`; rifiuto se testo del corpo
  o aree non identici. Cache `MODELLI_LAVORO/_convertiti/<sha>/`; `modelli_protetti.modello_docx` la usa.
- Mezzi a nolo: `mezzi.py` (logica + CLI) + pagina Mezzi (`ui/js/mezzi.js`, rotte `/api/mezzi/...` admin in
  `vfp_gui`). Maschera = modulo `moduli/mezzi_nolo.json` con in piu' `calcoli`, `contratto.aree` (regole `dopo` =
  fine del testo che precede l'area, confrontato con `prima` di `leggi_aree`; oppure `{{campo}}` nel modello) e `dms`
  (cartella/nome/descrizione + tipi di documento, `automatico` contratto/scheda); `contratto.sostituzioni`
  [da, a] su tutte le aree (`sostituisci`: ___ = buco di qualsiasi lunghezza o `re:`; salta se manca un dato o se
  cambierebbe i paragrafi). Campo `predefinito` usato solo dalla pagina. Testi: `{campo}`, `{campo:lettere}`
  (`in_lettere`, stile contratti Cosedil: cento senza elisione), `[[...]]` facoltativo. Pratiche in
  `MODULI_ARCHIVIO/mezzi/<id>/` (copie dei documenti con SHA-256); ditta nell'`Anagrafica` dei moduli: dato diverso
  dal registrato = errore che inizia con "ANAGRAFICA" finche' non arriva `aggiorna_anagrafica`. Contratto via
  `modelli_protetti.Pratiche` (testi adattati ai paragrafi con `_adatta`). Viewpoint: `prepara_caricamento` scrive
  `manifest.csv` e `api_mezzi_carica` usa `api_start` (stesso lavoro e avanzamento del Trasferimento). Selettore file
  `openBrowser('doc', {onPick})` in `dialoghi.js` (`/api/browse?files=doc`).
  Area utente `mezzi` (`auth.AREE`): rotte mezzi con ruolo `area:mezzi` (Viewpoint `/api/mezzi/carica` solo admin);
  in UI le voci `data-utente` (Mezzi, Flusso posta) si aprono agli utenti della loro area (`showView`). File dal browser:
  `POST /api/mezzi/allega` (corpo = file, letto a blocchi prima del limite JSON, `Pratiche.allega`); `percorso` sul disco
  del server e `aggiorna_anagrafica` solo admin (`api_mezzi_salva`). DMS: `mezzi.ScritturaDms` (client separato, rotte
  ammesse in `AMMESSE`, cartelle solo sotto `DMS_MEZZI_CARTELLA`), `archivia_nel_dms` usa le stesse righe di
  `righe_dms`; esito in `record["dms"]`. `report_excel.build_report`: un'area diversa da documenti/posta non riceve nulla.
  Ponte CPM/Alyante (`ponte.py`, sola lettura): impostazioni `CPM_*`/`ALYANTE_*` convertite in `SQL_*` per riusare
  `sorgente_sql.open_connection`; `ELENCHI` = vista, colonna chiave, ordine dei gestionali; valori cercati validati
  (`_PIVA_RE`, `_CODICE_RE`) prima di finire nella SELECT. API `/api/mezzi/fornitore` (campo `gestionale`),
  `/api/mezzi/commessa`, `/api/mezzi/commesse`; in `mezzi.js` `mzRiempi` compila i vuoti e segnala i diversi.
  Nei test la connessione si passa con `connetti=` (o si sostituisce `ponte.apri`).
- Modelli Word protetti (trasporti, contratti): `modelli_protetti.py` (logica + CLI, GUI da fare). Documento in
  "Limita modifica" sola lettura; le aree gialle sono le eccezioni `<w:permStart w:id>`...`<w:permEnd>`: si cambiano
  solo i `<w:t>` li' dentro (minima differenza, una riga per paragrafo o sostituzioni `[[da, a]]`), poi
  `_testo_fuori` deve risultare identico e le altre parti dello zip restano byte per byte. Originali in
  `MODELLI_SORGENTE` (condivisa, mai scritta), pratiche in `MODELLI_LAVORO/<id>/` (`originale_*` intatto con SHA-256,
  copia compilata rifatta sempre dall'originale, `record.json`). `.doc` rifiutati: LibreOffice perde le aree, Word
  COM non c'e' sul PC: per i .doc c'e' `modelli_doc.py` (sotto). Le due cartelle sono in `env_config.SOLO_SVILUPPATORI`: `api_get_config` non le manda,
  `api_save_config` rifiuta modifiche (si cambiano solo nel `.env`). Controllo mensile: thread `_controllo_modelli`
  in `vfp_gui` (ogni ora guarda `controllo_dovuto`, primo giro del mese), `controlla_modelli` confronta SHA-256 con
  `stato_modelli.json` (prima volta o cartella cambiata = solo fotografia; cartella irraggiungibile = un solo avviso
  "errore" aperto). Avvisi in Panoramica admin (`#ovModelliBanner`, `/api/modelli/avvisi` e `/avvisi/visto`).
- Estrazione dal DMS di origine: `estrai_dms.py` (CLI separata). `LetturaSicura` ammette solo GET e `POST /login`
  (`ScritturaBloccata`), niente redirect, freno richieste/s (raddoppiato su 429), retry su 429/5xx/rete, `DmsSovraccarico`
  dopo N errori di fila, finestra `--orario`. Adattatore `SorgenteSeedDms` (login/logout/cartella/figli/versioni/scarica):
  un altro DMS = un'altra classe con gli stessi metodi. Output: `file/<doc>/v<n>/<nome>`, `stato_estrazione.json`
  (SHA-256, ripresa), `report_estrazione.csv`, `manifest.csv` (valori con `csv_cell`; `items_from_manifest` applica `csv_plain`; colonna `sha256`: `Transfer.run`
  scarta i file cambiati dopo l'estrazione). `--verifica --dest` ricalcola gli SHA-256 e toglie dallo stato i file guasti.
  DMS di prova: SeedDMS 6 portabile fuori dal repo (`..\..\seeddms-prova`, porta 8780), dati finti con
  `strumenti_prova/popola_seeddms.py` (solo localhost).
- Archivio SQL (sola lettura): `sorgente_sql.py` legge una vista SQL Server (colonne canoniche nel docstring) con ODBC
  via ctypes (`OdbcConnection`, niente pyodbc: Python 3.15 non ha la wheel), solo SELECT costruite da `build_query`,
  connessione read-only. File in `specchio_sql/<id>/<rev>/`, data dell'ultimo giro in `stato_sql.json`. Per ora solo
  CLI (`prova`, `trasferisci`): da agganciare alla GUI/servizio con `TRANSFER_LOCK`. Impostazioni `SQL_*` in `env_config`.
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
- Moduli: in attesa delle maschere vere dall'utente; da fare pagina "Moduli" + API in `vfp_gui.py`.
- Mezzi: format veri in `Programmi-pronti-\Contratti\Modelli Word\Mezzi\FORMAT CONTRATTUALI\<commessa>\` (fuori da
  git, = `MODELLI_SORGENTE` nel `.env` di sviluppo), 293 .doc + 8 .docx. Sostituzioni verificate sul nolo a freddo
  101-003 (16 aree su 21 dai dati); nolo a caldo e righe INPS/INAIL a puntini da provare/compilare a mano.
  CPM e Alyante: ponte (`ponte.py`) pronto ma provato solo con gestionali finti; servono dall'IT server, utente di
  sola lettura e le viste fornitori/commesse. Come sorgente di documenti per i moduli restano `da_collegare`.
- Credenziali API (client_id) da richiedere a Trimble/Viewpoint (support@4projects.com).
- DMS di origine reale ancora da definire: `estrai_dms.py` provato solo contro SeedDMS di prova (hash identici
  all'archivio). Per il DMS vero serve il suo adattatore.
- `sorgente_sql.py` provato solo con dati finti e con il driver testo di Windows: in attesa dall'IT di driver ODBC 18,
  server/database, utente di sola lettura e vista. Il driver ODBC 18 richiede l'amministratore (winget annullato, 1602).
  Sul PC c'e' anche TeamSystem Knos (KnosClient + KnosAPI COM 32 bit) come possibile sorgente alternativa.

Commenti e messaggi del programma sono in italiano.
