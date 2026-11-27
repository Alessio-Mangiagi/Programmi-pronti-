<!-- "><(((º> sabusabu <º)))><" -->
# Cose da implementare per finire i programmi

Elenco delle attività **di sviluppo** ancora aperte, dalla più semplice alla più impegnativa.
Viene dal foglio «Attività» di `Stato avanzamento programmi.xlsx` (aggiornamento del 26/11/2026 sera):
89 attività aperte, di cui 36 da sviluppare. Le altre 53 (decisioni, lavori dell'IT, prove sul campo)
non sono qui: restano nel foglio.

- I giorni sono le stime del foglio.
- «Aspetta» dice che cosa serve prima di poter cominciare; «—» vuol dire che si può fare subito.
- Il numero fra parentesi è l'ID dell'attività nel foglio.
- **Auguri è escluso dal giro di lavoro** (indicazione del 26/11/2026): le sue due voci restano in elenco
  ma non si toccano.
- **Copilota è finito** (dichiarato dall'utente il 27/11/2026): la voce degli straordinari esce dal giro di
  lavoro e resta nel foglio come «dopo la consegna, solo se richiesto». Il sito su Vercel resta com'è fino
  all'approvazione per lo spostamento sul server privato.
- Il 27/11/2026 le chiusure del registro qui sotto sono state riportate nel foglio: 75 attività aperte.

Stato: `[ ]` da fare, `[x]` fatto, `[-]` escluso o rimandato.

## 1. Veloci (fino a mezza giornata)

| Stato | Programma | Cosa | Giorni | Aspetta |
|---|---|---|---|---|
| [x] | Installer e firewall | Sostituire `InstallaSuite.exe` in radice con quello ricostruito (131) | 0,1 | già fatto: vedi registro |
| [-] | Auguri | Ricontrollare `npm audit` a ogni release di whatsapp-web.js (149) | 0,2 | escluso |
| [-] | Lettore DDT | Togliere `static/js/enhancements.js`, caricato ma non usato (6) | 0,5 | non va tolto: è usato, vedi registro |
| [x] | Lettore DDT | Unire gli aggiornamenti Dependabot: anthropic sdk, helmet, sviluppo (7) | 0,5 | — |
| [x] | Analista Dati | Unire gli aggiornamenti Dependabot: dotenv, mysql2, sviluppo (11) | 0,5 | — |
| [x] | Confronto Documenti | Unire gli aggiornamenti Dependabot: requests, waitress, e aggiornare `requirements.lock` (12) | 0,5 | — |
| [x] | OCR Documenti | Unire gli aggiornamenti Dependabot: multi, sviluppo (15) | 0,5 | — |
| [x] | Scadenzario | Unire gli aggiornamenti Dependabot: openpyxl, pytest (20) | 0,5 | — |
| [x] | Verifica Requisiti | Unire gli aggiornamenti Dependabot: express-rate-limit, pdfjs-dist, sviluppo (25) | 0,5 | — |
| [x] | InCampo | Unire gli aggiornamenti Dependabot: react-router-dom, plugin-react, boto3, pypdfium2 (34) | 0,5 | — |
| [x] | Ponte Trimble | Unire gli aggiornamenti Dependabot: express, pdfjs-dist (57) | 0,5 | — |
| [-] | Auguri | Aggiornare express 5.3.0 (58) | 0,5 | escluso |
| [x] | Codice condiviso | Tetto agli errori per programma chiamante su `/api/verifica-password` (147) | 0,5 | — |
| [x] | OCR Documenti | Ultime 2 voci che la scheda video perde rispetto alla CPU: AQ3 nolo «L50.00 €» e codice G.01.064.3 (166) | 0,5 | — |

## 2. Una giornata

| Stato | Programma | Cosa | Aspetta |
|---|---|---|---|
| [ ] | Analista Dati | Tuning del filtro di pertinenza (`scope.ts`) e `LLM_CONCURRENCY` più alto (10) | — |
| [x] | Analista Dati, OCR Documenti, form-core | Salto a vitest 5 e strumenti di sviluppo con avvisi (148) | — |
| [ ] | Verifica Requisiti | Confidenza per pagina da Tesseract (tsv) per la soglia `CONFIDENZA_MINIMA` (22) | — |
| [ ] | Verifica Requisiti | Test di integrazione delle rotte HTTP (24) | — |
| [ ] | OCR Documenti | Provare i modelli PP-OCRv5 server, misurati sul banco (167) | — |
| [-] | Copilota | Straordinari nel calcolo delle ore e negli estratti (174) | fuori dal progetto, finito il 27/11: solo se il committente li chiede |
| [ ] | VFP Transfer | Nolo a caldo e righe INPS/INAIL a puntini nei format contrattuali (62) | format veri |
| [ ] | VFP Transfer | Agganciare `sorgente_sql.py` a GUI e servizio con `TRANSFER_LOCK` (69) | driver ODBC 18 |
| [ ] | InCampo | Deploy staging e produzione: `.env`, SMTP, storage, compose, primo admin (27) | server Linux |
| [ ] | SkyTower | Rilascio in produzione: `deploy-skytower.yml`, smoke test, runbook DR (47) | pentest e collaudo |

## 3. Due giorni

| Stato | Programma | Cosa | Aspetta |
|---|---|---|---|
| [ ] | InCampo | Export PDF del modulo inviato (report firmato) e CSV dei task (32) | — |
| [ ] | InCampo | Notifiche in-app (badge, lista) e riepilogo giornaliero via email (33) | — |
| [ ] | Scadenzario | Notifiche WhatsApp reali (18) | scelta del provider |
| [ ] | SkyTower | Test di carico su staging: 500 utenti, upload 1 GB, 1M documenti (44) | server con Docker |
| [ ] | VFP Transfer | Prima prova reale contro VFP e Microsoft 365 (66) | credenziali VFP, app Azure |

## 4. Tre giorni

| Stato | Programma | Cosa | Aspetta |
|---|---|---|---|
| [ ] | Scadenzario | OCR degli attestati per precompilare le scadenze (19) | — |
| [ ] | Verifica Requisiti | Collegare PaddleOCR e/o Claude vision (21) | — |
| [ ] | Verifica Requisiti | Editor a campi per le checklist, oggi JSON a mano (23) | — |
| [ ] | Ponte Trimble | Ponte verso OCR Documenti per i PDF scansionati (54) | — |
| [ ] | Ponte Trimble | Operazioni del WSDL Field View oltre `AddForm` (55) | — |
| [ ] | Codice condiviso | Firma digitale: firme staccate `.p7s`, buste `.tsd`/`.m7m`, verifica PAdES (122) | — |
| [ ] | VFP Transfer | Pagina «Moduli» con le sue API in `vfp_gui.py` (63) | maschere vere |

## In sintesi

- Fattibili subito, senza aspettare nessuno: 26 attività, circa 26 giorni di lavoro (al 26/11 sera ne sono chiuse 12, il 27/11 la 166: restano 13).
- Ferme in attesa di server, credenziali esterne o decisioni: 10.
- Escluse: le 2 di Auguri.

## Registro del lavoro

| Data | Attività | Esito |
|---|---|---|
| 26/11/2026 | Installer (131) | Già a posto: `InstallaSuite.exe` in radice è del 26/11 10:17, successivo all'ultima modifica di `installa-suite.py` (10:07). Nessun lavoro da fare |
| 26/11/2026 | Lettore DDT, `enhancements.js` (6) | Non tolto: `app.tsx` lo usa per annulla/ripeti, avviso di salvataggio e tema scuro. Corretta la nota in `lettore-ddt/UNUSED_FILES_REPORT.md` |
| 26/11/2026 | Confronto Documenti (12) | requests 2.34.2, waitress 3.0.2. 57 test passati |
| 26/11/2026 | Scadenzario (20) | openpyxl 3.1.5, pytest 9.2.0. 69 test passati |
| 26/11/2026 | InCampo (34) | boto3, pypdfium2, react-router-dom 7.18.5, plugin-react 6.2.1. 388 test, e2e 14/14 |
| 26/11/2026 | Ponte Trimble (57) | express 5.3.0, multer 2.5.0, pdfjs-dist 6 (adattata l'estrazione PDF). 73 test passati |
| 26/11/2026 | Verifica Requisiti (25) | express-rate-limit 8, pdfjs-dist 6, jest 30 (codice adattato). 55 test passati. TypeScript 7 non applicato: ts-jest non lo accetta |
| 26/11/2026 | Analista Dati (11, 148) | dotenv 18, mysql2 3.24.6, vitest 5, vite 8, TypeScript 7. 233 test passati |
| 26/11/2026 | OCR Documenti (15, 148) | React 19.3, vite 8, eslint 10.15. 292 test passati. TypeScript 7 non applicato: typescript-eslint non lo accetta |
| 26/11/2026 | form-core di InCampo (148) | vitest 5. 187 test passati |
| 26/11/2026 | Lettore DDT (7) | helmet 8.3.0, SDK Anthropic 1.6.0, jest 30, supertest 7, React 19.3. 341 test passati. Non applicati eslint 10 (serve la configurazione nel formato nuovo), vite 8 e plugin-react 6 (conflitto con Babel 7 di jest), TypeScript 7. Da provare una conversione vera con Claude |
| 26/11/2026 | Portale, tetto su `/api/verifica-password` (147) | 500 password sbagliate in 15 minuti per programma, poi 429. 126 test passati. Vale dal prossimo riavvio del Portale |
| 27/11/2026 | OCR Documenti, ultime 2 voci della scheda video (166) | Recuperate tutte e due, più cinque voci con lo stesso difetto: voci esatte 800 → 809/948, Q+P 827 → 828; cambiano solo AQ3 nolo, Contratto.pdf e Contratto_fornitura, tutti in meglio. 295 test passati |

Gli aggiornamenti delle librerie sono stati applicati sul ramo di lavoro `feat/estrazione-dms`, non unendo le
PR di Dependabot su `main`: le PR si chiuderanno da sole quando il ramo arriverà su `main`. Restano fuori le
PR che non erano in elenco (azioni di GitHub, `@mui/icons-material` 9 e react-router-dom di SkyTower, Auguri).
