# Retrospettiva MVP (30 giorni) e backlog prioritizzato

Sviluppo: 1 sviluppatore + Claude, 2026-09-14 → 2026-09-17 (giorni 1-30 del piano,
eseguiti in sequenza; vedi `ROADMAP.md` per le DoD giorno per giorno).

## Cosa ha funzionato
- **Un protocollo di sync solo, testato contro il backend vero.** Il motore mobile
  gira in Node (drizzle su better-sqlite3, stesse migrazioni) contro
  `scripts/e2e_server.py`: LWW, rifiuti, conflitti, coda upload, "app uccisa",
  cambio utente sono test ripetibili, non scenari da provare a mano.
- **`packages/form-core` con parità meccanica.** Le fixture generate dal validatore
  Python fanno fallire la CI se web/mobile divergono dal server.
- **Deploy unico** (API `/api` + `web/dist`) e smoke test Playwright sulla build di
  produzione: ogni giornata ha chiuso con un e2e verde.
- **Outbox eventi nella transazione**: notifiche identiche da web e da sync push.

## Cosa non è stato verificato (da fare prima del rilascio)
- **App su simulatore/device**: nessun simulatore su questa macchina. Verificati tsc,
  vitest e bundle Metro; gesture, camera, firma, GPS, background task e push vanno
  provati con una dev build (checklist in `docs/test-sul-campo.md`).
- **Docker/Postgres in locale**: compose e Dockerfile scritti, CI su Postgres verde,
  ma `docker compose up` non eseguito qui.
- **SMTP ed Expo Push reali**: sender testati con finti + payload; servono credenziali.
- **Build EAS** e distribuzione agli utenti della discovery (giorno 25/30).

## Debiti tecnici noti
- LWW a livello di riga (campo perso se due device toccano campi diversi).
- `fieldview.db` committato con schema vecchio: rimuoverlo dall'indice (`git rm --cached`).
- Lint web: warning "set-state-in-effect"/"only-export-components" accettati.
- Vista task e filtri pin client-side: paginazione server oltre le migliaia di righe.
- I file di S3 passano dall'API (`/files`): presigned URL diretti per alleggerire.

## Backlog prioritizzato
1. **Giornata sul campo + build EAS** (bloccante per il rilascio).
2. **Conflitti per campo** o `version` incrementale con risoluzione manuale.
3. **Export PDF** della submission (report ispezione firmato) e CSV task.
4. **Notifiche in-app** (badge, lista) e digest giornaliero email.
5. **Presigned URL S3** per foto/planimetrie (meno carico sull'API).
6. **Form builder**: drag&drop, logica condizionale (mostra X se Y = …).
7. **Ruoli per progetto** e permessi per modulo.
8. **Pin su più pagine PDF / livelli**; clustering pin per planimetrie enormi.
9. **Paginazione server** su task e pin; ricerca testuale.
10. Rimozione automatica dei file locali già caricati (spazio sul device).
