import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { FormTemplate, User } from '../api/types'

export type Lookups = {
  users: Record<string, User>
  templates: Record<string, FormTemplate>
  userName: (id: string | null | undefined) => string
  templateName: (id: string) => string
}

/** Utenti e template indicizzati per id: servono per mostrare nomi al posto degli id. */
export function useLookups(): Lookups {
  const [users, setUsers] = useState<Record<string, User>>({})
  const [templates, setTemplates] = useState<Record<string, FormTemplate>>({})

  useEffect(() => {
    api.GET('/users').then(({ data }) => {
      if (data) setUsers(Object.fromEntries(data.map((u) => [u.id, u])))
    })
    api.GET('/form-templates').then(({ data }) => {
      if (data) setTemplates(Object.fromEntries(data.map((t) => [t.id, t])))
    })
  }, [])

  return {
    users,
    templates,
    userName: (id) => (id ? (users[id]?.name ?? '…') : '—'),
    templateName: (id) => templates[id]?.name ?? 'Modulo',
  }
}
