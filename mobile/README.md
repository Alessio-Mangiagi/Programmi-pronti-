# Field View — mobile

Expo (React Native, TypeScript) + expo-sqlite + drizzle. Un solo codebase iOS/Android,
offline-first: le schermate leggono sempre dal DB locale; il sync (giorno 17) lo
riempie e spedisce le modifiche fatte senza rete.

```bash
npm install
npm start              # Expo Go / dev client; a = Android, i = iOS
npm run typecheck      # tsc
npm test               # vitest in Node: DB su better-sqlite3 con le stesse migrazioni
```

Backend: `EXPO_PUBLIC_API_URL` (es. `.env` con `EXPO_PUBLIC_API_URL=http://192.168.1.10:8000`
per un telefono sulla stessa rete). Senza, l'emulatore Android usa `http://10.0.2.2:8000`
e il simulatore iOS `http://localhost:8000` (`src/config.ts`).

Struttura:
- `src/api/client.ts` — fetch + bearer, errori leggibili (`ApiError`)
- `src/auth/` — token in `expo-secure-store`, `AuthProvider` (`/auth/me` al riavvio, utente in cache per l'avvio offline, 401 → logout)
- `src/db/schema.ts` — tabelle drizzle: `projects, plans, form_templates, pins, form_submissions, tasks, attachments, users` + `sync_state`, `sync_log`; colonne extra `dirty`, `local_file_path`, `upload_attempts`
- `src/db/migrations.ts` — SQL a mano, versionate con `PRAGMA user_version`; `index.ts` apre il DB con expo-sqlite, `node.ts` con better-sqlite3 (test)
- `src/db/types.ts` — `AppDb`: tipo comune ai due driver, usato da sync/ e schermate
- `src/data/catalog.ts` — query di catalogo (progetti, planimetrie) e `refreshProjects`
- `src/data/mutations.ts` — scritture locali (`createPin`, `updateTask`, `createSubmission`, …): `updated_at` = adesso, `dirty = true`; `retryRejected`/`discardRejected` per le righe in `sync_log`
- `src/sync/files.ts` — cache immagini planimetrie (`cachePlanImages`: scarica in `plans/<id>.<ext>` se `local_file_for != updated_at`), `expoFileStore.ts` (expo-file-system `File`/`Directory`); nei test uno store in memoria
- `src/sync/` — `pull.ts` (incrementale per progetto, upsert con LWW, conflitti in `sync_log`), `push.ts` (righe dirty → `/sync/push`, dirty azzerato solo se `updated_at` invariato, rifiuti in `sync_log`), `index.ts` (`syncAll`: mutex, push poi pull, errori raccolti), `time.ts`
- `src/components/PlanViewer.tsx` — planimetria con pinch/pan/doppio tap (gesture-handler + reanimated), pin in coordinate relative riscalati 1/scale, long-press → coordinate 0-1
- `src/screens/` — `PlanScreen` (viewer + legenda + bottom sheet del pin: moduli, task, foto, rinomina, cancella; long-press = nuovo pin), `LoginScreen`, `ProjectsScreen` (lista locale + pull-to-refresh + badge ⚠ problemi di sync), `PlansScreen`, `SyncIssuesScreen` (righe rifiutate: riprova/scarta; conflitti persi: presa visione)
- `metro.config.js` — `watchFolders` per `packages/form-core` (dipendenza `file:`)

Sync: `syncAll(db, api)` fa prima il push di tutte le righe `dirty` (un solo batch,
il server smista per id) e poi `pullProject` per ogni progetto locale con
`since = sync_state.last_server_time`. Regole:
- riga remota assente in locale → insert; presente e non dirty → update se la remota
  è più recente **o pari** (il server valorizza `created_by` senza toccare `updated_at`);
- riga locale dirty più recente → resta e viene pushata; dirty più vecchia → vince la
  remota e la versione locale finisce in `sync_log` (`conflict_lost`);
- rifiuti del push (`rejected`) → `dirty = false` + `sync_log` (`rejected`, motivo):
  non vengono rispediti da soli; `retryRejected` (dopo la correzione) o `discardRejected`;
- cancellazioni: `deleted_at` locale + push; al pull la riga resta con `deleted_at`
  (le query filtrano `deleted_at IS NULL`).
`test/sync.test.ts` esegue tutto questo contro il backend reale avviato da
`scripts/e2e_server.py` (porta 8002, cartella `mobile/.e2e/`), incluso lo scenario
"stesso task modificato su web e app offline"; `test/sync-mock.test.ts` ripete le
regole contro un server finto in memoria (senza Python). Limite noto: LWW è per
riga, non per campo — se il web cambia la descrizione e l'app (più tardi) il titolo,
la riga dell'app vince e la descrizione torna a quella che l'app conosceva.

Offline: dopo una sync ogni piano con file ha `local_file_path` ("Disponibile offline"
nella lista) e la plan view userà quel file; senza rete progetti, planimetrie, pin,
moduli e task si leggono dal DB locale. La cache si aggiorna solo quando il piano
cambia sul server (`updated_at`), si riprova alla sync successiva se il download
fallisce, e viene tolta se il piano perde il file.

Verifica senza simulatore: `npx expo export --platform android --no-bytecode` produce
il bundle (Metro risolve tutti i moduli, form-core compreso). L'avvio su simulatore
iOS/Android va fatto su una macchina con Xcode / Android Studio.

Plan view: immagine da `local_file_path` se in cache, altrimenti dal server con
bearer nell'header; pin da `listPins` (conteggi task/moduli → colore come sul web);
long-press → `createPin` (dirty). `babel.config.js` usa `babel-preset-expo`, che
aggiunge da solo il plugin worklets di reanimated 4.
