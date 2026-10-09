import type { FormData, FormSchema } from '@fieldview/form-core'
import type { FormTemplate } from '../api/types'
import type { TaskDraft } from './TaskForm'

/** Regola MVP: un select/multiselect con un'opzione tipo "Non conforme" propone un task. */
export const NON_CONFORMITY_RE = /non\s*conform/i

/** Prima non conformità trovata nelle risposte, con l'etichetta del campo che la contiene. */
export function findNonConformity(schema: FormSchema, data: FormData): { label: string; value: string } | null {
  for (const f of schema.fields) {
    const v = data[f.id]
    if (f.type === 'select' && typeof v === 'string' && NON_CONFORMITY_RE.test(v)) return { label: f.label, value: v }
    if (f.type === 'multiselect' && Array.isArray(v)) {
      const hit = v.find((x) => NON_CONFORMITY_RE.test(x))
      if (hit) return { label: f.label, value: hit }
    }
  }
  return null
}

/**
 * Bozza di task pre-compilata dalle risposte: titolo dalla non conformità (o dal
 * modulo), descrizione con i campi testuali e le scelte, così chi riceve il task
 * capisce il problema senza aprire il modulo.
 */
export function taskDraftFromSubmission(template: FormTemplate, data: FormData, pinLabel?: string | null): TaskDraft {
  const schema = template.schema_def as FormSchema
  const nc = findNonConformity(schema, data)
  const lines: string[] = []
  for (const f of schema.fields) {
    const v = data[f.id]
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue
    if (f.type === 'text' || f.type === 'textarea' || f.type === 'select' || f.type === 'number' || f.type === 'date') {
      lines.push(`${f.label}: ${v}`)
    } else if (f.type === 'multiselect') {
      lines.push(`${f.label}: ${(v as string[]).join(', ')}`)
    }
  }
  const where = pinLabel ? ` (${pinLabel})` : ''
  return {
    title: nc ? `${nc.value} — ${template.name}${where}` : `${template.name}${where}`,
    description: [`Da modulo "${template.name}"`, ...lines].join('\n'),
  }
}
