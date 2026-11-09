<!-- "><(((º> sabusabu <º)))>< -->
# 5. Visualizzatore e annotazioni

[← Indice](README.md)

Ogni documento si apre **in una nuova scheda del browser** (doppio clic sulla riga, oppure **Apri**): puoi tenere
aperte più tavole e tornare alla commessa nella scheda di prima. Chiudendo il visualizzatore (la **X** in alto a
destra) si chiude la scheda.

## 5.1 Il visualizzatore dei PDF

![Visualizzatore](img/05-visualizzatore.png)

Nella barra in alto, da sinistra:

- titolo e identificativo del documento;
- **Revisione**: la revisione aperta, con idoneità e stato; dal menu ne apri un'altra;

  ![Scelta della revisione](img/05-scelta-revisione.png)
- lente **–** / **+** e percentuale di zoom, numero di pagine;
- **Cerca nel testo**;
- **Confronta con** (se il documento ha più revisioni);
- **Visualizzatore del browser**: apre il PDF con il lettore del browser, utile per **stampare** (senza
  annotazioni);
- **Annota** e l'icona del fumetto (pannello delle annotazioni, con il numero di quelle aperte);
- **Filigranato** (arancione) se il Project Admin ha attivato la filigrana: il tuo nome e la data compaiono sulla
  pagina, anche nel file scaricato;
- **Scarica**, **Dettagli e cronologia**, **X** per chiudere.

Se la revisione non è ancora verificata compare «Verifica antivirus in corso: riprova tra poco.»; un file in
quarantena non si apre. I file oltre i 25 MB non hanno l'anteprima: c'è il pulsante **Scarica il file**.

## 5.2 Cercare nel testo

Scrivi almeno due lettere in **Cerca nel testo** e premi Invio: le occorrenze si evidenziano, il contatore mostra
«1/5» e le frecce ↑ ↓ (o Invio / Maiusc+Invio) passano alla successiva o alla precedente. Se il contatore è rosso
con «0» la parola non c'è.

![Ricerca nel testo](img/05-ricerca-nel-testo.png)

Aprendo un documento da un risultato di ricerca o dal modello BIM ([capitolo 12](12-bim-ifc-dwg.md)) la parola
è già cercata.

## 5.3 Annotare

1. Premi **Annota**.
2. Trascina sulla pagina un rettangolo attorno al punto da segnalare (un clic senza trascinare segna un punto).
3. Nel pannello a destra compare «Area a pagina 1»: scrivi l'osservazione in **Scrivi l'osservazione…** e scegli un
   colore.

   ![Area tracciata e osservazione](img/05-annota-area.png)
4. Premi **Aggiungi**.

Senza tracciare nulla l'annotazione è un **Commento generale** sul documento.

![Annotazione salvata](img/05-annotazione-salvata.png)

Ogni annotazione ha un numero (lo stesso sulla pagina e nel pannello), l'autore con l'organizzazione, la data, e
resta legata **a quella revisione**. Un clic sulla card porta al punto della pagina. Gli altri possono rispondere
in **Rispondi…** (**Invia**). L'icona di spunta verde **Risolvi** chiude l'annotazione, **Riapri** la riapre: il
filtro **Aperte / Tutte** in alto mostra solo quelle ancora da gestire.

![Risposta del progettista](img/05-annotazione-risposta.png)

Le annotazioni fatte da un compito di revisione (pulsante **Apri e annota**, [capitolo 6](06-workflow-e-processi.md))
sono collegate al compito.

## 5.4 Confrontare due revisioni

Scegli in **Confronta con** un'altra revisione dello stesso PDF. Le due si sovrappongono con questi colori:

- **rosso**: c'è solo nella revisione aperta (aggiunto);
- **blu**: c'è solo nella revisione di confronto (tolto);
- **nero**: invariato.

![Confronto tra P01 e P01.01](img/05-confronto-revisioni.png)

Nell'esempio il tramezzo della sala riunioni è stato spostato (blu → rosso) ed è nato l'archivio. Per tornare
alla vista normale scegli **Nessun confronto**.

## 5.5 Altri tipi di file

- **Immagini** (PNG, JPG): si vedono e si annotano come i PDF.
- **Excel e CSV**: tabella con i fogli in schede.

  ![Anteprima di un CSV](img/05-anteprima-csv.png)
- **Word**: anteprima del testo.
- **Testo** (TXT): con il permesso di scrittura, sull'ultima revisione, c'è **Modifica**
  ([capitolo 3](03-documenti-e-revisioni.md#310-modificare-in-piattaforma)).

  ![Anteprima di un testo](img/05-anteprima-testo.png)
- **Modelli BIM** (IFC, GLB) e **disegni CAD** (DWG, DXF): [capitolo 12](12-bim-ifc-dwg.md).
- **Documenti firmati digitalmente** (`.p7m`): il PDF contenuto, vedi [5.7](#57-documenti-firmati-digitalmente).
- Formati senza anteprima: «Puoi comunque lasciare commenti generali nel pannello a destra» e **Scarica il file**.

## 5.6 Da tablet in cantiere

Su tablet il visualizzatore occupa tutto lo schermo; il pannello delle annotazioni si apre e chiude con l'icona del
fumetto per lasciare spazio alla tavola. Zoom con le lenti o con due dita.

## 5.7 Documenti firmati digitalmente

Un file firmato con firma digitale (`.pdf.p7m`) si apre come un PDF: SkyTower mostra il **documento contenuto**
nella busta, con zoom, ricerca, annotazioni e confronto. In alto a destra c'è l'esito della verifica della firma:

| Etichetta | Significato |
|---|---|
| **Firma valida** (verde) | Documento integro, certificato qualificato di un ente riconosciuto (elenchi ufficiali europei e di AgID), non revocato e valido alla data della firma |
| **Firma NON valida** (rossa) | Documento modificato dopo la firma, certificato revocato o scaduto senza marca temporale, oppure busta rovinata |
| **Firma da verificare** (gialla) | La firma è integra ma qualcosa non si è potuto controllare: stato di revoca (rete o ente che non risponde), ente non presente negli elenchi, certificato non qualificato |

Cliccando l'etichetta si apre **Firma digitale** con, per ogni firmatario, nome, tipo di firma, codice fiscale,
ente certificatore, scadenza del certificato, data della firma (o della **marca temporale**, se c'è) e i motivi
di un esito non verde. **Verifica di nuovo** rifà il controllo con l'esito di oggi: utile se al caricamento
la revoca non si era potuta controllare.

![Documento firmato nel visualizzatore, con i dettagli della firma](img/05-firma-digitale.png)

Mentre il server apre la busta compare «Il server sta aprendo la busta firmata e verificando la firma»; se la
busta non si apre (file rovinato, componente della firma non installato sul server) il messaggio dice perché e
**Scarica il file firmato** resta disponibile. **Scarica** dà sempre il `.p7m` originale con la firma.

## 5.8 Timbri: firma, logo, «Approvato» sui PDF

Un **timbro** è un'immagine (la tua firma su un foglio bianco, il logo dell'impresa, «Approvato DL») da mettere
sulle pagine di un PDF. Il PDF timbrato diventa una **nuova revisione in WIP** del documento: la revisione da cui
parti resta com'era, e il registro attività dice chi ha timbrato, quando, con quali timbri.

### I timbri della commessa

Scheda **Timbri** della commessa: i timbri divisi in tre gruppi.

| Gruppo | Chi lo crea | Chi lo usa |
|---|---|---|
| **Della commessa** (es. «Approvato DL», «Visto CSE») | il Project Admin | tutti i membri della commessa, di ogni organizzazione |
| **Della mia organizzazione** (logo, timbro dell'impresa) | l'amministratore della tua organizzazione | tutti i tuoi colleghi, in tutte le commesse |
| **Personale** (la tua firma, la tua sigla) | tu | solo tu, in tutte le tue commesse |

![La scheda Timbri della commessa](img/05-timbri-libreria.png)

**Nuovo timbro**:

1. **Scegli l'immagine** (PNG o JPG, fino a 8 MB): una foto dritta o una scansione.
2. Dai un **nome** e scegli il gruppo (quelli che non puoi creare sono spenti).
3. **Scontorna lo sfondo** (acceso di solito) rende trasparente il foglio bianco, come fa *Timbri per VFP*:
   l'anteprima a scacchi a destra mostra come sarà il timbro. Alza la **tolleranza** se restano aloni o la grana
   della carta, abbassala se il timbro perde dettagli (le righe sottili della firma).
4. **Crea il timbro**.

![Nuovo timbro: immagine caricata e anteprima con lo sfondo trasparente](img/05-timbro-nuovo.png)

Un timbro non si cancella: **Disattiva** lo toglie dalla scelta (le revisioni già timbrate restano), **Riattiva** lo
rimette, **Rinomina** ne cambia il nome. Lo può fare solo chi lo ha in carico (te per i tuoi, l'amministratore
dell'organizzazione, il Project Admin). **Mostra i disattivati** li fa vedere tutti.

### Timbrare un PDF

1. Apri il PDF nel visualizzatore e clicca **Timbra** (c'è se puoi caricare revisioni in quella cartella e stai
   guardando l'ultima revisione). A destra si apre **Timbra il documento**.
2. Scegli un timbro nell'elenco e **clicca sulla pagina** dove metterlo. Trascinalo per spostarlo; tira il
   quadratino blu in basso a destra per ingrandirlo o rimpicciolirlo (le proporzioni restano); la **×** lo toglie.
   Puoi mettere più timbri, anche su pagine diverse.
3. **Sotto i nuovi timbri «Timbrato da … il …»**: con la spunta, sotto il timbro compaiono il tuo nome, la data e
   l'ora, scritti dal server al momento del salvataggio.
4. Se vuoi, scrivi una **nota per la revisione** e clicca **Salva come nuova revisione**.

![Timbro messo sulla pagina, pronto da salvare](img/05-timbra-pdf.png)

Il visualizzatore passa da solo alla nuova revisione (es. da P01.01 a **P01.02**, WIP, S0): dopo la verifica
antivirus la vedi con i timbri al loro posto. Da lì si condivide e si pubblica come ogni revisione.

![La nuova revisione timbrata](img/05-timbro-revisione.png)

Casi particolari:

- Si timbra solo l'**ultima** revisione; se nel frattempo un collega ne ha caricata un'altra, il programma lo dice.
- Un documento **in approvazione** (workflow in corso) è bloccato come per il caricamento; se ti chiedono
  modifiche, puoi timbrarlo tu che hai il compito riaperto: la revisione timbrata è quella che il workflow prende.
- Un PDF tavola **pubblicato** si timbra: nasce una WIP da condividere e pubblicare di nuovo.
- I **documenti firmati digitalmente** (`.pdf.p7m`, §5.7) non si timbrano: la firma andrebbe persa. Timbra il PDF
  prima di firmarlo, o caricane una copia non firmata.
- Un PDF con **firma digitale dentro** (PAdES) chiede conferma: la nuova revisione non avrà più una firma valida,
  quella di partenza la conserva.
