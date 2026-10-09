import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { IconDownload } from '../icons'

// ── Tab: Log utenti (audit) ───────────────────────────────────────────────────
interface LogRow {
  ts: string; event: string; user?: string; clientIp?: string; clientHost?: string
  [k: string]: unknown
}
const LOG_BASE_COLS = new Set(['ts', 'event', 'user', 'clientIp', 'clientHost', 'serverHost', 'serverUser'])

export function LogsTab() {
  // "><(((º> sabusabu <º)))><"
  const [logs, setLogs] = useState<LogRow[]>([])
  const [userF, setUserF] = useState('')
  const [eventF, setEventF] = useState('')
  const [loading, setLoading] = useState(false)

  const query = () => {
    const p = new URLSearchParams()
    if (userF) p.set('user', userF)
    if (eventF) p.set('event', eventF)
    return p.toString()
  }
  const load = async () => {
    setLoading(true)
    try {
      const d = await apiFetch(`/api/logs?limit=500&${query()}`).then(x => x.json())
      setLogs(d.logs || [])
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [userF, eventF])

  // Valori distinti per i filtri, ricavati dai log caricati
  const usersSeen = [...new Set(logs.map(l => l.user).filter(u => u && u !== '-'))].sort()
  const eventsSeen = [...new Set(logs.map(l => l.event))].sort()

  const extraOf = (l: LogRow) => {
    const o = Object.fromEntries(Object.entries(l).filter(([k]) => !LOG_BASE_COLS.has(k)))
    return Object.keys(o).length ? JSON.stringify(o) : ''
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Utente</label>
          <select value={userF} onChange={e => setUserF(e.target.value)}>
            <option value="">Tutti</option>
            {usersSeen.map(u => <option key={u} value={u as string}>{u}</option>)}
          </select>
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label>Evento</label>
          <select value={eventF} onChange={e => setEventF(e.target.value)}>
            <option value="">Tutti</option>
            {eventsSeen.map(ev => <option key={ev} value={ev}>{ev}</option>)}
          </select>
        </div>
        <button className="btn-report ghost" onClick={load} disabled={loading}>
          {loading ? 'Carico…' : 'Aggiorna'}
        </button>
        <a className="btn-report" href={`/api/logs/export.csv?${query()}`} download>
          <IconDownload size={14} /> Scarica CSV
        </a>
      </div>

      {logs.length === 0 ? <div className="muted">Nessuna voce di log.</div> : (
        <div style={{ overflowX: 'auto' }}>
          <table className="usage-table" style={{ width: '100%', fontSize: 12.5 }}>
            <thead><tr>
              <th style={{ textAlign: 'left' }}>Quando</th>
              <th style={{ textAlign: 'left' }}>Evento</th>
              <th style={{ textAlign: 'left' }}>Utente</th>
              <th style={{ textAlign: 'left' }}>PC / IP</th>
              <th style={{ textAlign: 'left' }}>Dettagli</th>
            </tr></thead>
            <tbody>
              {logs.map((l, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(l.ts).toLocaleString('it-IT')}</td>
                  <td><code>{l.event}</code></td>
                  <td>{l.user && l.user !== '-' ? l.user : <span className="muted">—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{l.clientHost !== '-' ? l.clientHost : ''} <span className="muted">{l.clientIp}</span></td>
                  <td style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={extraOf(l)}>{extraOf(l)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="muted" style={{ marginTop: 8 }}>Ultime 500 voci (più recenti in alto). Il CSV esporta fino a 10.000 voci coi filtri correnti.</div>
    </div>
  )
}
