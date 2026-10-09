import { useEffect, useState } from 'react'
import { apiFetch, type AuthUser } from '../api'
import type { SavedConn } from '../admin'
import { IconAlert, IconCheck, IconSave, IconSheet, IconDownload } from '../icons'
import type { DbKind, DocMeta, Health, SchemaInfo } from '../types'
import { DB_COLORS, DB_LABELS, DB_SHORT, DEFAULT_PORTS } from '../types'
import { loadRecents, pushRecent, forgetRecent, type RecentConn } from '../recentConns'

interface IngestResult { nome: string; ok: boolean; duplicato?: boolean; tipo?: string; pagine?: number; campi?: number; error?: string }

/** Legge un File come base64 (senza prefisso data:). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve((r.result as string).split(',')[1] ?? '')
    r.onerror = () => reject(new Error('Lettura file fallita'))
    r.readAsDataURL(file)
  })
}

interface ConnectPanelProps {
  me: AuthUser
  health: Health | null
  savedConns: SavedConn[]
  onConnected: (schema: SchemaInfo, kind: DbKind, semantic?: boolean, warnings?: string[]) => void
  onSavedConnsChanged: () => void
  onAgentOnly?: () => void   // entra in modalità agente operativo senza connettere un DB
}

/** Schermata di connessione: form manuale + connessioni salvate. Stato del form
 *  tutto interno: App riceve solo l'esito (schema + kind). */
export function ConnectPanel({ me, health, savedConns, onConnected, onSavedConnsChanged, onAgentOnly }: ConnectPanelProps) {
  const [kind, setKind] = useState<DbKind>('postgres')
  const [host, setHost] = useState('localhost')
  const [port, setPort] = useState('5432')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [database, setDatabase] = useState('')
  const [uri, setUri] = useState('')
  const [excelBase64, setExcelBase64] = useState('')
  const [excelFileName, setExcelFileName] = useState('')
  // Sorgente 'multi': un DB SQL salvato + uno o piu Excel, incrociabili con JOIN.
  const [multiConnId, setMultiConnId] = useState<number | ''>('')
  const [multiFiles, setMultiFiles] = useState<Array<{ name: string; base64: string }>>([])
  const [multiPaths, setMultiPaths] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connErr, setConnErr] = useState('')
  const [selectedConnId, setSelectedConnId] = useState<number | ''>('')
  const [saveName, setSaveName] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  // Cronologia locale delle connessioni manuali riuscite (senza password).
  const [recents, setRecents] = useState<RecentConn[]>(() => loadRecents(me.username))

  // ── Stato sorgente "Documenti" ──
  const [docSet, setDocSet] = useState('documenti')
  const [docList, setDocList] = useState<DocMeta[]>([])
  const [docBusy, setDocBusy] = useState('')
  const [docResults, setDocResults] = useState<IngestResult[]>([])
  const [docErr, setDocErr] = useState('')

  const loadDocs = async (setName: string) => {
    try {
      const d = await apiFetch(`/api/docs?docSet=${encodeURIComponent(setName)}`).then(r => r.json())
      setDocList(d.documents || [])
    } catch { setDocList([]) }
  }

  // Al passaggio su "Documenti" (o al cambio set) rileggi l'elenco del set.
  useEffect(() => {
    if (kind === 'docs') loadDocs(docSet)
  }, [kind, docSet]) // eslint-disable-line react-hooks/exhaustive-deps

  const uploadDocs = async (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return
    setDocErr(''); setDocResults([])
    setDocBusy(`Acquisisco ${fileList.length} documento/i… (estrazione testo + analisi)`)
    try {
      const files = await Promise.all(Array.from(fileList).map(async f => ({ filename: f.name, base64: await fileToBase64(f) })))
      const r = await apiFetch('/api/docs/upload', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ docSet, files, provider: 'claude' }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Errore acquisizione')
      setDocResults(d.results || [])
      setDocList(d.documents || [])
    } catch (e) { setDocErr((e as Error).message) }
    finally { setDocBusy('') }
  }

  const removeDoc = async (id: number) => {
    try {
      const r = await apiFetch(`/api/docs/${id}?docSet=${encodeURIComponent(docSet)}`, { method: 'DELETE' })
      const d = await r.json()
      if (r.ok) setDocList(d.documents || [])
    } catch { /* ignora */ }
  }

  const connectDocs = () => {
    if (!docList.length) { setDocErr('Carica almeno un documento prima di connetterti'); return }
    doConnect({ kind: 'docs', docSet }, 'docs')
  }

  const onKindChange = (k: DbKind) => {
    setKind(k)
    setPort(String(DEFAULT_PORTS[k] || ''))
  }

  // Ricompila il form da una connessione recente. La password NON è memorizzata:
  // va reinserita (dove serve).
  const applyRecent = (c: RecentConn) => {
    setKind(c.kind)
    setPort(c.port ?? String(DEFAULT_PORTS[c.kind] || ''))
    setHost(c.host ?? 'localhost')
    setUser(c.user ?? '')
    setDatabase(c.database ?? '')
    setUri(c.uri ?? '')
    setPassword('')
    setConnErr('')
  }

  const handleExcelFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setExcelFileName(file.name)
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target!.result as string
      setExcelBase64(dataUrl.split(',')[1] ?? '')
    }
    reader.readAsDataURL(file)
  }

  const addMultiFiles = async (fileList: FileList | null) => {
    if (!fileList || !fileList.length) return
    const added = await Promise.all(Array.from(fileList).map(async f => ({ name: f.name, base64: await fileToBase64(f) })))
    setMultiFiles(prev => [...prev, ...added])
  }

  /** Righe non vuote di una textarea (un percorso per riga). */
  const linesOf = (t: string) => t.split(/\r?\n/).map(x => x.trim()).filter(Boolean)

  // Costruisce la DbConfig dal form (null = Excel senza file selezionato).
  const buildCfg = (): (Record<string, unknown> & { kind: DbKind }) | null => {
    if (kind === 'excel') {
      if (!excelBase64) return null
      return { kind, xlsxBase64: excelBase64 }
    }
    if (kind === 'multi') {
      const paths = linesOf(multiPaths)
      const sources: Array<Record<string, unknown>> = []
      if (multiConnId) sources.push({ connectionId: multiConnId })
      for (const f of multiFiles) sources.push({ xlsxBase64: f.base64, alias: f.name.replace(/\.[^.]+$/, ''), label: f.name })
      for (const path of paths) sources.push({ path, label: path })
      // Una sola sorgente non e un incrocio: meglio dirlo qui che far partire
      // una materializzazione inutile (i dati vengono copiati in RAM).
      if (sources.length < 2) return null
      return { kind, sources }
    }
    const cfg: Record<string, unknown> & { kind: DbKind } = { kind }
    if (kind !== 'sqlite') {
      cfg.host = host; cfg.port = Number(port); cfg.user = user; cfg.password = password
    }
    cfg.database = database
    if (kind === 'mongodb' && uri) cfg.uri = uri
    return cfg
  }

  const doConnect = async (body: Record<string, unknown>, fallbackKind: DbKind, record?: RecentConn) => {
    setConnecting(true); setConnErr('')
    try {
      const r = await apiFetch('/api/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok || !data.ok) throw new Error(data.error || 'Connessione fallita')
      // Solo su connessione MANUALE riuscita: ricordala (prima dell'unmount).
      if (record) { setRecents(pushRecent(me.username, record)) }
      // `warnings`: tabelle troncate della sorgente multipla → i totali sarebbero
      // parziali senza dirlo. Vanno mostrati, non ingoiati.
      onConnected(data.schema, data.kind || fallbackKind, data.semantic, data.warnings)
    } catch (e) { setConnErr((e as Error).message) }
    finally { setConnecting(false) }
  }

  const connect = () => {
    const cfg = buildCfg()
    if (!cfg) {
      setConnErr(kind === 'multi'
        ? 'Servono almeno due sorgenti da incrociare (es. un database salvato + un Excel)'
        : 'Seleziona un file Excel prima di connetterti')
      return
    }
    // Excel non è ricordabile (il file non è riproponibile); tutto il resto sì.
    const record: RecentConn | undefined = (kind === 'excel' || kind === 'multi') ? undefined : {
      kind,
      host: kind === 'sqlite' ? undefined : host,
      port: kind === 'sqlite' ? undefined : port,
      user: kind === 'sqlite' ? undefined : user,
      database,
      uri: kind === 'mongodb' ? uri : undefined,
      label: `${DB_LABELS[kind]} · ${database || host || uri || 'locale'}`,
      ts: Date.now(),
    }
    doConnect(cfg, kind, record)
  }

  // Connetti usando una connessione salvata (l'ID viaggia; le credenziali restano server-side).
  const connectSaved = () => {
    if (!selectedConnId) return
    doConnect({ connectionId: selectedConnId }, kind)
  }

  // Salva la connessione corrente (cifrata lato server) per riuso e scheduler.
  const saveConnection = async () => {
    setSaveMsg('')
    const config = buildCfg()
    if (!config) { setSaveMsg('Compila prima i dati di connessione'); return }
    const name = saveName.trim() || `${DB_LABELS[kind]} ${database || host}`
    try {
      const r = await apiFetch('/api/connections', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, config }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Errore')
      setSaveMsg('Connessione salvata'); setSaveName(''); onSavedConnsChanged()
    } catch (e) { setSaveMsg((e as Error).message) }
  }

  return (
    <div className="connect-panel">
      <div className="connect-wrap">
        <div className="connect-intro">
          <div className="kicker">Agente analisi dati</div>
          <h2>Interroga i <em>tuoi</em> dati, in italiano.</h2>
          <p>
            Connetti un database aziendale e chiedi in linguaggio naturale:
            l'agente genera le query, commenta i risultati e produce report Excel.
          </p>
          <div className="intro-divider" />
          <div className="intro-points">
            <div className="intro-point"><span className="dot" />Solo lettura<span> — guard su ogni query</span></div>
            <div className="intro-point"><span className="dot" />AI in locale<span> — i dati non escono dalla rete</span></div>
            <div className="intro-point"><span className="dot" />Report pianificati<span> — Excel multi-foglio automatici</span></div>
          </div>
        </div>

        <div className="connect-card">
        <div className="connect-title">Connetti al database</div>
        <div className="connect-sub">Seleziona il tipo e inserisci i dati di connessione</div>

        {recents.length > 0 && (
          <div className="recent-conn">
            <label>Connessioni recenti</label>
            <div className="recent-chips">
              {recents.map(c => (
                <span key={c.ts} className="recent-chip">
                  <button type="button" className="recent-chip-main" onClick={() => applyRecent(c)}
                    title="Ricompila il form con questi dati">
                    <span className="db-kind-icon" style={{ color: DB_COLORS[c.kind] }}>{DB_SHORT[c.kind]}</span>
                    {c.label}
                  </button>
                  <button type="button" className="recent-chip-x" title="Dimentica"
                    onClick={() => setRecents(forgetRecent(me.username, c.ts))}>×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {savedConns.length > 0 && (
          <div className="saved-conn">
            <label>Connessioni salvate</label>
            <div className="saved-conn-row">
              <select value={selectedConnId} onChange={e => setSelectedConnId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">— scegli una connessione —</option>
                {savedConns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
              </select>
              <button className="btn-primary" style={{ width: 'auto', margin: 0 }}
                disabled={!selectedConnId || connecting} onClick={connectSaved}>
                Connetti
              </button>
            </div>
            <div className="saved-conn-or">oppure inserisci manualmente</div>
          </div>
        )}

        <div className="db-kind-grid">
          {(['postgres', 'mysql', 'sqlite', 'mssql', 'redis', 'mongodb', 'excel', 'docs', 'multi'] as DbKind[]).map(k => (
            <button
              key={k}
              type="button"
              className={`db-kind-btn${kind === k ? ' selected' : ''}`}
              onClick={() => onKindChange(k)}
            >
              <span className="db-kind-icon" style={{ color: DB_COLORS[k] }}>{DB_SHORT[k]}</span>
              <span>{DB_LABELS[k]}</span>
            </button>
          ))}
        </div>

        {kind === 'docs' ? (
          <div className="docs-source">
            <div className="field">
              <label>Nome del set di documenti</label>
              <input value={docSet} onChange={e => setDocSet(e.target.value.replace(/[^a-zA-Z0-9 _-]/g, ''))}
                placeholder="es. fatture-2025" />
            </div>
            <div className="field">
              <label>Aggiungi documenti (PDF, immagini, testo, Excel)</label>
              <input type="file" multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.md,.csv,.tsv,.json,.xml,.html,.xlsx,.xls"
                onChange={e => { uploadDocs(e.target.files); e.target.value = '' }} />
              {health && !health.claude && (
                <div className="err-card" style={{ marginTop: 8 }}>
                  <IconAlert size={15} />
                  <span>Claude non configurato: PDF e immagini scansionate non verranno trascritti. Testo, CSV ed Excel funzionano comunque.</span>
                </div>
              )}
            </div>

            {docBusy && <div className="busy-note"><div className="spinner" /> <span>{docBusy}</span></div>}

            {docResults.length > 0 && (
              <div className="docs-results">
                {docResults.map((r, i) => (
                  <div key={i} className={`doc-result${r.ok ? '' : ' err'}`}>
                    {r.ok ? <IconCheck size={13} /> : <IconAlert size={13} />}
                    <span className="doc-result-name">{r.nome}</span>
                    <span className="doc-result-meta">
                      {r.duplicato ? 'già presente' : r.ok ? `${r.tipo} · ${r.pagine ?? 1} pag · ${r.campi ?? 0} campi` : r.error}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {docList.length > 0 && (
              <div className="docs-list">
                <label>{docList.length} documento/i nel set «{docSet}»</label>
                {docList.map(d => (
                  <div key={d.id} className="doc-row">
                    <IconSheet size={13} />
                    <span className="doc-name" title={d.nome}>{d.nome}</span>
                    <span className="doc-badge">{d.tipo}</span>
                    <span className="doc-dim">{d.pagine} pag · {d.campi} campi</span>
                    <button className="doc-x" title="Rimuovi" onClick={() => removeDoc(d.id)}>×</button>
                  </div>
                ))}
              </div>
            )}

            <button className="btn-primary" onClick={connectDocs} disabled={connecting || !docList.length}>
              {connecting ? 'Connessione in corso…' : <><IconDownload size={14} /> Analizza {docList.length || ''} documento/i</>}
            </button>
            {docErr && <div className="err-card" style={{ marginTop: 12 }}><IconAlert size={15} /><span>{docErr}</span></div>}
          </div>
        ) : kind === 'multi' ? (
          <div className="multi-source">
            <div className="field">
              <label>Database SQL (connessione salvata)</label>
              <select value={multiConnId} onChange={e => setMultiConnId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">-- nessuno (solo Excel) --</option>
                {savedConns.map(c => <option key={c.id} value={c.id}>{c.name} ({c.kind})</option>)}
              </select>
              {!savedConns.length && (
                <div className="ok-note">Nessuna connessione salvata: salvane una dal form del suo tipo (serve MASTER_PASSWORD).</div>
              )}
            </div>
            <div className="field">
              <label>File Excel da incrociare (uno o piu)</label>
              <input type="file" multiple accept=".xlsx,.xls"
                onChange={e => { addMultiFiles(e.target.files); e.target.value = '' }} />
              {multiFiles.map((f, i) => (
                <div key={i} className="doc-row">
                  <IconSheet size={13} />
                  <span className="doc-name" title={f.name}>{f.name}</span>
                  <button className="doc-x" title="Rimuovi"
                    onClick={() => setMultiFiles(prev => prev.filter((_, j) => j !== i))}>x</button>
                </div>
              ))}
            </div>
            {health?.xlsxPaths && (
              <div className="field">
                <label>Oppure percorsi .xlsx sul server (uno per riga)</label>
                <textarea rows={3} value={multiPaths} onChange={e => setMultiPaths(e.target.value)}
                  placeholder="D:\\condivisa\\listino-2026.xlsx" />
              </div>
            )}
            <div className="ok-note">
              Le tabelle del database e i fogli Excel finiscono nello stesso database temporaneo,
              con il prefisso della sorgente nel nome: l&apos;AI puo fare JOIN tra gestionale ed Excel.
            </div>
          </div>
        ) : kind === 'excel' ? (
          <div className="field">
            <label>File Excel (.xlsx / .xls)</label>
            <input type="file" accept=".xlsx,.xls" onChange={handleExcelFile} />
            {excelFileName && <div className="ok-note"><IconCheck size={13} /> {excelFileName}</div>}
          </div>
        ) : kind === 'sqlite' ? (
          <div className="field">
            <label>Percorso file .db</label>
            <input value={database} onChange={e => setDatabase(e.target.value)} placeholder="C:\dati\app.db" />
          </div>
        ) : (
          <>
            {kind === 'mongodb' && (
              <div className="field">
                <label>Connection string (opzionale, ha priorità)</label>
                <input value={uri} onChange={e => setUri(e.target.value)} placeholder="mongodb+srv://user:pass@host/db" />
              </div>
            )}
            <div className="field-row">
              <div className="field">
                <label>Host</label>
                <input value={host} onChange={e => setHost(e.target.value)} />
              </div>
              <div className="field narrow">
                <label>Porta</label>
                <input value={port} onChange={e => setPort(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label>Utente{(kind === 'redis' || kind === 'mongodb') ? ' (opzionale)' : ''}</label>
              <input value={user} onChange={e => setUser(e.target.value)} />
            </div>
            <div className="field">
              <label>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label>{kind === 'redis' ? 'Indice DB (0–15)' : 'Database'}</label>
              <input value={database} onChange={e => setDatabase(e.target.value)} placeholder={kind === 'redis' ? '0' : ''} />
            </div>
          </>
        )}

        {kind !== 'docs' && (
          <button className="btn-primary" onClick={connect} disabled={connecting}>
            {connecting ? 'Connessione in corso…' : 'Connetti'}
          </button>
        )}

        {me.role === 'admin' && health?.connectionsStore && kind !== 'excel' && kind !== 'docs' && kind !== 'multi' && (
          <div className="save-conn-row">
            <input className="sb-input" value={saveName} onChange={e => setSaveName(e.target.value)}
              placeholder="Nome per salvarla (riuso + pianificazione)" />
            <button className="btn-report ghost" onClick={saveConnection}><IconSave size={14} /> Salva</button>
          </div>
        )}
        {saveMsg && <div className="ok-note">{saveMsg}</div>}

        {connErr && <div className="err-card" style={{ marginTop: 12 }}><IconAlert size={15} /><span>{connErr}</span></div>}

        {health?.suiteTools && onAgentOnly && (
          <div className="agent-only-cta">
            <div className="agent-only-or">oppure</div>
            <button className="btn-report ghost" onClick={onAgentOnly}>
              🛠️ Usa l'agente operativo (senza connettere un database)
            </button>
            <div className="agent-only-hint">Fai svolgere azioni sulle app della suite: scadenzario, OCR, confronto documenti…</div>
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
