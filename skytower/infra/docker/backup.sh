#!/usr/bin/env bash
# "><(((º> sabusabu <º)))><"
# Backup di SkyTower sul server (Linux):   ./backup.sh [--solo-database]
# In ./backup (o BACKUP_DIR del .env): cde-<data>.sql.gz (pg_dump), documenti-<data>.tar (volume miniodata),
# segreti-<data>.tar (chiave master e JWT: senza, i segreti MFA nel DB sono illeggibili).
# La cartella va copiata fuori dal server (NAS, backup aziendale). Ripristino: ./ripristina.sh
set -euo pipefail
cd "$(dirname "$0")"
dir=$(grep -E '^BACKUP_DIR=' .env | cut -d= -f2 | tr -d '\r'); dir=${dir:-./backup}
mkdir -p "$dir"; dir=$(cd "$dir" && pwd)
ts=$(date +%Y%m%d-%H%M)

echo "Database..."
docker compose exec -T db sh -c 'pg_dump -U postgres -d cde --no-owner | gzip' > "$dir/cde-$ts.sql.gz"
if [ "${1:-}" = "--solo-database" ]; then echo "Scritto $dir/cde-$ts.sql.gz"; exit 0; fi

echo "Documenti (volume miniodata)..."
docker run --rm -v skytower_miniodata:/data:ro -v "$dir:/backup" alpine tar cf "/backup/documenti-$ts.tar" -C /data .
echo "Segreti (volume segreti)..."
docker run --rm -v skytower_segreti:/segreti:ro -v "$dir:/backup" alpine tar cf "/backup/segreti-$ts.tar" -C /segreti .
ls -lh "$dir"/*-"$ts".*
