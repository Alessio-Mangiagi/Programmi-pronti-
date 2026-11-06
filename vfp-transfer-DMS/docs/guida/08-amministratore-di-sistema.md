<!-- "><(((º> sabusabu <º)))>< -->
# 8. Appendice — Per l'amministratore di sistema

[← Indice](README.md)

Note brevi. I dettagli tecnici sono in `vfp-transfer/README.md`, `CLAUDE.md` e
`COLLEGAMENTO_CARTELLE_TRIMBLE.md`.

## Avvio

- Serve Python 3.9+ con la libreria `requests` (`pip install -r requirements.txt`).
- Avvio a mano: `avvia_interfaccia.bat` (apre il browser; se il programma è già attivo apre solo la pagina).
- **Sempre attivo**: `installa_avvio_automatico.ps1` crea l'operazione pianificata "Cosedil - Trasferimento VFP"
  (parte all'accesso a Windows, controllo ogni 5 minuti, riavvio dopo un errore). La toglie
  `rimuovi_avvio_automatico.ps1`. Il PC non deve andare in sospensione.
- Primo amministratore, dalla cartella `vfp-transfer`:
  `python auth.py aggiungi nome.cognome --ruolo admin` (la password viene chiesta a video).
- Di serie il programma risponde solo sullo stesso PC; per gli altri PC serve HTTPS con certificato (Impostazioni ›
  Accesso dalla rete). Sul firewall aprire solo la porta del programma e solo verso la rete dell'ufficio.
- Controllo dello stato per un monitoraggio esterno: `/api/salute`, solo dallo stesso PC.

## Dove stanno i dati

Tutto nella cartella `vfp-transfer`:

| File / cartella | Contenuto |
|---|---|
| `.env` | impostazioni (senza password) |
| `cassaforte.dat` | utenti, password e chiavi, cifrati con l'utente Windows che esegue il programma |
| `.vfp_token.json` | accesso a Viewpoint, cifrato |
| `report_trasferimento.csv`, `stato_trasferimento.json` | esito di ogni file e ripresa dei trasferimenti |
| `registro_posta.csv`, `stato_posta.json`, `posta_in_arrivo/` | registro delle email, stato della posta, copia degli allegati |
| `protocolli_manuali.json` | protocolli corretti a mano |
| `moduli_compilati/` | pratiche dei mezzi e anagrafica delle ditte |
| `modelli_compilati/` | pratiche dei modelli Word: copia intatta dell'originale, copia compilata, `record.json` (pagina Modelli Word e contratti dei mezzi) |
| `registro_attivita.jsonl` | registro delle attività utenti |
| `confronti/` | confronti di documenti (30 giorni) |
| `logs/` | registri del programma (`vfp_servizio.log`) |

## Backup

- Salvare regolarmente la cartella del programma (con il programma fermo o almeno senza trasferimenti in corso),
  in particolare i file della tabella sopra.
- **`cassaforte.dat` e `.vfp_token.json` si leggono solo sullo stesso PC e con lo stesso utente Windows.** Su un
  altro PC, o se la password Windows di quell'utente viene *reimpostata* da un amministratore, vanno reinseriti
  utenti e credenziali (`python cassaforte.py imposta CHIAVE`, `python auth.py aggiungi …`).
- La cartella contiene segreti: permessi NTFS solo per l'utente che esegue il programma e per gli amministratori,
  disco cifrato.

## Cambiamenti del 4 novembre 2026 (revisione di sicurezza)

- Con la posta attiva **`MAIL_ALLOWED_SENDERS` è obbligatorio**: vuoto, il controllo posta non parte.
- Allegati **zip, 7z, rar, doc, xls, ppt** (e relativi modelli) non sono più ammessi né per la posta né per i
  documenti dei mezzi.
- I PDF arrivati per posta si scaricano invece di aprirsi nel browser.
- Dopo l'aggiornamento il programma va riavviato.

## Altro

- **Estrazione dal vecchio DMS**: `python estrai_dms.py …` (sola lettura, freno sulle richieste, ripresa); con
  `--tipo skytower` legge le commesse da SkyTower. Produce cartella e `manifest.csv` per la pagina Trasferimento.
- `DMS_TIPO=skytower` nel `.env` fa archiviare i mezzi in SkyTower; `MAIL_SKYTOWER` manda in SkyTower gli allegati
  delle email che citano una commessa nell'oggetto.
- Gli avvisi del programma (errori, modelli Word cambiati) arrivano agli amministratori del Portale, pagina
  Avvisi: vedi la [guida del Portale](../../../portale/docs/guida/README.md).

[← Problemi frequenti](07-problemi-frequenti.md) · [Indice](README.md)
