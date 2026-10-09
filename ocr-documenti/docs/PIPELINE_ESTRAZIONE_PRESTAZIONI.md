# Pipeline di estrazione — PRESTAZIONI in testo libero (incarichi/servizi professionali)

Estrae le **prestazioni** da contratti **senza tabella articoli né codici tariffa** — tipico
degli **affidamenti di incarico professionale / servizi** (progettazione, BIM, direzione,
consulenza) — dove le prestazioni sono un **elenco a lettere** (`a) … b) … c) …`) nel corpo
del testo, e le porta nella maschera `Import_Contratti` con **una riga per prestazione**.

Complementare a [`PIPELINE_ESTRAZIONE_ARTICOLI.md`](PIPELINE_ESTRAZIONE_ARTICOLI.md) (quella
serve i contratti ANAS a codici tariffa/opera; questa i contratti a prestazioni in testo).

Nata sul contratto _MADA Engineering — 2024-095_4.004_ (incarico professionale, subaffidamento
Cosedil → MADA per il 4° Applicativo DG191).

---

## Quando si applica (struttura attesa)

Il documento è un **incarico/servizio professionale** (non lavori a misura né fornitura beni) e:

1. **Non** ha tabella articoli, **non** ha codici tariffa (`X.NN.NNN`), **non** ha prezzi per riga.
2. Le prestazioni sono un **elenco a lettere** introdotto da un'ancora tipo:
   - `… OGGETTO … le prestazioni … saranno le seguenti: a. … b. … c. …`
   - `ELENCO DELLE PRESTAZIONI: a) … b) …`
   - `ART. n — TEMPI DI ESECUZIONE … per le singole attività: a) … b) … c) …`
3. Il compenso è un **forfait** (corrispettivo), non un prezzo per prestazione.

**Guard** (`RE_INCARICO`): la pipeline scatta **solo** se il testo è un incarico/servizio
professionale (`incarico professionale`, `prestazioni professionali`, `professionista`,
`subaffidataria`). Sui contratti a misura/fornitura/subappalto resta **spenta** → non
interferisce (verificato: subappalto e ANAS restano invariati).

---

## Output nella maschera

Una **riga articolo per prestazione**:

| Campo | Valore |
|---|---|
| DES ARTICOLO | testo della prestazione (scadenza "entro N giorni…" rimossa) |
| U.M. | `cad` |
| Cod./Qta/Prezzo/Importo | vuoti (il compenso è forfait, non per riga) |

Il **corrispettivo** del professionista va in **testata/importi** (`importo_netto`), estratto
da `corrispettivo fisso … pari a: € …` (il `:` distingue il risultato dalla base %).

Esempio (MADA, 9 righe dall'elenco "TEMPI DI ESECUZIONE"):

```
1  Studio del progetto esecutivo prodotto dal Committente generale Anas Spa           cad
2  Analisi critica del progetto con individuazione di possibili migliorie …           cad
3  Redazione "as built" con Sistema BIM                                               cad
4  Supporto all'interlocuzione con il Committente Anas Spa                             cad
5  Redazione di perizie di variante e supporto tecnico per la risoluzione delle NC …  cad
6  Supporto alla redazione degli elaborati economici, capitolo economico, CME …       cad
7  Modellazione strutturale                                                           cad
8  Modellazione idraulica                                                             cad
9  Redazione dei progetti di campionamento, indagini strutturali, geologiche …        cad
--
Testata: fornitore MADA ENGINEERING s.r.l. (P.IVA 05069820875) · importo_netto € 1.993,56
```

---

## Come sceglie l'elenco giusto (e scarta gli altri)

Questi contratti abbondano di **altri** elenchi a lettere (oneri "si impegna: a)…",
dichiarazioni, cause di risoluzione). Il parser `estraiRighePrestazioni` (in
[`server.ts`](server.ts)) li distingue con **tre segnali**:

| Segnale | Regola |
|---|---|
| **Voci = NOMI** | le prestazioni iniziano **maiuscole** ("Studio…", "Redazione…"); gli obblighi/dichiarazioni sono verbi all'infinito **minuscoli** ("a osservare…", "di vietare…") → si tiene solo il blocco con ≥70% voci maiuscole |
| **Ancora giusta** | il blocco è introdotto da un'ancora **prestazioni** ("…seguenti:", "elenco prestazioni", "…attività:"), **non** da "si impegna / oneri a carico / dichiara:" (elenchi di obblighi, esclusi) |
| **Sequenza** | vince il blocco con più voci in **sequenza a,b,c,…**: un match isolato ("S.p.A. Confezionato") non forma sequenza e cade |

Robustezza OCR gestita: intestazioni di pagina che spezzano l'elenco (`5 / 15`, `Cod. Ident.
Contratto …`) rimosse; enumeratori storpiati (`b).`, `e)F`, `h)1`, `i}`) riconosciuti; rumore
in testa alla voce ripulito; coda scadenza "…: entro N giorni…" tolta.

---

## Fix testata per questa famiglia (in `server.ts`)

<!-- "><(((º> sabusabu <º)))><" -->

Serviti a far uscire la controparte e il tipo giusti (l'OCR e la prosa ingannavano il parser):

- **Fornitore = il PROFESSIONISTA/SUBAFFIDATARIA**, non l'Affidataria (Cosedil): `RE_RUOLO_ESECUTRICE`
  ora riconosce `SUBAFFIDATARIA`/`PROFESSIONISTA` e il sostantivo intermedio ("denominata **ditta**
  \"SUBAFFIDATARIA\""). `RE_SOCIETA` tollera l'OCR `s.r.I.`/`s.r.|` (la "l" letta "I"). Il nome è
  ripulito dai connettivi in testa ("E La società MADA…" → "MADA…").
- **P.IVA**: tollera l'OCR `partita lVA` (I letta "l").
- **Tipologia**: gli incarichi professionali **non** hanno una tipologia Alyante che calzi (il
  testo cita "subappalto/subaffidataria" e ingannerebbe l'assist) → `tipologiaContratto` **astiene**
  (vuoto) e l'assist LLM viene escluso dal riempirla. Meglio vuota che errata.

> ⚠️ **Da decidere** (dato di business): quale **tipologia/divisione Alyante** assegnare agli
> incarichi professionali. Finché non è deciso resta vuota. Comunicare il valore per fissarlo.

---

## Generalizzazione ad altri file

**Generico (nessuna modifica):** riconoscimento elenco a lettere, distinzione
prestazioni/obblighi, ancore prestazioni, pulizia scadenze e rumore OCR, corrispettivo→importo,
non-interferenza con gli altri tipi di contratto.

**Da adattare se la struttura cambia:**
- Elenco **numerato** (`1) 2) 3)`) invece che a lettere → estendere `RE_EN`/il raggruppamento in run.
- Ancora prestazioni con dicitura diversa → aggiungerla a `RE_ANCORA_PREST`.
- Se il compenso è **per prestazione** (non forfait) → mappare gli importi sulle righe (oggi
  vuoti di proposito).

---

## Limiti noti

- Prende **un** blocco-elenco (il più completo). Se le prestazioni sono spezzate su più elenchi
  non contigui con la stessa numerazione, prende il più lungo (per MADA: "TEMPI DI ESECUZIONE",
  9 voci — superset dell'elenco in OGGETTO).
- `oggetto` di testata può risultare verboso su questi contratti (la voce OGGETTO è discorsiva):
  non pregiudica le righe; da rifinire se serve.
- `importo_lavori` può contenere la **base** di calcolo del compenso (l'importo lavori di
  riferimento), non il valore dell'incarico: quest'ultimo è in `importo_netto` (corrispettivo).

---

## Riferimenti

- Codice: [`server.ts`](server.ts) — `estraiRighePrestazioni`, `RE_INCARICO`,
  `RE_ANCORA_PREST`, `RE_ANCORA_OBBLIGHI`, `pulisciPrestazione`; testata: `RE_SOCIETA`,
  `RE_RUOLO_ESECUTRICE`, `pulisciNome`, `tipologiaContratto`, `estraiImporti` (corrispettivo).
- Fixture di test: elenco "TEMPI DI ESECUZIONE" a)–i) del contratto MADA → 9 righe.
