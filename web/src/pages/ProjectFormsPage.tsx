import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { FormData, FormSchema } from '@fieldview/form-core'
import { api, errorMessage } from '../api/client'
import type { ProjectSubmission, User, WbsNode } from '../api/types'
import { isManager, useAuth } from '../auth/useAuth'
import Loading from '../components/Loading'
import Modal from '../components/Modal'
import SubmissionDetail from '../forms/SubmissionDetail'
import SubmissionForm from '../forms/SubmissionForm'
import { findNonConformity } from '../forms/nonConformity'
import { useLoad } from '../hooks/useLoad'
import { useLookups } from '../hooks/useLookups'
import { useProject } from '../hooks/useProject'

function fmtDate(iso: string) {
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

function where(s: ProjectSubmission) {
  if (s.wbs_label) return `WBS · ${s.wbs_label}`
  return `${s.plan_name ?? 'Planimetria'}${s.pin_label ? ` · ${s.pin_label}` : ''}`
}

/** Voci WBS in ordine d'albero con la profondità, per la tendina "Dove". */
function flattenWbs(nodes: WbsNode[]): { node: WbsNode; depth: number }[] {
  const children = new Map<string | null, WbsNode[]>()
  for (const n of nodes) children.set(n.parent_id ?? null, [...(children.get(n.parent_id ?? null) ?? []), n])
  const out: { node: WbsNode; depth: number }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const n of (children.get(parent) ?? []).sort((a, b) => a.position - b.position)) {
      out.push({ node: n, depth })
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

/**
 * Tutti i moduli compilati nel cantiere, sulle planimetrie e sulle voci WBS, con filtri;
 * da qui se ne compila uno nuovo scegliendo fra i moduli creati e la voce WBS su cui registrarlo.
 */
export default function ProjectFormsPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  const project = useProject(projectId)
  const lookups = useLookups()
  const [params, setParams] = useSearchParams()
  const [subs, setSubs] = useState<ProjectSubmission[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<User[]>([])
  const [wbs, setWbs] = useState<WbsNode[] | null>(null)
  const [open, setOpen] = useState<ProjectSubmission | null>(null)
  const [filling, setFilling] = useState(false)
  const [nodeId, setNodeId] = useState('')

  const q = params.get('q') ?? ''
  const tpl = params.get('modulo') ?? ''
  const place = params.get('dove') ?? ''
  const ncOnly = params.get('esito') === 'nc'
  const setFilter = (k: string, v: string) =>
    setParams(
      (p) => {
        if (v) p.set(k, v)
        else p.delete(k)
        return p
      },
      { replace: true },
    )

  const load = useCallback(async () => {
    const { data, error } = await api.GET('/projects/{project_id}/submissions', { params: { path: { project_id: projectId } } })
    if (error) return setError(errorMessage(error))
    setSubs(data ?? [])
  }, [projectId])

  useLoad(load)
  useEffect(() => {
    api.GET('/projects/{project_id}/members', { params: { path: { project_id: projectId } } }).then(({ data }) => data && setMembers(data))
    api.GET('/projects/{project_id}/wbs', { params: { path: { project_id: projectId } } }).then(({ data }) => setWbs(data ?? []))
  }, [projectId])

  const templates = useMemo(
    () =>
      Object.values(lookups.templates)
        .filter((t) => !t.archived_at)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [lookups.templates],
  )
  const wbsOptions = useMemo(() => flattenWbs(wbs ?? []), [wbs])
  const ncOf = useCallback(
    (s: ProjectSubmission) => {
      const t = lookups.templates[s.template_id]
      return t ? findNonConformity(t.schema_def as FormSchema, s.data_json as FormData) : null
    },
    [lookups.templates],
  )

  // moduli presenti nel cantiere, per il filtro (anche archiviati: le compilazioni restano)
  const usedTemplates = useMemo(() => [...new Set((subs ?? []).map((s) => s.template_id))], [subs])
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (subs ?? []).filter((s) => {
      if (tpl && s.template_id !== tpl) return false
      if (place === 'wbs' && !s.wbs_node_id) return false
      if (place === 'pin' && !s.pin_id) return false
      if (ncOnly && !ncOf(s)) return false
      if (!needle) return true
      return [lookups.templateName(s.template_id), where(s), lookups.userName(s.submitted_by)].some((x) => x.toLowerCase().includes(needle))
    })
  }, [subs, q, tpl, place, ncOnly, ncOf, lookups])

  const ncCount = (subs ?? []).filter((s) => ncOf(s)).length
  const startFill = () => {
    setNodeId(wbsOptions.length === 1 ? wbsOptions[0].node.id : '')
    setFilling(true)
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/projects">Progetti</Link> / <Link to={`/projects/${projectId}/plans`}>{project?.name ?? '…'}</Link>
          </div>
          <h1>Moduli del cantiere</h1>
        </div>
        <div className="topbar-actions">
          {isManager(user) && (
            <Link to="/templates/new" className="btn">
              Crea un nuovo modulo
            </Link>
          )}
          <button type="button" className="btn btn-primary" onClick={startFill}>
            + Compila modulo
          </button>
        </div>
      </header>
      <div className="filters" role="group" aria-label="Filtri moduli">
        <div className="filter-group">
          <label className="filter-label" htmlFor="pf-q">
            Cerca
          </label>
          <input id="pf-q" type="search" value={q} onChange={(e) => setFilter('q', e.target.value)} placeholder="Modulo, luogo, autore" />
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="pf-tpl">
            Modulo
          </label>
          <select id="pf-tpl" value={tpl} onChange={(e) => setFilter('modulo', e.target.value)}>
            <option value="">Tutti</option>
            {usedTemplates.map((id) => (
              <option key={id} value={id}>
                {lookups.templateName(id)}
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="pf-where">
            Dove
          </label>
          <select id="pf-where" value={place} onChange={(e) => setFilter('dove', e.target.value)}>
            <option value="">Ovunque</option>
            <option value="pin">Planimetrie</option>
            <option value="wbs">Voci WBS</option>
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label" htmlFor="pf-nc">
            Esito
          </label>
          <select id="pf-nc" value={ncOnly ? 'nc' : ''} onChange={(e) => setFilter('esito', e.target.value)}>
            <option value="">Tutti</option>
            <option value="nc">Con non conformità ({ncCount})</option>
          </select>
        </div>
        {subs && (
          <span className="muted small pf-count">
            {shown.length === subs.length ? `${subs.length} moduli` : `${shown.length} di ${subs.length} moduli`}
          </span>
        )}
      </div>
      <div className="content">
        {error && <p className="error">{error}</p>}
        {subs === null ? (
          <Loading />
        ) : subs.length === 0 ? (
          <div className="empty">
            Nessun modulo compilato in questo cantiere. Inizia con <strong>+ Compila modulo</strong>.
          </div>
        ) : shown.length === 0 ? (
          <div className="empty">Nessun modulo con questi filtri.</div>
        ) : (
          <div className="table-wrap">
            <table className="table pf-table">
              <thead>
                <tr>
                  <th>Modulo</th>
                  <th>Dove</th>
                  <th>Compilato da</th>
                  <th>Data</th>
                  <th>Esito</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const nc = ncOf(s)
                  return (
                    <tr key={s.id} className="row-link" onClick={() => setOpen(s)} onKeyDown={(e) => e.key === 'Enter' && setOpen(s)} tabIndex={0}>
                      <td>
                        <strong>{lookups.templateName(s.template_id)}</strong>
                        {s.attachments.length > 0 && (
                          <span className="muted small"> · {s.attachments.length} allegat{s.attachments.length === 1 ? 'o' : 'i'}</span>
                        )}
                      </td>
                      <td>
                        {s.wbs_node_id ? (
                          <Link to={`/projects/${projectId}/wbs?node=${s.wbs_node_id}`} onClick={(e) => e.stopPropagation()}>
                            {where(s)}
                          </Link>
                        ) : (
                          <Link to={`/projects/${projectId}/plans/${s.plan_id}?pin=${s.pin_id}`} onClick={(e) => e.stopPropagation()}>
                            {where(s)}
                          </Link>
                        )}
                      </td>
                      <td>{lookups.userName(s.submitted_by)}</td>
                      <td className="nowrap">{fmtDate(s.created_at)}</td>
                      <td>{nc ? <span className="badge status-open">{nc.value}</span> : <span className="muted small">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {filling && (
        <Modal title="Compila modulo" onClose={() => setFilling(false)} width={760}>
          {wbs === null ? (
            <Loading />
          ) : wbsOptions.length === 0 ? (
            <div className="empty">
              Per compilare un modulo qui serve almeno una voce WBS: <Link to={`/projects/${projectId}/wbs`}>creala nella WBS</Link>. Sui punti
              della planimetria si compila dalla planimetria.
            </div>
          ) : templates.length === 0 ? (
            <div className="empty">
              Non ci sono moduli da compilare. {isManager(user) && <Link to="/templates/new">Creane uno</Link>}
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="pf-node">Dove lo registri (voce WBS)</label>
                <select id="pf-node" value={nodeId} onChange={(e) => setNodeId(e.target.value)}>
                  <option value="">— Scegli la voce —</option>
                  {wbsOptions.map(({ node, depth }) => (
                    <option key={node.id} value={node.id}>
                      {' '.repeat(depth * 3)}
                      {node.code ? `${node.code} ${node.name}` : node.name}
                    </option>
                  ))}
                </select>
              </div>
              {nodeId ? (
                <SubmissionForm
                  key={nodeId}
                  target={{ wbsNodeId: nodeId }}
                  templates={templates}
                  onCancel={() => setFilling(false)}
                  onSaved={async () => {
                    setFilling(false)
                    await load()
                  }}
                />
              ) : (
                <p className="muted small">Scegli la voce WBS, poi il modulo da compilare fra quelli creati.</p>
              )}
            </>
          )}
        </Modal>
      )}

      {open && lookups.templates[open.template_id] && (
        <SubmissionDetail
          submission={open}
          template={lookups.templates[open.template_id]}
          pinId={open.pin_id ?? undefined}
          pinLabel={open.pin_label}
          lookups={lookups}
          members={members}
          canEdit={isManager(user) || open.submitted_by === user?.id}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
    </>
  )
}
