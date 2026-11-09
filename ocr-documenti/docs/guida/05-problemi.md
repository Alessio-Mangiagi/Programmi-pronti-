<!-- "><(((º> sabusabu <º)))>< -->
# 5. Se qualcosa non va

[← Indice](README.md)

| Cosa succede | Cosa fare |
|---|---|
| **PaddleOCR non trovato** / **PaddleOCR bloccato** in alto | Le scansioni non si possono leggere (PDF con testo, Word ed Excel sì). Il motivo è nel suggerimento dell'indicatore: avvisa l'amministratore. |
| **Server non raggiungibile — riprovo** in alto (vedi [1.1](01-schermata.md#11-la-barra-in-alto)) | Il server sta partendo o è spento. Aspetta qualche secondo: la pagina se ne accorge da sola. Se dopo un minuto è ancora così, riavvia OCR Documenti. Intanto *Scansiona la cartella ora* risponde «non risponde ancora» e non sposta nessun file. |
| **Assist AI spento** | Normale: è facoltativo. |
| *Componente firma digitale non installato* quando aggiungi un `.p7m` | Il motore che apre i file firmati non è installato sul server: avvisa l'amministratore (capitolo 6). Gli altri documenti si leggono. |
| *… busta firmata illeggibile* / *firma staccata* su un `.p7m` | Il file firmato è rovinato o incompleto, oppure la firma è in un file a parte (`.p7s`): chiedi di nuovo il documento firmato. |
| **! Firma da verificare** o **✗ Firma NON valida** sotto un contratto | Il contratto si legge lo stesso; **Dettagli firma** sopra l'anteprima dice il motivo (vedi [2.5](02-contratto-excel.md#25-contratti-firmati-digitalmente-p7m)). |
| Il primo documento ci mette molto | Normale la prima volta dopo l'avvio: il motore si carica. |
| Excel con poche righe o righe mancanti | Elabora in formato **.MD** e guarda in fondo la sezione *TABELLA ARTICOLI (ricostruita dalla scansione)*: se è incompleta, quel modello di contratto non è ancora "tarato" — segnalalo con il PDF. Nel frattempo correggi in **Modifica**. |
| Celle rosse su PROGETTO/EPU | Commessa non nell'elenco ufficiale: correggi il codice o chiedi di aggiornare l'elenco. |
| Riquadro giallo con *somma righe ≠ importo lavori* | Mancano righe o l'importo di testata è diverso: controlla l'originale e correggi in **Modifica**. |
| In **⚙ Impostazioni** i pulsanti *Scegli…* sono spenti | Stai usando Firefox (o Safari): le cartelle del PC si usano solo in **Chrome** o **Edge**. |
| In alto **Cartella · in pausa** | Il browser vuole di nuovo il permesso sulle cartelle: **⚙ Impostazioni → Riattiva**. |
| La scansione automatica non è partita | Parte solo con OCR Documenti aperto in Chrome/Edge. All'arrivo di un file: un file appena copiato aspetta un minuto. Se stavi elaborando altro, parte al giro dopo. |
| Un contratto è finito in **da controllare** | Il programma l'ha respinto: il motivo è in `registro_scansioni.csv` (cartella di destinazione) e nella colonna *Esito*. Correggi e rimetti il file nella cartella dei contratti. |
| *Modulo contratto non valido (N errori)* | Il modulo compilato a mano ha valori fuori formato: ogni errore dice la **riga** del file. Correggi, salva e premi **Scansiona** (vedi [4.4](04-formati-e-claude.md#44-modulo-contratto-i-dati-scritti-a-mano-letti-alla-lettera)). |
| *Il modulo compilato da Claude non è valido (N punti)* nella pagina CLAUDE | Il riquadro rosso dice la riga e il motivo e non è stato salvato niente. Correggi la riga nel riquadro, o chiedi a Claude di correggerla e incolla di nuovo il modulo, poi **Controlla → Excel** (vedi [4.3](04-formati-e-claude.md#43-modalità-claude)). |
| *Nella risposta incollata non c'è il modulo* | Hai incollato solo una parte della risposta: in Claude copia tutto il riquadro di codice che comincia con `MODULO CONTRATTO OCR v1`. Se la risposta si era interrotta, scrivi «continua» e copia anche il seguito. |
| Dopo *Converti in modulo contratto + Excel* il riquadro rosso dice che il modulo va completato, e l'Excel non c'è | Il documento non riportava un dato obbligatorio, o un valore letto era fuori formato: l'Excel non si fa finché il modulo non è valido. Apri `<nome>_modulo.txt`, cerca le righe `# DA VERIFICARE`, compila i campi indicati e rimetti il file in coda: l'Excel esce dal modulo corretto. |
| Un modulo **scansionato** viene respinto con *la riga ha N celle, l'intestazione 6* | L'OCR ha perso un `\|` in una voce che non ha l'importo, quindi il programma non può verificarla. Correggi quella voce nel modulo (o scrivi l'importo) e ristampa, oppure usa il file di testo. |
| Un modulo `.txt` viene mostrato come testo invece di essere elaborato | La prima riga del file deve essere esattamente `MODULO CONTRATTO OCR v1`: parti dal modulo vuoto scaricato. |
| *«Manca l'altro file»* | Hai una bozza Word senza PDF o viceversa: **Aggiungi l'altro file** o **Procedi senza**. |
| La scheda **Originale** è vuota | Il browser non riesce a mostrare il PDF dentro la pagina: usa **⋮ → Apri in un'altra finestra**. |
| Un contratto della coda è in rosso | Leggi il motivo sulla riga; gli altri vanno avanti. Rifallo con **Scansiona**. |
| Risultato vecchio senza tabella articoli | Rileggi il documento (**Rifai da capo**): **Riprocessa** non basta. |
| Gli Excel finiscono nei Download invece che nella cartella scelta | Il browser non permette di scegliere la cartella (solo Chrome/Edge lo fanno). |
| La pagina non risponde | Ricarica; se non basta, riavvia OCR Documenti dal Portale. |

[← Formati e Claude](04-formati-e-claude.md) · [Avanti: Per l'amministratore →](06-amministratore.md)
