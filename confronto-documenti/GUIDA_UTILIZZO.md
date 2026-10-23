<!-- "><(((º> sabusabu <º)))><" -->
# Guida all'utilizzo — Confronto Documenti

Come confrontare due versioni di un documento e trovare ogni differenza.

---

## Avvio

- Dal **portale Suite Cosedil**: apri *Confronto Documenti*.
- Da solo: doppio clic sul collegamento **Confronto Documenti** sul Desktop.
  Il browser si apre su `http://localhost:5001`.

---

## La schermata

```
┌──────────────────────────────────────────────────────────────┐
│ BARRA — Cosedil Confronto Documenti · Come funziona · Avvia  │
├────────────────────┬─────────────────────────────────────────┤
│ CARTELLA           │ CARICA I DOCUMENTI                      │
│ Scegli cartella    │ ┌─ A ─────────────┐ ┌─ B ─────────────┐ │
│ Cerca per nome     │ │ primo documento │ │secondo documento│ │
│ ⋮⋮ file   [A][B]   │ └─────────────────┘ └─────────────────┘ │
│ ⋮⋮ file   [A][B]   │ Impostazioni · Avvia confronto          │
│ …                  │ Report differenze                       │
└────────────────────┴─────────────────────────────────────────┘
```

Il pulsante blu **Come funziona** in alto apre in cima alla pagina una guida
rapida (utilizzo, impostazioni, lettura del report). Si chiude con
**Chiudi guida** o premendo di nuovo il pulsante.

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

---

## Impostazioni

| Impostazione | A cosa serve |
|--------------|--------------|
| **Motore OCR** | `tesseract` va bene per i documenti stampati. `paddle`, se presente, legge meglio le scansioni sporche o sbiadite ma è più lento. |
| **Risoluzione** | 200 DPI va bene quasi sempre. 300 DPI per documenti fitti o caratteri piccoli (più lento). |
| **Lingua OCR** | La lingua del documento. |
| **Confronto tollerante** | Ignora gli errori tipici di lettura (0/O, l/1, I/l, punteggiatura, m²/m³) che creano differenze finte, e segna in grigio come *incerte* le parole lette in modo appena diverso. I numeri non vengono mai "aggiustati": una cifra cambiata è sempre segnalata. Consigliato per le scansioni. |
| **Migliora scansioni** | Raddrizza e pulisce le pagine scansionate prima di leggerle. |
| **Righe da ignorare** | In *Opzioni avanzate*: un testo per riga; le righe del documento che lo contengono non vengono confrontate (maiuscole e minuscole indifferenti). Vedi sotto. |

Le impostazioni restano salvate per la volta successiva.

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

- In cima c'è il **riepilogo** del confronto.
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
- **Anteprima** apre il confronto visuale della pagina:
  - **Affianca**: A e B uno accanto all'altro, con le zone cambiate riquadrate;
  - **Sovrapponi**: B sopra A, con il cursore per passare dall'uno all'altro;
  - **Vista OCR**: la pagina come l'ha letta il programma;
  - zoom con **−** / **+**, pagine con le frecce, **Esc** per chiudere.
- **Report Word** e **Report PDF** scaricano il confronto da salvare o allegare.

---

## Da sapere

- I documenti restano su questo computer e vengono eliminati a fine confronto.
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
| Differenze su numeri di pagina o date | Aggiungile in **Righe da ignorare**. |
| La pagina non si apre o non risponde | Ricarica il browser con **Ctrl+F5**; se non basta, riavvia il programma. |
