<!-- "><(((º> sabusabu <º)))>< -->
# 12. Per l'amministratore di sistema

[← Indice](README.md)

Appendice breve per chi installa e mantiene il Magazzino. I dettagli tecnici sono nel
[README del programma](../../README.md).

## Avvio

- Prima volta: `installa.bat` nella cartella `magazzino-operativo` (crea l'ambiente
  Python e installa i componenti; serve Python 3.10 o superiore).
- Normalmente il Magazzino lo avvia il **Portale**. A mano: `avvia.bat` (o `avvia.vbs`
  senza finestra); chiudendo la finestra il programma si ferma.
- Senza Portale acceso nessuno entra: il controllo dell'accesso è del Portale.
- Per la fotocamera dei telefoni serve l'indirizzo `https://` della suite (vedi la
  documentazione del Portale sull'accesso in rete).

## Dove stanno i dati

| Cosa | Dove (predefinito) | Variabile per spostarlo |
|---|---|---|
| Database (anagrafiche, movimenti, registro attività) | `magazzino-operativo/magazzino.db` | `MAGAZZINO_DB` |
| Foto dei mezzi | `magazzino-operativo/foto/` | `MAGAZZINO_FOTO_DIR` |
| DDT letti | cartella dati del Lettore DDT (`lettore-ddt/data`) | `MAGAZZINO_DDT_DIR` |
| Pratiche dei mezzi a nolo | cartella pratiche di VFP Transfer | `MAGAZZINO_MEZZI_DIR` |

Altre impostazioni: `MAGAZZINO_IMPORT_SEC` (ogni quanti secondi si rileggono DDT e
pratiche, 0 = solo a mano) e `MAGAZZINO_ADMIN` (username amministratori oltre agli admin
del Portale).

## Backup

Il Magazzino **non fa backup da solo**. Mettete nel backup aziendale almeno
`magazzino.db` e la cartella `foto/`. Per una copia coerente del database fatela a
programma fermo (oppure con lo strumento di backup di SQLite). Il registro attività è
nel database: copiando il database si salva anche quello.

## Ripristino

Fermate il Magazzino, rimettete `magazzino.db` e `foto/` al loro posto e riavviate.
I DDT e le pratiche mezzi già letti non vengono duplicati alla rilettura.
