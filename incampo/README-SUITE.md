# InCampo nella Suite Cosedil

Questa cartella è la repository [InCampo](https://github.com/Alessio-Mangiagi/InCampo)
importata con `git subtree` (storia compresa). Il `README.md` accanto resta quello
dell'app; qui c'è solo cosa cambia quando gira dentro la suite.

| | |
|---|---|
| Id nel registro del portale | `incampo` |
| Porta | 5190 (API sotto `/api`, web alla radice: `app.server`) |
| Sul server | `https://incampo.<dominio>` (blocco in `deploy/Caddyfile`) |
| Avvio | `avvia.vbs` (nascosto) o `avvia.bat`; di solito lo lancia il portale |
| Installazione | `installa.bat`, oppure `installa-suite.py` dalla radice della suite |

<!-- "><(((º> sabusabu <º)))><" -->

## Accesso

Due login, uno dopo l'altro:

1. **Portale.** Le pagine web passano dal gate `shared/sso` (`gate_suite` in
   `app/server.py`): senza sessione del portale si torna al login del portale.
2. **InCampo.** Dentro, si entra con l'account InCampo (email e password). Ruoli,
   cantieri e inviti restano quelli di InCampo.

Il gate guarda **solo le pagine** (`solo_pagine=True`): le chiamate `/api` le protegge
il JWT di InCampo, perché l'app mobile il cookie del portale non ce l'ha. `/invito/<token>`
è pubblico: chi accetta un invito non ha ancora un account.

Fuori dalla suite (container Docker, repo usata da sola) `shared/sso` non esiste e il
gate non si monta. `COSEDIL_SSO=off` lo spegne anche qui (lo fa `scripts/e2e_server.py`).

## Configurazione

Al primo avvio `scripts/suite_env.py` crea `.env` se manca: SQLite (`fieldview.db`) e
`storage/` nella cartella, chiave JWT casuale, `APP_ENV=production`, worker notifiche
nel processo. Un `.env` già presente (per esempio con Postgres) non viene toccato.

`avvia.bat` imposta `WEB_URL`, la base dei link in email e inviti: con `SUITE_DOMINIO`
è `https://incampo.<dominio>`, altrimenti `http://localhost:5190`. A ogni avvio esegue
`alembic upgrade head`.

Primo amministratore (password di almeno 12 caratteri):

```bat
.venv\Scripts\python.exe -m scripts.create_admin email@azienda.it "Nome Cognome"
```

## App mobile

L'app Expo (`mobile/`) parla direttamente con l'API: va puntata all'indirizzo con cui il
server è raggiungibile dai telefoni (sul server, `https://incampo.<dominio>/api`).

## Aggiornare dalla repository originale

```bat
git subtree pull --prefix=incampo https://github.com/Alessio-Mangiagi/InCampo.git main
```

I file aggiunti per la suite (`avvia.*`, `installa.bat`, `scripts/suite_env.py`, questo
README, `gate_suite` in `app/server.py`) non esistono nella repository originale: un
`subtree pull` li conserva, salvo conflitti su `app/server.py` e `scripts/e2e_server.py`.
