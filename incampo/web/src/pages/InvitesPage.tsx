import { useCallback, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { Invite, InviteLabel } from '../api/types'
import { isManager, useAuth } from '../auth/useAuth'
import Loading from '../components/Loading'
import Modal from '../components/Modal'
import { useToast } from '../components/useToast'
import { ROLE_LABEL } from '../labels'
import { useLoad } from '../hooks/useLoad'

const STATUS_LABEL: Record<string, string> = {
  pending: 'In attesa',
  accepted: 'Accettato',
  revoked: 'Revocato',
  expired: 'Scaduto',
}

const fmtDate = (iso: string) => new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleDateString('it-IT')

/**
 * Inviti: si sceglie un'etichetta (le credenziali preimpostate decise dagli
 * amministratori) e si manda il link. Il link esiste in chiaro solo appena
 * creato — dopo si può solo rigenerare con "Rimanda".
 * L'admin vede tutti gli inviti, il manager i propri.
 */
export default function InvitesPage() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [invites, setInvites] = useState<Invite[] | null>(null)
  const [labels, setLabels] = useState<InviteLabel[]>([])
  const [showDone, setShowDone] = useState(false)
  const [creating, setCreating] = useState(false)
  /** Link appena generato da mostrare una volta sola (id invito → url). */
  const [fresh, setFresh] = useState<Invite | null>(null)

  const load = useCallback(async () => {
    const [i, l] = await Promise.all([
      api.GET('/invites', { params: { query: { include_done: true } } }),
      api.GET('/invite-labels'),
    ])
    if (i.error) return toast.error(errorMessage(i.error))
    setInvites(i.data ?? [])
    setLabels(l.data ?? [])
  }, [toast])

  useLoad(load)

  if (!isManager(me)) return <Navigate to="/projects" replace />

  async function revoke(inv: Invite) {
    if (!window.confirm(`Revocare l'invito a ${inv.email}? Il link smette di funzionare subito.`)) return
    const { error } = await api.DELETE('/invites/{invite_id}', { params: { path: { invite_id: inv.id } } })
    if (error) return toast.error(errorMessage(error))
    toast.success('Invito revocato')
    load()
  }

  async function resend(inv: Invite) {
    const { data, error } = await api.POST('/invites/{invite_id}/resend', { params: { path: { invite_id: inv.id } } })
    if (error || !data) return toast.error(errorMessage(error))
    toast.success(data.email_sent_at ? `Invito rimandato a ${data.email}` : 'Nuovo link generato: copialo qui sotto')
    setFresh(data)
    load()
  }

  const visible = (invites ?? []).filter((i) => showDone || i.status === 'pending')
  const pending = (invites ?? []).filter((i) => i.status === 'pending').length

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">Persone</span>
          <h1>Inviti</h1>
        </div>
        <div className="topbar-actions">
          {me?.role === 'admin' && (
            <Link to="/admin/etichette" className="btn">
              Etichette
            </Link>
          )}
          <button className="btn btn-primary" onClick={() => setCreating(true)} disabled={labels.length === 0}>
            + Nuovo invito
          </button>
        </div>
      </header>
      <div className="content">
        <p className="muted">
          L'invito porta con sé un'etichetta: chi accetta entra già con il ruolo, i cantieri e le notifiche previsti da quel
          profilo. Le etichette si modificano solo nell'area amministratori.
          {pending > 0 && ` Inviti in attesa: ${pending}.`}
        </p>
        {labels.length === 0 && (
          <div className="callout callout-warn">
            Nessuna etichetta disponibile: {me?.role === 'admin' ? (
              <Link to="/admin/etichette">creane una</Link>
            ) : (
              'chiedi a un amministratore di crearne una'
            )}{' '}
            prima di invitare.
          </div>
        )}
        <label className="dyn-check">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
          <span>Mostra anche accettati, revocati e scaduti</span>
        </label>

        {invites === null ? (
          <Loading />
        ) : visible.length === 0 ? (
          <div className="empty">Nessun invito in attesa.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Etichetta</th>
                  <th>Ruolo</th>
                  <th>Stato</th>
                  <th>Scadenza</th>
                  <th>Invitato da</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((inv) => (
                  <tr key={inv.id} className={inv.status === 'pending' ? undefined : 'row-muted'}>
                    <td>
                      <strong>{inv.email}</strong>
                      {inv.name && <div className="muted small">{inv.name}</div>}
                    </td>
                    <td>{inv.label_name}</td>
                    <td>{ROLE_LABEL[inv.role] ?? inv.role}</td>
                    <td>
                      <span className={`badge status-${inv.status === 'pending' ? 'assigned' : inv.status === 'accepted' ? 'resolved' : 'open'}`}>
                        {STATUS_LABEL[inv.status] ?? inv.status}
                      </span>
                      {inv.status === 'pending' && !inv.email_sent_at && <div className="muted small">email non partita</div>}
                    </td>
                    <td>{fmtDate(inv.expires_at)}</td>
                    <td className="muted small">{inv.invited_by_name ?? '—'}</td>
                    <td className="nowrap row-actions">
                      {inv.status !== 'accepted' && inv.status !== 'revoked' && (
                        <button className="btn small" onClick={() => resend(inv)}>
                          Rimanda
                        </button>
                      )}
                      {inv.status === 'pending' && (
                        <button className="btn small btn-danger" onClick={() => revoke(inv)}>
                          Revoca
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creating && (
        <Modal title="Nuovo invito" onClose={() => setCreating(false)} width={560}>
          <InviteForm
            labels={labels}
            onDone={(inv) => {
              setCreating(false)
              setFresh(inv)
              load()
            }}
          />
        </Modal>
      )}
      {fresh?.url && (
        <Modal title={`Invito per ${fresh.email}`} onClose={() => setFresh(null)} width={560}>
          <InviteLink invite={fresh} />
        </Modal>
      )}
    </>
  )
}

function InviteLink({ invite }: { invite: Invite }) {
  const toast = useToast()
  const url = invite.url ?? ''

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copiato')
    } catch {
      toast.error('Copia non riuscita: seleziona il link a mano')
    }
  }

  return (
    <div>
      <p>
        {invite.email_sent_at
          ? `Email inviata a ${invite.email}. Se non arriva, consegna tu il link:`
          : `Email non inviata (SMTP non configurato o non raggiungibile): consegna tu il link a ${invite.email}.`}
      </p>
      <div className="field">
        <label htmlFor="inv-url">Link d'invito</label>
        <input id="inv-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
      </div>
      <p className="muted small">
        Vale una sola volta e scade il {fmtDate(invite.expires_at)}. Non resta salvato da nessuna parte: se lo perdi, usa
        "Rimanda" per generarne un altro.
      </p>
      <div className="row form-actions">
        <button type="button" className="btn btn-primary" onClick={copy}>
          Copia link
        </button>
      </div>
    </div>
  )
}

function InviteForm({ labels, onDone }: { labels: InviteLabel[]; onDone: (inv: Invite) => void }) {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [labelId, setLabelId] = useState(labels[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const label = labels.find((l) => l.id === labelId)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return toast.error("Indica l'email da invitare")
    if (!labelId) return toast.error("Scegli un'etichetta")
    setBusy(true)
    const { data, error } = await api.POST('/invites', {
      body: { email: email.trim(), label_id: labelId, name: name.trim() || null },
    })
    setBusy(false)
    if (error || !data) return toast.error(errorMessage(error))
    toast.success(`Invito creato per ${data.email}`)
    onDone(data)
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="inv-email">Email</label>
        <input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="nome@azienda.it" />
      </div>
      <div className="field">
        <label htmlFor="inv-name">Nome (facoltativo)</label>
        <input id="inv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Come lo chiamiamo" />
      </div>
      <div className="field">
        <label htmlFor="inv-label">Etichetta</label>
        <select id="inv-label" value={labelId} onChange={(e) => setLabelId(e.target.value)}>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {label && (
          <div className="muted small">
            Ruolo {ROLE_LABEL[label.role] ?? label.role} · {label.projects_count === 1 ? '1 cantiere' : `${label.projects_count} cantieri`}
            {label.description && ` · ${label.description}`}
          </div>
        )}
      </div>
      <div className="row form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Invio…' : 'Crea invito'}
        </button>
      </div>
    </form>
  )
}
