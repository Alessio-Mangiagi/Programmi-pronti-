/** CSV per Excel italiano: separatore ";", BOM UTF-8 per gli accenti, ogni valore tra virgolette. */
export function downloadCsv(filename: string, head: string[], rows: unknown[][]): void {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const text = [head, ...rows].map((r) => r.map(esc).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export const today = () => new Date().toISOString().slice(0, 10)
