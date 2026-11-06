<!-- "><(((º> sabusabu <º)))>< -->
# 7. Appendice — Per l'amministratore di sistema

[← Indice](README.md)

Note brevi per chi installa e tiene in piedi il Lettore DDT. I dettagli tecnici sono in `README.md`,
`GUIDA_ADMIN.md` e `DEV_GUIDE.md` nella cartella `lettore-ddt`.

## Avvio

- Di norma lo avvia il **Portale** quando un utente clicca la scheda Lettore DDT: non serve avviarlo a mano.
- A mano: `avvia.vbs` (in background) o `avvia.bat` (con finestra dei messaggi). Serve Node.js 20 o più
  recente e una build (`npm run build`).
- Una sola istanza per cartella: se ne parte una seconda si ferma con *"un'altra istanza è già in
  esecuzione"* (file `.istanza.lock`).
- Il gate del Portale è attivo di serie. `COSEDIL_SSO=off` lo spegne: solo per prove, mai in produzione.
- Primo amministratore da riga di comando:
  `node scripts/create-user.js <username> <password> <commessa> "<Nome>" admin` (poi riavviare).
  Ricordarsi di renderlo amministratore del Lettore DDT anche nel Portale.

## Dove stanno i dati

Tutto nella cartella `lettore-ddt`:

| File / cartella | Contenuto |
|---|---|
| `users.enc` | account, cifrati |
| `.users.key` | chiave che decifra `users.enc` e `.apikey.enc` (o variabile `DDT_USERS_KEY`) |
| `.session.key` | segreto delle sessioni (o variabile `SESSION_SECRET`) |
| `.apikey.enc` | chiave API Anthropic salvata dal pannello, cifrata |
| `data/<commessa>/` | estrazioni (`json_exports`), registro consegne per fornitore, paniere, progetto WBS/SAL |
| `data.json`, `activity_log.json` | convalide dei DDT scaricati, log accessi |
| `config.json`, `batch.config.json` | impostazioni; cartelle sorvegliate e opzioni della conversione automatica |
| `error.log`, `combined.log` | registri del programma |
| `users.enc.bak-<data>-<ora>` | copia di `users.enc` fatta prima di una pulizia a mano (06/11/2026: tolti 28 account `test-user-*` lasciati dai test); si cancella quando non serve più |
| `backup/` | backup giornalieri automatici (ultimi 14) |

## Backup

- All'avvio, al massimo una volta al giorno, il programma crea uno zip in `backup/` con `users.enc`,
  `config.json`, `batch.config.json` (senza la chiave API) e l'archivio delle commesse. La cartella si cambia
  con `backupDir` in `config.json` (meglio un disco o una cartella di rete diversi).
- **Dal 4 novembre 2026 le chiavi `.users.key` e `.session.key` NON sono più nel backup.** Vanno copiate a parte,
  a mano, in un posto sicuro e diverso: senza `.users.key` gli account di un backup **non si rileggono più** e
  va reinserita anche la chiave API.
- Per ripristinare: fermare il programma, rimettere `users.enc`, `.users.key` e la cartella `data/`, riavviare.

## Altre cose da sapere

- I PDF caricati con un solo file vanno anche in **SkyTower**, nella commessa indicata dal codice commessa
  aziendale dell'account. `DDT_SKYTOWER=0` spegne l'invio.
- Dopo un aggiornamento il programma va riavviato (dal Portale) perché prenda le modifiche.
- La conversione automatica spende sull'API di Anthropic: tenere la chiave solo nel pannello o in variabile
  d'ambiente, mai in chiaro in `batch.config.json`.

[← Problemi frequenti](06-problemi-frequenti.md) · [Indice](README.md)
