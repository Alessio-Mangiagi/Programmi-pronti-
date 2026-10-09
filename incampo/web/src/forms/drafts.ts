import type { FormData, FormSchema } from '@fieldview/form-core'
import type { SubmissionTarget } from './SubmissionForm'

/**
 * Bozze delle compilazioni nuove, salvate nel browser a ogni modifica: chi chiude la
 * pagina o cambia sezione a metà ritrova le risposte. Le foto e la firma no: sono file
 * locali che non sopravvivono alla pagina, quindi vanno riaggiunte (lo dice l'avviso).
 * localStorage può mancare o lanciare (navigazione privata): tutto in try/catch.
 */
const PREFIX = 'incampo:bozza:'

export function draftKey(templateId: string, target: SubmissionTarget): string {
  const where = 'pinId' in target ? `pin:${target.pinId}` : 'wbsNodeId' in target ? `wbs:${target.wbsNodeId}` : `cantiere:${target.projectId}`
  return `${PREFIX}${templateId}:${where}`
}

/** Toglie foto, firme e foto delle note: riferiscono file che dopo il ricaricamento non esistono più. */
function withoutFiles(schema: FormSchema, value: FormData): FormData {
  const out: FormData = { ...value }
  for (const f of schema.fields) if (f.type === 'photo' || f.type === 'signature') delete out[f.id]
  const notes = out._notes as Record<string, { comment?: string; photos?: string[] }> | undefined
  if (notes) {
    out._notes = Object.fromEntries(
      Object.entries(notes)
        .map(([id, n]) => [id, n.comment ? { comment: n.comment } : null] as const)
        .filter(([, n]) => n !== null),
    ) as unknown as FormData[string]
  }
  return out
}

export function loadDraft(key: string): { value: FormData; savedAt: string } | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as { value: FormData; savedAt: string }) : null
  } catch {
    return null
  }
}

export function saveDraft(key: string, schema: FormSchema, value: FormData): void {
  try {
    localStorage.setItem(key, JSON.stringify({ value: withoutFiles(schema, value), savedAt: new Date().toISOString() }))
  } catch {
    /* spazio finito o storage bloccato: la bozza è un aiuto, non un requisito */
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    /* idem */
  }
}

/** Il modulo ha dati diversi dai valori iniziali? (serve a non salvare bozze vuote né avvisare per niente) */
export function isDirty(initial: FormData, value: FormData): boolean {
  return JSON.stringify(initial) !== JSON.stringify(value)
}
