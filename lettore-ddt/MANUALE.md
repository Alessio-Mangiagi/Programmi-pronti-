# Manuale Utente — Gestione Progetto

**Versione 2.4.0 · Giugno 2026**

Manuale completo di tutte le funzionalità. Per una guida rapida all'uso quotidiano vedi [GUIDA_UTENTE.md](GUIDA_UTENTE.md); per la gestione degli account vedi [GUIDA_ADMIN.md](GUIDA_ADMIN.md).

---

## Indice

1. [Avvio e accesso](#1-avvio-e-accesso)
2. [Interfaccia](#2-interfaccia)
3. [Account e password](#3-account-e-password)
4. [Importa — Caricare un progetto](#4-importa)
5. [WBS — Work Breakdown Structure](#5-wbs)
6. [SAL — Stato Avanzamento Lavori](#6-sal)
7. [Dashboard KPI](#7-dashboard-kpi)
8. [Esportazione](#8-esportazione)
9. [Funzionalità avanzate](#9-funzionalità-avanzate)
10. [Risoluzione problemi](#10-risoluzione-problemi)

---

## 1. Avvio e accesso

### Se usi l'app in locale (sul tuo PC)

**Avvio silenzioso (consigliato):** doppio clic su **`avvia.vbs`** → il server parte in background e il browser si apre su `http://127.0.0.1:5050`.

**Avvio con terminale:** doppio clic su **`avvia.bat`** → si apre una finestra con i log; non chiuderla mentre usi l'app.

- Il server prova le porte **5050–5059** in sequenza.
- In locale si **spegne da solo** dopo 15 minuti di inattività.

> **Prerequisito:** Node.js 18+ installato. Se manca, scaricalo da [nodejs.org](https://nodejs.org).

### Se l'app è pubblicata online

Apri l'indirizzo (URL) fornito dall'amministratore nel browser. Non serve installare nulla.

### Login

All'apertura compare la schermata di **accesso**:

1. Inserisci **username** e **password** ricevuti dall'amministratore.
2. Clicca **Accedi**.
3. Vieni indirizzato all'app, già impostata sulla tua **commessa**.

> Dopo **5 tentativi falliti** l'account viene bloccato per **15 minuti** (protezione anti-intrusione). Aspetta o contatta l'amministratore.

> Se vedi *"Account disabilitato"*, l'amministratore ha sospeso il tuo accesso: contattalo.

### Logout

Clicca **Esci** in alto a destra. La sessione viene chiusa.

---

## 2. Interfaccia

### Barra superiore (header)
| Elemento | Funzione |
|---|---|
| ☰ Menu | Apre il menu laterale (navigazione, impostazioni) |
| 🏗️ Gestione Progetto | Nome dell'app |
| Nome · Commessa | Utente connesso e commessa corrente |
| 🔑 Password | Apre la finestra di cambio password |
| ✕ Nuovo | Cancella il progetto corrente (chiede conferma) — visibile solo se ci sono dati |
| Esci | Logout |

### Menu laterale (sidebar)
Apri con **☰ Menu** o avvicinando il mouse al **bordo sinistro**.

| Voce | Funzione |
|---|---|
| 🏠 Home | Torna alla scheda Importa |
| 📖 README | Documentazione tecnica del progetto |
| 🔑 Cambia password | Apre la finestra di cambio password |
| Toggle WBS / SAL / KPI | Mostra/nasconde le schede WBS, SAL e Dashboard KPI |

### Schede principali
| Scheda | Contenuto |
|---|---|
| 📥 Importa | Carica DDT/PDF via Claude AI, Excel, o backup JSON |
| 🏗️ WBS | Struttura gerarchica voci di lavoro |
| 📋 SAL | Inserimento e gestione avanzamenti |
| 📊 Dashboard KPI | Grafici e indicatori di progetto |

---

## 3. Account e password

### A cosa è legato il tuo account
Ogni account è associato a una **commessa**. I dati che vedi e salvi (progetti, versioni, autosave) appartengono alla tua commessa e sono **separati** da quelli degli altri utenti su commesse diverse.

### Cambiare la propria password
1. Clicca **🔑 Password** nell'header (o **Cambia password** nel menu laterale).
2. Inserisci la **password attuale**, poi la **nuova** (minimo 8 caratteri) e la **conferma**.
3. Clicca **Aggiorna password**.

> Se non ricordi la password attuale, non puoi cambiarla da solo: chiedi all'amministratore un **reset**.

### Password dimenticata
Contatta l'amministratore: può impostarti una nuova password dal pannello di amministrazione. Al primo accesso cambiala con una tua.

---

## 4. Importa

### 4.1 Analisi PDF con Claude AI

Il flusso non richiede API key: il prompt viene preparato localmente, Claude.ai si apre automaticamente e il PDF viene allegato manualmente lì.

1. Clicca uno dei 3 bottoni preset per scegliere il tipo di documento:
   - **🏗️ DDT Calcestruzzo** — bolle di consegna calcestruzzo (4 fogli strutturati)
   - **📋 WBS / Piano di Progetto** — computi, preventivi, piani lavori
   - **🧾 Fattura / Documento commerciale** — fatture, ordini, bolle
2. Il prompt viene **copiato negli appunti** e Claude.ai si apre in una nuova finestra.
3. In Claude.ai: **allega il PDF**, incolla il prompt (Ctrl+V), aspetta la risposta JSON.
4. Copia la risposta JSON e incollala nel campo **"Incolla qui la risposta JSON di Claude"**.
5. Clicca **🔍 Anteprima & Scarica Excel** — verifica i dati nell'anteprima e scarica il file XLSX.

> La risposta JSON incollata resta in memoria per **48 ore**. Il JSON sorgente viene salvato automaticamente nella cartella della tua commessa (`data/<commessa>/json_exports/`).

### 4.2 Importa da Excel (formato Output C.D.)

1. Clicca **Scegli file Excel (.xlsx)** o trascina il file nell'area.
2. Seleziona il file con i fogli "Output C.D." e "Quadro di riepilogo".
3. I dati vengono importati automaticamente.

Il parser legge: codici WBS, gruppi, codici articolo, descrizioni, UM, quantità budget, prezzi unitari, ricavi, C.D., MDC1.

### 4.3 Carica backup JSON

1. Clicca **Carica .json**.
2. Seleziona un file esportato in precedenza con "Backup JSON".
3. Il progetto viene ripristinato integralmente.

---

## 5. WBS

La scheda WBS mostra la struttura gerarchica del progetto: **Gruppi WBS → Voci WBS → Articoli**.

### Archivio file recenti
In cima alla scheda appare **📁 Archivio file recenti (48h)** se sono stati generati file nelle ultime 48 ore, raggruppati per tipo (DDT/Documenti Claude, Export WBS, Backup Progetto). Clicca **⬇ Scarica** per ri-scaricare.

### Navigazione
- Clicca una voce WBS per **espanderla/chiuderla** e vedere gli articoli.
- La barra di avanzamento mostra il progresso della voce.
- I valori a destra mostrano: ricavi realizzati / budget totale.

### Ricerca
Digita nel campo **Cerca articolo, WBS…** per filtrare in tempo reale (codice articolo, descrizione, codice WBS). Clicca un risultato per navigare alla voce WBS.

### Dati mostrati per articolo
| Colonna | Contenuto |
|---|---|
| Articolo | Codice articolo |
| Descrizione | Testo descrittivo |
| U.M. | Unità di misura |
| Q.tà Bdg | Quantità a budget |
| P.U. | Prezzo unitario |
| Ricavi | Importo ricavi budget |
| C.D. | Costo diretto budget |
| MDC1% | Margine di contribuzione 1 |
| Avanz. | Barra + percentuale di avanzamento |

---

## 6. SAL

Il SAL (Stato Avanzamento Lavori) documenta quanto è stato realizzato per ogni voce in un periodo (mese/anno).

### 6.1 Creare un SAL
1. Vai alla scheda **📋 SAL**.
2. Nel box **Nuovo SAL**: seleziona mese e anno → clicca **Crea**.

### 6.2 Inserire l'avanzamento
1. Seleziona il SAL dall'elenco (evidenziato in blu).
2. Scegli la **WBS** dal menu a tendina.
3. Per ogni articolo scegli il tipo e inserisci il valore:

| Tipo | Campo | Calcolo |
|---|---|---|
| **Quantità** | Quantità realizzata nel periodo | cumulativa rispetto ai SAL precedenti |
| **% Manuale** | Percentuale totale raggiunta (0–100) | valore assoluto (sovrascrive i precedenti) |

### 6.3 Chiudere un SAL
Clicca **Chiudi SAL** per bloccare il periodo. Con **Riapri** riabiliti le modifiche.

---

## 7. Dashboard KPI

La scheda **📊 Dashboard KPI** offre una visione d'insieme aggiornata in tempo reale.

### KPI Card
| Card | Cosa mostra |
|---|---|
| **Avanzamento Globale %** | % ricavi realizzati sul budget. Verde ≥70%, arancio ≥35%, rosso <35% |
| **Ricavi Realizzati €** | Ricavi maturati vs budget |
| **Costi C.D. €** | Costi diretti realizzati vs budget |
| **MDC1 €** | Margine di contribuzione 1 realizzato e MDC1% |
| **SAL Aperti** | SAL aperti vs totale |
| **Voci WBS** | Numero voci WBS e articoli |

- **Avanzamento per WBS** — lista voci con barra semaforo, percentuale, ricavi, badge stato.
- **Grafico Budget vs Realizzato** — barre orizzontali (prime 8 WBS per importo).
- **Grafico Andamento SAL** — barre per periodo + linea cumulativa.
- **Tabella Riepilogo** — una riga per WBS + riga totali.

---

## 8. Esportazione

Quando il progetto ha dati, appare il box **Salva / Esporta**:

| Bottone | Formato | Contenuto |
|---|---|---|
| 📊 Esporta Excel | `.xlsx` | Fogli: WBS, Articoli, Avanzamenti SAL |
| 📄 Esporta CSV | `.csv` | Articoli con avanzamento (UTF-8 BOM, separatore `;`) |
| 🗂️ Backup JSON | `.json` | Intero progetto (struttura + avanzamenti) |

---

## 9. Funzionalità avanzate

### Scorciatoie tastiera
| Tasto | Azione |
|---|---|
| Ctrl+S | Salva il progetto su localStorage |
| Ctrl+Z | Annulla ultima modifica (undo) |
| Ctrl+Y / Ctrl+Shift+Z | Ripristina modifica annullata (redo) |

Non si attivano se il cursore è in un campo di testo.

### Auto-save
Il progetto viene salvato automaticamente su localStorage **e sul server** (nella tua commessa) circa 1,5 secondi dopo ogni modifica. Se riapri l'app su un altro PC con lo stesso account, l'ultimo lavoro viene ripristinato dal server.

> I dati su localStorage del browser si cancellano dopo **24 ore** di inattività. Per copie permanenti usa **🗂️ Backup JSON**.

### Undo / Redo
Fino a 50 stati in memoria (Ctrl+Z / Ctrl+Y).

### Versioni progetto
Le versioni vengono salvate nella cartella della tua commessa a ogni nuovo import; puoi ripristinarle dalla scheda Importa.

---

## 10. Risoluzione problemi

### "Errore di connessione al server"
Il server non è raggiungibile. In locale: verifica che `avvia.vbs`/`avvia.bat` sia in esecuzione. Online: riprova tra poco o avvisa l'amministratore.

### Non riesco ad accedere (credenziali non valide)
Controlla username/password (occhio a maiuscole). Dopo 5 errori l'account si blocca 15 minuti. Password persa → chiedi un reset all'amministratore.

### "Account disabilitato"
L'amministratore ha sospeso l'accesso. Contattalo per riattivarlo.

### Node.js non trovato (solo locale)
Installa Node.js 18+ da [nodejs.org](https://nodejs.org) assicurandoti che sia nel PATH, poi riavvia.

### Il browser non si apre automaticamente (solo locale)
Apri il browser e vai su `http://127.0.0.1:5050`.

### Le schede WBS / SAL / KPI non sono visibili
Apri il menu laterale (☰ Menu) e attiva il toggle **WBS / SAL / KPI**.

### I grafici KPI non mostrano dati
Importa prima un progetto dalla scheda 📥 Importa; i grafici SAL richiedono almeno un SAL con avanzamenti.

### I dati del progetto sono scomparsi
localStorage si svuota dopo 24 ore di inattività. Se avevi fatto autosave con lo stesso account, riapri: vengono ripristinati dal server. Usa comunque **🗂️ Backup JSON** regolarmente.

---

Per assistenza: **alessiomdx1@gmail.com**

*Versione Manuale: 2.4.0 · Giugno 2026*
