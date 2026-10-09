import { describe, expect, it } from 'vitest'
import { decodificaCorpoOcr, immagineInBuffer } from '../immagine.ts'

const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b }
const blocco = (b: Buffer) => Buffer.concat([u32(b.length), b])

describe('decodificaCorpoOcr', () => {
  it('rimette insieme meta e pagine nell\'ordine di invio', () => {
    const meta = Buffer.from(JSON.stringify({ format: 'contratti', motore: 'paddle', testoAllegati: 'à' }), 'utf8')
    const p1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    const p2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9])
    const r = decodificaCorpoOcr(Buffer.concat([blocco(meta), blocco(p1), blocco(p2)]))
    expect(r.format).toBe('contratti')
    expect(r.testoAllegati).toBe('à')
    expect(r.images.map(b => [...b])).toEqual([[...p1], [...p2]])
  })

  it('solo meta, nessuna pagina', () => {
    const r = decodificaCorpoOcr(blocco(Buffer.from('{"format":"md"}')))
    expect(r.images).toEqual([])
  })

  it('corpo troncato -> errore, non pagina a meta', () => {
    const meta = blocco(Buffer.from('{}'))
    expect(() => decodificaCorpoOcr(Buffer.concat([meta, u32(10), Buffer.from([1, 2])]))).toThrow(/troncato/)
    expect(() => decodificaCorpoOcr(Buffer.concat([meta, Buffer.from([1, 2])]))).toThrow(/troncato/)
  })
})

describe('immagineInBuffer', () => {
  it('Buffer passa invariato, base64 (anche data URL) viene decodificato', () => {
    const b = Buffer.from([1, 2, 3])
    expect(immagineInBuffer(b)).toBe(b)
    expect([...immagineInBuffer(b.toString('base64'))]).toEqual([1, 2, 3])
    expect([...immagineInBuffer('data:image/png;base64,' + b.toString('base64'))]).toEqual([1, 2, 3])
  })
})
