-- "><(((º> sabusabu <º)))><"
-- depends: 0039_workflow_grafo
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0041: libreria dei workflow dell'organizzazione (ADR-50, docs/workflow-grafo.md §5)
--
-- Richiesta dell'utente del 04/11/2026: "i workflow si creano ad alto livello e si possono usare come template su
-- tutte le commesse". Scelte:
--   * ogni organizzazione ha la sua libreria di modelli, visibile nelle commesse di cui è proprietaria
--     (projects.owner_organization_id); le altre organizzazioni non la vedono;
--   * collegamento vivo: le commesse avviano direttamente i modelli attivi della libreria; una nuova versione vale
--     per gli avvii successivi, le istanze in corso restano sulla versione con cui sono partite (template_id);
--   * solo l'amministratore dell'organizzazione (cde.can_manage_org) crea, versiona e disattiva i modelli;
--   * nei modelli di libreria assegnatari e destinatari solo per ruolo: niente persone, niente ruoli limitati a
--     un'organizzazione, niente escalation verso una persona (le persone cambiano da commessa a commessa).
--
-- Cosa cambia:
--   1. workflow_templates: project_id facoltativo, organization_id (esattamente uno dei due), source_template_id
--      (da quale modello è stato copiato), unicità per organizzazione, vincolo "solo ruoli" per la libreria;
--   2. RLS: un modello di libreria lo legge chi è dell'organizzazione o membro di una sua commessa; lo scrive
--      solo l'amministratore dell'organizzazione;
--   3. motore: un'istanza avviata da un modello di libreria ha il progetto nell'istanza (le funzioni del motore
--      usano già i.project_id); cambiano solo i due avvii, che accettano un modello della libreria
--      dell'organizzazione proprietaria e controllano prima che ogni compito abbia qualcuno a cui andare.
-- Le altre query che leggono workflow_templates (scadenze, cruscotto, report, copia da commessa modello,
-- da-fare della suite) passano dall'istanza o filtrano per project_id: restano valide così.
-- =====================================================================

-- =====================================================================
-- 1. Modelli di progetto o di libreria
-- =====================================================================
ALTER TABLE cde.workflow_templates
  ALTER COLUMN project_id DROP NOT NULL,
  ADD COLUMN organization_id uuid REFERENCES cde.organizations (id) ON DELETE CASCADE,
  ADD COLUMN source_template_id uuid REFERENCES cde.workflow_templates (id);

-- un modello sta in una commessa oppure nella libreria di un'organizzazione, mai in entrambe
ALTER TABLE cde.workflow_templates ADD CONSTRAINT workflow_templates_scope CHECK (
  (project_id IS NULL) <> (organization_id IS NULL));
-- stesso codice nella stessa libreria ⇒ versioni successive (come per i modelli di progetto)
ALTER TABLE cde.workflow_templates ADD CONSTRAINT workflow_templates_org_code_version
  UNIQUE (organization_id, code, version);

-- Libreria: solo ruoli. Anche l'API lo controlla con messaggi per nodo; qui è l'ultima difesa.
ALTER TABLE cde.workflow_templates ADD CONSTRAINT workflow_templates_library_roles_only CHECK (
  organization_id IS NULL OR (
    NOT definition ? 'escalation_user_id'
    AND NOT jsonb_path_exists(definition, '$.nodes[*].assignees[*] ? (@.type == "user" || exists(@.organization_id))')
    AND NOT jsonb_path_exists(definition, '$.nodes[*].recipients[*] ? (@.type == "user" || exists(@.organization_id))')));

-- Immutabilità (una modifica = nuova versione): anche ambito e provenienza non si cambiano dopo l'inserimento.
DROP TRIGGER trg_wf_templates_immutable ON cde.workflow_templates;
CREATE TRIGGER trg_wf_templates_immutable
  BEFORE UPDATE OF definition, code, version, project_id, organization_id, source_template_id OR DELETE
  ON cde.workflow_templates FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();

-- =====================================================================
-- 2. RLS
-- =====================================================================
-- Organizzazioni di cui l'utente vede la libreria: la propria e le proprietarie delle commesse di cui è membro
-- (così chi avvia o esegue un workflow di libreria in una commessa ne legge la definizione); tutte per il
-- platform admin. Helper definer: niente ricorsione con le policy di projects.
CREATE FUNCTION cde.my_library_orgs() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT current_app_org() WHERE current_app_org() IS NOT NULL
  UNION
  SELECT p.owner_organization_id FROM projects p WHERE p.id IN (SELECT my_projects())
  UNION
  SELECT o.id FROM organizations o WHERE current_app_is_platform_admin()
$$;

DROP POLICY wf_templates_select ON cde.workflow_templates;
CREATE POLICY wf_templates_select ON cde.workflow_templates FOR SELECT TO cde_app USING (
  project_id IN (SELECT cde.my_projects())
  OR (organization_id IS NOT NULL AND organization_id IN (SELECT cde.my_library_orgs())));

-- Scrittura nella libreria: solo l'amministratore dell'organizzazione (o il platform admin), come per utenti e
-- impostazioni dell'organizzazione. Le policy di progetto (wf_templates_insert/update) restano: con
-- project_id NULL has_project_permission è falso, quindi non aprono nulla sulla libreria.
CREATE POLICY wf_templates_library_insert ON cde.workflow_templates FOR INSERT TO cde_app
  WITH CHECK (organization_id IS NOT NULL AND created_by = cde.current_app_user()
              AND cde.can_manage_org(organization_id));
CREATE POLICY wf_templates_library_update ON cde.workflow_templates FOR UPDATE TO cde_app
  USING      (organization_id IS NOT NULL AND cde.can_manage_org(organization_id))
  WITH CHECK (organization_id IS NOT NULL AND cde.can_manage_org(organization_id));

-- =====================================================================
-- 3. Motore: avvio da un modello di libreria
-- =====================================================================
-- Nodi con compiti (decisioni e attività) che nella commessa non avrebbero nessuno a cui andare: un compito
-- senza assegnatari blocca il flusso (il motore si ferma con errore quando il nodo si attiva), quindi per i
-- modelli di libreria lo si controlla prima dell'avvio. Risponde solo per una commessa di cui si è membri.
CREATE FUNCTION cde.wf_unassigned_nodes(p_project uuid, p_originator uuid, p_def jsonb)
RETURNS TABLE (node_id text, node_name text, roles text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
  SELECT x.n ->> 'id', x.n ->> 'name',
         (SELECT string_agg(DISTINCT a ->> 'code', ', ') FROM jsonb_array_elements(x.n -> 'assignees') a)
  FROM jsonb_array_elements(p_def -> 'nodes') WITH ORDINALITY AS x(n, ord)
  WHERE p_project IN (SELECT my_projects())
    AND x.n ->> 'type' IN ('decision', 'activity')
    AND NOT EXISTS (SELECT 1 FROM wf_resolve_assignees(p_project, p_originator, x.n))
  ORDER BY x.ord
$$;

-- Errore leggibile per l'avvio bloccato: «Nodo» (RUOLO), «Altro nodo» (RUOLO).
CREATE FUNCTION cde.wf_check_library_roles(p_template cde.workflow_templates, p_project uuid, p_originator uuid)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  v_list text;
BEGIN
  IF p_template.organization_id IS NULL THEN
    RETURN;   -- modello della commessa: comportamento di sempre
  END IF;
  SELECT string_agg(format('«%s» (%s)', u.node_name, coalesce(u.roles, '—')), ', ') INTO v_list
  FROM wf_unassigned_nodes(p_project, p_originator, p_template.definition) u;
  IF v_list IS NOT NULL THEN
    RAISE EXCEPTION 'Il modello di libreria "%" non si può avviare in questa commessa: nessuno ha il ruolo richiesto per %',
      p_template.name, v_list USING ERRCODE = 'check_violation';
  END IF;
END $$;

-- Avvio su una revisione: come nella 0039, con il modello cercato anche nella libreria dell'organizzazione
-- proprietaria della commessa e il controllo dei ruoli per i modelli di libreria.
CREATE OR REPLACE FUNCTION cde.workflow_start(p_template_id uuid, p_revision_id uuid, p_comment text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  r      document_revisions%ROWTYPE;
  t      workflow_templates%ROWTYPE;
  v_id   uuid := gen_random_uuid();
  target jsonb;
  rule   state_transitions%ROWTYPE;
BEGIN
  SELECT * INTO r FROM document_revisions WHERE id = p_revision_id;
  IF NOT FOUND OR NOT revision_visible_to_me(r) THEN
    RAISE EXCEPTION 'Revisione non trovata' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT * INTO t FROM workflow_templates
  WHERE id = p_template_id AND is_active
    AND (project_id = r.project_id
         OR organization_id = (SELECT owner_organization_id FROM projects WHERE id = r.project_id));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template di workflow non trovato o non attivo' USING ERRCODE = 'no_data_found';
  END IF;
  IF t.subject <> 'DOCUMENT' THEN
    RAISE EXCEPTION 'Il modello "%" è per processi: si avvia dalla scheda Processi', t.name USING ERRCODE = 'check_violation';
  END IF;
  -- avvia l'autore (WRITE sul container, propria organizzazione) o un amministratore del container
  IF NOT ((r.originator_organization_id = current_app_org() AND has_permission(current_app_user(), r.container_id, 'WRITE'))
          OR has_permission(current_app_user(), r.container_id, 'ADMIN')) THEN
    RAISE EXCEPTION 'Non puoi avviare un workflow su questo documento' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM documents WHERE id = r.document_id AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Documento archiviato' USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM document_revisions WHERE document_id = r.document_id AND sequence > r.sequence) THEN
    RAISE EXCEPTION 'Si può avviare la revisione solo sull''ultima revisione del documento' USING ERRCODE = 'check_violation';
  END IF;
  target := t.definition -> 'on_completed';
  IF target IS NOT NULL AND jsonb_typeof(target) = 'object' THEN
    rule := effective_transition(r.project_id, r.state, (target ->> 'to_state')::cde_state);
    IF rule.id IS NULL OR NOT ((target ->> 'suitability') = ANY (rule.allowed_suitability)) THEN
      RAISE EXCEPTION 'Il template prevede la transizione % → % non applicabile a questa revisione',
        r.state, target ->> 'to_state' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  -- libreria: ogni compito deve avere qualcuno nella commessa (organizzazione autrice = quella del documento)
  PERFORM wf_check_library_roles(t, r.project_id,
                                 (SELECT originator_organization_id FROM documents WHERE id = r.document_id));

  -- l'indice unico parziale garantisce un solo workflow attivo per documento
  INSERT INTO workflow_instances (id, project_id, template_id, document_id, revision_id, started_by, outcome_comment)
  VALUES (v_id, r.project_id, t.id, r.document_id, r.id, current_app_user(), p_comment);
  PERFORM wf_begin(v_id);
  RETURN v_id;
END $$;

-- Avvio di un processo: in più il progetto (p_project), obbligatorio per un modello di libreria, che si avvia
-- solo nelle commesse di cui l'organizzazione della libreria è proprietaria. Senza p_project vale il progetto
-- del modello, come prima (le chiamate a quattro argomenti continuano a funzionare).
DROP FUNCTION cde.workflow_start_process(uuid, text, text, uuid[]);
CREATE FUNCTION cde.workflow_start_process(p_template_id uuid, p_title text, p_description text DEFAULT NULL,
                                           p_documents uuid[] DEFAULT '{}', p_project uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
DECLARE
  t         workflow_templates%ROWTYPE;
  v_id      uuid := gen_random_uuid();
  v_doc     uuid;
  v_project uuid;
BEGIN
  SELECT * INTO t FROM workflow_templates WHERE id = p_template_id AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template di workflow non trovato o non attivo' USING ERRCODE = 'no_data_found';
  END IF;
  IF t.project_id IS NOT NULL THEN
    v_project := t.project_id;
    IF p_project IS NOT NULL AND p_project <> t.project_id THEN
      RAISE EXCEPTION 'Template di workflow non trovato o non attivo' USING ERRCODE = 'no_data_found';
    END IF;
  ELSE
    v_project := p_project;
    IF v_project IS NULL OR NOT EXISTS (SELECT 1 FROM projects WHERE id = v_project
                                                                  AND owner_organization_id = t.organization_id) THEN
      RAISE EXCEPTION 'Template di workflow non trovato o non attivo' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;
  IF v_project NOT IN (SELECT my_projects()) THEN
    RAISE EXCEPTION 'Template di workflow non trovato o non attivo' USING ERRCODE = 'no_data_found';
  END IF;
  IF t.subject <> 'PROCESS' THEN
    RAISE EXCEPTION 'Il modello "%" è per documenti: si avvia da una revisione', t.name USING ERRCODE = 'check_violation';
  END IF;
  IF length(btrim(coalesce(p_title, ''))) < 2 THEN
    RAISE EXCEPTION 'Titolo del processo obbligatorio' USING ERRCODE = 'check_violation';
  END IF;
  FOREACH v_doc IN ARRAY coalesce(p_documents, '{}') LOOP
    -- allegabile solo un documento del progetto che chi avvia può vedere (almeno una revisione visibile)
    IF NOT EXISTS (SELECT 1 FROM document_revisions r WHERE r.document_id = v_doc AND r.project_id = v_project
                     AND revision_visible_to_me(r)) THEN
      RAISE EXCEPTION 'Documento allegato non trovato' USING ERRCODE = 'no_data_found';
    END IF;
  END LOOP;
  -- libreria: ogni compito deve avere qualcuno nella commessa (organizzazione autrice = quella di chi avvia)
  PERFORM wf_check_library_roles(t, v_project, current_app_org());
  INSERT INTO workflow_instances (id, project_id, template_id, subject, title, description, started_by)
  VALUES (v_id, v_project, t.id, 'PROCESS', btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
          current_app_user());
  INSERT INTO workflow_instance_documents (instance_id, document_id)
  SELECT DISTINCT v_id, d FROM unnest(coalesce(p_documents, '{}')) d;
  PERFORM wf_begin(v_id);
  RETURN v_id;
END $$;

-- =====================================================================
-- 4. Privilegi
-- =====================================================================
REVOKE ALL ON FUNCTION cde.my_library_orgs(), cde.wf_unassigned_nodes(uuid, uuid, jsonb),
                       cde.wf_check_library_roles(cde.workflow_templates, uuid, uuid),
                       cde.workflow_start_process(uuid, text, text, uuid[], uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cde.my_library_orgs(), cde.wf_unassigned_nodes(uuid, uuid, jsonb),
                          cde.workflow_start_process(uuid, text, text, uuid[], uuid) TO cde_app;
