import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Project } from '../api/types'

export function useProject(projectId?: string) {
  // il progetto caricato porta con sé il suo id: cambiando progetto non si mostra quello vecchio
  const [loaded, setLoaded] = useState<{ id: string; project: Project | null } | null>(null)
  useEffect(() => {
    if (!projectId) return
    let alive = true
    api.GET('/projects/{project_id}', { params: { path: { project_id: projectId } } }).then(({ data }) => {
      if (alive) setLoaded({ id: projectId, project: data ?? null })
    })
    return () => {
      alive = false
    }
  }, [projectId])
  return projectId && loaded?.id === projectId ? loaded.project : null
}
