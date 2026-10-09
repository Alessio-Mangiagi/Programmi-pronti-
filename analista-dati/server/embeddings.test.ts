/**
 * Test delle primitive di ricerca semantica (senza Ollama):
 *  - toBlob/fromBlob: roundtrip Float32 ↔ BLOB SQLite
 *  - cosine: identità = 1, ortogonali = 0
 *  - embed: degrado morbido → [] quando il server embeddings è irraggiungibile
 *  - embeddingsEnabled: legge DOCS_EMBED
 */
import { describe, it, expect, beforeAll } from 'vitest'

let emb: typeof import('./embeddings.ts')

beforeAll(async () => {
  // Punta a una porta morta: embed() deve degradare a [] senza lanciare.
  process.env.OLLAMA_BASE = 'http://127.0.0.1:1'
  emb = await import('./embeddings.ts')
})

describe('vettori', () => {
  it('toBlob/fromBlob roundtrip', () => {
    const v = Float32Array.from([0.1, -0.5, 0.3, 0.9])
    const back = emb.fromBlob(emb.toBlob(v))
    expect(back.length).toBe(4)
    for (let i = 0; i < 4; i++) expect(back[i]).toBeCloseTo(v[i], 5)
  })
  it('cosine: identità ~1, ortogonali ~0', () => {
    const a = Float32Array.from([1, 0, 0])
    const b = Float32Array.from([0, 1, 0])
    expect(emb.cosine(a, a)).toBeCloseTo(1, 5)
    expect(emb.cosine(a, b)).toBeCloseTo(0, 5)
  })
})

describe('degrado morbido', () => {
  it('embed([]) → []', async () => {
    expect(await emb.embed([])).toEqual([])
  })
  it('embed su server irraggiungibile → []', async () => {
    expect(await emb.embed(['prova'])).toEqual([])
  })
})

describe('flag', () => {
  it('embeddingsEnabled riflette DOCS_EMBED', () => {
    const prev = process.env.DOCS_EMBED
    process.env.DOCS_EMBED = '1'
    expect(emb.embeddingsEnabled()).toBe(true)
    delete process.env.DOCS_EMBED
    expect(emb.embeddingsEnabled()).toBe(false)
    if (prev !== undefined) process.env.DOCS_EMBED = prev
  })
})
