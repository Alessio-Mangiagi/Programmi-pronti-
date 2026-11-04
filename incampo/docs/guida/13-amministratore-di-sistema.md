<!-- "><(((º> sabusabu <º)))>< -->
# Appendice: per l'amministratore di sistema

[Indice](README.md) · Precedente: [Problemi e domande](12-problemi.md)

Poche note per chi installa e custodisce InCampo sul server della suite. I dettagli
tecnici sono in [README-SUITE.md](../../README-SUITE.md) e in
[guida-admin.md](../guida-admin.md).

## Avvio

- Di solito InCampo lo accende il **Portale**. A mano: `incampo\avvia.vbs` (senza
  finestra) o `incampo\avvia.bat` (con la finestra dei messaggi; chiudendola si ferma).
- A ogni avvio: se manca, viene creato il file di configurazione `.env` (database SQLite,
  chiave segreta casuale); poi il database viene aggiornato all'ultima versione; poi parte
  il programma, che serve insieme pagine web e servizi per l'app.
- Prima installazione: `incampo\installa.bat` (oppure l'installazione della suite).
- Primo amministratore (la password, almeno 12 caratteri, viene chiesta a terminale):

  ```bat
  cd incampo
  .venv\Scripts\python.exe -m scripts.create_admin email@cosedilspa.com "Nome Cognome"
  ```

- Gli errori del programma arrivano agli amministratori del Portale nella pagina degli avvisi.

## Dove stanno i dati

Tutto nella cartella `incampo\` del server:

| Cosa | Dove |
|---|---|
| Database (utenti, commesse, cantieri, pin, moduli, task, inviti, registro operazioni) | `fieldview.db` |
| File: planimetrie, foto, firme, allegati | cartella `storage\` |
| Configurazione (chiave segreta, posta, indirizzo pubblico) | `.env` |

Il file `.env` contiene la chiave che firma gli accessi: non va condiviso né messo in
repository. Se la si cambia, tutti devono rifare il login (anche sull'app).

## Backup

In questa installazione (Windows, dentro la suite) **non c'è un backup automatico** di InCampo.

1. Spegni InCampo dal Portale (il database non va copiato mentre il programma scrive).
2. Copia `fieldview.db`, la cartella `storage\` e il file `.env` su un altro disco o sul NAS,
   in una cartella con la data.
3. Riaccendi InCampo dal Portale.

Per ripristinare: spegni InCampo, rimetti i tre elementi al loro posto, riaccendi.
L'installazione con Docker ha invece un servizio di backup notturno (vedi `guida-admin.md`).

## Posta elettronica

Senza le impostazioni `SMTP_...` nel `.env` (come nella configurazione predefinita della
suite) InCampo **non manda email**: notifiche e inviti finiscono solo nel registro del
server. La finestra del link d'invito però scrive comunque *Email inviata*: avvisare chi
manda gli inviti di copiare sempre il link (capitolo 9). Le notifiche sull'app partono
lo stesso, se il server raggiunge internet.

## Accesso dal Portale

- Il riconoscimento avviene per **email**: l'utente InCampo deve avere la stessa email
  dell'utente del Portale. Se non esiste viene creato: amministratore del Portale →
  Amministratore, gli altri → il ruolo di `INCAMPO_RUOLO_PORTALE` nel `.env`
  (predefinito: Ufficio). Gli utenti del Portale senza email diventano
  `nomeutente@cosedilspa.com` (dominio cambiabile con `SUITE_EMAIL_DOMINIO`).
- `COSEDIL_SSO=off` nel `.env` spegne sia il blocco "prima il Portale" sia l'accesso automatico.
- Gli utenti creati dal Portale non hanno una password conosciuta: per l'app serve
  impostarla da *Amministrazione → Utenti → Password*.

## App per telefono

Una sola app vale per qualunque server: l'indirizzo si sceglie nella schermata di login.
I telefoni in cantiere non stanno nella rete aziendale: il server va raggiunto da internet
con un certificato vero (o via VPN). Come si prepara l'app è scritto in `README-SUITE.md`.

## Dati dimostrativi

`incampo\crea-demo.bat` carica le due commesse di esempio (*101-003* e *C-2024-015*) con
utenti `@demo.cosedil.local`. Sul server vero la password degli utenti demo è casuale
e viene stampata una sola volta a fine caricamento: annotarla (rilanciando il file ne
viene messa una nuova). Per togliere solo la demo, lasciando i dati veri:

```bat
incampo\crea-demo.bat --rimuovi
```
