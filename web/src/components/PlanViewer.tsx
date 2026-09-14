import { useCallback, useEffect, useRef, useState } from 'react'
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchContentRef } from 'react-zoom-pan-pinch'
import type { PinSummary, Plan } from '../api/types'
import { useAuthBlobUrl } from '../hooks/useAuthBlobUrl'
import PinMarker from './PinMarker'

type Props = {
  plan: Plan
  pins: PinSummary[]
  selectedId?: string | null
  onSelectPin?: (pin: PinSummary) => void
}

const MIN_SCALE = 0.05
const MAX_SCALE = 10

/**
 * Planimetria con pan/zoom e overlay di pin.
 * L'immagine viene resa alle sue dimensioni native (width_px × height_px) dentro
 * il livello trasformabile; i pin sono posizionati in percentuale (x/y relativi 0-1)
 * e scalati inversamente allo zoom, così restano della stessa dimensione a schermo.
 */
export default function PlanViewer({ plan, pins, selectedId, onSelectPin }: Props) {
  const { url, loading, failed } = useAuthBlobUrl(plan.file_url)
  const wrapperRef = useRef<ReactZoomPanPinchContentRef>(null)
  const containerRef = useRef<HTMLDivElement>(null)
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

  // Al primo render dell'immagine adatta allo schermo; poi anche al resize della finestra.
  useEffect(() => {
    if (!url) return
    fit()
    const onResize = () => fit()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [url, fit])

  if (!plan.file_url) return <div className="plan-viewer-empty">Planimetria senza file: caricala prima di aggiungere pin.</div>
  if (failed) return <div className="plan-viewer-empty">Impossibile caricare l'immagine della planimetria.</div>

  return (
    <div className="plan-viewer" ref={containerRef}>
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
          panning={{ velocityDisabled: true }}
          onTransform={(_, state) => setScale(state.scale)}
        >
          <TransformComponent wrapperClass="plan-viewer-wrapper" contentClass="plan-viewer-content">
            <div className="plan-canvas" style={{ width, height }}>
              <img src={url} width={width} height={height} alt={plan.name} draggable={false} />
              {pins.map((pin) => (
                <PinMarker
                  key={pin.id}
                  pin={pin}
                  scale={scale}
                  selected={pin.id === selectedId}
                  onClick={onSelectPin ? () => onSelectPin(pin) : undefined}
                />
              ))}
            </div>
          </TransformComponent>
        </TransformWrapper>
      )}
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
