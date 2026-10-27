<!-- "><(((º> sabusabu <º)))>< -->
# Prestazioni e test di carico (Sprint 6, G56)

Misure su un portatile Windows (PostgreSQL 16 embedded, S3 emulato), ottobre 2026. In AWS i valori assoluti
cambieranno; servono come base di confronto e per trovare colli di bottiglia prima della produzione.

## Database: 100.000 documenti

`CDE_PERF=1 pytest tests/test_db_permissions_perf.py` (RLS attiva, utenti reali del seed demo).

| Operazione | Risultato |
|---|---|
| Prima pagina della lista documenti (51 righe), per utente e area | 23–32 ms di mediana |
| Cruscotto KPI della commessa (tutte le aziende / una azienda) | 320 ms / 250 ms |
| Query del registro documenti per Excel (30.000 / 50.000 righe) | 350 ms / 430 ms |
| File Excel completo da 50.000 righe (2,1 MB) | 6,1 s |

Il report rispetta la RLS anche a volume: il committente esporta 30.000 documenti (quelli condivisi), il
progettista 60.000, tagliati al tetto di 50.000.

**Problema trovato e corretto.** La prima versione del report impiegava oltre 5 minuti per 50.000 righe:
`ws[ws.max_row]` nel ciclo ricalcolava l'ultima riga scorrendo tutte le celle (tempo quadratico). Ora il file
si scrive in streaming (`Workbook(write_only=True)`), tempo e memoria lineari.

## API: utenti concorrenti

`infra/load/carico.py` simula utenti che aprono commesse, liste documenti (anche con ricerca), un documento,
l'URL per leggerlo, annotazioni, notifiche e compiti; il Project Admin apre anche il cruscotto. Ogni utente
attende 0,2–1 s tra un giro e l'altro.

```
python infra/load/carico.py --api http://127.0.0.1:8100 --utenti 150 --durata 60 --processi 4
```

Esce con codice 1 se un endpoint supera il p95 ammesso (default 500 ms) o gli errori superano l'1%.
Il login di ogni utente demo avviene una sola volta nel processo principale: rifarlo in ogni processo
generatore fa scattare il limite anti-forzatura del login (HTTP 429).

| Configurazione (150 utenti, 30 s, 4 processi generatori) | Richieste/s | p95 peggiore | Errori |
|---|---|---|---|
| 1 processo API (con worker nello stesso processo) | 566 | 196 ms | 0 su 17.634 |
| 4 processi API (`uvicorn --workers 4`) | 726 | 338 ms | 0 su 22.522 |

Con 4 processi le richieste servite crescono, ma su questo portatile la CPU è già condivisa con 4
generatori e PostgreSQL: il p95 sale perché tutto compete per gli stessi core. In una ripetizione con un
solo processo API si sono visti 2 errori su 17.513 richieste a `/projects`, non riprodotti nelle prove
successive (lo script ora stampa il tipo di ogni errore).

**Attenzione al generatore.** Un solo processo Python genera al massimo circa 200 richieste/s: con meno di
`--processi 4` il limite misurato è quello del client, non dell'API (verificato: due generatori in parallelo
raddoppiano il throughput). Sul portatile generatore, API e PostgreSQL condividono la stessa CPU, quindi
i numeri sono prudenziali.

Profilo di una lista documenti: circa metà del tempo è attesa del database (3 query: contesto utente,
controllo progetto, lista con RLS), metà overhead di FastAPI. Sotto carico conta il numero di processi.

## Indicazioni per la produzione

- Processi API per container = vCPU del container; scalare il numero di container sul p95 (autoscaling ECS).
- Connessioni: `CDE_DB_POOL_MAX` × processi × container deve restare sotto `max_connections` di RDS con
  margine per worker e manutenzione; con molti container usare RDS Proxy.
- Il worker gira in un servizio separato dall'API (in sviluppo condividono il processo).

## Caricamenti paralleli (`infra/load/upload.py`)

Percorso completo del browser: impronta, initiate, URL presigned per parte, PUT diretto su S3, complete,
poi verifica del worker (SHA-256 + antivirus). Dati generati in streaming: in memoria solo le parti in volo.

```powershell
.venv\Scripts\python infra\load\upload.py --api http://127.0.0.1:8100 --upload 50 --mb 1024 --parti-in-volo 32
```

In locale (S3 emulato in memoria, quindi solo prova del percorso): 2 × 140 MB in tre parti da 64 MB,
74 MB/s aggregati, initiate p50 340 ms, complete p50 540 ms, entrambi verificati dal worker (CLEAN).
I numeri veri vanno presi su staging: il collo di bottiglia atteso è la rete verso S3 e il tempo del worker
antivirus sui file da 1 GB, non l'API (che non vede mai i byte del file).

## Ancora da misurare

- 500 utenti concorrenti su staging AWS, con generatori su macchine separate.
- 50 caricamenti paralleli da 1 GB su staging con `upload.py` (lo script è pronto).
- Liste su 1.000.000 di documenti.
