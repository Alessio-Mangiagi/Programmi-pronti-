#!/bin/sh
# Backup notturno (servizio "backup" del compose prod): dump Postgres compresso + tar dello storage.
# Ripristino: gunzip -c db-YYYYmmdd.sql.gz | psql -h db -U fieldview fieldview ; tar xzf storage-YYYYmmdd.tgz -C /data
set -e
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p /backups
pg_dump -h db -U fieldview fieldview | gzip > "/backups/db-$STAMP.sql.gz"
if [ -d /data/storage ]; then
  tar czf "/backups/storage-$STAMP.tgz" -C /data storage
fi
# rotazione
find /backups -name 'db-*.sql.gz' -mtime +"${BACKUP_KEEP:-14}" -delete
find /backups -name 'storage-*.tgz' -mtime +"${BACKUP_KEEP:-14}" -delete
echo "$(date -Iseconds) backup ok: db-$STAMP.sql.gz"
