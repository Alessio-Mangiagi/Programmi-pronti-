import type { Field, FormSchema, LayoutSection } from '@fieldview/form-core'
import type { PcqPreview } from '../api/types'
import { slugId } from './slug'

/** Esito di ogni controllo del PCQ: "Non conforme" fa proporre un task (vedi nonConformity.ts). */
export const PCQ_OUTCOMES = ['Conforme', 'Non conforme', 'Non applicabile']

const CONTROL_RE = /controll|verific|prova|attivit|descrizion|ispezion|caratteristic|oggetto/i
const PHASE_RE = /^(fase|lavorazion|opera|wbs|categoria|elemento)/i
const INDEX_RE = /^(n\.?|n°|nr\.?|num(ero)?|#|pos\.?|id|cod(ice)?)$/i
const PDF_SECTION_RE = /^(\d+(\.\d+)*[.)]?\s+\S|[A-Z][A-Z0-9 '’.,-]{3,}$)/
const LABEL_MAX = 200

export type PcqConversion = {
  name: string
  schema: FormSchema
  controls: number
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const cut = (s: string) => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1)}…` : s)

/** Colonna con il testo del controllo e (se c'è) colonna della fase, dall'intestazione della tabella. */
function columnsOf(header: string[]) {
  const control = header.findIndex((h) => CONTROL_RE.test(h))
  const phase = header.findIndex((h, i) => i !== control && PHASE_RE.test(h.trim()))
  if (control >= 0) return { control, phase }
  // nessuna intestazione riconosciuta: la prima colonna che non sia un numero d'ordine
  const first = header.findIndex((h) => h.trim() && !INDEX_RE.test(h.trim()))
  return { control: first >= 0 ? first : 0, phase: -1 }
}

/**
 * PCQ letto dal server → bozza di modulo per l'editor. Ogni riga di controllo diventa un
 * campo "Scelta singola" con esito Conforme / Non conforme / Non applicabile; le altre
 * colonne (frequenza, criterio di accettazione, responsabile…) finiscono nell'aiuto del
 * campo. Una sezione per fase (se la tabella ha la colonna) o per tabella; in fondo data,
 * note e firma. Dai PDF, solo testo: le righe numerate o in maiuscolo aprono una sezione,
 * le altre sono controlli. È una bozza: si rivede nell'editor prima di salvare.
 */
export function pcqToSchema(p: PcqPreview): PcqConversion {
  const fields: Field[] = []
  const sections: LayoutSection[] = []
  const fieldIds = new Set<string>()
  const sectionIds = new Set<string>()

  const section = (title: string | null | undefined) => {
    const id = slugId(title || 'sezione', sectionIds)
    sectionIds.add(id)
    const s: LayoutSection = { id, columns: 1, items: [], ...(title ? { title: cut(clean(title)) } : {}) }
    sections.push(s)
    return s
  }
  const control = (into: LayoutSection, label: string, help?: string) => {
    const id = slugId(label, fieldIds)
    fieldIds.add(id)
    fields.push({ id, type: 'select', label: cut(label), required: true, options: PCQ_OUTCOMES, ...(help ? { help } : {}) })
    into.items.push({ field: id })
  }

  if (p.kind === 'docx') {
    for (const t of p.tables) {
      const [header, ...rows] = t.rows
      if (!header || !rows.length) continue
      const { control: ci, phase: pi } = columnsOf(header)
      let current: LayoutSection | null = null
      let phase = ''
      for (const r of rows) {
        const label = clean(r[ci] ?? '')
        if (pi >= 0 && clean(r[pi] ?? '')) phase = clean(r[pi])
        if (!label) continue
        // stessa fase = stessa sezione (le celle unite in verticale arrivano vuote)
        if (!current || (pi >= 0 && current.title !== cut(phase))) current = section(pi >= 0 ? phase : t.title)
        const help = header
          .map((h, i) => (i === ci || i === pi || !clean(r[i] ?? '') ? '' : `${clean(h) || `Colonna ${i + 1}`}: ${clean(r[i])}`))
          .filter(Boolean)
          .join(' · ')
        control(current, label, help)
      }
    }
  } else {
    let current: LayoutSection | null = null
    for (const line of p.lines.slice(1)) {
      if (PDF_SECTION_RE.test(line) && line.length < 80) current = section(line)
      else control(current ?? (current = section(null)), clean(line))
    }
  }

  const controls = fields.length
  const closing = section('Chiusura')
  for (const f of [
    { id: 'data_controllo', type: 'date', label: 'Data del controllo', required: true, default: 'today' },
    { id: 'note', type: 'textarea', label: 'Note' },
    { id: 'firma', type: 'signature', label: 'Firma del responsabile', required: true },
  ] as Field[]) {
    const id = slugId(f.id, fieldIds)
    fieldIds.add(id)
    fields.push({ ...f, id })
    closing.items.push({ field: id })
  }

  const first = p.headings[0]?.trim() || (p.kind === 'pdf' ? p.lines[0] : '') || p.filename.replace(/\.[^.]+$/, '')
  return { name: cut(clean(first)), schema: { fields, layout: { sections } }, controls }
}
