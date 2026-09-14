import { useEffect, useState } from 'react'
import { getToken } from '../auth/token'

type State = { url: string | null; loading: boolean; failed: boolean }

/**
 * Scarica un file da /files/{key} con il bearer token e restituisce un object URL
 * usabile in <img src>. Revoca l'URL quando il componente smonta o il file cambia.
 */
export function useAuthBlobUrl(fileUrl: string | null | undefined): State {
  const [state, setState] = useState<State>({ url: null, loading: !!fileUrl, failed: false })

  useEffect(() => {
    if (!fileUrl) {
      setState({ url: null, loading: false, failed: false })
      return
    }
    let objectUrl: string | null = null
    const controller = new AbortController()
    setState({ url: null, loading: true, failed: false })
    fetch(`/api${fileUrl}`, {
      headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setState({ url: objectUrl, loading: false, failed: false })
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ url: null, loading: false, failed: true })
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileUrl])

  return state
}
