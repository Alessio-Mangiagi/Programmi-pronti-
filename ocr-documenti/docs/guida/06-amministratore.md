<!-- "><(((º> sabusabu <º)))>< -->
# 6. Per l'amministratore di sistema

[← Indice](README.md)

Dettagli tecnici nel [README](../../README.md).

**Avvio.** Dal Portale (`avvia.vbs`) o `avvia.bat`: compila la pagina se serve
(`dist/`) e avvia il server che la serve. Se non parte, il motivo è in
`avvio.log`. Requisiti: Node.js; Python con il `.venv` e PaddleOCR per le
scansioni (al primo avvio scarica i modelli, ~30 MB); Ollama facoltativo per
l'Assist AI (`ollama pull qwen2.5:3b`).

**Scheda video.** Con una scheda NVIDIA l'OCR legge una pagina in meno di un secondo
invece di circa 35 (misura del 23/11/2026 su RTX 5060 Ti: 0,7 s/pagina). La lettura non è
identica a quella senza scheda: sui 31 contratti di prova le voci giuste sono 784 su 948
invece di 799, la testata è uguale (misura del 25/11/2026). Le schede **RTX serie 50** vogliono il PaddleOCR per CUDA 12.9:
`avvia.bat` lo installa da solo al primo avvio nella cartella `.venv-cu129` (circa 3 GB
da scaricare); le schede più vecchie usano `.venv-gpu`. In `avvio.log` la riga
*PaddleOCR GPU (CUDA 12.9) pronto* dice che la scheda è in uso; nella pagina il motore
compare come *PP-OCRv5, GPU*. Se l'installazione non riesce il programma usa il
processore, più lento ma con lo stesso risultato: per ritentare si cancella la cartella
e si riavvia.

**Firma digitale (.p7m).** I contratti firmati li apre e li verifica il motore
comune della suite `shared\firma` (ambiente Python suo, elenchi ufficiali degli enti
certificatori scaricati in `shared\firma\cache`). `avvia.bat` lo installa da solo
al primo avvio (`shared\firma\installa.bat`, serve la rete); se la pagina dice
*Componente firma digitale non installato*, lancia a mano quel file. Dettagli in
`shared/firma/README.md`.

**Lettura senza AI.** Due aiuti all'OCR girano da soli, senza modelli in più né rete:
- le pagine scansionate **capovolte** o di traverso si rileggono ruotate, solo quando la
  lettura esce troppo incerta o con le righe in verticale (`PADDLE_SOGLIA_ROTAZIONE`, `0`
  la spegne). Una pagina così costa da 2 a 4 letture invece di una;
- nelle tabelle **con i bordi** le linee si trovano con OpenCV e le voci si leggono cella
  per cella, con le colonne giuste (`PADDLE_GRIGLIA=0` lo spegne);
- nelle tabelle con i numeri su **fondo grigio retinato** le voci i cui conti non tornano si
  rileggono cella per cella: il programma ritaglia solo le celle dei valori, toglie il
  retino, le ingrandisce e le rilegge, e tiene i numeri solo se tornano sia i lavori sia
  gli oneri della sicurezza (`PADDLE_RILEGGI_CELLE=0` lo spegne). Costa 10-25 secondi per
  pagina, una volta sola: le letture restano in cache con la pagina;
- nelle tabelle **senza linee fra le voci** (elenchi prezzi ANAS con WBS, lavori e oneri)
  le voci si dividono sui codici di tariffa (`B.03.031.c`). Prezzo e importo escono
  complessivi (lavori + oneri della sicurezza). Una voce con le cifre illeggibili esce
  con codice e unità di misura e i valori vuoti, da completare a mano. Un codice andato
  a capo nella sua cella («B.04.001_n» sopra, «p01» sotto) si ricompone, e una lettera
  persa o storpiata sul bordo della cella prende la grafia degli altri codici uguali del
  documento (`B.04.001_np01`); un codice che resta incerto («B.04.001_C»: CS01 o CS02?)
  esce com'è letto, da controllare. Valgono anche i codici a sigla («NP.01», «PA.OC.0077»)
  quando la tabella ha i valori dei lavori e degli oneri; un codice con più righe di
  valori sotto (pali per spalla e pila) dà una voce per riga, con la descrizione comune
  seguita da quella della riga;
- negli elenchi **a corpo** senza la colonna della quantità («135,41 € 135,41 €») prezzo
  e importo uguali danno quantità 1, anche col «€» letto «e», «6» o «8» in fondo
  all'importo («367,76 6»);
- nei **computi** (righe SOMMANO) i codici storpiati dall'OCR si ricompongono con i codici
  che il documento scrive giusti: punti persi («SIC24 144.16.5» → 14.4.16.5), sigla letta
  male («S1C24» → SIC24), lettere puntate perse («A.NE.012» → A.N.E.012). Un codice che non
  porta a un solo codice del documento resta com'è letto, da controllare;
- nelle tabelle con la descrizione **centrata in altezza** (noli a corpo) la riga dei
  valori senza testo prende la descrizione scritta sopra di lei; due voci uguali della
  stessa tabella restano entrambe, si toglie solo la copia della tabella ripetuta
  nell'allegato.

Le pagine già lette prima di questi aiuti restano in `.ocr-cache/`: alla prima riapertura
si cercano solo le linee della tabella, senza rifare l'OCR. Per rileggere ruotata una
pagina capovolta o di traverso già in cache, svuota `.ocr-cache/`.

**Voci uguali.** Due voci identiche nella stessa pagina, o due voci del computo metrico
(riga SOMMANO) in quadri diversi, restano tutte: sono voci del documento. Si toglie solo la
copia della stessa voce su un'altra pagina (l'elenco prezzi ripetuto nell'art. 5 e
nell'allegato). Nelle tabelle senza codici, con la colonna «Pos.» (1, 2, 3…), il numero di
posizione diventa l'ARTICOLO.

**Documento intero.** L'elenco prezzi si estrae sul testo di tutte le pagine insieme:
alcune regole guardano l'intero contratto (stesso articolo stesso prezzo, grafie dei
codici, posizioni, titolo che vale per le voci sotto). Poi ogni pagina si rilegge da sola:
dove trova più voci con i conti giusti (quantità × prezzo = importo) aggiunge quelle
mancanti e completa i valori vuoti delle altre (un valore già letto non si cambia). Le voci portano la pagina da cui vengono
(colonna **Pag.** in Modifica) quando il programma la ritrova nel testo.

**Riferimenti del banco di prova.** In Modifica gli admin dell'app vedono
**★ Salva come riferimento**: il risultato corretto diventa il modulo di riferimento di
quel contratto in `contratti/moduli-da-md/<nome>_modulo.txt`, e il PDF del lavoro va in
`contratti/` se non c'era. Il riferimento precedente finisce in
`contratti/moduli-da-md/_storico/` con data e ora. `OCR_DIR_BANCO` sposta la cartella
`contratti/`. Per misurare: `npm run harness`, poi
`npm run confronta-moduli -- contratti/moduli-da-md`. Sono dati aziendali: la cartella
non va mai nel repository.

**PaddleOCR bloccato.** Tipico: Windows App Control (WDAC) rifiuta le librerie
non firmate del venv (`WinError 4551`). Non si risolve reinstallando: serve l'IT.

**Elenchi ufficiali Alyante.** Cartella `Elenchi/`: DITTA, DIVISIONE,
RIPARTIZIONE COMMESSE, Piano dei conti, famiglie e sottofamiglie,
`cond_pagamento.json`. Un file aggiornato viene riletto da solo; in alternativa
si riavvia il programma. Sono dati aziendali: tenerli aggiornati evita le celle rosse.

**Scansione della cartella sul server** ([7.1](07-scansione-cartella.md#71-sul-server-in-ogni-browser-anche-a-pagina-chiusa)).
La imposta l'amministratore dalla scheda *Sul server* di ⚙ Impostazioni; le impostazioni
stanno in `_cartella/impostazioni.json` (o nella cartella `OCR_CARTELLA_DIR`). I contratti
letti risultano lavori dell'amministratore che ha salvato le impostazioni. Le cartelle
devono essere raggiungibili dall'utente Windows con cui gira OCR Documenti (per le
cartelle di rete: permessi di lettura e scrittura a quell'utente).

**Dati.** I lavori in corso stanno in `_lavori/` (o nella cartella `LAVORI_DIR`)
e ripartono dopo un riavvio; la cache della lettura in `.ocr-cache/`
(`OCR_CACHE=0` la spegne). Gli Excel prodotti vanno nella cartella scelta da
ciascun utente nel browser, non sul server.

**Backup.** `Elenchi/` (indispensabile). `_lavori/` e `.ocr-cache/` sono
temporanei.

**Accesso.** Dietro il Portale: in produzione o in rete il gate del Portale è
sempre attivo. Ogni utente vede solo i propri lavori.

[← Se qualcosa non va](05-problemi.md)
