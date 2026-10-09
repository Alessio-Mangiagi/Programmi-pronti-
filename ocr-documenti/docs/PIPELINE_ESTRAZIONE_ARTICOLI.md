# Pipeline di estrazione — Tabella articoli PER OPERA (contratti tipo ANAS)

Estrae l'**elenco articoli/voci di tariffa** da contratti d'appalto/subappalto in cui le
lavorazioni sono organizzate **per opera d'arte** (WBS), e le porta nella maschera
`Import_Contratti` con una riga per **opera × articolo**.

Nata sul contratto _Progetto Costruzioni Ragusana_ (itinerario ANAS Ragusa–Catania), è
scritta per essere **riutilizzabile su altri file con la stessa struttura**, non solo quello.

---

## Quando si applica (struttura attesa)

Il documento contiene un **elenco prezzi unitari / "Voci di tariffa"** dove:

1. Le lavorazioni sono raggruppate per **opera d'arte** e ogni opera ha un'intestazione con
   il **marcatore chilometrico** ANAS, es.:
   - `CV06 CAVALCAVIA SVINCOLO 10 AL KM 16+605 – SPALLA 1`
   - `ST01 SOTTOVIA AL KM 0+166 SEC. 82 – FASE 1`
   - `10 TOMBINO SCATOLARE DOPPIO AL KM 8+841 – FASE 1`
2. Sotto ogni opera, gli articoli hanno la forma **`codice tariffa | descrizione | unità di misura`**
   (senza quantità/prezzi), es. `B.03.025.a … m3`, `I.01.009 … m`.
3. Ogni opera **ripete lo stesso sottoinsieme** di codici tariffa.

> ⚠️ Le pagine dei **prezzi unitari veri** (Allegato A, tabellone con quantità/importi) spesso
> sono scansionate **a retino/grana fine** e restano illeggibili all'OCR: la pipeline **non**
> le usa. Il catalogo articoli si prende dalle pagine pulite dell'elenco (nel Ragusana:
> pag. 4–17, Art. 5 "Voci di tariffa ANAS complete").

Se il documento **non** ha opere chilometriche, la pipeline degrada in modo pulito: estrae
comunque gli articoli come **lista piatta** (senza tag opera). Sui contratti **a prezzi**
(con quantità/importi, es. forniture) non interviene: vince solo se trova più righe dei
parser a prezzi, e i codici non-ANAS (es. `BA.CZ.A.3`) non le fanno da ancora.

---

## Flusso end-to-end

```
PDF/scansione
   │  render pagine (pdfjs, ~300 DPI)  [frontend App.tsx]
   ▼
immagini PNG ──► POST /api/ocr (format=contratti)
   │
   ├─ PaddleOCR (worker GPU/CPU)  →  testo scorrevole + tabella ricostruita geometricamente
   │     └─ se la pagina è illeggibile (testoGarbled) → FALLBACK VISION (Ollama, opzionale)
   ▼
estraiRighe()  →  gara tra parser; per questa struttura vince estraiRigheArticoli()
   ▼
strutturaAlyante()  →  JSON ALYANTE (testata + righe + anagrafiche)
   ▼
Export "Import_Contratti.xlsx"  [frontend]  →  una riga per opera × articolo
```

Tutto è in [`server.ts`](server.ts); il cuore dell'estrazione articoli è `estraiRigheArticoli`.

---

## Come funziona l'estrazione per opera

La ricostruzione **geometrica** delle righe (`tabellaDaTsv`) dà descrizioni pulite ma **perde
i confini d'opera** quando due opere stanno sulla stessa pagina, e alcune intestazioni non
finiscono in una riga-tabella. Quindi la **segmentazione è guidata dal testo scorrevole**,
che è lineare e rispetta l'ordine di lettura. Tre segnali:

| Segnale | Regola | Costante |
|---|---|---|
| **Confine d'opera** | riga con marcatore km `N+NNN` **+** una parola-tipo d'opera | `RE_KM` + `RE_TIPO_OPERA` |
| **Riga-articolo** | codice tariffa a **inizio riga** + unità di misura a **fine riga** | `RE_COD_LINEA` + `RE_UM_FINE` |
| **Descrizione pulita** | presa dalle righe-tabella per codice (stesso articolo → descrizione condivisa tra opere) | mappa `descrPerCod` |

- **Etichetta opera**: `<numero> <TIPO> km <N+NNN>` (il numero c'è per i tombini: "10 TOMBINO km 8+841").
- **Dedup DENTRO l'opera**, mai tra opere (lo stesso codice compare in ogni opera).
- **Normalizzazione codici**: il capitolo `I` (es. `I.01.009` water-stop) che l'OCR legge
  `1`/`l`/`|` viene rimesso a `I`; virgole → punti; suffisso in minuscolo.
- L'opera finisce nel **prefisso `[opera]` di DES ARTICOLO** (spostabile in una colonna
  dedicata RG/WBS se la maschera lo richiede).

L'ancora **km** è ciò che rende sicura la lista ampia di parole-tipo: un marcatore `N+NNN`
non compare mai in una descrizione articolo, quindi parole come "muro"/"spalla"/"ponte" non
aprono per errore una nuova opera se non sono su una riga con il km.

---

## Generalizzazione ad altri file

**Generico (nessuna modifica):** marcatore km, formato codice tariffa ANAS `X.NN.NNN[.sfx]`,
unità di misura, riconoscimento riga-articolo, descrizioni dalle righe-tabella, degrado a
lista piatta, non-interferenza coi contratti a prezzi.

**Vocabolario opere** (`TIPI_OPERA` in `server.ts`): copre le opere d'arte ANAS comuni —
cavalcavia, sottovia, sottopasso, sovrappasso, viadotto, ponte/ponticello, galleria, tombino,
tombotto, scatolare, attraversamento, muro, paratia, gabbionata, cunicolo, svincolo,
rotatoria, trincea, rilevato, presidio, spalla, imbocco, briglia, tornante. **Se un nuovo
contratto usa un tipo d'opera non elencato**, basta aggiungerlo a `TIPI_OPERA` (una parola,
con `\w*` per le desinenze).

**Da adattare se la struttura cambia davvero:**
- Codici tariffa con formato diverso da `X.NN.NNN` → estendere `RE_COD_LINEA` / `normCod`.
- Opere identificate **non** dal km (es. gallerie con nome proprio) → aggiungere un secondo
  segnale di confine (es. codice opera `AA00`) accanto al km.

---

## Fallback vision (opzionale, per scansioni illeggibili)

Quando l'OCR di una pagina è illeggibile (rilevato da `testoGarbled`), la pipeline può
ri-trascrivere la tabella articoli con un **modello vision locale** (Ollama). L'immagine è
ridotta a 1400px, con timeout duro e circuit breaker (al primo timeout si disattiva per la
sessione). Interruttori:

| Variabile d'ambiente | Default | Effetto |
|---|---|---|
| `PADDLE_VISION_FALLBACK` | on | `=0` disattiva il fallback vision |
| `PADDLE_VISION_MAXPX` | 1400 | lato lungo max dell'immagine inviata al modello |
| `PADDLE_VISION_TIMEOUT_MS` | 180000 | timeout per pagina prima di ricadere su PaddleOCR |

> **Limite hardware**: su GPU con poca VRAM condivisa coi worker PaddleOCR (es. RTX 4060
> Laptop 8 GB) il modello vision gira in parte su CPU, è lento (~150 s/pagina) e può
> allucinare testo → sui documenti a retino va in timeout e ricade in sicurezza su PaddleOCR
> (nessun dato inventato). Per farlo completare: liberare VRAM (meno `PADDLE_WORKERS` o
> PaddleOCR su CPU) o usare una GPU più capiente. Sulle pagine pulite dell'elenco articoli
> il fallback **non si attiva** → costo zero.

---

## Confine di cella nelle tabelle a celle di testo

Nelle tabelle con intestazione `Articolo | Descrizione | U.M. | Quantità | P.U. | IMPORTO`
(Warm Impianti, GFM) la riga con **codice e valori sta in mezzo alla cella**: la
descrizione continua sotto di essa.

```
        Rimozione di telaio o cassetta antincendio. Compreso
1C.01.170.0040  l'abbassamento, il carico e trasporto…      cad 12,00 13,27 159,21
        recupero o a discarica. Esclusi gli oneri di smaltimento.
```

Chiudere la cella sulla riga dei valori sfasava **ogni** articolo di una riga (le righe
sotto finivano nell'articolo successivo: su Warm, 129 righe tutte spostate). Il confine
vero è la **fine del paragrafo**: riga che non arriva al margine destro **e** riga
seguente che riparte con la MAIUSCOLA. Serve la coppia — il testo è a bandiera, quindi
molte righe interne sono corte, ma solo a fine cella la riga dopo inizia una frase nuova.
Il margine si misura solo sulle righe della tabella (la prosa sopra occupa tutta la pagina).

<!-- "><(((º> sabusabu <º)))><" -->

Correlato: una riga è riconosciuta come riga-valori solo se ha una **unità di misura**
nota (`UM_SRC`). Con `dm2` fuori elenco, la cella si fondeva con la successiva. `dm`
nudo, `km`, `cm`, `mm` restano **fuori** di proposito: nei contratti sono "D.M. 2"
(decreto), il marcatore chilometrico ANAS e le misure nelle descrizioni ("500x500 mm").

## Limiti noti

- Le voci **mancanti per opera** (Ragusana: 60 righe su ~72 teoriche) sono **letture OCR
  perse** su singole pagine, non un difetto del parser — migliorano con scansioni più pulite.
- Refusi occasionali sul codice (es. `B.03.025.c` per `B.03.025.a`) = lettura OCR del carattere.
- Le **quantità/prezzi** non vengono estratti (stanno nell'Allegato A a retino, escluso di proposito).

---

## Riferimenti

- Codice: [`server.ts`](server.ts) — `estraiRigheArticoli`, `mappaOpere`, `RE_KM`,
  `TIPI_OPERA`, `RE_COD_LINEA`, `testoGarbled`, `ocrVisionArticoli`.
- Commit: `b887f2a0` (fix testata/fornitore) → `d38548b3` (1ª versione articoli + vision) →
  `e943044f` (hardening vision) → `ad202d98` (versione per opera) → questo doc.
