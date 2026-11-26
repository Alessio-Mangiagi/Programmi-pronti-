-- "><(((º> sabusabu <º)))><"
-- Giorno 37 (26/11/2026): tabella dei mesi chiusi da HR (chiusura del mese).
-- CreateTable
CREATE TABLE "MeseChiuso" (
    "mese" TEXT NOT NULL PRIMARY KEY,
    "chiusoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chiusoDa" TEXT NOT NULL
);

