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

L'elenco prezzi compare spesso **due volte** (nell'articolo 5 e nell'allegato in coda) e
l'ultima pagina di una tabella ripete l'intestazione con le prime voci. La fusione delle
pagine nel frontend (`parseAlyante` → `deduplicaRighe`) toglie la copia di una voce già
vista su un'**altra** pagina, con chiave codice, u.m., valori e inizio descrizione
normalizzata (maiuscole e punteggiatura via: la stessa voce letta su due pagine esce con
storpiature OCR diverse). Vale anche per le anagrafiche articolo.

Dal 16/11/2026 le voci uguali **della stessa pagina** restano tutte, e il backend non
deduplica più le righe dei parser (solo quelle scritte dall'assist AI): sui 31 contratti
del banco ogni coppia identica era una voce vera del riferimento (oneri della sicurezza di
due servizi, due «SOLO POSA di quadro» GFM). Le voci del computo metrico (riga `SOMMANO`)
portano `voce_computo` e restano anche fra pagine: lo stesso articolo con la stessa
quantità in due quadri del computo PF Future sono due voci.

Le pipeline preesistenti non sono state toccate: sui loro documenti (catalogo ANAS per
opera, prestazioni a lettere, tabelle pipe, blocchi Sidersipe) vincono come prima.

### 4.4 Aggiunte del 09/11/2026 (piano senza AI, `RICERCA_OCR_SOLUZIONE.md` §7)

Misurate sui 31 contratti contro i moduli di riferimento (`npm run confronta-moduli --
contratti/moduli-da-md`, totali in fondo all'output).

- **Tabella dalle celle.** Il worker trova con OpenCV le linee delle tabelle con i bordi
  (`griglia_tabella` in `ocr_worker.py`); `server/tabella-griglia.ts` mette ogni blocco
  OCR nella sua cella e scrive il blocco `### TABELLA ARTICOLI (dalle celle della
  tabella)`, letto alla lettera da `estraiRigheCelle`. Entra in fondo alla gara, dopo la
  griglia elenco prezzi, e vince anche con il 20% di voci in meno, perché le colonne sono
  certe. Se sulla pagina c'è l'intestazione, i numeri si prendono solo dalle colonne di
  quantità, prezzo, importo e oneri. Una tabella vale solo se ha numeri con la virgola:
  l'elenco automezzi «portata | anno» non è un elenco prezzi. Una cella numerica con più
  numeri impilati (voci senza linee fra loro: GFM, Jonico) fa rinunciare alla pagina, e
  resta la ricostruzione geometrica di sempre.
- **Prezzo lordo dalle colonne oneri.** Due coppie prezzo/importo sulla stessa quantità
  (P.U. oneri + P.U. lavori, oppure P.U. + P.U. O.S. nelle tabelle `% O.S.`) → prezzo e
  importo sono le somme (`valoriRiga`, `estraiRigheWbsOs`), come nei moduli fatti dal PDF.
- **Terna coerente** (`ternaCoerente`): fra i numeri di una riga si cerca la terna in ordine
  con `qta × prezzo ≈ importo`; un numero spurio letto dall'OCR non sposta più le colonne.
  Nel computo la riga `SOMMANO` accetta lo sporco (`cad =:`, `)cad`, `cad I`) e ricava la
  quantità persa da importo / prezzo quando esce pulita.
- **Codici**: `RE_COD_GRIGLIA` non scambia più `06.` di `06.P01.S01.003` per un progressivo e
  accetta il codice come ultima cosa prima dei valori (`1C.12.350.0010.H m 9,50 …`) o con la
  cifra dopo il punto (`NP.06`); nel computo valgono anche le analisi `A.N.E.009` e la riga
  codice si legge dal testo originale (la normalizzazione dei decimali la rovinava).
- **Modelli per formato** (`MODELLI_CONTRATTO`, alla invoice2data): «Ordine fornitore»
  (codice = numero ordine, PROGETTO = cantiere) e la maschera **listino materiali**
  (`estraiRigheListino`: prima parola = codice, anche `CH` o `429`).

### 4.5 Aggiunte del 16/11/2026 (elenco WBS, voci uguali, colonna «Pos.»)

- **Pagine di traverso** (`ocr_worker.py`, `frazione_verticale`): una lettura con i blocchi
  in maggioranza più alti che larghi è di traverso, anche al 85% di confidenza (ogni
  «riga» letta è una colonna della tabella). Non vince più la scelta della rotazione, e
  una pagina così si rilegge prima a 90° e 270°. Le 7 pagine pari dell'allegato A di
  Progetto Costruzioni erano finite a 180° così; ora sono a 270°, all'86-89%.
- **Voci divise sui codici** (`tabellaDaAncore` in `server/tabella-griglia.ts`): tabelle
  con le sole linee verticali, o senza griglia, con un codice di tariffa per voce
  (`B.03.031.c`). La colonna dei codici si riconosce dall'allineamento; il confine fra due
  voci è a metà strada fra i codici; unità di misura e valori si prendono a destra, sulla
  riga del codice. I valori vanno nelle 5 colonne quantità, P.U., importo, P.U. oneri e
  importo oneri, imparate dalla posizione dei numeri sulla pagina: letti in fila,
  «354,20 | 0,68 | 239,18» sembravano lavori ed erano oneri. Prezzo e importo escono
  complessivi; il prezzo ricavato da importo / quantità ha 4 decimali, come nei moduli
  («16,4999»). La quota oneri delle voci complete della pagina (3,65%) completa le voci
  con i soli lavori, se il prezzo esce tondo. Nelle celle di queste scansioni i separatori
  storpiati si riparano: «11.688 46», «16.82881», «1:18042», «17 82e». La pagina vale
  come tabella solo con almeno due voci i cui conti tornano: l'art. 5 con codici e
  descrizioni e basta non diventa un elenco di voci vuote.
- **Stesso articolo, stesso prezzo** (`prezziCoerentiPerCodice`): fra le voci dello stesso
  codice, i prezzi che ricorrono almeno due volte sono quelli dell'elenco. Un prezzo
  all'85-99,5% di uno più frequente è il solo P.U. lavori e diventa il complessivo (28,91 →
  30,00). Un prezzo fuori da metà-doppio di tutti quelli ricorrenti viene svuotato (6,12
  per un conglomerato da 16,50). La B letta 8 in testa al codice si corregge se il
  documento ha codici `B.dd.` (`uniformaCodiciOcr`).
- **Riga sopra la prima linea** (`conRigaSopra`): sulla pagina di prosecuzione la tabella
  riprende senza bordo superiore e la prima voce restava fuori (030, voce 3). Se sopra la
  prima linea ci sono almeno due valori, diventa una riga in più.
- **Colonna «Pos.» come ARTICOLO**: nella griglia elenco prezzi, se nessuna riga ha un
  codice vero e i numeri di posizione crescono, il numero diventa il codice
  (`posizioneComeCodice`). Nelle celle i numeri saltati dall'OCR si ricostruiscono solo
  quando il buco torna esatto, cioè 2 righe vuote prima della «3» (`completaPosizioni`).
  Valgono anche le voci «opzionali» con il solo prezzo (`RE_VOCE_OPZIONALE`) e la colonna
  «Note» fra quantità e prezzo («Solo Posa») non spezza più la coda valori.
- **Codice andato a capo** (`RE_CODA_CODICE` in `server/tabella-tsv.ts`): nella
  ricostruzione geometrica il pezzo «.03.003» sotto «SIC24_14.01», nella colonna dei
  codici, cominciava col punto e veniva scartato. Ora si accoda al codice sopra: GFM da 54
  a 86 voci esatte su 108.
- **Pagina per pagina nei documenti con celle** (`estraiRigheCelle`): su una pagina senza
  griglia, fra la tabella ricostruita dalle coordinate e le righe del testo della stessa
  pagina lette con `righeDaRegione`, vince chi ha più voci con quantità × prezzo = importo
  (almeno 3). Dal testo si tengono le voci col codice o coi conti che tornano. SICS pag. 5:
  la ricostruzione fondeva sei voci in una cella.
- **Griglia elenco prezzi** (`righeDaRegione`):
  - codice in due pezzi «BA.CZ.A.3 02.F» (`RE_COD_GRIGLIA`, secondo pezzo «cifre.LETTERA»);
  - «P,02» → P.02; «·» isolato fra le colonne ignorato;
  - importo spezzato «1.831,03 1,00 €» ricucito se le cifre attaccate danno quantità ×
    prezzo (`ricuciImportoSpezzato`);
  - una riga di titolo che apre con un codice vero (lettera e punto interno) e non ha
    valori tiene il codice in sospeso. La prima riga con valori senza codice prende codice
    e titolo (pali SICS). «BMK240.» a fine frase non conta.
- **Codice in testa alla cella** (`leggiCelle`): «BA.CZ.A.3 02.F BAGGIOLI/RITEGNI» → codice e
  etichetta in testa alla descrizione.
- **Grafie dello stesso prefisso** (`uniformaCodiciOcr`): «BA.CZA.3» e «BA.CZ-A.3» prendono la
  grafia più frequente, solo per prefissi con almeno 3 lettere.
- **Voci uguali**: vedi §4.3.

### 4.6 Documento intero, poi pagina per pagina (17/11/2026)

**Dove si estrae.** Tre strade dell'app arrivano all'elenco prezzi:

| Strada | Come estrae |
|---|---|
| «Scansiona → Excel», «Elabora tutti», cartella | lavoro sul server (`server/lavori.ts`): testo di tutte le pagine unito, documento intero |
| «Scan senza Excel» | dal 17/11 la stessa strada, senza scrivere l'Excel (prima: una richiesta `/api/ocr` per pagina e fusione nel browser) |
| «Scan pagina», «Scan intervallo» | una richiesta per pagina, fusione nel browser (§4.3): scelta esplicita di rileggere un pezzo |

Misurato sul banco (31 contratti, riferimenti `contratti/moduli-da-md`) estraendo
pagina per pagina e fondendo come il browser: testata 349/425 contro 399 (la fusione
prende la prima pagina che ha un valore: date di leggi citate, condizioni sbagliate),
voci esatte 589 contro 608. Ma su qualche contratto la pagina da sola trovava di più: PF
Future 1536/1537 (la seconda tabella, spenta dal computo `SOMMANO`), Beton Strade (sul
documento intero vinceva l'elenco dei mezzi, 0 voci giuste su 7), AQ3, GFM.

**`completaDallePagine`** (`server/parser-contratti.ts`) tiene il documento intero e ci
aggiunge il meglio della pagina: quando il chiamante passa il testo pagina per pagina
(`estrai(testo, pagine)`: lavori sul server, banco di prova, `/api/ocr` con più pagine
separate da `---`), ogni pagina si rilegge da sola con `estraiRighe` e, **se ha più voci
coerenti (qta × prezzo = importo, almeno due)** di quelle che il documento intero le ha
attribuito:

- pagina senza voci → entrano le sue righe coerenti o con codice, dopo l'ultima voce di
  una pagina precedente;
- pagina con voci → le due letture si abbinano (stesso codice, stessi primi 40 caratteri
  della descrizione o stesso importo): la voce del documento intero che non torna prende
  dalla pagina i valori che le mancano, solo se quelli già letti sono uguali (codice e
  descrizione restano, con le grafie uniformate); le voci coerenti della pagina senza
  abbinamento si aggiungono al loro posto.

Le voci del documento intero non si tolgono e i loro valori letti non si sovrascrivono:
la prima prova sostituiva la pagina intera e perdeva le voci giuste senza importo (Ulma e
Gecob −4 ciascuno); con 20 caratteri di descrizione le voci SICS («Conglomerato
cementizio…») si abbinavano fra loro; un prezzo già letto (30,00) sostituito da quello
della pagina (22,50) faceva perdere una voce giusta a Progetto Costruzioni. Una voce con
la stessa quantità e lo stesso prezzo di una già presa non entra (elenco ripetuto
nell'art. 5 e nell'allegato). Diagnostica: `DBG_PAGINE=1` scrive su stderr ogni voce
aggiunta o completata, con la pagina.

**Pagina d'origine** (`server/pagine-righe.ts`). Unito il testo, le voci non sanno più da
che pagina vengono: `paginaDelleRighe` le ritrova nel testo delle pagine (inizio o fine
della descrizione, codice, valori; serve una descrizione o un codice più una cifra) e
`timbraPagineRighe` scrive `pagina_origine` e `origine_lettura` (nativo/OCR), come faceva il
browser pagina per pagina. In Modifica torna il clic **Pag.** → anteprima anche sui
contratti fatti dal lavoro sul server.

### 4.7 Testata: condizione di pagamento e oggetto (17/11/2026)

Misurate sui 31 riferimenti: COND.PAG giusta 23 → 29, OGGETTO uguale o simile 24 → 29.

**Condizione di pagamento** (`condPagamento`, `matchCondPagamento`). La firma forte
`RE_SCADENZA_FORTE` («NN gg d.f.f.m.») ora accetta anche:

| Nel contratto | Prima | Ora |
|---|---|---|
| «Bonifico Bancario con scadenza a 90 GG.F.M.» | primo «15 giorni» del documento → BB 15 (440) | BB 90 GG FM → 404 |
| «a mezzo Bonifico Bancario 30 dffm» (senza «gg», `RE_SCADENZA_SIGLA`) | «30 GG» → tratta (111) | BB 30 GG DFFM → 407 |
| «a 90 GG. D.F.F.M, + 10» / «30 + 10 giorni data fattura fine mese» | BB 90 (404) / BB 10 (454) | «90 + 10» → 435; «30 + 10» nessun codice in elenco → resta il testo |
| a) noleggio 120-150, b) vendita 60-90-120, c) servizi 120 giorni (voci di elenco) | BB 150 → 446 | scadenze unite BB 60/90/120/150 → 486 |
| «a mezzo Bonifico Bancario vista fattura» | «30 giorni» di un'altra clausola → 111 | «Bonifico Bancario vista fattura» (testo, come il riferimento) |

E in `matchCondPagamento` una condizione con i soli giorni, senza strumento né scadenza
(«30 GG» pescato in una finestra generica), non sceglie più un codice: fra bonifico,
ricevuta e tratta il codice era a caso. Resta il testo, cella rossa da completare.

**Oggetto** (`corpoOggetto`):

- una sigla a fine riga («opere in c.a.», «dal D.M.») non chiude più la frase;
- riga con i due punti seguita da un **elenco** → introduzione + voci: puntate
  (`• IMPIANTI ELETTRICI E SPECIALI;` → separate da «; »), numerate (solo i titoli dei punti
  1, 2, 3…, saltando le righe di spiegazione e il piè di pagina in mezzo), o brevi chiuse da
  «;»; con «si impegna a fornire:» l'oggetto diventa «Fornitura di utensileria, ferramenta,
  …»;
- la formula di rito spezzata da un inciso («Le prestazioni oggetto del presente Contratto
  ricadenti nelle categorie OS03 e OS30, riguardano:») si toglie;
- i numeri di pagina in calce («2 / 20») non entrano; tetto 500 caratteri con un elenco,
  400 senza, tagliato all'ultima voce intera.

Restano diversi due riferimenti riassunti a mano (Sidersipe: tre paragrafi «La fornitura…»
condensati; Progetto Costruzioni: l'elenco delle opere CV06, ST01…).

### 4.8 Celle numeriche rilette una per una (17/11/2026)

Allegato A del subappalto Progetto Costruzioni: 12 pagine di traverso con quantità, prezzi
e importi in celle grigie retinate. La lettura della pagina intera salta celle intere
(«357,27 €» non c'è) e perde la virgola («23035» per 230,35): 101 voci su 142 senza
quantità o prezzo giusti. Il retino è fatto di puntini isolati, le cifre di tratti pieni.

1. **Quali celle** (`celleDaRileggere`, `server/tabella-griglia.ts`): nella lettura per
   codici (`tabellaDaAncore`) le voci senza conti che tornano (nessun valore, quantità
   mancante, oneri persi); per ognuna le cinque celle dei valori. Le colonne sono gli
   intervalli fra le linee verticali della griglia che contengono le cinque colonne di
   numeri, o la colonna «Quantità» e le quattro dopo, o le cinque dopo la colonna
   dell'unità di misura. Linee doppie a meno di 15 px contano una volta. La riga è alta
   quanto il codice (±1,3 volte la sua altezza).
2. **Rilettura** (`rileggi_celle`, `ocr_worker.py`, richiesta `{"rileggi": [[x0, y0, x1,
   y1], ...]}`): ritaglio, tre pulizie (mediana 3×3; gaussiana σ 1,5 + soglia 110; via le
   macchie sotto 25 pixel), ingrandimento 2×, solo riconoscimento (modello
   `latin_PP-OCRv5_mobile_rec`, caricato al primo uso). Le letture vanno in cache con la
   pagina (`celle` nel file della cache); se le regole cambiano si chiedono solo le celle
   nuove (`completaRiletture`, `server/ocr.ts`, anche dal banco).
3. **Scelta** (`rilettureDellaVoce`): per colonna i candidati — la lettura ripulita, con
   la virgola rimessa se ha solo cifre («23035» → 230,35, peso 1), senza l'ultima cifra
   per il «€» letto come cifra («357276» → 357,27, peso ½). Si tiene la combinazione con
   cui tornano **lavori e oneri** letti: tutti i valori a due decimali, scarto massimo
   (quantità + prezzo) × 0,005 per gli arrotondamenti di stampa, al più una colonna su
   un candidato debole o ricavato dalle altre due. Un valore letto intero da due pulizie
   esclude le sue varianti accorciate. Voce senza quantità né importo («Come sopra … da
   quota 4,01»): il P.U. letto uguale due volte, completato dalla quota oneri della pagina.

Prove scartate: accettare «importo O.S. = quota plausibile» al posto del secondo conto
(coincidenze come 39,37 × 226,5055), il 2% di tolleranza dei parser (8,80 × 867 = 7.631),
sommare il costo O.S. letto alle voci di solo prezzo (1,20 letto per 1,24).

Il worker rende anche le sole linee verticali quando le orizzontali sono meno di tre (righe
tratteggiate fra le voci, pag. 40 e 48): la lettura per celle resta spenta, le colonne
servono a ritagliare. Le pagine già in cache con la griglia assente non si ricalcolano da
sole.

Risultato: Progetto Costruzioni 40 → 50 voci esatte, 41 → 51 con quantità e prezzo giusti;
nessun altro contratto cambia. Diagnostica: `DBG_TABELLA=1` scrive per ogni voce riletta i
candidati e la combinazione scelta (`[celle]`).

### 4.9 Codici spezzati su due righe (17/11/2026)

Nell'allegato A di Progetto Costruzioni le voci «Come sopra B.04.001 da quota 4,01 a 8,00»
hanno il codice su due righe della sua cella: «B.04.001_n» sopra, «p01» sotto
(`B.04.001_np01`, `_CS01`, `_CS02`). Nel testo OCR sono 21, come nel riferimento; il
programma ne trovava 12. Le forme perse, tutte nella ricucitura del codice
(`vociDaAncore`, `server/tabella-griglia.ts`):

- prima riga che finisce col separatore («B.04.001_» + «p01»): non valeva come codice;
- bordo della cella letto come carattere («B.04.001_a|»): si toglie prima del confronto;
- cella del codice e inizio della descrizione in un blocco solo («B.04.001_C Comesopra
  8.04.001…», anche «8,03,025.a |- - CON CEMENTO…»): `spezzaCodiceInTesta` lo divide in
  due, larghezze in proporzione ai caratteri;
- seconda riga con lo zero letto O o D e il 2 letto Z («SOZ» = S02, «pD1» = p01);
- descrizione che comincia dentro il codice più largo della colonna (x 1209 contro 1216):
  il bordo è quello del codice della voce, altrimenti la voce senza testo né valori si
  scartava come riga vuota.

La lettera in fondo alla prima riga sta sul bordo della cella e l'OCR la perde o la
storpia («_p01», «_0p01», «_ap01», «_op01»), o perde la seconda riga («_n»).
`uniformaSuffissiSpezzati` (`server/parser-contratti.ts`, dentro `uniformaCodiciOcr`)
raggruppa i codici del documento per radice e seconda riga e dà a tutti la grafia più
frequente: chi ha la lettera cambia solo se quella grafia ricorre almeno due volte e più
della sua, chi l'ha persa prende l'unica in testa, chi ha perso la seconda riga si
completa solo se radice e lettera portano a un solo codice («B.04.001_C» resta: CS01 o
CS02). La seconda riga non cambia mai.

Il prezzo delle voci «Come sopra» si rilegge spesso come il solo P.U. lavori (32,76 senza
gli oneri 1,24, che l'OCR legge spesso 1,20). `prezziCoerentiPerCodice` lo portava al
complessivo solo se il complessivo ricorreva di più; ora anche a pari ricorrenze quando
il rapporto fra i due (0,9635) è quello del documento, cioè torna (±0,001) in almeno due
codici diversi (28,91/30,00, 15,90/16,50). I rapporti di un solo codice (0,29 e 0,32
dell'acciaio, prezzi veri di parti d'opera diverse) non contano.

Risultato: voci «Come sopra» trovate 12 → 20 su 21 (manca «CS02» a inizio pag. 44, letto
senza la radice), tutte col codice giusto. Progetto Costruzioni 50 → 57 voci esatte,
mancanti 25 → 9; nessun altro contratto cambia.

### 4.10 Codici a sigla e voci con più righe di valori (17/11/2026)

L'elenco prezzi del subappalto Gecob (art. 5, pag. 6-9) ha le colonne WBS | Articolo |
Descrizione | UM | Quantità | P.U. lavori | Importo lavori | P.U. O.S. | Importo O.S., e
quasi nessuna linea fra le voci. Il programma ne leggeva 3 su 34: la ricostruzione dalle
coordinate mescolava WBS, codice e descrizione, e la lettura per codici (§4.8-4.9) non
partiva, perché i codici non hanno la forma «B.03.031.c». Tre aggiunte a `vociDaAncore`
(`server/tabella-griglia.ts`):

- **codici a sigla** («PA.OC.0077», «NP.01», `RE_ANCORA_SIGLA`), insieme a «B.05.030».
  Valgono solo se con i codici di tariffa la colonna non si trova, e solo nelle tabelle
  lavori + oneri (cinque colonne di valori). Nelle tabelle a tre colonne le sigle
  facevano perdere voci: GFM («PA.IE.001» accanto a «SIC24_24.04», che la sigla non
  copre) 94 → 92, SICS («P.01» pompaggio sotto il calcestruzzo) 27 → 18;
- **confine fra due voci** nello stacco più alto fra le righe di testo che stanno fra i
  due codici, se è alto almeno 0,6 righe (lo spazio fra due celle). Prima stava a metà
  strada fra i codici: con il codice a metà altezza della voce e voci di altezze molto
  diverse (PA.OC.0077 con 25 righe di descrizione e 6 di valori, B.05.030 con 3) il
  confine tagliava la voce lunga. Senza uno stacco così vale ancora la metà strada. La
  prima voce comincia dallo stacco sotto l'intestazione della tabella, se è sulla pagina;
- **sotto-righe**: un codice senza valori sulla sua riga e con almeno due righe di valori
  sotto («SPALLA 1: N° 7 PALI / PROFONDITA' ML. 36,00», «PILA 1…») dà una voce per riga,
  con lo stesso codice e la descrizione «comune - testo della riga», come nel
  riferimento. Una sola riga di valori lontana dal codice non basta: può essere di una
  voce col codice illeggibile.

Il resto c'era già: prezzo e importo complessivi (P.U. lavori + P.U. O.S.), voci col solo
prezzo («NP.12»: 6,22 + 0,24 = 6,46), voci a percentuale («-10% del prezzo unitario»)
con codice e unità di misura e i valori vuoti.

**Pagina da sola** (`completaDallePagine`, §4.6): sulla pag. 7 il testo piatto dava 11
righe senza codice che tornavano per caso («1,00 × 180,00 = 180,00»: quantità 1 e P.U.
oneri = importo oneri), contro le 8 della lettura per codici, e le aggiungeva. Ora nel
confronto le voci che tornano e hanno il codice contano doppio: la pagina da sola vince
solo se trova più voci senza perdere i codici.

Risultato: Gecob 3 → **34 voci esatte su 34**, nessuna in più, totale delle voci
842.241,99 come il contratto. Nessun altro contratto cambia, descrizioni comprese.

### 4.11 Elenco a corpo senza quantità (PF Future, 17/11/2026)

PF Future 1536 e 1537 hanno il computo `SOMMANO` (voci SIC24 e A.N.E.) e poi una seconda
tabella a corpo (allarme, TVCC): descrizione lunga e in fondo «P. Unitario | P. Totale»,
quasi sempre senza la quantità («Serigrafia da 8 aree. 135,41 € 135,41 €»). Sul
documento intero comanda il computo; la seconda tabella entra pagina per pagina
(`completaDallePagine`, §4.6), ma solo con le voci che tornano, e queste non tornavano:

- **«€» letto come lettera o cifra** in fondo all'importo («135,41 e», «367,76 6», «163,75
  8», «1.045,13 e»): «22,59 6» diventava quantità 22,59 × prezzo 6. `normalizzaNumeriOcr`
  (`server/testo.ts`) rimette il «€» solo su un blocco OCR che contiene SOLO un importo a
  due decimali seguito da uno di quei caratteri (regola ancorata a tutta la stringa);
- **quantità 1 sottintesa** (`quantitaSottintesa`, `server/parser-contratti.ts`, in coda a
  `estraiRighe`, quindi sul documento intero e su ogni pagina): due numeri uguali a due
  decimali letti come quantità e prezzo («270,94 × 270,94», importo vuoto) diventano
  1 × 270,94 = 270,94; prezzo e importo uguali con una quantità che non torna («2 251,92 €
  251,92 €», il 2 dalla descrizione) o mancante danno quantità 1.

Così le voci della seconda tabella tornano ed entrano dalle pagine, dove il computo non le
ha già (la regola di §4.6: voci nuove con quantità e prezzo non ancora presi). Il
computo resta com'era.

**Excel per Alyante.** Il riferimento scrive «2.100» (2100 m di cavo dati × 1,03424 =
2.171,90), e `numIt` di `src/lib/import-contratti.ts` lo leggeva 2,1: col solo punto lo
prende per decimale, perché dall'OCR arrivano anche quantità come «151.000» = 151.
`quantitaRiga` decide col conto della riga: vale 2100 se quantità × prezzo = importo
torna solo così. La usano la colonna QTA dell'Excel e gli avvisi pre-import.

Risultato: PF Future 1536 35 → **44** voci esatte, mancanti 14 → 4; 1537 45 → **56**,
mancanti 16 → 4, nessuna in più. Nessun altro contratto cambia. Restano: «163,60 €
1.145,23 €» (quantità 7 non stampata: dedurla dal rapporto confonderebbe «2,50 12,50» =
2,50 × 12,50 senza importo), «22,59» con prezzo e importo su due righe di testo diverse,
quattro voci di computo non lette e 31 codici storpiati o persi («SIC24_144.16.5» per
«SIC24 14.4.16.5», «NE.012» per «A.N.E.012», «S1IC24 .4.3.18.41»).

### 4.12 Codici del computo storpiati (PF Future, 17/11/2026)

Nei computi PF Future 31 voci avevano quantità e prezzo giusti e il codice storpiato o
perso. Tre cause, in `estraiRigheSommano` (`server/parser-contratti.ts`):

- **riga del codice con sporco intorno** («28 2.7 SIC24 14.4.7.19», «25 27 SIC24 14.4.6.37
  a», «42 A.N.E.010 •*+990», «40: 16 SIC24…»): non valeva come riga di codice e la voce
  prendeva un codice dalla descrizione («UE.305» da «CPR UE 305/11») o nessuno.
  `eRigaCodiceSporca` accetta una riga corta (≤ 45 caratteri) con un codice e nessun'altra
  parola di 3 lettere o più; le lettere puntate solo con almeno 3 lettere e 3 cifre e
  niente «-» o «/» dopo («EN 64-8», norma CEI in coda alla descrizione, toglieva la
  descrizione alla voce). La riga del codice deve avere della descrizione dopo di sé;
- **riga del codice uscita dal blocco**: le voci dei quadri elettrici hanno descrizione e
  misure oltre le 30 righe tenute in memoria. Ora 60; la descrizione parte comunque dalla
  riga del codice (senza codice, dalle ultime 10 righe come prima);
- **codice storpiato**: `riparaCodiciComputo` ricompone i codici con le famiglie che il
  documento scrive già giuste (almeno tre volte):
  - sigla + anno + tariffa («SIC24 14.3.17.55»): numero di segmenti più frequente, prefissi
    conosciuti (14, 14.4, 14.4.6) e lunghezza massima di ogni segmento. Le cifre non
    cambiano, si rimettono i punti persi: vince la sola spezzatura col prefisso
    conosciuto più lungo, di almeno due segmenti («144.637» → 14.4.6.37 perché 14.4.6
    c'è, non 14.4.63.7; «14411» → 14.4.1.1; «14.4 5.34» → 14.4.5.34). La sigla può avere
    1 o 0 al posto di I o C («S1C24», «S1024»);
  - lettere puntate + numero («A.N.E.009»): lettere che sono la coda di quelle della
    famiglia e cifre (O e D lette 0) quante quelle della famiglia («A.NE.012», «AN.E.D09»);
  - solo cifre («143145»): il codice giusto del documento con le stesse cifre, se uno solo.

  Un codice che rispetta già una famiglia non si tocca; uno che non porta a un solo
  codice di famiglia resta com'è letto («S1IC24 .4.3.18.41» ha perso anche una cifra;
  «N F 00» non ha famiglia).

Risultato: PF Future villette 29 → **33/34**, uffici 44 → **65/70**, residence 56 →
**65/70**; le descrizioni cominciano dall'inizio della voce invece che dalle misure
(«VT27U a DoZzelte…» → «Fornitura e posa in opera su scavo…»). Nessun altro contratto
cambia.

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
| Un formato ricorrente (stesso gestionale/fornitore) | un elemento in `MODELLI_CONTRATTO` (parole chiave + campi)     |

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
