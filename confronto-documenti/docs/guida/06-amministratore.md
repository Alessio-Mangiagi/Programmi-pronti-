<!-- "><(((º> sabusabu <º)))>< -->
# 6. Per l'amministratore di sistema

[← Indice](README.md)

Promemoria breve; i dettagli sono in [INSTALLAZIONE.md](../../INSTALLAZIONE.md)
e [USO_SENZA_PORTALE.md](../../USO_SENZA_PORTALE.md).

**Avvio.** Normalmente lo avvia il Portale (scheda *Confronto Documenti*,
`avvia.vbs`). A mano: `Avvia con console.bat` (con il log a video). Requisiti:
Python 3.10+ con il `.venv` creato da `Installa.bat`, Tesseract OCR con la
lingua italiana (o la cartella `Tesseract-OCR` copiata accanto all'app).
PaddleOCR è facoltativo e riusa il venv di OCR Documenti.

**PDF firmati (.p7m).** Li apre e li verifica il motore comune della suite
`shared/firma` (vedi il suo README): ambiente Python proprio `shared/firma/.venv`,
creato da `shared\firma\installa.bat`. `avvia.vbs` e `Avvia con console.bat` lo
lanciano da soli se manca (serve la rete la prima volta, per librerie ed elenchi
ufficiali degli enti certificatori). Senza il motore i soli `.p7m` danno un
messaggio chiaro; tutto il resto funziona. L'exe PyInstaller e l'immagine Docker
non contengono `shared/`: lì i `.p7m` non si aprono.

**Versione autonoma da inviare.** `build-autonomo.bat` produce
`dist\Confronto-Documenti-autonomo.zip`: programma e OCR in una cartella, per
un collega che non ha la suite. Niente login, solo sul suo PC, dati in
`%LOCALAPPDATA%\Confronto Documenti`; i `.p7m` si aprono ma la firma **non**
viene verificata. Dettagli in INSTALLAZIONE.md, «Versione autonoma»; per chi la
riceve c'è il capitolo [Versione autonoma](07-versione-autonoma.md).

**Accesso.** Dietro il Portale l'accesso passa dal login del Portale.
`COSEDIL_SSO=off` lo spegne (solo per uso isolato o sviluppo). Il server di
rete (`installa-server-rete.ps1`) e Docker hanno opzioni proprie (login del
Portale o password).

**Dati.** I file caricati si cancellano a fine confronto. Restano, per 30
giorni (`CONFRONTO_STORICO_GIORNI`), i risultati nella cartella `storico/` e la
cache OCR in `.ocr_cache/`, accanto all'app oppure nella cartella indicata da
`CONFRONTO_DATI`. Ogni confronto ricorda il proprio utente: un utente non apre
né cancella i confronti di un altro.

**Limiti utili.** `CONFRONTO_MAX_PARALLELI` (default 2 confronti insieme),
`CONFRONTO_CODA_MAX_PER_UTENTE` (default 3 in attesa per utente).

**Backup.** Non indispensabile: lo Storico è un archivio temporaneo. Se lo si
vuole conservare, copiare `storico/` a programma fermo.

**Log.** Con il server di rete: `logs\server-rete.log`. Gli errori arrivano
anche nella pagina *Avvisi* del Portale.

[← Se qualcosa non va](05-problemi.md)
