-- "><(((º> sabusabu <º)))><"
-- Giorno 43 (26/11/2026): caposquadra di un progetto (segno sulla assegnazione).
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AssegnazioneProgetto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "progettoId" INTEGER NOT NULL,
    "dipendenteId" INTEGER NOT NULL,
    "caposquadra" BOOLEAN NOT NULL DEFAULT false,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssegnazioneProgetto_progettoId_fkey" FOREIGN KEY ("progettoId") REFERENCES "Progetto" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssegnazioneProgetto_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AssegnazioneProgetto" ("creatoIl", "dipendenteId", "id", "progettoId") SELECT "creatoIl", "dipendenteId", "id", "progettoId" FROM "AssegnazioneProgetto";
DROP TABLE "AssegnazioneProgetto";
ALTER TABLE "new_AssegnazioneProgetto" RENAME TO "AssegnazioneProgetto";
CREATE INDEX "AssegnazioneProgetto_dipendenteId_idx" ON "AssegnazioneProgetto"("dipendenteId");
CREATE UNIQUE INDEX "AssegnazioneProgetto_progettoId_dipendenteId_key" ON "AssegnazioneProgetto"("progettoId", "dipendenteId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

