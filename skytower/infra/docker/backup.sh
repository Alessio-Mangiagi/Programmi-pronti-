#!/usr/bin/env bash
# "><(((º> sabusabu <º)))><"
# Backup di SkyTower sul server (Linux):   ./backup.sh [--solo-database]
# In ./backup (o BACKUP_DIR del .env): cde-<data>.sql.gz (pg_dump), documenti-<data>.tar (volume miniodata) e,
# in una cartella a parte, chiavi/CHIAVI-SEGRETE-<data>.tar (chiave master e chiave JWT: senza, i segreti MFA
# nel DB sono illeggibili; con il dump, permettono di firmare token per chiunque). Tutto con permessi 600/700.
# La cartella va copiata fuori dal server (NAS, backup aziendale), le chiavi in un posto diverso dal dump e
# cifrate (runbook § 5, "age"). Ripristino: ./ripristina.sh
set -euo pipefail
umask 077                      # file e cartelle nuovi leggibili solo da chi lancia il backup (M6)
cd "$(dirname "$0")"
dir=$(grep -E '^BACKUP_DIR=' .env | cut -d= -f2 | tr -d '\r'); dir=${dir:-./backup}
mkdir -p "$dir/chiavi"; dir=$(cd "$dir" && pwd)
chmod 700 "$dir" "$dir/chiavi"
ts=$(date +%Y%m%d-%H%M)

echo "Database..."
docker compose exec -T db sh -c 'pg_dump -U postgres -d cde --no-owner | gzip' > "$dir/cde-$ts.sql.gz"
chmod 600 "$dir/cde-$ts.sql.gz"
if [ "${1:-}" = "--solo-database" ]; then echo "Scritto $dir/cde-$ts.sql.gz"; exit 0; fi

echo "Documenti (volume miniodata)..."
docker run --rm -v skytower_miniodata:/data:ro -v "$dir:/backup" alpine tar cf "/backup/documenti-$ts.tar" -C /data .
echo "Chiavi (volume segreti) in $dir/chiavi..."
docker run --rm -v skytower_segreti:/segreti:ro -v "$dir/chiavi:/backup" alpine tar cf "/backup/CHIAVI-SEGRETE-$ts.tar" -C /segreti .
chmod 600 "$dir"/*-"$ts".* "$dir/chiavi/CHIAVI-SEGRETE-$ts.tar"
ls -lh "$dir"/*-"$ts".* "$dir/chiavi/CHIAVI-SEGRETE-$ts.tar"
