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
- `src/screens/` — `LoginScreen`, `ProjectsScreen` (lista locale + pull-to-refresh), `PlansScreen`
- `metro.config.js` — `watchFolders` per `packages/form-core` (dipendenza `file:`)

Verifica senza simulatore: `npx expo export --platform android --no-bytecode` produce
il bundle (Metro risolve tutti i moduli, form-core compreso). L'avvio su simulatore
iOS/Android va fatto su una macchina con Xcode / Android Studio.
