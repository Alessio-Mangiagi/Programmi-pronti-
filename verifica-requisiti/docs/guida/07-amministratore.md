<!-- "><(((º> sabusabu <º)))>< -->
# 7. Per l'amministratore di sistema

[← Indice](README.md)

Dettagli tecnici nel [README](../../README.md) del programma.

**Avvio.** Dal Portale (`avvia.vbs`). A mano: `avvia.bat`, oppure
`npm install && npm run build && npm start`. Serve Node.js 20+. Per l'OCR delle
scansioni serve Tesseract e `pdftoppm` (poppler) nel PATH; i PDF con testo non ne hanno bisogno.

**Accesso.** Passa dal login del Portale; il programma è *riservato* (Portale →
Amministrazione → Utenti, colonna *Accessi riservati*). Chi non è abilitato
riceve 403. SkyTower entra con il token di servizio della suite su cinque rotte,
mai come amministratore.

**Impostazioni.** `config.json` nella cartella del programma (motore OCR,
soglia per considerare un PDF una scansione, tetto di documenti, minuti di
inattività prima dello spegnimento automatico).

**Dati.** Tutto in `data/`: `archivio/` (file originali), `documenti.json`
(metadati e testo letto), `requisiti.json` (checklist), `verifiche.json`
(storico esiti). Le sessioni sono in `sessions/`.

**Backup.** Copiare l'intera cartella `data/` a programma fermo (gira una sola
istanza per cartella: un'altra copia avviata sulla stessa cartella rifiuta di partire).

**Log.** `combined.log` ed `error.log` nella cartella del programma; gli errori
arrivano anche nella pagina *Avvisi* del Portale.

[← Se qualcosa non va](06-problemi.md)
