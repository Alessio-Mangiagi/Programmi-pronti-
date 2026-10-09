import type { TaskStatus } from './api/types'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Aperto',
  assigned: 'Assegnato',
  resolved: 'Risolto',
  verified: 'Verificato',
}

export const CATEGORY_LABEL: Record<string, string> = { safety: 'Sicurezza', quality: 'Qualità', diary: 'Diario', other: 'Altro' }

export const ROLE_LABEL: Record<string, string> = { admin: 'Amministratore', manager: 'Ufficio', field: 'Cantiere' }
