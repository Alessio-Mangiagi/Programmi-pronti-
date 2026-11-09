<!-- "><(((º> sabusabu <º)))>< -->
# OCR migliori e soluzione per leggere i contratti senza AI

Ricerca e misure del 09/11/2026. Domanda: esistono OCR migliori di quello in uso? Qualcuno
ha già risolto il problema di passare da un contratto scansionato all'Excel per Alyante?
Come si arriva a un programma che funziona **senza AI**, con l'AI solo di supporto?

## 1. In breve

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
| **PP-StructureV3** (stessa libreria) | Layout + tabelle (SLANeXt, rilevatore di celle) → Markdown/HTML | ~8 s/pagina su Xeon nelle misure ufficiali | Sì | Il candidato più naturale. Servono `paddlex[ocr]` e alcune centinaia di MB di modelli: la prova non si è potuta fare qui perché il download dei modelli è bloccato dalla politica TLS di questa sessione. Va fatta con l'IT |
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

**c) PP-StructureV3:** non eseguita. Le dipendenze (`paddlex[ocr]`) sono state installate
in un ambiente di prova separato, ma il download dei modelli è stato bloccato dalla politica
TLS della sessione. Il venv di produzione non è stato toccato.

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

- **PP-StructureV3 sui 31 contratti**, con l'IT per il download dei modelli: se le sue
  tabelle sono migliori del passo 4, lo si usa al posto del prototipo OpenCV. Su CPU costa
  ~8 s/pagina in più.
- **GPU** (paddle cu129 per la RTX serie 50): accelera l'OCR attuale e rende praticabile
  PaddleOCR-VL come «secondo parere» locale sulle pagine difficili. Resta un modello AI,
  quindi solo come supporto, come Claude.

## Fonti

- PaddleOCR, release e documentazione: [GitHub](https://github.com/PaddlePaddle/PaddleOCR), [release 3.0–3.7](https://paddleocr.dev/releases), [PP-StructureV3](https://www.paddleocr.ai/main/en/version3.x/algorithm/PP-StructureV3/PP-StructureV3.html), [PaddleOCR-VL-1.6](https://www.paddleocr.ai/latest/en/version3.x/algorithm/PaddleOCR-VL/PaddleOCR-VL-1.6.html), [PaddleOCR-VL-1.6 ONNX (tempi CPU della comunità)](https://huggingface.co/iaa2005/PaddleOCR-VL-1.6-ONNX)
- Confronti fra motori: [Docsumo, best OCR models 2026](https://www.docsumo.com/blog/best-ocr-models), [LlamaIndex, Best OCR Models in 2026](https://www.llamaindex.ai/agents/best-ocr-models-in-2026-accuracy-speed-and-cost-compared), [Docling technical report](https://arxiv.org/html/2408.09869v5), [confronto Marker/Docling/MinerU](https://themenonlab.blog/blog/best-open-source-pdf-to-markdown-tools-2026), [MinerU2.5](https://arxiv.org/html/2509.22186v2)
- Estrazione con modelli e regole: [invoice2data](https://invoice2data.readthedocs.io/latest/how-it-works.html), [img2table](https://github.com/xavctn/img2table), [LexNLP](https://lexpredict-lexnlp.readthedocs.io/en/latest/about.html)
- Controlli aritmetici sulle righe: [Rossum](https://developers.rossum.ai/docs/quantity-times-unit-price-equals-total-amount), [ABBYY FlexiCapture](https://help.abbyy.com/en-us/flexicapture/12/standalone_administrator/ir_orders_rules), [Tungsten](https://docshield.tungstenautomation.com/RSI/en_US/6.2.0-p9yuqqbcd8/help/INI/RSI_INI_help/EIGLOBALEXTRA/c_DoLineItemRowTotalValidation.html), [Continia](https://docs.continia.com/en-us/continia-document-capture/new-and-planned/previous-release-plans/march-2020-to-march-2021/purchase-documents/auto-calculation-of-line-values/)
- Commerciali e settore: [ABBYY FlexiCapture, alternative e prezzi stimati](https://nanonets.com/blog/abbyy-flexicapture-alternatives/), [TeamSystem TS Engineering AI](https://www.teamsystem.com/construction/ts-engineering-ai/funzionalita/ai-computi-metrici/), [TeamSystem DMS](https://www.teamsystem.com/enterprise/dms-archiviazione-documentale-ts-enterprise), [ACCA PriMus](https://www.accasoftware.com/en/PriMus), [Archim](https://www.archim.ai/acquisizione-documenti)
