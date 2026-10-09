# Report worker (Python)

<!-- "><(((º> sabusabu <º)))><" -->

Servizio **opzionale** che genera gli elaborati Excel dove Python vince rispetto a SheetJS:

- **grafici nativi** nel `.xlsx` (barre / linea, auto-scelti)
- intestazioni formattate, **autofilter**, **freeze pane**, larghezze colonna
- foglio **Riepilogo** con indice

Il backend TS (`server/report.ts`) lo chiama via HTTP. **Se è spento, ripiega su SheetJS** (solo tabelle) — l'app funziona comunque.

## Avvio

Windows:
```bat
report-service\avvia.bat
```

Manuale (qualsiasi OS):
```bash
cd report-service
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Linux/Mac: .venv/bin/pip
.venv/Scripts/python -m uvicorn app:app --host 127.0.0.1 --port 8000
```

## Config (lato backend TS, in `.env`)

| Variabile | Default | Note |
|-----------|---------|------|
| `PYREPORT_URL` | http://localhost:8000 | URL del worker. Vuoto/non raggiungibile → fallback SheetJS |
| `PYREPORT_TIMEOUT_MS` | 60000 | timeout richiesta build |

## API

- `GET /health` → `{ ok, engine }`
- `POST /build` → riceve `{ title, dbKind, sections:[{title,columns,rows,sql,error,truncated,rowCount}] }`, ritorna il binario `.xlsx`.
