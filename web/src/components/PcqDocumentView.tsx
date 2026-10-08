import { useState } from 'react'
import type { PcqPreview } from '../api/types'
import { pcqSummary } from '../forms/pcqToSchema'

const PDF_LINES_SHOWN = 300

/** Cosa l'import ha letto da un PCQ: titoli rientrati per livello, tabelle così come sono, testo dei PDF. */
export default function PcqDocumentView({ name, preview }: { name?: string; preview: PcqPreview }) {
  const [allLines, setAllLines] = useState(false)
  const lines = allLines ? preview.lines : preview.lines.slice(0, PDF_LINES_SHOWN)
  return (
    <div className="pcq-doc">
      {name && <h2>{name}</h2>}
      <p className="muted small">{pcqSummary(preview)}</p>
      {preview.warnings.map((w) => (
        <p key={w} className="pcq-warning small">
          {w}
        </p>
      ))}

      {preview.headings.length > 0 && (
        <>
          <h3>Struttura</h3>
          <ul className="pcq-headings">
            {preview.headings.map((h, i) => (
              <li key={i} style={{ paddingLeft: `${(h.length - h.trimStart().length) * 0.6}rem`, fontWeight: h.startsWith(' ') ? undefined : 600 }}>
                {h.trim()}
              </li>
            ))}
          </ul>
        </>
      )}

      {preview.tables.map((t) => {
        const [head, ...body] = t.rows
        return (
          <div key={t.index} className="pcq-table">
            <h3>
              Tabella {t.index}
              {t.title && <span className="muted"> · {t.title}</span>}
            </h3>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {head.map((c, i) => (
                      <th key={i}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {body.map((r, i) => (
                    <tr key={i}>
                      {r.map((c, j) => (
                        <td key={j}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      })}

      {preview.kind === 'pdf' && preview.lines.length > 0 && (
        <>
          <h3>Testo</h3>
          <ol className="pcq-lines">
            {lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ol>
          {preview.lines.length > PDF_LINES_SHOWN && (
            <button type="button" className="link-btn" onClick={() => setAllLines((v) => !v)}>
              {allLines ? 'Mostra meno' : `Mostra tutte le ${preview.lines.length} righe`}
            </button>
          )}
        </>
      )}
    </div>
  )
}
