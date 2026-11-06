<!-- "><(((º> sabusabu <º)))>< -->
# 9. Collegamenti con la suite

[← Indice](README.md)

Il Magazzino parla con gli altri programmi della suite Cosedil attraverso il **codice
commessa** (es. `101-003`). È lo stesso codice che InCampo ha sulla commessa e SkyTower
nella scheda *Suite Cosedil* del progetto, e viene dal registro unico delle commesse che
si cura nel Portale.

Per collegare un cantiere basta scegliere la commessa nell'ubicazione (**Ubicazioni →
Modifica → Commessa**, vedi [Anagrafiche](04-anagrafiche.md#ubicazioni)). Senza commessa
la scheda dell'ubicazione dice "Senza codice commessa l'ubicazione non si collega a
InCampo e SkyTower: aggiungilo in Modifica."

## Nella scheda dell'ubicazione

In fondo alla scheda di un cantiere con commessa ci sono due riquadri (nell'immagine i
due programmi sono spenti, vedi sotto):

![Scheda ubicazione con i riquadri della suite](img/scheda-ubicazione.png)

**InCampo**

- i cantieri InCampo della commessa, con il numero di task e di non conformità aperti;
- l'elenco dei **task aperti** e delle **non conformità** (un clic le apre in InCampo);
- **Segnala in InCampo**: scrivi titolo e descrizione e premi **Apri il task in
  InCampo**. Il task nasce aperto e non assegnato sul cantiere; chi segue il cantiere lo
  prende in carico da lì. Lo stesso tasto c'è nella scheda di un mezzo che si trova in
  un cantiere con commessa, con titolo e descrizione già scritti.

**SkyTower**

- i **documenti pubblicati** della commessa (un clic li apre in SkyTower);
- **Invia report giacenze**: dopo la conferma crea in SkyTower un documento PDF con
  materiale e mezzi della commessa, nella cartella "Suite Cosedil", come bozza (WIP).
  Esito: "Report caricato su SkyTower: …".
- **Apri** porta al progetto in SkyTower.

Se uno dei due programmi è spento o non raggiungibile il riquadro lo dice (per esempio
"InCampo non risponde: probabilmente è spenta. Aprila dal portale e riprova.") e il resto
funziona.
Aprilo dal Portale e ricarica la scheda.

## InCampo legge il Magazzino

Nella dashboard del cantiere, InCampo mostra il materiale e i mezzi presenti nelle
ubicazioni del Magazzino con la stessa commessa.

## "Da fare oggi" nella home del Portale

La home del Portale raccoglie le cose da fare di tutti i programmi. Dal Magazzino arrivano:

- i **mezzi fermi o in manutenzione**, con dove sono e da quando;
- le **importazioni** DDT o mezzi **fallite** negli ultimi 7 giorni;
- solo per gli amministratori, i **cantieri senza codice commessa**.

Un clic sulla voce apre la vista giusta del Magazzino.
