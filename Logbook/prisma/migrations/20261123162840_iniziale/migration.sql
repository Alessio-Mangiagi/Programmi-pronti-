-- CreateTable
CREATE TABLE "Utente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "ruolo" TEXT NOT NULL DEFAULT 'DIPENDENTE',
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "dipendenteId" INTEGER,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornatoIl" DATETIME NOT NULL,
    CONSTRAINT "Utente_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dipendente" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "matricola" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cognome" TEXT NOT NULL,
    "codiceFiscale" TEXT NOT NULL,
    "email" TEXT,
    "telefono" TEXT,
    "mansione" TEXT,
    "reparto" TEXT,
    "dataAssunzione" TEXT NOT NULL,
    "dataCessazione" TEXT,
    "tipoContratto" TEXT NOT NULL,
    "oreSettimanali" REAL NOT NULL,
    "costoOrarioNettoCent" INTEGER,
    "costoOrarioLordoCent" INTEGER,
    "stato" TEXT NOT NULL DEFAULT 'ATTIVO',
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornatoIl" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Progetto" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "codice" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cliente" TEXT,
    "dataInizio" TEXT NOT NULL,
    "dataFine" TEXT,
    "stato" TEXT NOT NULL DEFAULT 'ATTIVO',
    "colore" TEXT,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornatoIl" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RegistrazioneOraria" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dipendenteId" INTEGER NOT NULL,
    "progettoId" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "oraInizio" TEXT NOT NULL,
    "oraFine" TEXT NOT NULL,
    "note" TEXT,
    "origine" TEXT NOT NULL DEFAULT 'INTERFACCIA',
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornatoIl" DATETIME NOT NULL,
    CONSTRAINT "RegistrazioneOraria_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RegistrazioneOraria_progettoId_fkey" FOREIGN KEY ("progettoId") REFERENCES "Progetto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Assenza" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "dipendenteId" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "dataInizio" TEXT NOT NULL,
    "dataFine" TEXT NOT NULL,
    "minutiPermesso" INTEGER,
    "stato" TEXT NOT NULL DEFAULT 'RICHIESTA',
    "noteDipendente" TEXT,
    "noteHr" TEXT,
    "protocolloCertificato" TEXT,
    "decisoDaId" INTEGER,
    "decisoIl" DATETIME,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggiornatoIl" DATETIME NOT NULL,
    CONSTRAINT "Assenza_dipendenteId_fkey" FOREIGN KEY ("dipendenteId") REFERENCES "Dipendente" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Assenza_decisoDaId_fkey" FOREIGN KEY ("decisoDaId") REFERENCES "Utente" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Festivita" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "data" TEXT NOT NULL,
    "descrizione" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Utente_username_key" ON "Utente"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Utente_dipendenteId_key" ON "Utente"("dipendenteId");

-- CreateIndex
CREATE UNIQUE INDEX "Dipendente_matricola_key" ON "Dipendente"("matricola");

-- CreateIndex
CREATE UNIQUE INDEX "Dipendente_codiceFiscale_key" ON "Dipendente"("codiceFiscale");

-- CreateIndex
CREATE INDEX "Dipendente_cognome_nome_idx" ON "Dipendente"("cognome", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "Progetto_codice_key" ON "Progetto"("codice");

-- CreateIndex
CREATE INDEX "RegistrazioneOraria_dipendenteId_data_idx" ON "RegistrazioneOraria"("dipendenteId", "data");

-- CreateIndex
CREATE INDEX "RegistrazioneOraria_progettoId_data_idx" ON "RegistrazioneOraria"("progettoId", "data");

-- CreateIndex
CREATE INDEX "RegistrazioneOraria_data_idx" ON "RegistrazioneOraria"("data");

-- CreateIndex
CREATE INDEX "Assenza_dipendenteId_dataInizio_idx" ON "Assenza"("dipendenteId", "dataInizio");

-- CreateIndex
CREATE INDEX "Assenza_stato_idx" ON "Assenza"("stato");

-- CreateIndex
CREATE UNIQUE INDEX "Festivita_data_key" ON "Festivita"("data");
