import { useRef } from 'react'
import type { PhotoField } from '@fieldview/form-core'
import AuthImage from '../../components/AuthImage'
import { isLocal, newLocalAttachment, PHOTO_ACCEPT, PHOTO_MAX_BYTES, type AttachmentMap, type LocalAttachment } from '../attachments'

type Props = {
  field: PhotoField
  /** id degli allegati (valore del campo in data_json) */
  value: string[]
  attachments: AttachmentMap
  readOnly?: boolean
  invalid?: boolean
  onChange: (ids: string[], added: LocalAttachment[], removed: string[]) => void
  onError?: (msg: string) => void
}

/** Anteprima di un allegato locale (object URL) o remoto (da /files con token). */
export function AttachmentThumb({ attachments, id, className = 'photo' }: { attachments: AttachmentMap; id: string; className?: string }) {
  const a = attachments[id]
  if (!a) return <div className={`${className} thumb-empty`}>Allegato mancante</div>
  if (isLocal(a)) return <img src={a.url} className={className} alt={a.file.name} />
  return <AuthImage fileUrl={a.fileUrl} className={className} alt="foto" />
}

/** Una o più foto (in base a `multiple`): dalla fotocamera su tablet, dal disco su desktop. */
export default function PhotoInput({ field, value, attachments, readOnly, invalid, onChange, onError }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const multiple = !!field.multiple

  function pick(files: FileList | null) {
    if (!files?.length) return
    const added: LocalAttachment[] = []
    for (const f of Array.from(files)) {
      if (f.size > PHOTO_MAX_BYTES) {
        onError?.(`${f.name}: troppo grande (max 20 MB)`)
        continue
      }
      if (!/^image\/(png|jpeg)$/.test(f.type)) {
        onError?.(`${f.name}: solo PNG o JPG`)
        continue
      }
      added.push(newLocalAttachment(f, 'photo'))
      if (!multiple) break
    }
    if (!added.length) return
    // singola: la nuova foto sostituisce quella precedente
    const removed = multiple ? [] : value
    onChange(multiple ? [...value, ...added.map((a) => a.id)] : [added[0].id], added, removed)
    if (inputRef.current) inputRef.current.value = ''
  }

  function remove(id: string) {
    onChange(
      value.filter((v) => v !== id),
      [],
      [id],
    )
  }

  return (
    <div className={`photo-input${invalid ? ' is-invalid' : ''}`}>
      {value.length > 0 && (
        <div className="photo-grid">
          {value.map((id) => (
            <div key={id} className="photo-cell">
              <AttachmentThumb attachments={attachments} id={id} />
              {!readOnly && (
                <button type="button" className="photo-remove" onClick={() => remove(id)} aria-label="Rimuovi foto">
                  ×
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {!readOnly && (multiple || value.length === 0) && (
        <label className="btn photo-add">
          {value.length === 0 ? '📷 Aggiungi foto' : '📷 Altra foto'}
          <input
            id={`df-${field.id}`}
            ref={inputRef}
            type="file"
            accept={PHOTO_ACCEPT}
            capture="environment"
            multiple={multiple}
            hidden
            onChange={(e) => pick(e.target.files)}
          />
        </label>
      )}
      {readOnly && value.length === 0 && <span className="muted small">Nessuna foto</span>}
    </div>
  )
}
