/**
 * Allegati di un modulo in compilazione. In data_json i campi photo/signature
 * contengono solo id (UUID generati qui); i byte restano in memoria come File
 * finché la submission non è salvata, poi vengono caricati uno per uno
 * (POST /attachments con lo stesso id + POST /attachments/{id}/upload).
 */
export type AttachmentKind = 'photo' | 'signature'

export type LocalAttachment = {
  id: string
  kind: AttachmentKind
  file: File
  /** object URL per l'anteprima; da revocare con releaseAttachment */
  url: string
}

/** Allegato già sul server (submission esistente): basta il path da /files. */
export type RemoteAttachment = { id: string; kind: AttachmentKind | null; fileUrl: string | null }

export type AttachmentMap = Record<string, LocalAttachment | RemoteAttachment>

export const isLocal = (a: LocalAttachment | RemoteAttachment | undefined): a is LocalAttachment => !!a && 'file' in a

export function newLocalAttachment(file: File, kind: AttachmentKind): LocalAttachment {
  return { id: crypto.randomUUID(), kind, file, url: URL.createObjectURL(file) }
}

export function releaseAttachment(a: LocalAttachment | RemoteAttachment | undefined) {
  if (isLocal(a)) URL.revokeObjectURL(a.url)
}

export const PHOTO_ACCEPT = 'image/png,image/jpeg,.png,.jpg,.jpeg'
export const PHOTO_MAX_BYTES = 20 * 1024 * 1024
