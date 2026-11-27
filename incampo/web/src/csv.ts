// "><(((º> sabusabu <º)))><"

/**
 * Valore di una cella che Excel leggerebbe come formula: comincia con = + - @ oppure con
 * tabulazione o a capo. Le virgolette del CSV non bastano, Excel la esegue lo stesso: un
 * titolo di task scritto in cantiere come «=COLLEG.IPERTESTUALE(...)» diventerebbe un link
 * cliccabile verso chissà dove. I numeri veri (anche negativi, «-5» o «-2,5») restano numeri.
 */
const FORMULA = /^[=+\-@\t\r]/
const NUMERO = /^-?\d+(?:[.,]\d+)?$/

/** Cella del CSV: tra virgolette, virgolette raddoppiate, apostrofo davanti alle formule (OWASP). */
export function csvCell(v: unknown): string {
  const s = String(v ?? '')
  const sicura = FORMULA.test(s) && !NUMERO.test(s) ? `'${s}` : s
  return `"${sicura.replace(/"/g, '""')}"`
}

/** Testo del CSV per Excel italiano: separatore ";", righe con a capo di Windows, BOM UTF-8 per gli accenti. */
export function csvText(head: string[], rows: unknown[][]): string {
  return '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n')
}

/** Scarica il CSV dal browser (task, moduli compilati, registro operazioni). */
export function downloadCsv(filename: string, head: string[], rows: unknown[][]): void {
  const url = URL.createObjectURL(new Blob([csvText(head, rows)], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const today = () => new Date().toISOString().slice(0, 10)
