import { useEffect, useRef, useState } from 'react'
import { apiFetch, type AuthUser } from './api'
import { LoginView, AdminPanel, ChangePasswordView, type SavedConn } from './admin'
import { IconSheet, IconDownload, IconSend, IconChat } from './icons'
import type { ChatMsg, DbKind, Health, Mode, Provider, SchemaInfo } from './types'
import { MODE_EXAMPLES } from './types'
import { downloadBase64 } from './exportUtils'
import { Sidebar } from './components/Sidebar'
import { ConnectPanel } from './components/ConnectPanel'
import { MessageView } from './components/MessageView'
import { ModelBanner } from './components/ModelBanner'

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [me, setMe] = useState<AuthUser | null>(null)
  const [mustChangePw, setMustChangePw] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [savedConns, setSavedConns] = useState<SavedConn[]>([])
  const [schema, setSchema] = useState<SchemaInfo | null>(null)
  const [connectedKind, setConnectedKind] = useState<DbKind | null>(null)
  const [connWarnings, setConnWarnings] = useState<string[]>([]) // avvisi della sorgente (es. tabelle troncate)
  const [docsSemantic, setDocsSemantic] = useState(false)  // indice semantico disponibile
  const [semanticMode, setSemanticMode] = useState(false)  // ricerca semantica attiva
  const [agentMode, setAgentMode] = useState(false)        // agente operativo suite attivo
  const [agentOnly, setAgentOnly] = useState(false)        // workspace agente senza DB connesso

  const [mode, setMode] = useState<Mode>('chat')
  const [question, setQuestion] = useState('')
  const [provider, setProvider] = useState<Provider>('ollama')
  const [running, setRunning] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [theme, setTheme] = useState('')          // tema per il report Excel
  const [busy, setBusy] = useState('')            // testo operazione Excel in corso ('' = libero)
  const [clientHost, setClientHost] = useState(localStorage.getItem('clientHost') || '')
  // Allegati del prossimo messaggio (modalità agente): {nome, base64}.
  const [attachments, setAttachments] = useState<Array<{ name: string; base64: string }>>([])

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const attachRef = useRef<HTMLInputElement>(null)

  const onClientHostChange = (v: string) => {
    setClientHost(v)
    localStorage.setItem('clientHost', v)
  }

  const refreshHealth = async () => {
    try {
      const r = await apiFetch('/api/health')
      const h = await r.json() as Health
      setHealth(h)
      setProvider(h.defaultLlm)
    } catch { setHealth(null) }
  }

  // Verifica la sessione di login; se auth disattiva, entra come admin locale.
  const checkAuth = async () => {
    try {
      const r = await apiFetch('/api/auth/me')
      if (r.ok) { const d = await r.json(); setMe(d.user); setMustChangePw(!!d.mustChangePassword) }
      else setMe(null)
    } catch { setMe(null) }
  }

  const loadConnections = async () => {
    try {
      const d = await apiFetch('/api/connections').then(r => r.json())
      setSavedConns(d.connections || [])
    } catch { setSavedConns([]) }
  }

  const onLogged = (u: AuthUser, mustChange?: boolean) => {
    setMe(u); setMustChangePw(!!mustChange); refreshHealth(); loadConnections()
  }

  const logout = async () => {
    await apiFetch('/api/auth/logout', { method: 'POST' })
    setMe(null); setSchema(null); setConnectedKind(null); setMessages([])
  }

  const autoDetectHost = async () => {
    if (localStorage.getItem('clientHost')) return
    try {
      const r = await fetch('/api/whoami')
      const d = await r.json() as { clientIp: string; clientHost: string }
      const resolved = d.clientHost && d.clientHost !== '-' ? d.clientHost : d.clientIp
      if (resolved && resolved !== '-') onClientHostChange(resolved)
    } catch { /* ignora */ }
  }

  useEffect(() => {
    (async () => {
      await checkAuth()
      setAuthChecked(true)
      refreshHealth(); autoDetectHost(); loadConnections()
    })()
  }, [])

  const onConnected = (s: SchemaInfo, k: DbKind, semantic?: boolean, warnings?: string[]) => {
    setSchema(s); setConnectedKind(k)
    setDocsSemantic(!!semantic); setSemanticMode(!!semantic && k === 'docs')
    setConnWarnings(warnings || [])
    refreshHealth()
  }

  const disconnect = async () => {
    await apiFetch('/api/disconnect', { method: 'POST' })
    setSchema(null); setConnectedKind(null); setMessages([])
    setDocsSemantic(false); setSemanticMode(false); setConnWarnings([])
    setAgentOnly(false); setAgentMode(false)
    refreshHealth()
  }

  // Entra nel workspace dell'agente operativo senza connettere un DB.
  const enterAgentOnly = () => {
    setAgentOnly(true); setAgentMode(true); setMessages([])
  }

  const isRedis = connectedKind === 'redis'
  const isMongo = connectedKind === 'mongodb'
  const isDocs = connectedKind === 'docs'
  const DOC_EXAMPLES = ['Quali documenti parlano di sicurezza?', 'Elenca le fatture e il loro totale', 'Cerca «collaudo» nei documenti', 'Riepilogo dei tipi di documento caricati']
  const AGENT_EXAMPLES = ['Come sta lo scadenzario?', 'Quali certificati sono in scadenza?', 'Esporta in Excel le scadenze scadute', 'Confronta i due documenti allegati', 'Estrai il testo dalla scansione allegata']

  // Aggiorna in-place il messaggio assistant (per lo streaming).
  const patchMsg = (id: number, patch: Partial<ChatMsg> | ((m: ChatMsg) => Partial<ChatMsg>)) =>
    setMessages(m => m.map(msg => msg.id === id ? { ...msg, ...(typeof patch === 'function' ? patch(msg) : patch) } : msg))

  // Chat in streaming (SSE): i token della risposta arrivano man mano.
  const runChatStreaming = async (q: string, aid: number) => {
    const r = await apiFetch('/api/analyze/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, provider }),
    })
    if (!r.ok || !r.body) {
      const d = await r.json().catch(() => ({} as any))
      throw new Error(d.error || 'Errore')
    }
    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    const handle = (ev: any) => {
      if (ev.type === 'delta') patchMsg(aid, m => ({ pending: false, reply: (m.reply || '') + ev.text }))
      else if (ev.type === 'sql') patchMsg(aid, { sql: ev.sql, attempts: ev.attempts })
      else if (ev.type === 'result') patchMsg(aid, { result: ev.result })
      else if (ev.type === 'done') patchMsg(aid, { pending: false, reply: ev.reply })
      else if (ev.type === 'error') patchMsg(aid, { pending: false, error: ev.error })
    }
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, sep); buf = buf.slice(sep + 2)
        const line = chunk.split('\n').find(l => l.startsWith('data:'))
        if (line) { try { handle(JSON.parse(line.slice(5).trim())) } catch { /* ignora */ } }
      }
    }
  }

  // Aggiunge file agli allegati del prossimo messaggio (modalità agente).
  const addAttachments = async (list: FileList | null) => {
    if (!list?.length) return
    const read = (f: File) => new Promise<{ name: string; base64: string }>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve({ name: f.name, base64: (r.result as string).split(',')[1] ?? '' })
      r.onerror = () => reject(new Error('Lettura file fallita'))
      r.readAsDataURL(f)
    })
    const nuovi = await Promise.all(Array.from(list).slice(0, 6).map(read))
    setAttachments(prev => [...prev, ...nuovi].slice(0, 6))
  }

  // Storico testuale del thread da mandare all'agente: solo domande e risposte
  // in chiaro (SQL, tabelle e allegati non entrano nel prompt). Senza questo un
  // follow-up come «ok, rinnovala» non ha nessun referente.
  const AGENT_HISTORY_TURNS = 8
  const agentHistory = () => messages
    .map(m => m.role === 'user'
      ? { role: 'user' as const, content: m.question || '' }
      : { role: 'assistant' as const, content: m.reply || m.explanation || '' })
    .filter(m => m.content.trim() !== '')
    .slice(-AGENT_HISTORY_TURNS)

  // Agente operativo (streaming SSE): mostra i passi live mentre usa gli strumenti.
  const askAgent = async (q: string, aid: number, files: Array<{ name: string; base64: string }>) => {
    const r = await apiFetch('/api/agent/stream', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      // `messages` qui è il thread PRIMA di questo turno: è esattamente lo storico.
      body: JSON.stringify({ message: q, provider, files, history: agentHistory() }),
    })
    if (!r.ok || !r.body) {
      const d = await r.json().catch(() => ({} as any))
      throw new Error(d.error || 'Errore')
    }
    const reader = r.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    const handle = (ev: any) => {
      if (ev.type === 'status') patchMsg(aid, m => ({ pending: true, steps: [...(m.steps || []), ev.text] }))
      else if (ev.type === 'done') {
        if (ev.file) downloadBase64(ev.file.base64, ev.file.name)
        patchMsg(aid, { pending: false, reply: ev.reply || '', toolsUsed: ev.toolsUsed || [], pendingAction: ev.pendingAction, file: ev.file, openUrl: ev.openUrl })
      } else if (ev.type === 'error') patchMsg(aid, { pending: false, error: ev.error })
    }
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      let sep: number
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, sep); buf = buf.slice(sep + 2)
        const line = chunk.split('\n').find(l => l.startsWith('data:'))
        if (line) { try { handle(JSON.parse(line.slice(5).trim())) } catch { /* ignora */ } }
      }
    }
  }

  // Conferma (o annulla) un'azione di scrittura proposta dall'agente.
  const confirmAction = async (msgId: number, confirm: boolean) => {
    const msg = messages.find(m => m.id === msgId)
    if (!msg?.pendingAction) return
    if (!confirm) { patchMsg(msgId, { actionState: 'cancelled' }); return }
    patchMsg(msgId, { actionState: 'done' })
    const nid = Date.now()
    setMessages(m => [...m, { id: nid, role: 'assistant', pending: true }])
    try {
      const r = await apiFetch('/api/agent/confirm', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: msg.pendingAction.id }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Errore')
      if (data.file) downloadBase64(data.file.base64, data.file.name)
      patchMsg(nid, { pending: false, reply: data.reply || (data.ok ? 'Fatto.' : 'Azione non riuscita.'), file: data.file, openUrl: data.openUrl, error: data.ok ? undefined : data.reply })
    } catch (e) {
      patchMsg(nid, { pending: false, error: (e as Error).message })
    }
  }

  // Ricerca semantica nei documenti (RAG): risposta citata dagli estratti.
  const askDocs = async (q: string, aid: number) => {
    const r = await apiFetch('/api/docs/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: q, provider }),
    })
    const data = await r.json()
    if (!r.ok) throw new Error(data.error || 'Errore')
    patchMsg(aid, { pending: false, reply: data.reply || '', sources: data.sources || [] })
  }

  // Invia una domanda: appende il turno utente + un placeholder assistant nel thread.
  const run = async () => {
    if (!question.trim() || running) return
    const q = question.trim()
    const curMode = mode
    const files = agentMode ? attachments : []
    const uid = Date.now()
    setQuestion('')
    setAttachments([])
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setRunning(true)
    setMessages(m => [...m,
      { id: uid, role: 'user', question: q, mode: curMode, attachments: files.length ? files.map(f => f.name) : undefined },
      { id: uid + 1, role: 'assistant', pending: true },
    ])
    try {
      if (agentMode) {
        await askAgent(q, uid + 1, files)
      } else if (isDocs && semanticMode) {
        await askDocs(q, uid + 1)
      } else if (curMode === 'chat') {
        await runChatStreaming(q, uid + 1)
      } else {
        const r = await apiFetch('/api/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, mode: curMode, provider }),
        })
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || 'Errore')
        patchMsg(uid + 1, {
          pending: false,
          reply: data.reply || '', explanation: data.explanation || '', sql: data.sql || '',
          result: data.result || null, error: data.error, attempts: data.attempts,
        })
      }
    } catch (e) {
      patchMsg(uid + 1, { pending: false, error: (e as Error).message })
    } finally { setRunning(false) }
  }

  // Analisi già risposte (con SQL valido): base per l'export della conversazione.
  const answered = messages.filter(m => m.role === 'assistant' && m.sql && !m.error)

  // Report Excel automatico: tema → l'AI pianifica più analisi → workbook multi-foglio.
  const report = async () => {
    const t = theme.trim() || question.trim()
    if (!t || busy) return
    setBusy('Genero il report Excel… (l\'AI pianifica ed esegue più analisi)')
    try {
      const r = await apiFetch('/api/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: t, provider }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Errore')
      downloadBase64(data.base64, data.filename)
      setMessages(m => [...m, { id: Date.now(), role: 'assistant', report: data }])
    } catch (e) {
      setMessages(m => [...m, { id: Date.now(), role: 'assistant', error: (e as Error).message }])
    } finally { setBusy('') }
  }

  // Export Excel della conversazione: ogni analisi risposta diventa un foglio.
  const exportChat = async () => {
    if (!answered.length || busy) return
    setBusy('Esporto la conversazione in Excel…')
    try {
      const items = answered.map((m, i) => ({
        title: messages.find(x => x.id === m.id - 1)?.question || `Analisi ${i + 1}`,
        sql: m.sql as string,
      }))
      const r = await apiFetch('/api/export-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || 'Errore')
      downloadBase64(data.base64, data.filename)
    } catch (e) {
      setMessages(m => [...m, { id: Date.now(), role: 'assistant', error: (e as Error).message }])
    } finally { setBusy('') }
  }

  const adjustTextarea = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'
  }

  const inputPlaceholder =
    agentMode ? 'Chiedi un\'azione: «esporta le scadenze in scadenza», «quali DURC scadono»… (Invio)' :
    isDocs && mode === 'chat' ? 'Chiedi qualcosa sui documenti caricati… (Invio per inviare)' :
    isDocs ? 'es. cerca «collaudo» nei documenti, elenca le fatture…' :
    mode === 'chat'    ? 'Scrivi un messaggio… chiedimi qualsiasi cosa sui tuoi dati (Invio per inviare)' :
    isRedis ? 'es. mostra la sessione user:42' :
    isMongo ? 'es. ordini di questo mese' :
    mode === 'query'   ? 'Fai una domanda sui tuoi dati… (Invio per inviare)' :
    mode === 'stats'   ? 'Che statistiche vuoi calcolare?' :
    'Cosa controllare per qualità / anomalie?'

  if (!authChecked) return <div className="app" />
  if (!me) return <LoginView onLogged={onLogged} />
  if (mustChangePw) return (
    <ChangePasswordView forced onDone={() => { setMustChangePw(false); refreshHealth() }} />
  )

  return (
    <div className="app">
      {showAdmin && (
        <AdminPanel
          me={me}
          health={{ local: health?.local, claude: health?.claude, connectionsStore: health?.connectionsStore }}
          onClose={() => setShowAdmin(false)}
          onConnectionsChanged={loadConnections}
        />
      )}

      <Sidebar
        health={health}
        me={me}
        schema={schema}
        connectedKind={connectedKind}
        clientHost={clientHost}
        onClientHostChange={onClientHostChange}
        onDisconnect={disconnect}
        onSchemaRefreshed={setSchema}
        onShowAdmin={() => setShowAdmin(true)}
        onLogout={logout}
      />

      {/* ── Main ── */}
      <main className="main">
        <ModelBanner health={health} />
        {!schema && !agentOnly ? (
          <ConnectPanel
            me={me}
            health={health}
            savedConns={savedConns}
            onConnected={onConnected}
            onSavedConnsChanged={loadConnections}
            onAgentOnly={enterAgentOnly}
          />
        ) : (

          /* ── Query panel ── */
          <div className="query-panel">

            {/* Avvisi della sorgente: dati troncati = totali parziali. Va detto
                prima che l'utente legga i numeri, non dopo. */}
            {connWarnings.length > 0 && (
              <div className="err-card" style={{ margin: '12px 16px 0' }}>
                <span>
                  <b>Dati parziali:</b>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    {connWarnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </span>
                <button className="doc-x" title="Nascondi" onClick={() => setConnWarnings([])}>×</button>
              </div>
            )}

            {/* Topbar */}
            <div className="topbar">
              {!schema ? (
                <button className="mode-tab" onClick={() => setAgentOnly(false)} title="Torna alla connessione">← Sorgenti</button>
              ) : (
              <div className="mode-tabs">
                <button className={`mode-tab${mode === 'chat'    ? ' active' : ''}`} onClick={() => setMode('chat')}>Chat</button>
                <button className={`mode-tab${mode === 'query'   ? ' active' : ''}`} onClick={() => setMode('query')}>Query</button>
                <button className={`mode-tab${mode === 'stats'   ? ' active' : ''}`} onClick={() => setMode('stats')}>Statistiche</button>
                <button className={`mode-tab${mode === 'anomaly' ? ' active' : ''}`} onClick={() => setMode('anomaly')}>Anomalie</button>
              </div>
              )}
              <div className="topbar-spacer" />
              {agentOnly && <span className="agent-only-badge">🛠️ Agente operativo</span>}
              {health?.suiteTools && !agentOnly && (
                <button
                  className={`sem-toggle${agentMode ? ' active' : ''}`}
                  onClick={() => setAgentMode(v => !v)}
                  title="Fai svolgere azioni sulle app della suite (scadenzario, OCR, …)"
                >
                  🛠️ Azioni suite {agentMode ? 'ON' : 'OFF'}
                </button>
              )}
              {isDocs && docsSemantic && !agentMode && (
                <button
                  className={`sem-toggle${semanticMode ? ' active' : ''}`}
                  onClick={() => setSemanticMode(v => !v)}
                  title="Cerca per significato negli estratti dei documenti e cita le fonti"
                >
                  🔍 Ricerca semantica {semanticMode ? 'ON' : 'OFF'}
                </button>
              )}
              <span className="llm-label">LLM</span>
              <select className="llm-select" value={provider} onChange={e => setProvider(e.target.value as Provider)}>
                <option value="ollama">Ollama (locale)</option>
                <option value="local" disabled={!health?.local}>AI locale (OpenAI-compat)</option>
                <option value="claude" disabled={!health?.claude}>Claude</option>
              </select>
            </div>

            {/* Barra elaborati Excel (solo con un DB connesso) */}
            {schema && (
            <div className="report-bar">
              <input
                className="theme-input"
                value={theme}
                onChange={e => setTheme(e.target.value)}
                placeholder="Tema per il report Excel (es. «analisi vendite 2025»)"
                onKeyDown={e => { if (e.key === 'Enter') report() }}
              />
              <button className="btn-report" onClick={report}
                disabled={!!busy || (!theme.trim() && !question.trim())}>
                <IconSheet size={14} /> Report Excel
              </button>
              <button className="btn-report ghost" onClick={exportChat}
                disabled={!!busy || answered.length === 0}>
                <IconDownload size={14} /> Esporta chat{answered.length ? ` (${answered.length})` : ''}
              </button>
            </div>
            )}

            {/* Feed — thread conversazione */}
            <div className="feed">
              {messages.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">
                    <IconChat size={39} style={{ color: 'var(--brand)' }} />
                  </div>
                  <h3>{agentMode ? 'Agente operativo' : 'Chatta con i tuoi dati'}</h3>
                  <p>{agentMode
                    ? 'Chiedi un\'azione sulle app della suite: l\'agente usa gli strumenti giusti e ti mostra i passi. Le modifiche te le fa confermare.'
                    : 'Scrivi in italiano — l\'agente risponde nel thread; genera report Excel dai dati.'}</p>
                  <div className="empty-examples">
                    {(agentMode ? AGENT_EXAMPLES : isDocs ? DOC_EXAMPLES : MODE_EXAMPLES[mode]).map(ex => (
                      <button key={ex} className="example-chip" onClick={() => setQuestion(ex)}>
                        {ex}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map(m => (
                  <MessageView
                    key={m.id}
                    msg={m}
                    kind={connectedKind}
                    question={m.role === 'assistant' ? messages.find(x => x.id === m.id - 1)?.question : undefined}
                    onConfirmAction={confirmAction}
                  />
                ))
              )}
              {busy && <div className="busy-note"><div className="spinner" /> <span>{busy}</span></div>}
            </div>

            {/* Input dock */}
            <div className="input-dock">
              {agentMode && attachments.length > 0 && (
                <div className="attach-row">
                  {attachments.map((f, i) => (
                    <span key={i} className="attach-chip" title={f.name}>
                      📎 <span className="attach-name">{f.name}</span>
                      <button className="attach-x" title="Rimuovi"
                        onClick={() => setAttachments(a => a.filter((_, j) => j !== i))}>×</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="input-row">
                {agentMode && (
                  <>
                    <input ref={attachRef} type="file" multiple style={{ display: 'none' }}
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.bmp,.docx,.txt"
                      onChange={e => { addAttachments(e.target.files); e.target.value = '' }} />
                    <button className="btn-attach" title="Allega file (immagini, PDF, Word) per gli strumenti della suite"
                      onClick={() => attachRef.current?.click()} disabled={running}>
                      📎
                    </button>
                  </>
                )}
                <textarea
                  ref={textareaRef}
                  className="question-input"
                  value={question}
                  rows={1}
                  onChange={e => { setQuestion(e.target.value); adjustTextarea() }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run() }
                  }}
                  placeholder={inputPlaceholder}
                />
                <button
                  className="btn-send"
                  onClick={run}
                  disabled={running || !question.trim()}
                  title="Invia (Invio)"
                >
                  {running ? <div className="spinner" /> : <IconSend size={17} />}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
