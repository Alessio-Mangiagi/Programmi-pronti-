-- "><(((º> sabusabu <º)))><"
-- Giorno 15 (24/11/2026): file caricati, attestati (1c), documenti del dipendente,
-- documentazione di avanzamento dei progetti (2c, 3c), note dei progetti, impostazioni
-- (collegamento a SkyTower). Solo tabelle e colonne nuove: nessun dato esistente cambia.
-- Generata con "prisma migrate diff" dallo schema del Giorno 14 a quello nuovo.

-- AlterTable
ALTER TABLE "Progetto" ADD COLUMN "commessaSkytower" TEXT;
ALTER TABLE "Progetto" ADD COLUMN "descrizione" TEXT;

-- CreateTable
CREATE TABLE "FileCaricato" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nomeDisco" TEXT NOT NULL,
    "nomeOriginale" TEXT NOT NULL,
    "tipoMime" TEXT NOT NULL,
    "dimensione" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "caricatoDaId" INTEGER NOT NULL,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileCaricato_caricatoDaId_fkey" FOREIGN KEY ("caricatoDaId") REFERENCES "Utente" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Attestato" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dipendenteId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "dataRilascio" TEXT NOT NULL,
    "dataScadenza" TEXT,
    "note" TEXT,
    "fileId" INTEGER,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornatoIl" DATETIME NOT NULL,
    CONSTRAINT "Attestato_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Attestato_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileCaricato" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentoDipendente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dipendenteId" INTEGER NOT NULL,
    "titolo" TEXT NOT NULL,
    "note" TEXT,
    "fileId" INTEGER NOT NULL,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentoDipendente_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DocumentoDipendente_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileCaricato" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentoProgetto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "progettoId" INTEGER NOT NULL,
    "autoreId" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "titolo" TEXT NOT NULL,
    "nota" TEXT,
    "percentuale" INTEGER,
    "origine" TEXT NOT NULL DEFAULT 'PROGETTO',
    "fileId" INTEGER,
    "visto" BOOLEAN NOT NULL DEFAULT false,
    "vistoIl" DATETIME,
    "vistoDaId" INTEGER,
    "rispostaHr" TEXT,
    "skytowerId" TEXT,
    "skytowerUrl" TEXT,
    "skytowerInviatoIl" DATETIME,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornatoIl" DATETIME NOT NULL,
    CONSTRAINT "DocumentoProgetto_progettoId_fkey" FOREIGN KEY ("progettoId") REFERENCES "Progetto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DocumentoProgetto_autoreId_fkey" FOREIGN KEY ("autoreId") REFERENCES "Utente" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DocumentoProgetto_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileCaricato" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DocumentoProgetto_vistoDaId_fkey" FOREIGN KEY ("vistoDaId") REFERENCES "Utente" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotaProgetto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "progettoId" INTEGER NOT NULL,
    "autoreId" INTEGER NOT NULL,
    "testo" TEXT NOT NULL,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornatoIl" DATETIME NOT NULL,
    CONSTRAINT "NotaProgetto_progettoId_fkey" FOREIGN KEY ("progettoId") REFERENCES "Progetto" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotaProgetto_autoreId_fkey" FOREIGN KEY ("autoreId") REFERENCES "Utente" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Impostazione" (
    "chiave" TEXT NOT NULL PRIMARY KEY,
    "valore" TEXT NOT NULL,
    "aggiornatoIl" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "FileCaricato_nomeDisco_key" ON "FileCaricato"("nomeDisco");

-- CreateIndex
CREATE UNIQUE INDEX "Attestato_fileId_key" ON "Attestato"("fileId");

-- CreateIndex
CREATE INDEX "Attestato_dipendenteId_idx" ON "Attestato"("dipendenteId");

-- CreateIndex
CREATE INDEX "Attestato_dataScadenza_idx" ON "Attestato"("dataScadenza");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoDipendente_fileId_key" ON "DocumentoDipendente"("fileId");

-- CreateIndex
CREATE INDEX "DocumentoDipendente_dipendenteId_idx" ON "DocumentoDipendente"("dipendenteId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentoProgetto_fileId_key" ON "DocumentoProgetto"("fileId");

-- CreateIndex
CREATE INDEX "DocumentoProgetto_progettoId_data_idx" ON "DocumentoProgetto"("progettoId", "data");

-- CreateIndex
CREATE INDEX "DocumentoProgetto_autoreId_idx" ON "DocumentoProgetto"("autoreId");

-- CreateIndex
CREATE INDEX "DocumentoProgetto_visto_idx" ON "DocumentoProgetto"("visto");

-- CreateIndex
CREATE INDEX "NotaProgetto_progettoId_idx" ON "NotaProgetto"("progettoId");

