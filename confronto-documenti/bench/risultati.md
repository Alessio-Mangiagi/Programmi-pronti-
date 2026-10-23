<!-- "><(((º> sabusabu <º)))><" -->
# Banco di prova — Confronto Documenti

16 coppie di documenti sintetici da 3 pagine, 8 modifiche note per coppia (+1 pagina aggiunta in una coppia su 4), seed 2026. Generato da `bench/benchmark.py`.

| Documenti | DPI | Tollerante | Migliora | Trovate | Segnalazioni finte / pag | Pagine identiche segnalate | Precisione |
|---|---|---|---|---|---|---|---|
| nativo | 200 | no | sì | 132/132 (100%) | 0.0 | 0/2 | 100% |
| nativo | 200 | sì | sì | 130/132 (98%) | 0.0 | 0/2 | 100% |
| scansione_buona | 200 | no | sì | 132/132 (100%) | 2.2 | 2/2 | 55% |
| scansione_buona | 200 | sì | sì | 130/132 (98%) | 2.0 | 2/2 | 58% |
| scansione_buona | 300 | sì | sì | 130/132 (98%) | 1.6 | 2/2 | 63% |
| scansione_scarsa | 200 | no | sì | 132/132 (100%) | 13.0 | 2/2 | 17% |
| scansione_scarsa | 200 | sì | sì | 130/132 (98%) | 7.9 | 2/2 | 25% |
| scansione_scarsa | 300 | no | sì | 132/132 (100%) | 12.8 | 2/2 | 18% |
| scansione_scarsa | 300 | sì | sì | 130/132 (98%) | 7.8 | 2/2 | 26% |
| scansione_scarsa | 300 | sì | no | 130/132 (98%) | 8.6 | 2/2 | 24% |

## Per tipo di modifica (trovate / totali)

| Configurazione | codice | data | negazione | numero | pagina_aggiunta | parola | riga_aggiunta | riga_tolta |
|---|---|---|---|---|---|---|---|---|
| nativo 200  | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| nativo 200 tol | 5/5 | 4/4 | 5/5 | 14/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_buona 200  | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_buona 200 tol | 5/5 | 4/4 | 5/5 | 14/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_buona 300 tol | 5/5 | 4/4 | 5/5 | 14/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_scarsa 200  | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_scarsa 200 tol | 5/5 | 4/4 | 5/5 | 14/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_scarsa 300  | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_scarsa 300 tol | 5/5 | 4/4 | 5/5 | 14/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_scarsa 300 tol no-migliora | 5/5 | 4/4 | 5/5 | 14/16 | 4/4 | 9/9 | 50/50 | 39/39 |

## Modifiche critiche perse (esempi)

**nativo 200 dpi, tollerante sì**
- numero: `Importo dei lavori a corpo: euro 385.649,80` → `Importo dei lavori a corpo: euro 385.949,80`
- numero: `m² 364,40 x 123,65 = 45.058,06` → `m² 364,40 x 123,65 = 45.058,09`

**scansione_buona 200 dpi, tollerante sì**
- numero: `Importo dei lavori a corpo: euro 385.649,80` → `Importo dei lavori a corpo: euro 385.949,80`
- numero: `m² 364,40 x 123,65 = 45.058,06` → `m² 364,40 x 123,65 = 45.058,09`

**scansione_buona 300 dpi, tollerante sì**
- numero: `Importo dei lavori a corpo: euro 385.649,80` → `Importo dei lavori a corpo: euro 385.949,80`
- numero: `m² 364,40 x 123,65 = 45.058,06` → `m² 364,40 x 123,65 = 45.058,09`

**scansione_scarsa 200 dpi, tollerante sì**
- numero: `Importo dei lavori a corpo: euro 385.649,80` → `Importo dei lavori a corpo: euro 385.949,80`
- numero: `m² 364,40 x 123,65 = 45.058,06` → `m² 364,40 x 123,65 = 45.058,09`

**scansione_scarsa 300 dpi, tollerante sì**
- numero: `Importo dei lavori a corpo: euro 385.649,80` → `Importo dei lavori a corpo: euro 385.949,80`
- numero: `m² 364,40 x 123,65 = 45.058,06` → `m² 364,40 x 123,65 = 45.058,09`

**scansione_scarsa 300 dpi, tollerante sì**
- numero: `Importo dei lavori a corpo: euro 385.649,80` → `Importo dei lavori a corpo: euro 385.949,80`
- numero: `m² 364,40 x 123,65 = 45.058,06` → `m² 364,40 x 123,65 = 45.058,09`

## Segnalazioni finte (esempi)

**scansione_buona 200 dpi, tollerante no**
- A: `m3 736,00 x 82,59 = 60.786,24` · B: `Mm? 736,00 x 82,59 = 60.786,24`
- A: `m 27,14 x 128,82 = 3.496,17` · B: `Mm 27,14 x 128,82 = 3.496,17`
- A: `m° 64,87 x 171,07 = 11.097,31` · B: `m? 64,87 x 171,07 = 11.097,31`
- A: `m? 584,41 x 102,25 = 59.755,92` · B: `m3 584,41 x 102,25 = 59.755,92`

**scansione_buona 200 dpi, tollerante sì**
- A: `m3 736,00 x 82,59 = 60.786,24` · B: `Mm? 736,00 x 82,59 = 60.786,24`
- A: `m 27,14 x 128,82 = 3.496,17` · B: `Mm 27,14 x 128,82 = 3.496,17`
- A: `m? 584,41 x 102,25 = 59.755,92` · B: `m3 584,41 x 102,25 = 59.755,92`
- A: `m? 735,43 x 84,62 = 62.232,09` · B: ``

**scansione_buona 300 dpi, tollerante sì**
- A: `m3 436,49 x 43,52 = 18.996,04` · B: `m? 436,49 x 43,52 = 18.996,04`
- A: `m3 425,12 x 167,52 = 71.216,10` · B: `m? 425,12 x 167,52 = 71.216,10`
- A: `m3 30,39 x 114,19 = 3.470,23` · B: `m? 30,39 x 114,19 = 3.470,23`
- A: `committente può sospendere i lavori per ragioni di pubblico interesse. Il getto del` · B: `committente può sospendere i lavori per ragioni di pubblico interesse. ll getto del`

**scansione_scarsa 200 dpi, tollerante no**
- A: `Commessa 2024/75 - toglio 1` · B: `Commessa 2024/75 - foglio 1`
- A: `m? 736,00 x 82,59 = 60.786,24` · B: `m 736,00 x 82,59 = 60.786.24`
- A: `m? 64,87 x 171,07 = 11.097,31 '` · B: `m? 64,87 x 171,07 = 11.097,31`
- A: `C.12.029 Isolamento termico in pannelli EPS 12 cm` · B: `C.12.029 isolamento termico in pannelli EPS 12 cm`

**scansione_scarsa 200 dpi, tollerante sì**
- A: `Commessa 2024/75 - toglio 1` · B: `Commessa 2024/75 - foglio 1`
- A: `Mm 486,57 x 53,91 = 26.230,99` · B: `m 486,57 x 53.91 = 26.230,99`
- A: `kg 361.23 x 70,51 = 25.470,33` · B: `kg 361,23 x 70,51 a 25.470.33`
- A: `E.03.063 Rinterro con materiale proveniente dagli scavi` · B: `£.03.063 Rinterro con materiale proveniente dagli scavi`

**scansione_scarsa 300 dpi, tollerante no**
- A: `Commessa 2024/75 - toglio 1` · B: `Commessa 2024/75 - foglio 1`
- A: `E.11.027 Calcestruzzo per fondazioni ciasse C25/30` · B: ``
- A: `m? 64,87 x 171,07 = 11.097.31` · B: `m? 64,87 x 171,07 = 11.097,31`
- A: `C.12.029 Isolamento termico in pannelli EPS 12 cm` · B: `C.12.029 isolamento termico in pannelli EPS 12 cm`

**scansione_scarsa 300 dpi, tollerante sì**
- A: `Commessa 2024/75 - toglio 1` · B: `Commessa 2024/75 - foglio 1`
- A: `E.11.027 Calcestruzzo per fondazioni ciasse C25/30` · B: ``
- A: `E.12.118 Acciaio in barre per armature B450C` · B: `€.12.118 Acciaio in barre per armature B450C`
- A: `C.19.081 Caicestruzzo per strutture in elevazione C30/37` · B: `C.19.081 Calcestruzzo per strutture in elevazione C30/37`

**scansione_scarsa 300 dpi, tollerante sì**
- A: `Mm? 360,51 x 64,54 = 23.267,32` · B: `m? 360,51 x 64,54 = 23.267,32`
- A: `B.19.040 Tubazione in PVC per scarichi diametro 125` · B: `B,19.040 Tubazione in PVC per scarichi saline de 125`
- A: `C.14.065 Pavimento in gres porcellanato 30x60` · B: `C.14.065 Pavimento in gres porca 30x60`
- A: `C.12.029 Isolamento termico in pannelli EPS 12 cm` · B: `©.12.029 Isolamento termico in pannelli EPS 12 cm`

