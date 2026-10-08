import { getToken, onUnauthorized } from '../auth/token'
import type { Attachment, PcqPreview, Plan, WbsImportResult } from './types'

export const PLAN_FILE_ACCEPT = 'image/png,image/jpeg,application/pdf,.png,.jpg,.jpeg,.pdf'
export const PLAN_FILE_MAX_BYTES = 20 * 1024 * 1024

/** Immagine della planimetria (PNG/JPG/PDF). */
export function uploadPlanFile(planId: string, file: File, onProgress?: (fraction: number) => void): Promise<Plan> {
  return uploadMultipart(`/api/plans/${encodeURIComponent(planId)}/file`, file, onProgress)
}

/** Byte di un allegato già creato con POST /attachments. */
export function uploadAttachmentFile(attachmentId: string, file: File, onProgress?: (fraction: number) => void): Promise<Attachment> {
  return uploadMultipart(`/api/attachments/${encodeURIComponent(attachmentId)}/upload`, file, onProgress)
}

export const WBS_FILE_ACCEPT = '.xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv'

/** Albero WBS da Excel/CSV; con dryRun solo l'anteprima riga per riga (niente scritto). */
export function importWbsFile(projectId: string, file: File, dryRun: boolean): Promise<WbsImportResult> {
  return uploadMultipart(`/api/projects/${encodeURIComponent(projectId)}/wbs/import?dry_run=${dryRun}`, file)
}

export const PCQ_FILE_ACCEPT = '.docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf'
export const PCQ_FILE_MAX_BYTES = 20 * 1024 * 1024

/** Errore lato client (formato/dimensione) prima di mandare un PCQ al server. */
export function pcqFileError(f: File): string | undefined {
  const ext = f.name.slice(f.name.lastIndexOf('.')).toLowerCase()
  if (ext === '.doc') return 'Formato .doc non supportato: salva come .docx'
  if (ext !== '.docx' && ext !== '.pdf') return 'Formato non supportato: usa Word (.docx) o PDF'
  if (f.size > PCQ_FILE_MAX_BYTES) return `File troppo grande (max ${Math.round(PCQ_FILE_MAX_BYTES / 1024 / 1024)} MB)`
}

/** Legge un PCQ Word/PDF e restituisce titoli e tabelle (solo anteprima, niente scritto). */
export function previewPcqFile(projectId: string | null, file: File, onProgress?: (fraction: number) => void): Promise<PcqPreview> {
  const url = projectId ? `/api/projects/${encodeURIComponent(projectId)}/pcq/preview` : '/api/pcq/preview'
  return uploadMultipart(url, file, onProgress)
}

/**
 * Upload multipart con progresso. `fetch` non espone l'avanzamento dell'invio,
 * quindi qui si usa XMLHttpRequest; il resto del client resta su openapi-fetch.
 */
export function uploadMultipart<T>(url: string, file: File, onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
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
      if (xhr.status >= 200 && xhr.status < 300 && body) return resolve(body as T)
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
  'cannot read xlsx': 'File Excel non leggibile',
  'xls not supported: save as xlsx or csv': 'Formato .xls non supportato: salva come .xlsx o .csv',
  'empty file': 'Il file è vuoto',
  'cannot read docx': 'File Word non leggibile',
  'cannot read pdf': 'PDF non leggibile',
  'doc not supported: save as docx': 'Formato .doc non supportato: salva come .docx',
  'only docx or pdf allowed': 'Formato non supportato: usa Word (.docx) o PDF',
}
