# Banco di prova dell'estrazione contratti

<!-- "><(((º> sabusabu <º)))><" -->

Misura la qualità dell'estrazione sui 31 contratti di `contratti/` **come lavora
l'app** (una richiesta per pagina, `format=contratti`) senza rifare l'OCR a ogni
modifica: l'OCR si paga una volta sola, poi le modifiche ai parser si rigiocano in
un paio di minuti.

```
PDF ──render_ocr.py──► cache/<contratto>/pNNN.txt   (testo OCR, una pagina per file)
                       blocchi/<contratto>__pNNN.json (blocchi con coordinate)
                              │
                              └──run_pipeline.mjs──► JSON per pagina → fusione → metriche
```

## Uso

```bash
# 1) server acceso (usa il venv GPU; OCR_DUMP_DIR salva anche i blocchi)
PORT=3007 OCR_DUMP_DIR="$PWD/tools/harness/blocchi" npx tsx server.ts

# 2) cache dell'OCR — UNA VOLTA SOLA (~30 min su GPU per 811 pagine).
#    È incrementale: le pagine già in cache vengono saltate.
OCR_API=http://127.0.0.1:3007/api/ocr .venv/Scripts/python.exe tools/harness/render_ocr.py [filtro]

# 3) misura (veloce): rigioca il testo in cache attraverso i parser
node tools/harness/run_pipeline.mjs [filtro] --json tools/harness/dopo.json

# 4) confronto fra due misure: mostra solo i contratti che cambiano
node tools/harness/confronta.mjs tools/harness/baseline.json tools/harness/dopo.json
```

`render_ocr.py` replica il rendering del frontend (lato lungo 3300 px, grigi,
contrasto 1.35, luminosità 1.08): il testo in cache è quello che i parser vedono
davvero in esercizio.

## Metriche

| Colonna | Significato | Come si legge |
|---|---|---|
| `righe` | voci estratte dopo la fusione delle pagine | più alto **non** è meglio: contano insieme a `incoer` |
| `dup` | righe identiche rimosse fondendo le pagine | l'elenco prezzi compare spesso due volte |
| `midD` | descrizioni che iniziano a metà frase | la voce è partita nel punto sbagliato |
| `noCod` | righe senza ARTICOLO | alcune sono legittime (voci senza codice) |
| `noUM` | righe senza unità di misura | |
| `noVal` | righe senza quantità o prezzo | |
| `incoer` | righe con importo presente e `qta × prezzo ≠ importo` (>2%) | **l'indicatore più severo**: qui l'errore è dimostrato, non stimato |

`incoer` è l'unica metrica autoverificante: se il documento porta l'importo, il
prodotto deve tornare. Le altre sono indizi, non verdetti — vanno lette insieme
alle righe vere (`--json` salva `righe_dett` per ispezionarle).

## Stato

`baseline.json` = misura prima degli interventi del 13/08/2026; `finale.json` =
dopo. Confronto:

| | righe | dup | midD | noCod | noUM | noVal | **incoer** |
|---|---|---|---|---|---|---|---|
| prima | 1134 | 73 | 220 | 485 | 241 | 62 | **250** |
| dopo | 1117 | 72 | 191 | 427 | 225 | 59 | **19** |

Il testo OCR in cache e i blocchi non sono versionati (si rigenerano dal punto 2).
