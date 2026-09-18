import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, errorMessage } from '../api/client'
import type { Submission, User, WbsNode, WbsNodeDetail } from '../api/types'
import { isManager, useAuth } from '../auth/AuthContext'
import Icon from '../components/Icon'
import Loading from '../components/Loading'
import Modal from '../components/Modal'
import { useToast } from '../components/Toast'
import SubmissionDetail from '../forms/SubmissionDetail'
import SubmissionForm from '../forms/SubmissionForm'
import { findNonConformity } from '../forms/nonConformity'
import type { FormData, FormSchema } from '@fieldview/form-core'
import { useLookups } from '../hooks/useLookups'
import { useProject } from '../hooks/useProject'

type TreeNode = WbsNode & { children: TreeNode[] }

/** Lista piatta (parent_id) → albero, mantenendo l'ordine del server (position). */
function buildTree(nodes: WbsNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>(nodes.map((n) => [n.id, { ...n, children: [] }]))
  const roots: TreeNode[] = []
  for (const n of byId.values()) {
    const parent = n.parent_id ? byId.get(n.parent_id) : undefined
    if (parent) parent.children.push(n)
    else roots.push(n)
  }
  return roots
}

function label(n: WbsNode) {
  return n.code ? `${n.code} ${n.name}` : n.name
}

/** Moduli propri + di tutti i discendenti (numero mostrato accanto alla voce). */
function subtreeCount(n: TreeNode): number {
  return n.submissions_count + n.children.reduce((acc, c) => acc + subtreeCount(c), 0)
}

function fmtDate(iso: string) {
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

/**
 * Albero WBS del cantiere: a sinistra le voci (espandibili), a destra la voce
 * selezionata con i moduli compilati su di essa e il pulsante per compilarne uno nuovo.
 * La selezione sta nell'URL (?node=) così è condivisibile e sopravvive al reload.
 */
export default function WbsPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  const toast = useToast()
  const project = useProject(projectId)
  const lookups = useLookups()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('node')

  const [nodes, setNodes] = useState<WbsNode[] | null>(null)
  const [members, setMembers] = useState<User[]>([])
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  // Modale per nuova voce (parent = null → radice) e modifica voce
  const [adding, setAdding] = useState<{ parentId: string | null } | null>(null)
  const [editing, setEditing] = useState<WbsNode | null>(null)

  const loadNodes = useCallback(async () => {
    const { data, error } = await api.GET('/projects/{project_id}/wbs', { params: { path: { project_id: projectId } } })
    if (error) return setError(errorMessage(error))
    setNodes(data ?? [])
  }, [projectId])

  useEffect(() => {
    loadNodes()
    api.GET('/projects/{project_id}/members', { params: { path: { project_id: projectId } } }).then(({ data }) => {
      if (data) setMembers(data)
    })
  }, [projectId, loadNodes])

  const tree = useMemo(() => buildTree(nodes ?? []), [nodes])
  const byId = useMemo(() => new Map((nodes ?? []).map((n) => [n.id, n])), [nodes])

  // La voce selezionata (anche da link) deve essere visibile: espandi i suoi antenati
  useEffect(() => {
    if (!selectedId || !byId.size) return
    setExpanded((prev) => {
      const next = new Set(prev)
      let n = byId.get(selectedId)
      while (n?.parent_id) {
        next.add(n.parent_id)
        n = byId.get(n.parent_id)
      }
      return next
    })
  }, [selectedId, byId])

  function select(id: string | null) {
    setSearchParams(id ? { node: id } : {}, { replace: true })
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function remove(n: WbsNode) {
    if (!confirm(`Eliminare la voce "${label(n)}"?`)) return
    const { error } = await api.DELETE('/wbs/{node_id}', { params: { path: { node_id: n.id } } })
    if (error) return toast.error(errorMessage(error))
    toast.success('Voce eliminata')
    if (selectedId === n.id) select(n.parent_id ?? null)
    await loadNodes()
  }

  const canEdit = isManager(user)
  const selected = selectedId ? (byId.get(selectedId) ?? null) : null

  function renderNode(n: TreeNode, depth: number) {
    const open = expanded.has(n.id)
    const total = subtreeCount(n)
    return (
      <li key={n.id}>
        <div
          className={`wbs-row${n.id === selectedId ? ' is-selected' : ''}`}
          style={{ paddingLeft: `${0.4 + depth * 1.1}rem` }}
          onClick={() => select(n.id)}
          onKeyDown={(e) => e.key === 'Enter' && select(n.id)}
          role="treeitem"
          aria-selected={n.id === selectedId}
          aria-expanded={n.children.length ? open : undefined}
          tabIndex={0}
        >
          {n.children.length > 0 ? (
            <button
              type="button"
              className="wbs-toggle"
              aria-label={open ? 'Chiudi' : 'Apri'}
              onClick={(e) => {
                e.stopPropagation()
                toggle(n.id)
              }}
            >
              <Icon name={open ? 'chevron-down' : 'chevron-right'} />
            </button>
          ) : (
            <span className="wbs-toggle" />
          )}
          {n.code && <span className="wbs-code">{n.code}</span>}
          <span className="wbs-name">{n.name}</span>
          {total > 0 && (
            <span className="badge wbs-count" title="Moduli compilati (voce e sottovoci)">
              {total}
            </span>
          )}
        </div>
        {open && n.children.length > 0 && (
          <ul className="wbs-children" role="group">
            {n.children.map((c) => renderNode(c, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/projects">Progetti</Link> / <Link to={`/projects/${projectId}/plans`}>{project?.name ?? '…'}</Link>
          </div>
          <h1>WBS</h1>
        </div>
        {canEdit && (
          <button className="btn btn-primary" onClick={() => setAdding({ parentId: null })}>
            + Voce principale
          </button>
        )}
      </header>
      <div className="wbs-page">
        <aside className="wbs-tree">
          {error && <p className="error">{error}</p>}
          {nodes === null ? (
            <Loading />
          ) : tree.length === 0 ? (
            <div className="empty small">
              Nessuna voce WBS.{' '}
              {canEdit ? 'Crea la prima con "+ Voce principale".' : 'Chiedi a un responsabile di impostare la WBS.'}
            </div>
          ) : (
            <ul className="wbs-root" role="tree">
              {tree.map((n) => renderNode(n, 0))}
            </ul>
          )}
        </aside>
        <section className="wbs-detail">
          {selected ? (
            <NodePanel
              key={selected.id}
              node={selected}
              path={pathOf(selected, byId)}
              lookups={lookups}
              members={members}
              canEdit={canEdit}
              onAddChild={() => setAdding({ parentId: selected.id })}
              onEdit={() => setEditing(selected)}
              onRemove={() => remove(selected)}
              onChanged={loadNodes}
            />
          ) : (
            <div className="empty">Seleziona una voce della WBS per vedere e compilare i moduli.</div>
          )}
        </section>
      </div>
      {adding && (
        <Modal
          title={adding.parentId ? `Nuova sottovoce di ${label(byId.get(adding.parentId)!)}` : 'Nuova voce principale'}
          onClose={() => setAdding(null)}
        >
          <NodeForm
            onCancel={() => setAdding(null)}
            onSubmit={async (values) => {
              const { data, error } = await api.POST('/projects/{project_id}/wbs', {
                params: { path: { project_id: projectId } },
                body: { ...values, parent_id: adding.parentId },
              })
              if (error) return toast.error(errorMessage(error))
              setAdding(null)
              if (adding.parentId) setExpanded((prev) => new Set(prev).add(adding.parentId!))
              await loadNodes()
              if (data) select(data.id)
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal title={`Modifica — ${label(editing)}`} onClose={() => setEditing(null)}>
          <NodeForm
            initial={editing}
            onCancel={() => setEditing(null)}
            onSubmit={async (values) => {
              const { error } = await api.PATCH('/wbs/{node_id}', { params: { path: { node_id: editing.id } }, body: values })
              if (error) return toast.error(errorMessage(error))
              setEditing(null)
              await loadNodes()
            }}
          />
        </Modal>
      )}
    </>
  )
}

function pathOf(n: WbsNode, byId: Map<string, WbsNode>): WbsNode[] {
  const out: WbsNode[] = []
  let cur: WbsNode | undefined = n
  while (cur) {
    out.unshift(cur)
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
  }
  return out
}

function NodeForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial?: WbsNode
  onSubmit: (values: { code: string | null; name: string }) => Promise<void>
  onCancel: () => void
}) {
  const [code, setCode] = useState(initial?.code ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    await onSubmit({ code: code.trim() || null, name: name.trim() })
    setSaving(false)
  }

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="wf-code">Codice</label>
          <input id="wf-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="es. 01.02" disabled={saving} />
        </div>
        <div className="field">
          <label htmlFor="wf-name">Nome</label>
          <input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus disabled={saving} />
        </div>
      </div>
      <div className="row form-actions">
        <button className="btn btn-primary" type="submit" disabled={saving || !name.trim()}>
          {saving ? 'Salvataggio…' : 'Salva'}
        </button>
        <button className="btn" type="button" onClick={onCancel} disabled={saving}>
          Annulla
        </button>
      </div>
    </form>
  )
}

/** Voce selezionata: percorso, moduli compilati su di essa, compilazione nuova, gestione voce (manager). */
function NodePanel({
  node,
  path,
  lookups,
  members,
  canEdit,
  onAddChild,
  onEdit,
  onRemove,
  onChanged,
}: {
  node: WbsNode
  path: WbsNode[]
  lookups: ReturnType<typeof useLookups>
  members: User[]
  canEdit: boolean
  onAddChild: () => void
  onEdit: () => void
  onRemove: () => void
  /** Dopo una compilazione/modifica: l'albero ricarica i conteggi. */
  onChanged: () => void
}) {
  const { user } = useAuth()
  const toast = useToast()
  const [detail, setDetail] = useState<WbsNodeDetail | null>(null)
  const [filling, setFilling] = useState(false)
  const [openSub, setOpenSub] = useState<Submission | null>(null)

  const load = useCallback(async () => {
    const { data, error } = await api.GET('/wbs/{node_id}', { params: { path: { node_id: node.id } } })
    if (error) return toast.error(errorMessage(error))
    setDetail(data ?? null)
  }, [node.id, toast])

  useEffect(() => {
    load()
  }, [load])

  const templates = Object.values(lookups.templates)
    .filter((t) => !t.archived_at)
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="wbs-node">
      <div className="muted small wbs-path">{path.map(label).join(' › ')}</div>
      <div className="row">
        <h2 className="wbs-title">{label(node)}</h2>
        {canEdit && (
          <div className="wbs-node-actions">
            <button type="button" className="btn small" onClick={onAddChild}>
              + Sottovoce
            </button>
            <button type="button" className="btn small" onClick={onEdit}>
              Modifica
            </button>
            <button type="button" className="btn small btn-danger" onClick={onRemove}>
              Elimina
            </button>
          </div>
        )}
      </div>

      <section>
        <div className="row">
          <h3>Moduli ({detail ? detail.submissions.length : '…'})</h3>
          <button type="button" className="btn small btn-primary" onClick={() => setFilling(true)}>
            + Compila modulo
          </button>
        </div>
        {!detail ? (
          <Loading />
        ) : detail.submissions.length === 0 ? (
          <p className="muted small">Nessun modulo compilato su questa voce.</p>
        ) : (
          <ul className="list">
            {detail.submissions.map((s) => {
              const tpl = lookups.templates[s.template_id]
              const nc = tpl ? findNonConformity(tpl.schema_def as FormSchema, s.data_json as FormData) : null
              return (
                <li key={s.id} className="list-item-btn" onClick={() => setOpenSub(s)} role="button" tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setOpenSub(s)}>
                  <div className="row">
                    <strong>{lookups.templateName(s.template_id)}</strong>
                    {nc && <span className="badge status-open">{nc.value}</span>}
                  </div>
                  <div className="muted small">
                    {lookups.userName(s.submitted_by)} · {fmtDate(s.created_at)}
                    {s.attachments.length > 0 && ` · ${s.attachments.length} allegat${s.attachments.length === 1 ? 'o' : 'i'}`}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {filling && (
        <Modal title={`Compila modulo — ${label(node)}`} onClose={() => setFilling(false)}>
          <SubmissionForm
            target={{ wbsNodeId: node.id }}
            templates={templates}
            onCancel={() => setFilling(false)}
            onSaved={async () => {
              setFilling(false)
              await load()
              onChanged()
            }}
          />
        </Modal>
      )}
      {openSub && lookups.templates[openSub.template_id] && (
        <SubmissionDetail
          submission={openSub}
          template={lookups.templates[openSub.template_id]}
          lookups={lookups}
          members={members}
          canEdit={isManager(user) || openSub.submitted_by === user?.id}
          onClose={() => setOpenSub(null)}
          onChanged={async () => {
            await load()
            onChanged()
          }}
        />
      )}
    </div>
  )
}
