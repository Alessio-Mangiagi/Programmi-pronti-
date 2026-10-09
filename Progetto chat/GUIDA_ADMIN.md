# Guida amministratore — Gestione Progetto

Come gestire gli account e controllare gli accessi. Per la configurazione tecnica/hosting vedi [DEV_GUIDE.md](DEV_GUIDE.md) e [README.md](README.md).

---

## 1. Cos'è un account

Ogni utente accede con **username + password** ed è legato a una **commessa** (`commessaId`). I dati (progetti, versioni, autosave) sono **separati per commessa**: utenti su commesse diverse non vedono i dati altrui.

Esistono due ruoli:
- **Utente** — usa l'app sulla propria commessa.
- **Admin** — usa l'app **e** accede al pannello di amministrazione.

Più utenti possono condividere la stessa commessa (lavorano sugli stessi dati).

---

## 2. Aprire il pannello di amministrazione

1. Accedi all'app con un account **admin**.
2. Vai all'indirizzo **`/admin`** (es. `http://127.0.0.1:5050/admin` in locale, o `https://tuo-dominio/admin` online).

Il pannello ha tre sezioni: **Account**, **Account attivi** e **Log accessi**. Scegli il tab nel menu laterale sinistro.

> Se vedi "Accesso amministratore richiesto", non sei loggato come admin: accedi prima dall'app con un utente admin.

---

## 3. Creare un account

Nella sezione **Account**, compila il modulo in alto:

| Campo | Regole |
|---|---|
| **Username** | Lettere, numeri, `. _ @ -` (max 64). Univoco. |
| **Password** | Minimo **8 caratteri**. |
| **Commessa** | Lettere, numeri, `-`, `_` (max 64). Identifica la cartella dati. |
| **Nome visualizzato** | Nome mostrato in alto nell'app (facoltativo). |
| **Admin** | Spunta solo se l'utente deve gestire gli account. |

Clicca **Crea account**. Comunica all'utente username e password; digli di **cambiarla al primo accesso**.

> Usare **la stessa commessa** per più utenti se devono condividere lo stesso progetto. Usare commesse diverse per tenere i dati separati.

---

## 4. Importare utenti da Excel

Se hai **molti utenti da creare**, usa l'importazione da file Excel o CSV nella sezione **Account**.

1. Clicca **"📥 Template"** per scaricare un file d'esempio (Excel/CSV).
2. Compila il file con una riga per utente, rispettando le colonne:
   - **Username** (obbligatorio)
   - **Password** (obbligatorio, min 8 caratteri)
   - **Commessa** (obbligatorio)
   - **Nome visualizzato** (opzionale)
   - **Admin** (opzionale: digita `sì` o `no`)

3. Clicca **"Seleziona un file"**, scegli il tuo file compilato.
4. Clicca **"Importa utenti"**. Il sistema valida e crea gli account in batch.
5. Leggi il messaggio di risultato: quanti utenti sono stati creati, quali errori sono stati scoperti.

> **Sicurezza**: il file Excel contiene password in chiaro. Cancellalo dopo l'importazione e non inviarlo per email.

Per dettagli completi vedi [GUIDA_IMPORTAZIONE_UTENTI.md](GUIDA_IMPORTAZIONE_UTENTI.md).

---

## 5. Gestire un account esistente

Per ogni riga nella tabella Account hai tre azioni:

| Azione | Effetto |
|---|---|
| **Reset password** | Imposta una nuova password (min 8). Usala quando un utente la dimentica. Comunicagliela e fagliela cambiare. |
| **Disabilita / Abilita** | Sospende o riattiva l'accesso **senza cancellare i dati**. Un utente disabilitato non può accedere ma il suo lavoro resta. |
| **Revoca** | **Elimina** l'account in modo definitivo. I file della commessa restano su disco, ma l'utente sparisce. |

### Stato
La colonna **Stato** mostra **Attivo** o **Disabilitato**.

### Protezioni automatiche
- Non puoi **revocare** o **disabilitare** te stesso.
- Non puoi **revocare/disabilitare l'ultimo amministratore attivo** (per non restare chiusi fuori).

> **Disabilita** è quasi sempre preferibile a **Revoca**: reversibile e non perdi lo storico. Revoca solo quando sei certo.

---

## 6. Monitorare account attivi

Il tab **Account attivi** mostra tutti gli account che hanno effettuato almeno un login riuscito **negli ultimi 30 giorni**.

Questa lista è utile per:
- Capire **quali utenti usano realmente l'app**.
- Identificare account **mai usati** (candidati a revoca).
- Monitorare la salute del sistema (numero utenti attivi).

Funzionalità:
- **Cerca** per username nella barra di ricerca.
- **Salva lista (CSV)** per esportare l'elenco.

---

## 7. Controllare gli accessi (Log)

La sezione **Log accessi** mostra gli ultimi eventi. Clicca **Aggiorna** per ricaricare.

| Evento | Significato |
|---|---|
| Login OK | Accesso riuscito |
| Login fallito | Password errata |
| Login bloccato | Account bloccato per troppi tentativi (15 min) |
| Logout | Uscita |
| Account creato / revocato | Gestione utenti |
| Password cambiata / Password reset | Cambio password (utente / admin) |
| Account disabilitato / abilitato | Sospensione / riattivazione |
| Chiave API aggiornata / rimossa | Gestione della chiave API Anthropic dal pannello |

Per ogni evento vedi data/ora, username, commessa e indirizzo IP.

---

## 8. Brute-force e blocchi

Dopo **5 tentativi di login falliti** lo stesso username viene **bloccato per 15 minuti**. Durante il blocco anche la password corretta viene rifiutata.

Cosa dire all'utente: *"Aspetta 15 minuti e riprova, oppure ti faccio un reset password"*. Un reset non sblocca il timer, ma il blocco scade da solo.

---

## 9. Primo avvio / creare il primo admin

Se non esiste ancora nessun account admin, crealo da riga di comando (serve un build):

```bash
npm run build
node scripts/create-user.js <username> <password> <commessa> "<Nome>" admin
```

Poi accedi all'app con quell'utente e usa il pannello `/admin` per il resto.

> ⚠️ Se crei un utente da riga di comando **mentre il server è già acceso**, non comparirà finché non riavvii il server. Dal pannello `/admin` invece la creazione è immediata.

---

## 9-bis. Chiave API Anthropic (🔑 Chiave API)

La pagina **Conversione automatica** chiama l'API Anthropic e ha bisogno di una chiave (`sk-ant-…`). Solo gli admin possono gestirla, dalla sezione **🔑 Chiave API** del pannello:

- **Salva (cifrata)**: la chiave viene cifrata (AES-256-GCM, stessa chiave di `users.enc`) e salvata nel file **`.apikey.enc`**. Non viene mai rimandata al browser per intero: dopo il salvataggio vedi solo la versione **mascherata** (es. `sk-ant-api••••••••abcd`).
- **Rimuovi chiave salvata**: cancella `.apikey.enc`. La conversione smette di funzionare, a meno che una chiave non arrivi da un'altra origine.
- **Ordine di priorità** quando l'app cerca la chiave: 1) variabile d'ambiente `ANTHROPIC_API_KEY`, 2) chiave salvata dal pannello, 3) campo `apiKey` in chiaro in `batch.config.json` (sconsigliato: usa il pannello).
- Ogni salvataggio o rimozione finisce nel **Log accessi** con chi l'ha fatto e da quale IP.

> ⚠️ `.apikey.enc` si decifra con `.users.key` (o `DDT_USERS_KEY`): se cambi o perdi quella chiave, reinserisci la chiave API dal pannello.

---

## 9-ter. Conversione automatica: chi la vede e con quale motore

**La pagina è riservata agli amministratori.** Gli altri utenti non vedono nemmeno la scheda e continuano a lavorare dalla pagina **Importa**. Per riaprirla a tutti gli utenti loggati, metti `"soloAdmin": false` in `batch.config.json`.

Nella pagina si sceglie il **motore** che fa l'estrazione:

| Motore | Costo | Quando usarlo |
| --- | --- | --- |
| **API Claude** | a pagamento (Batch API = metà prezzo) | il default: capisce il documento, regge scansioni sporche e campi scritti a mano |
| **🦙 Ollama locale** | gratis | non c'è chiave API, i documenti non devono uscire dalla rete, oppure il volume non giustifica la spesa |
| **🖥️ OCR locale** | gratis | solo Registro FIR: regole fisse sui campi del modulo, nessun modello di linguaggio |

**Ollama locale** gira su un server Ollama (di norma sulla stessa macchina): le pagine dei PDF vengono trasformate in immagini e lette una alla volta da un modello vision sulla GPU. Serve:

1. Ollama in esecuzione (l'app, oppure `ollama serve`);
2. il modello scaricato: `ollama pull qwen2.5vl:7b` (~6 GB, sta in 8 GB di VRAM).

Se manca l'uno o l'altro, il pulsante resta spento e il motivo si legge passandoci sopra col mouse. Il modello si cambia con `"ollamaModel": "…"` in `batch.config.json`, e con `OLLAMA_HOST` si punta a un server Ollama su un'altra macchina.

> ⚠️ È più lento (nell'ordine dei minuti per pagina) e meno affidabile di Claude su scansioni sporche o campi manoscritti: l'output va ricontrollato. Occupa la GPU del server per tutta la durata del lavoro — un motivo in più per tenere la pagina riservata agli admin.

Lo stesso motore è disponibile da riga di comando con `npm run batch:ollama` (`-- --help` per le opzioni) e nelle cartelle sorvegliate, con `"ollama": true` nella voce di `batch.config.json`.

---

## 10. Sicurezza dei dati (cosa sapere)

- Le password sono salvate **cifrate** (mai in chiaro). L'archivio utenti è il file **`users.enc`**, cifrato.
- La cifratura usa una **chiave** (`.users.key` o la variabile `DDT_USERS_KEY`). **Se la chiave va persa, gli account non sono più recuperabili.**
- **Fai il backup** di `users.enc` insieme alla chiave, e dei dati in `data/`.
- Online: assicurati che l'app sia servita in **HTTPS** e che siano impostate le variabili `DDT_USERS_KEY` e `SESSION_SECRET` (vedi [README.md](README.md) → Configurazione). Senza, un riavvio del server in cloud può rendere gli account illeggibili.

---

Assistenza: **alessiomdx1@gmail.com**

*Versione 2.4.0 · Giugno 2026*
