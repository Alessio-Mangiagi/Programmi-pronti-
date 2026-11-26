-- "><(((º> sabusabu <º)))><"
-- Giorno 42 (26/11/2026): timbrature dei dipendenti, da confermare da HR.
-- CreateTable
CREATE TABLE "Timbratura" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dipendenteId" INTEGER NOT NULL,
    "progettoId" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "oraInizio" TEXT NOT NULL,
    "oraFine" TEXT,
    "stato" TEXT NOT NULL DEFAULT 'APERTA',
    "noteHr" TEXT,
    "decisoDa" TEXT,
    "decisoIl" DATETIME,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Timbratura_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Timbratura_progettoId_fkey" FOREIGN KEY ("progettoId") REFERENCES "Progetto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Timbratura_dipendenteId_stato_idx" ON "Timbratura"("dipendenteId", "stato");

-- CreateIndex
CREATE INDEX "Timbratura_stato_idx" ON "Timbratura"("stato");

