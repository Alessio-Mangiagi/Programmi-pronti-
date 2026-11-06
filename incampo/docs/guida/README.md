<!-- "><(((º> sabusabu <º)))>< -->
# InCampo: guida per chi lo usa

InCampo porta il cantiere sullo schermo: le **planimetrie** del cantiere, i **pin**
(i punti segnati sulla pianta), i **moduli** da compilare (ispezioni, punch list,
diario giornaliero, non conformità) e i **task**, cioè le cose da sistemare, con chi
le deve fare e entro quando.

Si usa in due modi:

- **dal browser** (computer, tablet), entrando dal Portale della suite Cosedil;
- **dall'app InCampo** sul telefono (Android o iPhone), che funziona anche senza rete.

Questa guida è per chi usa InCampo ogni giorno: capicantiere, tecnici, impiegati
d'ufficio e amministratori. Le immagini vengono da una copia di prova con dati
inventati (commesse *101-003 Sede Acireale* e *C-2024-015 Scuola Via Roma*).

## Indice

| # | Capitolo | Per chi |
|---|---|---|
| 1 | [Entrare in InCampo](01-accesso.md): dal Portale, login, invito, cambiare la password, la schermata | tutti |
| 2 | [Commesse e cantieri](02-commesse-e-cantieri.md): la pagina Progetti, la barra in alto, le persone del cantiere | tutti; creare: Ufficio |
| 3 | [Planimetrie e pin](03-planimetrie-e-pin.md): muoversi sulla pianta, segnare un punto | tutti |
| 4 | [Compilare un modulo](04-moduli.md): campi, foto, firma, non conformità, PDF | tutti |
| 5 | [Task](05-task.md): creare, assegnare, risolvere, verificare | tutti |
| 6 | [WBS e PCQ](06-wbs-e-pcq.md): voci di lavoro e Piano di Controllo Qualità | tutti; caricare: Ufficio |
| 7 | [Dashboard](07-dashboard.md): i numeri del cantiere | tutti |
| 8 | [Modelli di modulo](08-modelli-di-modulo.md): creare e modificare i moduli | Ufficio, Amministratore |
| 9 | [Inviti](09-inviti.md): far entrare una persona nuova | Ufficio, Amministratore |
| 10 | [Amministrazione](10-amministrazione.md): utenti, etichette, parametri, registro, segnalazioni | Amministratore |
| 11 | [App sul telefono](11-app-mobile.md): lavorare in cantiere, anche offline | tutti |
| 12 | [Problemi e domande frequenti](12-problemi.md): messaggi, cosa fare | tutti |
| A | [Appendice per l'amministratore di sistema](13-amministratore-di-sistema.md): avvio, dati, backup | tecnico informatico |

## I tre ruoli

In InCampo ogni persona ha un ruolo. Il nome che si vede nel programma è quello
in grassetto.

| Ruolo | Chi è di solito | Cosa può fare |
|---|---|---|
| **Cantiere** | capocantiere, operaio, assistente | vede solo i cantieri a cui è iscritto; mette pin, compila moduli, crea e risolve task |
| **Ufficio** | tecnico, direttore lavori, impiegato di commessa | in più: crea commesse e cantieri, carica planimetrie, WBS e PCQ, verifica e chiude i task, modifica i modelli di modulo, manda inviti |
| **Amministratore** | chi gestisce InCampo in azienda | tutto, più la sezione *Amministrazione* (utenti, etichette d'invito, parametri, registro, segnalazioni) e la creazione di nuovi modelli di modulo |

## Parole che ricorrono

- **Commessa**: il lavoro per un cliente, con il suo codice (es. `101-003`). È lo
  stesso codice usato da SkyTower e dal Magazzino.
- **Cantiere** (nella pagina si chiama anche *progetto*): un luogo fisico della commessa,
  con indirizzo. Una commessa può avere più cantieri.
- **Planimetria**: la pianta di un piano o di una zona del cantiere (immagine o PDF).
- **Pin**: un punto segnato sulla planimetria, con il suo nome (es. *Quadro elettrico reception*).
- **Modulo**: una scheda da compilare (ispezione, punch list, diario...). Il *modello*
  è la scheda vuota; il *modulo compilato* è quella riempita.
- **Task**: un'attività da svolgere, con stato (Aperto, Assegnato, Risolto, Verificato),
  assegnatario e scadenza.
- **Non conformità**: un controllo andato male. Quando in un modulo si sceglie
  "Non conforme", InCampo propone subito di aprire un task.
- **WBS**: l'elenco ad albero delle lavorazioni del cantiere (01 Demolizioni, 02 Opere edili...).
- **PCQ**: il Piano di Controllo Qualità del cantiere.
