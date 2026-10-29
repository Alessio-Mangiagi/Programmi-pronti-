<!-- "><(((º> sabusabu <º)))><" -->
# Attivare OnlyOffice in SkyTower (modifica di Word, Excel e PowerPoint)

Con OnlyOffice attivo, i documenti Word, Excel e PowerPoint si modificano direttamente nel browser. Al salvataggio,
il file modificato diventa la revisione WIP successiva, per esempio P01.02 → P01.03.

## Stato al 29/10/2026

| Componente | Stato |
|---|---|
| Docker Desktop 4.97.0 | installato |
| WSL2 (serve a Docker) | **da installare**: la richiesta di amministratore è stata annullata |
| Avvio automatico del Document Server | pronto (`skytower\onlyoffice.bat`, chiamato da `avvia.bat`) |
| Prova dal vivo | da fare dopo l'installazione di WSL2 |

## Cosa fare (una volta sola)

1. Aprire **PowerShell come amministratore** e lanciare:
   ```
   wsl --install --no-distribution
   ```
2. **Riavviare** il PC.
3. Aprire **Docker Desktop** una volta e accettare la licenza.
4. Avviare SkyTower come sempre con `Avvia SkyTower.bat`.

## Cosa succede all'avvio

- `onlyoffice.bat` crea il container `skytower-onlyoffice` (immagine `onlyoffice/documentserver`) sulla porta
  **8085**, raggiungibile solo dal PC.
  - La prima volta scarica circa 1 GB.
  - Il server impiega 1-2 minuti a partire.
- Il segreto condiviso tra SkyTower e il Document Server viene generato al primo avvio in
  `skytower\.devdata\onlyoffice.secret`. Git lo ignora: non finisce mai nel repository.
- All'API arrivano tre variabili:

  | Variabile | Valore |
  |---|---|
  | `CDE_ONLYOFFICE_URL` | `http://127.0.0.1:8085` (il browser apre l'editor qui) |
  | `CDE_ONLYOFFICE_JWT_SECRET` | il segreto di `.devdata` |
  | `CDE_ONLYOFFICE_CALLBACK_URL` | `http://host.docker.internal:8100` (il Document Server raggiunge l'API sul PC) |

- Se Docker manca o è spento, SkyTower parte comunque e il pulsante di modifica non compare. Con Docker installato
  ma spento, la finestra di avvio mostra un avviso.

## Comandi utili

```
docker ps --filter name=skytower-onlyoffice     # il container è acceso?
docker logs -f skytower-onlyoffice              # log del Document Server
docker rm -f skytower-onlyoffice                # da ricreare (es. segreto cambiato): lo rifà l'avvio successivo
```

## Riferimenti

- ADR-37 in `skytower\docs\adr.md`: scelta di OnlyOffice e flusso di salvataggio.
- `skytower\apps\api\cde_api\modules\office.py`: endpoint per l'editor e callback di salvataggio.
- Test: `apps\api\tests\test_api_office.py` ed e2e `onlyoffice.spec.ts`, con un Document Server finto.
