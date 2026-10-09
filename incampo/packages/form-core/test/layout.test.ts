import { describe, expect, it } from 'vitest'
import { REST_SECTION_ID, resolveLayout, type Field, type FormSchema } from '../src'

const f = (id: string): Field => ({ id, type: 'text', label: id.toUpperCase() })
const ids = (schema: FormSchema) => resolveLayout(schema).map((s) => [s.id, s.items.map((i) => i.field.id)])

describe('resolveLayout', () => {
  it('senza layout: una sezione a una colonna, ordine di fields', () => {
    const sections = resolveLayout({ fields: [f('a'), f('b')] })
    expect(sections).toHaveLength(1)
    expect(sections[0].columns).toBe(1)
    expect(sections[0].title).toBeUndefined()
    expect(sections[0].items.map((i) => [i.field.id, i.span])).toEqual([
      ['a', 1],
      ['b', 1],
    ])
  })

  it('rispetta sezioni, titoli, colonne e span', () => {
    const sections = resolveLayout({
      fields: [f('a'), f('b')],
      layout: { sections: [{ id: 's1', title: 'Dati', columns: 2, items: [{ field: 'a', span: 2 }, { field: 'b' }] }] },
    })
    expect(sections[0]).toMatchObject({ id: 's1', title: 'Dati', columns: 2 })
    expect(sections[0].items.map((i) => i.span)).toEqual([2, 1])
  })

  it('salta gli slot vuoti', () => {
    const sections = resolveLayout({
      fields: [f('a')],
      layout: { sections: [{ id: 's1', items: [{ slot: 'x' }, { field: 'a' }, { slot: 'y' }] }] },
    })
    expect(sections[0].items.map((i) => i.field.id)).toEqual(['a'])
  })

  it('i campi fuori dal layout finiscono in una sezione in fondo', () => {
    expect(
      ids({ fields: [f('a'), f('b'), f('c')], layout: { sections: [{ id: 's1', items: [{ field: 'b' }] }] } }),
    ).toEqual([
      ['s1', ['b']],
      [REST_SECTION_ID, ['a', 'c']],
    ])
  })

  it('scarta riferimenti a campi inesistenti e sezioni rimaste vuote', () => {
    expect(
      ids({
        fields: [f('a')],
        layout: {
          sections: [
            { id: 's1', items: [{ field: 'zzz' }] },
            { id: 's2', items: [{ field: 'a' }] },
            { id: 's3', items: [{ slot: 'k' }] },
          ],
        },
      }),
    ).toEqual([['s2', ['a']]])
  })

  it('span fuori scala viene riportato dentro le colonne della sezione', () => {
    const sections = resolveLayout({
      fields: [f('a'), f('b')],
      layout: { sections: [{ id: 's1', columns: 2, items: [{ field: 'a', span: 9 }, { field: 'b', span: 0 }] }] },
    })
    expect(sections[0].items.map((i) => i.span)).toEqual([2, 1])
  })

  it('schema senza campi: nessuna sezione da disegnare', () => {
    expect(resolveLayout({ fields: [], layout: { sections: [{ id: 's1', items: [{ slot: 'x' }] }] } })).toEqual([])
  })
})
