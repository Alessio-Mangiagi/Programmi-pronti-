import { useEffect, useState } from 'react'
import { apiFetch } from '../api'

// ── Tab: Consumo token Claude (audit + budget) ───────────────────────────────
interface UsageRow { username: string; day: string; in_tokens: number; out_tokens: number; requests: number }

export function UsageTab() {
  const [rows, setRows] = useState<UsageRow[]>([])
  const [budget, setBudget] = useState(0)
  useEffect(() => {
    apiFetch('/api/usage?days=30').then(x => x.json()).then(d => {
      setRows(d.usage || []); setBudget(d.dailyBudget || 0)
    }).catch(() => {})
  }, [])
  // "><(((º> sabusabu <º)))><"
  const totals = rows.reduce((a, r) => ({ in: a.in + r.in_tokens, out: a.out + r.out_tokens, req: a.req + r.requests }), { in: 0, out: 0, req: 0 })
  return (
    <div>
      <h3>Consumo token Claude — ultimi 30 giorni</h3>
      <div className="muted" style={{ marginBottom: 10 }}>
        Budget giornaliero per utente: {budget > 0 ? `${budget.toLocaleString('it-IT')} token (input+output)` : 'illimitato'}.
        {' '}Oltre il tetto, l'agente ripiega automaticamente sull'AI locale.
      </div>
      {rows.length === 0 ? <div className="muted">Nessun consumo Claude registrato.</div> : (
        <table className="usage-table" style={{ width: '100%', fontSize: 13 }}>
          <thead><tr><th style={{ textAlign: 'left' }}>Giorno</th><th style={{ textAlign: 'left' }}>Utente</th><th>Richieste</th><th>Input</th><th>Output</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>{r.day}</td><td>{r.username}</td>
                <td style={{ textAlign: 'right' }}>{r.requests}</td>
                <td style={{ textAlign: 'right' }}>{r.in_tokens.toLocaleString('it-IT')}</td>
                <td style={{ textAlign: 'right' }}>{r.out_tokens.toLocaleString('it-IT')}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr style={{ fontWeight: 600 }}>
            <td colSpan={2}>Totale</td>
            <td style={{ textAlign: 'right' }}>{totals.req}</td>
            <td style={{ textAlign: 'right' }}>{totals.in.toLocaleString('it-IT')}</td>
            <td style={{ textAlign: 'right' }}>{totals.out.toLocaleString('it-IT')}</td>
          </tr></tfoot>
        </table>
      )}
    </div>
  )
}
