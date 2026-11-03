-- "><(((º> sabusabu <º)))><"
-- depends: 0037_uat_notifiche_e_svg
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0038
-- Correzioni dalla revisione di sicurezza del 03/11/2026 (ADR-47).
--
-- 1) Codice commessa univoco per organizzazione (A3). Le altre app della suite trovano il progetto dal
--    codice commessa (projects.settings.commessa): due progetti attivi della stessa organizzazione con lo
--    stesso codice farebbero finire DDT, report e allegati nel progetto sbagliato. Un trigger (non un indice,
--    perché dati già presenti con doppioni non devono bloccare la migrazione) rifiuta con 23505 → 409 un
--    progetto che PRENDE un codice già usato da un altro progetto attivo della stessa organizzazione.
--    Il confronto è sul codice normalizzato come in suite_link.normalizza_commessa (spazi via, maiuscolo).
--
-- 2) Escalation dei compiti scaduti (B1): la persona indicata nel template riceve l'escalation solo se è
--    membro del progetto; altrimenti vale la regola di default (Project Admin + chi ha avviato il workflow).
--    La funzione è quella della 0036 con questo solo controllo in più.
-- 3) Copia di un progetto da template senza il codice commessa (vedi in fondo).
-- =====================================================================

CREATE OR REPLACE FUNCTION cde.commessa_normalizzata(p_settings jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(upper(regexp_replace(coalesce(p_settings ->> 'commessa', ''), '\s+', '', 'g')), '')
$$;

CREATE OR REPLACE FUNCTION cde.check_commessa_unica()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$  -- vede anche i progetti che RLS nasconde a chi salva
DECLARE
  v_codice text := cde.commessa_normalizzata(NEW.settings);
BEGIN
  IF v_codice IS NULL OR NEW.status = 'ARCHIVED' THEN
    RETURN NEW;
  END IF;
  -- solo quando il codice arriva adesso (nuovo progetto, codice cambiato, progetto riattivato):
  -- un doppione già presente prima della 0038 non blocca le modifiche non legate alla commessa
  IF TG_OP = 'UPDATE' AND cde.commessa_normalizzata(OLD.settings) IS NOT DISTINCT FROM v_codice
     AND OLD.status <> 'ARCHIVED' THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM cde.projects p WHERE p.id <> NEW.id AND p.owner_organization_id = NEW.owner_organization_id
             AND p.status <> 'ARCHIVED' AND cde.commessa_normalizzata(p.settings) = v_codice) THEN
    RAISE EXCEPTION 'Codice commessa % già usato da un altro progetto attivo della stessa organizzazione', v_codice
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_commessa_unica ON cde.projects;
CREATE TRIGGER trg_commessa_unica BEFORE INSERT OR UPDATE OF settings, status, owner_organization_id ON cde.projects
  FOR EACH ROW EXECUTE FUNCTION cde.check_commessa_unica();

CREATE OR REPLACE FUNCTION cde.process_deadlines(p_now timestamptz DEFAULT now(), p_repeat_hours integer DEFAULT 72)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  k        record;
  f        record;
  v_n      integer := 0;
  v_esc    uuid;
  v_user   uuid;
  v_dest   uuid[];
  v_giorni integer;
  v_testo  text;
  v_nome   text;
BEGIN
  FOR k IN
    SELECT t.*, d.identifier, i.started_by, tpl.definition, i.project_id AS pid,
           u.first_name || ' ' || u.last_name AS assignee_name
    FROM tasks t JOIN workflow_instances i ON i.id = t.instance_id
    JOIN documents d ON d.id = i.document_id JOIN workflow_templates tpl ON tpl.id = i.template_id
    JOIN users u ON u.id = t.assignee_id
    WHERE t.status = 'OPEN' AND t.due_at IS NOT NULL AND i.status = 'RUNNING'
    FOR UPDATE OF t SKIP LOCKED
  LOOP
    IF k.due_at <= p_now THEN
      -- Scaduto. Prima volta: avviso all'incaricato + escalation. Poi: escalation ripetuta
      -- ogni p_repeat_hours finché resta aperto.
      IF k.overdue_notified_at IS NULL OR (p_repeat_hours > 0 AND k.escalated_at IS NOT NULL
                                           AND k.escalated_at + make_interval(hours => p_repeat_hours) <= p_now) THEN
        v_giorni := greatest(0, floor(extract(epoch FROM p_now - k.due_at) / 86400))::integer;
        IF k.overdue_notified_at IS NULL THEN
          PERFORM notify(k.assignee_id, k.pid, 'TASK_OVERDUE', format('Scadenza superata: %s', k.identifier),
                         'Il compito di revisione è scaduto.', format('/compiti?instance=%s', k.instance_id),
                         jsonb_build_object('task_id', k.id));
        END IF;
        -- Destinatari dell'escalation: la persona del template, altrimenti i Project Admin
        -- del progetto più chi ha avviato il workflow. Mai l'incaricato.
        v_esc := (k.definition ->> 'escalation_user_id')::uuid;
        -- la persona del template vale solo se è ancora membro del progetto: un utente di un'altra
        -- organizzazione (o uscito dal progetto) non deve ricevere identificativi e nomi (0038, B1)
        IF v_esc IS NOT NULL AND NOT EXISTS (SELECT 1 FROM project_memberships m WHERE m.project_id = k.pid
                                               AND m.user_id = v_esc AND (m.expires_at IS NULL OR m.expires_at > p_now)) THEN
          v_esc := NULL;
        END IF;
        IF v_esc IS NOT NULL AND v_esc <> k.assignee_id THEN
          v_dest := ARRAY[v_esc];
        ELSE
          SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_dest FROM (
            SELECT m.user_id AS x FROM project_memberships m JOIN roles r ON r.id = m.role_id
            WHERE m.project_id = k.pid AND r.code = 'PROJECT_ADMIN'
              AND (m.expires_at IS NULL OR m.expires_at > p_now)
            UNION SELECT k.started_by) s WHERE x IS NOT NULL AND x <> k.assignee_id;
        END IF;
        v_testo := format('%s non ha completato "%s" su %s: in ritardo di %s giorn%s (sollecito n. %s).',
                          k.assignee_name, (SELECT name FROM workflow_step_runs WHERE id = k.step_run_id),
                          k.identifier, v_giorni, CASE WHEN v_giorni = 1 THEN 'o' ELSE 'i' END, k.escalation_count + 1);
        FOREACH v_user IN ARRAY v_dest LOOP
          PERFORM notify(v_user, k.pid, 'TASK_ESCALATED', format('Escalation: %s', k.identifier), v_testo,
                         format('/compiti?instance=%s', k.instance_id),
                         jsonb_build_object('task_id', k.id, 'days_late', v_giorni, 'escalation', k.escalation_count + 1,
                                            'assignee_id', k.assignee_id));
        END LOOP;
        UPDATE tasks SET overdue_notified_at = coalesce(overdue_notified_at, p_now), escalated_at = p_now,
                         escalation_count = escalation_count + 1
        WHERE id = k.id;
        v_n := v_n + 1;
      END IF;
    ELSIF k.due_at - interval '24 hours' <= p_now THEN
      IF k.reminded_24_at IS NULL THEN
        PERFORM notify(k.assignee_id, k.pid, 'TASK_REMINDER', format('Scade entro 24 ore: %s', k.identifier),
                       'Promemoria: compito di revisione in scadenza.', format('/compiti?instance=%s', k.instance_id),
                       jsonb_build_object('task_id', k.id, 'hours', 24));
        UPDATE tasks SET reminded_24_at = p_now, reminded_48_at = coalesce(reminded_48_at, p_now) WHERE id = k.id;
        v_n := v_n + 1;
      END IF;
    ELSIF k.due_at - interval '48 hours' <= p_now AND k.reminded_48_at IS NULL
          AND k.due_at - k.created_at > interval '48 hours' THEN
      PERFORM notify(k.assignee_id, k.pid, 'TASK_REMINDER', format('Scade entro 48 ore: %s', k.identifier),
                     'Promemoria: compito di revisione in scadenza.', format('/compiti?instance=%s', k.instance_id),
                     jsonb_build_object('task_id', k.id, 'hours', 48));
      UPDATE tasks SET reminded_48_at = p_now WHERE id = k.id;
      v_n := v_n + 1;
    END IF;
  END LOOP;

  -- RFI: invariato rispetto alla 0007 (promemoria a −24h, scadenza superata una volta).
  FOR f IN SELECT * FROM rfis WHERE status = 'OPEN' AND due_at IS NOT NULL FOR UPDATE SKIP LOCKED LOOP
    IF f.due_at <= p_now AND f.overdue_notified_at IS NULL THEN
      FOR v_user IN SELECT f.author_id UNION SELECT * FROM rfi_recipient_users(f.id) LOOP
        PERFORM notify(v_user, f.project_id, 'RFI_OVERDUE', format('RFI-%s scaduta', lpad(f.number::text, 4, '0')),
                       f.subject, format('/progetti/%s/rfi/%s', f.project_id, f.id), jsonb_build_object('rfi_id', f.id));
      END LOOP;
      UPDATE rfis SET overdue_notified_at = p_now WHERE id = f.id;
      v_n := v_n + 1;
    ELSIF f.due_at > p_now AND f.due_at - interval '24 hours' <= p_now AND f.reminded_at IS NULL THEN
      FOR v_user IN SELECT * FROM rfi_recipient_users(f.id) LOOP
        PERFORM notify(v_user, f.project_id, 'RFI_REMINDER', format('RFI-%s in scadenza', lpad(f.number::text, 4, '0')),
                       f.subject, format('/progetti/%s/rfi/%s', f.project_id, f.id), jsonb_build_object('rfi_id', f.id));
      END LOOP;
      UPDATE rfis SET reminded_at = p_now WHERE id = f.id;
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION cde.process_deadlines(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.process_deadlines(timestamptz, integer) TO cde_worker;

-- 3) Nuovo progetto da un progetto esistente (ADR-38): stessa funzione della 0032, ma senza copiare il codice
--    commessa, che resterebbe un doppione nella stessa organizzazione (punto 1).
CREATE OR REPLACE FUNCTION cde.create_project_from_template(
    p_source uuid, p_code text, p_name text, p_description text DEFAULT NULL, p_start_date date DEFAULT NULL,
    p_end_date date DEFAULT NULL, p_timezone text DEFAULT 'Europe/Rome',
    p_with_organizations boolean DEFAULT false, p_with_members boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_user    uuid := current_app_user();
  v_org     uuid := current_app_org();
  v_project uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM projects WHERE id = p_source)
     OR NOT has_project_permission(v_user, p_source, 'ADMIN', 'PROJECT') THEN
    RAISE EXCEPTION 'Commessa di partenza non trovata o senza permesso di Project Admin'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_with_members AND NOT p_with_organizations THEN
    RAISE EXCEPTION 'Le persone si copiano solo insieme alle loro organizzazioni' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  v_project := create_project(p_code, p_name, p_description, p_start_date, p_end_date, p_timezone);   -- controlla l'admin

  DROP TABLE IF EXISTS _tpl_roles, _tpl_profiles, _tpl_folders;
  -- il codice commessa NON si copia: collega un solo progetto alle app della suite e il trigger della 0038
  -- rifiuterebbe il doppione; il Project Admin lo sceglie per la nuova commessa nella scheda Suite
  UPDATE projects SET settings = (SELECT settings - 'commessa' FROM projects WHERE id = p_source) WHERE id = v_project;

  INSERT INTO project_document_settings (project_id, naming_scheme, metadata_schema, auto_number, watermark, updated_by)
  SELECT v_project, naming_for_project(naming_scheme, p_code), metadata_schema, auto_number, watermark, v_user
  FROM project_document_settings WHERE project_id = p_source;

  IF p_with_organizations THEN
    INSERT INTO project_organizations (project_id, organization_id, party_role, is_active, invited_by)
    SELECT v_project, organization_id, party_role, is_active, v_user
    FROM project_organizations WHERE project_id = p_source AND organization_id <> v_org
    ON CONFLICT DO NOTHING;
  END IF;

  -- ruoli personalizzati della commessa, con i permessi (i ruoli di sistema sono condivisi)
  CREATE TEMP TABLE _tpl_roles ON COMMIT DROP AS
    SELECT id AS old_id, gen_random_uuid() AS new_id FROM roles WHERE project_id = p_source;
  INSERT INTO roles (id, project_id, code, name, description)
  SELECT m.new_id, v_project, r.code, r.name, r.description FROM roles r JOIN _tpl_roles m ON m.old_id = r.id;
  INSERT INTO role_permissions (role_id, action, scope)
  SELECT m.new_id, p.action, p.scope FROM role_permissions p JOIN _tpl_roles m ON m.old_id = p.role_id;

  IF p_with_members THEN
    INSERT INTO project_memberships (project_id, user_id, role_id, granted_by)
    SELECT v_project, pm.user_id, coalesce(m.new_id, pm.role_id), v_user
    FROM project_memberships pm
    JOIN users u ON u.id = pm.user_id AND u.status = 'ACTIVE'
    LEFT JOIN _tpl_roles m ON m.old_id = pm.role_id
    WHERE pm.project_id = p_source AND (pm.expires_at IS NULL OR pm.expires_at > now())
    ON CONFLICT DO NOTHING;
  END IF;

  -- schemi di naming per cartelle
  CREATE TEMP TABLE _tpl_profiles ON COMMIT DROP AS
    SELECT id AS old_id, gen_random_uuid() AS new_id FROM naming_profiles WHERE project_id = p_source;
  INSERT INTO naming_profiles (id, project_id, name, naming_scheme, auto_number, inherit, created_by, updated_by)
  SELECT m.new_id, v_project, n.name, naming_for_project(n.naming_scheme, p_code), n.auto_number, n.inherit, v_user, v_user
  FROM naming_profiles n JOIN _tpl_profiles m ON m.old_id = n.id;

  -- albero delle cartelle: senza le organizzazioni, solo i rami della propria
  CREATE TEMP TABLE _tpl_folders ON COMMIT DROP AS
    WITH RECURSIVE tree AS (
      SELECT c.id FROM containers c
      WHERE c.project_id = p_source AND c.parent_id IS NULL AND (p_with_organizations OR c.owner_organization_id = v_org)
      UNION ALL
      SELECT c.id FROM containers c JOIN tree t ON c.parent_id = t.id
      WHERE p_with_organizations OR c.owner_organization_id = v_org)
    SELECT id AS old_id, gen_random_uuid() AS new_id FROM tree;
  INSERT INTO containers (id, project_id, parent_id, owner_organization_id, name, inherit_permissions, is_private,
                          naming_profile_id, created_by)
  SELECT m.new_id, v_project, pm.new_id, c.owner_organization_id, c.name, c.inherit_permissions, c.is_private,
         pr.new_id, v_user
  FROM containers c JOIN _tpl_folders m ON m.old_id = c.id
  LEFT JOIN _tpl_folders pm ON pm.old_id = c.parent_id
  LEFT JOIN _tpl_profiles pr ON pr.old_id = c.naming_profile_id;
  -- il trigger di ereditarietà (0030) può aver dato uno schema a sottocartelle che nell'originale non l'hanno
  UPDATE containers n SET naming_profile_id = pr.new_id
  FROM _tpl_folders m JOIN containers c ON c.id = m.old_id LEFT JOIN _tpl_profiles pr ON pr.old_id = c.naming_profile_id
  WHERE n.id = m.new_id AND n.naming_profile_id IS DISTINCT FROM pr.new_id;

  -- workflow attivi: ultima versione di ciascuno, ripartendo dalla 1
  INSERT INTO workflow_templates (project_id, code, version, name, definition, is_active, created_by)
  SELECT DISTINCT ON (code) v_project, code, 1, name, definition, true, v_user
  FROM workflow_templates WHERE project_id = p_source AND is_active
  ORDER BY code, version DESC;

  RETURN v_project;
END $$;
