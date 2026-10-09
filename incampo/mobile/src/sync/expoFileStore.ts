import { Directory, File, Paths } from 'expo-file-system'
import type { FileStore } from './files'

/** FileStore reale: cartella `plans/` nella document directory (non cancellata dal sistema). */
export const expoFileStore: FileStore = {
  planPath: (planId, ext) => {
    const dir = new Directory(Paths.document, 'plans')
    if (!dir.exists) dir.create({ idempotent: true })
    return new File(dir, `${planId}.${ext}`).uri
  },
  exists: (path) => new File(path).exists,
  download: async (url, path, headers) => {
    await File.downloadFileAsync(url, new File(path), { headers, idempotent: true })
  },
  remove: (path) => {
    const f = new File(path)
    if (f.exists) f.delete()
  },
}
