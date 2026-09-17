# Giornata di test sul campo (giorno 25)

Da fare su device reali (1 iPhone/iPad + 1 Android) con build interne EAS
(`cd mobile && eas build --profile preview --platform all`, `EXPO_PUBLIC_API_URL`
dello staging in `eas.json`). Login demo: `field@fieldview.local` / `demo1234`
(operaio) e `manager@fieldview.local` (ufficio, sul web).

Legenda: ☐ da fare · ✅ ok · ❌ bug (aprire issue con passi + screenshot).
Gli scenari marcati **[auto]** hanno già un test automatico in
`mobile/test/sync.test.ts` che gira contro il backend reale.

## 1. Rete assente all'avvio
- ☐ Avvio in modalità aereo dopo un login precedente: si entra senza attese,
  la SyncBar mostra "Offline", progetti e planimetrie (scaricate) si aprono.
- ☐ Plan view offline: immagine dalla cache, pin, bottom sheet, nuovo pin con
  long-press (compare "1 in attesa" nella barra).
- ☐ Avvio in modalità aereo SENZA login precedente: il login fallisce con
  "Rete non disponibile" e non resta appeso.

## 2. Rete che cade a metà compilazione
- ☐ Iniziare un'ispezione, attivare la modalità aereo a metà, finire e salvare:
  "Modulo salvato · verrà inviato alla prossima sincronizzazione". **[auto]**
- ☐ Chiudere il form a metà, riaprirlo: "Bozza ripristinata" con foto e firma.
- ☐ Togliere la modalità aereo: entro pochi secondi la barra passa a
  "Sync hh:mm" e il web (manager) vede il modulo con le foto.

## 3. App uccisa con la coda piena
- ☐ 20 foto su un punch list in modalità aereo, uccidere l'app dallo switcher,
  riaprirla: la barra mostra ancora "N in attesa (20 foto)". **[auto]**
- ☐ Rete: tutte le foto salgono senza toccare nulla; i pin/task perdono la
  scritta "da caricare".

## 4. Due device sullo stesso pin
- ☐ Device A e B aprono lo stesso pin. A (offline) rinomina il pin; B (online)
  lo rinomina diversamente; A torna online: vince l'ultima modifica in ordine
  di tempo, l'altro device vede "1 problemi → Conflitto" nella barra. **[auto]**
- ☐ Stesso task: A lo risolve offline, B lo assegna dal web più tardi, A torna
  online: nessun duplicato, stato = quello del web, A vede il conflitto. **[auto]**

## 5. Cambio utente
- ☐ Esci con modifiche in attesa: l'app avvisa e propone "Sincronizza".
- ☐ Esci senza modifiche: i dati locali spariscono; login di un altro utente:
  vede solo i suoi progetti dopo il primo pull. **[auto]**

## 6. Background
- ☐ App in background per 20+ minuti con rete: al ritorno la barra mostra una
  sync recente senza aver toccato nulla (expo-background-task; su iOS il
  sistema decide quando, verificare almeno una volta).
- ☐ Cambio rete Wi-Fi → 4G: nessun errore in barra.

## 7. Foto e firma
- ☐ Foto da fotocamera in controluce/verticale: orientamento corretto sul web.
- ☐ Firma con il dito su tablet: visibile nel dettaglio modulo sul web.
- ☐ Foto da 12 MP: caricata in < 5 s su 4G (ridotta a 1600 px).

## 8. Da annotare
- Tempo del primo pull sul progetto reale (n. pin, n. foto).
- Consumo batteria percepito in una mezza giornata.
- Cose che gli utenti hanno cercato e non hanno trovato (input per il backlog).

## Build interne
```bash
cd mobile
npx eas login
npx eas build --profile preview --platform android   # APK installabile
npx eas build --profile preview --platform ios       # TestFlight (serve account Apple Developer)
```
