import { useEffect, useRef, useState } from 'react'
// `xlsx` importato DINAMICAMENTE al momento dell'import/export: non entra nel
// bundle iniziale (vale ~400 KB, serve solo in questo tab admin).
import { apiFetch } from '../api'
import { IconTrash, IconKey, IconRefresh } from '../icons'
import type { UserRow } from './adminTypes'

// ── Tab: Utenti ───────────────────────────────────────────────────────────────
interface ImportResult { row: number; username: string; ok: boolean; error?: string; generatedPassword?: string }
interface ParsedRow { username: string; password: string; role: 'user' | 'admin' }
// Riga d'anteprima annotata (dedup / validità) prima dell'invio.
interface PreviewRow extends ParsedRow { dup: boolean; invalid: string }

/** Legge il foglio Excel e normalizza le intestazioni (accetta ITA e ENG). Password OPZIONALE. */
async function parseUsersExcel(buf: ArrayBuffer): Promise<ParsedRow[]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(buf, { type: 'array' })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
  const pick = (r: Record<string, unknown>, keys: string[]) => {
    for (const k of Object.keys(r)) {
      if (keys.includes(k.trim().toLowerCase())) return String(r[k] ?? '').trim()
    }
    return ''
  }
  return rows.map(r => ({
    username: pick(r, ['username', 'utente', 'user', 'nome utente', 'account']).toLowerCase(),
    password: pick(r, ['password', 'pwd']),
    role: pick(r, ['role', 'ruolo']).toLowerCase() === 'admin' ? 'admin' as const : 'user' as const,
  })).filter(r => r.username || r.password)
}

/** Annota duplicati (username ripetuto nel file) e validità minima username. */
function buildPreview(rows: ParsedRow[]): PreviewRow[] {
  const seen = new Set<string>()
  return rows.map(r => {
    const dup = seen.has(r.username)
    seen.add(r.username)
    let invalid = ''
    if (!/^[a-z0-9._-]{3,32}$/.test(r.username)) invalid = 'username non valido (3-32, a-z 0-9 . _ -)'
    else if (r.password && r.password.length < 8) invalid = 'password < 8 caratteri'
    return { ...r, dup, invalid }
  })
}

/** Scarica un workbook (credenziali / template) col nome dato. */
async function downloadWorkbook(rows: Record<string, unknown>[], filename: string) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Utenti')
  XLSX.writeFile(wb, filename)
}

export function UsersTab({ meId }: { meId: number }) {
  const [users, setUsers] = useState<UserRow[]>([])
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [mustChange, setMustChange] = useState(true)
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<PreviewRow[] | null>(null)
  const [importRes, setImportRes] = useState<ImportResult[] | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const load = async () => setUsers((await apiFetch('/api/users').then(x => x.json())).users || [])
  useEffect(() => { load() }, [])

  const flash = (msg: string) => { setOk(msg); setTimeout(() => setOk(''), 4000) }

  // Genera una password casuale leggibile e la mostra nel campo (l'admin la comunica).
  const genPassword = () => {
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
    const b = crypto.getRandomValues(new Uint8Array(12))
    setP(Array.from(b, x => abc[x % abc.length]).join(''))
    setShowPw(true)
  }

  const create = async () => {
    setErr(''); setOk('')
    const r = await apiFetch('/api/users', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role, mustChange }),
    })
    const d = await r.json()
    if (!r.ok) { setErr(d.error || 'Errore'); return }
    flash(`Utente «${d.user.username}» creato${mustChange ? ' (dovrà cambiare password al 1° accesso)' : ''}.`)
    setU(''); setP(''); setShowPw(false); load()
  }

  // Passo 1: leggi il file e mostra l'anteprima (niente creazione ancora).
  const pickFile = async (file: File) => {
    setErr(''); setImportRes(null); setPreview(null)
    try {
      const parsed = await parseUsersExcel(await file.arrayBuffer())
      if (parsed.length === 0) throw new Error('Nessuna riga valida: serve almeno la colonna "username" (o "utente")')
      setPreview(buildPreview(parsed))
    } catch (e) { setErr((e as Error).message) }
    finally { if (fileRef.current) fileRef.current.value = '' }
  }

  // Passo 2: conferma → invia (scarta duplicati e righe non valide).
  const confirmImport = async () => {
    if (!preview) return
    const toSend = preview.filter(r => !r.dup && !r.invalid)
      .map(({ username, password, role }) => ({ username, password, role }))
    if (toSend.length === 0) { setErr('Nessuna riga valida da importare'); return }
    setImporting(true); setErr('')
    try {
      const r = await apiFetch('/api/users/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ users: toSend }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'Errore import')
      setImportRes(d.results || [])
      setPreview(null)
      load()
    } catch (e) { setErr((e as Error).message) }
    finally { setImporting(false) }
  }

  // Scarica le password generate dal server (da distribuire agli utenti).
  const downloadGenerated = () => {
    const gen = (importRes || []).filter(r => r.ok && r.generatedPassword)
      .map(r => ({ username: r.username, password: r.generatedPassword }))
    if (gen.length) downloadWorkbook(gen, 'credenziali-generate.xlsx')
  }

  const downloadTemplate = () => downloadWorkbook(
    [{ username: 'mario.rossi', password: '(vuoto = generata)', ruolo: 'user' }],
    'template-utenti.xlsx',
  )

  const del = async (u: UserRow) => {
    if (!confirm(`Eliminare l'utente «${u.username}»?`)) return
    const r = await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' })
    if (!r.ok) { const d = await r.json(); setErr(d.error || 'Errore') } else { flash(`Utente «${u.username}» eliminato.`); load() }
  }

  const resetPw = async (u: UserRow) => {
    if (!confirm(`Reset password di «${u.username}»? Le sessioni attive verranno chiuse.`)) return
    const r = await apiFetch(`/api/users/${u.id}/reset-password`, { method: 'POST' })
    const d = await r.json()
    // "><(((º> sabusabu <º)))><"
    if (!r.ok) { setErr(d.error || 'Errore'); return }
    // Password temporanea mostrata UNA volta: l'admin la comunica all'utente.
    window.prompt(`Password temporanea di «${u.username}» (comunicala all'utente, la cambierà al 1° accesso):`, d.tempPassword)
    flash(`Password di «${u.username}» resettata.`)
    load()
  }

  const changeRole = async (u: UserRow, newRole: 'user' | 'admin') => {
    setErr('')
    const r = await apiFetch(`/api/users/${u.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: newRole }),
    })
    if (!r.ok) { const d = await r.json(); setErr(d.error || 'Errore') } else { flash(`Ruolo di «${u.username}» → ${newRole}.`); load() }
  }

  const validCount = preview ? preview.filter(r => !r.dup && !r.invalid).length : 0

  return (
    <div className="admin-cols">
      <div className="admin-col">
        <h3>Utenti</h3>
        {users.map(u => (
          <div key={u.id} className="job-row">
            <div className="job-main">
              <div className="job-name">
                {u.username}
                {!!u.must_change_pw && <span className="muted" title="Deve cambiare la password"> · 🔑</span>}
              </div>
            </div>
            <div className="job-actions">
              {u.id !== meId ? (
                <select value={u.role} onChange={e => changeRole(u, e.target.value as 'user' | 'admin')}
                  title="Cambia ruolo" style={{ marginRight: 4 }}>
                  <option value="user">Utente</option><option value="admin">Admin</option>
                </select>
              ) : <span className="muted" style={{ marginRight: 4 }}>({u.role})</span>}
              <button onClick={() => resetPw(u)} title="Reset password"><IconKey size={13} /></button>
              {u.id !== meId && <button onClick={() => del(u)} title="Elimina"><IconTrash size={13} /></button>}
            </div>
          </div>
        ))}
      </div>
      <div className="admin-col">
        <h3>Nuovo utente</h3>
        <div className="field"><label>Utente</label>
          <input value={username} onChange={e => setU(e.target.value)} placeholder="min 3, a-z 0-9 . _ -" /></div>
        <div className="field"><label>Password (min 8)</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setP(e.target.value)} style={{ flex: 1 }} />
            <button type="button" onClick={() => setShowPw(s => !s)} title={showPw ? 'Nascondi' : 'Mostra'}>{showPw ? '🙈' : '👁'}</button>
            <button type="button" onClick={genPassword} title="Genera casuale"><IconRefresh size={13} /></button>
          </div></div>
        <div className="field"><label>Ruolo</label>
          <select value={role} onChange={e => setRole(e.target.value as 'user' | 'admin')}>
            <option value="user">Utente</option><option value="admin">Amministratore</option>
          </select></div>
        <label className="field" style={{ display: 'flex', alignItems: 'center', gap: 8, flexDirection: 'row' }}>
          <input type="checkbox" checked={mustChange} onChange={e => setMustChange(e.target.checked)} style={{ width: 'auto' }} />
          <span>Richiedi cambio password al 1° accesso</span>
        </label>
        <button className="btn-primary" onClick={create} disabled={!username || !password}>Crea utente</button>

        <h3 style={{ marginTop: 24 }}>Importa da Excel</h3>
        <div className="muted" style={{ marginBottom: 8 }}>
          File .xlsx con colonna <code>username</code> (o <code>utente</code>); <code>password</code> è
          opzionale (vuota → generata dal server); <code>ruolo</code> opzionale (<code>user</code>/<code>admin</code>).
          <button className="btn-export" style={{ marginLeft: 6 }} onClick={downloadTemplate}>Scarica template</button>
        </div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" disabled={importing}
          onChange={e => { const f = e.target.files?.[0]; if (f) pickFile(f) }} />

        {preview && (
          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ marginBottom: 6 }}>
              Anteprima: {validCount} valide su {preview.length}
              {preview.some(r => r.dup || r.invalid) && ' (le righe segnate vengono scartate)'}
            </div>
            <div className="table-wrap" style={{ maxHeight: 220 }}>
              <table>
                <thead><tr><th>#</th><th>Utente</th><th>Password</th><th>Ruolo</th><th>Nota</th></tr></thead>
                <tbody>
                  {preview.map((r, i) => (
                    <tr key={i} style={r.dup || r.invalid ? { opacity: .5 } : undefined}>
                      <td>{i + 1}</td><td>{r.username || '—'}</td>
                      <td>{r.password ? '••••' : <span className="muted">generata</span>}</td>
                      <td>{r.role}</td>
                      <td style={{ color: r.invalid || r.dup ? 'var(--danger, #c0392b)' : undefined }}>
                        {r.invalid || (r.dup ? 'duplicato' : 'ok')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn-primary" onClick={confirmImport} disabled={importing || validCount === 0}>
                {importing ? 'Import…' : `Conferma import (${validCount})`}
              </button>
              <button className="btn-export" onClick={() => setPreview(null)} disabled={importing}>Annulla</button>
            </div>
          </div>
        )}

        {importRes && (
          <div style={{ marginTop: 10 }}>
            <div className="ok-note">Creati {importRes.filter(r => r.ok).length} su {importRes.length}</div>
            {importRes.some(r => r.ok && r.generatedPassword) && (
              <button className="btn-primary" style={{ marginTop: 8 }} onClick={downloadGenerated}>
                Scarica credenziali generate (.xlsx)
              </button>
            )}
            {importRes.filter(r => !r.ok).map(r => (
              <div key={r.row} className="err-card" style={{ marginTop: 6 }}>
                Riga {r.row} ({r.username || '—'}): {r.error}
              </div>
            ))}
          </div>
        )}
        {ok && <div className="ok-note" style={{ marginTop: 10 }}>{ok}</div>}
        {err && <div className="err-card" style={{ marginTop: 10 }}>{err}</div>}
      </div>
    </div>
  )
}
