-- "><(((º> sabusabu <º)))><"
-- Giorno 24 (24/11/2026, risposta 1a): password provvisoria da cambiare al primo accesso.
-- Le righe esistenti partono da false: all'avvio scripts/prepara-db.ts segna gli account
-- che hanno ancora una password pubblicata (admin di prova, account di esempio).
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Utente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "ruolo" TEXT NOT NULL DEFAULT 'DIPENDENTE',
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "passwordDaCambiare" BOOLEAN NOT NULL DEFAULT false,
    "dipendenteId" INTEGER,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornatoIl" DATETIME NOT NULL,
    CONSTRAINT "Utente_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Utente" ("aggiornatoIl", "attivo", "creatoIl", "dipendenteId", "id", "passwordHash", "ruolo", "username") SELECT "aggiornatoIl", "attivo", "creatoIl", "dipendenteId", "id", "passwordHash", "ruolo", "username" FROM "Utente";
DROP TABLE "Utente";
ALTER TABLE "new_Utente" RENAME TO "Utente";
CREATE UNIQUE INDEX "Utente_username_key" ON "Utente"("username");
CREATE UNIQUE INDEX "Utente_dipendenteId_key" ON "Utente"("dipendenteId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

