import { getToken, onUnauthorized } from '../auth/token'
import type { Plan } from './types'

export const PLAN_FILE_ACCEPT = 'image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf'
export const PLAN_FILE_MAX_BYTES = 20 * 1024 * 1024

/**
 * Upload multipart con progresso. `fetch` non espone l'avanzamento dell'invio,
 * quindi qui si usa XMLHttpRequest; il resto del client resta su openapi-fetch.
 */
export function uploadPlanFile(planId: string, file: File, onProgress?: (fraction: number) => void): Promise<Plan> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `/api/plans/${encodeURIComponent(planId)}/file`)
    xhr.setRequestHeader('Authorization', `Bearer ${getToken() ?? ''}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total)
    }
    xhr.onerror = () => reject(new Error('Errore di rete durante il caricamento'))
    xhr.onload = () => {
      if (xhr.status === 401) {
        onUnauthorized()
        return reject(new Error('Sessione scaduta'))
      }
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* risposta non JSON: gestita sotto */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) return resolve(body as Plan)
      const detail = (body as { detail?: unknown } | null)?.detail
      reject(new Error(typeof detail === 'string' ? UPLOAD_ERRORS[detail] ?? detail : `Caricamento fallito (${xhr.status})`))
    }
    const form = new FormData()
    form.append('file', file, file.name)
    xhr.send(form)
  })
}

// Messaggi del backend tradotti per l'utente.
const UPLOAD_ERRORS: Record<string, string> = {
  'only JPEG, PNG or PDF allowed': 'Formato non supportato: usa PNG, JPG o PDF',
  'cannot render PDF': 'Il PDF non si riesce a convertire in immagine',
  'cannot read image': "Impossibile leggere l'immagine",
}
