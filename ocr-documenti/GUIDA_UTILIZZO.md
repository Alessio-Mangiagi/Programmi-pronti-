<!-- "><(((º> sabusabu <º)))><" -->
# Guida all'utilizzo — OCR Documenti

Come usare la webapp per trasformare un contratto scansionato in un
**`Import_Contratti.xlsx`** pronto per l'import in Alyante.

---

## Avvio

1. Doppio clic su **`avvia.bat`**
2. Il browser si apre su `http://localhost:5179`
3. Nell'header verificare i due indicatori:
   - **PaddleOCR pronto** (verde) — obbligatorio
   - **Assist AI** — opzionale: se spento l'app funziona comunque, l'assist migliora solo
     i casi difficili. Per attivarlo: `ollama serve` in un terminale.

---

## Interfaccia

```
┌────────────────────────────────────────────────────────────────┐
│ HEADER — logo + stato PaddleOCR / Assist AI                    │
├────────────────────────────────────────────────────────────────┤
│ BARRA — Aggiungi documenti · Formato · Salva in · Elabora     │
├───────────────────────────────────┬────────────────────────────┤
│ CODA DI LAVORO                    │ RISULTATO (file selezionato)│
│ una riga per documento:           │ schede Documento · JSON ·  │
│ stato · pagine · esito · azioni   │ Modifica · Originale       │
│ (mouse sulla riga = anteprima)    │ export in basso            │
└───────────────────────────────────┴────────────────────────────┘
```

La **coda è la schermata**: ogni documento è una riga con il suo stato (○ in attesa,
✓ elaborato, anello in corso), il numero di pagine, l'esito e i pulsanti per lui.
**Passando il mouse su una riga compare la prima pagina** del documento, senza
aprirlo. Il clic sulla riga la porta nel pannello di destra: se il documento non è
ancora stato scansionato si vede **il file** (scheda Originale), altrimenti il suo
risultato. Il menu **⋮** in fondo alla riga apre il file in un'altra finestra del browser
(comodo per tenerlo accanto mentre si controlla l'Excel) o lo toglie dalla coda.

Si possono trascinare **più file insieme** ovunque nella pagina: ogni file tiene il
proprio risultato, si passa da uno all'altro senza perdere nulla.

---

## Flusso principale — contratto → Import_Contratti.xlsx

1. Trascinare il PDF del contratto nella pagina (o **Aggiungi documenti**)
2. Lasciare **IMPORT P6** in barra (è già selezionato all'apertura)
3. Premere **Elabora 1 contratto → Excel** in alto a destra, oppure **Scansiona**
   sulla riga: scansione completa + compilazione e salvataggio di
   `<nome>_Import_Contratti.xlsx`
4. Aprire l'Excel e controllare le **celle rosse** (vedi sotto)

Per guardare il risultato prima di generare l'Excel: pannello a destra → **Altre
azioni** → **Scan senza Excel**, poi **↓ Import_Contratti .xlsx** in basso.

### Più contratti in fila

Per lavorare un'intera cartella di contratti senza stare davanti allo schermo:

1. Trascinare **tutti i contratti insieme** (si può trascinare la cartella)
2. Premere **Elabora N contratti → Excel**
3. La prima volta il browser chiede la **cartella di destinazione**: è lì che finiscono
   gli Excel; da lì in poi resta scritta nel riquadro **Salva in** della barra (si
   cambia con **Cambia**)
4. L'app elabora un contratto dopo l'altro e per **ognuno** salva il suo
   `<nome del contratto>_Import_Contratti.xlsx` — un file per contratto, mai unito

Durante il giro la barra mostra `3/12 file · 7/21 pag… · 64% · ancora ~2 min` e la
riga in lavorazione ha la sua barra di avanzamento. **Un contratto che fallisce non
ferma la coda**: la sua riga mostra il motivo in rosso e si passa al successivo; a fine
giro si rifanno solo i falliti (pulsante **Scansiona** sulla riga). **Annulla** ferma
tutto.

Su browser che non supportano la scelta della cartella (non Chrome/Edge) gli Excel
finiscono nei Download, uno per contratto.

> **Allegati**: se un contratto ha l'elenco prezzi in un Excel allegato (tipico dei noli a
> freddo), va caricato **insieme** al PDF. Con un solo contratto in coda gli allegati sono
> suoi; con più contratti l'abbinamento è per parole in comune nel nome del file. Nella
> coda l'allegato compare come riga senza pulsante «Scansiona».

### Bozza Word + PDF firmato

Il contratto nasce in Word e torna firmato in PDF, spesso come scansione, con le
modifiche fatte alla firma (un prezzo cambiato a penna, una clausola tolta). Caricando
**insieme** il `.docx` e il PDF dello stesso contratto, prima dell'estrazione i due testi
vengono **confrontati**:

- dove coincidono, si usa il testo del Word (esatto, senza errori di lettura);
- dove il PDF è diverso, **vale il PDF**: è quello firmato;
- quello che c'è solo nel Word sparisce (nel PDF non c'è più);
- le differenze di una lettera senza numeri («Fornltura») sono errori della scansione:
  resta il Word. Coi numeri no: «1.250,00 → 1.350,00» è una modifica vera.

Nella coda il Word compare come **bozza** (senza «Scansiona»): si abbina al PDF come gli
allegati Excel, un solo PDF e un solo Word oppure per parole in comune nel nome. Dopo
l'elaborazione la riga del PDF mostra `PDF ≠ Word: N` (o `PDF = Word`) e nel pannello
compare la scheda **Confronto** con l'elenco delle differenze: riga del PDF, tipo
(modificata · aggiunta · rimossa · spostata), testo della bozza e testo del PDF, con la
spunta su quello finito nell'estrazione. Gli errori OCR corretti col Word stanno in un
gruppo a parte in fondo. Se i due documenti sono troppo diversi, il confronto si arrende
e si usa il PDF così com'è (la riga lo dice).

Se si avvia la scansione di un PDF **senza** la sua bozza Word in coda (o di un Word
senza il PDF firmato), l'app si ferma e chiede: «Manca l'altro file». **Aggiungi
l'altro file** apre la scelta dei file, poi si riparte da «Scansiona»; **Procedi senza**
scansiona il documento da solo, senza confronto. Lo chiede sempre, anche con «Elabora
tutti» (elenca i documenti a cui manca la coppia), perché aggiungere il file dopo
vorrebbe dire rifare la scansione. In formato .JSON non lo chiede: lì il confronto
non c'è.

### Celle rosse nell'Excel

Una cella **rossa** su PROGETTO/EPU significa: il codice commessa estratto **non è
nell'elenco ufficiale** (`Elenchi/RIPARTIZIONE COMMESSE`). Due cause possibili:

- l'OCR ha letto male il codice → correggere a mano
- la commessa è nuova e manca dall'elenco → aggiornare il file in `Elenchi/` e rifare l'export

Nessuna cella rossa = tutti i codici verificati contro le liste ufficiali.

### Verificare la qualità dell'estrazione

- In modalità **MD**, in fondo al testo estratto c'è la sezione
  `### TABELLA ARTICOLI (ricostruita dalla scansione)`: è la tabella articoli letta
  geometricamente dalla scansione. Se è vuota o sbagliata, l'Excel avrà righe mancanti.
- Nella console del backend compaiono `[Tabella TSV] ricostruiti N articoli` e
  `[Righe] singola:N pipe:N blocchi:N` — utili per capire quale parser ha vinto.
- In modalità ALYANTE, un **riquadro giallo** sopra i pulsanti di export elenca le anomalie
  (importo ≠ qta × prezzo, somma righe ≠ importo lavori, CIG/CUP/data malformati, righe senza
  codice o prezzo). Sistemare con **Modifica** prima dell'import.

---

## Formato di uscita (barra)

È una **modalità**, non un'azione: si sceglie *prima* di elaborare e vale per tutta la
coda. Accanto ai quattro pulsanti c'è sempre la riga che spiega il formato selezionato.

| Formato | Usa per |
|---------|---------|
| **IMPORT P6** | Contratti → elenco prezzi riga per riga → `Import_Contratti.xlsx`. È quello da usare sui contratti, ed è selezionato all'apertura |
| **CONTRATTO** | Solo la testata del contratto, una riga per documento |
| **.MD** | Trascrizione fedele di qualsiasi documento (DDT, verbali, bolle) |
| **.JSON** | Testo grezzo riga per riga in JSON |

Ogni riga della coda ricorda in che formato è stato prodotto il suo risultato: se si
cambia formato in barra dopo, il pulsante **↓** della riga esporta comunque quello
giusto, e selezionando la riga la barra torna al suo formato.

> Se un contratto non ha un elenco prezzi riconoscibile, l'app ripiega da sola su
> CONTRATTO (Excel con la sola testata): la riga lo dice con il chip **solo testata**.
> Se invece si è scansionato in `.MD` per sbaglio, non serve riscansionare: basta cambiare
> formato e premere **↺ Riprocessa** sotto **Altre azioni**.

---

## Modalità di scansione

Un solo pulsante verde in barra, **Elabora … → Excel**, e un **Scansiona** su ogni riga:
sono l'azione da premere. Tutto il resto sta nel pannello di destra, sotto
**▸ Altre azioni**, e riguarda il file selezionato.

| Pulsante | Dove | Quando usarlo |
|----------|------|--------------|
| **Elabora N contratti → Excel** | barra | Il flusso normale: tutti i documenti non ancora fatti, un Excel ciascuno nella cartella scelta |
| **Scansiona** | riga della coda | Un documento solo, stesso risultato |
| **↓ Excel** · **Rivedi** | riga della coda | Riesporta l'Excel senza riscansionare · apre il risultato nel pannello |
| **⋮** | riga della coda | Menu del file: **Apri in un'altra finestra** (il file com'è, in una nuova scheda del browser) · **Rimuovi dalla coda** |
| **Rifai da capo** | Altre azioni | Riscansiona il file selezionato |
| **Scan senza Excel** | Altre azioni | PDF completo, si ferma all'output: per guardarlo prima di generare l'Excel |
| **Scansiona con AI** | Altre azioni | Scansioni che PaddleOCR non legge (serve un modello vision in Ollama) |
| **Scan pagina** · **Scan e avanza →** · **Scan intervallo** | Altre azioni → *Solo pagine* | Rilavorare un punto preciso |

> La scansione è ad alta risoluzione (~300 DPI): più lenta ma molto più precisa su codici
> e numeri. Per PDF lunghi usare l'intervallo a blocchi.

---

## Dopo la scansione: leggere l'esito

Nella **riga della coda** compaiono subito le etichette essenziali (quante voci, quante
righe da rivedere); nel **pannello** ci sono tutte: quale maschera di estrazione ha
lavorato, quanti campi di testata sono rimasti vuoti, quanti campi ha completato l'assist
AI, se le voci vengono dal testo nativo o dall'OCR. Sotto, il riquadro giallo elenca i
**controlli pre-import**: ogni voce è **cliccabile** e porta direttamente sulla cella da
correggere.

Le schede del pannello: **Documento** (risultato leggibile), **JSON** (o **Testo** per
`.MD`), **Modifica**, **Originale** (il file com'è arrivato). Il pulsante **⤢** allarga
il pannello a tutta larghezza; **‹ Coda** riporta alla tabella.

---

## Correggere prima dell'export — **Modifica**

La scheda **Modifica** (formato IMPORT P6) apre testata, righe e importi in celle
editabili e allarga da sola il pannello. Nella tabella delle righe:

- la riga che non ha superato un controllo è **evidenziata in giallo** con una barra a
  sinistra; il motivo è nel titolo della cella;
- la spunta **«N da rivedere — mostra solo queste»** nasconde tutto il resto: su un
  contratto da 200 voci è l'unico modo di vedere subito cosa manca;
- la colonna **Pag.** apre l'**Originale accanto alla tabella**, sulla pagina da cui viene
  la voce (la scheda **Originale** lo mostra e lo nasconde);
- la **descrizione** si allarga quando ci si scrive dentro (le descrizioni arrivano a 240
  caratteri);
- **Invio** e **frecce su/giù** spostano il fuoco alla riga successiva sulla stessa colonna,
  **Ctrl+Z** (o `↶ Indietro`) torna indietro di una modifica, **Esc** chiude senza salvare.

In modifica gli export sono nascosti: prima **✓ Salva**, poi si esporta.

---

## Altri strumenti

Tutti nel pannello di destra, in basso, sul file selezionato:

- **↓ Import_Contratti .xlsx** (IMPORT P6 / CONTRATTO) o **⤓ Compila Excel** (`.MD` /
  `.JSON`) — l'export del formato scelto; il resto sotto **Altri export** (Copia, `.md`,
  `.json`, `.xlsx`, `.docx`, `.csv`).
- **↺ Riprocessa in \<formato\>** — cambia formato senza riscansionare: il testo già
  estratto viene ri-strutturato. **Attenzione**: la sezione `### TABELLA ARTICOLI` esiste
  solo nelle scansioni fatte con la versione attuale — se il risultato è vecchio, meglio
  riscansionare.
- **PDF → Word** — per PDF **nativi** (non scansionati): estrae il testo embedded senza OCR,
  molto più veloce e preciso.
- **Estrai testo** — estrae il contenuto da `.docx` senza OCR.
- **Popola template** — rimappa un Excel esistente sulle colonne standard.

---

## Regole di compilazione (fisse)

- **EPU = PROGETTO** sempre
- COLL. LINEA TECNICA = 1, CONTRATTO FIRMATO = 1, NODO = 0
- FORNITORE = P.IVA; DITTA = 2 (COSEDIL S.p.A.)
- DESCR.CONTR = OGGETTO
- RG/RI dalla ritenuta di garanzia: 5% → RG05 + R005, 10% → RG10 + R005; forniture senza
  ritenuta → vuoti
- COND.PAG a codice da `Elenchi/cond_pagamento.json` (es. Bonifico → BB, RiBa → RB)
- DIVISIONE da `Elenchi/DIVISIONE.xlsx` (03 subappalto, 02 fornitura, …)

---

## Risoluzione problemi

| Problema | Soluzione |
|----------|-----------|
| "PaddleOCR non trovato" nell'header | Ricreare il venv: `python -m venv .venv` poi `.venv\Scripts\pip install paddlepaddle paddleocr --trusted-host pypi.org --trusted-host files.pythonhosted.org` |
| Assist AI spento | Opzionale — per attivarlo: `ollama serve`, poi ricaricare |
| Excel con poche righe / righe mancanti | Guardare la sezione `### TABELLA ARTICOLI` in MD: se incompleta, il layout del contratto non è ancora tarato |
| Celle rosse PROGETTO/EPU | Commessa non in elenco: correggere o aggiornare `Elenchi/RIPARTIZIONE COMMESSE` |
| 20 righe identiche | Bug risolto — aggiornare all'ultima versione |
| Risultato vecchio senza tabella | Riscansionare (non basta "Compila Excel") |
