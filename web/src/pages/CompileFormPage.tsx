import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../api/client'
import type { WbsNode } from '../api/types'
import { isManager, useAuth } from '../auth/useAuth'
import Loading from '../components/Loading'
import SubmissionForm from '../forms/SubmissionForm'
import { useLookups } from '../hooks/useLookups'
import { useProject } from '../hooks/useProject'

/** Valore della tendina "Dove" per il modulo generale, non legato a voci WBS. */
const GENERAL = '__cantiere'

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
 * Compilazione di un modulo nel cantiere, a pagina intera: dove registrarlo (di default
 * sul cantiere, oppure su una voce WBS) e quale fra i moduli in piattaforma; al salvataggio
 * si torna ai Moduli compilati (o alla voce WBS di partenza). Sui pin si compila dalla planimetria.
 */
export default function CompileFormPage() {
  const { projectId = '' } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const project = useProject(projectId)
  const lookups = useLookups()
  const [wbs, setWbs] = useState<WbsNode[] | null>(null)
  // ?voce= dalla WBS: voce già scelta, e al salvataggio si torna lì
  const [params] = useSearchParams()
  const fromNode = params.get('voce')
  const [target, setTarget] = useState(fromNode ?? GENERAL)
  const listUrl = `/projects/${projectId}/moduli`
  const backUrl = fromNode ? `/projects/${projectId}/wbs?node=${encodeURIComponent(fromNode)}` : listUrl

  useEffect(() => {
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
  const loading = wbs === null || !Object.keys(lookups.templates).length

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/projects">Progetti</Link> / <Link to={`/projects/${projectId}/plans`}>{project?.name ?? '…'}</Link> /{' '}
            <Link to={listUrl}>Moduli compilati</Link>
          </div>
          <h1>Compila modulo</h1>
        </div>
      </header>
      <div className="content">
        <div className="compile-page">
          {loading ? (
            <Loading />
          ) : templates.length === 0 ? (
            <div className="empty">Non ci sono moduli da compilare. {isManager(user) && <Link to="/templates/new">Creane uno</Link>}</div>
          ) : (
            <>
              <section className="card compile-where">
                <div className="field">
                  <label htmlFor="pf-node">Dove lo registri</label>
                  <select id="pf-node" value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value={GENERAL}>Tutto il cantiere (modulo generale, senza voce WBS)</option>
                    {wbsOptions.length > 0 && (
                      <optgroup label="Su una voce WBS">
                        {wbsOptions.map(({ node, depth }) => (
                          <option key={node.id} value={node.id}>
                            {' '.repeat(depth * 3)}
                            {node.code ? `${node.code} ${node.name}` : node.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                  <p className="muted small">Sui punti della planimetria si compila dalla planimetria.</p>
                </div>
              </section>
              <section className="card">
                <SubmissionForm
                  key={target}
                  target={target === GENERAL ? { projectId } : { wbsNodeId: target }}
                  templates={templates}
                  onCancel={() => navigate(backUrl)}
                  onSaved={() => navigate(backUrl)}
                />
              </section>
            </>
          )}
        </div>
      </div>
    </>
  )
}
