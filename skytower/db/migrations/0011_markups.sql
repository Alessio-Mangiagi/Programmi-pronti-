-- "><(((º> sabusabu <º)))><"
-- depends: 0010_audit_chain
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0011 (Sprint 5, G45)
-- Markup: annotazioni e commenti ancorati a una revisione (pagina + rettangolo normalizzato 0..1,
-- oppure elemento di un modello, es. GUID IFC), eventualmente legati a un task di revisione.
-- Chi vede la revisione vede le sue annotazioni e può commentarle: le policy riusano la RLS di
-- document_revisions tramite sottoquery, così la visibilità resta una sola regola.
-- Il testo di un'annotazione e le risposte non si modificano: si risolve o si riapre.
-- =====================================================================

CREATE TYPE cde.markup_status AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE cde.revision_markups (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid              NOT NULL REFERENCES cde.projects (id),
  revision_id    uuid              NOT NULL REFERENCES cde.document_revisions (id),
  task_id        uuid              REFERENCES cde.tasks (id),
  author_id      uuid              NOT NULL REFERENCES cde.users (id),
  author_org_id  uuid              NOT NULL REFERENCES cde.organizations (id),
  page           integer           CHECK (page BETWEEN 1 AND 100000),
  x              real              CHECK (x BETWEEN 0 AND 1),
  y              real              CHECK (y BETWEEN 0 AND 1),
  w              real              CHECK (w BETWEEN 0 AND 1),
  h              real              CHECK (h BETWEEN 0 AND 1),
  element_ref    text              CHECK (length(element_ref) BETWEEN 1 AND 128),
  color          text              NOT NULL DEFAULT '#e53935' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
  body           text              NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  status         cde.markup_status NOT NULL DEFAULT 'OPEN',
  resolved_by    uuid              REFERENCES cde.users (id),
  resolved_at    timestamptz,
  created_at     timestamptz       NOT NULL DEFAULT now(),
  CHECK ((x IS NULL) = (y IS NULL) AND (w IS NULL) = (h IS NULL) AND (w IS NULL OR x IS NOT NULL)),
  CHECK (x IS NULL OR (x + coalesce(w, 0) <= 1.0001 AND y + coalesce(h, 0) <= 1.0001)),
  CHECK ((status = 'RESOLVED') = (resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE INDEX ix_markups_revision ON cde.revision_markups (revision_id, created_at);
CREATE INDEX ix_markups_task ON cde.revision_markups (task_id) WHERE task_id IS NOT NULL;

CREATE TABLE cde.markup_replies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  markup_id   uuid        NOT NULL REFERENCES cde.revision_markups (id),
  author_id   uuid        NOT NULL REFERENCES cde.users (id),
  body        text        NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_markup_replies_markup ON cde.markup_replies (markup_id, created_at);
CREATE TRIGGER trg_markup_replies_no_update BEFORE UPDATE OR DELETE ON cde.markup_replies
  FOR EACH ROW EXECUTE FUNCTION cde.forbid_mutation();

-- Coerenza: progetto della revisione, task del progetto e della stessa revisione
CREATE FUNCTION cde.check_markup() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = cde, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.revision_id, NEW.project_id, NEW.author_id, NEW.body, NEW.created_at)
                         IS DISTINCT FROM (OLD.revision_id, OLD.project_id, OLD.author_id, OLD.body, OLD.created_at) THEN
    RAISE EXCEPTION 'Un''annotazione non si modifica: si risolve o si riapre' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM document_revisions WHERE id = NEW.revision_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'Revisione non appartenente al progetto' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.task_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM tasks t JOIN workflow_instances i ON i.id = t.instance_id
       WHERE t.id = NEW.task_id AND i.revision_id = NEW.revision_id) THEN
    RAISE EXCEPTION 'Il task non riguarda questa revisione' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_markups_check BEFORE INSERT OR UPDATE ON cde.revision_markups
  FOR EACH ROW EXECUTE FUNCTION cde.check_markup();

ALTER TABLE cde.revision_markups ENABLE ROW LEVEL SECURITY;
ALTER TABLE cde.markup_replies   ENABLE ROW LEVEL SECURITY;

-- Le sottoquery su document_revisions girano con la RLS di chi chiede: stessa visibilità della revisione
CREATE POLICY markups_select ON cde.revision_markups FOR SELECT TO cde_app
  USING (EXISTS (SELECT 1 FROM cde.document_revisions r WHERE r.id = revision_id));
CREATE POLICY markups_insert ON cde.revision_markups FOR INSERT TO cde_app WITH CHECK (
  author_id = (SELECT cde.current_app_user()) AND author_org_id = (SELECT cde.current_app_org())
  AND status = 'OPEN'
  AND EXISTS (SELECT 1 FROM cde.document_revisions r WHERE r.id = revision_id)
  AND (task_id IS NULL OR EXISTS (SELECT 1 FROM cde.tasks t WHERE t.id = task_id
                                  AND t.assignee_id = (SELECT cde.current_app_user()))));
-- Risolve/riapre: l'autore, l'organizzazione che ha emesso la revisione o il Project Admin
CREATE POLICY markups_update ON cde.revision_markups FOR UPDATE TO cde_app
  USING (EXISTS (SELECT 1 FROM cde.document_revisions r WHERE r.id = revision_id
                 AND (author_id = (SELECT cde.current_app_user())
                      OR r.originator_organization_id = (SELECT cde.current_app_org())
                      OR cde.has_project_permission((SELECT cde.current_app_user()), r.project_id, 'ADMIN', 'PROJECT'))))
  WITH CHECK (resolved_by IS NULL OR resolved_by = (SELECT cde.current_app_user()));

CREATE POLICY markup_replies_select ON cde.markup_replies FOR SELECT TO cde_app
  USING (EXISTS (SELECT 1 FROM cde.revision_markups m WHERE m.id = markup_id));
CREATE POLICY markup_replies_insert ON cde.markup_replies FOR INSERT TO cde_app WITH CHECK (
  author_id = (SELECT cde.current_app_user())
  AND EXISTS (SELECT 1 FROM cde.revision_markups m WHERE m.id = markup_id));

GRANT SELECT, INSERT ON cde.revision_markups, cde.markup_replies TO cde_app;
GRANT UPDATE (status, resolved_by, resolved_at) ON cde.revision_markups TO cde_app;
