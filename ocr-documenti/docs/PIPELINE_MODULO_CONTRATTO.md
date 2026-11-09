<!-- "><(((º> sabusabu <º)))><" -->
# Pipeline di estrazione — MODULO CONTRATTO (struttura fissa, letta alla lettera)

Le tre pipeline documentate accanto a questa ([articoli](PIPELINE_ESTRAZIONE_ARTICOLI.md),
[prestazioni](PIPELINE_ESTRAZIONE_PRESTAZIONI.md), [famiglie di contratto](PIPELINE_ESTRAZIONE_CONTRATTI.md))
leggono il contratto **così com'è** e devono indovinare dove stanno le cose. Questa fa il
contrario: definisce una **struttura fissa** — il *modulo contratto* — che chi conosce il
contratto compila a mano, e il programma la legge **alla lettera**:

- **niente OCR**: il modulo è testo (`.txt`, `.md`) o Word (`.docx`);
- **niente parser euristici**: ogni valore ha la sua etichetta, non si cerca nulla;
- **niente assist AI**: la route non chiama Ollama, nemmeno sui campi vuoti;
- **niente riparazioni**: i codici articolo, i numeri, le righe ripetute escono come
  sono stati scritti (`strutturaAlyante(e, { fedele: true })`).

Quello che il programma **fa** è **validare**: formato dei numeri, delle date, dei codici,
coerenza `quantità × prezzo = importo`, campi obbligatori, colonne della tabella. Un modulo
con un errore viene **respinto** con l'elenco completo (riga e motivo). Dopo la lettura
restano gli agganci agli **elenchi ufficiali** (`normalizzaConElenchi`: commessa, DIVISIONE,
condizioni di pagamento, conto, FAM/SFAM) e la costruzione dell'Excel, identici al percorso OCR.

Serve quando il documento non si lascia leggere (scansione pessima, layout mai visto, nolo
senza allegato) o quando i dati arrivano già pronti da un altro ufficio.

---

## 1. La struttura

Specifica e lettore stanno in **`src/lib/modulo-contratto.ts`**, condiviso fra server e
browser; il modulo vuoto esce da lì (`moduloVuoto()`), quindi è sempre allineato ai campi.
Copie pronte in [`docs/modulo/`](modulo/) (`npx tsx tools/genera_modulo.ts` le rigenera).

```
MODULO CONTRATTO OCR v1          ← prima riga non vuota: è il riconoscimento
# le righe che iniziano con # sono spiegazioni e vengono ignorate

[TESTATA]
CODICE CONTRATTO: 208-148_042/2026
COMMESSA: 208-148
DITTA:
FORNITORE: Edil Rossi S.r.l.
PARTITA IVA FORNITORE: 01234567890
TIPOLOGIA: Subappalto
DATA CONTRATTO: 12/03/2026
DATA DOCUMENTO:
CONDIZIONI DI PAGAMENTO: 60 gg DFFM bonifico
OGGETTO: Opere in c.a. del viadotto Morello
CIG:
CUP:
DIVISIONE:

[IMPORTI]
IMPORTO LAVORI: 157.200,00
ONERI SICUREZZA: 3.100,50
IMPORTO NETTO:
ANTICIPO:
RECUPERO ANTICIPO %:
RITENUTA GARANZIA %: 5
CODICE RG:
CODICE RI:

[RIGHE]
ARTICOLO | DESCRIZIONE | UM | QUANTITA | PREZZO | IMPORTO
B.03.025.a | Conglomerato cementizio C25/30 | mc | 120,00 | 95,50 | 11.460,00
 | Voce senza codice | corpo | | |

[FINE]
```

| Sezione | Contenuto | Dove finisce |
|---|---|---|
| `[TESTATA]` | `ETICHETTA: valore`, una per riga | `testata.*` dell'Estratto (`codice`, `codice_progetto`, `ditta`, `fornitore`, `fornitore_piva`, `tipologia_contratto`, `data_contratto`, `documento_data`, `cond_pagamento`, `oggetto`, `cig`, `cup`, `divisione`) |
| `[IMPORTI]` | `ETICHETTA: valore` | `importi.*` (`importo_lavori`, `importo_oneri_sicurezza`, `importo_netto`, `importo_anticipi`, `percent_recupero_anticipazioni`, `ritenuta_garanzia_percent`, `ritenuta_garanzia_codice`, `ritenuta_ingresso_codice`) |
| `[RIGHE]` | intestazione + una voce per riga, celle `a \| b \| c` | `righe[]` (`codice_epu`, `descrizione`, `udm`, `quantita`, `prezzo_lordo`, `importo`; facoltative `conto`, `famiglia`, `sottofamiglia`) |
| `[FINE]` | nulla dopo | — |

Le etichette si confrontano senza maiuscole, accenti e punteggiatura e hanno **alias**
(`Numero contratto`, `P.IVA`, `Qtà`, `Prezzo unitario`…: l'elenco è in `CAMPI_TESTATA`,
`CAMPI_IMPORTI`, `COLONNE_RIGHE`). Le colonne possono stare in qualsiasi ordine: comanda
l'intestazione. Una tabella Markdown (`| a | b |` con riga `|---|`) va bene uguale.

**Obbligatori**: CODICE CONTRATTO, TIPOLOGIA, DATA CONTRATTO, OGGETTO e il fornitore
(ragione sociale o partita IVA). Tutto il resto può restare vuoto: vuoto = assente, mai
inventato (come per l'OCR).

## 2. Cosa viene validato (e respinto)

| Controllo | Esempio di errore |
|---|---|
| prima riga = `MODULO CONTRATTO OCR v1` | `riga 1: la prima riga deve essere "MODULO CONTRATTO OCR v1"` |
| etichetta nota e nella sezione giusta | `riga 8: etichetta "COLORE" sconosciuta in [TESTATA]` · `"IMPORTO LAVORI" va nella sezione [IMPORTI]` |
| campo una volta sola | `riga 12: "OGGETTO" compare due volte` |
| numeri in formato italiano | `IMPORTO LAVORI: "1,570.00" non è un numero in formato italiano (es. 1.234,56 …)` |
| date `GG/MM/AAAA` esistenti | `data "2026-01-01" non in formato GG/MM/AAAA` · `data "31/02/2026" non esiste` |
| tipologia nell'elenco | `tipologia "Cottimo" non ammessa: una tra Passivo a Misura \| Subappalto \| …` |
| CIG 10, CUP 15, P.IVA 11 cifre, RG `RGnn[n]`, RI `Rnnn`, DIVISIONE 2 cifre | `CIG "123" non ha 10 caratteri` |
| `[RIGHE]`: intestazione con le 6 colonne, stesse celle per ogni voce | `la riga ha 5 celle, l'intestazione 6` |
| voce con almeno ARTICOLO o DESCRIZIONE | `voce senza ARTICOLO né DESCRIZIONE` |
| `quantità × prezzo = importo` (1%) quando ci sono tutti e tre | `IMPORTO 25,00 ≠ QUANTITA × PREZZO (20,00)` |
| obbligatori presenti | `manca TIPOLOGIA (obbligatorio)` |
| niente testo fuori sezione o dopo `[FINE]` | `riga 40: testo dopo [FINE]` |

Le uniche trasformazioni, dichiarate: la tipologia torna alla grafia canonica
(`subappalto` → `Subappalto`), la P.IVA perde il prefisso `IT`, il `%` in coda alle
percentuali viene tolto, i codici RG/RI vanno in maiuscolo, l'unità di misura in minuscolo.

## 3. Flusso

```
Modulo .txt/.md ──► App.tsx (eModulo) ──► POST /api/ocr { text, format:'contratti', origine:'nativo' }
Modulo .docx ─────► docxATesto: celle a "|" ─┘                       │
Modulo in PDF ────► testo di TUTTE le pagine (layer o OCR) ─► { …, impaginato: true }
  (stampato o scansionato; lavori lato server: server/lavori.ts, stessa funzione)
                                                                     ▼
                                    server.ts: eModulo(text) → leggiModulo(text)
                                        errori → 400 "Modulo contratto non valido (N errori): riga …"
                                        ok     → strutturaAlyante(e, { fedele: true })
                                                 → normalizzaRisultatoAlyante (elenchi ufficiali)
                                                 → JSON ALYANTE → Import_Contratti.xlsx
```

- **Frontend** ([src/App.tsx](../src/App.tsx)): un `.txt`/`.md` in coda che inizia con la
  riga di versione non è più "un risultato salvato" ma un documento da elaborare in
  IMPORT P6 (`loadPreview`, `runScan`, `ocrFile`). Il pulsante **Modulo contratto vuoto**
  scarica `Modulo_contratto_OCR.txt`.
- **Word** ([src/lib/file-input.ts](../src/lib/file-input.ts) `docxATesto`): se il testo
  convertito è un modulo, la conversione si rifà con le celle delle tabelle separate da
  `|`, **vuote comprese** (`docxHtmlATesto(html, ' | ')`): nelle tabelle a colonne fisse
  una cella vuota saltata farebbe slittare quantità e prezzi. Sui contratti veri il
  separatore resta lo spazio, come prima.
- **Server** ([server.ts](../server.ts)): il ramo modulo sta prima di tutto il resto
  della route; `estraiAssistito` non viene mai chiamata. `testata.famiglia_contratto`
  vale `modulo`, così nel pannello si vede quale "maschera" ha lavorato.
- **Struttura** ([server/struttura.ts](../server/struttura.ts)): `fedele` salta
  `recuperaCodiciRighe`, lo scarto delle righe corte, la deduplica e la riparazione dei
  valori slittati. FAM/SFAM scritte sulla riga vincono sul classificatore a parole chiave
  e vengono comunque validate sull'elenco ufficiale.

### Modulo impaginato: PDF stampato o scansione

Il modulo si può anche **stampare in PDF, firmare e scansionare**: il programma lo
riconosce dalla riga di versione in testa alla prima pagina e lo legge **tutto insieme**,
non pagina per pagina (nel browser `runScan` controlla la prima pagina prima di partire;
sul server `server/lavori.ts` controlla il testo unito). Il testo arriva con
`impaginato: true` e `leggiModulo(testo, { aCapo: true })` ([src/lib/modulo-contratto.ts](../src/lib/modulo-contratto.ts)):

- **righe a capo ricucite** (`ricuciACapo`): in `[TESTATA]`/`[IMPORTI]` una riga senza
  etichetta conosciuta continua il campo precedente; in `[RIGHE]` una riga senza `|`
  continua la DESCRIZIONE della voce sopra (dopo un trattino attaccato si riattacca senza
  spazio: `CEI 92-` + `1`). Una continuazione dopo una nota `#` resta un errore;
- **intestazione della tabella ripetuta** su ogni pagina e **separatori `---`** spariscono;
  il piè di pagina si scrive come nota (`# Pagina 1 di 3`) e il lettore lo salta;
- **intestazione con un `|` perso** (`UM QUANTITA`): la cella fatta solo di etichette si divide;
- **voce con `|` persi o letti come `1`** dalla scansione (`voceRicostruita`): si rilegge
  dalla coda — ultimo numero = IMPORTO, QUANTITA e PREZZO = la coppia prima di lui con
  `quantità × prezzo = importo` (1%), poi UM, codice (prima parola con cifre, `.` o `_`) e
  descrizione. **È l'aritmetica a rendere sicura la ricostruzione**: una voce senza
  importo, o che non torna, resta respinta con l'errore della lettura alla lettera;
- la **TABELLA ARTICOLI ricostruita** che l'OCR accoda a ogni pagina scansionata
  (`senzaTabellaRicostruita`, in [server/modulo.ts](../server/modulo.ts)) viene tolta:
  nel modulo la tabella c'è già.

Nell'interfaccia: gli errori di un modulo impaginato riportano anche il testo letto
della riga (`ErroreModulo.letta`, in `descriviErrori`: il numero di riga è quello del
testo estratto, che sul PDF non si vede); le voci ricostruite hanno `ricostruita:
'scansione'` e l'etichetta *N voci ricostruite dalla scansione* (non contano fra le righe
da rivedere: su GFM erano 64 su 108, tutte giuste); un PDF col testo che è un modulo si
riconosce già in coda (`MetaFile.modulo`, da `miniaturaFile`) e non chiede la bozza Word.

Su un `.txt` o un Word queste indulgenze **non** valgono: lì una riga senza etichetta o
senza `|` è un errore di battitura e va segnalata.

Il PDF si ottiene con `npm run modulo-in-pdf` ([tools/modulo_in_pdf.ts](../tools/modulo_in_pdf.ts),
Edge headless): per ogni `*_modulo.txt` scrive in `contratti/formattati/` il PDF col testo
e la sua versione "scansionata" (200 DPI, scala di grigi, sfocatura e rumore,
[tools/pdf_come_scansione.py](../tools/pdf_come_scansione.py)).

### Il giro inverso: documento → modulo

```
Documento in coda ──► menu ⋮ «Converti in modulo contratto» (App.tsx: convertiInModulo)
   risultato IMPORT P6 già in coda? ── sì ──► si usa quello (anche corretto in Modifica)
                                    └─ no ──► voce.testo || ocrFile(f,'md') → POST /api/ocr contratti
                                                       │
                                                       ▼
                 moduloDaRisultato(json) → { testo, avvisi, errori } → <nome>_modulo.txt
                                                       │ errori? ── sì ──► stop, niente Excel (banner rosso)
                                                       ▼ no
                 POST /api/ocr { text: modulo, contratti, nativo } → risultatoDaModulo (alla lettera, no AI)
                                                       │
                                                       ▼
            buildImportContrattiRowsFromAlyante → <nome>_modulo_Import_Contratti.xlsx
            + il risultato della voce in coda diventa quello del modulo (pannello, «↓ Excel»)
```

Nell'app il nucleo è `moduloEExcel(i)` in [App.tsx](../src/App.tsx), che restituisce
l'esito senza scrivere banner. Lo chiamano la voce del menu ⋮ (`convertiInModulo`) e il
pulsante **⇄ Modulo + Excel** in colonna destra (`convertiSelezionatiInModulo`: tutte le
voci convertibili o solo le spuntate, una dopo l'altra, riepilogo finale). L'Excel nasce
dal modulo e non dal JSON dell'estrazione: dedup, commessa indovinata e riparazioni OCR
non ci sono, quindi Excel e `.txt` coincidono voce per voce. Prova dal vivo (Edge
headless, nolo Ulma): 16 voci nel modulo, 16 righe nell'Excel, articolo, quantità e
prezzo uguali.

`moduloDaRisultato` ([src/lib/modulo-contratto.ts](../src/lib/modulo-contratto.ts)) è
una funzione pura, condivisa: la usano l'app e `tools/harness.ts`, che scrive
`modulo.txt`. Regole:

- **Cambia la forma, non il valore.** Numeri inglesi o `number` JSON diventano
  `1.234,56`, date `G/M/AA`, `GG.MM.AAAA` e ISO diventano `GG/MM/AAAA`, DIVISIONE `3`
  diventa `03`. Spazi e a-capo diventano uno spazio, il `|` dentro un testo diventa `/`
  perché è il separatore.
- **Mai aggiustato.** Un valore che `validaValore` respingerebbe lascia il campo vuoto e
  finisce in `# DA VERIFICARE` sopra di esso. Una voce con `importo ≠ qta × prezzo` resta
  com'è e viene segnata. Una voce senza articolo né descrizione resta in commento.
- **Tabella con cornice** `| … |`: una voce con codice `#14` non diventa un commento.
  Le colonne CONTO/FAM/SFAM compaiono solo se usate. FAM/SFAM vengono dalle
  `anagrafiche_articoli`.
- **Controllo finale.** Il testo prodotto ripassa da `leggiModulo`. Gli `errori` sono
  esattamente ciò che il programma rifiuterebbe ricaricandolo, e l'app li mostra con la
  riga. Gli `avvisi` puntano alla riga del campo o della voce, non al commento.
- **Campi senza posto nel modulo**: le chiavi estratte non previste restano in un blocco
  di commento promemoria. Fanno eccezione quelle che il programma ricava da solo,
  come `elenco_prezzi` e `famiglia_contratto`.

### Verifica offline: `npm run moduli`

[`tools/verifica_moduli.ts`](../tools/verifica_moduli.ts) rilegge i moduli compilati
(default `contratti/moduli/`, cartella ignorata da git perché contiene dati aziendali) con
**la stessa funzione della route**: `risultatoDaModulo(text, format)` in
[server.ts](../server.ts), da cui ora passa anche `/api/ocr`. Ollama è puntato su una porta
morta: se qualcosa chiamasse l'AI fallirebbe. Per ogni modulo scrive `<nome>.alyante.json` e
`<nome>_Import_Contratti.xlsx` (righe di `buildImportContrattiRowsFromAlyante`, elenchi
passati con `impostaElenchi` di `src/lib/elenchi-client.ts`) e stampa somma delle voci contro
`IMPORTO LAVORI` e codici agganciati. Esce con 1 se un modulo è respinto.

Prima prova (04/11/2026), cinque contratti compilati a mano dai PDF: fornitura e subappalto
Ticopter (193-136_2), subappalto GFM Impianti (159-115, 108 voci), subaffidamento TMT
Trasporti (177-125), subappalto Progetto Costruzioni (195-137_6). Tutti letti senza errori;
quattro su cinque con somma delle voci = importo dell'Art. 4 al centesimo. Il subappalto
Ticopter no (193.416,80 contro 234.636,80): la differenza è nel documento, non nel modulo,
ed è segnata `# DA VERIFICARE`.

### Scansione del programma contro modulo: `npm run confronta-moduli`

[`tools/confronta_moduli.ts`](../tools/confronta_moduli.ts) usa i moduli compilati a mano
come **valore giusto** e li mette accanto a quello che il programma estrae da solo
(`npm run harness`, output in `tests/out/<pdf>/alyante.json`). Il PDF d'origine si ricava
dal commento `# Modulo compilato a mano leggendo "…pdf"` in testa al modulo. Entrambi
passano da `buildImportContrattiRowsFromAlyante`, quindi si confrontano le celle che vanno
in Alyante:
- **testata**: DITTA, CODICE CONTRATTO, PROGETTO, FORNITORE, DIVISIONE, DATA, anticipi,
  oneri, COND.PAG, OGGETTO (somiglianza ≥ 60% delle parole = "simile"), CIG, CUP, RG, RI;
- **voci**: tre passate su tutto l'elenco: esatte (codice + quantità + prezzo), poi stesso
  codice con valori diversi, poi stessi valori con codice diverso; il resto è mancante o
  in più.
Scrive `_confronto.md` e `_confronto.json` accanto ai moduli (cartella non versionata).

Con `--variante formattato` (o `formattato_scansione`) il confronto si fa invece sul PDF
ricavato dal modulo stesso (`npm run modulo-in-pdf`, poi
`npm run harness -- --cartella contratti/formattati`) ed esce in `_confronto_<variante>.md`.
Misura del 05/11/2026 sui 5 contratti di prova (colonne di testata giuste · voci esatte):

| Contratto | PDF originale | Modulo in PDF | Modulo in PDF scansionato |
|---|---|---|---|
| GFM Impianti | 12/15 · 58/108 | 15/15 · 108/108 | 15/15 · 108/108 |
| TMT Trasporti | 8/14 · 2/5 | 14/14 · 5/5 | respinto: 1 voce senza quantità né importo con un `\|` perso |
| Ticopter fornitura | 11/14 · 1/4 | 14/14 · 4/4 | 14/14 · 4/4 |
| Ticopter subappalto | 10/15 · 0/13 | 15/15 · 13/13 | 15/15 · 13/13 |
| Progetto Costruzioni | 9/15 · 0/4 | 15/15 · 4/4 | 15/15 · 4/4 |

Sulle scansioni restano gli errori dell'OCR nel testo libero (119 descrizioni identiche su
129, `S.r.l.` letto `S.r.I.`): codici, quantità, prezzi e importi tornano tutti.

### Modulo compilato dal solo testo OCR (.MD): `--da-moduli`

Prova del 06/11/2026: il modulo si può compilare partendo **non dal PDF ma dal testo .MD**
che il programma ricava dalla scansione (`tests/out/<pdf>/ocr.txt`, lo stesso testo del
formato .MD dell'app, copiato in `contratti/moduli-da-md/_md/`)? Ogni modulo l'ha
compilato un agente Claude nuovo, che vedeva solo quel testo, il modulo vuoto e gli
elenchi ufficiali. Non vedeva il PDF né i moduli di riferimento: è una prova alla cieca.
Poi `npm run moduli -- contratti/moduli-da-md` lo ha riletto (errori → correzione del
solo formato) e `npm run confronta-moduli -- --da-moduli contratti/moduli-da-md` lo ha messo
accanto al modulo fatto dal PDF (uscita `contratti/moduli/_confronto_moduli-da-md.md`).
Colonne di testata giuste · voci esatte, rispetto al modulo compilato dal PDF:

| Contratto | Modulo dal testo .MD | Programma da solo (harness) | Excel di Claude dal PDF |
|---|---|---|---|
| GFM Impianti | 15/15 · 106/108 | 12/15 · 58/108 | 12/15 · 62/108 |
| TMT Trasporti | 14/14 · 5/5 | 8/14 · 2/5 | 8/14 · 0/5 |
| Ticopter fornitura | 11/14 · 4/4 | 11/14 · 1/4 | 12/14 · 2/4 |
| Ticopter subappalto | 15/15 · 13/13 | 10/15 · 0/13 | 11/15 · 0/13 |
| Progetto Costruzioni | 15/15 · 4/4 | 9/15 · 0/4 | 9/15 · 0/4 |
| **Totale** | **70/73 · 132/134** | 50/73 · 61/134 | 52/73 · 64/134 |

- I 5 moduli sono stati accettati, 4 al primo giro. La somma delle voci torna con l'importo
  lavori su 4/5; il quinto, il subappalto Ticopter, ha la stessa differenza del modulo dal
  PDF, che sta nel documento.
- Le 2 voci GFM "diverse" sono una scelta di arrotondamento: importo/quantità 0,885 e
  1,545 invece dei prezzi stampati 0,89 e 1,55. Valgono entrambe.
- Ticopter fornitura: FORNITORE e CUP stanno sulla pagina 1, che l'OCR non ha letto (nel
  testo non c'è la P.IVA). La DIVISIONE 08 invece della 02 viene dalle istruzioni date
  all'agente: diceva "Passivo a Misura + 08" per ciò che non ha una tipologia propria.
- Quello che rende il modulo affidabile è il controllo del programma, più di chi lo
  compila: `quantità × prezzo = importo` e la somma contro l'importo lavori. Con questi
  controlli l'agente ha ricomposto i codici spezzati su due righe (SIC24), le quantità
  divise ("1.100,00 0,00" → 1.100.000,00) e i numeri con lettere ("852.0o0"). L'Excel fatto
  da Claude direttamente dal PDF non ha questi controlli.

### Estrazione del programma contro gli Excel di Claude: `npm run confronta-claude`

[`tools/confronta_claude.ts`](../tools/confronta_claude.ts) mette l'estrazione dell'harness
(senza AI) accanto agli Excel Import_Contratti preparati da Claude in modalità Claude
(`contratti/scansioni/`, abbinati al PDF dal nome del file). Usa lo stesso confronto di
celle di `confronta-moduli` ([`tools/confronto-excel.ts`](../tools/confronto-excel.ts)).
Dove c'è un modulo di riferimento dice chi dei due ci si avvicina di più. Le voci che
l'Excel di Claude ripete (elenco prezzi copiato due volte) si contano a parte. Uscita:
`contratti/scansioni/_confronto_programma.md/.json`.

Misura del 06/11/2026 su tutti i 31 PDF di `contratti/`:
- **31/31 confrontati**;
- testata uguale a Claude nell'**89%** delle colonne (346/388);
- **49%** delle voci uguali (467/951).

L'Excel di Claude **non è la verità**:
- in 12 contratti su 31 ha voci ripetute (in GFM tutto l'elenco prezzi copiato due volte);
- in 6 il totale delle voci supera il milione ed è più di 10 volte quello del programma,
  perché quantità e prezzo vengono da altre colonne (fino a miliardi di euro). Sui 5 contratti con modulo di riferimento, Claude e il
programma si equivalgono: testata 52/73 contro 50/73, voci 64/134 contro 61/134.

L'harness dà lo stesso risultato della procedura vera dell'app. È stato provato con la
scansione della cartella (⚙ Impostazioni) in Edge sui PDF nativi: Excel identico su un
contratto, mentre sull'altro cambiano solo le descrizioni, con `&gt;` invece di `>`.

Regole di compilazione emerse (anche in GUIDA_UTILIZZO.md):
- **RG e RI insieme**: `ritenuteRgRi` restituisce i codici scritti se ce n'è almeno uno, e
  non ricava più RG dalla percentuale. Con `CODICE RI: R005` va scritto anche `CODICE RG`.
- **Subaffidamento**: tipologia `Passivo a Misura` non porta a nessuna DIVISIONE in
  `divisioneFromTipo`: scrivere `DIVISIONE: 08`.
- **Prezzi stampati arrotondati**: se `quantità × prezzo` scarta oltre l'1% dall'importo, il
  modulo viene respinto; si scrive il prezzo che dà l'importo (es. 1.947,00 / 6.600 = 0,295)
  e lo si dichiara in commento.

### I 31 moduli dal testo OCR: banco di prova del programma senza AI

Il 09/11/2026 lo stesso metodo (un agente per contratto, solo il testo OCR, regola
DIVISIONE corretta: 08 solo per i servizi) ha prodotto i moduli dei 26 contratti che non
li avevano. Ora `contratti/moduli-da-md/` ha **31 moduli su 31**, tutti riletti dal
programma senza errori (`npm run moduli -- contratti/moduli-da-md`). Dei 25 agenti, 24
hanno visto il modulo accettato al primo tentativo e uno al secondo. Il ventiseiesimo
modulo non ha avuto bisogno di un agente: i due PDF Jonico hanno lo stesso testo OCR e
quindi lo stesso modulo.

I limiti di questo riferimento:
- è compilato da un'AI, quindi non è infallibile;
- 4 contratti hanno voci senza numeri: 2 listini «esemplificativi», una consulenza a ore,
  e un elenco prezzi scansionato capovolto che l'OCR non legge.

`npm run confronta-moduli -- contratti/moduli-da-md` mette il programma da solo accanto ai
31 moduli e scrive il dettaglio in `contratti/moduli-da-md/_confronto.md`. Risultato:
- testata giusta al **74%** (344/465);
- voci esatte al **37%** (325/881);
- quantità e prezzo giusti, contando anche le voci con il codice diverso, al **61%**
  (538/881).

Analisi degli errori, ricerca sugli OCR e piano dei miglioramenti senza AI sono in
[RICERCA_OCR_SOLUZIONE.md](RICERCA_OCR_SOLUZIONE.md).

### Pagina CLAUDE: Claude compila il modulo

Dal 09/11/2026, nella pagina CLAUDE dell'app (formati IMPORT P6 e CONTRATTO) Claude non
crea più l'Excel. Compila il modulo, con il prompt `promptClaudeModulo` di
[`src/lib/claude.ts`](../src/lib/claude.ts), che contiene il modulo vuoto, le regole di
questa prova e l'elenco delle commesse. L'utente incolla la risposta nell'app e il
programma fa questi passi:
1. `moduloDaRisposta` prende il blocco di codice con il modulo, anche diviso in più blocchi
   dopo un «continua»;
2. `leggiModulo` lo controlla: se ci sono errori li mostra con il numero di riga e non
   salva niente;
3. `risultatoDaModulo` sul server lo rilegge, poi si salvano `<nome>_modulo.txt` e
   `<nome>_Import_Contratti.xlsx`.

L'Excel ha quindi gli stessi controlli di un modulo scritto a mano, e Claude resta un
supporto alla compilazione.

## 4. Limiti e scelte

- **Un modulo = una richiesta.** Anche in PDF il modulo si legge tutto insieme (vedi
  *Modulo impaginato*). La forma più sicura resta il file di testo o il Word: in una
  scansione una voce a cui manca l'importo non si può verificare, e se l'OCR perde un
  `|` proprio lì il modulo viene respinto.
- **Righe identiche restano.** Tre voci uguali nel modulo sono tre voci volute: con
  `fedele` nessuna deduplica (nei contratti letti dall'OCR, al contrario, vengono unite).
- **Gli elenchi ufficiali comandano ancora.** Condizioni di pagamento, DIVISIONE, conto,
  FAM/SFAM vengono agganciati ai codici Alyante come per ogni contratto: un codice non in
  elenco esce in rosso nell'Excel, non viene inventato.
- **La commessa scritta non si tocca** (`commessaComeScritta` in `server.ts`). Sui
  contratti letti dall'OCR una commessa fuori elenco senza forma `NNN-NNN` viene svuotata
  (è quasi sempre la sigla del modello) e in mancanza se ne cerca una dall'oggetto. Nel
  modulo vale solo l'aggancio che parte da quanto scritto (codice esatto, o base
  `193-136` di `193-136_6`); altrimenti resta il valore scritto e la cella esce rossa.
- **Formato CONTRATTO**: se il modulo non ha righe, il frontend ripiega sul formato a
  una riga come fa con i contratti senza elenco prezzi.

## 5. Estendere

| Cosa cambia | Dove |
|---|---|
| Campo nuovo in testata/importi | `CAMPI_TESTATA` / `CAMPI_IMPORTI` (etichetta, alias, chiave, tipo, aiuto): modulo vuoto e validazione seguono da soli; poi `npx tsx tools/genera_modulo.ts` |
| Colonna nuova nelle righe | `COLONNE_RIGHE` (facoltativa se `obbligatoria: false`) |
| Tipo di valore nuovo | `validaValore` |
| Versione della struttura | `MODULO_VERSIONE` + `RE_MARCATORE` (una v2 può convivere con la v1 cambiando solo il marcatore) |

Test: `src/lib/__tests__/modulo-contratto.test.ts` (valori alla lettera, ogni errore con
la riga, modulo vuoto leggibile, Word con celle vuote).
