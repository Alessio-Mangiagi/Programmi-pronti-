import { Suspense, lazy, useState } from 'react'
// "><(((º> sabusabu <º)))><"
import { apiFetch } from '../api'
import { IconAlert } from '../icons'
import type { DbKind, QueryResult } from '../types'
import { exportCSV, exportXLSX, format, looksTemporal } from '../exportUtils'

// Grafico caricato LAZY: recharts resta fuori dal bundle iniziale.
const ResultChart = lazy(() => import('./ResultChart'))

const PAGEABLE_KINDS: DbKind[] = ['postgres', 'mysql', 'sqlite', 'excel', 'mongodb', 'multi']
const PAGE_SIZE = 200

export function ResultView({ result, sql, kind }: { result: QueryResult; sql?: string; kind?: DbKind | null }) {
  const [extra, setExtra] = useState<Record<string, unknown>[]>([])
  const [loadingMore, setLoadingMore] = useState(false)
  const [ended, setEnded] = useState(false)
  const [pageErr, setPageErr] = useState('')

  // Righe visibili = anteprima + eventuali pagine caricate.
  const columns = result.columns
  const rows = extra.length ? [...result.rows, ...extra] : result.rows
  const { truncated } = result
  const pageable = !!sql && !!kind && PAGEABLE_KINDS.includes(kind) &&
    (truncated || extra.length > 0) && !ended

  const loadMore = async () => {
    if (!sql || loadingMore) return
    setLoadingMore(true); setPageErr('')
    try {
      const r = await apiFetch('/api/query/page', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql, offset: rows.length, limit: PAGE_SIZE }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Errore')
      const newRows: Record<string, unknown>[] = d.result?.rows || []
      setExtra(prev => [...prev, ...newRows])
      if (newRows.length < PAGE_SIZE) setEnded(true)
    } catch (e) { setPageErr((e as Error).message); setEnded(true) }
    finally { setLoadingMore(false) }
  }

  const chartable = columns.length === 2 && rows.length > 0 && rows.length <= 50 &&
    rows.every(r => typeof r[columns[1]] === 'number' || !isNaN(Number(r[columns[1]])))
  const temporal = chartable && rows.every(r => looksTemporal(String(r[columns[0]])))
  const data = chartable ? rows.map(r => ({ name: String(r[columns[0]]), val: Number(r[columns[1]]) })) : []
  const shownResult: QueryResult = { columns, rows, rowCount: rows.length, truncated: false }

  return (
    <div className="card">
      <div className="result-header">
        <span className="result-count">
          {rows.length}{truncated && extra.length === 0 ? `+` : ''} righe
          {truncated && extra.length === 0 && <span className="truncated-label">(anteprima)</span>}
        </span>
        {rows.length > 0 && (
          <div className="export-btns">
            <button className="btn-export" onClick={() => exportCSV(shownResult)}>CSV</button>
            <button className="btn-export" onClick={() => exportXLSX(shownResult)}>Excel</button>
          </div>
        )}
      </div>

      {chartable && (
        <div className="chart-wrap">
          <Suspense fallback={null}>
            <ResultChart data={data} temporal={temporal} />
          </Suspense>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>{columns.map(c => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>{columns.map(c => <td key={c}>{format(r[c])}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageErr && <div className="err-card" style={{ marginTop: 8 }}><IconAlert size={15} /><span>{pageErr}</span></div>}
      {pageable && (
        <div className="pager-row">
          <button className="btn-export" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Carico…' : `Carica altre ${PAGE_SIZE}`}
          </button>
        </div>
      )}
      {ended && extra.length > 0 && !pageErr && (
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Fine risultati.</div>
      )}
    </div>
  )
}
