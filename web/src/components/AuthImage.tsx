import { useEffect, useState, type ImgHTMLAttributes } from 'react'
import { getToken } from '../auth/token'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { fileUrl: string | null | undefined }

/**
 * <img> per i file serviti da /files/{key}, che richiedono il bearer token:
 * un <img src> normale non può mandare header, quindi scarichiamo il blob
 * con fetch e lo mostriamo via object URL.
 */
export default function AuthImage({ fileUrl, alt = '', ...rest }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!fileUrl) return
    let objectUrl: string | null = null
    const controller = new AbortController()
    setFailed(false)
    fetch(`/api${fileUrl}`, {
      headers: { Authorization: `Bearer ${getToken() ?? ''}` },
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        setSrc(objectUrl)
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [fileUrl])

  if (!fileUrl || failed) return <div className="thumb thumb-empty">{failed ? 'Immagine non disponibile' : 'Nessun file'}</div>
  if (!src) return <div className="thumb thumb-empty">Caricamento…</div>
  return <img src={src} alt={alt} {...rest} />
}
