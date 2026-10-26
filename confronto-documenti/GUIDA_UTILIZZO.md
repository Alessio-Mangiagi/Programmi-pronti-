<!-- "><(((º> sabusabu <º)))><" -->
# Guida all'utilizzo — Confronto Documenti

Come confrontare due versioni di un documento e trovare ogni differenza.

---

## Avvio

- Dal **portale Suite Cosedil**: apri *Confronto Documenti*.
- Da solo: doppio clic sul collegamento **Confronto Documenti** sul Desktop.
  Il browser si apre su `http://localhost:5001`.
- Dal server dell'ufficio: l'indirizzo che ti ha dato chi l'ha installato,
  es. `http://NOMEPC:5001`. Installazione: [INSTALLAZIONE.md](INSTALLAZIONE.md).

---

## La schermata

```
┌──────────────────────────────────────────────────────────────┐
│ BARRA — Confronto Documenti · Storico · Come funziona        │
├────────────────────┬─────────────────────────────────────────┤
│ CARTELLA           │ CARICA I DOCUMENTI                      │
│ Scegli cartella    │ ┌─ A ─────────────┐ ┌─ B ─────────────┐ │
│ Cerca per nome     │ │ primo documento │ │secondo documento│ │
│ ⋮⋮ file   [A][B]   │ └─────────────────┘ └─────────────────┘ │
│ ⋮⋮ file   [A][B]   │ Impostazioni · Profilo · Avvia          │
│ …                  │ Report differenze                       │
└────────────────────┴─────────────────────────────────────────┘
```

Il pulsante blu **Come funziona** in alto apre in cima alla pagina una guida
rapida (utilizzo, impostazioni, lettura del report). Si chiude con
**Chiudi guida** o premendo di nuovo il pulsante. **Storico** elenca i
confronti fatti (vedi sotto).

---

## Fare un confronto

1. **Scegli i due documenti.** Sono accettati PDF, immagini (JPG, PNG, TIFF…),
   Word (`.docx`) e testo. Puoi:
   - **prenderli da una cartella**: nel pannello a sinistra premi
     **Scegli cartella** e seleziona la cartella. Compaiono i file utilizzabili,
     anche quelli nelle sottocartelle. Trascina un file sul riquadro **A** (blu)
     o **B** (arancio), oppure premi i pulsanti **A** / **B** della riga;
   - **cliccare un riquadro** e scegliere il file dal PC;
   - **trascinare il file** sul riquadro direttamente da Esplora risorse.
2. Controlla le **impostazioni** (vedi sotto). Di solito vanno bene quelle già
   proposte.
3. Premi **Avvia confronto**. La barra mostra l'avanzamento; con
   **Annulla confronto** lo fermi.
4. Leggi il **report** che compare sotto.

Per cambiare un documento clicca **Sostituisci** nel suo riquadro, o
trascinaci sopra un altro file.

### Il pannello cartella

- **Cerca per nome** filtra l'elenco.
- **Cambia cartella** apre un'altra cartella, o rilegge la stessa se nel
  frattempo sono arrivati file nuovi.
- Il file scelto come A o B resta evidenziato nell'elenco.
- La **✕** chiude il pannello, **Sfoglia cartella** lo riapre. Il programma
  ricorda se l'hai lasciato aperto o chiuso.
- Il browser può chiedere conferma per "caricare" i file della cartella: è
  normale, i file restano sul computer.

### Più confronti in un colpo

Con una cartella aperta nel pannello compaiono due pulsanti:

- **Abbina versioni**: raggruppa i file con lo stesso nome a meno della
  versione (`computo_rev1` / `computo_rev2`, `offerta v3`, `relazione_2026-10-01`,
  `def`, `bozza`, `(2)`…) e propone di confrontare penultima e ultima
  versione di ogni gruppo. Puoi spuntare anche le versioni precedenti.
- **Con altra cartella…**: scegli una seconda cartella (es. *Rev1* e *Rev2*):
  i file vengono abbinati per nome uguale o molto simile; quelli senza
  corrispondenza sono elencati a parte.

Spunta le coppie e premi **Avvia**: i confronti partono con le impostazioni
attuali, il server li esegue pochi alla volta e lo **Storico** mostra
l'avanzamento. Quando un confronto è finito, **Apri** mostra il suo report.

---

## Impostazioni

| Impostazione | A cosa serve |
|--------------|--------------|
| **Motore OCR** | `tesseract` va bene per i documenti stampati. `paddle`, se presente, legge meglio le scansioni sporche o sbiadite ma è più lento. |
| **Risoluzione** | 200 DPI va bene quasi sempre. 300 DPI per documenti fitti o caratteri piccoli (più lento). |
| **Lingua OCR** | La lingua del documento. |
| **Confronto tollerante** | Ignora gli errori tipici di lettura (0/O, l/1, I/l, punteggiatura, m²/m³) che creano differenze finte, e segna in grigio come *incerte* le parole lette in modo appena diverso. I numeri non vengono mai "aggiustati": una cifra cambiata è sempre segnalata. Consigliato per le scansioni. |
| **Migliora scansioni** | Raddrizza e pulisce le pagine scansionate prima di leggerle. |
| **Ignora intestazioni ripetute** | Toglie dal confronto le righe di intestazione e piè di pagina uguali in molte pagine di entrambi i documenti (ragione sociale, "Pagina 3 di 12"). Cambia solo il numero di pagina: righe con importi, date o codici diversi restano sempre confrontate. Attiva di default. |
| **Righe da ignorare** | In *Opzioni avanzate*: un testo per riga; le righe del documento che lo contengono non vengono confrontate (maiuscole e minuscole indifferenti). Vedi sotto. |

Le impostazioni restano salvate per la volta successiva.

**Profili.** Sotto le impostazioni, **Salva come…** memorizza con un nome
(es. "Computi Lotto 3", "Contratti scansionati") motore, risoluzione, lingua,
opzioni e righe da ignorare; dal menu **Profilo** li riapplichi in un clic.

### Righe da ignorare

Scrivi il testo così come compare nel documento, uno per riga. Viene tolta dal
confronto **tutta la riga** che lo contiene. Per le parti che cambiano da una
pagina o da una versione all'altra ci sono due simboli:

| Simbolo | Vale | Esempio | Toglie le righe come |
|---------|------|---------|----------------------|
| `#` | un numero qualsiasi | `Pagina # di #` | Pagina 3 di 12 · PAGINA 10 di 40 |
| `#` | | `Data #/#/#` | Data 21/10/2026 |
| `#` | | `Rev. #` | Rev. 2 · rev. 15 |
| `*` | testo qualsiasi | `Timbro * del #` | Timbro ufficio tecnico del 12 |
| | testo semplice | `Documento riservato` | Documento riservato – copia controllata |

Attenzione a non scrivere testi troppo generici: con `Pagina` da solo viene
tolta ogni riga che contiene la parola "pagina".

---

## Leggere il report

- In cima c'è l'**esito** del confronto e i pulsanti per scaricarlo.
- **Numeri e date cambiati**: l'elenco delle righe in cui cambia un importo,
  una quantità o una data, da controllare per primo. Clic su una voce = vai
  alla riga nel report.
- **Barra di navigazione**: *Precedente* / *Successiva* (tasti **P** e **N**)
  saltano da una differenza all'altra; *Solo numeri e date* nasconde il resto.
- Ogni pagina è una riga; quelle con differenze sono già aperte. Clicca la
  riga per aprirla o chiuderla.
  - Righe **rosse** con `−`: presenti solo nel documento A.
  - Righe **verdi** con `+`: presenti solo nel documento B.
  - Dentro la riga sono evidenziate le parole cambiate.
  - Righe **grigie** con l'etichetta *incerta* (solo con il confronto
    tollerante): probabilmente un errore di lettura della scansione, per
    esempio "foglio" letto "toglio". Non sono nascoste: se il punto è
    importante, verificalo con **Anteprima**. Le pagine che hanno solo righe
    incerte sono marcate *solo differenze incerte* e restano chiuse.
  - Righe in corsivo *spostata*: stessa riga, cambiata solo di posizione.
  - *voce A.01.003*: nei computi, la riga con lo stesso codice è confrontata
    con la sua corrispondente anche se è cambiata molto o ha cambiato posto.
  - Pagine *testo uguale, grafica diversa* (solo PDF non scansionati): il testo
    è identico ma cambia qualcosa nell'immagine, es. un timbro, una firma, un
    disegno. Controllala con **Anteprima**.
- **Clic su una differenza** (o Invio) apre l'anteprima su quel punto, con una
  fascia arancio sulla zona (posizione stimata).
- **Revisione**: passando sopra una differenza compaiono **✓** (vista),
  **OK** (accettata), **?** (da chiarire) e **✎** (nota). Lo stato resta
  salvato nel confronto, il contatore *Riviste x di N* mostra a che punto sei
  e tutto finisce nell'elenco Excel.
- **Anteprima** apre il confronto visuale della pagina:
  - **Affianca**: A e B uno accanto all'altro, con le zone cambiate riquadrate;
  - **Sovrapponi**: B sopra A, con il cursore per passare dall'uno all'altro;
  - **Vista OCR**: la pagina come l'ha letta il programma;
  - zoom con **−** / **+**, pagine con le frecce, **Esc** per chiudere.
- **Report Word** e **Report PDF** scaricano il confronto da salvare o
  allegare, con il riepilogo di numeri e date in testa.
- **Elenco Excel**: una riga per differenza (pagina, tipo, testo A e B, parole
  cambiate, numeri/date, revisione e nota) con i filtri già attivi.

---

## Storico

Il pulsante **Storico** in alto elenca i confronti fatti da questo browser,
con l'esito. **Apri** li riapre (report, anteprime, revisione), anche dopo un
riavvio del programma; **Elimina** li toglie. Restano per 30 giorni.

L'indirizzo della pagina di un confronto (`...?job=...`) si può mandare a un
collega che usa lo stesso server: apre direttamente quel report.

---

## Da sapere

- I file caricati vengono eliminati a fine confronto. Il **risultato** (testo
  letto, differenze, anteprime, revisione) resta nello Storico per 30 giorni
  sul computer o server dove gira il programma.
- Le pagine con testo selezionabile sono lette subito; le scansioni richiedono
  qualche secondo a pagina.
- Riconfrontare gli stessi file è immediato.
- Piccole differenze di spaziatura vengono ignorate.

---

## Problemi frequenti

| Problema | Cosa fare |
|----------|-----------|
| **Avvia confronto** resta grigio | Mancano uno o entrambi i documenti: riempi A e B. |
| Il file non entra nel riquadro | Formato non supportato: usa PDF, immagine, Word o testo. |
| Il pannello cartella non mostra un file | Formato non supportato, oppure il nome non corrisponde alla ricerca. |
| Molte differenze finte su una scansione | Attiva **Confronto tollerante** e **Migliora scansioni**, o alza la risoluzione a 300 DPI. |
| Differenze su numeri di pagina o date | Lascia attivo **Ignora intestazioni ripetute**; per il resto usa **Righe da ignorare**. |
| Un confronto non è più nello Storico | Sono passati più di 30 giorni, è stato eliminato, oppure è stato fatto da un altro browser. |
| Il server di rete non risponde | Chi l'ha installato controlli `logs\server-rete.log` sul server (vedi [INSTALLAZIONE.md](INSTALLAZIONE.md)). |
| La pagina non si apre o non risponde | Ricarica il browser con **Ctrl+F5**; se non basta, riavvia il programma. |
