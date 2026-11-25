-- CreateTable
CREATE TABLE "Sessione" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "utenteId" INTEGER NOT NULL,
    "scadeIl" DATETIME NOT NULL,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Sessione_utenteId_fkey" FOREIGN KEY ("utenteId") REFERENCES "Utente" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Sessione_utenteId_idx" ON "Sessione"("utenteId");
