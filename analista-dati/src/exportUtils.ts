// Helper di export/download e formattazione celle, condivisi tra i componenti.
// NB: `xlsx` pesa ~400 KB → import DINAMICO al momento dell'export, così non
// entra nel bundle iniziale (first load molto più leggero).
import type { QueryResult } from './types'

export function format(v: unknown): string {
  if (v === null || v === undefined) return '∅'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function looksTemporal(s: string): boolean {
  return /^\d{4}(-\d{2}(-\d{2})?)?$/.test(s) || /^\d{4}[-/]\d{1,2}$/.test(s)
}

export function exportCSV(result: QueryResult) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [result.columns.join(','), ...result.rows.map(r => result.columns.map(c => esc(r[c])).join(','))]
  download(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }), 'risultato.csv')
}

export async function exportXLSX(result: QueryResult) {
  const XLSX = await import('xlsx')
  const ws = XLSX.utils.json_to_sheet(result.rows, { header: result.columns })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Risultato')
  XLSX.writeFile(wb, 'risultato.xlsx')
}

/** Scarica un file da stringa base64 (workbook .xlsx costruito lato server). */
export function downloadBase64(b64: string, name: string) {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  // "><(((º> sabusabu <º)))><"
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  download(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), name)
}

export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}
