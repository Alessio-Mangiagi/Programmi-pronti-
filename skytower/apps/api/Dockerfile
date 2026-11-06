# "><(((º> sabusabu <º)))><"
# Immagine unica per API, worker e migrazioni (ECS: infra/terraform/envs/prod/ecs.tf).
# Build dalla cartella skytower/:  docker build -f apps/api/Dockerfile -t cde-api .
# Il sorgente resta in /app con la struttura del repo: dbadmin trova db/migrations da lì.

FROM python:3.12-slim-bookworm AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
RUN python -m venv /opt/venv
ENV PATH=/opt/venv/bin:$PATH
COPY apps/api/requirements.lock apps/api/requirements.lock
RUN pip install -r apps/api/requirements.lock
COPY packages/iso19650 packages/iso19650
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/api/cde_api apps/api/cde_api
COPY db/migrations db/migrations
RUN pip install --no-deps ./packages/iso19650 && pip install --no-deps -e ./apps/api
# Motore della firma digitale .p7m (ADR-55): il codice sta in /shared/firma (cartella shared della suite montata dal
# compose), le sue librerie qui, nello stesso venv; FIRMA_PYTHON (sotto) dice al client busta.py di usare questo
# Python invece di shared/firma/.venv (che sul server è quello di Windows). Versioni = shared/firma/requirements.txt.
RUN pip install pyhanko-certvalidator==0.33.0 asn1crypto==1.5.1 requests==2.34.2

FROM python:3.12-slim-bookworm
ENV PATH=/opt/venv/bin:$PATH \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CDE_ENV=prod \
    FIRMA_PYTHON=/opt/venv/bin/python \
    FIRMA_CACHE_DIR=/tmp/firma-elenchi \
    PGSSLROOTCERT=/etc/ssl/rds-global-bundle.pem
# CA di RDS: i DSN usano sslmode=verify-full (certificato e nome host verificati)
ADD --chmod=444 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/rds-global-bundle.pem
# Tesseract (italiano): OCR delle pagine scansionate dei PDF per la ricerca nel contenuto (ADR-33)
RUN apt-get update && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ita \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin cde
COPY --from=build /opt/venv /opt/venv
COPY --from=build /app /app
WORKDIR /app/apps/api
USER 10001
EXPOSE 8000
# IP del client: header CloudFront-Viewer-Address (CDE_CLIENT_IP_HEADER), non X-Forwarded-For.
CMD ["uvicorn", "cde_api.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", \
     "--no-server-header", "--timeout-graceful-shutdown", "20"]
