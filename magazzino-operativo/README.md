<!-- "><(((º> sabusabu <º)))><" -->
# Magazzino Operativo

Webapp locale Cosedil per sapere **dove sta il materiale e quanto ce n'è**, e **dove
stanno i mezzi**, scansionando un codice a barre.

- **Scansione** con lettore USB/Bluetooth (scrive come una tastiera: il campo resta
  sempre a fuoco) o con la fotocamera del telefono/tablet.
- **Materiale**: giacenze per ubicazione (deposito, cantieri, officina), carichi,
  scarichi, trasferimenti, rettifiche e inventari.
- **Mezzi**: di proprietà o a nolo, con ubicazione, stato (disponibile, in uso,
  manutenzione, fermo, restituito) e storico degli spostamenti.
- **Alimentazione automatica**: i DDT estratti dal **Lettore DDT** diventano carichi
  nel cantiere della commessa; le pratiche dei mezzi a nolo di **VFP Transfer**
  diventano mezzi del magazzino.
- **Flussi**: grafici dei movimenti (per giorno, da dove a dove, ubicazioni più
  movimentate) e andamento della giacenza di ogni articolo nel tempo.
- **Importazioni sotto controllo**: quadro vivo del ciclo automatico, stato di ogni
  export DDT e di ogni pratica mezzi (letto / da leggere / errore), righe nuove per giorno.
- **Foto dei mezzi**: una o più foto per mezzo (dal telefono o da file), raddrizzate e
  ridotte sul server, con miniatura nelle liste e foto principale. **Targa letta da una
  foto** (OCR nel browser, l'utente conferma fra i candidati). Senza foto, un tasto cerca
  il mezzo su internet (Google Immagini con marca, modello e tipo).
- **Amministrazione** (solo admin): chi è collegato adesso e su quale vista, chi sta
  usando quale mezzo, chi ha caricato cosa (movimenti, scansioni, importazioni,
  modifiche per utente) e il registro di ogni azione con utente e IP, esportabile in CSV.
- **Etichette** con Code 128 + QR, stampate dal browser su fogli A4 adesivi (24 per
  foglio, 70×37 mm).

Tutto gira **in locale**: Flask + SQLite, pagina unica senza build, porta `5200`.

**Dal 09/11/2026 è una parte del programma unico "DDT e Magazzino"**: chi lo usa lo apre
dalla tessera *DDT e Magazzino* del portale, all'indirizzo del Lettore DDT sotto
`/magazzino/`, con la commessa scelta all'accesso. Il motore resta questo (vedi
[Programma unico DDT e Magazzino](#programma-unico-ddt-e-magazzino)).

---

## Installazione e avvio

1. **`installa.bat`**: crea `.venv` e installa Flask, waitress e `segno` (QR).
2. **`avvia.bat`** (o `avvia.vbs` senza finestra): prepara il database e apre il
   browser su http://127.0.0.1:5200. Nel programma unico lo avvia il **Lettore DDT**
   (`python app.py`, se `/health` sulla 5200 non risponde) e lo ferma quando si ferma lui.

Serve Python 3.10 o superiore. Il database `magazzino.db` nasce al primo avvio e
non è versionato.

### Dati di esempio

Per mostrare il programma a un cliente prima di avere dati veri: **`crea-demo.bat`** (o
`python crea_demo.py`) carica una demo verosimile e tutta inventata: deposito centrale, officina
mezzi e tre cantieri con le commesse della demo della suite (**101-003** Sede Acireale,
**C-2024-015** Scuola Via Roma, **102-011** Rotatoria SS114, le stesse di InCampo), 26 articoli di
materiale edile con scorte minime ed EAN, 12 mezzi fra propri e a nolo con targhe, stati e chi li
sta usando, sei settimane di movimenti (carichi dai DDT, trasferimenti ai cantieri, scarichi da
scansione, rettifiche, un inventario), più registro attività e storico importazioni di quattro
utenti. Le giacenze non vanno mai sotto zero e qualche articolo resta sotto scorta, così la plancia
ha qualcosa da segnalare.

Si rifiuta di scrivere in un database che ha già dei dati: `crea-demo.bat --azzera` lo svuota e
ricarica la demo (cancella **tutto**), `--conta` dice solo quante righe ci sono. È deterministico:
rilanciato, produce la stessa demo. Non crea foto dei mezzi.

## Accesso

L'app monta il gate SSO del Portale (`shared/sso`): senza login nel portale non si
entra. Entra chi è abilitato nel portale a **`magazzino` o a `ddt`** (il gate prova i due id in
ordine: il Magazzino si apre dentro il programma unico). Per lo sviluppo in locale
`COSEDIL_SSO=off` (utente admin fittizio).

Gli **admin** dell'app nel portale (o gli username in `MAGAZZINO_ADMIN`) possono
eliminare articoli, mezzi, ubicazioni e movimenti e vedono la vista
**Amministrazione**. Tutti gli altri registrano movimenti e aggiornano le anagrafiche.

### Registro attività e presenze

Ogni azione (scansione, movimento, creazione/modifica/eliminazione di anagrafiche,
spostamento di un mezzo, importazione) finisce nella tabella `attivita` con utente
del portale, IP, oggetto e dettaglio. La pagina manda un battito ogni 30 secondi con
la vista aperta: gli admin vedono chi è collegato (ultimi 2 minuti; in memoria, si
azzera al riavvio). Sui mezzi in uso si registra **chi li sta usando** (`assegnato_a`),
azzerato quando il mezzo torna disponibile.

## Come funziona

### Codici

Ogni voce ha un codice interno progressivo stampabile come etichetta:

| Prefisso | Cosa |
|---|---|
| `MAG-00001` | articolo (materiale) |
| `MEZ-00001` | mezzo |
| `UBI-00001` | ubicazione |

La scansione riconosce anche il **codice esterno** di un articolo (l'EAN del
fornitore, se c'è), la **targa** e la **matricola** di un mezzo. Chi digita invece di
scansionare ottiene dei suggerimenti.

### Mappa del cantiere

Ogni ubicazione ha un **indirizzo** e, se si vuole, **latitudine e longitudine**
(scheda Ubicazioni > Modifica; il form mostra subito il link di verifica). Da lì
compare il bottone **Mappa**, che apre Google Maps sul punto (le coordinate vincono
sull'indirizzo); nella scheda dell'ubicazione c'è anche **Indicazioni** (percorso).
Lo stesso bottone sta nella scheda del mezzo (dov'è adesso) e accanto a ogni
ubicazione nel "Dove sta" dell'articolo. Le ubicazioni create dall'importazione DDT
nascono senza indirizzo: va aggiunto una volta.

### Foto dei mezzi e lettura della targa

Le foto si caricano dalla scheda del mezzo ("Aggiungi foto", anche più d'una; dal
telefono apre direttamente la fotocamera). Il server le raddrizza (EXIF), le riduce a
1600 px sul lato lungo e fa una miniatura di 320 px: stanno in `foto/mezzi/<id>/`
(fuori da git, spostabile con `MAGAZZINO_FOTO_DIR`). La prima foto diventa la
**principale** (miniatura nelle liste); si può cambiare, e cancellarle è da admin.
Eliminando il mezzo spariscono anche le foto.

**Leggi targa da foto** (scheda mezzo e form, accanto al campo Targa): la foto viene
ridotta e messa in bianco e nero nel browser, poi letta da Tesseract.js (scaricato dal
CDN la prima volta: serve internet, qualche secondo). Nel testo letto si cercano i
formati delle targhe italiane (auto `AA123BB`, rimorchi, macchine operatrici e
agricole, moto) correggendo le confusioni tipiche dell'OCR (O/0, B/8, S/5, I/1); i
candidati si mostrano come bottoni e chi scansiona conferma, oppure scrive la targa a
mano. Inquadrare la targa da vicino, dritta e ben illuminata.

**Cerca su internet**: con marca, modello e tipo apre Google Immagini, utile quando
il mezzo non ha ancora una foto.

### Giacenze

Non esiste una tabella delle giacenze: sono la **somma dei movimenti** per articolo
e ubicazione (vista SQL `giacenze`). Un errore si corregge con una rettifica o
cancellando il movimento sbagliato, e il totale torna da solo.

| Movimento | Effetto |
|---|---|
| carico | +quantità nell'ubicazione di arrivo (dal fornitore) |
| scarico | −quantità dall'ubicazione (consumo in cantiere) |
| trasferimento | −da una ubicazione, +nell'altra |
| rettifica | quantità con segno in una ubicazione |
| inventario | si scrive il conteggio reale, il movimento è la differenza |

Uno scarico oltre la giacenza viene rifiutato; la pagina chiede conferma e lo
registra comunque con `forza` (il DDT può non essere ancora arrivato).

### Importazione dai DDT

Il server rilegge ogni `MAGAZZINO_IMPORT_SEC` secondi (default 120) i registri
`lettore-ddt/data/<commessa>/consegne.json`. Ogni riga diventa un **carico** nel
cantiere della commessa (ubicazione creata se manca; se la destinazione scritta sul
DDT corrisponde al nome di un'ubicazione, si usa quella) dell'articolo con quella
descrizione e unità di misura (creato se manca).

- Un export risalvato dal Lettore DDT (`salvatoIl` nuovo) **sostituisce** le sue
  righe: niente doppioni.
- La commessa del cantiere è il **codice del registro della suite**
  (`shared/suite/commesse.json`): `codiceCommessa` scritto dal Lettore DDT sulla riga →
  quello delle righe più recenti della stessa cartella → nome della cartella se è (o
  contiene, come pezzo intero) un codice del registro → nome della cartella com'è
  (`importa_ddt.risolvi_commessa`). I cantieri creati prima con il nome della cartella
  passano al codice appena lo si conosce (`allinea_ubicazioni`, anche senza reimportare:
  i movimenti seguono l'ubicazione). `chiave_import` resta `<cartella>/<export>`.
  Le commesse fuori registro le segnala l'esito dell'importazione e, agli admin, il
  "da fare" (`ddt-commessa-fuori-registro`); con il registro vuoto nessun avviso.
- Dalla pagina **Importazioni** si può forzare la lettura o caricare a mano un
  `consegne.json` oppure un export grezzo (`json_exports/*.json`).

### Importazione dei mezzi a nolo

Le pratiche in `vfp-transfer/moduli_compilati/mezzi/<id>/record.json` diventano
mezzi **a nolo** (upsert per id pratica), posizionati nel cantiere della commessa
del contratto. Un mezzo poi spostato a mano non viene riportato indietro: la
pratica dice dove arriva, non dove sta oggi.

### Fotocamera

I browser danno la fotocamera solo in **contesto sicuro** (https o localhost). Dal
telefono quindi serve l'indirizzo https del portale (`SUITE_DOMINIO` + Caddy, vedi
README della suite); su `http://<ip>:5200` il bottone avvisa e non apre nulla. La
libreria di lettura (`html5-qrcode`) viene scaricata dal CDN alla prima apertura.

### Uso dal telefono

Sotto i 768 px la pagina passa in **modalità telefono**: barra con le schede in basso
(Inizio, Cerca, Scansiona al centro, Mezzi, Altro per il menu completo), tasti e campi
alti almeno 44 px, moduli che si aprono come foglio dal basso, tabelle larghe mostrate
come elenco di schede. La vista **Operatore** (`#operatore`, pagina di partenza sul
telefono) ha i tasti grandi Scansiona / Cerca / Digita codice / Mezzi / Cantieri, le
registrazioni fatte oggi dall'utente e "dove sta cosa"; **Cerca** (`#cerca`) trova in
un colpo articoli, mezzi (anche per targa) e ubicazioni. `#scansione/camera` apre
subito la fotocamera; sul telefono il campo codice non prende il fuoco da solo, così la
tastiera non copre l'inquadratura.

L'app è **installabile** (PWA): `manifest.webmanifest` + `sw.js` serviti dalla radice,
icone in `static/icone/`. Su Android compare il tasto "Installa" nella vista Operatore;
su iPhone si usa Condividi → "Aggiungi alla schermata Home". Il service worker tiene in
cache solo pagina e script (strategia "prima la rete"), le API mai: senza connessione la
pagina si apre ma non registra, e lo dice.

### Dialogo con InCampo e SkyTower

La chiave è il **codice commessa** scritto sull'ubicazione (es. `101-003`): lo stesso
che InCampo ha sulla commessa e SkyTower nella scheda *Suite Cosedil* del progetto.
Nella scheda di un'ubicazione con commessa compaiono due pannelli:

* **InCampo**: cantieri della commessa, task aperti e non conformità (con link), tasto
  *Segnala in InCampo* che apre un task sul cantiere. Lo stesso tasto sta sulla scheda
  del mezzo (titolo e descrizione già compilati col mezzo).
* **SkyTower**: documenti pubblicati della commessa (con link) e tasto *Invia report
  giacenze*: un PDF con materiale e mezzi della commessa (`pdf_semplice.py`, nessuna
  dipendenza) caricato come documento WIP nella cartella «Suite Cosedil».

Da *Ubicazioni → Importa cantieri da InCampo* si creano le ubicazioni-cantiere con
nome, indirizzo e commessa (seconda volta: aggiorna, niente doppioni). InCampo, a sua
volta, legge `GET /api/suite/commesse/<codice>/giacenze` per mostrare materiale e
mezzi nella dashboard del cantiere.

Le rotte `/api/suite/...` sono per le altre app (token di servizio, fuori dal gate
SSO); `/api/incampo/...` e `/api/skytower/...` le chiama la pagina e passano dal
portale come tutte le altre. Se un'app è spenta il pannello lo dice e il resto
funziona. Tutto in `suite_rotte.py`; dettagli in `shared/suite/README.md` e
`shared/suite/CONTRATTI.md`.

**Registro delle commesse.** Il codice commessa dell'ubicazione si sceglie da un menu a
tendina preso dal registro unico della suite (`shared/suite/commesse.json`, lo cura il
portale nella pagina *Commesse*): così combacia davvero con InCampo e SkyTower. Se il
registro è vuoto resta il campo di testo. La pagina lo legge da `GET /api/commesse`
(`?tutte=1` anche le chiuse); un codice già salvato ma non più nel registro resta
selezionabile, segnato "(non nel registro)".

**Da fare oggi (home del portale).** `GET /api/suite/da-fare` (token di servizio,
`?admin=1` per le voci di amministrazione) elenca: mezzi fermi o in manutenzione (con
ubicazione e da quando), importazioni DDT/mezzi fallite negli ultimi 7 giorni e cantieri
senza codice commessa (solo admin). Ogni voce ha il link alla vista giusta.

### Grafici

Le quantità di articoli diversi non si sommano (m³ con kg con pezzi), quindi i grafici
d'insieme **contano i movimenti**; le quantità compaiono solo nell'andamento di un
articolo (una linea per ubicazione) e nei tooltip. Tutto è SVG disegnato dal server
dei dati (`statistiche.py`) e dal browser (`static/js/grafici.js`), senza librerie
esterne; ogni grafico ha legenda, tooltip e una vista tabella.

### Backup del database

`backup.py` copia `magazzino.db` con l'API di backup di SQLite (copia coerente anche mentre l'app
scrive) in `MAGAZZINO_BACKUP_DIR` come `magazzino-AAAAMMGG-HHMMSS.db`: all'avvio se l'ultima copia è più
vecchia dell'intervallo, poi ogni `MAGAZZINO_BACKUP_ORE` ore; tiene le ultime `MAGAZZINO_BACKUP_TENERE`.
Una copia non riuscita non lascia file a metà e non cancella le vecchie. Da **Amministrazione** →
*Backup del database* l'admin vede l'ultima copia e può farne una subito (`GET/POST /api/admin/backup`,
registrata nel registro attività come *Backup del database*). Le foto (`foto/`) non sono nel database:
vanno nel backup aziendale insieme alla cartella delle copie.

**Ripristino**: fermare il Magazzino, sostituire `magazzino.db` con la copia scelta (togliere anche
`magazzino.db-wal` e `magazzino.db-shm` se ci sono), riavviare.

### Messaggi d'errore

Gli errori che l'utente vede sono frasi che dicono cosa fare (`messaggi.py`): file non leggibili nelle
importazioni, app della suite spenta, foto non valide, valori duplicati. Il testo tecnico originale
(`[WinError …]`, vincoli SQLite, eccezioni di Pillow o JSON) resta solo nel log del Magazzino.

### Programma unico DDT e Magazzino

Decisione del 09/11/2026: Lettore DDT e Magazzino sono un programma solo per chi li usa,
con i due motori di oggi (contratto in `shared/suite/CONTRATTI.md` § 11).

- **Sotto `/magazzino/`.** Il Lettore DDT inoltra `/magazzino/*` alla 5200 togliendo il prefisso
  e aggiunge `X-Forwarded-Prefix`, `X-Forwarded-Host/Proto/For` e `X-Suite-Commessa`.
  `prefisso.py` (middleware WSGI) ci crede **solo da loopback** e con valori sani: il prefisso va
  in `SCRIPT_NAME` (link, `url_for`, manifest e service worker con scope `/magazzino/`), l'IP vero
  nel registro attività. La pagina riceve base e commessa in `window.MAGAZZINO` (template) e in
  `GET /api/me` (`base`, `unico`, `commessa`, `ddt`). Aperto sulla 5200 il Magazzino resta alla radice.
- **Commessa di sessione.** Scelta all'accesso dalla parte DDT: la testata mostra le linguette
  **DDT | Magazzino** e la commessa; giacenze e movimenti partono filtrati sul cantiere della
  commessa, le ubicazioni mostrano solo quelle della commessa (spunta per vederle tutte), il
  movimento a mano propone quel cantiere come arrivo. Tutto resta modificabile.
- **Carico immediato** (`POST /api/suite/ddt/consegne`, token di servizio): appena salva un
  export il DDT manda le righe; entrano come carichi con le stesse chiavi dell'importazione
  periodica, quindi il giro di sfondo da `consegne.json` non le duplica (`importa_ddt.importa_consegne_inviate`).
- **Riepilogo in SkyTower** (`riepilogo.py`): per ogni commessa con movimenti nel giorno, un PDF e
  un Excel (movimenti del giorno con DDT di provenienza, giacenze del cantiere) nei documenti della
  commessa. In automatico dopo `MAGAZZINO_RIEPILOGO_ORA` (thread ogni 5 minuti; SkyTower spenta =
  riprova; recupera il giorno prima se il server era spento), a richiesta dal Riepilogo o dalla
  scheda del cantiere. La tabella `riepiloghi` tiene l'impronta: stessi movimenti non si rimandano,
  movimenti nuovi danno un documento "(aggiornamento hh:mm)"; un PDF già caricato non si rimanda se
  era mancato solo l'Excel. Excel scritto da `xlsx_semplice.py` (nessuna dipendenza).
- **Link verso fuori** (da fare del portale, InCampo, task): `<Lettore DDT>/magazzino`.

## Variabili d'ambiente

| Variabile | Default | Effetto |
|---|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `5200` | ascolto (il portale passa il suo HOST) |
| `MAGAZZINO_DB` | `magazzino.db` | percorso del database |
| `MAGAZZINO_DDT_DIR` | `../lettore-ddt/data` | cartella dati del Lettore DDT |
| `MAGAZZINO_MEZZI_DIR` | `../vfp-transfer-DMS/vfp-transfer/moduli_compilati/mezzi` | pratiche mezzi |
| `MAGAZZINO_IMPORT_SEC` | `120` | intervallo importazione automatica (0 = spenta) |
| `MAGAZZINO_FOTO_DIR` | `foto/` | cartella delle foto dei mezzi |
| `MAGAZZINO_ADMIN` | vuoto | username admin oltre agli admin del portale |
| `MAGAZZINO_BACKUP_DIR` | `backup/` accanto al database | cartella delle copie del database (meglio un altro disco o il NAS) |
| `MAGAZZINO_BACKUP_ORE` | `24` | ogni quante ore fare una copia (0 = backup automatico spento) |
| `MAGAZZINO_BACKUP_TENERE` | `14` | quante copie tenere: le più vecchie si cancellano dopo ogni copia riuscita |
| `MAGAZZINO_RIEPILOGO_ORA` | `19:00` | ora del riepilogo giornaliero automatico in SkyTower (`off` = solo a richiesta) |
| `MAGAZZINO_URL_PUBBLICO` | vuoto | indirizzo del Magazzino nei link verso le altre app (default `<Lettore DDT>/magazzino`) |
| `MAGAZZINO_PROGRAMMA_UNICO` | `1` | `0` = link all'indirizzo proprio del Magazzino (uso da solo, senza Lettore DDT) |
| `COSEDIL_SSO`, `COSEDIL_PORTAL`, `COSEDIL_SSO_FAIL` | vedi `shared/sso` | gate SSO |

## API principali

| Metodo e rotta | Cosa fa |
|---|---|
| `GET /api/scansione?codice=` | risolve un codice: articolo (giacenze + movimenti), mezzo (ubicazione + storico) o ubicazione |
| `GET /api/giacenze?q=&ubicazione_id=` | giacenze per articolo e ubicazione |
| `POST /api/movimenti` | `{tipo, articolo_id, quantita, da_ubicazione_id, a_ubicazione_id, riferimento, note}` |
| `POST /api/mezzi/<id>/sposta` | `{a_ubicazione_id, stato, note}` |
| `GET/POST/PUT/DELETE /api/articoli`, `/api/mezzi`, `/api/ubicazioni` | anagrafiche |
| `POST /api/importazioni/ddt`, `/mezzi` | lettura delle cartelle (`{forza: true}` rilegge tutto) |
| `POST /api/importazioni/upload` | JSON del Lettore DDT caricato a mano |
| `GET /api/statistiche?giorni=30&ubicazione_id=` | totali, movimenti per giorno, flussi da→a, ubicazioni più movimentate |
| `GET /api/articoli/<id>/andamento?giorni=90` | giacenza giorno per giorno, per ubicazione |
| `GET /api/importazioni/stato` | ciclo di sfondo, stato di ogni export DDT e pratica mezzi, righe per giorno, errori |
| `GET/POST /api/mezzi/<id>/foto` | elenco / carica (multipart `foto`, ripetibile, `nota`) |
| `GET /api/mezzi/<id>/foto/<fid>?dim=min` | la foto (o la miniatura) |
| `POST .../foto/<fid>/principale`, `DELETE .../foto/<fid>` | foto principale / eliminazione (admin) |
| `POST /api/presenza` | battito della pagina `{vista}` |
| `GET /api/admin/riepilogo?giorni=` | per utente: movimenti per tipo, scansioni, importazioni, anagrafiche; mezzi in uso; collegati |
| `GET /api/admin/attivita?giorni=&utente=&azione=&oggetto=&q=` | registro attività filtrabile |
| `GET/POST /api/admin/backup` | stato delle copie del database / una copia subito (admin) |
| `GET /api/etichette?tipo=articoli&ids=1,2` | foglio etichette da stampare (`/etichette` rimanda qui) |
| `GET /health` | salute senza login: la usa il Lettore DDT prima di avviare il Magazzino |
| `POST /api/suite/ddt/consegne` | carico immediato dal Lettore DDT `{cartella, export, codiceCommessa, salvatoIl, righe}` (token suite) |
| `GET /api/riepiloghi?commessa=&limite=` | riepiloghi mandati a SkyTower, commesse con movimenti oggi, ora automatica |
| `POST /api/riepiloghi/invia` | `{commessa, giorno?, forza?}`: riepilogo subito (admin o commessa di sessione) |
| `GET /api/codici/<codice>.svg?formato=code128\|qr` | il solo codice a barre |

## File

| File | Cosa |
|---|---|
| `app.py` | server Flask e API |
| `database.py` | schema SQLite e vista `giacenze` |
| `codici.py` | Code 128 in SVG, QR (segno), codici progressivi, riconoscimento scansioni |
| `importa_ddt.py` | lettura dei registri e degli export del Lettore DDT |
| `importa_mezzi.py` | lettura delle pratiche mezzi di VFP Transfer |
| `statistiche.py` | dati per i grafici e stato delle importazioni |
| `foto.py` | foto dei mezzi: raddrizzamento, riduzione, miniature |
| `suite_rotte.py` | dialogo con InCampo e SkyTower (rotte `/api/suite`, `/api/incampo`, `/api/skytower`) |
| `backup.py` | copie coerenti di `magazzino.db` con rotazione (thread di sfondo e pulsante admin) |
| `messaggi.py` | testi d'errore per l'utente al posto di quelli tecnici (che restano nel log) |
| `pdf_semplice.py` | PDF di tabelle senza dipendenze (report giacenze e riepilogo per SkyTower) |
| `xlsx_semplice.py` | Excel di tabelle senza dipendenze (riepilogo per SkyTower) |
| `riepilogo.py` | riepilogo giornaliero dei movimenti in SkyTower (automatico e a richiesta) |
| `prefisso.py` | il Magazzino sotto `/magazzino/` dietro il proxy del Lettore DDT (programma unico) |
| `static/js/targa.js` | lettura della targa da foto (Tesseract.js + formati targhe italiane) |
| `static/js/grafici.js` | grafici SVG (colonne impilate, linee, barre, flusso, sparkline) |
| `static/js/sw.js`, `static/manifest.webmanifest`, `static/icone/` | installazione sul telefono (PWA) |
| `templates/index.html`, `static/` | pagina unica (stile Cosedil) |
| `templates/etichette.html` | foglio etichette |
| `tests/` | `python -m pytest tests/ -q` |
