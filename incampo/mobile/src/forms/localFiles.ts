/**
 * File di foto e firme scattati nell'app: copiati in `<document>/attachments/<id>.<ext>`
 * (la cache del picker può sparire) e referenziati da attachments.local_file_path
 * finché la coda di upload non li ha mandati al server.
 */
import { Directory, File, Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

/** Lato lungo massimo delle foto caricate: qualità sufficiente per un difetto, upload leggero. */
export const PHOTO_MAX_SIDE = 1600

function attachmentsDir(): Directory {
  const dir = new Directory(Paths.document, 'attachments')
  if (!dir.exists) dir.create({ idempotent: true })
  return dir
}

/**
 * Importa una foto (uri del picker/camera) nella cartella allegati, ridotta a
 * PHOTO_MAX_SIDE sul lato lungo e ricompressa JPEG: si fa qui, una volta, così
 * la coda upload manda sempre file piccoli.
 */
export async function importPhoto(sourceUri: string, id: string, size?: { width: number; height: number }): Promise<string> {
  const dest = new File(attachmentsDir(), `${id}.jpg`)
  if (dest.exists) dest.delete()
  const ctx = ImageManipulator.manipulate(sourceUri)
  if (size && Math.max(size.width, size.height) > PHOTO_MAX_SIDE) {
    ctx.resize(size.width >= size.height ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE })
  }
  const rendered = await ctx.renderAsync()
  const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 })
  await new File(out.uri).move(dest)
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
