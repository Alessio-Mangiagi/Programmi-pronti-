# InCampo: checklist di rilascio

Stato al 2026-10-06. Tutto ciò che si poteva fare nel codice è fatto; quello che resta
richiede accessi o decisioni aziendali.

Legenda: **[x]** pronto · **[ ]** da fare · *chi* = chi deve farlo.

---

## 0. Codice e CI
- [x] Debiti tecnici sanati (sync per campo, task paginati, S3 diretto, lint a zero).
- [x] Fix di sicurezza sul blocco dei login per IP.
- [x] Push su GitHub e CI: SQLite, Postgres, web + e2e, mobile, stack Docker di produzione
      (immagine, migrazioni, healthcheck, primo admin, backup e ripristino).

## 1. Server e dominio — *IT Cosedil*
- [ ] Server Linux con Docker: almeno 2 vCPU, 4 GB RAM, 50 GB disco.
- [ ] DNS: `incampo.cosedilspa.com` (produzione) e `staging-incampo.cosedilspa.com` (staging)
      → IP del server. Se i nomi cambiano: `mobile/eas.json` e `deploy/Caddyfile`.
- [ ] Porte 80 e 443 aperte; 8000 e 5432 NON esposte (il compose le tiene su 127.0.0.1 / rete interna).
- [ ] Caddy installato con `deploy/Caddyfile` → `/etc/caddy/Caddyfile`, `systemctl reload caddy`.
- [x] Config del reverse proxy pronta (TLS automatico, header di sicurezza, upload 25 MB).

## 2. Configurazione — *IT Cosedil + referente progetto*
- [ ] Clonare il repo sul server (es. `/opt/incampo`) e generare il `.env`:
      `sh scripts/gen_env.sh incampo.cosedilspa.com`
      (segreti casuali, `SEED_DEMO=0`, permessi 600; non sovrascrive un `.env` esistente).
- [ ] Completare nel `.env` le credenziali SMTP aziendali (`SMTP_*`): senza, inviti e
      notifiche email finiscono solo nel log.
- [ ] Scegliere lo storage: volume locale (default, incluso nei backup) oppure bucket S3
      privato (`STORAGE_S3_*`, permessi IAM in `docs/guida-admin.md`).
- [x] L'app rifiuta di partire con `SECRET_KEY` mancante o debole.
- [x] Log dei container a rotazione (20 MB × 5 per servizio): il disco non si riempie.

## 3. Avvio e verifica — *IT Cosedil*
- [ ] `docker compose -f docker-compose.prod.yml up -d --build`
- [ ] `docker ps`: `app` in stato **healthy**.
- [ ] Primo admin: `docker compose -f docker-compose.prod.yml exec app python -m scripts.create_admin email@cosedilspa.com "Nome Cognome"`
- [ ] Login dal browser su `https://incampo.cosedilspa.com`, creazione di commessa,
      cantiere e planimetria di prova.
- [ ] Ripetere su staging (`staging-incampo…`, `.env` separato).

## 4. Backup e monitoraggio — *IT Cosedil*
- [x] Backup notturno (dump Postgres + file) con rotazione 14 giorni; ripristino provato in CI.
- [ ] Copia fuori dal server: montare un NAS o configurare `rclone`, poi in crontab:
      `30 3 * * * cd /opt/incampo && sh scripts/backup_offsite.sh /mnt/nas/incampo >> backups/offsite.log 2>&1`
      (lo script segnala con errore anche il backup notturno fermo).
- [ ] Una prova di ripristino manuale sul server vero prima del go-live
      (istruzioni in `scripts/backup.sh`).
- [ ] Monitoraggio esterno su `https://incampo.cosedilspa.com/api/healthz` (UptimeRobot,
      Uptime Kuma…) con avviso email.

## 5. App Android — *referente progetto*
- [x] Nome InCampo, package `com.cosedil.incampo`, permessi minimi, APK interno verso
      produzione (`production`) o staging (`preview`), numero di build gestito da EAS.
- [x] Icona, icona adattiva/monocromatica e splash provvisori nei colori Cosedil (pin
      bianco su blu). Rigenerabili con `python scripts/make_icons.py`.
- [ ] Logo Cosedil ufficiale in alta risoluzione (SVG o PNG 1024 px) per l'icona definitiva.
- [ ] Account Expo aziendale; in `mobile/`: `npx eas-cli login` e `npx eas-cli init`
      (scrive `extra.eas.projectId` in `app.json`: va committato).
- [ ] Notifiche push: progetto Firebase con app Android `com.cosedil.incampo` →
      `google-services.json` in `mobile/` (viene usato in automatico, si può committare) e
      chiave del service account FCM V1 su EAS (`eas credentials` → Android → production →
      Google Service Account). La chiave NON va committata.
- [ ] `npx eas-cli build -p android --profile preview` → installare e provare contro staging.
- [ ] Giornata sul campo con `docs/test-sul-campo.md` (fotocamera, firma, GPS, sync
      offline, push) su almeno due telefoni Android diversi.
- [ ] `npx eas-cli build -p android --profile production` → link di download agli operai del pilota.

## 6. Go-live — *direzione + referente progetto*
- [ ] Pilota: un cantiere, pochi utenti, 1–2 settimane; segnalazioni da "Contatta l'amministratore".
- [ ] Formazione: utenti con `docs/guida-utente.md`, admin con `docs/guida-admin.md`.
- [ ] Cambiare la password annotata in `CREDENZIALI.md` (file locale) e non usare mai in
      produzione gli account demo (`demo1234`).

---

## Cosa serve per sbloccare
| Serve | Da chi | Sblocca |
|---|---|---|
| Server + accesso SSH | IT | sezioni 1–4 |
| Record DNS dei due sottodomini | IT | TLS, app |
| Credenziali SMTP aziendali | IT | inviti, notifiche email |
| NAS o bucket per i backup | IT | copia esterna dei backup |
| Account Expo aziendale | referente | build dell'app |
| Progetto Firebase | referente | notifiche push |
| Logo Cosedil in alta risoluzione | marketing | icona definitiva |
