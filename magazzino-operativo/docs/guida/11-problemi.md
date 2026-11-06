<!-- "><(((º> sabusabu <º)))>< -->
# 11. Se qualcosa non va

[← Indice](README.md)

| Cosa vedi | Cosa vuol dire | Cosa fare |
|---|---|---|
| "Accesso riservato: accedi dal Portale Suite Cosedil" | non hai fatto l'accesso | entra dal Portale ([guida del Portale](../../../portale/docs/guida/README.md)) |
| "Accesso riservato: questa app è abilitata solo ad alcuni utenti…" | il tuo utente non è abilitato al Magazzino | chiedi l'abilitazione a un amministratore del Portale |
| "Portale Suite Cosedil non raggiungibile: impossibile verificare l'accesso…" | il Portale è spento o non risponde | riprova tra poco; se continua avvisa l'amministratore di sistema |
| "Codice … non riconosciuto." | il codice non c'è in anagrafica | controlla il codice; se è nuovo usa **Nuovo articolo con questo codice** / **Nuovo mezzo con questa targa** |
| "La fotocamera funziona solo su https o localhost…" | hai aperto il Magazzino da un indirizzo non sicuro | dal telefono apri il Magazzino dal Portale con l'indirizzo `https://…` |
| "Fotocamera non disponibile: …" | il browser non ha il permesso o un'altra app usa la fotocamera | consenti la fotocamera al sito nelle impostazioni del browser, chiudi le altre app che la usano |
| "Libreria non scaricabile (serve internet)" | la prima apertura della fotocamera scarica il lettore | collegati a internet e riprova; intanto usa **Digita codice** |
| "Giacenza insufficiente in …: disponibili …, richiesti …" | stai togliendo più di quanto risulta | controlla quantità e ubicazione; se il materiale c'è davvero conferma con OK (vedi [Movimenti](03-movimenti.md#scarico-o-trasferimento-oltre-la-giacenza)) |
| "Il trasferimento vuole partenza e arrivo diversi" | stessa ubicazione di partenza e arrivo | scegli due ubicazioni diverse |
| "Latitudine e longitudine vanno insieme" | hai scritto solo una delle due coordinate | scrivile entrambe o lasciale vuote |
| "Indicare una nuova ubicazione, un nuovo stato o chi lo usa" | nello spostamento del mezzo non hai cambiato nulla | cambia almeno un campo |
| "Al massimo 10 foto per volta" / "File troppo grande" | troppe foto o foto troppo pesanti (oltre 15 MB) | caricale in più volte o riduci la foto |
| "Operazione riservata all'amministratore del magazzino" | l'azione è solo per gli amministratori | chiedi a un amministratore |
| "InCampo non risponde …" / "SkyTower non risponde …" nei riquadri del cantiere | l'altro programma è spento | aprilo dal Portale e ricarica la scheda |
| "Esiste già un elemento con lo stesso codice esterno (EAN)…" (o targa, matricola, codice) | quel valore è già usato da un'altra scheda | cerca la scheda esistente con **Cerca**; se è un errore cambia il valore |
| "immagine non leggibile: carica una foto JPG o PNG" | il file scelto non è una foto (o è rovinato) | scegli una foto JPG o PNG |
| In **Importazioni**, "File non completo o non in formato JSON…" o "File non accessibile…" | il file del Lettore DDT o di VFP era ancora in scrittura, aperto o spostato | di solito si risolve da solo al giro dopo; se resta, **Rileggi tutto** e poi avvisa l'amministratore |
| "L'ultimo backup non è riuscito" in Amministrazione | la cartella delle copie non è scrivibile o il disco è pieno | avvisa l'amministratore di sistema ([capitolo 12](12-amministratore-sistema.md#backup)) |
| "Connessione assente: le registrazioni non partono…" | il telefono non ha rete | aspetta la rete e ripeti la registrazione |
| Il lettore USB scrive nel posto sbagliato | il cursore non è nel campo di scansione | apri **Scansione** e clicca in un punto vuoto della pagina: il campo torna a fuoco |
| Una giacenza è sbagliata | manca un movimento o ce n'è uno di troppo | controlla in **Movimenti**; correggi con una **rettifica** o un **inventario** (o fai eliminare il movimento sbagliato da un amministratore) |
| Un DDT non è arrivato nel Magazzino | il DDT non è ancora stato esportato dal Lettore DDT, oppure la lettura è fallita | guarda **Importazioni**: stato dell'export ed **Errori recenti**; prova **Leggi adesso** |
| Le etichette escono senza QR | manca un componente sul server | avvisa l'amministratore di sistema |
