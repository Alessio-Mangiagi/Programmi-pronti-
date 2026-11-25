-- "><(((º> sabusabu <º)))><"
-- Giorno 35 (25/11/2026): stato a scadenza, tentativi di accesso e contenuto dei file nel
-- database, per far girare Logbook anche dove memoria e disco non durano (Vercel).
-- CreateTable
CREATE TABLE "StatoTemporaneo" (
    "chiave" TEXT NOT NULL PRIMARY KEY,
    "valore" TEXT NOT NULL,
    "scadeIl" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TentativoAccesso" (
    "chiave" TEXT NOT NULL PRIMARY KEY,
    "conta" INTEGER NOT NULL DEFAULT 0,
    "livello" INTEGER NOT NULL DEFAULT 0,
    "bloccatoFino" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimo" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ContenutoFile" (
    "nomeDisco" TEXT NOT NULL PRIMARY KEY,
    "dati" BLOB NOT NULL,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "StatoTemporaneo_scadeIl_idx" ON "StatoTemporaneo"("scadeIl");

