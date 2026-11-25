-- "><(((º> sabusabu <º)))><"
-- Giorno 17 (24/11/2026): assegnazione dei dipendenti ai progetti (risposte 2a 3a 4a).
-- Solo i dipendenti assegnati possono registrare ore su un progetto (server/servizi/regole-ore.ts).

-- CreateTable
CREATE TABLE "AssegnazioneProgetto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "progettoId" INTEGER NOT NULL,
    "dipendenteId" INTEGER NOT NULL,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AssegnazioneProgetto_progettoId_fkey" FOREIGN KEY ("progettoId") REFERENCES "Progetto" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssegnazioneProgetto_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AssegnazioneProgetto_dipendenteId_idx" ON "AssegnazioneProgetto"("dipendenteId");

-- CreateIndex
CREATE UNIQUE INDEX "AssegnazioneProgetto_progettoId_dipendenteId_key" ON "AssegnazioneProgetto"("progettoId", "dipendenteId");

-- Risposta 4a: chi ha già ore registrate su un progetto ne diventa assegnato, così dopo
-- l'aggiornamento nessuno si trova bloccato sui progetti su cui sta già lavorando.
-- In un database nuovo la tabella delle ore è vuota e non succede nulla.
INSERT INTO "AssegnazioneProgetto" ("progettoId", "dipendenteId")
SELECT DISTINCT "progettoId", "dipendenteId" FROM "RegistrazioneOraria";
