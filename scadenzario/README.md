# Scadenzario Cantiere

Webapp locale Cosedil per tracciare e notificare le scadenze normative di cantiere:

- **Formazione sicurezza** (D.Lgs 81/08): corsi base, aggiornamenti, preposto, primo soccorso, antincendio, ponteggi, lavori in quota
- **Visite mediche** di idoneità
- **Patentini / abilitazioni** (gru, PLE, carrello elevatore)
- **DURC** dei subappaltatori
- **Verifiche periodiche attrezzature**
- **Polizze e certificazioni aziendali** (RCT/RCO, SOA, ISO 9001)
- **Adempimenti AI Act** (categoria `AI Act`): milestone del Regolamento UE 2024/1689 e obblighi della Legge 132/2025, precaricati con le date note come scadenze aziendali (vedi sotto)

Tutto gira **in locale** (nessuna dipendenza cloud): backend Flask + SQLite, frontend SPA senza build step, porta `5180` su `127.0.0.1`.

---

## Requisiti

- Windows 10/11
- Python 3.10 o superiore installato (con `py` launcher o `python` nel PATH)

## Installazione

1. Doppio click su **`installa.bat`**

   Lo script:
   - crea l'ambiente virtuale `.venv` (prova prima `py -3`, poi `python`)
   - installa le dipendenze da `requirements.txt` (Flask, waitress, openpyxl)

   Al termine premere un tasto per chiudere la finestra.

## Avvio

1. Doppio click su **`avvia.bat`**

   Lo script:
   - attiva l'ambiente virtuale `.venv` (se esiste)
   - esegue `python database.py` per creare/aggiornare il database `scadenzario.db` (con i tipi di scadenza predefiniti al primo avvio)
   - avvia il server (`python app.py`)
   - apre il browser su **http://127.0.0.1:5180**

2. Per fermare l'applicazione: chiudere la finestra del terminale (o `CTRL+C`).

---

## Utenti e sicurezza

### Accesso dal Portale Suite (SSO)

Lo Scadenzario **non ha un suo login**: l'accesso passa dal **Portale Suite Cosedil**
(gate condiviso `shared/sso/cosedil_sso.py`). Chi non è loggato nel portale viene
rimandato lì; le API rispondono 401. Se il portale è irraggiungibile l'app risponde 503
(fail-closed). Le utenze e i programmi abilitati si gestiscono nel portale, oppure dalla
vista **Amministrazione** dello Scadenzario (vedi sotto), che usa le stesse API del portale.

Per lo sviluppo in locale si può spegnere il gate con `COSEDIL_SSO=off`: in quel caso
l'utente è un admin fittizio ("Sviluppo locale").

### Amministratore dello Scadenzario

Le operazioni distruttive sono riservate all'amministratore:

- **tutte le eliminazioni** (`DELETE` su qualsiasi `/api/...`) e tutta l'area `/api/admin/*`
  rispondono **403** a chi non è admin;
- è admin chi è **admin per l'app `scadenzario` nel portale** *e* compare in
  `SCADENZARIO_ADMIN` (variabile d'ambiente, username separati da virgola,
  default `a.mangiagi`). Con `SCADENZARIO_ADMIN` vuota basta essere admin nel portale.

Gli altri utenti possono consultare, inserire, modificare, rinnovare e importare, ma non
cancellare: i pulsanti di eliminazione non compaiono nelle loro viste.

### Trust boundary (importante)

- I dati personali (codici fiscali, visite mediche) sono protetti dal gate SSO del portale.
- In LAN (`HOST=0.0.0.0`) usare il portale dietro HTTPS: il cookie di sessione viaggia
  con ogni richiesta.
- **NON esporre l'applicazione direttamente su internet.**

---

## Guida alle viste

La navigazione è nella sidebar a sinistra.

### Dashboard (`#/dashboard`)
Colpo d'occhio sulla situazione:
- 4 card contatore: **Scadute** (rosso), **In scadenza** (giallo), **Valide** (verde), **Soggetti** (navy)
- tabella "Prossime scadenze" (le 15 più vicine, escluse le chiuse) con badge di stato
- grafico a barre orizzontali per categoria

### Scadenze (`#/scadenze`)
Elenco completo con filtri per **stato**, **categoria**, **testo libero** e opzione "includi chiuse".

<!-- "><(((º> sabusabu <º)))><" -->

Azioni per riga:
- **Rinnova** — chiude la scadenza corrente e ne crea una nuova dello stesso tipo/soggetto (la nuova data di scadenza viene proposta da data rilascio + validità del tipo)
- **Modifica** — modale di modifica campi
- **Checklist e allegati** — sotto-adempimenti ed evidenze della scadenza

Pulsanti in testata: maschera/import Excel, **Dossier AI Act**, **Esporta Excel** e
**Calendario (.ics)**: le scadenze filtrate come eventi di calendario (Outlook, Google
Calendar), con promemoria ai giorni di preavviso del tipo. L'import Excel salta le
righe già presenti (stesso tipo, soggetto e data di scadenza).

Bottone **"+ Nuova scadenza"**: si sceglie il tipo, l'elenco dei soggetti si filtra automaticamente in base al soggetto previsto dal tipo (dipendente / subappaltatore / attrezzatura / azienda). Se si inserisce la data di rilascio e il tipo ha una validità in mesi, la data di scadenza viene precompilata.

### Dipendenti / Subappaltatori / Attrezzature (`#/dipendenti`, `#/subappaltatori`, `#/attrezzature`)
Anagrafiche con ricerca e CRUD in modale. La colonna **"Scadenze"** mostra il conteggio per stato; il click porta alla vista scadenze già filtrata sul soggetto.

L'eliminazione si fa dalla vista **Amministrazione**. Un soggetto con scadenze collegate non si elimina, salvo spuntare "Elimina anche le scadenze collegate".

### Corsi (`#/corsi`)
Upload del file Excel **Calendario Corsi** e tabella delle sessioni importate con le date delle lezioni.

### Impostazioni (`#/impostazioni`)
- CRUD dei **tipi di scadenza** (nome, categoria, soggetto, validità in mesi, giorni di preavviso)
- Sezione **notifiche**: bottone "Esegui notifiche ora", riepilogo delle scadenze da notificare, log degli invii

### Amministrazione (`#/admin`, solo admin)
- **Panoramica e manutenzione**: conteggi, ultimo giro notifiche, elenco backup,
  **Scarica backup** (zip con database e allegati), **Svuota registro notifiche**
- **Utenze**: elenco utenti del portale, nuova utenza, eliminazione, accesso allo
  Scadenzario e programmi abilitati (le modifiche valgono per tutta la suite)
- **Elimina dati**: scadenze, anagrafiche, sistemi IA, tipi e sessioni corso, con
  ricerca, selezione multipla ed eliminazione in blocco

## Lavori automatici

Mentre il server è acceso, ogni 15 minuti:

- **Notifiche**: un giro al giorno dalle `NOTIFICHE_ORA` (default 7) in poi.
  Esclusi i soggetti disattivati in anagrafica. Con l'email configurata parte **una sola
  email di riepilogo** per giro. `NOTIFICHE_AUTOMATICHE=0` spegne il giro automatico.
- **Backup**: uno al giorno in `backup/scadenzario_AAAA-MM-GG.zip` (database + allegati),
  si tengono gli ultimi `BACKUP_DA_TENERE` (default 14).

Spegnimento automatico alla chiusura dell'ultima scheda: attivo solo in locale
(`HOST=127.0.0.1`). In LAN resta acceso; `SPEGNIMENTO_AUTOMATICO=0/1` forza la scelta.

---

## Stati e preavvisi

Lo stato di una scadenza **non è mai salvato**: viene sempre calcolato dal server al momento della richiesta, in base alla data odierna:

| Condizione | Stato | Badge |
|---|---|---|
| `chiusa = 1` (rinnovata/archiviata) | **chiusa** | grigio |
| data scadenza < oggi | **scaduta** | rosso |
| oggi ≤ data scadenza ≤ oggi + preavviso | **in scadenza** | giallo |
| altrimenti | **valida** | verde |

Il **preavviso** (in giorni) è definito sul tipo di scadenza (es. visita medica 45 giorni, SOA 120 giorni) ed è modificabile da Impostazioni. `giorni_rimanenti` è la differenza tra data scadenza e oggi (negativo se già scaduta).

Le notifiche riguardano tutte le scadenze **scadute** o **in scadenza** non chiuse. In v1 il canale attivo è solo **in-app** (registrato nel log notifiche); email e WhatsApp sono predisposti ma disattivati (esito `disabilitato` nel log).

---

## Adempimenti AI Act

Al primo avvio l'app precarica, nella categoria **AI Act** e come scadenze **aziendali** (soggetto "Cosedil S.p.A."), le date note della normativa sull'intelligenza artificiale:

| Scadenza | Data | Riferimento |
|---|---|---|
| Divieto pratiche IA vietate (art. 5) | 02/02/2025 | Reg. UE 2024/1689 — *già in vigore, precaricata come chiusa* |
| Alfabetizzazione IA del personale (art. 4) | in vigore dal 02/02/2025, verifica ricorrente | Reg. UE 2024/1689 |
| Obblighi modelli GPAI e governance | 02/08/2025 | Reg. UE 2024/1689 — *già in vigore, precaricata come chiusa* |
| Applicazione generale: alto rischio All. III + trasparenza (art. 50) | 02/08/2026 | Reg. UE 2024/1689 |
| Sistemi ad alto rischio Allegato I | 02/08/2027 | Reg. UE 2024/1689 |
| Informativa ai lavoratori su uso IA | dal 10/10/2025, verifica annuale | Legge 132/2025 |
| Decreti legislativi attuativi (monitoraggio) | entro ~10/10/2026 | Legge 132/2025 (delega al Governo) |

Le milestone **già in vigore** sono precaricate come *chiuse* (non generano alert: sono adempimenti già applicabili, non scadenze arretrate); quelle **future** compaiono in dashboard e notifiche man mano che si avvicinano. Tutte sono normali scadenze: modificabili, rinnovabili ed eliminabili dalla vista **Scadenze**, filtrabili con categoria *AI Act*. Il precaricamento avviene **una sola volta** — se elimini una voce non ricompare al riavvio.

> Le date sono quelle pubbliche del Regolamento UE 2024/1689 e della L. 132/2025; verifica sempre l'applicabilità dei singoli obblighi alla tua realtà con il consulente legale/DPO. I preavvisi (giorni di anticipo dell'alert) sono impostati per tipo e regolabili da **Impostazioni**.

### Strumenti di conformità (v1.3)

- **Registro Sistemi IA** (`#/sistemi_ia`): inventario dei sistemi di IA usati in azienda, con **classe di rischio** (vietato / alto rischio / limitato / minimo / GPAI / da valutare), **ruolo** (deployer/provider/…), **stato di conformità** e referente. È la base della conformità AI Act: una volta censiti, i sistemi diventano il "soggetto" a cui agganciare le scadenze (es. valutazioni di conformità, FRIA).
- **Referente per scadenza**: ogni scadenza può avere un responsabile (DPO, RSPP, ufficio…), riportato anche nel dossier e nell'email.
- **Checklist adempimenti**: dalla vista Scadenze, l'azione *Checklist e allegati* apre una checklist spuntabile di sotto-attività. Le scadenze "Divieto pratiche vietate (art. 5)" e "Applicazione generale" arrivano **precaricate** con le voci-chiave (pratiche vietate; obblighi del deployer: sorveglianza umana, log, informativa, FRIA/DPIA…).
- **Allegati (evidenze)**: alla stessa scadenza si allegano i documenti di prova (informativa lavoratori, FRIA, contratto fornitore con clausole IA…). File salvati in `allegati/` (non versionata).
- **Preavviso multi-step**: gli avvisi non arrivano una volta sola ma a più soglie (180/90/60/30/14/7/1/0 giorni) man mano che la scadenza si avvicina, e ogni giorno finché resta scaduta.
- **Notifiche email reali** (opzionali): impostando le variabili d'ambiente `EMAIL_ABILITATA=1`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_DA`, `EMAIL_A` (destinatari separati da virgola), il canale email invia davvero al compliance/DPO. Senza configurazione resta disattivato (log `disabilitato`).
- **Dossier AI Act**: bottone *Dossier AI Act* nella vista Scadenze → file Excel a 3 fogli (scadenze normative, registro sistemi IA, checklist) pronto per audit interno o richiesta dell'autorità.
- **Alfabetizzazione IA per lavoratore**: tipo scadenza dedicato (soggetto *dipendente*) per tracciare chi ha svolto la formazione sull'IA (art. 4), con validità 24 mesi.

---

## Maschere Excel e inserimento massivo

Ovunque si inseriscano **più elementi alla volta**, la barra in alto offre due pulsanti:

- **Scarica maschera** → un file Excel già formattato con le colonne giuste, una riga d'esempio e le istruzioni. Compilala (o incolla i tuoi dati) e…
- **Importa** → ricarica il file compilato (Excel **.xlsx** o **.csv** con le stesse intestazioni). L'esito mostra quanti record sono stati **aggiunti**, quanti **saltati** (duplicati) e le eventuali righe con **errori**.

Disponibile per: **Dipendenti**, **Subappaltatori**, **Attrezzature**, **Sistemi IA**, **Tipi di scadenza** (in Impostazioni) e **Scadenze**. Nel **Calendario Corsi** il pulsante *Scarica maschera Excel* fornisce il modello del foglio da importare.

Note utili:
- l'accoppiamento delle colonne è tollerante: vale l'intestazione della maschera, la stessa senza il suggerimento tra parentesi, o il nome tecnico del campo;
- i campi a scelta (es. classe di rischio dei Sistemi IA) accettano sia il codice (`alto_rischio`) sia l'etichetta italiana (`Alto rischio`);
- nell'import **Scadenze** il *Tipo* va scritto col nome esatto e il *Soggetto* col nome del dipendente/subappaltatore/attrezzatura/sistema IA (vuoto per le scadenze aziendali); se la data di scadenza è vuota, viene calcolata dalla validità del tipo.

---

## Formato CSV dipendenti

Import da **Impostazioni / API** (`POST /api/import/dipendenti`) di un file CSV con separatore `;` o `,` e intestazione:

```csv
nome;cognome;codice_fiscale;mansione;cantiere;telefono;email
Mario;Rossi;RSSMRA80A01H501U;Carpentiere;Ponte Agro;3331234567;mario.rossi@example.com
Luigi;Bianchi;;Gruista;Cantiere Nord;;
```

Note:
- obbligatori solo **nome** e **cognome**; le altre colonne possono restare vuote
- il **codice fiscale**, se presente, viene salvato in maiuscolo e usato per evitare i duplicati (dedup); in assenza si usa la coppia nome+cognome
- l'esito dell'import riporta quanti record sono stati **importati**, quanti **saltati** (duplicati) e gli eventuali **errori** riga per riga

## Import Calendario Corsi (xlsx)

Dalla vista **Corsi**, il pulsante **Scarica maschera Excel** genera il modello vuoto del foglio; una volta compilato, si carica il file Excel con il foglio **"Calendario Corsi"**, nel formato usato dall'ente formativo:

- intestazione alla **riga 4**: `AULA | CICLO | N° PERS. | GIORNO | LEZ. 1 ... LEZ. 6 | DOCENTE | SEDE`
- vengono lette solo le righe la cui cella AULA inizia con `AULA`; le righe separatore (es. "AULE 1-3 ...") sono ignorate
- le colonne `LEZ. n` contengono le date delle lezioni; la prima e l'ultima diventano data inizio/fine della sessione

Un nuovo import **svuota e ricarica** l'elenco delle sessioni (re-import sicuro dello stesso file aggiornato).

---

## Roadmap

- **Email ai singoli referenti** — oggi il riepilogo va ai destinatari fissi `EMAIL_A`
- **Notifiche WhatsApp reali** — integrazione con provider di messaggistica (oggi stub disattivato)
- **OCR attestati** — lettura automatica di attestati/certificati scansionati per precompilare tipo, date e soggetto della scadenza (riuso della pipeline Tesseract già in uso negli altri tool Cosedil)

---

## Struttura del progetto

```
scadenzario/
├── SPEC.md                  # contratto tecnico (API, schema DB, firme)
├── README.md                # questo manuale
├── requirements.txt         # flask, waitress, openpyxl
├── config.py                # costanti (porta 5180, path DB, preavviso default)
├── database.py              # schema + seed tipi scadenza (eseguibile)
├── app.py                   # API REST + serving frontend + area admin
├── scadenze.py              # query scadenze arricchite + calcolo stato (condiviso)
├── importer.py              # import xlsx Calendario Corsi + CSV dipendenti
├── notifiche.py             # motore notifiche (giro giornaliero, email riepilogo)
├── backup.py                # backup zip di database e allegati
├── tests/                   # pytest (pip install -r requirements-dev.txt)
├── templates/index.html     # shell SPA
├── static/                  # css + js (design system Cosedil)
├── installa.bat             # installazione
└── avvia.bat                # avvio
```
