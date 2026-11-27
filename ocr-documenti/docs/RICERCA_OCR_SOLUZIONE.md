<!-- "><(((º> sabusabu <º)))>< -->
# OCR migliori e soluzione per leggere i contratti senza AI

Ricerca e misure del 09/11/2026. Domanda: esistono OCR migliori di quello in uso? Qualcuno
ha già risolto il problema di passare da un contratto scansionato all'Excel per Alyante?
Come si arriva a un programma che funziona **senza AI**, con l'AI solo di supporto?

## 1. In breve

- **Aggiornamento del 17-19/11 (§11-§26): documento intero con le pagine, testata,
  riferimenti dall'app, celle numeriche rilette, codici spezzati su due righe, codici a
  sigla, elenchi a corpo senza quantità, codici del computo ricomposti, griglie con la
  descrizione centrata, codici del prezzario con lo spazio, P.IVA con la s, migliaia con lo
  spazio.** Sui 31 contratti testata dal 94% al 98%, voci con quantità e prezzo giusti dal
  74% all'86%, voci esatte dal 64% all'82%; nessun contratto peggiora. Progetto Costruzioni
  da 41 a 57 voci giuste su 142, Gecob da 3 a 34 su 34, PF Future villette 34 su 34, gli altri due da 35 a 65 e da 45 a 65
  su 70, Ulma da 14 a 23 su 26, AQ3 nolo da 11 a 18 su 31, Warm 146 su 146, Sidersipe 5 su 5, World service 7 su 7, Eureka 4 su 4, Nigro 52 su 52. «Scan senza
  Excel» legge come gli altri sul documento intero; in Modifica gli admin salvano le
  correzioni come riferimento del banco.
- **Aggiornamento del 16/11 (§10): elenco WBS, voci uguali, colonna «Pos.».** Sui 31
  contratti le voci con quantità e prezzo giusti salgono dal 66% al 74%, le voci esatte
  dal 50% al 64%. Progetto Costruzioni passa da 0 a 41 voci giuste su 142; voci esatte GFM
  da 54 a 92, SICS da 4 a 27 su 29. Le 12 pagine di Progetto Costruzioni sono tutte tabelle di traverso, non
  capovolte come detto al §9. PP-StructureV3 provato sulle pagine difficili: non aiuta,
  non è collegato.
- **Aggiornamento della sera (§9): i passi 1-6 sono fatti, senza AI.** Sugli stessi 30
  contratti:
  - testata dal 73% al 94%;
  - voci con quantità e prezzo giusti dal 59% al 78%;
  - voci esatte dal 33% al 58%.

  Le pagine capovolte si raddrizzano da sole. PP-StructureV3 è stato provato: tabelle
  ottime, ma ~90 s a pagina e 885 MB di modelli (§6c).
- **L'OCR non è il collo di bottiglia.** Dallo stesso testo OCR che il programma ricava
  dalla scansione, Claude compila moduli che il programma accetta per 31 contratti su 31.
  Sui 5 contratti con un modulo di riferimento fatto dal PDF, quei moduli tornano per
  70 campi di testata su 73 e per 132 voci su 134. L'informazione quindi c'è già nel testo:
  è il programma che non la trova.
- **Il programma da solo**, misurato sugli stessi 31 contratti, ha giusti il 74% dei campi
  di testata e il 37% delle voci, senza nessuna differenza. Se si guardano solo quantità e
  prezzo, è giusto il 61% delle voci. Gli errori vengono soprattutto dalle regole di lettura:
  data, commessa, ritenute, codici andati a capo, colonne dei prezzi.
- **L'OCR in uso è già aggiornato:** PaddleOCR 3.7 con PP-OCRv5, cioè l'ultima versione.
  I modelli in testa alle classifiche (PaddleOCR-VL, MinerU, olmOCR) sono modelli
  visione-linguaggio pensati per la GPU: su CPU leggono una pagina in 1-2 minuti.
- **Dove l'OCR perde davvero:**
  - **Pagine capovolte.** Sono 12 su 762, l'elenco prezzi di un contratto Ragusana: letta
    così com'è la pagina dà il 45% di confidenza, ruotata di 180° l'82%.
  - **Struttura delle tabelle.** Le colonne si perdono, perché l'OCR restituisce righe di
    testo e non celle.
- **La soluzione proposta (§7)** sono sette interventi senza AI, da fare in ordine:
  1. ruotare le pagine capovolte;
  2. correggere le regole di testata;
  3. ricomporre i codici andati a capo;
  4. ricavare le colonne dalle linee della tabella;
  5. riparare le righe con l'aritmetica;
  6. definire un modello per ogni formato ricorrente;
  7. usare il modulo per verificare i casi incerti.

  Ogni passo si misura con lo stesso banco di 31 contratti. Claude resta un supporto: compila
  il modulo quando il programma lo respinge, ma controlli ed Excel sono del programma.

## 2. Come è stato misurato

- **Contratti:** i 31 PDF in `contratti/`, che è fuori da git perché contiene dati aziendali.
  Qui ci sono solo numeri aggregati e nomi brevi.
- **Programma da solo:** `npm run harness`, la stessa filiera di produzione: OCR PaddleOCR,
  parser e niente assist AI. Il risultato è in `tests/out/<pdf>/alyante.json`.
- **Riferimento:** un modulo contratto per ogni documento, compilato da Claude leggendo SOLO
  il testo OCR (`contratti/moduli-da-md/`, prova alla cieca). Ogni modulo è stato riletto
  dal programma con `npm run moduli`: 31 su 31 senza errori.
  - Il metodo è validato sui 5 contratti che hanno un modulo fatto dal PDF:
    70/73 campi di testata e 132/134 voci uguali (vedi `PIPELINE_MODULO_CONTRATTO.md`).
  - Il riferimento è parziale in 4 casi:
    - 2 listini di fornitura «esemplificativi», con quantità indicative e senza importi
      per voce;
    - una consulenza a ore senza quantità;
    - un subappalto Ragusana il cui elenco prezzi è scansionato capovolto: quelle voci hanno
      solo codice e unità di misura.
  - Due PDF Jonico hanno lo stesso testo OCR (stesso md5): stesso modulo.
- **Confronto:** `npm run confronta-moduli -- contratti/moduli-da-md`, dettaglio in
  `contratti/moduli-da-md/_confronto.md`.

## 3. Il programma da solo sui 31 contratti

| Misura | Risultato |
|---|---|
| Campi di testata giusti | 344 / 465 (74%) |
| Voci esatte (codice, quantità, prezzo) | 325 / 881 (37%) |
| Voci con quantità e prezzo giusti, codice diverso | 213 |
| → quantità e prezzo giusti in tutto | 538 / 881 (61%) |
| Voci con valori diversi | 103 (prezzo 54, quantità e prezzo 46) |
| Voci mancanti | 240 |
| Voci in più (righe che il modulo non ha) | 71 |

**Testata, campi sbagliati per colonna.** Ogni causa si corregge con una regola, senza
cambiare OCR:

| Campo | Errori | Causa |
|---|---|---|
| OGGETTO | 24 | In 15 casi è lo stesso oggetto, tagliato in un altro punto o con l'iniziale minuscola; negli altri viene presa la frase sbagliata (le premesse o «Le prestazioni oggetto…») |
| RG / RI | 16 / 15 | Le ritenute del 5% e dello 0,50% sono scritte nel testo ma non vengono tradotte in codice (RG05, R005) |
| PROGETTO | 13 | La commessa è dentro il codice contratto (es. `2026_198-138_030` → 198-138) o nell'elenco, ma resta vuota |
| DATA CONTRATTO | 12 | Viene presa una data delle premesse: la stessa data compare in 5 contratti diversi, mentre quella di stipula è vicino alle firme |
| CODICE CONTRATTO | 10 | Tagliato (`177-125_284` invece di `177-125_284/2026`) o vuoto quando «Cod. Ident. Contratto» non è compilato |
| COND.PAG, DIVISIONE, FORNITORE, DITTA | 8, 7, 5, 3 | Codice di pagamento con più scadenze; controparte presa dalle premesse (es. «Il R.T.I. costituito tra…»); società del gruppo diversa da COSEDIL |

**Voci: dove nascono gli errori**

- **Codice vuoto (109 voci):** il codice sta sulla riga del titolo sopra la riga con i
  numeri, oppure in una cella unita su più righe.
- **Codice a pezzi (70 voci):** il codice va a capo nella cella, per esempio `SIC24_14.01` e
  sotto `.03.003`. Il programma prende solo la prima parte.
- **Colonne del prezzo divise (54 voci col prezzo diverso):** «P.U. lavori» e «P.U. oneri
  sicurezza» stanno in due colonne. Il programma ne prende una: 2,40 al posto di 32,00, o la
  colonna dell'incidenza percentuale.
- **Voci mancanti (240):** tabelle senza linee orizzontali fra le voci, o con più righe per
  articolo (FORNITURA e POSA dello stesso codice), che il ricostruttore di tabelle fonde o
  salta. Gli agenti che hanno compilato i moduli hanno trovato la «TABELLA ARTICOLI
  ricostruita» inservibile in 10 contratti su 26.
- **Errori di OCR veri e propri:** una minoranza, e quasi sempre riparabili con
  l'aritmetica. Esempi:
  - `5o.ooo,oo`, `0114327o898` (O al posto di 0);
  - `B45OC`;
  - `59.520,56` invece di `59.520,96`, smentito dal totale della tabella;
  - una cifra coperta dal bordo della cella.

## 4. Esistono OCR migliori? (ricerca online, novembre 2026)

| Motore | Tipo | Su CPU | Tabelle | Per noi |
|---|---|---|---|---|
| **PaddleOCR 3.7, PP-OCRv5 mobile + latin** (in uso) | OCR classico, Apache 2.0 | ~50 s/pagina misurati qui | No (solo righe di testo) | Ultima release: 3.7.0 dell'11/06/2026. PP-OCRv6 è il nuovo default, ma misurato qui è 3,4× più lento e meno preciso sull'italiano del latin v5 (vedi `ocr_worker.py`) |
| **PP-StructureV3** (stessa libreria) | Layout + tabelle (SLANeXt, rilevatore di celle) → Markdown/HTML | ~8 s/pagina su Xeon nelle misure ufficiali; **~90 s/pagina misurati qui** | Sì | Provato (§6c): tabelle ottime anche senza linee fra le voci, ma 885 MB di modelli e ~90 s a pagina su questa CPU. Da tenere come secondo passaggio sulle sole pagine-tabella difficili |
| **PaddleOCR-VL-1.6** | Modello visione-linguaggio da 0,9 miliardi di parametri, Apache 2.0 | 72-92 s/pagina (conversione ONNX della comunità) | Sì, fra i primi su OmniDocBench v1.6 (96,34) | Da GPU. La RTX serie 50 del PC vuole paddle cu129. È comunque un modello AI, anche se locale |
| **Docling** (IBM) | Layout + TableFormer, MIT | Tabelle in 2-6 s; con EasyOCR fino a ~30 s/pagina | Sì, buono sulle tabelle complesse | Alternativa se PP-StructureV3 non va. Usa come OCR EasyOCR, Tesseract o RapidOCR, tutti più deboli di PP-OCRv5 sull'italiano |
| **MinerU 2.5, Marker/Surya, olmOCR** | Modelli transformer / visione-linguaggio | Lenti | Sì | Pensati per GPU e articoli scientifici. I numeri migliori li pubblicano gli autori stessi |
| **Tesseract 5, EasyOCR, docTR** | OCR classici | Sì | No (Tesseract appiattisce le tabelle) | Nessun vantaggio su PP-OCRv5 |
| **Azure Document Intelligence, AWS Textract, Google Document AI** | Servizi cloud | — | Sì, più coppie chiave-valore | Il documento esce dall'azienda e l'estrazione è AI: contro il requisito |
| **ABBYY FineReader Server / FlexiCapture** | Commerciale on-premise: modelli + regole | Sì | Sì | Fa ciò che serve (modelli per formato, regole quantità × prezzo), ma costa 5.000-50.000 €/anno secondo stime di terzi e richiede 3-6 mesi di messa in opera |

**Conclusione:** non serve cambiare OCR. Servono due cose che i motori di layout fanno e il
nostro no: l'orientamento della pagina e la struttura delle tabelle (celle e colonne). La
prima si risolve con poche righe; la seconda con un passo in più dopo l'OCR (§6, §7).

## 5. Chi ha già risolto il problema

Nessuno, che si sia trovato, fa esattamente «contratto di subappalto scansionato → Import
Alyante». Il problema generale però (documento scansionato → campi e righe → gestionale) è
risolto da anni, e sempre con lo stesso schema: **OCR → struttura → modelli e regole →
controlli aritmetici → coda di revisione umana**. È lo schema del modulo contratto.

- **Modelli per formato senza AI:**
  - [invoice2data](https://invoice2data.readthedocs.io/latest/how-it-works.html) (open
    source, per fatture) sceglie un modello YAML in base a parole chiave del testo e
    ricava i campi con espressioni regolari.
  - Il limite dichiarato è che ogni formato nuovo va scritto a mano e le righe delle
    tabelle sono la parte fragile.
  - L'aiuto LLM per i casi senza modello è facoltativo e si lascia spento. È quello che
    proponiamo con Claude.
- **Tabelle con i bordi senza AI:**
  [img2table](https://github.com/xavctn/img2table) trova le celle con OpenCV dalle linee
  della tabella e ci mette dentro il testo di un OCR (anche PaddleOCR). Il prototipo del §6
  segue lo stesso principio.
- **Controlli aritmetici sulle righe:** sono la base dei prodotti commerciali.
  - [Rossum](https://developers.rossum.ai/docs/quantity-times-unit-price-equals-total-amount):
    quantità × prezzo = importo.
  - [ABBYY FlexiCapture](https://help.abbyy.com/en-us/flexicapture/12/standalone_administrator/ir_orders_rules):
    regole di validazione, sconti compresi.
  - [Tungsten/Kofax](https://docshield.tungstenautomation.com/RSI/en_US/6.2.0-p9yuqqbcd8/help/INI/RSI_INI_help/EIGLOBALEXTRA/c_DoLineItemRowTotalValidation.html):
    `DoLineItemRowTotalValidation`.
  - [Continia](https://docs.continia.com/en-us/continia-document-capture/new-and-planned/previous-release-plans/march-2020-to-march-2021/purchase-documents/auto-calculation-of-line-values/):
    ricalcola il valore della riga quando ne manca uno solo.
  - La regola condivisa: si ricalcola solo se manca un valore; una riga che non torna va
    in revisione, non si forza.
- **Testi legali:** [LexNLP](https://lexpredict-lexnlp.readthedocs.io/en/latest/about.html)
  estrae da contratti date, importi e percentuali con regole, senza AI. È in inglese e con
  licenza AGPL: utile come idea, non come libreria.
- **Edilizia italiana:**
  - **TeamSystem**, il produttore di Alyante: propone
    [«Computi metrici da PDF a Excel con AI»](https://www.teamsystem.com/construction/ts-engineering-ai/funzionalita/ai-computi-metrici/)
    in TS Engineering AI. Un agente AI legge il PDF e l'export è xls/csv; la pagina non
    descrive controlli né un legame con Alyante.
  - Il [DMS TeamSystem](https://www.teamsystem.com/enterprise/dms-archiviazione-documentale-ts-enterprise)
    fa OCR solo per barcode e classificazione. Non risulta un import OCR dei contratti
    passivi in Alyante.
  - **ACCA PriMus** importa solo i PDF stampati da PriMus, non le scansioni
    ([ACCA](https://www.accasoftware.com/en/PriMus)).
  - Servizi come Archim, Parseur e capturedocs usano OCR cloud con AI e revisione manuale.

## 6. Prove fatte qui (09/11/2026)

**a) Celle dalle linee della tabella, senza AI.**
- **Come funziona:** il prototipo è nello scratchpad della sessione, ~80 righe Python con
  OpenCV già installato. Trova le linee orizzontali e verticali per morfologia, poi mette
  ogni blocco OCR già letto (cache dell'harness, stessi pixel) nella cella che lo contiene.
- **Tabelle con tutti i bordi** (Progetto Costruzioni, Ticopter subappalto, subappalto 030,
  SICS): celle e colonne esatte, intestazioni comprese.
  - Progetto Costruzioni: «P.U. oneri» 2,400 e «P.U. lavori» 29,600 escono in colonne
    separate e con l'intestazione giusta. Il prezzo della voce (32,00) si ricava
    sommandole. Oggi il programma scrive 2,40.
  - Ticopter subappalto: FORNITURA e POSA dello stesso codice escono come due righe
    distinte.
- **Tabelle senza linee fra le voci** (GFM, Jonico, Gecob): colonne giuste, ma più voci
  finiscono nella stessa cella. Serve un secondo passo che divide la cella seguendo le righe
  dei numeri (quantità, prezzo e importo stanno alla stessa altezza).

**b) Pagine capovolte.** Pagina 40 del subappalto Ragusana, stessi modelli e parametri
della produzione:

| Rotazione | Blocchi | Confidenza media | Testo |
|---|---|---|---|
| 0° (come oggi) | 243 | 44,8% | `ZI ip Z *Sd`, `220/020222-241`… |
| **180°** | 247 | **82,0%** | `032 Lotto4 on Opere d'arte`, `MINORE (Sottovia, Cavalcavia…` |
| 90° | 243 | 46,3% | illeggibile |

Delle 762 pagine dei 31 contratti, fra quelle passate dall'OCR 15 sono sotto il 75% di
confidenza. Di queste 12 sono le pagine capovolte; le altre 3 sono pagine quasi vuote o con
la sola firma. Oggi il
worker ha `use_doc_orientation_classify=False`.

**c) PP-StructureV3** (eseguita la sera del 09/11, con il permesso al download; verifica
dei certificati normale, nessuna eccezione TLS servita). Ambiente di prova separato, venv
di produzione non toccato, CPU, 4 pagine-tabella:

| | Risultato |
|---|---|
| Download | 885 MB di modelli (layout, celle con e senza bordi, struttura tabella), ~20 minuti |
| Tempo | ~90 s a pagina (450 s la prima, col caricamento) |
| Progetto Costruzioni (bordi, colonne oneri + lavori) | Perfetta: 8 colonne con intestazioni, 4 voci esatte, totali |
| GFM (senza linee fra le voci) | Voci separate giuste (PA.IE.015, SIC24_14.01.01.001…) con quantità, prezzo, importo: è il caso che OpenCV da solo non risolve |
| Ticopter fornitura e subappalto (celle unite FORNITURA/POSA) | Righe slittate di una colonna dove una cella copre più righe |

Conclusione: è il miglior lettore di tabelle provato, ma costa ~90 s a pagina in più su
CPU (oltre all'OCR) e quasi 1 GB di modelli. Sensato solo come secondo passaggio sulle
pagine-tabella che la griglia OpenCV (§9) non risolve, o con la GPU (§8).

## 7. La soluzione proposta: senza AI, un passo alla volta

Ogni passo si misura con `npm run harness` + `npm run confronta-moduli -- contratti/moduli-da-md`
sui 31 contratti: si tiene solo se migliora.

| # | Intervento | Dove | Cosa recupera (dalle misure del §3) | Sforzo |
|---|---|---|---|---|
| 1 | **Orientamento.** Pagina sotto il 60% di confidenza → la si rilegge a 180° (poi 90° e 270°) e si tiene la lettura migliore. In alternativa si accende il classificatore d'orientamento di PaddleOCR (modello PP-LCNet di pochi MB) | `ocr_worker.py` | Le 12 pagine capovolte dell'elenco prezzi Ragusana (75 voci). Costa una lettura in più solo sulle pagine sospette | Piccolo |
| 2 | **Regole di testata.** <br>• Data di stipula: vicino alle firme o a «lì …», mai una data delle premesse o di una norma. <br>• RG/RI dalle percentuali di ritenuta (5% → RG05, 0,50% a tutela dei lavoratori → R005). <br>• Commessa dal codice contratto o dall'elenco. <br>• Codice contratto intero. <br>• Fornitore = la parte con P.IVA diversa dal gruppo. <br>• Oggetto dall'articolo «Oggetto», non dalle premesse | parser di testata (`server/`) | ~60 dei 121 campi sbagliati (RG/RI 31, PROGETTO 13, DATA 12, CODICE 10) | Medio-piccolo |
| 3 | **Codici a capo.** Nella stessa colonna, una riga che comincia con `.` o `_` o continua il formato del codice si attacca al codice sopra; un codice sulla riga del titolo vale per la riga di numeri sotto | ricostruzione righe | 70 codici a pezzi e buona parte dei 109 vuoti | Piccolo |
| 4 | **Colonne dalle linee della tabella** (come il prototipo §6a). Il ruolo di ogni colonna si ricava dall'intestazione: ARTICOLO/VOCE, U.M., QUANTITÀ, P.U./PREZZO, IMPORTO. «P.U. lavori» + «P.U. oneri» = PREZZO; la colonna «% incidenza» si scarta. Nelle tabelle senza linee fra le voci, le righe si dividono sui numeri | nuovo passo dopo l'OCR (worker o server) | I 54 prezzi presi dalla colonna sbagliata e parte delle 240 voci mancanti | Medio |
| 5 | **Riparazione aritmetica della riga**, come Rossum, ABBYY e Continia (§5). <br>• Fra i numeri della riga si cerca la terna con quantità × prezzo ≈ importo. <br>• Prezzo arrotondato → importo / quantità. <br>• Un solo valore mancante → si ricalcola. <br>• Totale di tabella e importo lavori come controllo finale. <br>• Riga che non torna → `# DA VERIFICARE` nel modulo, mai forzata | `server/` (estrazione righe) | Le 46 voci con quantità e prezzo sbagliati e gli errori di cifra dell'OCR (es. 59.520,56) | Medio |
| 6 | **Un modello per formato.** Per i formati ricorrenti (il «format tra le Parti» Cosedil, gli ordini PF Future, i contratti Ragusana Lotto 4) un file di regole dice dove stanno i campi e com'è fatta la tabella. Si sceglie dalle parole chiave, come invoice2data | configurazione, un file per formato | I contratti di quei formati: almeno 15 su 31 (5 «tra le Parti», 3 PF Future, 7 Ragusana Lotto 4) | Piccolo per formato |
| 7 | **Il modulo come verifica.** Ogni campo incerto esce `# DA VERIFICARE` e l'Excel si fa solo da un modulo valido. Per i documenti respinti c'è la pagina CLAUDE: Claude compila il modulo e il programma lo controlla | già così (vedi sotto) | La coda di revisione umana | Fatto |

**Obiettivo realistico** (stima, da verificare passo per passo): testata ≥ 90% e voci con
quantità e prezzo giusti ≥ 85% sui 31 contratti, senza AI. Per confronto: oggi il programma
è al 74% e 61%; sui 5 contratti di riferimento i moduli compilati da Claude dal solo testo
OCR sono al 96% e 98%.

**Già fatto in questo giro:** la pagina CLAUDE dell'app chiede il MODULO contratto invece
dell'Excel. Claude lo scrive in chat; il programma lo rilegge alla lettera, con gli errori
riga per riga, e salva `<nome>_modulo.txt` e l'Excel. Prima l'Excel lo creava Claude
direttamente, senza controlli: nelle prove c'erano voci ripetute in 12 contratti su 31 e
quantità o prezzi presi da colonne sbagliate in 6.

## 8. Dopo, se serve

- **PP-StructureV3 sulle pagine-tabella che la griglia non risolve** (voci senza linee
  fra loro: GFM, Jonico, Gecob). Provato sul §6c: le separa bene, ma su questa CPU costa
  ~90 s a pagina e 885 MB di modelli; da accendere solo su quelle pagine, o con la GPU.
- **GPU** (paddle cu129 per la RTX serie 50): accelera l'OCR attuale e rende praticabile
  PaddleOCR-VL come «secondo parere» locale sulle pagine difficili. Resta un modello AI,
  quindi solo come supporto, come Claude.

## 9. Il piano eseguito (09/11/2026, sera)

Passi 1-6 del §7 fatti, senza AI e senza modelli nuovi. Misura sugli stessi 31 contratti:
`npm run harness` e poi `npm run confronta-moduli -- contratti/moduli-da-md`, che ora
stampa da solo i totali. La testata si conta senza i campi vuoti in entrambi: per questo
la partenza è al 73% e non al 74% del §3.

**Risultato sui 30 contratti** con lo stesso riferimento prima e dopo. Ragusana-1 è a parte,
sotto: il suo riferimento era stato compilato dal testo con le pagine capovolte.

| Misura | Prima | Dopo | Obiettivo §7 |
|---|---|---|---|
| Campi di testata giusti | 299/410 (73%) | **385/410 (94%)** | ≥ 90% ✓ |
| Voci esatte (codice, quantità, prezzo) | 266/806 (33%) | **470/806 (58%)** | — |
| Voci con quantità e prezzo giusti | 479/806 (59%) | **627/806 (78%)** | ≥ 85%, non raggiunto |
| Voci mancanti | 224 | 141 | |
| Voci con valori diversi | 103 | 38 | |
| Voci in più | 71 | 46 | |

Andamento passo per passo (giro veloce sul testo già letto, 31 contratti col vecchio
riferimento di Ragusana-1):

| Dopo | Testata | Voci esatte | Qtà e prezzo |
|---|---|---|---|
| partenza | 73% | 37% | 61% |
| regole di testata (2) | 94% | 37% | 61% |
| codici, oneri, computo (3, 5) | 94% | 53% | 73% |
| modelli: ordine fornitore, listino (6) | 94% | 60% | 78% |
| celle e orientamento (4, 1) | 94% | 61% | 78% |

Le celle cambiano poco il totale perché valgono solo per le tabelle con i bordi, ma lì il
salto è netto:
- subappalto 030: da 0 a 12 voci giuste su 13;
- subappalto Ticopter: da 0 a 8 su 13;
- Gecob: da 0 a 13 su 34;
- Progetto Costruzioni: da 0 a 3 su 4.

L'orientamento recupera le 12 pagine dell'elenco prezzi di Ragusana-1: 7 erano capovolte
(180°), 5 erano tabelle stampate di traverso (270°). Lette ora all'85-90% di confidenza,
prima al 39-48%.

**Cosa è stato fatto, passo per passo** (dettagli in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.4):

1. **Orientamento** (`ocr_worker.py`): una pagina sotto il 60% di confidenza si rilegge a
   180°, 90° e 270°. Vince la lettura con più testo letto bene (caratteri × confidenza),
   se ne legge almeno il 25% in più. Con la sola confidenza media vinceva una lettura di
   traverso con pochi numeri. Le pagine normali non costano nulla; una capovolta costa da
   2 a 4 letture.
2. **Testata** (`server/parser-contratti.ts`, `server/alyante.ts`):
   - data delle firme cercata in tutto il testo;
   - ritenute del modello «tra le Parti»;
   - codice contratto ricomposto;
   - commessa dalle premesse con pesi sull'elenco;
   - ditta designata dall'etichetta di ruolo;
   - P.IVA e CUP con gli errori tipici dell'OCR;
   - servizi → Passivo a Misura e divisione 08;
   - oggetto con la frase intera.
3. **Codici**: progressivo e codice non si confondono più (`06.P01…`, `NP.06`,
   `1C.12…`); nel computo la riga del codice si legge dal testo originale.
4. **Celle** (`server/tabella-griglia.ts`): linee della tabella con OpenCV, ogni blocco
   nella sua cella. Serve per le tabelle con i bordi: 030, Ticopter, Progetto
   Costruzioni, SICS, Gecob. Dove più voci stanno nella stessa cella, la pagina resta
   alla ricostruzione di sempre.
5. **Aritmetica**:
   - terna quantità × prezzo ≈ importo fra i numeri della riga;
   - colonne oneri + lavori sommate;
   - quantità persa ricavata da importo / prezzo;
   - riga SOMMANO tollerante allo sporco OCR.
6. **Modelli**: «Ordine fornitore» (codice = numero ordine, PROGETTO = cantiere) e listino
   materiali (prima parola = codice). Si aggiungono come elementi di `MODELLI_CONTRATTO`.

**Correzioni ai riferimenti.** I moduli LGM e GEMMALPE trattavano lo 0,50% «a garanzia di
debiti previdenziali» come ritenuta di garanzia (RG005). Corretti in RI R005, come i moduli
compilati dal PDF (TMT).

**Ragusana-1, riferimento rifatto.** Dopo il raddrizzamento il riferimento è stato
ricompilato alla cieca dal testo nuovo, con le stesse istruzioni degli altri 30. Il
riferimento vecchio aveva 75 voci con solo codice e u.m.; quello nuovo ne ha 142, di cui
114 con quantità e prezzo, e 28 restano DA VERIFICARE perché le cifre sono illeggibili.
Somma voci 1.008.826,74 contro un importo lavori di 1.141.450,43.

Il programma invece da quell'elenco ricava solo 59 codici, senza quantità né prezzi:
0 voci giuste su 142. Il testo ora c'è, ma il layout non ha ancora una regola:
- riga WBS su più righe, come «032 Lotto4 … 5104 B.03.031.c … m² 735,23 15,90 €
  11.688,46 € 442,79 € OG03»;
- 5 pagine stampate di traverso, con le colonne mescolate.

Contando anche Ragusana-1, i 31 contratti sono a 399/425 (94%) di testata, 470/948 (50%) di
voci esatte e 627/948 (66%) di voci con quantità e prezzo giusti.

**Cosa resta**, in ordine di peso:
- l'elenco WBS di Ragusana-1 (142 voci): un modello in più, con la terna coerente
  quantità × prezzo = importo per ritrovare i valori nella riga;
- voci senza linee fra loro (GFM, Jonico, parte di Gecob), che il §8 propone di passare a
  PP-StructureV3;
- voci composte in SICS (calcestruzzo + pompaggio P.01/P.02 per ogni classe);
- voci a corpo senza codice nei noli (Ulma);
- condizioni di pagamento con più scadenze (8 campi);
- codici SIC24 letti senza i punti («SIC24 143145»), che senza il prezzario non si
  ricompongono con certezza;
- voci uguali dello stesso computo in quadri diversi: il dedup ne tiene una sola.

---

## 10. Elenco WBS, voci uguali, colonna «Pos.» (16/11/2026)

Scelte dell'utente: modello per l'elenco WBS di Progetto Costruzioni Ragusana-1, voci uguali
tenute tutte, colonna «Pos.» come ARTICOLO. Sempre senza AI e senza modelli nuovi. Dettagli
tecnici in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.3 e §4.5.

**Risultato sui 31 contratti** (`npm run harness`, poi `npm run confronta-moduli --
contratti/moduli-da-md`):

| Misura | 09/11 | 16/11 |
|---|---|---|
| Campi di testata giusti | 399/425 (94%) | 399/425 (94%) |
| Voci esatte (codice, quantità, prezzo) | 470/948 (50%) | **608/948 (64%)** |
| Voci con quantità e prezzo giusti | 627/948 (66%) | **699/948 (74%)** |
| Voci mancanti | 224 | 155 |
| Voci con valori diversi | 97 | 94 |
| Voci in più | 46 | 50 |

Senza Progetto Costruzioni, sui 30 contratti del §9: voci esatte 568/806 (70%), quantità e
prezzo giusti 658/806 (82%), contro 470 e 627.

Per contratto:
- **Progetto Costruzioni Ragusana-1**: da 0 a 41 voci giuste su 142. Le altre hanno le cifre
  illeggibili anche per il riferimento (28 DA VERIFICARE) o i conti che non tornano: escono
  col codice e i valori vuoti;
- **Sabbie d'oro**: da 0 a 10 voci esatte su 10 (colonna «Pos.», voci opzionali, colonna Note);
- **030**: da 10 a 13 voci esatte su 13 (la voce 3 stava sopra la prima linea della pagina 4; le posizioni 1 e 2 ricostruite);
- **GFM**: da 54 a 92 voci esatte su 108 (codici andati a capo, vedi sotto);
- **SICS**: da 4 a 27 voci esatte su 29, tutte e 29 con quantità e prezzo giusti (vedi
  sotto, «SICS e pagine senza griglia»);
- **Warm**: da 130 a 138 voci esatte su 146; **AQ3** (185-088): da 5 a 10;
- **PF Future 1537**: 6 voci in più giuste (stesso articolo in due quadri del computo);
- **Jonico** (le due copie): una voce esatta in più ciascuna.

**Cosa è stato fatto.**
1. **Pagine di traverso.** La correzione del §9 era sbagliata per metà: le 12 pagine
   dell'allegato A sono tutte tabelle stampate di traverso (270°), nessuna è capovolta. Le 7
   «capovolte» erano state lette a 180° all'85% di confidenza, ma con le righe in verticale:
   ogni «riga» letta era una colonna della tabella. Ora una lettura con i blocchi in
   maggioranza verticali non vince più (`frazione_verticale` in `ocr_worker.py`). Le 7
   pagine rilette a 270° sono all'86-89%.
2. **Voci divise sui codici** (`tabellaDaAncore`): l'allegato ha le linee fra le colonne ma
   non fra le voci, e su due pagine nessuna griglia. Le voci si dividono sui codici di
   tariffa; i valori vanno nelle colonne lavori e oneri per posizione; prezzo e importo
   escono complessivi, come nel riferimento (15,90 + 0,60 = 16,50).
3. **Stesso articolo, stesso prezzo** (`prezziCoerentiPerCodice`): un P.U. dei soli lavori
   diventa il complessivo dell'elenco; un prezzo preso da un'altra colonna si svuota. Le
   cifre in testa al codice si rimettono lettere (8→B, 1→I) dove il documento usa codici
   «Lettera.dd.ddd».
4. **Voci uguali**: il backend non le toglie più (solo quelle scritte dall'assist AI). Il
   frontend toglie solo la copia su un'altra pagina, e mai le voci del computo SOMMANO.
5. **Colonna «Pos.»**: numero di posizione come ARTICOLO nelle tabelle senza codici. Le
   posizioni saltate dall'OCR si ricostruiscono solo quando il buco torna esatto.

**PP-StructureV3 sulle pagine difficili** (prova del 16/11, CPU, 30-53 s a pagina):

| Pagina | Esito |
|---|---|
| Progetto Costruzioni, allegato A pag. 3 e 5 | struttura mescolata fra le righe, cifre storpiate come prima («413:00», «40:84Z771», «8:00») |
| Gecob pag. 5 | nessuna tabella riconosciuta |
| SICS pag. 4 | righe giuste, ma il programma quella pagina la legge già giusta |
| GFM pag. 11 (prova del 09/11) | codici interi («SIC24_14.01.03.001») dove il programma li tronca |

Non è stato collegato al programma: dove serve davvero (i codici GFM) basta una regola.
Il pezzo di codice andato a capo nella colonna dei codici («.03.003» sotto «SIC24_14.01»)
ora si accoda al codice (`RE_CODA_CODICE` in `server/tabella-tsv.ts`). GFM passa da 54 a
**86 voci esatte su 108**, senza tempo in più; con PP-StructureV3 sarebbero ~90 s a pagina
su 52 pagine. Dopo questa regola, sui 31 contratti: voci esatte **564/948 (59%)**, quantità
e prezzo giusti 679/948 (72%), testata 399/425 (94%). Il subappalto 030 è a 13 voci
esatte su 13.

Le cifre illeggibili di Progetto Costruzioni non dipendono dalla struttura: PP-StructureV3
usa gli stessi modelli di riconoscimento del programma. Le pagine sono rese a 2333×3300
pixel (circa 280 dpi): il limite è la scansione. Un riconoscitore più grande
(PP-OCRv5_server_rec) sarebbe da provare, con un altro scaricamento. I modelli della prova
(885 MB) sono stati cancellati; restano i due che usa il programma.

**SICS e pagine senza griglia.** Le voci «composte» di SICS (calcestruzzo + P.01
pompaggio + P.02 piazzamento) erano un problema di regole, non di OCR:
- **pagina per pagina** (`estraiRigheCelle`): nei documenti con celle, su una pagina senza
  griglia vince, fra la tabella ricostruita dalle coordinate e le righe del testo lette come
  griglia elenco prezzi, chi ha più voci con quantità × prezzo = importo. A pag. 5 la
  ricostruzione fondeva sei voci in una cella; nel testo ogni voce sta intera su una riga;
- **codici in due pezzi** («BA.CZ.A.3 02.F», `RE_COD_GRIGLIA`), anche in testa a una cella
  con l'etichetta della voce; le grafie storpiate dello stesso prefisso («BA.CZA.3»,
  «BA.CZ-A.3») prendono quella più frequente (`uniformaCodiciOcr`); «P,02» → P.02;
- **importo spezzato** («1.831,03 1,00 €» = 1.831.031,00, `ricuciImportoSpezzato`),
  ricucito solo se quantità × prezzo torna al centesimo;
- **titolo con il codice** senza valori sopra la riga di fornitura dei pali: codice e
  titolo vanno a quella voce, come nel riferimento.

**Cosa resta**, in ordine di peso:
- l'allegato A di Progetto Costruzioni: 101 voci su 142 senza quantità o prezzo giusti, per
  cifre illeggibili («3963.», «21176,255»);
- PF Future 1536 e 1537: ~40 voci della seconda tabella (forniture «n 1 135,41 €»), ignorate
  perché il computo SOMMANO vince da solo su tutto il documento;
- Gecob (18 voci mancanti: la tabella non ha linee e PP-StructureV3 non la vede);
- Ulma (voci a corpo senza codice), condizioni di pagamento (8 campi);
- l'app legge i PDF pagina per pagina, il banco il documento intero: le regole che
  guardano tutto il documento (prezzi per codice, codici uniformati, posizioni) nell'app
  valgono solo dentro la pagina. Da misurare (fatto il 17/11: vedi §11);
- 4 voci in più di Progetto Costruzioni: riga di totale dell'ultima pagina, `NP02` senza
  valori, due codici spezzati male (`B.04.001_C`, `B.04.001_0p01`).

## 11. Documento intero, testata, riferimenti dall'app (17/11/2026)

**Cosa legge davvero l'app.** Verificato in `src/App.tsx`: «Scansiona → Excel», «Elabora
tutti» e la cartella passano già dal lavoro sul server (`server/lavori.ts`), che estrae sul
documento intero come il banco. Pagina per pagina andavano solo «Scan senza Excel», «Scan
pagina/intervallo» e il ripiego senza lavori. Misurato con una copia del banco che estrae
ogni pagina da sola e fonde come il browser (31 contratti):

| | Documento intero | Pagina per pagina |
|---|---|---|
| Testata giusta | 399/425 | 349/425 (la fusione prende la prima pagina con un valore: date di leggi, condizioni sbagliate) |
| Voci esatte | 608 | 589 (SICS 27 → 8: regole sul documento perse) |
| Voci con quantità e prezzo giusti | 699 | 704 |

Pagina per pagina usciva però di più su PF Future 1536/1537 (seconda tabella, spenta dal
computo SOMMANO), Beton Strade (sul documento intero vinceva l'elenco dei mezzi: 0 voci
giuste su 7), AQ3 e GFM. Da qui le scelte:

- **«Scan senza Excel»** sui PDF di contratto passa dal lavoro sul server, come gli altri;
- **`completaDallePagine`**: documento intero, poi ogni pagina da sola; dove trova più voci
  coerenti aggiunge le mancanti e completa i valori vuoti, senza mai togliere voci né
  cambiare valori già letti (le prove «sostituisci la pagina» e «la pagina vince»
  perdevano Ulma −4, Gecob −4, SICS −1, Progetto −1);
- **pagina d'origine** di ogni voce ritrovata nel testo (`server/pagine-righe.ts`): torna
  il clic «Pag.» in Modifica anche sui contratti fatti dal server;
- **testata**: condizione di pagamento (sigla «F.M.», «30 dffm», «90 + 10», scadenze per
  voce unite, «vista fattura», nessun codice dai soli giorni) e oggetto (elenchi puntati,
  numerati e «si impegna a fornire:», sigle «c.a.» a fine riga). Dettaglio in
  `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.6-4.7;
- **«★ Salva come riferimento»** in Modifica, solo per gli admin dell'app: le correzioni
  diventano il modulo di riferimento in `contratti/moduli-da-md/` (precedente in
  `_storico/`, PDF del lavoro copiato nel banco se manca). Il banco cresce con i contratti
  rivisti davvero, non solo con quelli compilati a mano.

**Risultato** (31 contratti, `npm run harness` + `npm run confronta-moduli -- contratti/moduli-da-md`):

| | 16/11 | 17/11 |
|---|---|---|
| Testata giusta | 399/425 (94%) | **410/425 (96%)** |
| COND.PAG giusta | 23/31 | 29/31 |
| OGGETTO uguale o simile | 24/31 | 29/31 |
| Voci esatte | 608/948 (64%) | **627/948 (66%)** |
| Voci con quantità e prezzo giusti | 699/948 (74%) | **723/948 (76%)** |
| Voci mancanti · in più | 155 · 50 | 127 · 52 |

Per contratto: PF Future 1536 51 → 56 e 1537 49 → 54 voci con quantità e prezzo giusti,
AQ3 17 → 22, Beton Strade 0 → 7, GFM 102 → 104. Nessun contratto peggiora.

**Cosa resta**: Progetto Costruzioni (cifre illeggibili dell'allegato A, vedi §12), Gecob
(tabella senza linee), Ulma (voci a corpo), i due COND.PAG senza codice in elenco («30 + 10
giorni», pagamento a percentuali) e i due OGGETTO riassunti a mano nel riferimento
(Sidersipe, Progetto Costruzioni).

## 12. Celle numeriche rilette una per una (17/11/2026)

**Il problema.** L'allegato A di Progetto Costruzioni è scansionato a 300 DPI (2480×3508,
il programma lo legge a 2332×3300): rendere più fitto non aggiunge informazione. Le cifre
stanno su fondo grigio retinato e la lettura della pagina intera ne salta o storpia molte.
Prova sulla pag. 49, cella per cella con il solo riconoscimento:

| Pulizia | Esempio (14,49 / 15,90 / 230,35 / 0,60 / 8,73) |
|---|---|
| pagina intera | 14.49 / 15,90€ / 23035 / — / 8.73€ |
| cella grezza ingrandita | 14409 / 15,90 / 23035 / 0,60 / 873 |
| mediana 3×3 | 149 / 15,90 / 23035 / 0,600 / 8730 |
| gaussiana σ 1,5 + soglia 110 | 14,49 / 15,90 / 230,35 / 0,60 / 8,73 |
| macchie < 25 px tolte | 1449 / 15,90 / 23035 / 30,60 / 8,73 |

Nessuna pulizia è giusta sempre; con tre letture per cella e due conti indipendenti
(lavori e oneri) si sceglie. Dettaglio in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.8.

**Risultato** sui 31 contratti: voci esatte 627 → **637** (67%), quantità e prezzo giusti
723 → **733** (77%), testata invariata. Progetto Costruzioni 40 → 50 esatte e 41 → 51 con
quantità e prezzo giusti, mancanti 36 → 25; nessun altro contratto cambia. Su 79 voci
rilette 14 trovano una combinazione che regge entrambi i conti (le altre restano vuote,
mai numeri inventati) e 5 voci «Come sopra» prendono il solo prezzo, completato a 34,00.

**Cosa resta su Progetto Costruzioni**: 60 voci rilette con letture troppo rovinate per far
tornare i conti, i codici `_np01`/`_CS01` non letti (12 voci mancanti, vedi §13), il
riferimento compilato alla cieca dal testo (prezzi a 4 decimali calcolati, 28 righe «DA
VERIFICARE»).

## 13. Codici spezzati su due righe (17/11/2026)

Le voci «Come sopra B.04.001 da quota 4,01 a 8,00» dell'allegato A hanno il codice su due
righe della cella («B.04.001_n» / «p01»). Nel testo OCR ci sono tutte e 21; il programma
ne trovava 12. Perse nella ricucitura del codice: prima riga che finisce con «_», bordo
della cella letto «|», codice e descrizione in un blocco solo, «SOZ» per S02 e «pD1» per
p01, descrizione che comincia 7 px dentro il codice più largo. Poi la lettera sul bordo
della cella, persa o storpiata («_p01», «_0p01», «_ap01»), si rimette con la grafia più
frequente nel documento a parità di radice e seconda riga. Infine il P.U. dei soli lavori
(32,76) passa al complessivo (34,00) anche a pari ricorrenze, se il rapporto fra i due è
quello che torna in almeno altri due codici. Dettaglio in
`PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.9.

**Risultato** sui 31 contratti: voci esatte 637 → **644** (68%), quantità e prezzo giusti
733 → **739** (78%), testata invariata. Progetto Costruzioni 50 → 57 esatte, mancanti
25 → 9; voci «Come sopra» trovate 12 → 20 su 21, tutte col codice giusto. Nessun altro
contratto cambia.

**Cosa resta**: «CS02» a inizio pag. 44 letto senza la radice; 8 voci «Come sopra» senza
prezzo (cifre del P.U. troppo rovinate anche rilette); «B.03.031.e» letto per
«B.03.031.c» (lettera finale: fra lettere non si corregge, i prezzari hanno .c e .e veri).

## 14. Gecob: codici a sigla, voci con più righe di valori (17/11/2026)

L'elenco prezzi di Gecob (WBS, codice, descrizione, valori dei lavori e degli oneri, quasi
senza linee fra le voci) usciva con 3 voci giuste su 34. Non era l'OCR: i blocchi letti
sono puliti. La lettura per codici non partiva perché i codici sono sigle («PA.OC.0077»,
«NP.01») e non codici di tariffa; e il codice PA.OC.0077 ha sotto sei righe di valori
(Spalla 1, Pila 1…), una voce ciascuna nel riferimento.

Ora la lettura per codici accetta le sigle, ma solo nelle tabelle lavori + oneri (con le
sigle nelle tabelle a tre colonne GFM e SICS perdevano voci); il confine fra due voci sta
nello stacco fra le celle invece che a metà strada fra i codici; un codice senza valori
sulla sua riga e con più righe di valori sotto dà una voce per riga. Sulla pag. 7 il
testo piatto riletto da solo aggiungeva 8 righe senza codice che tornavano per caso: nel
confronto con la pagina da sola le voci col codice contano doppio. Dettaglio in
`PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.10.

**Risultato** sui 31 contratti: voci esatte 644 → **675** (71%), quantità e prezzo giusti
739 → **760** (80%), voci in più 50 → 42, testata invariata. Gecob 3 → **34 su 34**, totale
delle voci uguale al contratto (842.241,99). Nessun altro contratto cambia.

## 15. PF Future: elenco a corpo senza quantità (17/11/2026)

Si pensava che la seconda tabella di PF Future 1536/1537 (allarme, TVCC: ~30 voci) fosse
spenta dal computo `SOMMANO`. In realtà entrava già pagina per pagina, ma solo con le voci
che tornano, e quasi tutte avevano «prezzo € importo €» senza quantità, spesso col «€»
letto «e», «6» o «8» («367,76 6»). Ora il «€» si rimette sul blocco OCR del solo importo,
e prezzo e importo uguali danno quantità 1. Il computo non cambia. Nell'Excel per
Alyante una quantità «2.100» passava come 2,1: ora decide il conto della riga. Dettaglio
in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.11.

**Risultato** sui 31 contratti: voci esatte 675 → **695** (73%), quantità e prezzo giusti
760 → **782** (82%), testata invariata. PF Future 1536 35 → 44, 1537 45 → 56; mancanti
14 → 4 e 16 → 4. Nessun altro contratto cambia.

**Cosa resta** su PF Future: 31 codici storpiati o persi nel computo («SIC24_144.16.5»,
«NE.012», «S1IC24 .4.3.18.41»), con quantità e prezzo già giusti; quattro voci di computo
non lette; una quantità non stampata da dedurre (7 × 163,60).

## 16. Codici del computo ricomposti con le famiglie del documento (17/11/2026)

I 31 codici di PF Future non erano illeggibili: la riga del codice aveva sporco intorno
(numeri d'ordine, «a», «•*+990») e non veniva riconosciuta; con le descrizioni lunghe dei
quadri usciva dalle 30 righe tenute in memoria; oppure l'OCR perdeva i punti della
tariffa («SIC24 144.637») o leggeva la I della sigla 1 o 0. Ora la riga del codice
accetta lo sporco, la memoria è di 60 righe, e i codici si ricompongono con le famiglie
che il documento scrive già giuste: si rimettono i punti persi solo se portano a un solo
codice coi prefissi conosciuti, si ripara la sigla, si rimettono le lettere puntate perse
(«A.NE.012» → A.N.E.012). Le cifre non cambiano mai; un codice che non porta a un solo
codice di famiglia resta com'è. Dettaglio in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.12.

**Risultato** sui 31 contratti: voci esatte 695 → **729** (77%), quantità e prezzo giusti
782 → **783** (83%), testata invariata. PF Future villette 29 → 33/34, uffici 44 → 65/70,
residence 56 → 65/70. Nessun altro contratto cambia.

**Cosa resta** su PF Future: «S1IC24 .4.3.18.41» (persa anche una cifra), «N.2» preso
dalla descrizione «N.2 BAT2.1» come codice, tre voci di computo non lette nel residence,
due quantità non stampate (7 × 163,60, non dedotte per scelta), «22,59» con prezzo e
importo su due righe di testo, il cavo 2.100 m degli uffici sotto la griglia di pag. 21.

## 17. Griglia con la descrizione centrata, quantità 1,00 (17/11/2026)

Ulma perdeva le voci la cui riga di valori arriva senza descrizione (cella centrata in
altezza: il testo sta sopra e sotto), e due voci uguali della stessa tabella diventavano
una sola. Ora la descrizione accodata alla voce precedente dopo i suoi valori passa alla
voce senza testo, e i doppioni si tolgono solo fra finestre di testo diverse (la griglia
ripetuta in art. 5 e allegato). Una quantità «1,00» con due soli valori veniva presa per
prezzo (2.450 × 1,00, e in struttura 30 × 0,03): sistemato in parser e struttura.
Dettaglio in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.13.

**Risultato** sui 31 contratti: voci esatte 729 → **752** (79%), quantità e prezzo giusti
783 → **806** (85%), testata invariata. Ulma 14 → 23/26, L.Catania 37 → 43/46, Nigro 41 →
49/52. Nessun altro contratto cambia.

## 18. Codici del prezzario con lo spazio (17/11/2026)

AQ3 leggeva metà dei codici «SIC24 26.01.04.002» con lo spazio al posto del «_»: il
codice usciva «SIC24» o vuoto. Ora la forma è un codice intero, e una voce delle celle con
un solo numero si completa dalla riga del testo che torna e lo contiene. Dettaglio in
`PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.14.

**Risultato** sui 31 contratti: voci esatte 752 → **763** (80%), quantità e prezzo giusti
806 (85%), testata invariata. AQ3 11 → 18/31, GFM 94 → 98/108 (con le grafie SIC24 di
GFM: sporco davanti, due codici attaccati, «SKC24», spazio per un punto). Nessun altro
contratto cambia.

## 19. Testata: partita IVA con la «s», oneri «per ia» (17/11/2026)

Ticopter: la partita IVA letta «o3so9380o45» si ricompone provando 5 e 8 per la s e
tenendo la sola lettura con la cifra di controllo giusta; gli oneri «di oneri per ia
sicurezza» ora si leggono. Poi l'anticipo scritto in cifre (vince sul calcolo dalla
percentuale, anche con la o per lo zero), gli oneri «oneriper la / sicurezza» e il CIG con
uno spazio dentro. Testata sui 31 contratti 410 → **417/425 (98%)**, voci invariate.
Dettaglio in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.15.

## 20. Warm: migliaia con lo spazio, codice del titolo (17/11/2026)

Le quantità «m 1 108,00» si uniscono solo quando il conto della riga lo conferma, e il
codice della riga di titolo (NP.35) non cede più a un pezzo di descrizione («24W»,
«IP30») in testa alla riga dei valori. Warm 138 → **146/146**. Sui 31 contratti voci
esatte 763 → **771** (81%), quantità e prezzo giusti 806 → **810** (85%). Dettaglio in
`PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.16.

## 21. Cella con percentuale e P.U. oneri (17/11/2026)

Senza la linea fra «% O.S.» e «P.U. O.S.» la cella «3,448% 0,05 €» si scartava intera e
il prezzo restava quello dei soli lavori. Ora si toglie solo la percentuale. Jonico 30 →
31/35 (×2), GFM 98 → 99/108. Sui 31 contratti voci esatte 771 → **774** (82%), quantità e
prezzo giusti 810 → **812** (86%). Dettaglio in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.17.

## 22. Elenco dei mezzi, codice spezzato al punto (17/11/2026)

Il parco macchine in coda al contratto Beton (portata, anno, massa) usciva come sei voci,
perché portata × anno ≈ massa torna per caso; ora un anno senza decimali o un numero con lo
zero davanti non vale come prezzo. «B.03» + «025.a CONGLOMERATO…» si ricompone in
B.03.025.a. Beton 7/7, righe in più sui 31 contratti 38 → **33**, voci esatte 775/948.
Dettaglio in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.18.

## 23. Codice ripetuto letto male una volta (19/11/2026)

Lo stesso codice di listino su più voci, letto male su una sola («09.8» al posto di
«09.B»), prende la forma che compare più volte; vale solo per un carattere che l'OCR
scambia (8/B, 0/O, 5/S, 1/I, 2/Z, 6/G). Il riferimento Sidersipe scrive ora il diametro
delle gabbie «Ø.1000» come il programma. Sidersipe 5/5, voci esatte sui 31 contratti
775 → **778/948** (82%). Dettaglio in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.19.

## 24. Codice andato a capo, «m^²», riepiloghi (19/11/2026)

Nella tabella senza bordi di World service la cifra finale del codice andata a capo
(«PR23.NP.ARC.04» / «0») torna nel codice, e l'unità «m^²» chiude la voce NP2 che prima
spariva: World service 7/7. Sotto le griglie le righe di riepilogo senza codice né unità
con un solo importo («folale», «Oneri della sicurezza») non sono più voci. La regola dei
codici gemelli (§23) vale anche per F/P: SICS «F.01» → «P.01», 28/29. Sui 31
contratti voci esatte **782/948** (82%), quantità e prezzo giusti 813/948 (86%), righe in
più 33 → **28**. Dettaglio in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.20.

## 25. Elenco dal testo che contiene la tabella ricostruita (19/11/2026)

Quando la tabella ricostruita dalle coordinate perde voci con la descrizione di una parola
(«Imballaggio», «Trasporto»), l'elenco letto dal testo vince se le contiene tutte e ogni
voce in più ha l'unità di misura e il conto che torna. Eureka 4/4, Ticopter 2/4. Sui 31
contratti voci esatte **786/948** (83%), quantità e prezzo giusti **817/948** (86%), righe
in più 28. Dettaglio in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.21.

## 26. Prezzo esatto dall'importo (19/11/2026)

Dove il contratto stampa il prezzo ai centesimi ma l'importo è fatto col prezzo a tre
decimali (GFM: 6600 × 0,295 = 1.947,00, stampato 0,30), nell'Excel va il prezzo esatto.
GFM 102/108. Sui 31 contratti voci esatte **789/948** (83%), quantità e prezzo giusti
**820/948** (86%). Dettaglio in `PIPELINE_ESTRAZIONE_CONTRATTI.md` §4.22. Con la
quantità incollata al prezzo staccata anche nelle righe SOMMANO senza quantità (§4.23)
PF Future villette arriva a 34/34: voci esatte **790/948** (83%), quantità e prezzo giusti
**821/948** (87%). Con le continuazioni del codice GFM recuperate (§4.24: «:17.007»,
«.03» dopo una riga corta) GFM sale a 105/108 e le voci esatte a **793/948** (84%).
Senza le intestazioni di gruppo WBS e con i codici tronchi completati dal prezzo (§4.25)
Jonico arriva a 32/35: voci esatte **795/948** (84%), righe in più **25**.
Con il rotolo «RT» e «Mr» per MT nel listino di materiali (§4.26) Nigro arriva a 52/52 e
L.Catania a 44/46: voci esatte **799/948** (84%), quantità e prezzo giusti **825/948** (87%).

## 27. Scheda video e pulizia dell'immagine (23/11/2026)

**Scheda video.** Con paddle per CUDA 12.9 (`.venv-cu129`) la RTX 5060 Ti legge una pagina in
0,7 s invece di ~35 s sul processore.

*Correzione del 25/11/2026.* La prima misura del banco (281 s, 798 voci esatte) era sbagliata:
`--no-cache` salta la cache del banco ma non quella del server (`.ocr-cache`, `server/ocr.ts`),
e 718 pagine su 811 sono state prese da lì, cioè dalle letture CPU. Rifatta con la lettura vera
(`OCR_CACHE=0 PADDLE_WORKERS=1 npm run harness -- --no-cache`):

| Lettura | Testata | Voci esatte | Q+P | In più | Tempo banco |
|---|---|---|---|---|---|
| CPU (cache del 23/11, griglie ricalcolate) | 417/425 | **799** | **825** | 25 | ore |
| GPU, lotti di riconoscimento da 16 | 414/426 | 784 | 811 | 22 | 778 s |
| GPU, lotti da 8 (come la CPU) — **in uso** | **417/426** | 784 | 812 | 22 | 845 s |

- Due letture GPU della stessa pagina sono identiche (0 cifre diverse su 100 pagine): la differenza
  dalla CPU non è casuale, è il calcolo della scheda. La confidenza media resta la stessa; sulle pagine
  normali il testo è uguale al 99,1-99,9%, su quelle col retino di Progetto (pag. 39-50) all'89-98%,
  ~4% delle cifre diverse.
- Le voci perse (−15) sono soprattutto Progetto 57→51, Eureka 4→2, Gecob 34→32, PF Future uffici
  65→64: i parser sono stati messi a punto sulle letture CPU e alcuni passaggi sono fragili a una
  cifra o a una macchia letta diversamente (Eureka perde 1 × 750 e 1 × 6.000 con testo quasi uguale).
- Lotti da 16 → 8: nel lotto i ritagli si allungano al più largo, quindi la grandezza del lotto
  cambia la lettura. Con 8 tornano i tre campi di testata della CPU (Sabbie d'oro, Contratto.pdf,
  TMT) al costo del 9% di tempo; `ocr_worker.py` ora usa 8 su entrambi i dispositivi.
- Le griglie c'entrano per Gecob (correzione del 26/11: la verifica del 25/11 era sbagliata). La cache
  CPU aveva `griglia: null` salvato prima della regola del 17/11 («almeno 6 verticali bastano»), e
  `letturaDaCache` (`server/ocr.ts`) trasforma una griglia mancante in `null`, quindi non la ricalcola
  mai: la prova «griglie ricalcolate» non le aveva ricalcolate. Forzando il ricalcolo (cache in formato
  vecchio, solo l'elenco dei blocchi) le letture CPU fanno 797: Gecob 34 → 32 per la regola del 17/11,
  che il banco non mostrava. Le altre 11 voci erano davvero della lettura GPU.

Da qui in avanti la cache del banco è quella della GPU con lotti da 8 (lettura del 25/11), cioè
quella che ottiene chi usa il programma.

**Parser rimessi a punto sulle letture GPU (26/11/2026).** Sei correzioni, una per causa, ognuna
misurata sul banco intero (nessun altro contratto cambia) e con il suo test:

| Correzione | Dove | Contratto | Voci esatte |
|---|---|---|---|
| quantità 1 sottintesa già nella gara dei parser («Trasporto Cad € 6.000,00 € 6.000,00» senza l'«1») | `parser-contratti.ts` `estraiRigheGrezze` | Eureka 2 → 4 | 784 → 786 |
| sovrapprezzo senza quantità: la rilettura del solo P.U. lavori non toglie gli oneri letti sulla pagina (6,22 + 0,24) | `tabella-griglia.ts` `tabellaDaAncore` | Gecob 32 → 34 | 788 |
| bordo della cella letto «\|» attaccato all'importo («204,20 €\|») | `testo.ts` regola 4 | SICS 27 → 28 | |
| macchie lette come cifre (un «3» alto 9 px al 48% fra «cad» e il prezzo) | `tabella-griglia.ts` `senzaMacchieNumeriche` | GFM 104 → 105 | 790 |
| spazio fra sigla e anno nel codice del computo («S10 24 14.4.6.2») | `parser-contratti.ts` `RE_CODICE_SIGLA` | PF Future uffici 64 → 65 | 791 |
| quota oneri della pagina a maggioranza per le voci con gli oneri letti (una voce all'1,32% fra le 3,65% spegneva la quota) | `tabella-griglia.ts` `tabellaDaAncore` | Progetto 51 → 60 | **800** |

Risultato: con la GPU testata **417/426**, voci esatte **800/948** (84%), Q+P **827/948** (87%), una
voce in più della CPU col codice di prima (799). Le stesse regole sulle letture CPU danno 799 · 825
(Gecob 32 → 34, nient'altro cambia). Restano due voci GPU: AQ3 nolo «L50.00 €» (il bordo letto «L»
davanti al prezzo: togliere una lettera davanti a un numero è rischioso, «l» e «I» sono spesso un «1»)
e Contratto_fornitura G.01.064.3 (il codice, centrato in una cella alta, finisce sulla riga sotto quella
dei valori).

**Le ultime due voci GPU, e cinque in più (27/11/2026).** Quattro correzioni, misurate sul banco
intero (cambiano solo i tre contratti in tabella, tutti in meglio) e con i loro test:

| Correzione | Dove | Contratto | Voci esatte |
|---|---|---|---|
| angolo della cella (bordo sinistro + bordo di sotto) letto «L» davanti al prezzo: «L50.00 €» → «50.00 €». Solo la L maiuscola, solo sul blocco con il solo importo chiuso da «€»; «l» e «I» restano perché spesso sono un «1». Sulle 825 pagine il caso c'è una volta sola | `testo.ts` regola 5 | AQ3 nolo, Q+P 827 → 828 | 800 |
| codice come etichetta corta nella colonna Tariffa («Miniapala», «Miniescavatore_9 Q», «SIC24 26.01.14», «Sic. Amb/qual»): dopo il numero di riga o, se il numero manca, nella prima cella, purché a destra ci sia la descrizione lunga almeno una volta e mezza. Con più parole serve un segno da codice (cifra, «_», «.», «/»): «VOCE OPZIONALE» resta una nota. Prima il codice restava vuoto o diventava il numero di riga | `tabella-griglia.ts` `eEtichettaCodice`, `leggiCelle` | AQ3 nolo 17 → 20, Contratto.pdf 0 → 4 | 807 |
| virgola al posto del punto in un codice puntato («G.01,064.3»): codeRe non ammette virgole | `tabella-tsv.ts` `tabellaColonne` | Contratto_fornitura | 808 |
| la griglia elenco prezzi letta dal testo prende i codici della ricostruzione geometrica sulle voci con la stessa quantità e lo stesso prezzo, prima del confronto «il testo copre la tabella». Senza, la tabella aveva un codice in più, vinceva lei e si perdeva la seconda voce «3,00 × 120,00» | `parser-contratti.ts` `codiceDaPipe` | Contratto_fornitura 1 → 3 | **809** |

Risultato con la GPU: testata **417/426**, voci esatte **809/948** (85%), Q+P **828/948**; sui cinque
moduli scritti a mano (`contratti/moduli`) 114 → 116/134. Il codice centrato nella cella alta
di Contratto_fornitura (§ sopra) si aggancia già alla sua voce nella ricostruzione geometrica:
mancava solo la virgola.

Nota di metodo: per confrontare letture CPU e GPU sullo stesso codice si scambia la cartella
`.harness-cache/blocchi`; per far ricalcolare le griglie a una cache vecchia bisogna togliere anche la
chiave `griglia` dal file *e* salvarlo come solo elenco dei blocchi, perché `letturaDaCache` rende
`null` una griglia mancante.

**Pulizia dell'immagine prima dell'OCR: provata e scartata.** Quattro passi, ognuno applicato
solo alle pagine che ne avevano bisogno, con la cache del banco separata per variante:

| Variante | Pagine toccate | Testata | Voci esatte | Q+P |
|---|---|---|---|---|
| nessuna | — | 417 | **798** | **824** |
| raddrizza (gira entro la stessa cornice) | 242 | 414 | 725 | 772 |
| raddrizza (tela allargata, niente tagli) | 242 | 413 | 712 | 763 |
| stira il contrasto (inchiostro sbiadito) | 106 | 412 | 775 | 802 |
| raddrizza + sfondo + contrasto | 242+1+106 | 411 | 713 | 760 |
| togli il retino (solo Progetto e AQ3 nolo) | 15 | — | Progetto 58→45, AQ3 18→15 | — |

*Nota del 25/11:* la riga «nessuna» (798) usava in gran parte letture CPU, mentre le varianti
erano lette davvero dalla GPU (lotti da 16). Contro la base giusta (GPU, 784; Progetto 51, AQ3 18)
le varianti restano tutte peggiori: contrasto −9, raddrizza −59/−72, retino Progetto 51→45 e
AQ3 18→15. La decisione di scartarle non cambia.

Perché peggiorano, misurato e non supposto:
- **raddrizza**: la lettura OCR non cambia (confidenza 94-98% prima e dopo, stessi blocchi), cambia
  la **griglia**. Sull'elenco prezzi Jonico (pag. 6-7), storto di mezzo grado, oggi si trovano solo
  le 12 linee verticali (12×0) e le voci si dividono sui codici di tariffa (§4.9 e seguenti, messa
  a punto su questi contratti); raddrizzato, si trovano anche 25-27 orizzontali e la pagina passa
  alla lettura per celle, che su quella tabella perde voci (Jonico 32 → 7, World service 7 → 0,
  Sidersipe 5 → 1). Il raddrizzamento può servire solo insieme a una rimessa a punto della lettura
  per celle su queste tabelle: è un lavoro sui parser, non sull'immagine;
- **contrasto**: PF Future uffici e residence 65 → 59-61, Progetto 58 → 51. PaddleOCR legge
  meglio l'immagine resa come oggi (contrasto 1,35 e luminosità 1,08 del rendering);
- **retino**: togliere i puntini (macchie fino a 6 px nelle zone fitte) fa sparire anche parte delle
  cifre sottili su quel fondo e cambia quali celle si rileggono: le voci mancanti di Progetto
  salgono da 9 a 35. La rilettura cella per cella con tre pulizie (§3, `rileggi_celle`) resta la
  strada migliore per quelle tabelle;
- **sfondo**: una sola pagina del banco ha la carta grigia (il rendering la schiarisce già).

Il codice della prova (passi in `ocr_worker.py`, chiave di cache con i passi e la versione) non è
entrato nel programma: sta in [prove/pulizia-pagina-2026-11-23.patch](prove/pulizia-pagina-2026-11-23.patch)
(`git apply` dalla cartella del repo, poi `PADDLE_PULIZIA=raddrizza npm run harness`), se si vuole
riprovare con scansioni diverse (foto dal telefono storte di qualche grado, dove raddrizzare
dovrebbe pesare di più) o dopo aver rimesso a punto la lettura per celle.

## 28. Modelli PP-OCRv5 server (27/11/2026)

Prova della voce 167 dell'elenco della suite: i modelli grandi di PaddleOCR al posto dei
`mobile` in uso, sulla scheda video (`.venv-cu129`; il vecchio `.venv-gpu` su questa scheda non
legge niente, 0 righe). Scaricati da soli al primo uso in `~/.paddlex/official_models`:
`PP-OCRv5_server_det` 85 MB, `PP-OCRv5_server_rec` 82 MB.

**Su una pagina** (Progetto Costruzioni, pag. 3):

| Modelli | Tempo a pagina | Righe | Lettura |
|---|---|---|---|
| mobile det + latin mobile rec (in uso) | 1-2 s | 63 | giusta |
| **server det** + latin mobile rec | 20-24 s | 60 | «B45oc» al posto di «B450c» |
| mobile det + **server rec** | 1,5-2,4 s | 63 | «calcesfruzzo», «Lavorazloni», «accialo», «conformita» |

Il riconoscitore grande è fatto per cinese e inglese: sull'italiano legge peggio del `latin`
specializzato, quindi per la pagina intera resta il `latin_PP-OCRv5_mobile_rec`.

**Sulle sole celle rilette.** Le cifre sul fondo retinato dell'allegato A di Progetto erano il
problema rimasto (§ sopra, «Cosa resta»): il riconoscitore grande lo legge meglio. Prova sul banco
dei 31 contratti con le pagine lette come sempre (cache del banco) e le sole celle dei numeri che
non tornano (§3, `rileggi_celle`) rilette con un modello o con l'altro (`HARNESS_BLOCCHI` su una
copia della cache senza le celle; `tools/harness.ts`):

| Celle rilette con | Testata | Voci esatte | Q+P | Tempo banco |
|---|---|---|---|---|
| latin mobile (com'era; controllo) | 417/426 | 809/948 | 828 | 246 s |
| **PP-OCRv5_server_rec** — **in uso** | 417/426 | **823/948** | **842** | 255 s |
| tutti e due (sei letture per cella) | 417/426 | 819/948 | 838 | 309 s |

- Il controllo ridà esattamente i numeri di prima: le riletture sono deterministiche e il
  confronto vale.
- Cambia solo Progetto Costruzioni: 60 → 74 voci esatte su 142 (quantità e prezzo giusti 43 →
  54). Fra le voci recuperate «396,37 × 22,50», «165,42 × 16,50», «232,04 × 22,50» (prima
  «2891 × 4,6755»). Quattro voci peggiorano (due B.03.035.c, B.05.030 11.029,88, I.01.009 8,80),
  il saldo è +14.
- Tutti e due insieme va peggio del solo grande: con sei letture per cella i conti tornano anche
  per caso, come già visto con le varianti accorciate (§3).
- Gecob perdeva due prezzi di un centesimo (NP.19 23,41 invece di 23,40, NP.21 180,01 invece di
  180,00): il grande legge giusto il P.U. dei lavori (22,55 e 173,43, prima illeggibili) e la
  quota oneri della pagina, che è calcolata e non stampata, lo completava arrotondando male. Ora,
  quando anche il P.U. oneri è riletto sicuro (stesso valore da almeno due pulizie), il prezzo è
  la somma P.U. lavori + P.U. oneri, se sta entro un centesimo e mezzo dalla stima della quota
  (`tabellaDaAncore`, campo `oneri` di `ValoriVoce`). Il caso per cui la somma non si faceva
  («1,24» letto «1,20» tre volte: 33,96 contro 34,00) resta fuori.

Misura finale sulla cache buona coi default nuovi: **823/948** voci esatte, **842** Q+P, testata
417/426; moduli compilati a mano (`contratti/moduli`) 116/134 come prima.

Nel programma: `PADDLE_REC_CELLE` (default `PP-OCRv5_server_rec`, `server/config.ts`
MODELLI_CELLE) passato dal server a ogni worker (`ocr_worker.py`, `modelli_celle`). In cache, accanto
alle celle, i modelli con cui sono state lette (`modelliCelle`): se cambiano, le celle si rileggono
tutte una volta (`completaRiletture`). Le pagine già in cache del programma prendono così le letture
nuove alla prima riapertura, senza rifare l'OCR della pagina.

**Rilevamento grande sulla pagina intera** (`PADDLE_DET_MODEL=PP-OCRv5_server_det`, rilettura
vera: `OCR_CACHE=0`, altrimenti le pagine arrivano dalla cache del server, §27). Solo su Progetto
Costruzioni, il contratto con le cifre retinate, con le celle già rilette dal riconoscitore grande:

| Rilevamento | Pagine | Voci esatte Progetto | Banco intero | Tempo |
|---|---|---|---|---|
| mobile (in uso) | 50 | 74/142 | 823/948 | 120 s (2,4 s a pagina) |
| server, tutte le pagine | 50 | 95/142 | 844/948 | 1.560 s (31 s a pagina) |
| server sulle sole pagine con celle da rileggere (39-49) | 11 server + 39 mobile | 95/142 | **844/948** | ~6 min in più su Progetto |

- Il controllo (mobile riletto da capo) ridà i numeri della cache: la differenza è del modello.
- Sul banco solo 19 pagine OCR su 748 hanno celle da rileggere (Progetto 11, Gecob 3, Jonico 2+2,
  Progetto sub 1): con il rilevamento grande solo lì il costo sarebbe ~10 minuti su tutto il banco,
  zero sui contratti puliti.
- Delle 11 pagine: 29 voci migliorano e 8 peggiorano (valori presi dalla riga accanto, «165,42 ×
  16,50» diventa «40,6 × 16,50»), saldo +21.
- **Non entrato nel programma**: 31 s a pagina sulle pagine retinate vuol dire 6 minuti in più su
  un contratto come Progetto. Da decidere se vale (seconda passata col rilevamento grande sulle
  sole pagine con voci che non tornano, spegnibile). Le pagine rese sono 2333×3300: un limite al
  lato lungo per il solo rilevamento grande ridurrebbe il tempo, da misurare.

## Fonti

- PaddleOCR, release e documentazione: [GitHub](https://github.com/PaddlePaddle/PaddleOCR), [release 3.0–3.7](https://paddleocr.dev/releases), [PP-StructureV3](https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-StructureV3/PP-StructureV3.html), [PaddleOCR-VL-1.6](https://www.paddleocr.ai/latest/en/version3.x/algorithm/PaddleOCR-VL/PaddleOCR-VL-1.6.html), [PaddleOCR-VL-1.6 ONNX (tempi CPU della comunità)](https://huggingface.co/iaa2005/PaddleOCR-VL-1.6-ONNX)
- Confronti fra motori: [Docsumo, best OCR models 2026](https://www.docsumo.com/blog/best-ocr-models), [LlamaIndex, Best OCR Models in 2026](https://www.llamaindex.ai/agents/best-ocr-models-in-2026-accuracy-speed-and-cost-compared), [Docling technical report](https://arxiv.org/html/2408.09869v5), [confronto Marker/Docling/MinerU](https://themenonlab.blog/blog/best-open-source-pdf-to-markdown-tools-2026), [MinerU2.5](https://arxiv.org/html/2509.22186v2)
- Estrazione con modelli e regole: [invoice2data](https://invoice2data.readthedocs.io/latest/how-it-works.html), [img2table](https://github.com/xavctn/img2table), [LexNLP](https://lexpredict-lexnlp.readthedocs.io/en/latest/about.html)
- Controlli aritmetici sulle righe: [Rossum](https://developers.rossum.ai/docs/quantity-times-unit-price-equals-total-amount), [ABBYY FlexiCapture](https://help.abbyy.com/en-us/flexicapture/12/standalone_administrator/ir_orders_rules), [Tungsten](https://docshield.tungstenautomation.com/RSI/en_US/6.2.0-p9yuqqbcd8/help/INI/RSI_INI_help/EIGLOBALEXTRA/c_DoLineItemRowTotalValidation.html), [Continia](https://docs.continia.com/en-us/continia-document-capture/new-and-planned/previous-release-plans/march-2020-to-march-2021/purchase-documents/auto-calculation-of-line-values/)
- Commerciali e settore: [ABBYY FlexiCapture, alternative e prezzi stimati](https://nanonets.com/blog/abbyy-flexicapture-alternatives/), [TeamSystem TS Engineering AI](https://www.teamsystem.com/construction/ts-engineering-ai/funzionalita/ai-computi-metrici/), [TeamSystem DMS](https://www.teamsystem.com/enterprise/dms-archiviazione-documentale-ts-enterprise), [ACCA PriMus](https://www.accasoftware.com/en/PriMus), [Archim](https://www.archim.ai/acquisizione-documenti)
