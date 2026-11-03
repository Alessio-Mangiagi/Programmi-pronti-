#!/usr/bin/env bash
# "><(((º> sabusabu <º)))><"
# Ripristino di SkyTower da un backup (Linux):
#   ./ripristina.sh backup/cde-20261103-0300.sql.gz [backup/documenti-....tar] [backup/segreti-....tar]
# Sostituisce il database (e, se dati, documenti e chiavi) con il backup: usare file della stessa data,
# altrimenti DB e S3 non si corrispondono. Ferma api/worker, ricrea `cde` dal dump, riavvia tutto.
set -euo pipefail
cd "$(dirname "$0")"
db=${1:?uso: ripristina.sh <cde-*.sql.gz> [documenti-*.tar] [segreti-*.tar]}; doc=${2:-}; seg=${3:-}
for f in "$db" "$doc" "$seg"; do [ -z "$f" ] || [ -f "$f" ] || { echo "File non trovato: $f"; exit 1; }; done
read -r -p "Sostituisco il database${doc:+, i documenti}${seg:+, le chiavi} con il backup. Scrivi SI per continuare: " ok
[ "$ok" = "SI" ] || exit 1

echo "Fermo api e worker..."
docker compose stop api worker backup
echo "Database dal dump..."
docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS cde WITH (FORCE)" -c "CREATE DATABASE cde OWNER cde_owner" >/dev/null
docker compose exec -T db sh -c 'gunzip | psql -U postgres -d cde -q -v ON_ERROR_STOP=1' < "$db" >/dev/null
docker compose exec -T db psql -U postgres -d cde -v ON_ERROR_STOP=1 -c "REASSIGN OWNED BY postgres TO cde_owner" >/dev/null

if [ -n "$doc" ]; then
    echo "Documenti nel volume miniodata..."
    docker compose stop minio
    docker run --rm -v skytower_miniodata:/data -v "$(cd "$(dirname "$doc")" && pwd)/$(basename "$doc"):/backup.tar:ro" alpine \
        sh -c 'rm -rf /data/* /data/.minio.sys && tar xf /backup.tar -C /data'
    docker compose start minio
fi
if [ -n "$seg" ]; then
    echo "Chiavi nel volume segreti..."
    docker run --rm -v skytower_segreti:/segreti -v "$(cd "$(dirname "$seg")" && pwd)/$(basename "$seg"):/backup.tar:ro" alpine \
        sh -c 'rm -rf /segreti/* && tar xf /backup.tar -C /segreti && chown -R 10001:10001 /segreti'
fi
echo "Riavvio..."
docker compose up -d
echo "Ripristino completato. Controlla con: docker compose logs -f api"
