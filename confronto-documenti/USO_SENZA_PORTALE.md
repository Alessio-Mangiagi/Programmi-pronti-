<!-- "><(((º> sabusabu <º)))><" -->
# Confronto Documenti senza il portale

Il portale Suite Cosedil serve all'app solo per il login (gate SSO di
`shared/sso`). Per usarla da sola basta spegnere quel controllo. Per gli altri
modi di installarla (server in ufficio, Docker, cloud) vedi
[INSTALLAZIONE.md](INSTALLAZIONE.md).

## 1. Disattivare il gate SSO

Il gate si regola con variabili d'ambiente:

| Variabile | Valore | Effetto |
|-----------|--------|---------|
| `COSEDIL_SSO` | `off` | Login spento del tutto: l'app risponde senza chiedere niente. Il modulo `shared/sso` non serve più. |
| `COSEDIL_SSO_FAIL` | `open` | Il login resta attivo, ma se il portale è spento le richieste passano. |
| `COSEDIL_SSO_FAIL` | `closed` (default) | Con il portale spento le API rispondono 503. |
| `COSEDIL_PORTAL` | URL (default `http://localhost:8080`) | Indirizzo del portale da interrogare. |

`avvia.vbs` e `Avvia con console.bat` **non** impostano `COSEDIL_SSO`: senza
il portale aggiungi, prima dell'avvio del server:

- `Avvia con console.bat`, prima di `"%PYTHON%" server.py`:

  ```bat
  if not defined COSEDIL_SSO set "COSEDIL_SSO=off"
  ```

- `avvia.vbs`, prima di `shell.Run` del server:

  ```vb
  shell.Environment("PROCESS")("COSEDIL_SSO") = "off"
  ```

Il server di rete (`avvia-server-rete.cmd`) e il container Docker spengono già
il login da soli, salvo scelta diversa.

## 2. File condivisi

| Percorso | Necessario | Note |
|----------|------------|------|
| `../shared/sso/cosedil_sso.py` | Solo con il login attivo | Con `COSEDIL_SSO=off` l'app parte anche senza: la cartella `confronto-documenti` si può copiare da sola. Con il login attivo e il modulo mancante, l'avvio viene annullato. |
| `../shared/avvia/libera-porta.bat` | Consigliato | Chiamato dagli avviatori per liberare la porta 5001; se manca mostrano solo un errore. |
| `../shared/avvisi` | No | Inoltra gli errori del log alla pagina Avvisi del portale. |

## 3. Requisiti

- **Python 3.10+** con il `.venv` creato da `Installa.bat` e i pacchetti di
  `requirements.txt`.
- **Tesseract OCR** installato, oppure la cartella `Tesseract-OCR` copiata
  accanto all'app.
- **Facoltativo:** PaddleOCR tramite il venv della webapp OCR
  (variabile `PADDLE_APP_DIR`).
- **Rete:** per default ascolta su `127.0.0.1:5001` (variabili `HOST` e `PORT`).
