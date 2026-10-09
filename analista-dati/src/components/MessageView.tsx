import { useState } from 'react'
import { apiFetch } from '../api'
import { IconAlert, IconCheck, IconSheet, IconDownload } from '../icons'
import type { ChatMsg, DbKind, ReportInfo } from '../types'
import { downloadBase64 } from '../exportUtils'
import { ResultView } from './ResultView'

/**
 * Feedback 👍/👎 sulla risposta: alimenta il few-shot bank lato server
 * (👍 conferma la coppia domanda→query, 👎 la rimuove così non guida più
 * le prossime generazioni). Best-effort: l'esito non blocca nulla.
 */
function FeedbackRow({ question, sql }: { question: string; sql: string }) {
  const [sent, setSent] = useState<'up' | 'down' | null>(null)
  const send = async (positive: boolean) => {
    if (sent) return
    setSent(positive ? 'up' : 'down')
    try {
      await apiFetch('/api/feedback', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, sql, positive }),
      })
    } catch { /* best-effort */ }
  }
  return (
    <div className="feedback-row" style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
      {sent ? (
        <span className="muted" style={{ fontSize: 12 }}>
          {sent === 'up' ? 'Grazie! Risposta confermata.' : 'Grazie! Ne terrò conto.'}
        </span>
      ) : (
        <>
          <span className="muted" style={{ fontSize: 12 }}>Risposta utile?</span>
          <button className="btn-export" title="Risposta corretta" onClick={() => send(true)}>👍</button>
          <button className="btn-export" title="Risposta sbagliata" onClick={() => send(false)}>👎</button>
        </>
      )}
    </div>
  )
}

export function MessageView({ msg, kind, question, onConfirmAction }: {
  msg: ChatMsg; kind: DbKind | null; question?: string
  onConfirmAction?: (msgId: number, confirm: boolean) => void
}) {
  if (msg.role === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">
          {msg.question}
          {msg.attachments && msg.attachments.length > 0 && (
            <div className="bubble-attachments">
              {msg.attachments.map((n, i) => <span key={i} className="bubble-attach">📎 {n}</span>)}
            </div>
          )}
        </div>
      </div>
    )
  }
  const isRedis = kind === 'redis', isMongo = kind === 'mongodb'
  // "><(((º> sabusabu <º)))><"
  const canFeedback = !msg.pending && !msg.error && !!msg.sql && !!question
  return (
    <div className="msg assistant">
      {msg.pending && (
        <div className="card pending">
          <div className="pending-head">
            <span className="typing-dots"><i /><i /><i /></span>
            <span>{msg.steps && msg.steps.length ? 'Sto lavorando…' : 'Sto analizzando…'}</span>
          </div>
          {msg.steps && msg.steps.length > 0 ? (
            <div className="agent-steps">
              {msg.steps.map((s, i) => <div key={i} className="agent-step"><IconCheck size={12} /> {s}</div>)}
            </div>
          ) : (
            <>
              <div className="skel w85" />
              <div className="skel w60" />
              <div className="skel w40" />
            </>
          )}
        </div>
      )}
      {msg.reply && (
        <div className="card chat-reply">{msg.reply}</div>
      )}
      {msg.sources && msg.sources.length > 0 && (
        <div className="card sources-card">
          <div className="card-title">Fonti</div>
          <div className="sources-list">
            {msg.sources.map((s, i) => (
              <span key={i} className="source-chip" title={`Rilevanza ${(s.score ?? 0).toFixed(2)}`}>
                <IconSheet size={12} /> {s.nome} · pag {s.pagina}
              </span>
            ))}
          </div>
        </div>
      )}
      {msg.explanation && (
        <div className="card">
          <div className="card-title">Spiegazione</div>
          <div className="explanation-text">{msg.explanation}</div>
        </div>
      )}
      {msg.sql && (
        <div className="card">
          <div className="card-title">
            {isMongo ? 'Query MongoDB' : isRedis ? 'Comando Redis' : 'SQL generato'}
            {msg.attempts && msg.attempts > 1 ? ` · ${msg.attempts} tentativi` : ''}
          </div>
          <pre className="sql-block-ro">{msg.sql}</pre>
        </div>
      )}
      {msg.toolsUsed && msg.toolsUsed.length > 0 && (
        <div className="tools-used">
          {msg.toolsUsed.map((t, i) => <span key={i} className="tool-chip">🛠️ {t}</span>)}
        </div>
      )}
      {msg.pendingAction && (
        <div className="card action-card">
          <div className="card-title">Conferma azione</div>
          <div className="action-desc">{msg.pendingAction.description}</div>
          {msg.actionState === 'done' ? (
            <div className="ok-note"><IconCheck size={13} /> Azione confermata</div>
          ) : msg.actionState === 'cancelled' ? (
            <div className="muted" style={{ fontSize: 12 }}>Azione annullata.</div>
          ) : (
            <div className="action-btns">
              <button className="btn-confirm" onClick={() => onConfirmAction?.(msg.id, true)}>Conferma ed esegui</button>
              <button className="btn-cancel" onClick={() => onConfirmAction?.(msg.id, false)}>Annulla</button>
            </div>
          )}
        </div>
      )}
      {msg.file && (
        <button className="btn-report ghost" style={{ marginTop: 8 }}
          onClick={() => downloadBase64(msg.file!.base64, msg.file!.name)}>
          <IconDownload size={14} /> Scarica {msg.file.name}
        </button>
      )}
      {/* App della suite avviata su richiesta: il processo gira sul server, qui
          serve il link. noopener/noreferrer: la pagina aperta non deve poter
          toccare questa via window.opener. */}
      {msg.openUrl && (
        <a className="btn-report ghost" style={{ marginTop: 8, display: 'inline-flex' }}
          href={msg.openUrl.url} target="_blank" rel="noopener noreferrer">
          ↗ {msg.openUrl.label}
        </a>
      )}
      {msg.error && <div className="err-card"><IconAlert size={15} /><span>{msg.error}</span></div>}
      {msg.result && <ResultView result={msg.result} sql={msg.sql} kind={kind} />}
      {msg.report && <ReportCard report={msg.report} />}
      {canFeedback && <FeedbackRow question={question!} sql={msg.sql!} />}
    </div>
  )
}

export function ReportCard({ report }: { report: ReportInfo }) {
  return (
    <div className="card report-card">
      <div className="card-title"><IconSheet size={13} /> Report Excel generato — {report.filename}</div>
      <div className="report-list">
        {report.sections.map((s, i) => (
          <div key={i} className="report-row">
            <span className="report-sheet">{i + 1}. {s.title}</span>
            <span className={s.error ? 'report-err' : 'report-count'}>
              {s.error ? s.error : `${s.rowCount.toLocaleString('it-IT')} righe`}
            </span>
          </div>
        ))}
      </div>
      <div className="report-hint">
        <IconCheck size={13} /> Scaricato automaticamente — un foglio per analisi + Riepilogo
        {report.engine === 'python' ? ' · con grafici' : ''}
      </div>
    </div>
  )
}
