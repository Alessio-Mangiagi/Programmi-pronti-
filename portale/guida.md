<!-- "><(((º> sabusabu <º)))><" -->
# Guida al Portale Suite Cosedil

Benvenuto. Questa guida spiega, passo passo, come usare il portale per accedere e avviare i programmi della suite. Non serve alcuna competenza tecnica.

## Che cos'è il portale

Il portale è la **porta d'ingresso unica** a tutti i programmi Cosedil. Con un solo accesso puoi avviare e aprire le applicazioni della suite, senza dover ricordare indirizzi o password diverse per ciascuna.

## 1. Accedere

Apri il portale nel browser (di solito si apre da solo; in alternativa vai all'indirizzo che ti ha indicato l'ufficio, ad esempio `http://localhost:8080`).

Inserisci il tuo **nome utente** e la tua **password**, poi premi **Accedi**.

Se le credenziali non sono corrette compare il messaggio "Credenziali non valide": controlla di aver scritto bene utente e password (occhio a maiuscole e spazi).

## 2. Primo accesso: cambia la password

La prima volta che entri ti viene chiesto di **impostare una password personale**. Scegli una password di **almeno 8 caratteri**, diversa da quella provvisoria, e confermala. Da quel momento userai la nuova password a ogni accesso.

## 3. La schermata principale

Dopo l'accesso vedi le **card** dei programmi disponibili. Ogni card mostra il nome dell'app, una breve descrizione e il suo **stato**:

- **Attivo** (verde) — il programma è acceso e pronto all'uso.
- **Spento** (grigio) — il programma non è in esecuzione.
- **Verifica…** — il portale sta controllando lo stato.

Lo stato si aggiorna da solo ogni pochi secondi.

Non tutti vedono le stesse card: alcuni programmi sono **riservati** a chi lavora su quei documenti. Se un collega ne vede uno che tu non hai, non è un guasto — chiedi l'abilitazione a un amministratore del portale.

## 4. Avviare un programma

Se un programma è **Spento**, premi il pulsante **Avvia** sulla sua card.

Il portale accende il programma e, **appena è pronto, lo apre da solo** in una nuova scheda del browser. I programmi più pesanti (come l'OCR) possono impiegare qualche secondo la prima volta: è normale, attendi senza chiudere la scheda.

## 5. Aprire un programma già attivo

Se un programma è già **Attivo**, premi **Apri** per aprirlo subito in una nuova scheda.

## 6. Chiedere all'assistente

Non sai quale programma ti serve? In basso a destra c'è una **bolla azzurra**: premila e chiedi in italiano, per esempio *"quale app per i PDF scansionati?"* oppure *"cosa fa l'analista dati?"*.

L'assistente ti risponde e ti mette lì i pulsanti **Avvia** e **Apri** dell'app giusta. Sa parlare **solo delle app della suite e di cosa fanno**: su altri argomenti ti dirà che non sa rispondere. Non serve internet.

Indirizzi e porte non te li dice, ed è voluto: i programmi si aprono dai pulsanti delle card, non scrivendo indirizzi a mano.

## 7. Cambiare la password

In alto a destra trovi il pulsante **Password**: da lì puoi cambiare la tua password quando vuoi. Serve la password attuale e la nuova (almeno 8 caratteri).

## 8. Uscire

Premi **Esci** in alto a destra per chiudere la tua sessione. È buona norma farlo se usi un computer condiviso.

## Per gli amministratori

Se il tuo account è amministratore (o accedi da una postazione abilitata), in alto compare il pulsante **Amministrazione**. Da lì puoi:

- **Gestire gli utenti** — aggiungere o rimuovere persone, anche importandole in blocco da un file Excel o CSV.
- **Consultare gli accessi** — vedere chi ha aperto o avviato quale programma, con data e ora.

I nuovi utenti ricevono una password provvisoria e la cambiano al primo accesso.

Sulle card dei programmi accesi vedi anche un pulsante quadrato **Ferma**: spegne il programma e libera memoria sul server. Chiede conferma, perché **chi lo sta usando in quel momento perde il lavoro non salvato**: usalo a fine giornata o su programmi che nessuno sta usando.

## Problemi frequenti

- **"Apri" resta grigio** — il programma non è ancora pronto: attendi qualche secondo, lo stato passerà ad **Attivo**.
- **Il programma ci mette molto ad avviarsi** — la prima accensione carica componenti pesanti; le volte successive è più rapido. Se l'ufficio ha attivato l'avvio automatico, i programmi principali sono già pronti.
- **"Credenziali non valide"** — ricontrolla utente e password. Ricorda che il nome utente non distingue maiuscole e minuscole, la password sì.
- **"Troppi tentativi falliti"** — dopo 5 password sbagliate il portale ti fa aspettare 15 minuti da quel computer. È una difesa contro chi prova password a tentativi. Se la password non la ricordi, non insistere: chiedi a un amministratore di reimpostarla.
- **Password dimenticata** — non è recuperabile da soli: chiedi a un amministratore di reimpostartela.
- **Sono stato disconnesso** — dopo alcune ore di inattività la sessione scade per sicurezza: basta rifare l'accesso.

---

_Per gli aspetti tecnici (installazione, configurazione, rete) consulta il `README.md`._
