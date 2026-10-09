import { useState } from 'react'
import type { Geolocation } from '@fieldview/form-core'
import Icon from '../../components/Icon'

type Props = {
  value: Geolocation | null
  readOnly?: boolean
  invalid?: boolean
  onChange: (v: Geolocation | null) => void
}

/** Posizione dal GPS del device, con inserimento manuale di lat/lng come ripiego. */
export default function GeolocationInput({ value, readOnly, invalid, onChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [gpsError, setGpsError] = useState<string | null>(null)

  function locate() {
    if (!navigator.geolocation) return setGpsError('Geolocalizzazione non disponibile su questo browser')
    setBusy(true)
    setGpsError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false)
        onChange({
          lat: round(pos.coords.latitude, 6),
          lng: round(pos.coords.longitude, 6),
          accuracy: round(pos.coords.accuracy, 1),
        })
      },
      (err) => {
        setBusy(false)
        setGpsError(err.code === err.PERMISSION_DENIED ? 'Permesso negato: inserisci le coordinate a mano' : 'Posizione non disponibile')
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }

  function setCoord(key: 'lat' | 'lng', raw: string) {
    const n = raw === '' ? null : Number(raw)
    const next = { lat: value?.lat ?? null, lng: value?.lng ?? null, [key]: Number.isFinite(n as number) ? n : null }
    if (next.lat === null && next.lng === null) return onChange(null)
    // valore parziale: il validatore lo segnala come "lat e lng numerici" finché non è completo
    onChange({ lat: next.lat as number, lng: next.lng as number })
  }

  return (
    <div className={`geo-input${invalid ? ' is-invalid' : ''}`}>
      <div className="geo-row">
        <label className="geo-coord">
          <span className="muted small">Lat</span>
          <input type="number" step="any" min={-90} max={90} value={value?.lat ?? ''} disabled={readOnly} onChange={(e) => setCoord('lat', e.target.value)} />
        </label>
        <label className="geo-coord">
          <span className="muted small">Lng</span>
          <input type="number" step="any" min={-180} max={180} value={value?.lng ?? ''} disabled={readOnly} onChange={(e) => setCoord('lng', e.target.value)} />
        </label>
        {!readOnly && (
          <button type="button" className="btn" onClick={locate} disabled={busy}>
            {busy ? 'Ricerca…' : <><Icon name="crosshair" /> Posizione attuale</>}
          </button>
        )}
      </div>
      {value?.accuracy !== undefined && <span className="muted small">precisione ±{value.accuracy} m</span>}
      {gpsError && <span className="error small">{gpsError}</span>}
    </div>
  )
}

const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d
