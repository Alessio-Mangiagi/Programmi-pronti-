import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch'
import type { PinSummary, Plan } from '../api/types'
import { useAuthBlobUrl } from '../hooks/useAuthBlobUrl'
import PinMarker, { relativePoint } from './PinMarker'

type Props = {
  plan: Plan
  pins: PinSummary[]
  selectedId?: string | null
  /** In modalità "add" un click sulla planimetria chiama onAddAt invece di selezionare. */
  addMode?: boolean
  /** I pin si possono trascinare (chiama onMovePin al rilascio). */
  editable?: boolean
  onSelectPin?: (pin: PinSummary) => void
  onAddAt?: (x: number, y: number) => void
  onMovePin?: (pin: PinSummary, x: number, y: number) => void
}

const MIN_SCALE = 0.05
const MAX_SCALE = 10
const CLICK_THRESHOLD_PX = 4

/**
 * Planimetria con pan/zoom e overlay di pin.
 * L'immagine viene resa alle sue dimensioni native (width_px × height_px) dentro
 * il livello trasformabile; i pin sono posizionati in percentuale (x/y relativi 0-1)
 * e scalati inversamente allo zoom, così restano della stessa dimensione a schermo.
 */
export default function PlanViewer({
  plan,
  pins,
  selectedId,
  addMode,
  editable,
  onSelectPin,
  onAddAt,
  onMovePin,
}: Props) {
  const { url, loading, failed } = useAuthBlobUrl(plan.file_url)
  const wrapperRef = useRef<ReactZoomPanPinchContentRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const pressStart = useRef<{ x: number; y: number } | null>(null)
  const [scale, setScale] = useState(1)
  const width = plan.width_px ?? 0
  const height = plan.height_px ?? 0

  // Scala che fa entrare tutta la planimetria nel contenitore, con un po' di margine.
  const fitScale = useCallback(() => {
    const el = containerRef.current
    if (!el || !width || !height) return 1
    return Math.min(el.clientWidth / width, el.clientHeight / height) * 0.95
  }, [width, height])

  const fit = useCallback(() => {
    const s = Math.max(MIN_SCALE, fitScale())
    wrapperRef.current?.centerView(s, 0)
    setScale(s)
  }, [fitScale])

  // Al primo render dell'immagine adatta allo schermo; poi a ogni cambio di
  // dimensione del contenitore (finestra, apertura del pannello laterale).
  useEffect(() => {
    if (!url || !containerRef.current) return
    fit()
    const observer = new ResizeObserver(() => fit())
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [url, fit])

  // Click sul canvas (non drag): in modalità add crea un pin nel punto cliccato.
  function onCanvasPointerDown(e: PointerEvent<HTMLDivElement>) {
    pressStart.current = { x: e.clientX, y: e.clientY }
  }
  function onCanvasPointerUp(e: PointerEvent<HTMLDivElement>) {
    const start = pressStart.current
    pressStart.current = null
    if (!start || !addMode || !canvasRef.current) return
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > CLICK_THRESHOLD_PX) return
    if ((e.target as HTMLElement).closest('.pin')) return
    const { x, y } = relativePoint(canvasRef.current, e.clientX, e.clientY)
    onAddAt?.(x, y)
  }

  if (!plan.file_url) return <div className="plan-viewer-empty">Planimetria senza file: caricala prima di aggiungere pin.</div>
  if (failed) return <div className="plan-viewer-empty">Impossibile caricare l'immagine della planimetria.</div>

  return (
    <div className={`plan-viewer${addMode ? ' plan-viewer-add' : ''}`} ref={containerRef}>
      {(loading || !url) && <div className="plan-viewer-empty">Caricamento planimetria…</div>}
      {url && (
        <TransformWrapper
          ref={wrapperRef}
          minScale={MIN_SCALE}
          maxScale={MAX_SCALE}
          limitToBounds={false}
          centerOnInit
          wheel={{ step: 0.15 }}
          doubleClick={{ disabled: true }}
          panning={{ velocityDisabled: true, excluded: ['pin'] }}
          onTransform={(_, state) => setScale(state.scale)}
        >
          <TransformComponent wrapperClass="plan-viewer-wrapper" contentClass="plan-viewer-content">
            <div
              className="plan-canvas"
              ref={canvasRef}
              style={{ width, height }}
              onPointerDown={onCanvasPointerDown}
              onPointerUp={onCanvasPointerUp}
            >
              <img src={url} width={width} height={height} alt={plan.name} draggable={false} />
              {pins.map((pin) => (
                <PinMarker
                  key={pin.id}
                  pin={pin}
                  scale={scale}
                  selected={pin.id === selectedId}
                  canvasRef={canvasRef}
                  draggable={editable && !addMode}
                  onClick={onSelectPin ? () => onSelectPin(pin) : undefined}
                  onMove={onMovePin ? (x, y) => onMovePin(pin, x, y) : undefined}
                />
              ))}
            </div>
          </TransformComponent>
        </TransformWrapper>
      )}
      {addMode && <div className="plan-hint">Clicca sulla planimetria per posizionare il pin</div>}
      <div className="plan-toolbar">
        <button className="btn" onClick={() => wrapperRef.current?.zoomIn(0.3)} title="Zoom avanti">
          +
        </button>
        <button className="btn" onClick={() => wrapperRef.current?.zoomOut(0.3)} title="Zoom indietro">
          −
        </button>
        <button className="btn" onClick={fit} title="Adatta allo schermo">
          ⤢
        </button>
        <span className="muted small plan-zoom">{Math.round(scale * 100)}%</span>
      </div>
    </div>
  )
}
