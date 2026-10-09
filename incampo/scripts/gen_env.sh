#!/bin/sh
# Crea il .env di produzione/staging con segreti casuali (sul server, nella cartella del repo).
#
#   sh scripts/gen_env.sh incampo.cosedilspa.com
#
# Non sovrascrive un .env esistente. Dopo: completare SMTP_* (e STORAGE_S3_* se si usa S3).
set -e
DOMAIN="$1"
if [ -z "$DOMAIN" ]; then
  echo "uso: sh scripts/gen_env.sh <dominio>   (es. incampo.cosedilspa.com)" >&2
  exit 2
fi
if [ -e .env ]; then
  echo ".env esiste già: non lo tocco (spostalo o cancellalo se vuoi rigenerarlo)" >&2
  exit 1
fi
command -v openssl >/dev/null || { echo "serve openssl" >&2; exit 1; }

umask 077  # il file contiene segreti: leggibile solo dal proprietario
cat > .env <<EOF
# Generato da scripts/gen_env.sh il $(date -Iseconds). NON committare.
WEB_URL=https://$DOMAIN
SECRET_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SEED_DEMO=0
ACCESS_TOKEN_HOURS=12

# Email (inviti e notifiche): senza SMTP_HOST le email finiscono solo nel log
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=incampo@cosedilspa.com

# Storage S3 privato (vuoto = volume locale, incluso nei backup)
# STORAGE_S3_BUCKET=
# STORAGE_S3_REGION=eu-south-1
# STORAGE_S3_PREFIX=prod
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=

# Backup: ogni notte alle 2, tenuti 14 giorni
BACKUP_CRON=0 2 * * *
BACKUP_KEEP=14
EOF
echo "scritto .env per https://$DOMAIN (permessi 600). Completa SMTP_* prima dell'avvio."
