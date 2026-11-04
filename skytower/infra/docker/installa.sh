#!/usr/bin/env bash
# "><(((º> sabusabu <º)))><"
# Prima installazione di SkyTower sul server aziendale (Linux + Docker Engine con il plugin compose).
# Da questa cartella:   ./installa.sh
#
# Stessi passi di installa.ps1: .env con segreti generati, URL pubblici, token della suite, immagini,
# database/MinIO/antivirus, prepara_db.py con le password chieste a video (mai su file), avvio di tutto
# e smoke test. Rilanciarlo è innocuo: segreti e dati esistenti non vengono toccati.
set -euo pipefail
cd "$(dirname "$0")"

segreto() { head -c 32 /dev/urandom | base64 | tr -d '+/=\n' | cut -c1-40; }
leggi() { grep -E "^$1=" .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r'; }
scrivi() {   # scrivi CHIAVE VALORE: sostituisce la riga o la aggiunge in fondo
    if grep -qE "^$1=" .env; then sed -i "s#^$1=.*#$1=$2#" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
chiedi_pwd() { local p; read -r -s -p "$1: " p; echo >&2; printf '%s' "$p"; }

# ---- 1. Docker e .env ----
docker version >/dev/null
if [ ! -f .env ]; then
    cp .env.esempio .env
    for k in POSTGRES_PASSWORD DB_PWD_OWNER DB_PWD_APP DB_PWD_AUTH DB_PWD_WORKER MINIO_ROOT_PASSWORD S3_SEGRETO; do
        scrivi "$k" "$(segreto)"
    done
    chmod 600 .env
    echo "Creato .env con i segreti generati (non condividerlo, non metterlo in git)."
fi
mkdir -p backup certs

# ---- 2. Come lo raggiungono i colleghi ----
host0=$(leggi SKYTOWER_HOST); dom0=$(leggi SUITE_DOMINIO)
read -r -p "Nome o IP del server visto dai PC dei colleghi [$host0]: " hostsrv; hostsrv=${hostsrv:-$host0}
read -r -p "Dominio della suite dietro Caddy (vuoto = HTTP diretto in LAN) [$dom0]: " dominio; dominio=${dominio:-$dom0}
scrivi SKYTOWER_HOST "$hostsrv"; scrivi SUITE_DOMINIO "$dominio"
webporta=$(leggi WEB_PORTA); webporta=${webporta:-5195}
s3porta=$(leggi S3_PORTA); s3porta=${s3porta:-9100}
if [ -n "$dominio" ]; then
    scrivi WEB_ORIGIN "https://skytower.$dominio"
    scrivi S3_ENDPOINT_PUBBLICO "https://s3-skytower.$dominio"
    scrivi COOKIE_SECURE true
    scrivi SKYTOWER_HOST_PUBBLICO "skytower.$dominio"
    scrivi S3_HOST_PUBBLICO "s3-skytower.$dominio"
    ca=""
    for c in "$HOME/.local/share/caddy/pki/authorities/local/root.crt" /var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt; do
        [ -f "$c" ] && ca="$c" && break
    done
    if [ -n "$ca" ]; then cp "$ca" certs/root.crt; scrivi AWS_CA_BUNDLE /certs/root.crt; echo "Certificato radice di Caddy copiato in certs/root.crt"
    else echo "ATTENZIONE: copia root.crt del Caddy della suite in certs/root.crt e imposta AWS_CA_BUNDLE=/certs/root.crt nel .env"; fi
    echo "Ricorda nel Caddyfile della suite:  s3-skytower.$dominio { import suite; reverse_proxy 127.0.0.1:$s3porta }"
else
    scrivi WEB_ORIGIN "http://$hostsrv:$webporta"
    scrivi S3_ENDPOINT_PUBBLICO "http://$hostsrv:$s3porta"
    scrivi COOKIE_SECURE false
    scrivi SKYTOWER_HOST_PUBBLICO skytower.localhost
    scrivi S3_HOST_PUBBLICO s3-skytower.localhost
    scrivi AWS_CA_BUNDLE /etc/ssl/certs/ca-certificates.crt
    # B8 (revisione di sicurezza del 03/11/2026, ADR-49): in HTTP il cookie di sessione viaggia in chiaro
    echo "ATTENZIONE: installazione in HTTP sulla LAN (scelta temporanea). Le sessioni durano 12 ore invece di 14 giorni;"
    echo "            appena possibile reinstallare con SUITE_DOMINIO (Caddy con TLS)."
fi

# ---- 3. Token di servizio della suite ----
tokenfile=../../../shared/suite/.token
if [ -z "$(leggi SUITE_TOKEN)" ]; then
    if [ -f "$tokenfile" ]; then tok=$(tr -d '\r\n' < "$tokenfile")
    else tok=$(segreto); printf '%s\n' "$tok" > "$tokenfile"; chmod 600 "$tokenfile"; echo "Token di servizio creato in shared/suite/.token"; fi
    scrivi SUITE_TOKEN "$tok"
fi

# ---- 4. Immagini e servizi di base ----
docker compose build
docker compose up -d db minio minio-init clamav
docker compose wait minio-init >/dev/null || true

# ---- 5. Database, organizzazione, account (password a video, nascoste) ----
CDE_NUOVA_PWD=$(chiedi_pwd "Password del primo amministratore ($(leggi ADMIN_EMAIL); vuota = non crearlo ora)")
personale=$(leggi ACCOUNT_PERSONALE_EMAIL)
CDE_PWD_PERSONALE=""
[ -n "$personale" ] && CDE_PWD_PERSONALE=$(chiedi_pwd "Password dell'account personale $personale (vuota = non crearlo ora)")
CDE_NUOVA_PWD="$CDE_NUOVA_PWD" CDE_PWD_PERSONALE="$CDE_PWD_PERSONALE" docker compose --profile strumenti run --rm prepara
unset CDE_NUOVA_PWD CDE_PWD_PERSONALE

# ---- 6. Tutto su, smoke test ----
docker compose up -d
echo "Attendo l'API..."
for i in $(seq 1 60); do
    curl -fsS "http://127.0.0.1:$webporta/api/health" >/dev/null 2>&1 && break
    sleep 3
done
curl -fsS "http://127.0.0.1:$webporta/api/health" >/dev/null || { echo "L'API non risponde: docker compose logs api"; exit 1; }
if command -v python3 >/dev/null; then
    CDE_SMOKE_PASSWORD="" python3 ../smoke.py --api "http://127.0.0.1:$webporta/api" || true
else
    echo "python3 non trovato: smoke test saltato (health OK)."
fi
echo
echo "SkyTower pronto: $(leggi WEB_ORIGIN)   (API per le altre app: http://127.0.0.1:$(leggi API_PORTA)/health)"
echo "Vedi README § Rilascio sul server aziendale per Caddy della suite, portale e backup."
