# Guida rapida — Gestione Progetto

Benvenuto! Questa guida ti accompagna nelle operazioni di tutti i giorni. Per i dettagli di ogni funzione vedi il [Manuale completo](MANUALE.md).

---

## 1. Accedere

1. Apri l'app:
   - **Online:** apri nel browser l'indirizzo che ti ha dato l'amministratore.
   - **In locale:** doppio clic su **`avvia.vbs`** (il browser si apre da solo su `http://127.0.0.1:5050`).
2. Inserisci **username** e **password** ricevuti.
3. Clicca **Accedi**.

Sei subito sulla tua **commessa**: vedi e modifichi solo i dati che ti competono.

> ⚠️ Dopo **5 password sbagliate** l'accesso si blocca per **15 minuti**. Se non ricordi la password, chiedi un reset all'amministratore (non a noi via app).

---

## 2. Cambiare la password

Fallo al primo accesso, soprattutto se la password te l'ha data l'amministratore.

1. Clicca **🔑 Password** in alto a destra (oppure ☰ Menu → **Cambia password**).
2. Scrivi la **password attuale**.
3. Scrivi la **nuova password** (almeno **8 caratteri**) e ripetila nella conferma.
4. Clicca **Aggiorna password**.

Fatto: al prossimo accesso userai la nuova password.

> Password dimenticata? Non puoi cambiarla da solo. Contatta l'amministratore: ti imposta una password nuova, poi la cambi tu da qui.

---

## 3. Caricare un documento (DDT / PDF)

1. Vai sulla scheda **📥 Importa**.
2. Clicca il tipo di documento (**DDT Calcestruzzo**, **WBS**, o **Fattura**): il testo (prompt) viene copiato e si apre **Claude.ai**.
3. In Claude.ai: **allega il PDF**, incolla con **Ctrl+V**, attendi la risposta.
4. **Copia** tutta la risposta JSON e tornala a incollare nel riquadro **"Incolla qui la risposta JSON di Claude"**.
5. Clicca **🔍 Anteprima & Scarica Excel** → controlla i dati → scarica il file.

In alternativa puoi **importare un Excel** (formato "Output C.D.") o **caricare un backup JSON** dagli appositi riquadri.

---

## 4. Lavorare sul progetto

- **🏗️ WBS** — sfoglia voci e articoli, cerca, controlla l'avanzamento.
- **📋 SAL** — crea il periodo (mese/anno) e inserisci gli avanzamenti per voce.
- **📊 Dashboard KPI** — vedi a colpo d'occhio ricavi, costi, margini e avanzamento.

> Non vedi le schede WBS/SAL/KPI? Apri **☰ Menu** e attiva il toggle **WBS / SAL / KPI**.

Il lavoro viene **salvato automaticamente** (sul tuo browser e sul server) pochi secondi dopo ogni modifica.

---

## 5. Salvare ed esportare

Quando hai dati, nel riquadro **Salva / Esporta**:

| Pulsante | Cosa ottieni |
|---|---|
| 📊 Esporta Excel | File `.xlsx` con WBS, Articoli, SAL |
| 📄 Esporta CSV | Tabella articoli |
| 🗂️ Backup JSON | Copia completa del progetto |

> 💡 Fai un **Backup JSON** ogni tanto: è la copia permanente più sicura.

---

## 6. Uscire

Clicca **Esci** in alto a destra. Su un PC condiviso, esci sempre a fine lavoro.

---

## 7. Problemi frequenti

| Messaggio / situazione | Cosa fare |
|---|---|
| **"Errore di connessione al server"** | Online: riprova tra poco o avvisa l'amministratore. In locale: controlla che l'app sia avviata (`avvia.vbs`). |
| **"Credenziali non valide"** | Ricontrolla username/password (maiuscole!). Dopo 5 errori attendi 15 minuti. |
| **"Account disabilitato"** | L'amministratore ha sospeso l'accesso: contattalo. |
| **Schede WBS/SAL/KPI assenti** | ☰ Menu → attiva il toggle WBS / SAL / KPI. |
| **Dati spariti** | Se usavi lo stesso account, riapri: si ripristina l'ultimo salvataggio dal server. Usa comunque i Backup JSON. |

---

Assistenza: **alessiomdx1@gmail.com**

*Versione 2.4.0 · Giugno 2026*
