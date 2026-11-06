<!-- "><(((º> sabusabu <º)))>< -->
# 6. Registro accessi e avvisi (amministratori)

[← Le commesse della suite](05-commesse.md) · [Indice](README.md) · [Problemi frequenti →](07-problemi.md)

## 6.1 Il registro accessi

Dalla plancia: **Gestione → Registro accessi** (oppure **Registro accessi** in alto). La
pagina *Chi usa quali applicazioni* elenca tutto quello che succede nel Portale: chi è
entrato, quale programma ha aperto o avviato, chi ha cambiato password o abilitazioni.

![Il registro accessi](img/45-registro-accessi.png)

In alto: **Accessi totali**, **Utenti registrati attivi**, **Accessi oggi** e **Programma
più usato**. Sotto, la tabella con **Data e ora**, **Utente**, **Programma**, **Azione** e
**Dettaglio**, le più recenti in cima. Il dettaglio dice a chi si riferisce l'azione, cosa è
cambiato o da quale computer è arrivata.

Con i tre menu filtri per **utente**, **programma** e **azione** (il menu elenca le azioni
presenti nel registro). Per esempio, scegliendo *Abilitazioni* vedi quale amministratore ha
cambiato i programmi visibili di qualcuno, quando, e nel dettaglio a chi e quali programmi
ha **aggiunto** e **tolto**:

![Il registro filtrato sulle abilitazioni](img/46-registro-abilitazioni.png)

Le azioni che puoi incontrare:

| Azione | Cosa vuol dire |
|---|---|
| *Accesso al Portale*, *Uscita* | Entrata e uscita dal Portale, con il computer da cui è arrivata. |
| *Apertura*, *Avvio*, *Riavvio*, *Arresto*, *Chiusura* | Un programma aperto, acceso, riacceso o spento dal Portale; *Chiusura* è la fine dell'uso, con quanto è durato. |
| *Azione nel programma* | Qualcosa fatto dentro un programma (per esempio un modulo inviato da InCampo), con il dettaglio. |
| *Accesso con la password del Portale* | Accesso a SkyTower, InCampo o VFP Transfer con la password del Portale: nella colonna Programma c'è quale (vedi [1.8](01-entrare.md#18-una-password-per-tutti-i-programmi)). |
| *Accesso bloccato (troppi tentativi)*, *Accesso rifiutato (account disattivato)* | Tentativi fermati dal Portale, con il computer da cui arrivavano. |
| *Richiesta di aiuto*, *Richiesta gestita* | Richiesta mandata dalla pagina di accesso e la sua gestione da parte di un amministratore. |
| *Password reimpostata*, *Disattivazione*, *Riattivazione*, *Cambio email* | Cambi fatti da un amministratore nella pagina Utenti, con l'utente interessato. |
| *Abilitazioni* | Programmi visibili cambiati: nel dettaglio quali sono stati aggiunti e tolti. |
| *Nuovo utente*, *Importazione utenti*, *Utente eliminato* | Utenti creati (uno alla volta o da foglio Excel/CSV) o eliminati nella pagina Utenti: nel dettaglio username, nome, ruolo e programmi; per l'importazione quanti utenti sono entrati e quante righe sono state scartate. Dal 06/11/2026. |
| *Registro commesse* | Modifica o importazione dell'elenco delle commesse. |

Per gli utenti e le password si torna alla pagina **Utenti** con il collegamento in fondo.

Le azioni più vecchie del 06/11/2026 nel dettaglio delle abilitazioni mostrano l'elenco finale dei
programmi invece di *aggiunti* e *tolti*: il registro di allora non lo diceva.

## 6.2 Gli avvisi dei programmi

I programmi della suite segnalano qui i loro problemi: un lavoro automatico fallito,
un'email non partita, scadenze nuove create in automatico, un modello Word cambiato in VFP
Transfer, un programma caduto e riacceso dal Portale, un computer bloccato per troppi
tentativi di accesso.

Ci arrivi da **Avvisi** in alto nella plancia (il numero dice quanti sono da vedere, ed è
rosso se c'è un errore) o da **Gestione → Avvisi**.

![La pagina Avvisi](img/50-avvisi.png)

- In alto: **Da vedere**, **Errori**, **Attenzione**, **Programmi coinvolti**.
- **Da vedere** elenca gli avvisi aperti, prima gli errori (bordo rosso), poi quelli di
  attenzione (giallo), poi le informazioni (azzurro). Se lo stesso problema si ripete, non
  si moltiplica: l'avviso resta uno, con il numero di ripetizioni.
- Puoi filtrare per **programma** e per **gravità**.
- **Segna come visto** sotto un avviso lo sposta in **Già visti**, con il tuo nome e l'ora.
  **Segna tutti come visti** fa lo stesso per tutti quelli elencati (chiede conferma).
- **Già visti** conserva gli ultimi 100.

Un avviso resta aperto finché un amministratore non lo segna come visto: segnarlo non
risolve il problema, dice solo che qualcuno l'ha letto. Se c'è da intervenire su un
programma, apri la guida di quel programma.
