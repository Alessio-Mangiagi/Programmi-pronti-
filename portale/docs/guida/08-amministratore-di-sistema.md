<!-- "><(((º> sabusabu <º)))>< -->
# 8. Appendice per l'amministratore di sistema

[← Problemi frequenti](07-problemi.md) · [Indice](README.md)

Questa parte serve a chi installa e tiene acceso il Portale. I dettagli tecnici completi
sono nel `README.md` della cartella `portale`.

## Avvio e arresto

Nella cartella del Portale:

| File | Cosa fa |
|---|---|
| `avvia.vbs` | Avvia il Portale senza finestre (è quello da mettere in esecuzione automatica). |
| `avvia.bat` | Avvia il Portale con una finestra che mostra i messaggi: utile per capire un problema. |
| `ferma.vbs` | Ferma il Portale. |
| `avvia-admin.vbs` / `avvia-admin.bat` / `ferma-admin.vbs` | Avviano e fermano una seconda copia del Portale dedicata alla plancia degli amministratori. Per farle usare gli stessi utenti del Portale principale va impostata una volta la variabile `PORTALE_DATA_DIR` sulla cartella dati di quest'ultimo. |

Serve Node.js 18 o più recente; il Portale non ha altre dipendenze. Quando il Portale è
spento i programmi della suite restano usabili in autonomia, ma senza accesso unico.

**Primo avvio.** Se non esiste ancora nessun utente, il Portale crea l'amministratore
`admin` e stampa **una sola volta**, nella finestra di `avvia.bat`, una password casuale da
cambiare al primo accesso. Se la si perde e non c'è nessun altro amministratore: fermare il
Portale, mettere da parte `data\utenti.json` e riavviare (viene ricreato il solo `admin`,
con una password nuova; gli altri utenti vanno poi ripresi dal file messo da parte o
reimportati).

**Proprietario della suite.** L'amministratore creato al primo avvio è anche il
**proprietario della suite**: l'unico che crea, cambia ed elimina gli altri amministratori
(capitolo 4.7). In `utenti.json` ha `"proprietario": true`. Su un Portale installato prima
dell'11/11/2026 il campo lo prende da solo, al primo avvio, l'unico amministratore attivo
(con più amministratori il Portale lo scrive nel log e lo si imposta a mano). Per indicarlo,
o per passare la mano, si avvia il Portale con la variabile `PORTALE_PROPRIETARIO=<username>`,
che vale più del file; deve essere un amministratore attivo.

## Dove stanno i dati

Tutto in `data\` dentro la cartella del Portale (o nella cartella indicata da `DATA_DIR`):

| File | Contenuto |
|---|---|
| `utenti.json` | Utenti, ruoli, programmi visibili, email, proprietario della suite. Le password sono salvate cifrate (scrypt), mai in chiaro. |
| `accessi.log` | Registro accessi, una riga per evento (con il dettaglio delle abilitazioni). |
| `richieste.json` | Richieste di aiuto arrivate dal login. |
| `avvisi.json` e cartella `avvisi-in\` | Avvisi dei programmi: i programmi lasciano un file nella cartella, il Portale lo raccoglie. |
| `contatti.json` | `{"emailAdmin": "…"}`: l'indirizzo mostrato in *Scrivi all'amministratore* (riletto senza riavvio). |
| `warm.json` | Programmi da accendere insieme al Portale e tenere sempre accesi. |
| `ip-admin.json` | Postazioni che rendono amministratore chi entra da lì, programma per programma. |
| `.session-secret` | Chiave che firma le sessioni. Se si perde, tutti devono rientrare. |
| `server.log` | Errori del Portale (oltre 5 MB passa a `server.log.1`). |

Fuori dalla cartella del Portale, nella cartella `shared\suite` della suite:

- `commesse.json`: il registro delle commesse della suite (pagina *Commesse*);
- `.token`: la chiave con cui i programmi si parlano fra loro. **Segreta.**

## Backup

Copiare regolarmente:

1. la cartella `data\` del Portale;
2. `shared\suite\commesse.json`.

Il Portale non va fermato per la copia. Per ripristinare: fermare il Portale, rimettere i
file, riavviare.

**Protezione.** `data\` e `shared\suite\.token` contengono informazioni riservate: su un
server condiviso vanno protette con permessi NTFS riservati all'account che fa girare la
suite.

## Rete e sicurezza

- Per far entrare gli altri PC della rete il Portale va avviato con `HOST=0.0.0.0`. Senza
  HTTPS (`TLS_CERT` e `TLS_KEY`, oppure un proxy HTTPS davanti con `COOKIE_SECURE=1`) le
  password viaggiano in chiaro sulla rete: il Portale lo segnala all'avvio.
- Con `SUITE_DOMINIO` impostata i programmi si raggiungono con indirizzi del tipo
  `https://scadenzario.<dominio>`, serviti dal proxy della suite.
- Dal 3–4 novembre 2026 (revisione di sicurezza): l'uscita con *Esci* chiude le sessioni
  dell'utente su tutti i computer; le richieste che arrivano da pagine di altri programmi
  non possono agire sull'area amministratori; presenze e azioni dei programmi vengono
  accettate solo con la chiave della suite (i programmi Node accesi prima vanno riavviati).
