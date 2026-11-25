-- "><(((º> sabusabu <º)))><"
-- Giorno 22 (24/11/2026): allegato facoltativo alle assenze (risposta 3b). SQLite non aggiunge
-- chiavi esterne con ALTER TABLE: Prisma ricrea la tabella copiando tutte le righe.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Assenza" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dipendenteId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "dataInizio" TEXT NOT NULL,
    "dataFine" TEXT NOT NULL,
    "minutiPermesso" INTEGER,
    "stato" TEXT NOT NULL DEFAULT 'RICHIESTA',
    "noteDipendente" TEXT,
    "noteHr" TEXT,
    "protocolloCertificato" TEXT,
    "fileId" INTEGER,
    "decisoDaId" INTEGER,
    "decisoIl" DATETIME,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornatoIl" DATETIME NOT NULL,
    CONSTRAINT "Assenza_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assenza_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileCaricato" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Assenza_decisoDaId_fkey" FOREIGN KEY ("decisoDaId") REFERENCES "Utente" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Assenza" ("aggiornatoIl", "creatoIl", "dataFine", "dataInizio", "decisoDaId", "decisoIl", "dipendenteId", "id", "minutiPermesso", "noteDipendente", "noteHr", "protocolloCertificato", "stato", "tipo") SELECT "aggiornatoIl", "creatoIl", "dataFine", "dataInizio", "decisoDaId", "decisoIl", "dipendenteId", "id", "minutiPermesso", "noteDipendente", "noteHr", "protocolloCertificato", "stato", "tipo" FROM "Assenza";
DROP TABLE "Assenza";
ALTER TABLE "new_Assenza" RENAME TO "Assenza";
CREATE UNIQUE INDEX "Assenza_fileId_key" ON "Assenza"("fileId");
CREATE INDEX "Assenza_dipendenteId_dataInizio_idx" ON "Assenza"("dipendenteId", "dataInizio");
CREATE INDEX "Assenza_stato_idx" ON "Assenza"("stato");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

