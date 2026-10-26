<!-- "><(((º> sabusabu <º)))><" -->
# Installazione — Confronto Documenti

Tre modi di installarla, dal più semplice al più esteso. Per l'uso quotidiano
vedi [GUIDA_UTILIZZO.md](GUIDA_UTILIZZO.md).

| Modo | Per chi | Login | Documenti |
|------|---------|-------|-----------|
| [1. PC singolo](#1-pc-singolo) | una persona | nessuno o portale | restano sul PC |
| [2. Server in ufficio](#2-server-in-ufficio-rete-interna) | più colleghi in rete | nessuno o portale | restano in azienda |
| [3. Docker / cloud](#3-docker-e-cloud) | accesso da fuori ufficio | password | passano dal server cloud |

---

## 1. PC singolo

1. Installa **Python 3.10+** (spunta *Add Python to PATH*) e **Tesseract OCR**
   con la lingua italiana (`C:\Program Files\Tesseract-OCR`).
2. Doppio clic su **`Installa.bat`**: crea `.venv`, installa le dipendenze e il
   collegamento *Confronto Documenti* sul Desktop.
3. Avvio: collegamento sul Desktop (`avvia.vbs`) oppure
   `Avvia con console.bat` (con il log a video). Si apre `http://localhost:5001`.

Senza il portale Suite Cosedil serve `COSEDIL_SSO=off`: vedi
[USO_SENZA_PORTALE.md](USO_SENZA_PORTALE.md).

**Tesseract portabile** (PC senza Tesseract installato, anche con l'exe):
copia la cartella `Tesseract-OCR` di un'installazione esistente accanto a
`server.py` o all'exe; viene usata per prima.

---

## 2. Server in ufficio (rete interna)

Un PC o server Windows sempre acceso; i colleghi aprono l'indirizzo dal browser.

1. Sul server: passo 1 e 2 del PC singolo (Python, Tesseract, `Installa.bat`).
2. PowerShell **come amministratore**, nella cartella `confronto-documenti`:

   ```powershell
   .\installa-server-rete.ps1                # porta 5001, senza login
   .\installa-server-rete.ps1 -ConLogin      # con il login del portale
   .\installa-server-rete.ps1 -Porta 8085    # altra porta
   ```

   Crea l'attività pianificata *Confronto Documenti (rete)* (parte all'avvio
   di Windows, anche senza nessuno collegato, e si riavvia da sola), apre la
   porta nel firewall solo per le reti di dominio/private, avvia il server e
   stampa gli indirizzi da dare ai colleghi, es. `http://NOMEPC:5001`.
3. Log: `logs\server-rete.log`. Rimozione: `.\installa-server-rete.ps1 -Rimuovi`.

Senza `-ConLogin` chiunque sia nella rete interna può usare l'app. Ognuno vede
nello **Storico** solo i confronti fatti dal proprio browser.

---

## 3. Docker e cloud

Il `Dockerfile` contiene Python, Tesseract (italiano e inglese) e l'app; il
login del portale è spento e l'accesso si protegge con una **password**.

### Con Docker (server Linux o PC con Docker Desktop)

```bash
cd confronto-documenti
CONFRONTO_PASSWORD=una-password-lunga docker compose up -d --build
```

Poi `http://<server>:8080` (utente `cosedil`, la password scelta). I dati
(cache OCR e storico) stanno nel volume `confronto-dati`. Se il server è
raggiungibile da internet, mettilo dietro un proxy HTTPS (Caddy, nginx,
Traefik): con HTTP la password viaggia in chiaro.

### Su un servizio cloud (Render, Railway, Fly.io…)

1. Nuovo servizio *da Dockerfile* collegato al repository, cartella
   **`confronto-documenti`**.
2. Porta **8080** (o la variabile `PORT` che il servizio imposta da solo).
3. Variabili: `CONFRONTO_PASSWORD` (obbligatoria), eventualmente le altre
   della tabella sotto.
4. Un **disco persistente** montato su `/data`, altrimenti storico e cache si
   perdono a ogni riavvio.
5. HTTPS lo danno i servizi stessi. Controllo di salute: `/healthz`.

Risorse consigliate: 2 CPU e 2 GB di RAM per `CONFRONTO_MAX_PARALLELI=2`.
L'OCR delle scansioni usa molta CPU: con piani piccoli i confronti sono lenti.

> **Riservatezza.** Online i contratti e i computi passano da un server
> esterno. Vanno usati solo servizi e regioni approvati dall'azienda (es. data
> center UE) e una password lunga e non riutilizzata.

**Perché non Vercel:** l'app ha bisogno di un processo sempre acceso
(confronti in background, coda, storico su disco) e di Tesseract installato;
le funzioni di Vercel durano il tempo di una richiesta e hanno limiti stretti
su file caricati e durata.

---

## Variabili d'ambiente

| Variabile | Default | A cosa serve |
|-----------|---------|--------------|
| `HOST` | `127.0.0.1` (`0.0.0.0` in rete e Docker) | Indirizzo di ascolto. |
| `PORT` | `5001` (`8080` in Docker) | Porta. |
| `COSEDIL_SSO` | `on` (`off` in Docker e in rete senza login) | Login del portale Suite Cosedil. Con `off` la cartella `shared/` non serve. |
| `CONFRONTO_PASSWORD` | vuota | Se impostata, utente e password su tutte le pagine (HTTP Basic). |
| `CONFRONTO_UTENTE` | `cosedil` | Utente per la password. |
| `CONFRONTO_DATI` | cartella dell'app (`/data` in Docker) | Dove stanno cache OCR (`.ocr_cache`) e storico (`storico`). |
| `CONFRONTO_STORICO_GIORNI` | `30` | Dopo quanti giorni lo storico viene cancellato. |
| `CONFRONTO_MAX_PARALLELI` | `2` | Confronti eseguiti insieme; gli altri aspettano in coda. |

## Dati salvati

- **File caricati:** cancellati a fine confronto.
- **Storico:** testo estratto, differenze, anteprime e revisione di ogni
  confronto, per 30 giorni, in `<CONFRONTO_DATI>/storico`. Si elimina un
  confronto dallo Storico dell'app; per svuotare tutto basta cancellare la
  cartella `storico`.
- **Cache OCR:** testo letto dalle scansioni, per rifare subito i confronti
  già fatti; si pulisce da sola dopo 30 giorni.

Backup: basta copiare la cartella dati (volume `/data` in Docker).
