<!-- "><(((º> sabusabu <º)))><" -->
# Banco di prova — Confronto Documenti

16 coppie di documenti sintetici da 3 pagine, 8 modifiche note per coppia (+1 pagina aggiunta in una coppia su 4), seed 2026. Generato da `bench/benchmark.py`.

*Trovate*: modifiche vere segnalate (tra parentesi quante solo come incerte, in grigio). *Finte / pag*: segnalazioni piene che non corrispondono a modifiche vere. *Incerte / pag*: segnalazioni grigie "probabile errore di lettura" (solo in modo tollerante). *Precisione*: quota di segnalazioni piene che sono differenze vere.

| Documenti | DPI | Tollerante | Migliora | Trovate | Finte / pag | Incerte / pag | Precisione |
|---|---|---|---|---|---|---|---|
| nativo | 200 | no | sì | 132/132 (100%) | 0.0 | 0.0 | 100% |
| nativo | 200 | sì | sì | 132/132 (100%) | 0.0 | 0.0 | 100% |
| scansione_buona | 200 | no | sì | 132/132 (100%) | 2.2 | 0.0 | 55% |
| scansione_buona | 200 | sì | sì | 132/132 (100%) | 0.4 | 0.0 | 89% |
| scansione_buona | 300 | sì | sì | 132/132 (100%) | 0.3 | 0.0 | 90% |
| scansione_scarsa | 200 | no | sì | 132/132 (100%) | 13.0 | 0.0 | 17% |
| scansione_scarsa | 200 | sì | sì | 132/132 (100%) | 4.1 | 1.6 | 40% |
| scansione_scarsa | 300 | no | sì | 132/132 (100%) | 12.8 | 0.0 | 18% |
| scansione_scarsa | 300 | sì | sì | 132/132 (100%) | 3.9 | 1.6 | 42% |
| scansione_scarsa | 300 | sì | no | 132/132 (100%) | 5.8 | 0.4 | 32% |

## Per tipo di modifica (trovate / totali)

| Configurazione | codice | data | negazione | numero | pagina_aggiunta | parola | riga_aggiunta | riga_tolta |
|---|---|---|---|---|---|---|---|---|
| nativo 200  | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| nativo 200 tol | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_buona 200  | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_buona 200 tol | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_buona 300 tol | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_scarsa 200  | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_scarsa 200 tol | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_scarsa 300  | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_scarsa 300 tol | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |
| scansione_scarsa 300 tol no-migliora | 5/5 | 4/4 | 5/5 | 16/16 | 4/4 | 9/9 | 50/50 | 39/39 |

## Modifiche critiche perse (esempi)

## Segnalazioni finte (esempi)

**scansione_buona 200 dpi, tollerante no**
- A: `m3 736,00 x 82,59 = 60.786,24` · B: `Mm? 736,00 x 82,59 = 60.786,24`
- A: `m 27,14 x 128,82 = 3.496,17` · B: `Mm 27,14 x 128,82 = 3.496,17`
- A: `m° 64,87 x 171,07 = 11.097,31` · B: `m? 64,87 x 171,07 = 11.097,31`
- A: `m? 584,41 x 102,25 = 59.755,92` · B: `m3 584,41 x 102,25 = 59.755,92`

**scansione_buona 200 dpi, tollerante sì**
- A: `m3 736,00 x 82,59 = 60.786,24` · B: `Mm? 736,00 x 82,59 = 60.786,24`
- A: `m 27,14 x 128,82 = 3.496,17` · B: `Mm 27,14 x 128,82 = 3.496,17`
- A: `Mm? 689,04 x 19,63 = 13.525,86` · B: `m? 689,04 x 19,63 = 13.525,86`
- A: `Le lavorazioni rumorose sono consentite dalle ore 8 alle ore 18 dei giorni feriali. 1` · B: `Le lavorazioni rumorose sono consentite dalle ore 8 alle ore 18 dei giorni feriali. Il`

**scansione_buona 300 dpi, tollerante sì**
- A: `ms 689,04 x 19,63 = 13.525,86` · B: `m3 689,04 x 19,63 = 13.525,86`
- A: `m3 696,84 x 27,74 = 19.330,34` · B: `Mm? 696,84 x 27,74 = 19.330,34`
- A: `Mm 746,36 x 22,75 = 16.979,69` · B: `m 746,36 x 22,75 = 16.979,69`
- A: `m3 786,95 x 94,62 = 74.461,21` · B: `Mm? 786,95 x 94,62 = 74.461,21`

**scansione_scarsa 200 dpi, tollerante no**
- A: `Commessa 2024/75 - toglio 1` · B: `Commessa 2024/75 - foglio 1`
- A: `m? 736,00 x 82,59 = 60.786,24` · B: `m 736,00 x 82,59 = 60.786.24`
- A: `m? 64,87 x 171,07 = 11.097,31 '` · B: `m? 64,87 x 171,07 = 11.097,31`
- A: `C.12.029 Isolamento termico in pannelli EPS 12 cm` · B: `C.12.029 isolamento termico in pannelli EPS 12 cm`

**scansione_scarsa 200 dpi, tollerante sì**
- A: `Mm 486,57 x 53,91 = 26.230,99` · B: `m 486,57 x 53.91 = 26.230,99`
- A: `Mm 27.14 x 128,82 = 3.496,17` · B: `m 27,14 x 128,82 = 3.496,17`
- A: `kg 361.23 x 70,51 = 25.470,33` · B: `kg 361,23 x 70,51 a 25.470.33`
- A: `C€.19.081 Calcestruzzo per strutture in elevazione C30/37` · B: `C.19.081 Calcestruzzo per strutture in elevazione C30/37`

**scansione_scarsa 300 dpi, tollerante no**
- A: `Commessa 2024/75 - toglio 1` · B: `Commessa 2024/75 - foglio 1`
- A: `E.11.027 Calcestruzzo per fondazioni ciasse C25/30` · B: ``
- A: `m? 64,87 x 171,07 = 11.097.31` · B: `m? 64,87 x 171,07 = 11.097,31`
- A: `C.12.029 Isolamento termico in pannelli EPS 12 cm` · B: `C.12.029 isolamento termico in pannelli EPS 12 cm`

**scansione_scarsa 300 dpi, tollerante sì**
- A: `E.11.027 Calcestruzzo per fondazioni ciasse C25/30` · B: ``
- A: `m® 736,00 x 82.59 = 60.786,24` · B: ``
- A: `£.01.017 Tubazione in PVC per scarichi diametro 125` · B: `£.01.017 Tubazione in PVC per scarichi diametro 1 25`
- A: `mm 30,39 x 114,19 = 3.470.23` · B: `m 30,39 x 114,19 = 3.470,23`

**scansione_scarsa 300 dpi, tollerante sì**
- A: `Mm? 360,51 x 64,54 = 23.267,32` · B: `m? 360,51 x 64,54 = 23.267,32`
- A: `B.19.040 Tubazione in PVC per scarichi diametro 125` · B: `B,19.040 Tubazione in PVC per scarichi saline de 125`
- A: `C.14.065 Pavimento in gres porcellanato 30x60` · B: `C.14.065 Pavimento in gres porca 30x60`
- A: `€.17.013 Serramento in alluminio a taglio termico` · B: `C.17.013 Serramento in alluminio a taglio termico`

