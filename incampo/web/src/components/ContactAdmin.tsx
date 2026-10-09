import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import Icon from './Icon'
import Modal from './Modal'
import { useToast } from './useToast'

const MAX_LEN = 4000

/**
 * "Contatta l'amministratore": pulsante nella sidebar che apre un modulo di
 * segnalazione. Il messaggio arriva agli admin (email/push) con la pagina da
 * cui si scrive e, se l'utente lo lascia spuntato, il cantiere aperto.
 */
export default function ContactAdmin({ projectId, projectName }: { projectId?: string; projectName?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Icon name="message" /> Contatta l'amministratore
      </button>
      {/* portal: dentro la sidebar la modale erediterebbe i colori chiari del footer */}
      {open &&
        createPortal(
          <Modal title="Contatta l'amministratore" onClose={() => setOpen(false)} width={560}>
            <ContactForm projectId={projectId} projectName={projectName} onDone={() => setOpen(false)} />
          </Modal>,
          document.body,
        )}
    </>
  )
}

function ContactForm({ projectId, projectName, onDone }: { projectId?: string; projectName?: string; onDone: () => void }) {
  const toast = useToast()
  const location = useLocation()
  const [message, setMessage] = useState('')
  const [aboutProject, setAboutProject] = useState(Boolean(projectId))
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!message.trim()) return toast.error('Scrivi il messaggio')
    setBusy(true)
    const { error } = await api.POST('/support/messages', {
      body: {
        message: message.trim(),
        project_id: aboutProject && projectId ? projectId : null,
        page: (location.pathname + location.search).slice(0, 500),
      },
    })
    setBusy(false)
    if (error) return toast.error(errorMessage(error, 'Messaggio non inviato'))
    toast.success("Messaggio inviato all'amministratore")
    onDone()
  }

  return (
    <form onSubmit={submit}>
      <p className="muted">
        Descrivi il problema: cosa stavi facendo, cosa ti aspettavi e cosa è successo. L'amministratore riceve il messaggio
        con la pagina in cui ti trovi.
      </p>
      <div className="field">
        <label htmlFor="support-message">Messaggio</label>
        <textarea
          id="support-message"
          rows={6}
          maxLength={MAX_LEN}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="es. Non riesco a caricare la planimetria del piano terra: compare un errore…"
          autoFocus
        />
        <div className="muted small">
          {message.length}/{MAX_LEN}
        </div>
      </div>
      {projectId && (
        <label className="dyn-check">
          <input type="checkbox" checked={aboutProject} onChange={(e) => setAboutProject(e.target.checked)} />
          <span>Riguarda il cantiere {projectName ?? 'aperto'}</span>
        </label>
      )}
      <div className="row form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy || !message.trim()}>
          {busy ? 'Invio…' : 'Invia'}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Annulla
        </button>
      </div>
    </form>
  )
}
