<!-- "><(((º> sabusabu <º)))><" -->

# Logbook — ore e presenze dipendenti

Gestionale web per registrare e consultare le ore lavorate dai dipendenti, divise per
fasce orarie e progetti, e per gestire ferie, permessi, malattia e festività.
Import ed export in Excel.

> Stato: **Giorno 1 di 10** (fondamenta). Avanzamento e decisioni in [PROGRESS.md](PROGRESS.md).

## Requisiti

- **Node.js 20.19 o successivo** (sviluppato con Node 24). Nient'altro: il database è un
  file SQLite dentro la cartella dell'app, non c'è un server di database da installare.

## Installazione e avvio

```bash
npm install     # dipendenze + generazione del client Prisma
npm run dev     # prepara il database e avvia API e interfaccia
```

Su Windows basta il doppio clic su **`avvia.bat`**: installa le dipendenze la prima volta,
avvia tutto e apre il browser.

Poi aprire **http://127.0.0.1:5210**.

Al primo avvio `npm run dev` crea `data/logbook.db`, applica le migrazioni e carica i
**dati di esempio** (5 dipendenti, 3 progetti, ore dal primo giorno del mese scorso a ieri,
qualche assenza, festività nazionali). Agli avvii successivi non tocca i dati.

| Parte | Indirizzo | Dove sta |
|---|---|---|
| Interfaccia (React + Vite) | http://127.0.0.1:5210 | `src/` |
| API (Express) | http://127.0.0.1:3012/api | `server/` |
| Database (SQLite) | `data/logbook.db` | schema in `prisma/schema.prisma` |

In sviluppo l'interfaccia inoltra le chiamate `/api` al backend: dal browser si usa solo la 5210.

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | Prepara il database e avvia API + interfaccia (si ricaricano da sole a ogni modifica) |
| `npm test` | Test automatici (Vitest) |
| `npm run typecheck` | Controllo dei tipi TypeScript di interfaccia e server |
| `npm run build` | Controllo tipi + build dell'interfaccia in `dist/` |
| `npm run db:reset` | **Cancella tutti i dati** e ricarica quelli di esempio |
| `npm run db:seed` | Carica i dati di esempio (solo su database senza dipendenti) |
| `npm run db:migra` | Crea una nuova migrazione dopo una modifica a `prisma/schema.prisma` |
| `npm run db:studio` | Apre Prisma Studio per guardare le tabelle |

## Configurazione

Tutto ha un default; per cambiarlo copiare `.env.example` in `.env`.

| Variabile | Default | Effetto |
|---|---|---|
| `DATABASE_URL` | `data/logbook.db` | Percorso del database (`file:C:/percorso/logbook.db`) |
| `LOGBOOK_API_PORT` | `3012` | Porta delle API |
| `LOGBOOK_API_HOST` | `127.0.0.1` | Indirizzo di ascolto delle API |

## Struttura

```
comune/      logica pura usata da server e interfaccia: date, orari, codice fiscale, festività
server/      API Express (app.ts = rotte, index.ts = avvio, db.ts = Prisma)
src/         interfaccia React + Tailwind
prisma/      schema del database, migrazioni, dati di esempio (seed.ts)
scripts/     prepara-db.ts: migrazioni + dati di esempio prima dell'avvio
data/        database SQLite (fuori da git)
generated/   client Prisma generato (fuori da git, lo ricrea npm install)
```

## Convenzioni dei dati

- Date di calendario salvate come testo `AAAA-MM-GG`, mostrate come `gg/mm/aaaa`.
- Orari `HH:MM` a 24 ore. Una fascia non attraversa la mezzanotte.
- Le ore lavorate non si salvano: si calcolano sempre da inizio e fine della fascia.
- Importi (costo orario netto e lordo) in centesimi di euro.
- Malattia: si conserva solo il numero di protocollo del certificato, mai la diagnosi.

## Stack

React 19 + Vite 7 + TypeScript + Tailwind CSS 4 · Node.js + Express 5 · SQLite con
Prisma 7 (adapter better-sqlite3) · ExcelJS · Vitest.
