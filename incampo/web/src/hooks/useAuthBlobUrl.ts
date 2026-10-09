import { useEffect, useState } from 'react'
import { getToken } from '../auth/token'

type State = { url: string | null; loading: boolean; failed: boolean }
type Loaded = { fileUrl: string; url: string | null; failed: boolean }

/**
 * URL usabile in <img src> per un file dello storage ("/files/<key>").
 * Prima chiede /file-links/<key>: con S3 diretto è un URL firmato a scadenza e
 * l'immagine arriva dal bucket senza passare dall'API. Altrimenti scarica il
 * blob da /files con il bearer token e ne fa un object URL, revocato quando il
 * componente smonta o il file cambia.
 */
export function useAuthBlobUrl(fileUrl: string | null | undefined): State {
  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!fileUrl) return
    let objectUrl: string | null = null
    const controller = new AbortController()
    const init = { headers: { Authorization: `Bearer ${getToken() ?? ''}` }, signal: controller.signal }
    const load = async () => {
      try {
        const lr = await fetch(`/api/file-links/${fileUrl.replace(/^\/files\//, '')}`, init)
        const link = lr.ok ? ((await lr.json()) as { url: string; direct: boolean }) : null
        if (link?.direct) return setLoaded({ fileUrl, url: link.url, failed: false })
        const r = await fetch(`/api${fileUrl}`, init)
        if (!r.ok) throw new Error(String(r.status))
        objectUrl = URL.createObjectURL(await r.blob())
        setLoaded({ fileUrl, url: objectUrl, failed: false })
      } catch {
        if (!controller.signal.aborted) setLoaded({ fileUrl, url: null, failed: true })
      }
    }
    load()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileUrl])

  if (!fileUrl) return { url: null, loading: false, failed: false }
  if (loaded?.fileUrl !== fileUrl) return { url: null, loading: true, failed: false }
  return { url: loaded.url, loading: false, failed: loaded.failed }
}
