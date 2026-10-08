import { useState } from 'react'
import { isFieldItem } from '@fieldview/form-core'
import { PCQ_FILE_ACCEPT, PCQ_FILE_MAX_BYTES, pcqFileError, previewPcqFile } from '../api/upload'
import { formatBytes } from '../format'
import { pcqToSchema, type PcqConversion } from '../forms/pcqToSchema'
import FileDropzone from './FileDropzone'
import Modal from './Modal'

const plural = (n: number) => (n === 1 ? '1 campo' : `${n} campi`)

type Props = {
  /** Il modulo ha già dei campi: l'import li sostituisce, lo si dice prima. */
  replacing: boolean
  onApply: (conv: PcqConversion) => void
  onClose: () => void
}

/**
 * Import di un PCQ Word/PDF nell'editor dei moduli: si trascina il file, il server lo
 * legge, qui si converte in bozza di modulo e se ne mostra il riepilogo prima di usarlo.
 */
export default function PcqImportModal({ replacing, onApply, onClose }: Props) {
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [conv, setConv] = useState<PcqConversion | null>(null)

  async function read([f]: File[]) {
    setFile(f)
    setConv(null)
    setWarnings([])
    setError(pcqFileError(f) ?? null)
    if (pcqFileError(f)) return
    setProgress(0)
    try {
      const preview = await previewPcqFile(null, f, setProgress)
      const c = pcqToSchema(preview)
      setWarnings(preview.warnings)
      if (c.controls === 0) setError('Nel file non ho trovato controlli da trasformare in campi')
      else setConv(c)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lettura fallita')
    } finally {
      setProgress(null)
    }
  }

  const sections = conv?.schema.layout?.sections ?? []

  return (
    <Modal title="Importa da PCQ" onClose={onClose} width={720}>
      <p className="muted small">
        Ogni controllo del PCQ diventa un campo con esito <strong>Conforme / Non conforme / Non applicabile</strong> (un "Non conforme" propone
        un task); frequenza, criterio di accettazione e responsabile finiscono nel testo di aiuto. In fondo: data, note e firma. Poi rivedi tutto
        nell'editor e salvi.
      </p>
      <FileDropzone
        accept={PCQ_FILE_ACCEPT}
        disabled={progress !== null}
        title="Trascina qui il PCQ"
        hint={`Word (.docx) o PDF · max ${formatBytes(PCQ_FILE_MAX_BYTES)}`}
        onFiles={read}
        testId="pcq-template-input"
      />
      {file && (
        <p className="small pcq-file-line">
          <strong>{file.name}</strong> <span className="muted">· {formatBytes(file.size)}</span>
          {progress !== null && <span className="muted"> · {progress < 1 ? `caricamento ${Math.round(progress * 100)}%` : 'lettura…'}</span>}
        </p>
      )}
      {error && <p className="error small">{error}</p>}
      {warnings.map((w) => (
        <p key={w} className="pcq-warning small">
          {w}
        </p>
      ))}
      {conv && (
        <div className="pcq-summary">
          <p className="small">
            <strong>{conv.name}</strong> · {conv.controls} controll{conv.controls === 1 ? 'o' : 'i'} in {sections.length - 1} sezion
            {sections.length - 1 === 1 ? 'e' : 'i'}, più la chiusura
          </p>
          <ul className="pcq-summary-list small">
            {sections.map((s) => (
              <li key={s.id}>
                <span>{s.title ?? 'Senza titolo'}</span>
                <span className="muted">{plural(s.items.filter(isFieldItem).length)}</span>
              </li>
            ))}
          </ul>
          {replacing && <p className="callout callout-warn small">I campi e le sezioni già presenti nell'editor verranno sostituiti.</p>}
        </div>
      )}
      <div className="row form-actions">
        <button type="button" className="btn btn-primary" disabled={!conv} onClick={() => conv && onApply(conv)}>
          Crea il modulo dal PCQ
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Annulla
        </button>
      </div>
    </Modal>
  )
}
