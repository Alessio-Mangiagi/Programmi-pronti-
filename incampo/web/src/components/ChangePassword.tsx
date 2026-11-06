// "><(((º> sabusabu <º)))><"
// "Cambia password" nella colonna di sinistra: ognuno cambia la sua password di InCampo dando quella attuale
// (POST /auth/me/password). Prima la cambiava solo l'amministratore da Utenti. Chi entra dal Portale Suite o
// con la password del portale non ha una password InCampo da ricordare: la finestra lo spiega.
import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { api, errorMessage } from '../api/client'
import { PASSWORD_MIN } from '../labels'
import Modal from './Modal'
import { useToast } from './useToast'

export default function ChangePassword() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        Cambia password
      </button>
      {/* portal: dentro la sidebar la modale erediterebbe i colori chiari del footer (come ContactAdmin) */}
      {open &&
        createPortal(
          <Modal title="Cambia password" onClose={() => setOpen(false)} width={480}>
            <ChangePasswordForm onDone={() => setOpen(false)} />
          </Modal>,
          document.body,
        )}
    </>
  )
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    // stessi controlli del server, detti prima e in italiano
    if (next.length < PASSWORD_MIN) return setError(`La nuova password deve avere almeno ${PASSWORD_MIN} caratteri`)
    if (next !== confirm) return setError('Le due password non coincidono')
    if (next === current) return setError('La nuova password deve essere diversa da quella attuale')
    setBusy(true)
    const { error: err } = await api.POST('/auth/me/password', { body: { current_password: current, new_password: next } })
    setBusy(false)
    if (err) return setError(errorMessage(err))
    toast.success('Password cambiata')
    onDone()
  }

  return (
    <form onSubmit={submit}>
      <p className="muted small">
        Vale per entrare in InCampo dal web e dall'app. Se entri dal Portale Suite Cosedil puoi usare anche la password
        del portale: questa resta una riserva.
      </p>
      <div className="field">
        <label htmlFor="cp-current">Password attuale</label>
        <input id="cp-current" type="password" autoComplete="current-password" value={current}
               onChange={(e) => setCurrent(e.target.value)} required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="cp-new">Nuova password (min. {PASSWORD_MIN} caratteri)</label>
        <input id="cp-new" type="password" autoComplete="new-password" minLength={PASSWORD_MIN} value={next}
               onChange={(e) => setNext(e.target.value)} required />
      </div>
      <div className="field">
        <label htmlFor="cp-confirm">Ripeti la nuova password</label>
        <input id="cp-confirm" type="password" autoComplete="new-password" value={confirm}
               onChange={(e) => setConfirm(e.target.value)} required />
      </div>
      <p className="muted small">
        Non ricordi la password attuale (per esempio perché sei sempre entrato dal portale)? Chiedi all'amministratore
        di reimpostarla.
      </p>
      {error && <p className="error">{error}</p>}
      <div className="row form-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Salvataggio…' : 'Cambia password'}
        </button>
        <button className="btn" type="button" onClick={onDone}>
          Annulla
        </button>
      </div>
    </form>
  )
}
