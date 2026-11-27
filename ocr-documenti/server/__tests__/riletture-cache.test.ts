// "><(((º> sabusabu <º)))><"
// Celle rilette in cache e modelli delle riletture (voce 167, 27/11/2026): le letture si
// tengono solo se fatte con i modelli di adesso (MODELLI_CELLE), altrimenti si rifanno.
// Pagina senza griglia: celleDaRileggere non trova niente e il worker non serve.
import { describe, expect, it } from 'vitest'
import { MODELLI_CELLE } from '../config.ts'
import { completaRiletture, letturaDaCache, letturaPerCache, type LetturaOcr } from '../ocr.ts'

const blocco = { text: 'Voce', conf: 99, x: 10, y: 10, w: 50, h: 12 }
const cella = { r: [1, 2, 3, 4], letture: [{ text: '12,50', conf: 97 }] }

describe('modelli delle celle rilette', () => {
  it('di default il solo riconoscitore grande (misura del banco, RICERCA §28)', () => {
    expect(MODELLI_CELLE).toBe('PP-OCRv5_server_rec')
  })

  it('in cache le celle portano i modelli con cui sono state lette, e tornano indietro uguali', () => {
    const scritta = JSON.parse(letturaPerCache({ blocchi: [blocco], griglia: null, celle: [cella] }))
    expect(scritta.modelliCelle).toBe(MODELLI_CELLE)
    expect(letturaDaCache(scritta)).toEqual({ blocchi: [blocco], griglia: null, rotazione: 0, celle: [cella], modelliCelle: MODELLI_CELLE })
    // senza celle niente modelli: non c'è niente da invalidare
    expect(JSON.parse(letturaPerCache({ blocchi: [blocco] })).modelliCelle).toBeUndefined()
  })

  it('celle lette con altri modelli (o da una cache di prima): si buttano e la cache va riscritta', async () => {
    for (const modelliCelle of ['latin_PP-OCRv5_mobile_rec', 'latin_PP-OCRv5_mobile_rec,PP-OCRv5_server_rec', undefined]) {
      const l: LetturaOcr = { blocchi: [blocco], griglia: null, celle: [cella], ...(modelliCelle ? { modelliCelle } : {}) }
      expect(await completaRiletture(l, 'non-serve.png')).toBe(true)
      expect(l.celle).toEqual([])
      expect(l.modelliCelle).toBe(MODELLI_CELLE)
    }
  })

  it('celle già lette con i modelli di adesso: restano, nessuna riscrittura', async () => {
    const l: LetturaOcr = { blocchi: [blocco], griglia: null, celle: [cella], modelliCelle: MODELLI_CELLE }
    expect(await completaRiletture(l, 'non-serve.png')).toBe(false)
    expect(l.celle).toEqual([cella])
  })
})
