# Avvisi per gli amministratori

<!-- "><(((º> sabusabu <º)))><" -->

Ogni programma della suite può segnalare un problema agli admin del Portale. L'avviso
compare nella pagina **Avvisi** del Portale (`/avvisi`) e, appena un admin si collega,
in un riquadro sulla sua plancia. Resta lì finché un admin non lo segna come visto.

## Come viaggia un avviso

L'app scrive un piccolo file JSON nella **cartella di arrivo** del Portale; il Portale lo
raccoglie (al minuto, e a ogni apertura della pagina) in `portale/data/avvisi.json` e
cancella il file.

File e non HTTP di proposito: l'avviso arriva anche se in quel momento il Portale è
spento, non servono token fra le app e non resta aperta nessuna rotta nuova in rete.
La scrittura è atomica (`.tmp` + rename): il Portale non legge mai un file a metà.

Cartella di arrivo: `SUITE_AVVISI_DIR` se impostata, altrimenti `portale/data/avvisi-in`.
Il Portale passa `SUITE_AVVISI_DIR` alle app che avvia, quindi la cartella giusta la
trovano anche se `DATA_DIR` del Portale è stata spostata.

## I file

| File | Per chi |
|---|---|
| `avvisi.js` + `avvisi.d.ts` | app Node CommonJS e TypeScript (Lettore DDT, Verifica Requisiti, Auguri) |
| `avvisi.mjs` + `avvisi.d.mts` | facciata ESM (Analista Dati, OCR, Ponte Trimble) |
| `avvisi.py` | app Python (Scadenzario, Confronto Documenti, InCampo, VFP Transfer) |

## Uso

```js
const { segnala } = require('../../shared/avvisi/avvisi');
segnala({ app: 'ddt', titolo: 'Conversione non riuscita', testo: dettaglio, livello: 'errore', chiave: 'job:42' });
```

```python
import avvisi   # dopo aver messo shared/avvisi nel sys.path
avvisi.segnala("scadenzario", "Email non inviata", dettaglio, livello="errore", chiave="email")
```

- `app`: l'id dell'app nel registro del Portale (`ddt`, `agente`, `confronta`, `ocr`,
  `scadenzario`, `requisiti`, `incampo`, `trimble`, `auguri`; `vfp` per VFP Transfer).
- `livello`: `info`, `attenzione` o `errore`.
- `chiave` (facoltativa): finché è aperto, un avviso con la stessa app e chiave non si
  duplica, conta le ripetizioni. Dopo che un admin l'ha visto, lo stesso problema ne
  apre uno nuovo.

`segnala` non lancia mai eccezioni: un avviso perso non deve far fallire il lavoro.

## Errori dei log, senza toccare il codice delle app

Oltre alle chiamate esplicite, gli errori che le app già loggano arrivano da soli:

| Dove | Come |
|---|---|
| Python `logging` | `avvisi.collega_log("app")` aggancia un handler (ERROR e CRITICAL) |
| winston | opzione `avvisi: 'app'` di `shared/node/logger.js` |
| `console.error` | `intercettaConsole('app')`: scrive come prima e lascia un avviso |

Gli errori dal log sono accorpati per messaggio (numeri e percorsi tolti: "Job 12
fallito" e "Job 13 fallito" sono lo stesso avviso) e frenati a **un file al minuto per
messaggio**: un errore in un ciclo stretto non riempie la cartella. Il contatore nella
pagina conta quindi i file arrivati, non ogni singola riga di log.

## Test

Sotto test (`jest`, `node --test`, `vitest`, `pytest`, `python -m unittest`) i moduli
scrivono **solo** se `SUITE_AVVISI_DIR` è impostata: un test che prova un errore non
finisce nel Portale vero.

```
node --test shared/avvisi
python -m pytest shared/avvisi
```
