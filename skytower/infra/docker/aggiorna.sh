#!/usr/bin/env bash
# "><(((º> sabusabu <º)))><"
# Aggiornamento di SkyTower sul server (Linux) senza perdere dati: nuove immagini dal codice corrente,
# backup, migrazioni (prima del nuovo codice: devono restare compatibili), riavvio di api/worker/web.
#   ./aggiorna.sh              costruisce e passa al commit corrente
#   ./aggiorna.sh <tag>        torna a immagini già costruite (rollback; le migrazioni non si annullano)
set -euo pipefail
cd "$(dirname "$0")"
versione=${1:-}
scrivi() { if grep -qE "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }

if [ -z "$versione" ]; then
    versione=$(git -C ../../.. rev-parse --short HEAD 2>/dev/null || date +%Y%m%d-%H%M)
    scrivi SKYTOWER_VERSIONE "$versione"
    echo "Costruisco le immagini $versione..."
    docker compose build --pull
else
    echo "Torno alla versione $versione (immagini già presenti)..."
    scrivi SKYTOWER_VERSIONE "$versione"
fi

echo "Backup del database prima delle migrazioni..."
./backup.sh --solo-database

echo "Migrazioni..."
docker compose --profile strumenti run --rm migrate

echo "Riavvio di api, worker e web..."
docker compose up -d --no-deps api worker web
webporta=$(grep -E '^WEB_PORTA=' .env | cut -d= -f2 | tr -d '\r'); webporta=${webporta:-5195}
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$webporta/api/health" >/dev/null 2>&1 && break; sleep 3; done
curl -fsS "http://127.0.0.1:$webporta/api/health" >/dev/null && echo "Aggiornato alla versione $versione, API in salute." \
    || { echo "L'API non risponde: docker compose logs api"; exit 1; }
docker image prune -f >/dev/null
