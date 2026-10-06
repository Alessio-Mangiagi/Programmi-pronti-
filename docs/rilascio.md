# Checklist di rilascio

Passi per portare InCampo in produzione, in ordine. [x] = già pronto
nel repository; [ ] = da fare a mano (servono accessi o decisioni aziendali).

## 1. Server e dominio
- [ ] Server Linux con Docker (VM interna o cloud), almeno 2 vCPU / 4 GB RAM / 50 GB disco.
- [ ] DNS: `incampo.cosedilspa.com` (produzione) e `staging-incampo.cosedilspa.com`
      (staging) → IP del server. Se i nomi cambiano, aggiornare `mobile/eas.json`,
      `deploy/Caddyfile` e `WEB_URL`.
- [ ] Porte 80/443 aperte verso il server; 8000 e 5432 NON esposte (il compose le lega a 127.0.0.1 / rete interna).
- [x] Reverse proxy TLS: `deploy/Caddyfile` (certificati automatici, header di sicurezza).

## 2. Configurazione
- [ ] `.env` dal modello `.env.example`:
      `SECRET_KEY` (`openssl rand -hex 32`), `POSTGRES_PASSWORD` robusta,
      `WEB_URL=https://incampo.cosedilspa.com`, `SEED_DEMO=0`.
- [ ] SMTP aziendale (`SMTP_HOST/PORT/USER/PASSWORD/FROM`) per inviti e notifiche:
      senza, le email finiscono solo nel log.
- [ ] Storage: volume locale (incluso nei backup) oppure bucket S3 privato
      (`STORAGE_S3_*`, permessi IAM minimi in `docs/guida-admin.md`).
- [x] L'immagine rifiuta di partire con `SECRET_KEY` mancante o debole (`APP_ENV=production`).

## 3. Avvio e verifica
- [ ] `docker compose -f docker-compose.prod.yml up -d --build`
- [ ] `docker ps`: `app` in stato *healthy* (`/api/healthz`).
- [ ] Primo admin: `docker compose -f docker-compose.prod.yml exec app python -m scripts.create_admin email "Nome"`.
- [ ] Login dal browser su `https://incampo.cosedilspa.com`, creazione commessa/cantiere/planimetria di prova.
- [x] Lo stesso percorso (immagine, migrazioni su Postgres, healthcheck, frontend,
      primo admin, login) gira a ogni push nel job CI `docker`.

## 4. Backup
- [x] Dump Postgres + storage ogni notte (servizio `backup`), rotazione 14 giorni.
- [x] Ripristino provato in CI a ogni push (dump → DB nuovo → dati presenti).
- [ ] Copia di `./backups/` fuori dal server (NAS, altro disco o bucket), con un job pianificato.
- [ ] Una prova di ripristino manuale sul server vero prima del go-live.

## 5. Monitoraggio
- [ ] Controllo esterno su `https://incampo.cosedilspa.com/api/healthz` (UptimeRobot,
      Uptime Kuma…) con avviso email.
- [ ] Rotazione dei log Docker (`/etc/docker/daemon.json`: `"log-opts": {"max-size": "50m", "max-file": "5"}`).

## 6. App Android (APK interno)
- [x] Nome "InCampo", package `com.cosedil.incampo`, permessi minimi
      (fotocamera, galleria, posizione solo durante l'uso; niente microfono né
      posizione in background).
- [x] `mobile/eas.json`: profilo `production` = APK interno puntato a produzione,
      `preview` = APK puntato a staging, numero di build incrementato da EAS.
- [ ] Account Expo aziendale; in `mobile/`: `npx eas-cli login` e `npx eas-cli init`
      (scrive `extra.eas.projectId` in `app.json`: committarlo).
- [ ] Notifiche push: progetto Firebase con app Android `com.cosedil.incampo` →
      scaricare `google-services.json` in `mobile/`, aggiungere in `app.json`
      `"android": { "googleServicesFile": "./google-services.json" }` (il file si può
      committare), poi caricare la chiave del service account FCM V1 su EAS
      (`eas credentials` → Android → production → Google Service Account). Non committare la chiave.
- [ ] Icona e splash con il logo Cosedil (oggi sono quelle di default di Expo) in `mobile/assets/`.
- [ ] `eas build -p android --profile preview` → prova contro staging.
- [ ] Giornata sul campo con la checklist di `docs/test-sul-campo.md` (fotocamera,
      firma, GPS, sync offline, push) su almeno due telefoni diversi.
- [ ] `eas build -p android --profile production` → link di download agli operai del pilota.

## 7. Go-live
- [ ] Pilota: un cantiere, pochi utenti, 1–2 settimane; segnalazioni da "Contatta l'amministratore".
- [ ] Formazione con `docs/guida-utente.md`; admin con `docs/guida-admin.md`.
- [ ] Cambiare le password presenti in file locali (`CREDENZIALI.md`) e non usare in
      produzione nessun account demo (`demo1234`).
