<!-- "><(((º> sabusabu <º)))>< -->
# 12. Per l'amministratore di sistema

[← Indice](README.md)

Appendice breve per chi installa e mantiene il Magazzino. I dettagli tecnici sono nel
[README del programma](../../README.md).

## Avvio

- Prima volta: `installa.bat` nella cartella `magazzino-operativo` (crea l'ambiente
  Python e installa i componenti; serve Python 3.10 o superiore).
- Dal 09/11/2026 il Magazzino è una parte del programma unico **"DDT e Magazzino"**: lo
  avvia il **Lettore DDT** quando parte (se `http://127.0.0.1:5200/health` non risponde) e lo
  ferma quando si ferma lui, se l'aveva avviato lui. Gli utenti lo aprono all'indirizzo del
  Lettore DDT sotto `/magazzino/`; la porta 5200 serve al Lettore DDT e alle altre app della
  suite. A mano: `avvia.bat` (o `avvia.vbs` senza finestra); chiudendo la finestra il
  programma si ferma. Il contratto fra le due parti è in `shared/suite/CONTRATTI.md` § 11.
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
pratiche, 0 = solo a mano), `MAGAZZINO_ADMIN` (se impostato, limita a questi username
chi è admin per una regola IP del Portale; gli amministratori del Portale restano sempre admin), `MAGAZZINO_RIEPILOGO_ORA` (ora del riepilogo giornaliero in SkyTower, `19:00`;
`off` = solo a richiesta), `MAGAZZINO_URL_PUBBLICO` (indirizzo del Magazzino nei link verso le
altre app; di solito `<Lettore DDT>/magazzino`) e `MAGAZZINO_PROGRAMMA_UNICO=0` per usare il
Magazzino da solo, senza Lettore DDT, con i link al suo indirizzo.

Il registro dei riepiloghi mandati a SkyTower sta nel database (tabella `riepiloghi`).

## Backup

Dal 06/11/2026 il Magazzino **copia da solo il suo database** una volta al giorno nella
cartella `backup/` accanto a `magazzino.db` e tiene le ultime 14 copie
(`magazzino-AAAAMMGG-HHMMSS.db`). La copia è coerente anche con il programma acceso.
Si può cambiare con tre variabili d'ambiente:

| Variabile | Di solito | A cosa serve |
|---|---|---|
| `MAGAZZINO_BACKUP_DIR` | `backup/` accanto al database | dove mettere le copie: meglio un altro disco o il NAS |
| `MAGAZZINO_BACKUP_ORE` | `24` | ogni quante ore fare una copia (`0` = spento) |
| `MAGAZZINO_BACKUP_TENERE` | `14` | quante copie tenere |

L'ultima copia e il pulsante **Fai un backup adesso** sono in
[Amministrazione](10-amministrazione.md#backup-del-database). Il registro attività è nel
database: copiando il database si salva anche quello. La cartella `foto/` invece non è nel
database: mettetela nel backup aziendale insieme alla cartella delle copie.

## Ripristino

Fermate il Magazzino, rimettete al posto di `magazzino.db` la copia scelta dalla cartella
`backup/` (rinominandola `magazzino.db`; togliete `magazzino.db-wal` e `magazzino.db-shm` se
ci sono), rimettete `foto/` e riavviate.
I DDT e le pratiche mezzi già letti non vengono duplicati alla rilettura.
