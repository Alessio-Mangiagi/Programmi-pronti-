import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { newLocalAttachment, type AttachmentMap, type LocalAttachment } from '../attachments'
import { AttachmentThumb } from './PhotoInput'

type Props = {
  /** id dell'allegato PNG della firma, o null */
  value: string | null
  attachments: AttachmentMap
  readOnly?: boolean
  invalid?: boolean
  onChange: (id: string | null, added: LocalAttachment | null, removed: string | null) => void
}

const W = 480
const H = 160

/**
 * Firma a mano libera su canvas (mouse, dito o penna). Al rilascio del
 * tratto il canvas viene esportato in PNG e diventa un allegato locale;
 * "Cancella" rimuove firma e allegato.
 */
export default function SignatureInput({ value, attachments, readOnly, invalid, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasInk, setHasInk] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1c2430'
  }, [value])

  function point(e: PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H }
  }

  function down(e: PointerEvent<HTMLCanvasElement>) {
    if (readOnly) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drawing.current = true
    const p = point(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    ctx.lineTo(p.x + 0.1, p.y + 0.1) // un tap lascia un punto
    ctx.stroke()
    setHasInk(true)
  }

  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = point(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  function up(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    drawing.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    exportPng()
  }

  function exportPng() {
    const canvas = canvasRef.current
    if (!canvas) return
    setExporting(true)
    canvas.toBlob((blob) => {
      setExporting(false)
      if (!blob) return
      const att = newLocalAttachment(new File([blob], 'firma.png', { type: 'image/png' }), 'signature')
      onChange(att.id, att, value)
    }, 'image/png')
  }

  function clear() {
    const canvas = canvasRef.current
    canvas?.getContext('2d')?.clearRect(0, 0, W, H)
    setHasInk(false)
    onChange(null, null, value)
  }

  // Firma già salvata (o appena confermata e non più in modifica): mostra il PNG.
  if (value && attachments[value] && (readOnly || !hasInk)) {
    return (
      <div className={`signature-input${invalid ? ' is-invalid' : ''}`}>
        <AttachmentThumb attachments={attachments} id={value} className="signature-img" />
        {!readOnly && (
          <button type="button" className="btn small" onClick={clear}>
            Rifai la firma
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={`signature-input${invalid ? ' is-invalid' : ''}`}>
      <canvas
        ref={canvasRef}
        width={W}
        height={H}
        className="signature-canvas"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        aria-label="Area firma"
      />
      <div className="row" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="btn small" onClick={clear} disabled={!hasInk || exporting}>
          Cancella
        </button>
        <span className="muted small">{hasInk ? 'Firma acquisita' : 'Firma qui con dito, penna o mouse'}</span>
      </div>
    </div>
  )
}
