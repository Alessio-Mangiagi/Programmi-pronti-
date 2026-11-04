<!-- "><(((º> sabusabu <º)))>< -->
# 4. Formati di uscita e modalità Claude

[← Indice](README.md)

## 4.1 I quattro formati

| Formato | Per cosa |
|---|---|
| **IMPORT P6** | contratti → elenco prezzi riga per riga → `Import_Contratti.xlsx`. È quello da usare sui contratti |
| **CONTRATTO** | solo la testata del contratto, una riga per documento |
| **.MD** | trascrizione fedele di qualsiasi documento (DDT, verbali, bolle), tabelle comprese |
| **.JSON** | testo grezzo riga per riga, per altri programmi |

Ogni documento ricorda il formato con cui è stato elaborato: selezionando la sua
riga, la barra torna a quel formato. Se un contratto non ha un elenco prezzi
riconoscibile, il programma ripiega da solo su CONTRATTO (etichetta **solo
testata**). Se hai elaborato in `.MD` per sbaglio non serve rileggere: cambia
formato e usa **↺ Riprocessa**.

## 4.2 Le regole fisse di compilazione

- **EPU = PROGETTO** sempre; DESCR. CONTRATTO = OGGETTO;
- COLL. LINEA TECNICA = 1, CONTRATTO FIRMATO = 1, NODO = 0;
- FORNITORE = partita IVA; DITTA = 2 (COSEDIL S.p.A.);
- RG/RI dalla ritenuta di garanzia: 5% → RG05 + R005, 10% → RG10 + R005;
  forniture senza ritenuta → vuoti;
- COND. PAG. in codice dall'elenco ufficiale (es. bonifico → BB, RiBa → RB);
- DIVISIONE dall'elenco ufficiale (03 subappalto, 02 fornitura…).

## 4.3 Modalità Claude

Per documenti che il motore aziendale non riesce a leggere bene, in alto si
può passare da **OCR** a **CLAUDE**: la lettura la fa Claude sul sito
claude.ai, con l'account dell'utente.

> **Attenzione:** in questa modalità il documento e la richiesta (che
> contiene anche gli elenchi ufficiali: commesse, divisioni, condizioni di
> pagamento) **escono dalla rete aziendale**. Usala solo se l'azienda lo consente.

![La modalità Claude con un contratto in coda](img/08-pagina-claude.png)

Con il formato IMPORT P6:

1. premi **Apri Claude**: si apre claude.ai con la richiesta già scritta
   (**Copia prompt** la copia negli appunti se la finestra non si apre);
2. in Claude **allega il file** indicato e invia;
3. Claude prepara `<nome>_Import_Contratti.xlsx`: **scaricalo** dalla sua finestra;
4. torna qui e premi **Excel scaricato → fatto** per segnare il documento come fatto.

Con gli altri formati, al punto 3 si **copia la risposta** di Claude, la si
incolla nel riquadro del pannello e si preme **Elabora**. **Rifai con Claude**
riparte da capo su un documento già fatto.

[← Controllare e correggere](03-controllo-e-modifica.md) · [Avanti: Se qualcosa non va →](05-problemi.md)
