<!-- "><(((º> sabusabu <º)))>< -->
# 6. Per l'amministratore di sistema

[← Indice](README.md)

Dettagli tecnici nel [README](../../README.md).

**Avvio.** Dal Portale (`avvia.vbs`) o `avvia.bat`: compila la pagina se serve
(`dist/`) e avvia il server che la serve. Se non parte, il motivo è in
`avvio.log`. Requisiti: Node.js; Python con il `.venv` e PaddleOCR per le
scansioni (al primo avvio scarica i modelli, ~30 MB); Ollama facoltativo per
l'Assist AI (`ollama pull qwen2.5:3b`).

**PaddleOCR bloccato.** Tipico: Windows App Control (WDAC) rifiuta le librerie
non firmate del venv (`WinError 4551`). Non si risolve reinstallando: serve l'IT.

**Elenchi ufficiali Alyante.** Cartella `Elenchi/`: DITTA, DIVISIONE,
RIPARTIZIONE COMMESSE, Piano dei conti, famiglie e sottofamiglie,
`cond_pagamento.json`. Un file aggiornato viene riletto da solo; in alternativa
si riavvia il programma. Sono dati aziendali: tenerli aggiornati evita le celle rosse.

**Dati.** I lavori in corso stanno in `_lavori/` (o nella cartella `LAVORI_DIR`)
e ripartono dopo un riavvio; la cache della lettura in `.ocr-cache/`
(`OCR_CACHE=0` la spegne). Gli Excel prodotti vanno nella cartella scelta da
ciascun utente nel browser, non sul server.

**Backup.** `Elenchi/` (indispensabile). `_lavori/` e `.ocr-cache/` sono
temporanei.

**Accesso.** Dietro il Portale: in produzione o in rete il gate del Portale è
sempre attivo. Ogni utente vede solo i propri lavori.

[← Se qualcosa non va](05-problemi.md)
