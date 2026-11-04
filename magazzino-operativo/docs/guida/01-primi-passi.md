<!-- "><(((º> sabusabu <º)))>< -->
# 1. Primi passi

[← Indice](README.md)

## Come si entra

Il Magazzino non ha un login suo: si apre dal **Portale**, cliccando la sua scheda.
Se non hai fatto l'accesso al Portale vieni rimandato alla pagina di login; se la scheda
del Magazzino non compare, il tuo utente non è abilitato. Per entrambe le cose vedi la
[guida del Portale](../../../portale/docs/guida/README.md).

In alto a destra trovi le tue iniziali e il tuo nome; se compare **· admin** sei
amministratore del Magazzino (vedi sotto).

## Com'è fatta la pagina

![Il Riepilogo](img/riepilogo.png)

- **Barra blu in alto**: nome del programma e il tuo utente.
- **Menu a sinistra**, diviso in tre gruppi:
  - *Operatore, Riepilogo, Scansione, Cerca, Giacenze, Movimenti, Flussi* — il lavoro di ogni giorno;
  - *Anagrafiche*: **Articoli**, **Mezzi**, **Ubicazioni**;
  - *Strumenti*: **Importazioni**, **Etichette** e, solo per gli amministratori, **Amministrazione**.
- **Area centrale**: la vista scelta.

Sul telefono il menu diventa una barra in basso: vedi [Dal telefono](08-telefono.md).

## Il Riepilogo

È la pagina che si apre dal computer.

- **Quattro riquadri**: quanti articoli, mezzi attivi, ubicazioni e movimenti registrati oggi.
- **Dove sta cosa**: per ogni ubicazione quanti articoli e quanti mezzi ci sono. Un clic
  sulla riga apre la scheda dell'ubicazione.
- **Sotto scorta**: gli articoli scesi sotto la *scorta minima* (la soglia si imposta
  nella scheda dell'articolo, vedi [Anagrafiche](04-anagrafiche.md)). Se è vuoto compare
  "Nessun articolo sotto la scorta minima".
- **Ultimi movimenti**: gli ultimi carichi, scarichi e trasferimenti, con l'origine
  (**DDT**, **VFP**, **scansione**, **manuale**) e l'ora dell'ultima importazione automatica.
- Il pulsante **Scansiona** in alto a destra porta alla [scansione](02-scansione.md).

## Chi può fare cosa

| Tutti gli utenti abilitati | Solo gli amministratori del Magazzino |
|---|---|
| Scansionare, consultare giacenze, mezzi, movimenti, grafici | Eliminare articoli, mezzi, ubicazioni, movimenti e foto |
| Registrare carichi, scarichi, trasferimenti, rettifiche, inventari | Vedere la vista **Amministrazione** |
| Creare e modificare articoli, mezzi, ubicazioni | Caricare a mano un file JSON nelle **Importazioni** |
| Spostare i mezzi e cambiarne lo stato, caricare foto | Vedere i percorsi completi delle cartelle di importazione |
| Stampare le etichette, avviare la lettura delle importazioni | |

I pulsanti **Elimina** non compaiono a chi non è amministratore.
