-- "><(((º> sabusabu <º)))><"
-- Giorno 26 (24/11/2026, risposte 1a 2a 3a 4a):
-- 1. tabella Mansione, l'elenco delle mansioni proposte nella scheda dipendente, riempito
--    con le mansioni già scritte nelle schede (stesso testo, senza doppioni);
-- 2. matricole solo numeriche → SIGLA-NUMERO del contratto (es. 0004 di un determinato →
--    DET-0004). Si saltano quelle non numeriche (le corregge HR alla prossima modifica:
--    la scheda propone la forma giusta) e quelle che darebbero due volte lo stesso numero
--    (es. "4" e "0004"), così la migrazione non si ferma mai su un doppione.

-- CreateTable
CREATE TABLE "Mansione" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "nome" TEXT NOT NULL,
    "creatoIl" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Mansione_nome_key" ON "Mansione"("nome");

-- Mansioni già presenti nelle schede (spazi tolti; maiuscole come scritte la prima volta).
INSERT OR IGNORE INTO "Mansione" ("nome")
SELECT MIN(TRIM("mansione")) FROM "Dipendente"
WHERE "mansione" IS NOT NULL AND TRIM("mansione") <> ''
GROUP BY LOWER(TRIM("mansione"));

-- Matricole numeriche (1-6 cifre) → sigla del contratto + numero di almeno 4 cifre.
UPDATE "Dipendente"
SET "matricola" =
  (CASE "tipoContratto"
     WHEN 'INDETERMINATO' THEN 'IND'
     WHEN 'DETERMINATO' THEN 'DET'
     WHEN 'APPRENDISTATO' THEN 'APP'
     WHEN 'SOMMINISTRAZIONE' THEN 'SOM'
     WHEN 'COLLABORAZIONE' THEN 'COL'
     WHEN 'TIROCINIO' THEN 'TIR'
   END)
  || '-'
  || substr('0000' || CAST(CAST("matricola" AS INTEGER) AS TEXT), -max(4, length(CAST(CAST("matricola" AS INTEGER) AS TEXT))))
WHERE "matricola" NOT GLOB '*[^0-9]*'
  AND length("matricola") BETWEEN 1 AND 6
  AND CAST("matricola" AS INTEGER) > 0
  AND NOT EXISTS (
    SELECT 1 FROM "Dipendente" AS "altro"
    WHERE "altro"."id" <> "Dipendente"."id"
      AND "altro"."matricola" NOT GLOB '*[^0-9]*'
      AND CAST("altro"."matricola" AS INTEGER) = CAST("Dipendente"."matricola" AS INTEGER)
  );
