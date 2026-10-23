<!-- "><(((º> sabusabu <º)))><" -->
# Confronto Documenti senza il portale

Il portale Suite Cosedil serve all'app solo per il login (gate SSO di
`shared/sso`). Per usarla da sola bisogna spegnere quel controllo e tenere
raggiungibili i moduli condivisi che l'app importa all'avvio.

## 1. Disattivare il gate SSO (obbligatorio)

Il gate si regola con variabili d'ambiente lette da `shared/sso/cosedil_sso.py`:

| Variabile | Valore | Effetto |
|-----------|--------|---------|
| `COSEDIL_SSO` | `off` | Login spento del tutto: l'app risponde senza chiedere niente. Per l'uso in locale. |
| `COSEDIL_SSO_FAIL` | `open` | Il login resta attivo, ma se il portale è spento le richieste passano. |
| `COSEDIL_SSO_FAIL` | `closed` (default) | Con il portale spento le API rispondono 503. |
| `COSEDIL_PORTAL` | URL (default `http://localhost:8080`) | Indirizzo del portale da interrogare. |

`avvia.vbs` e `Avvia con console.bat` oggi **non** impostano queste variabili,
quindi senza il portale l'app è bloccata.

Modifica minima per avviarla senza login:

- `Avvia con console.bat`, prima di `"%PYTHON%" server.py`:

  ```bat
  if not defined COSEDIL_SSO set "COSEDIL_SSO=off"
  ```

- `avvia.vbs`, prima di `shell.Run` del server:

  ```vb
  shell.Environment("PROCESS")("COSEDIL_SSO") = "off"
  ```

## 2. File condivisi che devono restare accanto all'app

| Percorso | Necessario | Note |
|----------|------------|------|
| `../shared/sso/cosedil_sso.py` | Sì | Importato anche con `COSEDIL_SSO=off`: se manca, `server.py` esce con `sys.exit(1)`. Nell'exe PyInstaller è già incluso (`pathex` in `ConfrontaPDF.spec`). |
| `../shared/avvia/libera-porta.bat` | Consigliato | Chiamato da entrambi gli avviatori per liberare la porta 5001. Se manca, `avvia.vbs` prosegue e il `.bat` mostra solo un errore. |
| `../shared/avvisi` | No | Inoltra gli errori del log alla pagina Avvisi del portale. Se manca, l'app parte uguale. |

Se si copia solo la cartella `confronto-documenti` fuori dal repo, l'app non
parte: bisogna portare anche `shared/sso` (stessa struttura di cartelle) oppure
usare l'exe.

## 3. Requisiti indipendenti dal portale

- **Python 3.10+** con il `.venv` creato da `Installa.bat` e i pacchetti di
  `requirements.txt` (flask, requests, pymupdf, pillow, numpy, pytesseract,
  python-docx, waitress).
- **Tesseract OCR** installato sul sistema (motore OCR di base).
- **Facoltativi**:
  - Ollama su `http://localhost:11434`.
  - PaddleOCR tramite il venv della webapp OCR (variabile `PADDLE_APP_DIR`).
- **Rete**: per default ascolta su `127.0.0.1:5001`. Si cambia con le variabili
  `HOST` e `PORT`.

## Possibile miglioramento

Rendere facoltativo l'import di `cosedil_sso` quando `COSEDIL_SSO=off`, così
l'app non avrebbe più bisogno di `shared/sso` e si potrebbe copiare da sola.
