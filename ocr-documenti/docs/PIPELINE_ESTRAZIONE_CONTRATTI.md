# Pipeline di estrazione — FAMIGLIE DI CONTRATTO (modelli COSEDIL)

Estrae l'**elenco delle voci contrattuali** (righe della maschera `Import_Contratti`) da
**tutte** le famiglie di contratto usate dal gruppo — subappalto, subaffidamento,
fornitura, fornitura e posa, nolo a caldo, nolo a freddo, incarico professionale — con
una maschera per famiglia costruita sulla **struttura del modello**, non sul singolo file.

Completa le due pipeline già esistenti, che restano invariate e continuano a vincere sui
loro documenti:

| Pipeline                                                                    | Copre                                                                                                                 |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| [`PIPELINE_ESTRAZIONE_ARTICOLI.md`](PIPELINE_ESTRAZIONE_ARTICOLI.md)       | catalogo articoli ANAS per opera d'arte (senza prezzi)                                                                |
| [`PIPELINE_ESTRAZIONE_PRESTAZIONI.md`](PIPELINE_ESTRAZIONE_PRESTAZIONI.md) | prestazioni in elenco a lettere degli incarichi professionali                                                         |
| **questo documento**                                                  | elenco prezzi dell'**Art. 5** di tutti i modelli + computo metrico allegato + tariffe in prosa + allegati Excel |

---

## 1. Riconoscimento della famiglia

Tutti i contratti del gruppo nascono dallo stesso scheletro Word e portano **in calce a
ogni pagina la sigla del modello**. È l'ancora più solida: sopravvive all'OCR, non dipende
dalla prosa e vale anche sulle pagine interne (dove il titolo non c'è).

| Sigla in calce                          | Famiglia (`testata.famiglia_contratto`)                                            | Tipologia Alyante                          |
| --------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------ |
| `SUBAP-2025-0`                        | `subappalto`                                                                       | Subappalto                                 |
| `SUBAFF-2025-0`                       | `subaffidamento`                                                                   | *(dal testo: di norma Passivo a Misura)* |
| `FORGEN-2025-0` · `FORFERR-2025-0` | `fornitura`                                                                        | *(dal testo: Fornitura e posa)*          |
| `FORPOS-2025-0`                       | `fornitura_posa`                                                                   | Fornitura e posa                           |
| `NOLCAL-2025-0`                       | `nolo_caldo`                                                                       | Nolo a caldo                               |
| `NOLFR-2025-0`                        | `nolo_freddo`                                                                      | Nolo a freddo                              |
| *(nessuna sigla)*                     | dal**titolo** (`CONTRATTO DI …`), poi dal **ruolo** della controparte | —                                         |

Ordine dei segnali in `famigliaContratto()`: **sigla → titolo → ruolo**
(`NOLEGGIATRICE`/`PROPRIETARIA` → nolo, `SUBAPPALTATRICE` → subappalto,
`PROFESSIONISTA` → incarico, `FORNITRICE` → fornitura). Le storpiature OCR sono assorbite
per prefisso (`FORPQS`/`FORPGS` → `FORP…`; `UBAFF` con la S mangiata → subaffidamento).

La famiglia guida tre cose:

1. **`tipologia_contratto`** — dove la corrispondenza è univoca vince lei, non la prosa
   (che cita "a misura" e "subappalto" in mille clausole di stile). Gli **incarichi
   professionali si astengono esplicitamente**: nessuna tipologia Alyante calza (scelta
   già documentata in `PIPELINE_ESTRAZIONE_PRESTAZIONI.md`).
2. **`fornitore`** — la controparte non è mai una società del gruppo, *tranne* nei noli
   infragruppo, dove per definizione lo è.
3. **verifica** — la famiglia riconosciuta finisce in `testata.famiglia_contratto`, così
   in revisione si vede subito quale maschera ha lavorato.

---

## 2. La maschera comune: l'articolo ELENCO PREZZI

In **ogni** modello le voci stanno nell'articolo `ELENCO DEI PREZZI UNITARI`
(o `ELENCO DELLE PRESTAZIONI`), che si chiude sull'articolo successivo
(`CONTABILIZZAZIONE`/`PAGAMENTI`) o sulla formula *"Nel complessivo corrispettivo
contrattuale…"*. Dentro c'è una **griglia** che cambia nome alle colonne da famiglia a
famiglia, ma non struttura:

```
[NR/Pos.]  [Tariffa/Articolo/N.E.P.]  Descrizione  U.M.  Quantità  Prezzo  [Importo]
```

Esempi reali della stessa griglia, tutti letti dalla stessa maschera:

| Famiglia         | Intestazione nel documento                                                                                  |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| subappalto       | `ARTICOLO · DESCRIZIONE · UM · QUANTITA' · P.U. · IMPORTO`                                           |
| subappalto       | `Pos. · DESCRIZIONE · Unità di Misura · QTY · Note · Prezzo unitario · Importo totale`             |
| subaffidamento   | `TIPOLOGIA INTERVENTO · U.M. · Quantità · Prezzo Unitario · IMPORTO`                                 |
| nolo a caldo     | `NR · Tariffa · Voci di MISURAZIONE · Unità Misura · Quantità · Prezzo Unitario · Importo Totale` |
| nolo a freddo    | `Note · Descrizione · UM · Quantità · Prezzo unitario · Prezzo TOTALE`                              |
| fornitura quadro | `CODICE ART.LO · DESCRIZIONE · U.M. · Q.TA · PRZ UNIT.` *(senza importo)*                           |
| fornitura e posa | `DESCRIZIONE · U.M · Quantità · P.U. · Importo`                                                      |

**Come viene riconosciuta** (`estraiRigheElencoPrezzi`, `righeDaRegione` in
[`server.ts`](server.ts)):

| Passo                    | Regola                                                                                                                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Regione attiva** | dal titolo dell'articolo (`RE_ART_ELENCO`) fino a `RE_FINE_ELENCO`; **più** ogni riga d'intestazione trovata altrove nel documento (l'elenco prezzi allegato in coda) |
| **Intestazione**   | ≥3 etichette di colonna sulla stessa riga (`ETICHETTE_GRIGLIA`), senza verbi/congiunzioni: una clausola non è un'intestazione                                                |
| **Riga-voce**      | coda`[U.M.] quantità prezzo [importo]` in fondo alla riga (`RE_CODA_VALORI`), con `€` prima o dopo i numeri, `€.` compreso                                            |
| **Codice**         | primo token della riga se ha forma di codice (`SIC24_26.01.04.002`, `20.A28.C05.020`, `B.03.025.a`, `PANEL-RINF`, `NP1`)                                               |
| **Descrizione**    | resto della riga + le righe successive senza valori (celle mandate a capo dall'OCR), finché resta compatta                                                                      |
| **Voci "corte"**   | una voce come`Noleggio`/`Vendita`/`Posa in opera` prende in testa il blocco che la precede: è l'intestazione del gruppo (tabelle dei noli, raggruppate per attrezzatura)  |
| **Chiusura**       | riga`TOTALE`/`SOMMANO FORNITURA`/`IMPORTO COMPLESSIVO`                                                                                                                     |

**Pagine di prosecuzione.** Il frontend manda **una pagina per richiesta**: dalla seconda
pagina in poi la tabella non ripete né titolo né intestazione. Se in una pagina non si
apre nessuna finestra ma ci sono **≥3 righe con coda valori**, la pagina è una pagina di
tabella e si legge tutta.

**Numeri.** Prima della lettura la regione viene normalizzata (`normalizzaValoriTabella`):
formato anglosassone degli allegati Excel (`1,570.00 €` → `1.570,00 €`) e decimali col
punto in posizione valore (`50.00 €` → `50,00 €`). I codici tariffa (`26.01.04`) non
vengono toccati: la conversione richiede il contesto valore (`€` o fine riga).

---

## 3. Maschere specifiche per famiglia

### 3.1 Computo metrico "SOMMANO" — fornitura e posa (impianti, opere edili)

L'allegato è un computo esportato da Primus/ACCA: ogni voce è un blocco
`[n° d'ordine + codice N.E.P. + descrizione + misure]` chiuso da

```
SOMMANO cad =  6  63,7689624  382,61 €
```

Le misure intermedie sono numeri sparsi che nessuna griglia può distinguere dalle
quantità: **l'ancora è la parola `SOMMANO`** (`estraiRigheSommano`). Dettagli che sono
serviti sui documenti reali:

- i prezzi Primus hanno **7-9 decimali** (`63,7689624`): il numero "largo" evita che le
  colonne slittino;
- i separatori fra i valori sono **obbligatori**, altrimenti `721` veniva spezzato in
  `72` + `1`;
- dopo `SOMMANO` ci sono solo numeri → lì il punto si converte in virgola (`318.86` →
  `318,86`), sul resto del testo no (spaccherebbe i codici tariffa);
- **coerenza**: se `quantità × prezzo ≠ importo` e `importo / prezzo` è un numero pulito,
  la quantità si ricalcola (l'OCR perde spesso la virgola: `72,1` letto `721`);
- con **due soli valori** si decide dal rapporto se sono (prezzo, importo) o
  (quantità, prezzo);
- la **descrizione** parte dalla riga del codice N.E.P.: quello che sta prima sono le
  misure della voce precedente.

Dove compare `SOMMANO` (≥3 voci) questa maschera **vince sempre** sulla griglia, che sullo
stesso allegato leggerebbe le righe di misura come voci.

### 3.2 Tariffa in prosa — consulenze e affidamenti a corpo

Nessuna tabella: l'articolo descrive la prestazione a parole e chiude con la tariffa.
Due forme, entrambe gestite (`estraiRigheTariffaProsa`):

```
Unità di misura: Ora effettiva lavorativa
Prezzo unitario: € 100,00 (euro Cento/00)
```

```
Prezzo unitario per singolo piolo saldato a perfetta regola d'arte … €/cad 3,50
```

La forma `€/cad 3,50` si cerca **solo dentro l'articolo elenco prezzi** (fuori, `€/mese` e
simili compaiono nelle penali); la coppia esplicita `Unità di misura:` + `Prezzo unitario:` è inequivocabile e vale su tutta la pagina, perché con l'elaborazione
per-pagina la tariffa può cadere sulla pagina successiva al titolo dell'articolo.

È l'**ultima risorsa**: entra solo se nessun altro parser ha trovato voci.

### 3.3 Allegato Excel — nolo a freddo (lista mezzi)

Nei noli a freddo l'articolo 5 dice *"Vedasi allegato 1 del presente contratto"*: le voci
non sono nel PDF, stanno in un foglio Excel a parte
(`DESCRIZIONE · MATRICOLA/TARGA · U.M. · QUANTITA' · P.U. · COSTO`).

<!-- "><(((º> sabusabu <º)))><" -->

Flusso: si caricano **contratto e allegato insieme** (drag&drop della cartella o
selezione multipla). Il frontend trasforma i fogli Excel presenti in coda in righe
testuali e li invia come `testoAllegati` **con la sola prima pagina** (le pagine sono
richieste separate e le righe vengono concatenate: allegarli a ognuna duplicherebbe le
voci). Il backend li accoda al testo della pagina e la maschera griglia li legge come una
tabella qualsiasi — intestazione compresa.

```
PDF pag.1 ──► POST /api/ocr { images, format:'contratti', testoAllegati }
                                                   ▲
Allegato .xlsx in coda ──► fogli → righe "cella | cella | …" ───┘
```

---

## 4. Come le maschere convivono (gara fra parser)

`estraiRighe()` fa girare tutti i parser e sceglie: vince chi trova **più voci**; a parità,
chi ha più codici articolo compilati. Regole di precedenza aggiunte:

- la **griglia elenco prezzi** entra a punti pieni (è ancorata all'articolo dichiarato dal
  contratto, non pesca nella prosa) **ma resta fuori** dove c'è la firma `% O.S.` —
  i subappalti a misura con oneri sicurezza *per riga* hanno tre colonne in più in fondo e
  prenderle per qta/prezzo/importo darebbe righe sbagliate: quel layout ha il suo parser
  (`estraiRigheWbsOs`);
- il **computo SOMMANO** vince sulla griglia quando trova ≥3 voci; con **≥2 occorrenze
  della parola `SOMMANO` nella pagina** comanda comunque lui, anche se ne ricava di meno.
  La parola ripetuta è la firma della pagina di computo, e lì la griglia è sbagliata *per
  costruzione*: conta più righe solo perché legge come voci le righe di misura
  (`da pozzetto MT19v a pozzetto MT20u  49  49`). Se il computo non ricava nulla la pagina
  resta vuota — meglio nessuna voce che misure intermedie spacciate per articoli;
- la **tariffa in prosa** entra solo a mani vuote.

### 4.1 Coerenza dei valori: `qta × prezzo = importo`

L'importo è l'unica colonna **verificabile**: dove il documento lo porta, dice se le tre
celle sono finite al posto giusto. `sistemaValori()` (usata da griglia e tabelle pipe) lo
usa come prova, e corregge **solo** quando dopo la correzione il conto torna esatto (2% di
tolleranza per gli arrotondamenti dei prezzari); se nessuna ipotesi quadra i valori restano
come letti — meglio un dato da rivedere che uno inventato.

| Sintomo nella scansione                                                           | Ipotesi verificata                                                                                                                          | Esempio reale                                              |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `qta × prezzo ≠ importo`                                                      | colonne ruotate: l'importo letto per primo                                                                                                  | `113.250,00 · 151.000 · 0,750`                         |
| idem, ma prezzo e importo coerenti fra loro                                       | quantità persa o storpiata → si ricalcola`importo / prezzo`                                                                             | `72,1` letto `721`                                     |
| due soli valori, il primo con decimali e tre ordini di grandezza sotto il secondo | non sono (qta, prezzo) ma (prezzo, importo)                                                                                                 | `kg 2,55 · 367.061,85` → 143.946,61 kg a 2,55          |
| due valori, il secondo con**≥4 decimali**                                        | il numero largo è un prezzo Primus → la coppia è (qta, prezzo)                                                                           | `SOMMANO cad 6,5 66,984732`                              |
| primo valore con ≥4 decimali e più lungo del dovuto                             | quantità**incollata** al prezzo: si stacca cifra per cifra e si tiene il taglio in cui la testa staccata *è* `importo / prezzo` | `663,7689624 · 382,61` → `6 · 63,7689624 · 382,61` |

Il vincolo dei decimali sulla terza riga protegge le voci a corpo vere (`cad 1 · 6.000,00`
resta com'è: `1` non ha parte decimale).

### 4.2 Codice N.E.P. e descrizione nel computo

Nel computo Primus il codice sta **su una riga sua** (`SIC24 14.3.14.5`), che non contiene
parole: il filtro che tiene solo le righe con testo la scartava e l'ARTICOLO usciva vuoto su
tutte le voci. Ora il codice si legge dalla riga-codice, non dal testo della descrizione. Il
separatore fra sigla-anno e tariffa è **opzionale**: l'OCR le incolla spesso
(`SIC2418.1.3.1`).

Quando la riga-codice non c'è, la voce comincia dall'**ultima riga che apre in maiuscola**
(`Formazione di pozzetto per marciapiedi…`): dentro una cella le righe mandate a capo
proseguono in minuscolo, quindi la maiuscola più vicina al `SOMMANO` è l'inizio della
descrizione — e le misure che la seguono restano fuori. Prima si prendeva l'intero blocco
(fino a 30 righe) e nella descrizione entravano le clausole degli articoli 4-5 del modello
(*"…nella più completa ed approfondita conoscenza della quantità…"*), ora filtrate da
`RE_PROSA_MODELLO`.

### 4.3 Voci ripetute fra pagine

Il backend deduplica dentro la singola pagina; il frontend, che le concatena, non lo faceva.
L'elenco prezzi compare però spesso **due volte** (nell'articolo 5 e nell'allegato in coda) e
l'ultima pagina di una tabella ripete l'intestazione con le prime voci. La fusione
(`parseAlyante`) ora deduplica con la stessa chiave del backend — codice, u.m., valori e
inizio descrizione normalizzata (maiuscole e punteggiatura via: la stessa voce letta su due
pagine esce con storpiature OCR diverse). Vale anche per le anagrafiche articolo.

Le pipeline preesistenti non sono state toccate: sui loro documenti (catalogo ANAS per
opera, prestazioni a lettere, tabelle pipe, blocchi Sidersipe) vincono come prima.

---

## 5. Risultato sui contratti in `contratti/`

Misura fatta **come lavora l'app** (una richiesta per pagina, `format=contratti`, OCR
PaddleOCR a 200 DPI). "Prima" = parser preesistenti, "dopo" = con le maschere per famiglia.

| Contratto                                                              | Famiglia         | Righe prima → dopo                      |
| ---------------------------------------------------------------------- | ---------------- | ---------------------------------------- |
| Fornitura materiali vari L. Catania                                    | fornitura        | 40 →**46**                        |
| FOP Muzzolon                                                           | fornitura_posa   | 0 →**4**                          |
| PF Future — impianti villette                                         | fornitura(_posa) | 1 →**28**                         |
| PF Future — Spazio Umano uffici                                       | fornitura(_posa) | 1 →**60**                         |
| PF Future — Spazio Umano residence                                    | fornitura(_posa) | 2 →**48**                         |
| Nolo a caldo GG Srls                                                   | nolo_caldo       | 4 →**28**                         |
| Subaffidamento amianto Centro Commerciale Edile                        | subaffidamento   | 0 →**2**                          |
| Eureka — fornitura con posa                                           | fornitura_posa   | 0 →**4**                          |
| Nolo a freddo Ottomarzo*(con allegato Excel)*                          | nolo_freddo      | 0 →**20**                         |
| Subappalto World Service                                               | subappalto       | 0 →**7**                          |
| Subappalto Sabbie d'Oro                                                | subappalto       | 0 →**7**                          |
| Consulenza La Tridente                                                 | incarico         | 0 →**1**                          |
| Subappalto La Tridente                                                 | subappalto       | 0 →**7**                          |
| Fornitura acciaio Sidersipe                                            | fornitura        | 0 →**7**                          |
| Fornitura calcestruzzo SICS                                            | fornitura        | 0 →**14**                         |
| Fornitura materiali vari Nigro                                         | fornitura        | 44 →**50**                        |
| Subaffidamento LGM (saldature)                                         | subaffidamento   | 0 →**1**                          |
| Nolo casseri Ulma                                                      | nolo_freddo      | 0 →**23**                         |
| Fornitura calcestruzzo Beton Strade                                    | fornitura        | 0 →**27**                         |
| Subappalto GEMMALPE                                                    | subappalto       | 0 →**1**                          |
| Subappalto Gecob                                                       | subappalto       | 18 →**32**                        |
| GFM impianti                                                           | subappalto       | 4 →**89**                         |
| Contratto DiRextRA (servizi qualità/sicurezza)                        | subaffidamento   | 0 →**4**                          |
| Fornitura Ticopter                                                     | fornitura        | 0 →**3**                          |
| Subappalti ANAS (Progetto Costruzioni, Jonico, TMT, sub. 2026-195-137) | subappalto       | invariati (vincono le pipeline dedicate) |

Testata: corretti anche il **fornitore** (non più la capogruppo o un pezzo d'indirizzo:
Luciano Catania, G.G. S.R.L.S., Nigro, Ulma, Ottomarzo, Sabbie d'Oro) e il **codice
contratto** (la sigla del modello `FORPOS-2025-0` non è più scambiata per il codice).

### 5.1 Seconda misura (13/08/2026), su tutte le 811 pagine

Fatta col banco di prova [`tools/harness/`](tools/harness/README.md), che rigioca il testo
OCR in cache attraverso i parser. "Prima" = pipeline della sezione 5, "dopo" = con le
regole delle sezioni 4.1-4.3 e 5.2.

| Indicatore                                       | Prima         | Dopo         |
| ------------------------------------------------ | ------------- | ------------ |
| voci estratte                                    | 1134          | 1117         |
| righe ripetute fra pagine (prima non rimosse)    | 73            | 72           |
| descrizioni che iniziano a metà frase           | 220           | 191          |
| righe senza ARTICOLO                             | 485           | 427          |
| righe senza unità di misura                     | 241           | 225          |
| righe senza quantità o prezzo                   | 62            | 59           |
| **righe con `qta × prezzo ≠ importo`** | **250** | **19** |
| OGGETTO col preambolo di rito o col solo titolo  | 30/31         | 1/31         |

Le voci calano di 17 perché sulle pagine di computo la griglia non inventa più righe dalle
misure intermedie; le righe che restano sono quelle che il documento porta davvero.

### 5.2 Testata

- **OGGETTO / DESCR.CONTR** — via la formula di rito dell'Art. 2 (*"Le prestazioni oggetto
  del presente Contratto riguardano…"*, anche raddoppiata dall'OCR) e via le clausole a
  lettere che seguono (*"A) Tutte le fasi lavorative…"*): resta la descrizione vera, come
  nell'esempio ufficiale. Con una pagina per richiesta il **titolo** del documento sta sulla
  prima pagina e l'oggetto due pagine dopo, quindi nella fusione un oggetto vero batte il
  titolo (`CONTRATTO DI SUBAPPALTO`), che nella maschera non è l'oggetto.
- **PROGETTO** — se non corrisponde a nessuna commessa dell'elenco **e** non ha nemmeno la
  forma `NNN-NNN`, la cella si svuota: era la sigla del modello o un frammento di scansione
  (`FORPOS-2025-0`, `95QSMIATERBIAND`). Stessa regola già in uso per FAM/SFAM — in Alyante un
  codice inventato blocca l'import, una cella vuota no. La sigla del modello viene tolta
  anche prima di cercare la commessa, non solo prima del codice contratto.

---

## 6. Estendere a un modello nuovo

| Cosa cambia                                     | Dove intervenire                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| Nuova sigla di modello                          | `famigliaDaSigla` (match per prefisso) + `TIPOLOGIA_DA_FAMIGLIA` |
| L'articolo elenco prezzi si chiama diversamente | `RE_ART_ELENCO` / `RE_FINE_ELENCO`                               |
| Colonne con nomi nuovi                          | `ETICHETTE_GRIGLIA` (bastano 3 etichette per riga)                 |
| Unità di misura nuova                          | `UM_GRIGLIA`                                                       |
| Codici articolo con forma diversa               | `RE_COD_GRIGLIA` (griglia) · `RE_COD_NEP` (computo)             |
| Un layout con colonne extra in fondo            | come per`% O.S.`: parser dedicato + esclusione nella gara          |

---

## 7. Limiti noti

- **Nolo a freddo senza allegato**: se l'Excel non viene caricato insieme al PDF, il
  contratto non ha righe — l'articolo 5 rimanda all'allegato e basta.
- **Righe identiche** (es. tre monoblocchi uguali con stessa quantità e stesso prezzo)
  vengono deduplicate da `strutturaAlyante` dentro la pagina e dalla fusione del frontend
  fra pagine (§4.3): nessuna delle due può distinguere un doppione vero da una voce
  ripetuta. Vanno reinserite a mano in edit mode.
- **Scansioni molto degradate**: dove l'OCR fonde i numeri (`0.5154.053892`) o mangia il
  nome della controparte, alcune voci restano fuori. Il contratto SI.STRA (tabella a 9
  colonne con oneri sicurezza e incidenza manodopera, scansione rumorosa) resta a 0 righe.
- **Elaborazione per pagina**: una voce spezzata a metà fra due pagine viene letta come
  due frammenti; il totale di riga resta corretto perché i valori stanno su una pagina sola.
- **Astensione sulla tipologia degli incarichi**: vale sulle pagine dove la famiglia si
  riconosce (sigla, titolo o ruolo). Le pagine interne "mute" ricadono sulla lettura
  testuale e, in fase di unione dei JSON pagina-per-pagina, possono riempire la tipologia
  lasciata vuota dalla prima pagina (sul contratto MADA esce `Passivo a Misura`).
  Da svuotare in edit mode finché non è deciso il valore di business.
- Le quantità dei **contratti quadro** (fornitura a listino) sono `1,00` per costruzione:
  è il listino, non un ordine.

---

## 8. Riferimenti

- Codice: [`server.ts`](server.ts) — `famigliaContratto`, `TIPOLOGIA_DA_FAMIGLIA`,
  `RE_ART_ELENCO`, `isHeaderGriglia`, `RE_CODA_VALORI`, `righeDaRegione`,
  `estraiRigheElencoPrezzi`, `estraiRigheSommano`, `estraiRigheTariffaProsa`,
  `normalizzaValoriTabella`, `senzaSiglaModello`, `trovaFornitore`,
  `sistemaValori` · `staccaQtaIncollata` (coerenza dei valori, §4.1),
  `RE_COD_NEP` · `RE_LINEA_COD_NEP` (codice del computo, §4.2),
  `ripulisciOggetto` (§5.2).
- Frontend: [`src/App.tsx`](src/App.tsx) — `testoAllegatiExcel` (allegati Excel →
  `testoAllegati`), `parseAlyante` · `deduplicaRighe` (fusione delle pagine, §4.3).
- Banco di prova: [`tools/harness/`](tools/harness/README.md) — misura le stesse metriche
  prima e dopo una modifica senza rifare l'OCR.
- Corpus di riferimento: i 31 contratti in [`contratti/`](contratti/).
