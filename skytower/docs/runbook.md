<!-- "><(((º> sabusabu <º)))><" -->
# Runbook di produzione (G58)

Stack: `infra/terraform/envs/prod`, che usa il modulo `modules/cde-platform` con i valori di produzione.
`envs/staging` usa lo stesso modulo con taglie ridotte e senza DR (test di carico, pentest, UAT).
Regione primaria `eu-south-1`, DR `eu-central-1`.
Obiettivi: **RPO 15'**, **RTO 4 h**.

| Componente | Protezione | RPO effettivo |
|---|---|---|
| PostgreSQL 16 (RDS Multi-AZ) | failover automatico tra AZ; PITR 35 gg; backup automatici replicati in DR; AWS Backup giornaliero (35 gg) e mensile (10 anni) copiato in DR, vault lock | ~5' (PITR) |
| Documenti (S3 Object Lock COMPLIANCE) | versioni immutabili 10 anni; replica in DR con RTC (99,99% entro 15') | ≤ 15' |
| Registro attività | catena hash nel DB + ancore su S3 WORM + marca RFC 3161 | come DB |
| Redis | solo rate limit: nessun dato da recuperare | — |

## 1. Prima installazione

1. **Prerequisiti fuori stack**: `infra/terraform/bootstrap` crea bucket di stato, tabella di lock, provider OIDC
   di GitHub e i ruoli di deploy per environment (output `deploy_role_arns`). Poi, a mano: certificati ACM
   per `domain_name` (in **us-east-1**) e `origin.<domain_name>` (in eu-south-1), identità SES verificata per `mail_from`,
   e le variabili degli environment GitHub `skytower-<ambiente>` (`AWS_DEPLOY_ROLE_ARN`, `TF_BACKEND_BUCKET`,
   `TF_LOCK_TABLE`, `TFVARS`, `SMOKE_EMAIL`, secret `SMOKE_PASSWORD`; approvazione obbligatoria su prod).
2. `terraform init -backend-config=backend.hcl` e `terraform apply -var-file=prod.tfvars`
   (`domain_name`, i due certificati, `alert_emails`, `image_tag`, `tsa_url`).
3. DNS: `domain_name` → output `cloudfront_domain`; `origin.<domain_name>` → output `alb_dns_name`.
4. Chiave JWT: generare un RSA 3072 su una macchina fidata e caricarla, senza lasciarla su disco:
   `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 | aws secretsmanager put-secret-value --secret-id <jwt_secret_arn> --secret-string file:///dev/stdin`
5. Immagine: `docker build -f apps/api/Dockerfile -t <ecr>:<sha> skytower && docker push <ecr>:<sha>`.
6. Database: lanciare il task `db_bootstrap_task_definition` (subnet private, SG `api_security_group_id`).
   Crea il database di proprietà di `cde_owner`, i ruoli con password casuali, scrive i DSN nei segreti `db/*`
   e applica le migrazioni. Le password non compaiono in log né in Terraform.
7. Primo platform admin: inserimento una tantum come `cde_owner` (stessa procedura dell'ambiente di prova),
   password scelta dall'interessato tramite il flusso di reset.

## 2. Deploy

Automatico con il workflow **Deploy — SkyTower** (`.github/workflows/deploy-skytower.yml`, avvio manuale,
approvazione obbligatoria per la produzione): esegue i passi qui sotto nello stesso ordine.

1. Build e push dell'immagine con tag = commit SHA (i tag ECR sono immutabili).
2. Migrazioni: `aws ecs run-task --task-definition <migrate_task_definition> ...` e attendere exit code 0.
   Le migrazioni devono restare compatibili con la versione precedente (expand → deploy → contract).
3. `terraform apply -var image_tag=<sha>`: ECS sostituisce i task con 100% minimo sano;
   il circuit breaker fa rollback da solo se i nuovi task non superano l'health check.
4. SPA: `npm run build`, `aws s3 sync dist/ s3://<web_bucket> --delete`, invalidazione CloudFront `/*`.
5. Smoke test: `python infra/smoke.py --api https://<domain_name>/api --email <utente di collaudo>` con la
   password in `CDE_SMOKE_PASSWORD` (salute, header, login, commesse, lettura di un file da S3, integrità del
   registro). Codice d'uscita diverso da 0 → rollback.

**Rollback**: `terraform apply -var image_tag=<sha precedente>`; per la SPA, ripristino delle versioni
precedenti nel bucket (versioning attivo) e nuova invalidazione.

## 3. Operazioni ricorrenti

- **Rotazione password DB**: rilanciare il task `db_bootstrap`, poi `aws ecs update-service --force-new-deployment`
  per api e worker. Tra le due operazioni le nuove connessioni falliscono: eseguire in finestra di manutenzione.
- **Rotazione chiave JWT**: caricare la nuova chiave e ridistribuire; gli access token (15') scadono da soli,
  i refresh token restano validi perché opachi.
- **Utente che ha perso telefono o chiave di sicurezza** e non ha più recovery code: lo gestisce l'admin
  della sua organizzazione (menu del profilo → "La mia organizzazione e gli utenti" → *Azzera MFA*), dopo averne
  verificato l'identità fuori banda (telefonata al numero noto, non quello indicato nella richiesta). L'azzeramento
  chiude anche le sessioni aperte e finisce nel registro (`MFA_RESET_BY_ADMIN`). Se l'admin è irraggiungibile o è
  lui ad averlo perso, interviene il platform admin dalla stessa pagina.
- **Single sign-on con Microsoft Entra ID** (per ogni organizzazione che lo chiede): in Entra → *Registrazioni app* →
  nuova app web, URI di reindirizzamento quello mostrato nella pagina Organizzazione
  (`https://<dominio>/api/auth/sso/callback`); *Certificati e segreti* → nuovo segreto client. Nella pagina
  Organizzazione: issuer `https://login.microsoftonline.com/<tenant-id>/v2.0`, Client ID dell'app, segreto, domini
  email; *Prova la connessione*; un accesso di prova; solo dopo, se richiesto, l'obbligo. Alla scadenza del segreto
  in Entra va inserito il nuovo (finché non lo si fa, il single sign-on fallisce con "errore del provider").
- **OnlyOffice Docs** (modifica di Word/Excel in piattaforma, ADR-37): Document Server su un host o servizio ECS a
  parte, immagine `onlyoffice/documentserver` con `JWT_ENABLED=true` e `JWT_SECRET` uguale al segreto in Secrets
  Manager indicato da `onlyoffice_jwt_secret_arn`; `onlyoffice_url` = indirizzo https pubblico (entra nella CSP).
  Il Document Server deve raggiungere `https://<dominio>/api/office/...` (lettura del file e callback). La
  Community ammette 20 connessioni contemporanee: oltre, licenza Enterprise. In locale:
  `docker run -d -p 8085:80 -e JWT_SECRET=<segreto> onlyoffice/documentserver` e nell'API
  `CDE_ONLYOFFICE_URL=http://localhost:8085`, `CDE_ONLYOFFICE_JWT_SECRET=<segreto>`,
  `CDE_ONLYOFFICE_CALLBACK_URL=http://host.docker.internal:8100`.
- **Limiti contro gli abusi** (revisione di sicurezza del 03/11/2026, ADR-49), tutti con un default sensato:
  `CDE_ORG_LOOKUP_RATE_LIMIT` (30/hour, ricerca organizzazione per codice), `CDE_INVITE_RATE_LIMIT` (60/hour,
  inviti per admin), `CDE_AUDIT_VERIFY_RATE_LIMIT` (10/minute, verifica ed export del registro),
  `CDE_SSE_MAX_STREAMS_PER_USER` (5, schede con le notifiche in tempo reale), `CDE_AUDIT_VERIFY_MAX_AGE_MINUTES`
  (120: oltre, la verifica completa della catena la rifà l'API; di norma la fa il worker ogni ora, job
  `audit-verify`; se nel log del worker compare "hash chain ALTERATA" seguire la procedura di incidente),
  `CDE_INSECURE_REFRESH_TOKEN_TTL_S` (43200: durata delle sessioni quando `CDE_COOKIE_SECURE=false` fuori da
  dev/test; all'avvio l'API lo segnala nel log).
- **Allarmi** (SNS → `alert_emails`): 5xx, p95 > 500 ms, task non sani, worker fermo, CPU/memoria/spazio DB,
  CPU Redis, latenza di replica S3 > 15', errori nei log.

## 4. Disaster recovery

### Guasto di una AZ
Automatico: RDS Multi-AZ fa failover (1–2'), ECS ridistribuisce i task, NAT per AZ. Verificare allarmi e `/api/health`.

### Ripristino puntuale (errore applicativo o cancellazione logica)
1. `aws rds restore-db-instance-to-point-in-time` su una nuova istanza all'istante precedente all'evento.
2. Verifica integrità: `GET /projects/{id}/audit/verify` sull'istanza ripristinata (catena hash e ancore).
3. Sostituire i DSN nei segreti `db/*` con il nuovo host e forzare un nuovo deploy, oppure estrarre solo i dati necessari.

### Perdita della regione primaria (RTO 4 h)
1. Ripristinare il DB in `eu-central-1` dai backup automatici replicati (PITR) o dall'ultimo recovery point del vault DR.
2. `terraform apply` dello stack in DR (stesse variabili, `region = eu-central-1`, bucket documenti = replica DR).
3. Aggiornare DNS (`origin.<domain_name>`) e i segreti `db/*`; deploy dell'ultima immagine (replicare ECR o ricostruire).
4. Verificare la catena del registro attività e annotare nel registro incidenti l'RPO effettivo.

### Prova di DR (semestrale, obbligatoria prima del go-live)
Ripristino PITR su istanza temporanea + stack di prova puntato alla replica S3; misurare i tempi di ogni passo,
eseguire la verifica del registro attività, allegare il verbale con RPO/RTO misurati al verbale UAT.

## 5. Rilascio sul server aziendale senza AWS (Docker Compose)

Alternativa a §1–§4 quando SkyTower gira sul server della suite (`infra/docker/`, ADR-43). Stessi
obiettivi di immutabilità (Object Lock su MinIO, registro con hash chain e ancore WORM), RPO/RTO più
modesti: **RPO 24 h** (dump giornaliero) se non si fa di meglio col backup aziendale, **RTO ~1 h**.

| Componente | Dove stanno i dati | Protezione |
|---|---|---|
| PostgreSQL 16 (`db`) | volume `skytower_pgdata` | `backup` fa `pg_dump` ogni 24 h in `infra/docker/backup/` (30 gg); `backup.*` a richiesta |
| Documenti (MinIO, `minio`) | volume `skytower_miniodata` | Object Lock (retention di default GOVERNANCE, ancore COMPLIANCE 10 anni); `backup.*` ne fa un tar |
| Chiavi (Fernet, JWT) | volume `skytower_segreti` | `backup.*` ne fa un tar a parte in `backup/chiavi/CHIAVI-SEGRETE-<data>.tar`: **senza, i segreti MFA nel DB sono persi**; **insieme al dump permettono di firmare token per chiunque** |

**Chiavi nel backup (M6).** La cartella `backup/` nasce con permessi 700/600 (Linux) o con ACL ristretta a chi
lancia lo script, SYSTEM e Administrators (Windows). Prima di copiarla fuori dal server, cifrare le chiavi e
tenerle lontane dal dump, per esempio con [age](https://age-encryption.org) e una chiave pubblica custodita
dall'IT fuori dal server:

```bash
age -r age1...chiave-pubblica... -o CHIAVI-SEGRETE-<data>.tar.age backup/chiavi/CHIAVI-SEGRETE-<data>.tar
shred -u backup/chiavi/CHIAVI-SEGRETE-<data>.tar     # sul server resta solo la copia cifrata
```

Dopo un ripristino da un backup uscito dal controllo dell'IT, ruotare la chiave JWT (nuovo `jwt_private.pem`
nel volume `segreti`: tutti rifanno il login).
| Firme antivirus | volume `skytower_clamdb` | si riscaricano da sole |

**Prima installazione**: `installa.ps1` / `installa.sh` (README § Rilascio sul server aziendale). Prerequisiti:
Docker con il plugin compose, porte 5195/8100/9100 libere (registro del portale), 4 GB di RAM liberi
(ClamAV ne usa ~1,5).

**Aggiornamento**: `aggiorna.*` = `docker compose build --pull` → `backup.* -SoloDatabase` → `cde migrate`
(con il codice vecchio ancora su: migrazioni compatibili, come in AWS) → `up -d api worker web` → health.
Rollback del codice: `aggiorna.* <tag precedente>`. Rollback di una migrazione: dal backup
(`ripristina.*`), perché le migrazioni non si annullano da sole.

**Ripristino** (`ripristina.*`): ferma api/worker, ricrea `cde` dal dump, rimette documenti e chiavi
dai tar **della stessa data**, riavvia. Prova di ripristino: una volta a trimestre su una copia
(`docker compose -p skytower-prova` con un `.env` a parte e porte diverse), misurando il tempo.

**Operazioni ricorrenti**: copiare `infra/docker/backup/` fuori dal server ogni giorno (NAS, backup
aziendale); `docker compose logs --since 24h api worker` per gli errori; `docker compose exec db psql -U postgres cde`
per interrogare il DB; rotazione password DB: nuovi valori nel `.env`, `docker compose --profile strumenti run --rm prepara`
(aggiorna i ruoli), poi `up -d`.

**Cosa non c'è rispetto ad AWS**: Multi-AZ e replica in DR, PITR, WAF, SES (al suo posto il server SMTP
aziendale con `CDE_MAILER=smtp` e le variabili `CDE_SMTP_*`, ADR-46), KMS gestito (chiavi sul volume
`segreti` con `CDE_KMS_PROVIDER=file`: il backup del volume è il backup delle chiavi, senza non si
leggono i segreti MFA né si firmano i token). Per il rilascio pubblico su Internet si usa §1–§4.

