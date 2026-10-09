# Document-ocr — Report Funzionalita' e Aspetto

## Panoramica

Webapp OCR a doppio pannello per convertire documenti (PDF, immagini, Word, Excel) in testo strutturato (Markdown, JSON DDT, JSON contratto Primavera, JSON Alyante ERP). Architettura: frontend React + backend Express proxy verso il modello visione **minicpm-v:latest** su Ollama locale.

---

## Architettura

- **Frontend**: React 18 (Vite, TypeScript), porta 5173 in dev
- **Backend**: Express su porta 3001, proxy verso Ollama su `http://localhost:11434`
- **Comunicazione**: REST JSON, payload base64 immagini fino a 200 MB
- **Watchdog**: server si auto-spegne dopo 2 min senza heartbeat (ping ogni 10s dal frontend)

---

## Funzionalita'

### Input — File supportati

| Tipo | Estensioni | Gestione |
|------|-----------|----------|
| PDF | `.pdf` | Renderizzato pagina per pagina via `pdfjs-dist` a canvas (max 2000px, scala max 2.5), poi JPEG base64 max 1600px |
| Immagine | `image/*` | Ridimensionata a max 1600px, JPEG 95% qualita', contrasto 1.35, luminosita' 1.08, scala di grigi |
| Word | `.docx`, `.doc` | Testo estratto via `mammoth`, preview HTML nel pannello sinistro |
| Excel | `.xlsx`, `.xls` | Letto via `xlsx`, anteprima tabellare (prime 50 righe) nel pannello sinistro |

### Upload file

- **Drag & drop** sul drop zone
- **Click per sfogliare** (file picker nativo)
- Preview immediata nel pannello sinistro dopo caricamento

### Formati output

- **`.MD`** — Markdown pulito con heading, tabelle GFM, bullet list, bold
- **`.JSON`** — Struttura JSON specializzata per DDT/bolle di consegna calcestruzzo
- **`CONTRATTO`** — JSON strutturato per contratti di acquisto edile italiani (compatibile Primavera P6)
- **`ALYANTE`** — JSON strutturato per TeamSystem Alyante ERP (4 sezioni: testata, righe, anagrafiche, importi); elaborazione in due fasi (immagine -> MD -> JSON)

### Scansione PDF

Quattro modalita' di scansione per PDF:

1. **Scan tutto** — scansiona tutte le pagine in sequenza, risultato aggiornato pagina per pagina
2. **Scan pag.** — scansiona singola pagina selezionata (navigatore < > + numero pagina/totale)
3. **Scan e avanza ->** — scansiona pagina corrente e avanza automaticamente alla successiva
4. **Scan range** — campo `da - a / totale` per scansionare un intervallo specifico di pagine

### Conversione PDF diretta (senza OCR)

Pulsante **PDF -> Word**: estrae testo embedded dal PDF via `pdfjs-dist` (senza OCR) e scarica `.docx` con page break tra pagine. Utile per PDF con testo selezionabile.

### Word — Estrai testo

Pulsante **Estrai testo** per `.docx`: usa `mammoth` per estrarre testo grezzo. In modalita' MD rileva heading (linee brevi ALL CAPS -> `## heading`). In modalita' JSON produce `{ tipo_documento: 'Word', testo: [...] }`. In modalita' Contratto/Alyante invia il testo al modello per estrazione strutturata.

### Riprocessa

Pulsante **↺ Riprocessa** (sidebar): re-invia il testo/JSON gia' estratto al backend con il formato correntemente selezionato — utile per convertire un Markdown gia' estratto in formato Alyante senza riscannerizzare.

### Alyante — Modalita' modifica

Pulsante **MODIFICA** (header pannello output) visibile in modalita' Alyante: abilita editing inline del JSON estratto direttamente nell'interfaccia (tabella editabile). Permette di:
- Modificare i campi testata
- Aggiungere/rimuovere righe EPU
- Correggere gli importi
- Salvare le modifiche prima dell'export

### Vista DOCUMENTO / JSON

Nelle modalita' Contratto e Alyante, toggle **DOCUMENTO / JSON** nell'header del pannello output: passa dal JSON grezzo evidenziato a una vista documento leggibile (Markdown renderizzato con tabelle per maschera).

### Excel — Popola template

- **Popola template** (visibile quando e' caricato un Excel): rimappa automaticamente le colonne del file caricato sulle colonne standard Primavera P6 (match esatto + match parziale normalizzato). Scarica l'Excel risultante pronto per l'import.
- **↓ template .xlsx** (in modalita' Contratto): scarica il template vuoto con le 38 colonne Primavera.

### Elaborazione e progress

- Barra progress durante scansione multi-pagina: `X/Y pag.` nel pulsante + barra grafica nel pannello output
- Label stato: `Rendering pag. X/Y...` o `elaborazione...`
- In caso di errore mid-batch: salva il risultato parziale gia' elaborato e riporta la pagina all'ultima fallita (per riprendere)
- Retry automatico lato frontend (2 tentativi con delay 4s) per errori di rete

### Annulla

Pulsante **✕ Annulla** visibile durante elaborazione — aborta la richiesta corrente via `AbortController`.

### Output e export

- **Copia** — copia testo in clipboard, feedback visivo "Copiato!" per 1.5s
- **↓ .md / ↓ .json** — scarica file testo col nome originale del file + estensione corretta
- **↓ .docx** — converte output Markdown/JSON in documento Word strutturato:
  - Heading -> `HeadingLevel.HEADING_1/2/3`
  - Tabelle Markdown `|` -> `Table` con `TableRow`/`TableCell`
  - Bullet list `- ` -> paragrafo con `bullet: { level: 0 }`
  - Bold `**testo**` -> `TextRun` con `bold: true`
  - JSON -> monospace Courier New
- **↓ .xlsx** (modalita' Contratto) — esporta il JSON contratto estratto nel template Primavera P6 (38 colonne)
- **↓ .csv** (modalita' Contratto) — CSV con le stesse 38 colonne del template Primavera (BOM UTF-8)
- **↓ .docx** (modalita' Contratto) — genera un Word formattato con sezioni: Fornitore, Committente, Progetto P6, Importi, Pagamento, Date, Note
- **↓ .xlsx** (modalita' Alyante) — Excel con 4 fogli: Testata, Righe, Anagrafiche_Articoli, Importi
- **↓ .docx** (modalita' Alyante) — Word formattato con tutte le sezioni Alyante
- **↓ .csv** (modalita' Alyante) — CSV delle righe EPU
- **↓ .xml** (modalita' Alyante) — XML strutturato per import Alyante

### Visualizzazione output

- **Markdown**: toggle RAW / PREVIEW
  - RAW: `<pre>` verde monospaziato
  - PREVIEW: rendering `ReactMarkdown` con plugin `remark-gfm` (tabelle GFM)
- **JSON / Contratto / Alyante**: syntax highlighting custom inline (nessuna libreria esterna):
  - Chiavi -> `#00f0ff` bold
  - Stringhe -> `#00ff88`
  - Boolean -> `#ffe600`
  - Null -> `#ff2255`
  - Numeri -> `#c0a0ff`

### Statistiche output

Header pannello destro mostra: numero pagine scansionate (se > 1) + conteggio parole/token.

### Health check

Header mostra stato real-time:
- `● Ollama attivo / offline`
- `● minicpm-v:latest pronto / non trovato — esegui: ollama pull minicpm-v` (il nome modello arriva dal server)
- Controllo al mount, nessun polling continuo (heartbeat `/api/ping` ogni 10s separato)

---

## Backend — Logica OCR

### Endpoint `/api/ocr`

- Accetta array di immagini base64 **oppure** testo grezzo + `format: 'md' | 'json' | 'contract' | 'alyante'`
- Chiama minicpm-v:latest via Ollama in sequenza per ogni immagine (o una chiamata testo per Word)
- Opzioni Ollama: `temperature: 0`, `num_ctx` 4096 (immagini) / 8192 (testo), `keep_alive: '30m'`
- Timeout per chiamata immagine: 10 minuti; per testo: 5 minuti
- Retry automatico su crash Ollama: attende riavvio (8 tentativi x 5s), poi riprova (max 2 volte)
- Repair automatico: se il JSON risulta malformato, ritenta con un prompt di riparazione dedicato

### Elaborazione Alyante (due fasi)

Per il formato Alyante, il backend esegue due chiamate a Ollama:
1. **Fase 1** — immagine -> Markdown (trascrizione fedele, prompt MD)
2. **Fase 2** — Markdown -> JSON strutturato Alyante (con `format: 'json'` forzato)

Questo migliora l'accuratezza rispetto a un singolo prompt immagine->JSON.
Se il JSON esce con `righe` vuoto (e il testo sorgente supera 300 caratteri), il backend ritenta una volta con un prompt rinforzato che chiede esplicitamente di estrarre l'elenco prezzi. Se anche il parse fallisce, ricade su `{ testo_grezzo: ... }`.

### Post-processing output

**Modalita' MD:**
- Strip code fence ` ```markdown ``` `
- Conversione HTML -> Markdown se il modello restituisce HTML (tabelle `<table>` -> `| col |`, `<br>` -> `\n`, HTML entities decodificate)
- Se il modello restituisce JSON in modalita' MD, viene convertito in Markdown leggibile (schema contratto/DDT/Alyante riconosciuto automaticamente dalla struttura)

**Modalita' JSON / Contratto / Alyante:**
- Strip code fence ` ```json ``` `, estrazione `{...}` dal testo grezzo
- Parse JSON, merge profondo multi-tile (`mergeDeep`): array concatenati, campi mancanti riempiti, oggetti ricorsivi
- Fallback repair: se il parse fallisce -> nuovo prompt di riparazione -> seconda tentativo di parse

### Schema JSON DDT calcestruzzo

```
tipo_documento, numero, data
fornitore: { nome, indirizzo, stabilimento, certificazione }
cliente: { nome, indirizzo, cap_citta, piva }
destinazione, parte_opera, vettore_autista
calcestruzzo: { classe_resistenza, classe_consistenza, classe_esposizione,
                diametro_massimo_mm, tipo_cemento, classe_cemento,
                rapporto_acqua_cemento, contenuto_cloruri, mix_prodotto, additivi }
quantita_m3, condizioni_meteo, note
dati_ciclo: { acqua_kg, aggregati_kg, cemento_kg, additivo_lt, totale_impasto_kg }
orari: { fine_carico, arrivo_cantiere, inizio_scarico, fine_scarico }
tabelle_extra: []
righe_illegibili: [ { posizione, contenuto_parziale } ]
```

### Schema JSON contratto (Primavera P6)

```
numero_contratto, data_contratto, tipo_documento, stato
oggetto, categoria_materiale, descrizione_dettagliata, unita_misura
fornitore: { nome, piva, indirizzo, referente, tel, email }
committente: { nome, piva, indirizzo }
progetto_p6: { codice_progetto, codice_wbs, codice_attivita, conto_costo, cantiere }
importi: { quantita, prezzo_unitario, importo_netto, iva_percent,
           importo_iva, importo_totale, acconto, saldo }
pagamento: { modalita, termini_gg, data_scadenza }
data_inizio, data_fine_consegna, note, condizioni_particolari
righe_illegibili: [ { posizione, contenuto_parziale } ]
```

### Schema JSON Alyante

```
testata: { codice, codice_progetto, elenco_prezzi, divisione, fornitore,
           fornitore_codice, tipologia_contratto, data_contratto,
           cond_pagamento, oggetto, cig, cup,
           documento_codice, documento_data, documento_numero }
righe: [ { progressivo, codice_epu, descrizione, udm, quantita,
            prezzo_lordo, sconto1, sconto2, sconto3, prezzo_netto,
            importo, conto, iva } ]
anagrafiche_articoli: [ { codice_articolo, descrizione, udm, tipo_articolo,
                           descrizione_breve, descrizione_estesa,
                           famiglia, sottofamiglia } ]
importi: { importo_lavori, ritenuta_garanzia_percent, importo_anticipi,
           percent_recupero_anticipazioni, importo_oneri_sicurezza,
           importo_netto }
righe_illegibili: [ { posizione, contenuto_parziale } ]
```

---

## Aspetto — Design System

### Palette colori

| Token | Valore | Uso |
|-------|--------|-----|
| `bg` | `#07070f` | Sfondo globale |
| `panel` | `#0b0b18` | Toolbar, pannelli secondari |
| `header` | `#08081a` | Header, panel label bar |
| `border` | `#243060` | Bordi default |
| `text` | `#e0eeff` | Testo principale |
| `muted` | `#7090c8` | Testo secondario, placeholder |
| `accent` | `#00f0ff` | Cyan neon — azioni primarie, focus |
| `green` | `#00ff88` | Output, stato OK |
| `red` | `#ff2255` | Errori, annulla |
| `yellow` | `#ffe600` | Contratto, PDF->Word, export Excel |

### Tipografia

- Font: `"Courier New", Consolas, "Liberation Mono", monospace` — tutto monospaziato
- Dimensione base: 14px
- Label uppercase con `letter-spacing: 0.08-0.15em`
- Header titolo: 15px, `letter-spacing: 0.15em`, `text-shadow` neon cyan

### Layout

- **Full viewport**: `height: 100vh`, nessun scroll esterno
- **Header**: fascia fissa top, sfondo `#08081a`, bordo bottom cyan semitrasparente
- **Toolbar**: fascia sotto header, sfondo `#0b0b18`, flex wrap con gap 10px
- **Sidebar sinistra**: selezione formato, controlli di scansione, navigatore pagine, range, annulla
- **Main**: flex row, due colonne 50/50 con divisore verticale
  - **Sinistra** — `// INPUT`: preview file originale (PDF iframe, immagine, tabella Excel, HTML Word)
  - **Destra** — `// OUTPUT`: risultato OCR (Markdown render, JSON evidenziato, vista Alyante/Contratto)

### Effetti visivi

- **Scanline overlay**: `body::after` con `repeating-linear-gradient` orizzontale — righe CRT sull'intera pagina
- **Glow neon**: `text-shadow` e `box-shadow` su elementi attivi e label
- **Scrollbar custom**: 4px, thumb `#00f0ff30`, hover `#00f0ff` con glow

### Bottoni

Stile unico parametrizzato `btn(active, color)`:
- Bordo `1px solid`: colore accent se attivo, border muted se inattivo
- Background: `color + '18'` (6% opacita') se attivo, trasparente se inattivo
- `box-shadow`: glow esterno + interno se attivo
- Font: monospace uppercase 11px, `letter-spacing: 0.1em`
- `border-radius: 2` (quasi sharp), transition `all 0.1s`

### Drop zone

- Bordo dashed 2px, `border-radius: 8`
- Hover/drag: bordo diventa `#00f0ff`, background `rgba(88,166,255,0.06)`
- Transition `all 0.15s`

### Barra errore

Fascia rossa tra toolbar e main: `background #ff225512`, bordo bottom rosso, `box-shadow` glow rosso, testo `⚠ messaggio`.

<!-- "><(((º> sabusabu <º)))><" -->

### Progress bar

Linea sottile 2px, larghezza animata `width: X%`, colore accent con `box-shadow` glow, `transition: width 0.3s`.

### Markdown styling (pannello output)

- Heading: uppercase, cyan, `text-shadow` glow, bordo bottom semitrasparente
- Tabelle: bordi `#00f0ff18`, header cyan uppercase, righe pari leggermente tinte
- `strong` -> cyan con glow, `em` -> verde, `a` -> magenta `#ff00ff`
- `code` inline -> sfondo verde 10%, testo `#00ff88`
- `blockquote` -> bordo sinistro rosso, testo muted

### Range inputs (scan range)

- 44px larghezza, monospace, sfondo `#07070f`, bordo `#243060`
- Focus: bordo cyan + glow, frecce native nascoste

---

## Localizzazione

- Interfaccia interamente in **italiano**
- Messaggi di stato, errori, label bottoni tutti in italiano

---

## Dipendenze principali

| Pacchetto | Uso |
|-----------|-----|
| `pdfjs-dist` | Render PDF pagina -> canvas -> JPEG |
| `mammoth` | Estrazione testo/HTML da `.docx` |
| `xlsx` | Lettura e scrittura file Excel |
| `react-markdown` + `remark-gfm` | Render Markdown con tabelle GFM |
| `docx` | Generazione `.docx` da output OCR (import dinamico negli handler — bundle iniziale piu' leggero) |
| `express` | Server backend + proxy Ollama |
| `cors` | CORS per dev mode |
