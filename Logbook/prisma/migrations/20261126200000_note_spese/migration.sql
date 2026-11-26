-- "><(((º> sabusabu <º)))><"
-- Giorno 45 (26/11/2026): note spese dei dipendenti con scontrino allegato.
-- CreateTable
CREATE TABLE "NotaSpesa" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dipendenteId" INTEGER NOT NULL,
    "progettoId" INTEGER,
    "data" TEXT NOT NULL,
    "categoria" TEXT NOT NULL,
    "importoCent" INTEGER NOT NULL,
    "descrizione" TEXT NOT NULL,
    "fileId" INTEGER,
    "stato" TEXT NOT NULL DEFAULT 'RICHIESTA',
    "noteHr" TEXT,
    "decisoDa" TEXT,
    "decisoIl" DATETIME,
    "rimborsataIl" DATETIME,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotaSpesa_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "NotaSpesa_progettoId_fkey" FOREIGN KEY ("progettoId") REFERENCES "Progetto" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "NotaSpesa_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileCaricato" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "NotaSpesa_fileId_key" ON "NotaSpesa"("fileId");

-- CreateIndex
CREATE INDEX "NotaSpesa_dipendenteId_stato_idx" ON "NotaSpesa"("dipendenteId", "stato");

-- CreateIndex
CREATE INDEX "NotaSpesa_stato_idx" ON "NotaSpesa"("stato");

