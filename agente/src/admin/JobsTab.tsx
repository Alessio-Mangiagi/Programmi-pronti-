import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { IconPlay, IconPause, IconCheck, IconTrash, IconDownload } from '../icons'
import type { HealthLite, Job, Provider, Run, SavedConn } from './adminTypes'

// ── Tab: Report pianificati ───────────────────────────────────────────────────
const CRON_PRESETS: Array<{ label: string; cron: string }> = [
  { label: 'Ogni giorno 08:00', cron: '0 8 * * *' },
  { label: 'Lun 08:00', cron: '0 8 * * 1' },
  { label: 'Primo del mese 07:00', cron: '0 7 1 * *' },
  { label: 'Ogni ora', cron: '0 * * * *' },
]

export function JobsTab({ isAdmin, health }: { isAdmin: boolean; health: HealthLite }) {
  const [jobs, setJobs] = useState<Job[]>([])
  const [conns, setConns] = useState<SavedConn[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [name, setName] = useState('')
  const [connId, setConnId] = useState<number | ''>('')
  const [theme, setTheme] = useState('')
  const [cron, setCron] = useState('0 8 * * *')
  const [provider, setProvider] = useState<Provider>('ollama')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')

  const load = async () => {
    const [j, c, r] = await Promise.all([
      apiFetch('/api/jobs').then(x => x.json()),
      apiFetch('/api/connections').then(x => x.json()),
      apiFetch('/api/runs').then(x => x.json()),
    ])
    setJobs(j.jobs || []); setConns(c.connections || []); setRuns(r.runs || [])
    if (!connId && c.connections?.[0]) setConnId(c.connections[0].id)
  }
  useEffect(() => { load() }, [])

  const create = async () => {
    setErr(''); setMsg('')
    try {
      const r = await apiFetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, connectionId: connId, theme, cron, provider }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Errore')
      setName(''); setTheme(''); setMsg('Job creato'); load()
    } catch (e) { setErr((e as Error).message) }
  }
  const toggle = async (job: Job) => {
    await apiFetch(`/api/jobs/${job.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !job.enabled }) })
    load()
  }
  const runNow = async (job: Job) => {
    setMsg(''); setErr('')
    const r = await apiFetch(`/api/jobs/${job.id}/run`, { method: 'POST' })
    if (r.ok) { setMsg(`«${job.name}» in esecuzione… aggiorna tra poco`); setTimeout(load, 2500) }
  }
  const del = async (job: Job) => {
    if (!confirm(`Eliminare il job «${job.name}»?`)) return
    await apiFetch(`/api/jobs/${job.id}`, { method: 'DELETE' }); load()
  }
  const connName = (id: number) => conns.find(c => c.id === id)?.name || `#${id}`

  return (
    <div className="admin-cols">
      <div className="admin-col">
        <h3>Job attivi</h3>
        {jobs.length === 0 && <div className="muted">Nessun report pianificato.</div>}
        {jobs.map(j => (
          <div key={j.id} className="job-row">
            <div className="job-main">
              <div className="job-name">{j.name} {j.enabled ? '' : <span className="muted">(disattivo)</span>}</div>
              <div className="job-sub">{connName(j.connection_id)} · <code>{j.cron}</code> · {j.provider || 'default'}</div>
              <div className="job-sub">tema: {j.theme}</div>
              {j.last_run && <div className="job-sub">ultimo: {new Date(j.last_run).toLocaleString('it-IT')} — {j.last_status}</div>}
            </div>
            {isAdmin && (
              <div className="job-actions">
                <button onClick={() => runNow(j)} title="Esegui ora"><IconPlay size={13} /></button>
                <button onClick={() => toggle(j)} title={j.enabled ? 'Disattiva' : 'Attiva'}>{j.enabled ? <IconPause size={13} /> : <IconCheck size={13} />}</button>
                <button onClick={() => del(j)} title="Elimina"><IconTrash size={13} /></button>
              </div>
            )}
          </div>
        ))}

        <h3 style={{ marginTop: 20 }}>Esecuzioni recenti</h3>
        {runs.length === 0 && <div className="muted">Nessuna esecuzione.</div>}
        {runs.slice(0, 15).map(r => (
          <div key={r.id} className="run-row">
            <span className={`run-status ${r.status}`}>{r.status}</span>
            <span className="muted">{new Date(r.started_at).toLocaleString('it-IT')}</span>
            {r.status === 'ok' && r.filename
              ? <a href={`/api/runs/${r.id}/download`}><IconDownload size={12} /> {r.sections} fogli{r.engine === 'python' ? ' · grafici' : ''}</a>
              : <span className="run-err">{r.error || ''}</span>}
          </div>
        ))}
      </div>

      {isAdmin && (
        <div className="admin-col">
          <h3>Nuovo report pianificato</h3>
          {conns.length === 0 ? (
            <div className="muted">Prima salva almeno una connessione (tab «Connessioni»).</div>
          ) : (
            <>
              <div className="field"><label>Nome</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="es. Vendite settimanali" /></div>
              <div className="field"><label>Connessione</label>
                <select value={connId} onChange={e => setConnId(Number(e.target.value))}>
                  {conns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
                </select></div>
              <div className="field"><label>Tema del report</label>
                <input value={theme} onChange={e => setTheme(e.target.value)} placeholder="es. analisi vendite mensili" /></div>
              <div className="field"><label>Pianificazione (cron)</label>
                <input value={cron} onChange={e => setCron(e.target.value)} placeholder="min ora giorno mese giorno-sett" />
                <div className="preset-chips">
                  {CRON_PRESETS.map(p => <button key={p.cron} className="chip" onClick={() => setCron(p.cron)}>{p.label}</button>)}
                </div></div>
              <div className="field"><label>Motore AI</label>
                <select value={provider} onChange={e => setProvider(e.target.value as Provider)}>
                  <option value="ollama">Ollama (locale)</option>
                  <option value="local" disabled={!health.local}>AI locale</option>
                  <option value="claude" disabled={!health.claude}>Claude</option>
                </select></div>
              <button className="btn-primary" onClick={create} disabled={!name || !theme || !connId}>Crea job</button>
              {msg && <div className="ok-note">{msg}</div>}
              {err && <div className="err-card" style={{ marginTop: 10 }}>{err}</div>}
            </>
          )}
        </div>
      )}
    </div>
  )
}
