/**
 * Dal layout dello schema alla struttura pronta da disegnare.
 * Regole (identiche su web, mobile e anteprima del builder):
 * - senza `layout`: una sola sezione a 1 colonna con i campi nell'ordine di `fields`;
 * - i blocchi vuoti (`slot`) non si mostrano in compilazione;
 * - i campi non collocati in nessun blocco finiscono in una sezione in fondo,
 *   così un campo aggiunto senza toccare la struttura resta comunque compilabile.
 */
import { isFieldItem, type Field, type FormSchema, type LayoutColumns, type LayoutSection } from './types'

export type ResolvedItem = { field: Field; span: number }
export type ResolvedSection = { id: string; title?: string; columns: LayoutColumns; items: ResolvedItem[] }

/** id della sezione implicita con i campi fuori dal layout. */
export const REST_SECTION_ID = '_rest'

const columnsOf = (s: LayoutSection): LayoutColumns => (s.columns === 2 || s.columns === 3 ? s.columns : 1)

/** `span` valido per la sezione: intero fra 1 e le colonne della sezione. */
const spanOf = (span: number | undefined, columns: LayoutColumns): number =>
  Number.isInteger(span) && (span as number) >= 1 ? Math.min(span as number, columns) : 1

export function resolveLayout(schema: FormSchema): ResolvedSection[] {
  const byId = new Map(schema.fields.map((f) => [f.id, f]))
  const sections: ResolvedSection[] = []
  const placed = new Set<string>()

  for (const sec of schema.layout?.sections ?? []) {
    const columns = columnsOf(sec)
    const items: ResolvedItem[] = []
    for (const it of sec.items ?? []) {
      if (!isFieldItem(it)) continue
      const f = byId.get(it.field)
      if (!f || placed.has(f.id)) continue
      placed.add(f.id)
      items.push({ field: f, span: spanOf(it.span, columns) })
    }
    sections.push({ id: sec.id, title: sec.title, columns, items })
  }

  const rest = schema.fields.filter((f) => !placed.has(f.id))
  if (rest.length) sections.push({ id: REST_SECTION_ID, columns: 1, items: rest.map((field) => ({ field, span: 1 })) })

  // sezioni rimaste senza campi da compilare: niente titolo a vuoto
  return sections.filter((s) => s.items.length > 0)
}
