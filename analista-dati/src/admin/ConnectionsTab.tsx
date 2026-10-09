import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
// "><(((º> sabusabu <º)))><"
import { IconAlert, IconTrash } from '../icons'
import type { SavedConn } from './adminTypes'

// ── Tab: Connessioni salvate ──────────────────────────────────────────────────
export function ConnectionsTab({ isAdmin, onChanged }: { isAdmin: boolean; onChanged?: () => void }) {
  const [conns, setConns] = useState<SavedConn[]>([])
  const [store, setStore] = useState(true)
  const load = async () => {
    const d = await apiFetch('/api/connections').then(x => x.json())
    setConns(d.connections || []); setStore(d.store !== false)
  }
  useEffect(() => { load() }, [])
  const del = async (c: SavedConn) => {
    if (!confirm(`Eliminare la connessione «${c.name}»?`)) return
    await apiFetch(`/api/connections/${c.id}`, { method: 'DELETE' })
    load(); onChanged?.()
  }
  return (
    <div>
      {!store && <div className="err-card" style={{ marginBottom: 12 }}><IconAlert size={15} /><span>MASTER_PASSWORD non impostata: impossibile salvare connessioni cifrate.</span></div>}
      <h3>Connessioni salvate (credenziali cifrate)</h3>
      <div className="muted" style={{ marginBottom: 10 }}>Per crearne una: compila il form di connessione nella schermata principale e premi «Salva connessione».</div>
      {conns.length === 0 && <div className="muted">Nessuna connessione salvata.</div>}
      {conns.map(c => (
        <div key={c.id} className="job-row">
          <div className="job-main">
            <div className="job-name">{c.name} <span className="muted">({c.kind})</span></div>
            <div className="job-sub">creata da {c.created_by} · {new Date(c.created_at).toLocaleDateString('it-IT')}</div>
          </div>
          {isAdmin && <div className="job-actions"><button onClick={() => del(c)} title="Elimina"><IconTrash size={13} /></button></div>}
        </div>
      ))}
    </div>
  )
}
