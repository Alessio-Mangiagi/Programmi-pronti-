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

### Il giro inverso: documento → modulo

```
Documento in coda ──► menu ⋮ «Converti in modulo contratto» (App.tsx: convertiInModulo)
   risultato IMPORT P6 già in coda? ── sì ──► si usa quello (anche corretto in Modifica)
                                    └─ no ──► voce.testo || ocrFile(f,'md') → POST /api/ocr contratti
                                                       │
                                                       ▼
                 moduloDaRisultato(json) → { testo, avvisi, errori } → <nome>_modulo.txt
```

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

Regole di compilazione emerse (anche in GUIDA_UTILIZZO.md):
- **RG e RI insieme**: `ritenuteRgRi` restituisce i codici scritti se ce n'è almeno uno, e
  non ricava più RG dalla percentuale. Con `CODICE RI: R005` va scritto anche `CODICE RG`.
- **Subaffidamento**: tipologia `Passivo a Misura` non porta a nessuna DIVISIONE in
  `divisioneFromTipo`: scrivere `DIVISIONE: 08`.
- **Prezzi stampati arrotondati**: se `quantità × prezzo` scarta oltre l'1% dall'importo, il
  modulo viene respinto; si scrive il prezzo che dà l'importo (es. 1.947,00 / 6.600 = 0,295)
  e lo si dichiara in commento.

## 4. Limiti e scelte

- **Un modulo = una richiesta.** Il modulo non va stampato e scansionato: come PDF le
  pagine partirebbero una per volta e la seconda non avrebbe la riga di riconoscimento.
  Si carica il file di testo o il Word.
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
