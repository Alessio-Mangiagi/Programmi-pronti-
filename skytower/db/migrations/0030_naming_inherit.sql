-- "><(((º> sabusabu <º)))><"
-- depends: 0029_text_reocr
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0030
-- Ereditarietà opzionale dello schema di naming (ADR-35): uno schema per cartelle con "inherit" passa da solo
-- alle sottocartelle create dopo dentro le sue cartelle. Senza la spunta resta il comportamento di ADR-30
-- (nessuna ereditarietà implicita). Lo spostamento di una cartella non cambia il suo schema.
-- =====================================================================

ALTER TABLE cde.naming_profiles ADD COLUMN inherit boolean NOT NULL DEFAULT false;
GRANT UPDATE (inherit) ON cde.naming_profiles TO cde_app;

-- SECURITY DEFINER: chi crea la sottocartella non ha il permesso di assegnare schemi (lo fa il Project Admin
-- spuntando "inherit"), e lo schema del padre va letto anche se il padre fosse di un'altra organizzazione.
CREATE FUNCTION cde.containers_inherit_naming() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND NEW.naming_profile_id IS NULL THEN
    SELECT p.id INTO NEW.naming_profile_id
    FROM containers c JOIN naming_profiles p ON p.id = c.naming_profile_id
    WHERE c.id = NEW.parent_id AND p.inherit AND p.project_id = NEW.project_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION cde.containers_inherit_naming() FROM PUBLIC;

CREATE TRIGGER trg_containers_inherit_naming BEFORE INSERT ON cde.containers
  FOR EACH ROW EXECUTE FUNCTION cde.containers_inherit_naming();
