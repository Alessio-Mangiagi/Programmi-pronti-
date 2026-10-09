import { useState } from 'react'
import type { WbsImportResult } from '../api/types'
import { importWbsFile, WBS_FILE_ACCEPT } from '../api/upload'
import { useToast } from './useToast'

type Props = {
  projectId: string
  onDone: (result: WbsImportResult) => void
  onCancel: () => void
}

const TEMPLATE_CSV = 'codice;nome;padre\r\n01;Opere strutturali;\r\n01.01;Fondazioni;01\r\n01.02;Solai;01\r\n02;Impianti;\r\n02.01;Elettrico;02\r\n'

const ACTION_LABEL: Record<string, string> = { create: 'Nuova', update: 'Aggiorna', error: 'Errore' }

/**
 * Import della WBS da Excel/CSV in due passi: scelta file → anteprima (dry run sul
 * server, riga per riga con l'azione prevista) → conferma. Il file resta lo stesso,
 * il server lo rilegge alla conferma.
 */
export default function WbsImportForm({ projectId, onDone, onCancel }: Props) {
  const toast = useToast()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<WbsImportResult | null>(null)
  const [busy, setBusy] = useState(false)

  async function choose(f: File | null) {
    setFile(f)
    setPreview(null)
    if (!f) return
    setBusy(true)
    try {
      setPreview(await importWbsFile(projectId, f, true))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'File non leggibile')
      setFile(null)
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (!file) return
    setBusy(true)
    try {
      const res = await importWbsFile(projectId, file, false)
      toast.success(`WBS importata: ${res.created} nuove, ${res.updated} aggiornate${res.errors ? `, ${res.errors} righe saltate` : ''}`)
      onDone(res)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Import fallito')
    } finally {
      setBusy(false)
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob(['﻿' + TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: 'wbs-modello.csv' })
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const importable = preview ? preview.created + preview.updated : 0

  return (
    <div className="wbs-import">
      <p className="muted small">
        Excel (.xlsx) o CSV con le colonne <strong>codice</strong>, <strong>nome</strong> e, facoltative, <strong>padre</strong> (codice
        della voce superiore) o <strong>livello</strong>. Senza queste, la gerarchia segue i codici puntati (01 › 01.02 › 01.02.03). Le voci con
        un codice già presente vengono aggiornate, non duplicate.{' '}
        <button type="button" className="link-btn" onClick={downloadTemplate}>
          Scarica un modello CSV
        </button>
      </p>
      <div className="field">
        <label htmlFor="wbs-file">File</label>
        <input id="wbs-file" type="file" accept={WBS_FILE_ACCEPT} disabled={busy} onChange={(e) => choose(e.target.files?.[0] ?? null)} />
      </div>
      {busy && !preview && <p className="muted small">Lettura del file…</p>}
      {preview && (
        <>
          <p className="small">
            <strong>{preview.created}</strong> nuove · <strong>{preview.updated}</strong> da aggiornare
            {preview.errors > 0 && (
              <>
                {' '}
                · <strong className="error-text">{preview.errors}</strong> righe con errori (saltate)
              </>
            )}
          </p>
          <div className="table-wrap wbs-import-preview">
            <table className="table">
              <thead>
                <tr>
                  <th>Riga</th>
                  <th>Codice</th>
                  <th>Nome</th>
                  <th>Padre</th>
                  <th>Azione</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row} className={r.action === 'error' ? 'row-error' : ''}>
                    <td className="muted">{r.row}</td>
                    <td>{r.code ?? '—'}</td>
                    <td>{r.name || <span className="muted">—</span>}</td>
                    <td>{r.parent_code ?? <span className="muted">radice</span>}</td>
                    <td>
                      {r.action === 'error' ? <span className="error-text">{r.error}</span> : <span className={`badge import-${r.action}`}>{ACTION_LABEL[r.action]}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="row form-actions">
        <button type="button" className="btn btn-primary" onClick={confirm} disabled={busy || !preview || importable === 0}>
          {busy && preview ? 'Importo…' : `Importa ${importable} voc${importable === 1 ? 'e' : 'i'}`}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Annulla
        </button>
      </div>
    </div>
  )
}
