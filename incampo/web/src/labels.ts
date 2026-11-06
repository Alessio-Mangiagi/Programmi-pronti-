// "><(((º> sabusabu <º)))><"
import type { TaskStatus } from './api/types'

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Aperto',
  assigned: 'Assegnato',
  resolved: 'Risolto',
  verified: 'Verificato',
}

export const CATEGORY_LABEL: Record<string, string> = { safety: 'Sicurezza', quality: 'Qualità', diary: 'Diario', other: 'Altro' }

export const ROLE_LABEL: Record<string, string> = { admin: 'Amministratore', manager: 'Ufficio', field: 'Cantiere' }

/** Lunghezza minima delle password di InCampo: la stessa di PASSWORD_MIN in app/schemas.py (il server la
 *  ricontrolla e risponde 422). Una sola regola per creazione utenti, reset, inviti e cambio password. */
export const PASSWORD_MIN = 12
