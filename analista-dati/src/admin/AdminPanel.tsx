import { useState } from 'react'
import type { AuthUser } from '../api'
import type { HealthLite } from './adminTypes'
import { JobsTab } from './JobsTab'
import { ConnectionsTab } from './ConnectionsTab'
// "><(((º> sabusabu <º)))><"
import { UsersTab } from './UsersTab'
import { UsageTab } from './UsageTab'
import { LogsTab } from './LogsTab'
import { ClaudeKeyTab } from './ClaudeKeyTab'

// ── Pannello amministrazione (Job / Connessioni / Utenti / Consumo / Chiave AI / Log) ──
export function AdminPanel({ me, health, onClose, onConnectionsChanged }: {
  me: AuthUser; health: HealthLite; onClose: () => void; onConnectionsChanged?: () => void
}) {
  const [tab, setTab] = useState<'jobs' | 'connections' | 'users' | 'usage' | 'aikey' | 'logs'>('jobs')
  const isAdmin = me.role === 'admin'
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div className="modal-tabs">
            <button className={tab === 'jobs' ? 'active' : ''} onClick={() => setTab('jobs')}>Report pianificati</button>
            <button className={tab === 'connections' ? 'active' : ''} onClick={() => setTab('connections')}>Connessioni</button>
            {isAdmin && <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Utenti</button>}
            {isAdmin && <button className={tab === 'usage' ? 'active' : ''} onClick={() => setTab('usage')}>Consumo Claude</button>}
            {isAdmin && <button className={tab === 'aikey' ? 'active' : ''} onClick={() => setTab('aikey')}>Chiave AI</button>}
            {isAdmin && <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>Log utenti</button>}
          </div>
          <button className="btn-disconnect" onClick={onClose}>Chiudi</button>
        </div>
        <div className="modal-body">
          {tab === 'jobs' && <JobsTab isAdmin={isAdmin} health={health} />}
          {tab === 'connections' && <ConnectionsTab isAdmin={isAdmin} onChanged={onConnectionsChanged} />}
          {tab === 'users' && isAdmin && <UsersTab meId={me.id} />}
          {tab === 'usage' && isAdmin && <UsageTab />}
          {tab === 'aikey' && isAdmin && <ClaudeKeyTab />}
          {tab === 'logs' && isAdmin && <LogsTab />}
        </div>
      </div>
    </div>
  )
}
