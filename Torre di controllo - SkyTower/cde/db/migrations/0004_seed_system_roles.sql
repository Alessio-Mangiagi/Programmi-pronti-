-- "><(((º> sabusabu <º)))><"
-- depends: 0003_rls
-- =====================================================================
-- CDE ISO 19650 — Migrazione 0004 (Sprint 1, G3)
-- Ruoli di sistema e matrice dei permessi (dati di riferimento, non di test).
-- =====================================================================

INSERT INTO cde.roles (project_id, code, name, description, is_system) VALUES
  (NULL, 'PROJECT_ADMIN',       'Amministratore di progetto',      'Configura progetto, organizzazioni, ruoli', true),
  (NULL, 'INFORMATION_MANAGER', 'Information Manager ISO 19650',   'Governa il CDE e i flussi informativi',     true),
  (NULL, 'DIRETTORE_LAVORI',    'Direttore dei Lavori',            'Approva la documentazione per costruzione', true),
  (NULL, 'ORG_ADMIN',           'Amministratore di organizzazione','Gestisce i colleghi e i container propri',  true),
  (NULL, 'LEAD_DESIGNER',       'Capo progettista',                'Verifica e approva internamente',           true),
  (NULL, 'DESIGNER',            'Progettista',                     'Produce informazioni',                      true),
  (NULL, 'SUBCONTRACTOR',       'Subappaltatore',                  'Produce informazioni nel proprio perimetro',true),
  (NULL, 'VIEWER',              'Sola lettura',                    'Consultazione',                             true);

INSERT INTO cde.role_permissions (role_id, action, scope)
SELECT r.id, m.action::cde.permission_action, m.scope::cde.permission_scope
FROM (VALUES
  ('PROJECT_ADMIN',       'ADMIN',    'PROJECT'),
  ('INFORMATION_MANAGER', 'READ',     'PROJECT'),
  ('INFORMATION_MANAGER', 'DOWNLOAD', 'PROJECT'),
  ('INFORMATION_MANAGER', 'ADMIN',    'OWN_ORGANIZATION'),
  ('DIRETTORE_LAVORI',    'READ',     'OWN_ORGANIZATION'),
  ('DIRETTORE_LAVORI',    'DOWNLOAD', 'OWN_ORGANIZATION'),
  ('DIRETTORE_LAVORI',    'APPROVE',  'OWN_ORGANIZATION'),
  ('ORG_ADMIN',           'ADMIN',    'OWN_ORGANIZATION'),
  ('LEAD_DESIGNER',       'READ',     'OWN_ORGANIZATION'),
  ('LEAD_DESIGNER',       'WRITE',    'OWN_ORGANIZATION'),
  ('LEAD_DESIGNER',       'DOWNLOAD', 'OWN_ORGANIZATION'),
  ('LEAD_DESIGNER',       'APPROVE',  'OWN_ORGANIZATION'),
  ('DESIGNER',            'READ',     'OWN_ORGANIZATION'),
  ('DESIGNER',            'WRITE',    'OWN_ORGANIZATION'),
  ('DESIGNER',            'DOWNLOAD', 'OWN_ORGANIZATION'),
  ('SUBCONTRACTOR',       'READ',     'OWN_ORGANIZATION'),
  ('SUBCONTRACTOR',       'WRITE',    'OWN_ORGANIZATION'),
  ('SUBCONTRACTOR',       'DOWNLOAD', 'OWN_ORGANIZATION'),
  ('VIEWER',              'READ',     'OWN_ORGANIZATION')
) AS m(role_code, action, scope)
JOIN cde.roles r ON r.code = m.role_code AND r.project_id IS NULL;
