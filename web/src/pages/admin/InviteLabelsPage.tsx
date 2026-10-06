import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { api, errorMessage } from '../../api/client'
import type { InviteLabel, Project } from '../../api/types'
import { useAuth } from '../../auth/useAuth'
import { useCommesse } from '../../commesse/useCommesse'
import Icon from '../../components/Icon'
import Loading from '../../components/Loading'
import Modal from '../../components/Modal'
import { useToast } from '../../components/useToast'
import { ROLE_LABEL } from '../../labels'
import { useLoad } from '../../hooks/useLoad'

type Role = 'admin' | 'manager' | 'field'
const ROLES: Role[] = ['field', 'manager', 'admin']

const ROLE_HINT: Record<Role, string> = {
  field: 'Cantiere: compila moduli, apre e risolve task nei cantieri assegnati.',
  manager: 'Ufficio: crea cantieri, planimetrie e moduli, verifica i task, invita altre persone.',
  admin: 'Amministratore: tutto su tutti i cantieri, comprese queste etichette.',
}

/**
 * Spazio admin → Etichette invito: le credenziali preimpostate di una mansione
 * (ruolo, cantieri/commesse su cui viene iscritto chi accetta, notifiche).
 * Chi invita sceglie un'etichetta e basta: i permessi si decidono solo qui.
 */
export default function InviteLabelsPage() {
  const { user: me } = useAuth()
  const toast = useToast()
  const [labels, setLabels] = useState<InviteLabel[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<InviteLabel | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await api.GET('/invite-labels', { params: { query: { include_archived: true } } })
    if (error) return toast.error(errorMessage(error))
    setLabels(data ?? [])
  }, [toast])

  useLoad(load)

  if (me?.role !== 'admin') return <Navigate to="/projects" replace />

  async function setArchived(lab: InviteLabel, archived: boolean) {
    const { error } = await api.PATCH('/invite-labels/{label_id}', {
      params: { path: { label_id: lab.id } },
      body: { archived },
    })
    if (error) return toast.error(errorMessage(error))
    toast.success(archived ? `"${lab.name}" archiviata` : `"${lab.name}" riattivata`)
    load()
  }

  async function remove(lab: InviteLabel) {
    if (!window.confirm(`Eliminare l'etichetta "${lab.name}"?`)) return
    const { error } = await api.DELETE('/invite-labels/{label_id}', { params: { path: { label_id: lab.id } } })
    if (error) return toast.error(errorMessage(error))
    toast.success(`Etichetta "${lab.name}" eliminata`)
    load()
  }

  const visible = (labels ?? []).filter((l) => showArchived || !l.archived_at)

  return (
    <>
      <header className="topbar">
        <div>
          <span className="eyebrow">Amministrazione</span>
          <h1>Etichette invito</h1>
        </div>
        <div className="topbar-actions">
          <Link to="/inviti" className="btn">
            Inviti
          </Link>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            + Nuova etichetta
          </button>
        </div>
      </header>
      <div className="content">
        <p className="muted">
          Un'etichetta è il profilo preimpostato di una mansione: ruolo, cantieri o commesse su cui viene iscritto chi accetta
          l'invito, preferenze di notifica. Chi invita sceglie l'etichetta e non può cambiarne i permessi: si modificano solo
          da questa pagina. Le modifiche valgono per gli inviti accettati d'ora in poi, non per gli utenti già creati.
        </p>
        <label className="dyn-check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          <span>Mostra anche le archiviate</span>
        </label>
        {labels === null ? (
          <Loading />
        ) : visible.length === 0 ? (
          <div className="empty">Nessuna etichetta. Creane una con "+ Nuova etichetta".</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Etichetta</th>
                  <th>Ruolo</th>
                  <th className="num">Cantieri</th>
                  <th>Notifiche</th>
                  <th className="num">Inviti aperti</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((lab) => (
                  <tr key={lab.id} className={lab.archived_at ? 'row-muted' : undefined}>
                    <td>
                      <strong>{lab.name}</strong>
                      {lab.description && <div className="muted small">{lab.description}</div>}
                      {lab.archived_at && <span className="badge">archiviata</span>}
                    </td>
                    <td>{ROLE_LABEL[lab.role] ?? lab.role}</td>
                    <td className="num">{lab.projects_count}</td>
                    <td className="muted small">
                      {[lab.notify_email && 'email', lab.notify_push && 'push'].filter(Boolean).join(' + ') || 'nessuna'}
                    </td>
                    <td className="num">{lab.pending_invites}</td>
                    <td className="nowrap row-actions">
                      <button className="btn small" onClick={() => setEditing(lab)}>
                        Modifica
                      </button>
                      <button className="btn small" onClick={() => setArchived(lab, !lab.archived_at)}>
                        {lab.archived_at ? 'Riattiva' : 'Archivia'}
                      </button>
                      <button className="btn small btn-danger" onClick={() => remove(lab)} aria-label={`Elimina ${lab.name}`}>
                        <Icon name="x" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && (
        <Modal title="Nuova etichetta" onClose={() => setCreating(false)} width={640}>
          <LabelForm
            onDone={() => {
              setCreating(false)
              load()
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal title={`Etichetta "${editing.name}"`} onClose={() => setEditing(null)} width={640}>
          <LabelForm
            label={editing}
            onDone={() => {
              setEditing(null)
              load()
            }}
          />
        </Modal>
      )}
    </>
  )
}

function LabelForm({ label, onDone }: { label?: InviteLabel; onDone: () => void }) {
  const toast = useToast()
  const { commesse } = useCommesse()
  const [projects, setProjects] = useState<Project[]>([])
  const [name, setName] = useState(label?.name ?? '')
  const [description, setDescription] = useState(label?.description ?? '')
  const [role, setRole] = useState<Role>((label?.role as Role) ?? 'field')
  const [projectIds, setProjectIds] = useState<string[]>(label?.project_ids ?? [])
  const [commessaIds, setCommessaIds] = useState<string[]>(label?.commessa_ids ?? [])
  const [notifyEmail, setNotifyEmail] = useState(label?.notify_email ?? true)
  const [notifyPush, setNotifyPush] = useState(label?.notify_push ?? true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.GET('/projects').then(({ data }) => setProjects(data ?? []))
  }, [])

  const toggle = (list: string[], set: (v: string[]) => void, id: string) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  // I cantieri di una commessa già selezionata arrivano da lì: inutile spuntarli due volte.
  const coveredByCommessa = new Set(
    projects.filter((p) => p.commessa_id && commessaIds.includes(p.commessa_id)).map((p) => p.id),
  )

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return toast.error("Dai un nome all'etichetta")
    setBusy(true)
    const body = {
      name: name.trim(),
      description: description.trim() || null,
      role,
      project_ids: projectIds.filter((id) => !coveredByCommessa.has(id)),
      commessa_ids: commessaIds,
      notify_email: notifyEmail,
      notify_push: notifyPush,
    }
    const { error } = label
      ? await api.PATCH('/invite-labels/{label_id}', { params: { path: { label_id: label.id } }, body })
      : await api.POST('/invite-labels', { body })
    setBusy(false)
    if (error) return toast.error(errorMessage(error))
    toast.success(label ? 'Etichetta salvata' : 'Etichetta creata')
    onDone()
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="lab-name">Nome</label>
        <input id="lab-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="es. Capocantiere" autoFocus />
      </div>
      <div className="field">
        <label htmlFor="lab-desc">Descrizione</label>
        <input
          id="lab-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="A cosa serve questa etichetta"
        />
      </div>
      <div className="field">
        <label htmlFor="lab-role">Ruolo</label>
        <select id="lab-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r] ?? r}
            </option>
          ))}
        </select>
        <div className="muted small">{ROLE_HINT[role]}</div>
      </div>

      <div className="field">
        <label>Commesse assegnate</label>
        <div className="dyn-multi">
          {commesse.length === 0 && <span className="muted small">Nessuna commessa.</span>}
          {commesse.map((c) => (
            <label key={c.id} className={`chip${commessaIds.includes(c.id) ? ' chip-on chip-primary' : ''}`}>
              <input
                type="checkbox"
                hidden
                checked={commessaIds.includes(c.id)}
                onChange={() => toggle(commessaIds, setCommessaIds, c.id)}
              />
              {c.code} · {c.name}
            </label>
          ))}
        </div>
        <div className="muted small">Tutti i cantieri della commessa, anche quelli aggiunti dopo l'invito.</div>
      </div>

      <div className="field">
        <label>Singoli cantieri</label>
        <div className="dyn-multi">
          {projects.length === 0 && <span className="muted small">Nessun cantiere.</span>}
          {projects.map((p) => {
            const covered = coveredByCommessa.has(p.id)
            const on = covered || projectIds.includes(p.id)
            return (
              <label key={p.id} className={`chip${on ? ' chip-on chip-primary' : ''}`} title={covered ? 'Già incluso dalla commessa' : undefined}>
                <input
                  type="checkbox"
                  hidden
                  disabled={covered}
                  checked={on}
                  onChange={() => toggle(projectIds, setProjectIds, p.id)}
                />
                {p.name}
              </label>
            )
          })}
        </div>
      </div>

      <label className="dyn-check">
        <input type="checkbox" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />
        <span>Notifiche via email</span>
      </label>
      <label className="dyn-check">
        <input type="checkbox" checked={notifyPush} onChange={(e) => setNotifyPush(e.target.checked)} />
        <span>Notifiche push sull'app</span>
      </label>

      <div className="row form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Salvataggio…' : label ? 'Salva' : 'Crea etichetta'}
        </button>
        <button type="button" className="btn" onClick={onDone}>
          Annulla
        </button>
      </div>
    </form>
  )
}
