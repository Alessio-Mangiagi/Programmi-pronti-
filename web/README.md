# Field View — web

Vite + React + TypeScript. Chiama l'API sempre su `/api/...`: in sviluppo il
proxy di Vite inoltra a uvicorn (default `http://localhost:8000`, override con
`VITE_API_PROXY`), in produzione FastAPI monta l'API sotto `/api` e serve `dist/`.

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # tsc + vite build -> dist/
npm run api:types      # rigenera src/api/schema.d.ts da openapi.json
```

`openapi.json` si aggiorna dal backend con `python -m scripts.export_openapi`
(dalla root). Da rifare ogni volta che cambiano gli endpoint, poi `npm run api:types`.

Struttura:
- `src/api/` — client `openapi-fetch` tipizzato (`client.ts`), alias tipi (`types.ts`)
- `src/auth/` — token in localStorage, `AuthProvider` (`useAuth`), redirect al login su 401
- `src/components/` — `Layout` (sidebar + outlet), `AuthImage` (immagini da `/files` con bearer)
- `src/pages/` — `LoginPage`, `ProjectsPage`, `PlansPage`
