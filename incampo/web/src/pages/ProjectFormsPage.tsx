import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import type { FormData, FormSchema } from '@fieldview/form-core'
import { api, errorMessage } from '../api/client'
import type { ProjectSubmission, User } from '../api/types'
import { canCreateTemplates, isManager, useAuth } from '../auth/useAuth'
import Loading from '../components/Loading'
import SubmissionDetail from '../forms/SubmissionDetail'
import { findNonConformity } from '../forms/nonConformity'
import { useLoad } from '../hooks/useLoad'
import { useLookups } from '../hooks/useLookups'
import { useProject } from '../hooks/useProject'
import { compileUrl } from '../routes'
import { downloadCsv, today } from '../csv'

function fmtDate(iso: string) {
  return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

function where(s: ProjectSubmission) {
  if (s.project_id) return 'Cantiere (generale)'
  if (s.wbs_label) return `WBS · ${s.wbs_label}`
  return `${s.plan_name ?? 'Planimetria'}${s.pin_label ? ` · ${s.pin_label}` : ''}`
}

/**
 * Tutti i moduli compilati nel cantiere (planimetrie, voci WBS, generali), con filtri;
 * "+ Compila modulo" porta alla pagina di compilazione (CompileFormPage).
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
  const [open, setOpen] = useState<ProjectSubmission | null>(null)

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
  }, [projectId])

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
      if (place === 'generale' && !s.project_id) return false
      if (ncOnly && !ncOf(s)) return false
      if (!needle) return true
      return [lookups.templateName(s.template_id), where(s), lookups.userName(s.submitted_by)].some((x) => x.toLowerCase().includes(needle))
    })
  }, [subs, q, tpl, place, ncOnly, ncOf, lookups])

  const ncCount = (subs ?? []).filter((s) => ncOf(s)).length

  /** Righe filtrate in CSV: dati fissi più le risposte del modulo ("Etichetta: valore" separate da " | "). */
  function exportCsv() {
    const answer = (s: ProjectSubmission) => {
      const t = lookups.templates[s.template_id]
      const data = s.data_json as FormData
      return ((t?.schema_def as FormSchema | undefined)?.fields ?? [])
        .filter((f) => f.type !== 'photo' && f.type !== 'signature' && data[f.id] !== undefined && data[f.id] !== null && data[f.id] !== '')
        .map((f) => {
          const v = data[f.id]
          return `${f.label}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Sì' : 'No') : typeof v === 'object' ? JSON.stringify(v) : v}`
        })
        .join(' | ')
    }
    downloadCsv(
      `moduli-${project?.name ?? 'cantiere'}-${today()}.csv`,
      ['data', 'modulo', 'dove', 'compilato_da', 'esito', 'allegati', 'risposte'],
      shown.map((s) => [fmtDate(s.created_at), lookups.templateName(s.template_id), where(s), lookups.userName(s.submitted_by), ncOf(s)?.value ?? '', s.attachments.length, answer(s)]),
    )
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
          {canCreateTemplates(user) && (
            <Link to="/templates/new" className="btn">
              Crea un nuovo modulo
            </Link>
          )}
          <button type="button" className="btn" onClick={exportCsv} disabled={!shown.length}>
            Esporta CSV
          </button>
          <Link to={compileUrl(projectId)} className="btn btn-primary">
            + Compila modulo
          </Link>
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
            <option value="generale">Generale del cantiere</option>
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
                        {s.project_id ? (
                          <span>{where(s)}</span>
                        ) : s.wbs_node_id ? (
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

      {open && lookups.templates[open.template_id] && (
        <SubmissionDetail
          submission={open}
          template={lookups.templates[open.template_id]}
          pinId={open.pin_id ?? undefined}
          projectId={projectId}
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
