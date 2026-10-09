import { useEffect, useState } from 'react'
import { apiFetch, type AuthUser } from '../api'
import { IconCalendar, IconChevron, IconKey, IconLock, IconLogout, IconRefresh, IconUser } from '../icons'
import type { DbKind, Health, PiiColumn, SchemaInfo, TableInfo } from '../types'
import { DB_COLORS, DB_LABELS, DB_SHORT } from '../types'
import { GlossaryPanel } from './GlossaryPanel'

interface SidebarProps {
  health: Health | null
  me: AuthUser
  schema: SchemaInfo | null
  connectedKind: DbKind | null
  clientHost: string
  onClientHostChange: (v: string) => void
  onDisconnect: () => void
  onSchemaRefreshed: (schema: SchemaInfo) => void
  onShowAdmin: () => void
  onLogout: () => void
}

export function Sidebar({
  health, me, schema, connectedKind, clientHost, onClientHostChange,
  onDisconnect, onSchemaRefreshed, onShowAdmin, onLogout,
}: SidebarProps) {
  const [schemaFilter, setSchemaFilter] = useState('')
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set())
  const [refreshing, setRefreshing] = useState(false)
  // Colonne PII del DB connesso: 🔒 visibile a tutti, toggle solo admin.
  const [pii, setPii] = useState<PiiColumn[]>([])
  const isAdmin = me.role === 'admin'

  const loadPii = async () => {
    try {
      const r = await apiFetch('/api/privacy')
      if (r.ok) setPii((await r.json()).columns || [])
    } catch { /* best-effort */ }
  }
  useEffect(() => { if (schema) loadPii(); else setPii([]) }, [schema])

  const piiOf = (table: string, column: string) =>
    pii.find(p => p.table_name.toLowerCase() === table.toLowerCase() && p.column_name.toLowerCase() === column.toLowerCase())

  const togglePii = async (table: string, column: string) => {
    const hit = piiOf(table, column)
    try {
      if (hit) await apiFetch(`/api/privacy/${hit.id}`, { method: 'DELETE' })
      else await apiFetch('/api/privacy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ table, column }),
      })
      loadPii()
    } catch { /* best-effort */ }
  }

  const toggleTable = (name: string) => {
    setExpandedTables(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      return next
    })
  }

  // Rilegge lo schema dal DB (dopo ALTER / nuove tabelle) senza riconnettersi.
  const refreshSchema = async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const r = await apiFetch('/api/schema/refresh', { method: 'POST' })
      const d = await r.json()
      if (r.ok && d.ok && d.schema) onSchemaRefreshed(d.schema)
    } catch { /* best-effort: lo schema resta quello corrente */ }
    finally { setRefreshing(false) }
  }

  const filteredTables = schema?.tables.filter(t => {
    const q = schemaFilter.toLowerCase().trim()
    if (!q) return true
    return t.name.toLowerCase().includes(q) || t.columns.some(c => c.name.toLowerCase().includes(q))
  }) ?? []

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <div className="brand">
          <img src="/favicon.webp" alt="Cosedil" width="26" height="26" />
          <h1>Agente DB</h1>
        </div>
        <div className="sb-badges">
          <span className={`badge ${health?.ollama ? 'on' : 'off'}`}>Ollama</span>
          {health?.local && <span className="badge on">Locale</span>}
          <span className={`badge ${health?.claude ? 'on' : 'off'}`}>Claude</span>
          {health?.pyreport && <span className="badge on" title="Report Excel con grafici (worker Python)">Grafici</span>}
        </div>
      </div>

      <div className="sb-body">
        {!schema ? (
          <div className="connect-hint">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity=".35">
              <ellipse cx="12" cy="5" rx="9" ry="3"/>
              <path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/>
              <path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
            </svg>
            <span>Nessun DB connesso</span>
          </div>
        ) : (
          <>
            <div className="db-badge">
              <div className="db-badge-info">
                <div className="db-kind-dot" style={{ background: DB_COLORS[connectedKind!] }}>
                  {DB_SHORT[connectedKind!]}
                </div>
                <div>
                  <div className="db-badge-name">{DB_LABELS[connectedKind!]}</div>
                  <div className="db-badge-sub">{schema.tables.length} tabelle</div>
                </div>
              </div>
              <button className="btn-disconnect" onClick={refreshSchema} disabled={refreshing}
                title="Rilegge tabelle e colonne dal database">
                <IconRefresh size={12} /> {refreshing ? '…' : ''}
              </button>
              <button className="btn-disconnect" onClick={onDisconnect}>Esci</button>
            </div>

            <div className="schema-search">
              <input
                className="sb-input"
                value={schemaFilter}
                onChange={e => setSchemaFilter(e.target.value)}
                placeholder="Cerca tabelle / colonne…"
              />
            </div>

            <div className="schema-tree">
              {filteredTables.map((t: TableInfo) => (
                <div key={t.name} className="table-node">
                  <div className="table-node-head" onClick={() => toggleTable(t.name)}>
                    <span className={`table-arrow${expandedTables.has(t.name) ? ' open' : ''}`}><IconChevron size={10} /></span>
                    <span className="table-name">{t.name}</span>
                    <span className="table-col-count">{t.columns.length}</span>
                  </div>
                  {expandedTables.has(t.name) && (
                    <div className="table-cols">
                      {t.columns.map(c => {
                        const marked = !!piiOf(t.name, c.name)
                        return (
                          <div key={c.name} className="col-row">
                            <span className={`col-name${c.pk ? ' is-pk' : ''}`}>
                              {c.pk && <IconKey size={10} />}{c.name}
                              {marked && !isAdmin && <IconLock size={10} className="pii-mark" />}
                            </span>
                            <span className="col-type">{c.type}</span>
                            {isAdmin && (
                              <button
                                className={`pii-toggle${marked ? ' active' : ''}`}
                                title={marked
                                  ? 'Colonna sensibile: esclusa dal prompt AI e mascherata nei risultati. Clic per sbloccare.'
                                  : 'Marca come sensibile (PII): esclusa dal prompt AI e mascherata nei risultati'}
                                onClick={() => togglePii(t.name, c.name)}
                              >
                                <IconLock size={10} />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Glossario aziendale: termini → colonne/formule, nel prompt AI.
                key = identità del DB: alla riconnessione ricarica le voci. */}
            <GlossaryPanel key={schema.tables.map(t => t.name).join('|')} isAdmin={isAdmin} />
          </>
        )}
      </div>

      <div className="sb-foot">
        <button className="btn-admin" onClick={onShowAdmin}>
          <IconCalendar size={15} /> Report pianificati{me.role === 'admin' ? ' / Admin' : ''}
        </button>
        <div className="user-row">
          <span className="user-name"><IconUser size={13} /> {me.username}{me.role === 'admin' ? ' · admin' : ''}</span>
          {health?.authEnabled && <button className="btn-logout" onClick={onLogout}><IconLogout size={12} /> Esci</button>}
        </div>
        <div className="sb-label">Nome PC (audit log)</div>
        <input
          className="sb-input"
          value={clientHost}
          onChange={e => onClientHostChange(e.target.value)}
          placeholder="es. PC-UFFICIO-3"
        />
      </div>
    </aside>
  )
}
