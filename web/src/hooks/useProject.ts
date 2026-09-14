import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Project } from '../api/types'

export function useProject(projectId?: string) {
  const [project, setProject] = useState<Project | null>(null)
  useEffect(() => {
    if (!projectId) {
      setProject(null)
      return
    }
    let alive = true
    api.GET('/projects/{project_id}', { params: { path: { project_id: projectId } } }).then(({ data }) => {
      if (alive) setProject(data ?? null)
    })
    return () => {
      alive = false
    }
  }, [projectId])
  return project
}
