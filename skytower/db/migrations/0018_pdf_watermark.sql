-- "><(((º> sabusabu <º)))><"
-- depends: 0017_naming_reservation_expiry
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0018
-- Filigrana sui PDF: il Project Admin sceglie gli stati CDE in cui i PDF si scaricano (e si visualizzano)
-- solo con la filigrana di chi li ha scaricati — nome, organizzazione, data e ora, documento e revisione.
-- NULL = disattivata. Forma: {"states": ["SHARED", "PUBLISHED"], "text": "Riga aggiuntiva facoltativa"}.
-- =====================================================================

ALTER TABLE cde.project_document_settings ADD COLUMN watermark jsonb;
GRANT UPDATE (watermark) ON cde.project_document_settings TO cde_app;
