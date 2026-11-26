-- "><(((º> sabusabu <º)))><"
-- Giorno 38 (26/11/2026): quote annue e residuo di partenza per il saldo ferie e permessi.
-- CreateTable
CREATE TABLE "QuotaAssenze" (
    "dipendenteId" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ferieGiorniAnno" REAL NOT NULL,
    "permessiOreAnno" REAL NOT NULL,
    "contaDal" TEXT NOT NULL,
    "ferieIniziali" REAL NOT NULL DEFAULT 0,
    "permessiIniziali" REAL NOT NULL DEFAULT 0,
    "aggiornatoIl" DATETIME NOT NULL,
    CONSTRAINT "QuotaAssenze_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

