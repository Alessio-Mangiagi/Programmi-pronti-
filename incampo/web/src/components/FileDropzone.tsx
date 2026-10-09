import { useRef, useState, type DragEvent } from 'react'
import Icon from './Icon'

type Props = {
  accept: string
  multiple?: boolean
  disabled?: boolean
  title: string
  hint?: string
  onFiles: (files: File[]) => void
  testId?: string
}

/** Riquadro "trascina qui" con il pulsante per scegliere i file in alternativa. */
export default function FileDropzone({ accept, multiple, disabled, title, hint, onFiles, testId }: Props) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0) // dragenter/leave scattano anche sui figli: si contano
  const inputRef = useRef<HTMLInputElement>(null)

  function take(list: FileList | null) {
    const files = Array.from(list ?? [])
    if (!disabled && files.length) onFiles(multiple ? files : files.slice(0, 1))
  }

  function onDragEnter(e: DragEvent) {
    e.preventDefault()
    depth.current += 1
    setDragging(true)
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault()
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    depth.current = 0
    setDragging(false)
    take(e.dataTransfer.files)
  }

  return (
    <div
      className={`pcq-drop${dragging && !disabled ? ' is-dragging' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Icon name="upload" className="pcq-drop-icon" />
      <p className="pcq-drop-title">{dragging && !disabled ? 'Rilascia per caricare' : title}</p>
      {hint && <p className="muted small">{hint}</p>}
      <button type="button" className="btn btn-primary" onClick={() => inputRef.current?.click()} disabled={disabled}>
        Scegli {multiple ? 'i file' : 'il file'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        data-testid={testId}
        onChange={(e) => {
          take(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
