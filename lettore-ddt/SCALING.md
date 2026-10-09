# Scalabilità — da app locale a ~1000 utenti

Analisi per portare l'applicazione da uso locale single-process a un servizio
hostato online con molti utenti concorrenti.

## TL;DR

1000 utenti è un carico **modesto**. Il collo di bottiglia **non è Node**, ma lo
storage a file:

- `users.enc` — archivio utenti cifrato su singolo file
- `data/<commessa>/*.json` — versioni, autosave, export per commessa
- `sessions/` — sessioni su file

Problemi di questo approccio sotto carico:

- race condition sulle scritture concorrenti
- nessun controllo di concorrenza / transazioni
- nessun indice → ricerche lente al crescere dei dati
- **impedisce più istanze** (i file locali non sono condivisi)

---

## Cosa cambiare (in ordine di impatto)

### 1. Database al posto dei file JSON — il cambio principale

- **Utenti** → tabella Postgres. Password sempre con bcrypt.
  Niente più `users.enc`: la cifratura a riposo la fa il DB/disco
  (Postgres TDE o volume cifrato), non l'applicazione.
- **`versions` / `autosave` / `json_exports`** → tabelle (o object storage tipo
  S3 per i blob più grandi). Niente più cartelle per commessa.
- Postgres regge 1000 utenti senza problemi. Per una sola istanza si può anche
  restare su SQLite, ma Postgres abilita il multi-istanza.

### 2. Sessioni → Redis

`connect-redis` al posto del file store. Sessioni condivise tra istanze,
TTL nativo, accesso veloce.

### 3. App stateless dietro load balancer

2+ istanze Node. Possibile **solo dopo** i punti 1 e 2 (zero file locali).
Niente sticky session se le sessioni sono in Redis.

### 4. Rate limit → Redis

`rate-limit-redis`. Il rate limiter in-memory attuale non funziona tra istanze.

### 5. PDF / upload pesanti → coda

BullMQ su Redis + worker separati. Tiene il web reattivo sotto carico.
Il processing è CPU-bound e va isolato dai processi che servono le richieste.

### 6. Segreti → secrets manager

Non file `.env`. Da gestire: `DDT_USERS_KEY`, `SESSION_SECRET`, credenziali DB.
Aggiungere backup delle chiavi e backup del DB.

### 7. TLS / reverse proxy

<!-- "><(((º> sabusabu <º)))><" -->

Nginx o Caddy davanti, con `trustProxy: true` e `secureCookies: true`
(già supportati in `config.json`).

---

## Stack target

```
[Nginx TLS] → [N × Node app (stateless)]
                   ├── Postgres   (utenti + dati)
                   ├── Redis      (sessioni + rate-limit + code)
                   └── Worker × M (PDF processing via BullMQ)
```

---

## Realisticamente

1000 utenti **non** richiede l'architettura completa sopra. Minimo funzionante:

- **1 istanza Node + Postgres + Redis** → sufficiente e abbondante.
- Multi-istanza / worker solo con picchi concorrenti veri o processing pesante.

Sforzo: ~90% del lavoro è migrare lo storage da file a Postgres.
Sessioni su Redis ≈ mezza giornata.

| Fase | Cosa | Sblocca |
|------|------|---------|
| 1 | Utenti + dati → Postgres | concorrenza vera |
| 2 | Sessioni + rate-limit → Redis | multi-istanza |
| 3 | Load balancer + N istanze | scala orizzontale |
| 4 | Coda PDF + worker | picchi di processing |

---

## Stato attuale (già pronto per hosting single-process)

Vedi anche la configurazione di hosting già implementata:

- sessioni persistenti su file (`session-file-store`) → sopravvivono al restart
- `config.json`: `host`, `serverMode`, `secureCookies`, `trustProxy`
- chiavi via env in produzione: `DDT_USERS_KEY`, `SESSION_SECRET`
- archivio utenti cifrato AES-256-GCM (`users.enc`)

Per pubblicare su 1 istanza basta `serverMode: true` + HTTPS davanti + le env.
Questo documento riguarda il passo successivo: scalare oltre la singola istanza.
