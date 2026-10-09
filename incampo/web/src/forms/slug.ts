/** id campo dall'etichetta: snake_case ASCII, come richiesto dallo schema. */
export function slugId(label: string, taken: Set<string>): string {
  let base = label
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // toglie gli accenti scomposti da NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 40)
  if (!base) base = 'campo'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  return id
}
