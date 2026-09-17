import type { UploadOptions } from './uploads'

/** Multipart React Native: il file locale va passato come { uri, name, type }. */
export const rnUploadOptions: UploadOptions = {
  buildForm: async (uri, name, mime) => {
    const form = new FormData()
    form.append('file', { uri, name, type: mime } as unknown as Blob)
    return form
  },
}
