-- "><(((º> sabusabu <º)))><"
-- Giorno 20 (24/11/2026): segnalazioni dei dipendenti a HR sulle proprie giornate (risposte 1b e 4).
-- Le ore le inserisce solo HR; il dipendente segnala, HR viene avvisato all'accesso.

-- CreateTable
CREATE TABLE "Segnalazione" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dipendenteId" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "testo" TEXT NOT NULL,
    "stato" TEXT NOT NULL DEFAULT 'APERTA',
    "rispostaHr" TEXT,
    "risoltaDaId" INTEGER,
    "risoltaIl" DATETIME,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornatoIl" DATETIME NOT NULL,
    CONSTRAINT "Segnalazione_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Segnalazione_risoltaDaId_fkey" FOREIGN KEY ("risoltaDaId") REFERENCES "Utente" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Segnalazione_stato_idx" ON "Segnalazione"("stato");

-- CreateIndex
CREATE INDEX "Segnalazione_dipendenteId_data_idx" ON "Segnalazione"("dipendenteId", "data");

