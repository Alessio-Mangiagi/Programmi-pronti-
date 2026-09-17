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
- `src/sync/` — `pull.ts` (incrementale per progetto, upsert con LWW, conflitti in `sync_log`), `push.ts` (righe dirty → `/sync/push`, dirty azzerato solo se `updated_at` invariato, rifiuti in `sync_log`), `index.ts` (`syncAll`: mutex, push poi pull, errori raccolti), `time.ts`
- `src/screens/` — `LoginScreen`, `ProjectsScreen` (lista locale + pull-to-refresh + badge ⚠ problemi di sync), `PlansScreen`, `SyncIssuesScreen` (righe rifiutate: riprova/scarta; conflitti persi: presa visione)
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

Verifica senza simulatore: `npx expo export --platform android --no-bytecode` produce
il bundle (Metro risolve tutti i moduli, form-core compreso). L'avvio su simulatore
iOS/Android va fatto su una macchina con Xcode / Android Studio.
