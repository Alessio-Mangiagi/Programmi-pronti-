import { useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { IconAlert, IconCheck } from '../icons'

/**
 * Tab admin «Chiave AI»: imposta/aggiorna la chiave API Claude a runtime.
 * La chiave viene VERIFICATA dal server con una chiamata reale e poi salvata
 * cifrata (secret.enc) se MASTER_PASSWORD è impostata. Mai mostrata né rimandata.
 */
export function ClaudeKeyTab() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [canPersist, setCanPersist] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const loadStatus = async () => {
    try {
      const d = await apiFetch('/api/admin/claude-key').then(r => r.json())
      setConfigured(!!d.configured)
      setCanPersist(!!d.canPersist)
    } catch { setConfigured(null) }
  }
  useEffect(() => { loadStatus() }, [])

  const save = async () => {
    if (!apiKey.trim() || saving) return
    setSaving(true); setMsg(null)
    try {
      const r = await apiFetch('/api/admin/claude-key', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Errore')
      setMsg({ ok: true, text: d.message || 'Chiave attivata.' })
      setApiKey('')
      loadStatus()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally { setSaving(false) }
  }

  return (
    <div className="claude-key-tab">
      <h3>Chiave API Claude</h3>
      <p className="muted">
        La chiave abilita Claude (analisi, OCR documenti, report). Viene <b>verificata</b> con
        una chiamata di prova, attivata subito senza riavvio e salvata <b>cifrata</b> (AES-256-GCM)
        sul server. Una volta inserita è <b>irraggiungibile</b>: non viene mai mostrata,
        rimandata al browser né registrata nei log — si può solo sostituire.
      </p>

      <div className="key-status">
        Stato: {configured === null ? '…'
          : configured
            ? <span className="ok-note" style={{ margin: 0 }}><IconCheck size={13} /> Claude configurato e attivo</span>
            : <span style={{ color: '#a15c00' }}>Claude non configurato</span>}
      </div>

      {!canPersist && (
        <div className="err-card" style={{ margin: '10px 0' }}>
          <IconAlert size={15} />
          <span>
            <b>MASTER_PASSWORD non impostata sul server</b>: l'inserimento è disabilitato perché
            la chiave deve essere salvata cifrata. Imposta MASTER_PASSWORD nel file .env e riavvia.
          </span>
        </div>
      )}

      <div className="key-form">
        <input
          type="password"
          className="sb-input"
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="sk-ant-…"
          autoComplete="off"
          disabled={!canPersist}
          onKeyDown={e => { if (e.key === 'Enter') save() }}
        />
        <button className="btn-primary" style={{ width: 'auto', margin: 0 }} onClick={save}
          disabled={saving || !apiKey.trim() || !canPersist}>
          {saving ? 'Verifico…' : configured ? 'Sostituisci chiave' : 'Attiva chiave'}
        </button>
      </div>

      {msg && (msg.ok
        ? <div className="ok-note"><IconCheck size={13} /> {msg.text}</div>
        : <div className="err-card" style={{ marginTop: 10 }}><IconAlert size={15} /><span>{msg.text}</span></div>
      )}

      <p className="muted" style={{ marginTop: 14 }}>
        La chiave si crea su <b>console.anthropic.com</b> → API Keys. In alternativa resta
        disponibile la via da terminale: <code>npm run set-key</code>.
      </p>
    </div>
  )
}
