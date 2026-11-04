<!-- "><(((º> sabusabu <º)))>< -->
# 9. Per l'amministratore di sistema

[← Indice](README.md)

Riferimento completo: [README](../../README.md) e [MODELLI-AI.md](../../MODELLI-AI.md).

**Avvio.** Dal Portale (`avvia.vbs`) o `avvia.bat`: compila il frontend se
serve (`dist/`), avvia il backend che serve la pagina e, se installato, Ollama.
Requisiti: Node.js 24+. Il report con grafici richiede il servizio Python in
`report-service/` (facoltativo: senza, Excel con sole tabelle).

**Accesso.** Doppio livello: login del Portale (gate SSO) e account propri di
Analista Dati (`AUTH_ENABLED=1`). Al primo avvio viene creato `admin` con
password da cambiare al primo accesso; in rete l'avvio è rifiutato se la
password predefinita è ancora attiva.

**Configurazione** (`.env`, modello in `.env.example`): `DEFAULT_LLM`
(`ollama` | `local` | `claude`), `OLLAMA_MODEL`, `LOCAL_LLM_BASE`,
`CLAUDE_DAILY_TOKEN_BUDGET`, `MASTER_PASSWORD` (cifratura delle connessioni
salvate e della chiave Claude), `SQLITE_ROOTS` e `XLSX_ROOTS` (cartelle da cui
si possono aprire file per percorso; vuote = disattivato), `DOCS_WATCH_DIR`
(cartella sorvegliata per l'archivio `@sorvegliati`), `SUITE_TOOLS`
(agente operativo).

**Sicurezza dei dati.** Collegare i database con un **utente di sola lettura**:
il controllo del programma è il secondo livello, non l'unico. Le colonne
sensibili si marcano dal programma (capitolo 6).

**Dati del programma.** `app.db` (utenti, connessioni cifrate, job, storico),
`secret.enc` (chiave Claude cifrata), `reports/` (Excel dei report
pianificati), `docsets/` (archivi di documenti), `agente.log` (registro).

**Backup.** `npm run backup` copia `app.db`, `secret.enc` e `.env` in una
cartella datata (`BACKUP_DIR`, ultime `BACKUP_KEEP`). Il backup contiene
`MASTER_PASSWORD` in chiaro: va conservato in un luogo protetto. Salvare anche
`docsets/` e `reports/` se servono.

[← Se qualcosa non va](08-problemi.md)
