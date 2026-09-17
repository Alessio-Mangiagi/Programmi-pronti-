# Immagine unica: build del frontend, poi API Python che serve anche web/dist.
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
WORKDIR /srv
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 STORAGE_DIR=/data/storage
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app app
COPY alembic alembic
COPY alembic.ini .
COPY scripts scripts
COPY --from=web /web/dist web/dist
VOLUME /data
EXPOSE 8000
CMD ["sh", "scripts/entrypoint.sh"]
