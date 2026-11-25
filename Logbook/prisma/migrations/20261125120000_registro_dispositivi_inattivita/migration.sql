-- "><(((º> sabusabu <º)))><"
-- Giorno 34 (25/11/2026): sessioni che si chiudono dopo 15 minuti di inattivita (ultimoUsoIl),
-- PC fidati per il codice via email degli amministratori, registro delle attivita.
-- CreateTable
CREATE TABLE "DispositivoFidato" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "utenteId" INTEGER NOT NULL,
    "scadeIl" DATETIME NOT NULL,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DispositivoFidato_utenteId_fkey" FOREIGN KEY ("utenteId") REFERENCES "Utente" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RegistroAttivita" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "quando" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "utenteId" INTEGER,
    "username" TEXT NOT NULL,
    "azione" TEXT NOT NULL,
    "dettaglio" TEXT,
    "esito" TEXT NOT NULL DEFAULT 'OK',
    "ip" TEXT
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Sessione" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "utenteId" INTEGER NOT NULL,
    "scadeIl" DATETIME NOT NULL,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimoUsoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Sessione_utenteId_fkey" FOREIGN KEY ("utenteId") REFERENCES "Utente" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Sessione" ("creatoIl", "id", "scadeIl", "utenteId") SELECT "creatoIl", "id", "scadeIl", "utenteId" FROM "Sessione";
DROP TABLE "Sessione";
ALTER TABLE "new_Sessione" RENAME TO "Sessione";
CREATE INDEX "Sessione_utenteId_idx" ON "Sessione"("utenteId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "DispositivoFidato_utenteId_idx" ON "DispositivoFidato"("utenteId");

-- CreateIndex
CREATE INDEX "RegistroAttivita_quando_idx" ON "RegistroAttivita"("quando");

