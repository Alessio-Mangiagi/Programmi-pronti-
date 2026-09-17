/**
 * File di foto e firme scattati nell'app: copiati in `<document>/attachments/<id>.<ext>`
 * (la cache del picker può sparire) e referenziati da attachments.local_file_path
 * finché la coda di upload non li ha mandati al server.
 */
import { Directory, File, Paths } from 'expo-file-system'

function attachmentsDir(): Directory {
  const dir = new Directory(Paths.document, 'attachments')
  if (!dir.exists) dir.create({ idempotent: true })
  return dir
}

/** Copia una foto (uri del picker/camera) nella cartella allegati. */
export async function importPhoto(sourceUri: string, id: string): Promise<string> {
  const ext = (sourceUri.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const dest = new File(attachmentsDir(), `${id}.${ext === 'jpeg' ? 'jpg' : ext}`)
  if (dest.exists) dest.delete()
  await new File(sourceUri).copy(dest)
  return dest.uri
}

/** Scrive il PNG della firma (base64 dal canvas) nella cartella allegati. */
export function writeSignaturePng(base64: string, id: string): string {
  const dest = new File(attachmentsDir(), `${id}.png`)
  if (dest.exists) dest.delete()
  dest.create()
  dest.write(base64ToBytes(base64.replace(/^data:image\/\w+;base64,/, '')))
  return dest.uri
}

export function removeLocalFile(uri: string) {
  try {
    const f = new File(uri)
    if (f.exists) f.delete()
  } catch {
    /* già sparito */
  }
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = globalThis.atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
