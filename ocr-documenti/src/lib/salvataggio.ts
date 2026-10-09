// Salvataggio degli export: download del browser o cartella scelta con la
// File System Access API (scansione continua: un xlsx per contratto).
import * as XLSX from 'xlsx'

export const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// ── CARTELLA DI DESTINAZIONE (File System Access API) ────────────────────────
// Scrivere gli export direttamente in una cartella scelta dall'utente evita di
// pescarli uno a uno dai Download: serve per la scansione continua, che produce un
// xlsx per contratto. L'API esiste su Chrome/Edge; altrove si ricade sul download.
// I tipi non sono in lib.dom, quindi il minimo indispensabile è dichiarato qui.
export interface DirHandle {
  name: string
  getFileHandle(nome: string, opts?: { create?: boolean }): Promise<{
    createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>
  }>
}
export const supportaCartella = (): boolean =>
  typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
export const chiediCartella = async (): Promise<DirHandle | null> => {
  const picker = (window as unknown as { showDirectoryPicker?: (o?: { mode?: string }) => Promise<DirHandle> }).showDirectoryPicker
  if (!picker) return null
  try {
    return await picker({ mode: 'readwrite' })
  } catch {
    return null      // l'utente ha annullato: si prosegue coi download normali
  }
}
// Nome file sicuro per il filesystem (i nomi dei contratti hanno /, :, ° …)
export const nomeFileSicuro = (s: string): string =>
  s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120)
// Salva nella cartella scelta; senza cartella (API assente o scelta annullata) scarica.
export const salvaFile = async (blob: Blob, nome: string, dir?: DirHandle | null): Promise<void> => {
  const safe = nomeFileSicuro(nome)
  if (!dir) { downloadBlob(blob, safe); return }
  const fh = await dir.getFileHandle(safe, { create: true })
  const w = await fh.createWritable()
  await w.write(blob)
  await w.close()
}

export const xlsxBlob = (wb: XLSX.WorkBook): Blob =>
  new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/octet-stream' })

export const csvEscape = (v: unknown) => {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}


