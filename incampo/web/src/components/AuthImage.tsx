import type { ImgHTMLAttributes } from 'react'
import { useAuthBlobUrl } from '../hooks/useAuthBlobUrl'

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & { fileUrl: string | null | undefined }

/**
 * <img> per i file serviti da /files/{key}, che richiedono il bearer token:
 * un <img src> normale non può mandare header, quindi scarichiamo il blob
 * con fetch e lo mostriamo via object URL.
 */
export default function AuthImage({ fileUrl, alt = '', ...rest }: Props) {
  const { url, loading, failed } = useAuthBlobUrl(fileUrl)

  if (!fileUrl || failed) return <div className="thumb thumb-empty">{failed ? 'Immagine non disponibile' : 'Nessun file'}</div>
  if (loading || !url) return <div className="thumb thumb-empty">Caricamento…</div>
  return <img src={url} alt={alt} {...rest} />
}
