import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { InvitePreview } from '../api/types'
import { useAuth } from '../auth/useAuth'
import Loading from '../components/Loading'

const ROLE_LABEL: Record<string, string> = { admin: 'Amministratore', manager: 'Ufficio', field: 'Cantiere' }

/**
 * Pagina pubblica del link d'invito: mostra con che etichetta si entra e
 * chiede nome e password. L'utente nasce già configurato (ruolo, cantieri,
 * notifiche dell'etichetta) e la sessione parte subito.
 */
export default function InviteAcceptPage() {
  const { token = '' } = useParams()
  const { user, applySession } = useAuth()
  const navigate = useNavigate()
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.GET('/invites/token/{token}', { params: { path: { token } } }).then(({ data }) => {
      if (!data) return setInvalid(true)
      setPreview(data)
      setName(data.name ?? '')
    })
  }, [token])

  if (user) return <Navigate to="/projects" replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('La password deve avere almeno 8 caratteri')
    if (password !== confirm) return setError('Le due password non coincidono')
    setBusy(true)
    const { data, error: err } = await api.POST('/invites/accept', { body: { token, name: name.trim(), password } })
    setBusy(false)
    if (err || !data) return setError(errorMessage(err, 'Invito non più valido'))
    applySession(data.access_token, data.user)
    navigate('/projects', { replace: true })
  }

  if (invalid) {
    return (
      <div className="login-page">
        <div className="card login-card">
          <h1>Invito non valido</h1>
          <p className="muted">
            Questo link è scaduto, è già stato usato oppure è stato revocato. Chiedi a chi ti ha invitato di generarne uno
            nuovo.
          </p>
          <Link to="/login" className="btn">
            Vai all'accesso
          </Link>
        </div>
      </div>
    )
  }

  if (!preview) return <Loading className="login-page" />

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={onSubmit}>
        <div className="brand">
          <span className="brand-mark">FV</span>
          <span>
            InCampo
            <span className="brand-sub">Cosedil S.p.A.</span>
          </span>
        </div>
        <h1>Sei stato invitato</h1>
        <p className="muted">
          <strong>{preview.email}</strong> · {preview.label_name}
        </p>
        <ul className="invite-summary">
          <li>
            Ruolo: <strong>{ROLE_LABEL[preview.role] ?? preview.role}</strong>
          </li>
          <li>
            Cantieri assegnati: <strong>{preview.projects_count}</strong>
          </li>
        </ul>
        <div className="field">
          <label htmlFor="inv-name">Il tuo nome</label>
          <input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="inv-pwd">Scegli una password</label>
          <input
            id="inv-pwd"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <div className="muted small">Almeno 8 caratteri.</div>
        </div>
        <div className="field">
          <label htmlFor="inv-pwd2">Ripeti la password</label>
          <input
            id="inv-pwd2"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Attendere…' : 'Entra in InCampo'}
        </button>
      </form>
    </div>
  )
}
