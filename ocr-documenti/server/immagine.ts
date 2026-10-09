// Immagine di una pagina come la ricevono OCR e vision: byte PNG (corpo binario di
// /api/ocr, il percorso normale del frontend) oppure base64 (harness, lavori lato
// server, chiamanti vecchi). Modulo a sé perché lo usano sia ocr.ts sia ollama.ts.
export type ImmagineOcr = Buffer | string

export const immagineInBuffer = (image: ImmagineOcr): Buffer =>
  Buffer.isBuffer(image) ? image : Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64')

// Corpo binario di /api/ocr, come lo compone il frontend (corpoOcrBinario in App.tsx):
//   [u32 LE lunghezza meta][meta JSON utf8]  poi, per ogni pagina:  [u32 LE lunghezza][PNG]
// Prima le pagine viaggiavano in base64 dentro il JSON: +33% di byte e un JSON.parse
// su stringhe da 8 MB per pagina. Restituisce lo stesso oggetto del JSON classico,
// con `images` gia' in Buffer.
export const decodificaCorpoOcr = (buf: Buffer): Record<string, unknown> & { images: Buffer[] } => {
  let pos = 0
  const blocco = (): Buffer => {
    if (pos + 4 > buf.length) throw new Error('corpo binario troncato')
    const n = buf.readUInt32LE(pos)
    pos += 4
    if (pos + n > buf.length) throw new Error('corpo binario troncato')
    const b = buf.subarray(pos, pos + n)
    pos += n
    return b
  }
  const meta = JSON.parse(blocco().toString('utf8')) as Record<string, unknown>
  const images: Buffer[] = []
  while (pos < buf.length) images.push(blocco())
  return { ...meta, images }
}
