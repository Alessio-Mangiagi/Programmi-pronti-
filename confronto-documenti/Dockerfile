# "><(((º> sabusabu <º)))><"
# Confronto Documenti in un container: Python + Tesseract (italiano e
# inglese), pronto per un server cloud (Render, Railway, Fly.io, una VM con
# Docker) o un server d'ufficio Linux.
#
#   docker build -t confronto-documenti .
#   docker run -p 8080:8080 -v confronto-dati:/data \
#       -e CONFRONTO_PASSWORD=una-password-lunga confronto-documenti
#
# Il contesto di build è questa cartella: l'app gira da sola, senza il login
# del portale (COSEDIL_SSO=off). Online va sempre dietro HTTPS (lo danno i
# servizi cloud) e con CONFRONTO_PASSWORD impostata. Vedi INSTALLAZIONE.md.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-ita tesseract-ocr-eng \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY confronta_pdf.py server.py storico.py ./
COPY ui ./ui

# Utente senza privilegi; i dati scrivibili (cache OCR, storico) stanno in
# /data, da montare come volume per non perderli a ogni aggiornamento.
RUN useradd --create-home --uid 10001 confronto \
 && mkdir -p /data && chown confronto:confronto /data
USER confronto

ENV HOST=0.0.0.0 \
    PORT=8080 \
    COSEDIL_SSO=off \
    CONFRONTO_DATI=/data \
    CONFRONTO_MAX_PARALLELI=2 \
    PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import os,urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ['PORT'] + '/healthz', timeout=4)" || exit 1

CMD ["python", "-W", "ignore", "server.py"]
