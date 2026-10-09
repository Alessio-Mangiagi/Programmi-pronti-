import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { IconBook, IconChevron, IconTrash } from '../icons'
import type { GlossaryItem } from '../types'

/**
 * GLOSSARIO AZIENDALE del DB connesso: termine → colonna/formula/spiegazione.
 * Le voci vengono iniettate nel prompt insieme allo schema, così l'LLM
 * interpreta il lessico aziendale ("SAL", "commessa"...) senza indovinare.
 * Lettura per tutti; aggiunta/rimozione solo admin.
 */
export function GlossaryPanel({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<GlossaryItem[]>([])
  const [term, setTerm] = useState('')
  const [definition, setDefinition] = useState('')
  const [err, setErr] = useState('')

  const load = async () => {
    // "><(((º> sabusabu <º)))><"
    try {
      const r = await apiFetch('/api/glossary')
      if (r.ok) setItems((await r.json()).items || [])
    } catch { /* best-effort */ }
  }
  useEffect(() => { load() }, [])

  const add = async () => {
    setErr('')
    try {
      const r = await apiFetch('/api/glossary', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term, definition }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d.error || 'Errore'); return }
      setTerm(''); setDefinition('')
      load()
    } catch { setErr('Errore di rete') }
  }

  const remove = async (id: number) => {
    try { await apiFetch(`/api/glossary/${id}`, { method: 'DELETE' }); load() } catch { /* best-effort */ }
  }

  return (
    <div className="glossary-panel">
      <div className="table-node-head" onClick={() => setOpen(o => !o)}>
        <span className={`table-arrow${open ? ' open' : ''}`}><IconChevron size={10} /></span>
        <span className="table-name"><IconBook size={12} /> Glossario</span>
        <span className="table-col-count">{items.length}</span>
      </div>
      {open && (
        <div className="glossary-body">
          {items.length === 0 && <div className="muted" style={{ fontSize: 12, padding: '4px 0' }}>
            Nessuna voce. {isAdmin ? 'Definisci i termini aziendali (es. "SAL = tabella stati_avanzamento").' : ''}
          </div>}
          {items.map(i => (
            <div key={i.id} className="glossary-row" title={i.definition}>
              <span className="glossary-term">{i.term}</span>
              <span className="glossary-def">{i.definition}</span>
              {isAdmin && (
                <button className="btn-icon" title="Elimina voce" onClick={() => remove(i.id)}>
                  <IconTrash size={12} />
                </button>
              )}
            </div>
          ))}
          {isAdmin && (
            <div className="glossary-add">
              <input className="sb-input" placeholder="Termine (es. SAL)" value={term}
                onChange={e => setTerm(e.target.value)} />
              <input className="sb-input" placeholder="Definizione (colonna/formula/significato)" value={definition}
                onChange={e => setDefinition(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && term.trim() && definition.trim()) add() }} />
              <button className="btn-report ghost" style={{ alignSelf: 'flex-start' }}
                disabled={!term.trim() || !definition.trim()} onClick={add}>Aggiungi</button>
              {err && <div className="muted" style={{ color: 'var(--danger, #cc2929)', fontSize: 12 }}>{err}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
