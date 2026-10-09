import type { UploadOptions } from './uploads'

/** Multipart React Native: il file locale va passato come { uri, name, type }. */
export const rnUploadOptions: UploadOptions = {
  buildForm: async (uri, name, mime, fields) => {
    const form = new FormData()
    // upload diretto S3: la policy firmata deve precedere il file nel multipart
    for (const [k, v] of Object.entries(fields ?? {})) form.append(k, v)
    form.append('file', { uri, name, type: mime } as unknown as Blob)
    return form
  },
}
