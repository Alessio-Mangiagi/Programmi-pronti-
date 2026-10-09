# Immagine unica: build del frontend, poi API Python che serve anche web/dist.
FROM node:22-alpine AS web
WORKDIR /src
# packages/form-core è una dipendenza `file:` di web: deve esistere prima di npm ci
COPY packages/form-core packages/form-core
COPY web/package.json web/package-lock.json web/
RUN cd web && npm ci
COPY web web
RUN cd web && npm run build

FROM python:3.12-slim
WORKDIR /srv
# APP_ENV=production: l'app non parte senza una SECRET_KEY vera (vedi app/auth.py)
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 STORAGE_DIR=/data/storage APP_ENV=production
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app app
COPY alembic alembic
COPY alembic.ini .
COPY scripts scripts
COPY --from=web /src/web/dist web/dist
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,os; urllib.request.urlopen(f'http://127.0.0.1:{os.getenv(\"PORT\",\"8000\")}/api/healthz', timeout=4)"
CMD ["sh", "scripts/entrypoint.sh"]
