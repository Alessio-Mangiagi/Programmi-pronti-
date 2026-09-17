# Field View — web

Vite + React + TypeScript. Chiama l'API sempre su `/api/...`: in sviluppo il
proxy di Vite inoltra a uvicorn (default `http://localhost:8000`, override con
`VITE_API_PROXY`), in produzione FastAPI monta l'API sotto `/api` e serve `dist/`.

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # tsc + vite build -> dist/
npm run api:types      # rigenera src/api/schema.d.ts da openapi.json
npm run e2e            # smoke test Playwright (vedi sotto)
```

`openapi.json` si aggiorna dal backend con `python -m scripts.export_openapi`
(dalla root). Da rifare ogni volta che cambiano gli endpoint, poi `npm run api:types`.

Struttura:
- `src/api/` — client `openapi-fetch` tipizzato (`client.ts`), alias tipi (`types.ts`), upload con progresso via XHR (`upload.ts`)
- `src/auth/` — token in localStorage, `AuthProvider` (`useAuth`), redirect al login su 401
- `src/components/` — `Layout` (sidebar + outlet), `Toast` (`ToastProvider`/`useToast`, notifiche in basso), `Loading` (spinner), `AuthImage`, `PlanViewer` (pan/zoom + overlay pin, modalità aggiungi), `PinMarker` (drag), `PinPanel` (dettaglio pin), `PlanUploadForm` (nuova planimetria / file mancante), `PinFilters` (barra filtri ↔ query string)
- `src/hooks/` — `useProject`, `useAuthBlobUrl` (file da `/files` con bearer → object URL), `useLookups` (utenti/template per id)
- `src/pages/` — `LoginPage`, `ProjectsPage`, `PlansPage`, `PlanPage`
- `src/forms/` — `DynamicForm` (un controllo per tipo di campo, errori inline tradotti), `fields/` (`PhotoInput`, `SignatureInput`, `GeolocationInput`), `SubmissionForm` (scelta template → compila → salva), `attachments.ts` (foto/firme locali come File + object URL)
- `src/components/Modal.tsx` — modale con Esc/click fuori; `body[data-modal-open]` dice alla plan view di ignorare Esc

Plan view: l'immagine è resa a dimensione nativa dentro `react-zoom-pan-pinch`;
i pin sono posizionati in % (x/y relativi 0-1) e scalati di `1/zoom` così restano
della stessa dimensione a schermo. Colore = stato peggiore tra i task del pin
(aperto > assegnato > risolto > verificato > solo moduli > vuoto), da `GET /plans/{id}/pins`.
Interazioni: click pin → pannello (`GET /pins/{id}`); "+ Aggiungi pin" → click sulla
planimetria → `POST /pins`; drag del marker → `PATCH /pins/{id}` (la classe `pin` è
esclusa dal panning); rinomina dal titolo del pannello; "Cancella pin" → `DELETE`
(cascata soft su moduli/task/foto). Esc chiude modalità aggiungi o pannello.

Upload planimetria (solo `admin`/`manager`): da "Planimetrie" → "+ Nuova planimetria"
(nome + PNG/JPG/PDF, max 20 MB, anteprima locale per le immagini, barra di avanzamento)
→ `POST /plans` + `POST /plans/{id}/file` → si apre subito la plan view. Una planimetria
senza file mostra lo stesso form al posto del viewer (per `field` solo un avviso).

Filtri pin (barra sotto la topbar): stato task (chip multipli), modulo, assegnatario
(membri del progetto), intervallo date di creazione. Vivono nella query string
(`?status=open&status=assigned&template=…&assignee=…&from=…&to=…`), quindi un link
filtrato si condivide e il filtro sopravvive al cambio planimetria dal selettore in
topbar (nessun reload: `PlanPage` rimonta `PlanView` con `key={planId}`). La logica è
lato server (`GET /plans/{id}/pins?…`); la legenda conta i pin mostrati, il riepilogo
"N di M pin" i totali. Creare un pin con un filtro attivo azzera il filtro (il pin
nuovo è vuoto e non lo passerebbe).

Errori: i form (login, upload) mostrano l'errore inline; tutte le altre azioni
(crea/sposta/cancella pin, rinomina, caricamento pin) passano da `useToast()`.
Un 401 su qualsiasi chiamata mostra "Sessione scaduta" e riporta al login.

Responsive: sotto 1024px la sidebar diventa una barra in alto; sotto 900px il
pannello pin è un foglio in basso (45% dell'altezza) così la planimetria resta
larga anche su tablet in verticale.

Smoke test (`e2e/smoke.spec.ts`, `playwright.config.ts`): il `webServer` fa
`npm run build` e lancia `python -m scripts.e2e_server --port 8001`, che crea
`web/.e2e/` (SQLite + storage), applica le migrazioni, esegue il seed demo e
serve API + `dist` con `app.server` — quindi il test copre anche il deploy unico.
Python: `.venv` del progetto se esiste, altrimenti `PYTHON` o `python` nel PATH.
Prima volta: `npx playwright install chromium`.

Moduli dinamici: dal pannello pin "+ Compila modulo" apre `SubmissionForm` in una
modale. Lo stato del form parte da `defaults(schema)` (form-core); la validazione
è `validateSubmission` — identica al server — eseguita al primo "Salva" e poi live,
con messaggi tradotti in `DynamicForm.translateMessage`. Foto e firma non viaggiano
in `data_json`: `PhotoInput`/`SignatureInput` creano un `LocalAttachment` (UUID +
File + object URL) e mettono l'UUID nel valore del campo; al salvataggio si fa
`POST /submissions`, poi per ogni allegato `POST /attachments` con lo stesso `id` e
`POST /attachments/{id}/upload`. La firma è un canvas (pointer events, `touch-action:
none`) esportato in PNG al rilascio di ogni tratto. La geolocalizzazione usa
`navigator.geolocation` con lat/lng manuali come ripiego. `readOnly` rende gli
stessi controlli disabilitati con gli allegati remoti (`RemoteAttachment`, via
`AuthImage`) — è la base del dettaglio submission del giorno 13.
