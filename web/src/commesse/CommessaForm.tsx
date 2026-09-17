import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../api/client'
import { useToast } from '../components/Toast'
import { useCommesse, type Commessa, type CommessaParam } from './CommesseContext'

/** Selettore dei valori di un parametro personalizzato: chip multi-scelta o radio se `multi=false`. */
export function ParamPicker({ param, value, onChange }: { param: CommessaParam; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (opt: string) => {
    if (param.multi) onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt])
    else onChange(value[0] === opt ? [] : [opt])
  }
  return (
    <div className="field">
      <span className="dyn-label">
        {param.name} <span className="muted small">({param.multi ? 'scelta multipla' : 'una sola'})</span>
      </span>
      <div className="dyn-multi" role="group" aria-label={param.name}>
        {param.options.map((opt) => (
          <button key={opt} type="button" className={`chip chip-primary${value.includes(opt) ? ' chip-on' : ''}`} aria-pressed={value.includes(opt)} onClick={() => toggle(opt)}>
            {opt}
          </button>
        ))}
      </div>
    </div>
  )
}

/** Crea o modifica una commessa: codice, nome, committente e parametri personalizzati. */
export default function CommessaForm({ commessa, onDone }: { commessa?: Commessa; onDone: (saved?: Commessa) => void }) {
  const toast = useToast()
  const { params, reload } = useCommesse()
  const [code, setCode] = useState(commessa?.code ?? '')
  const [name, setName] = useState(commessa?.name ?? '')
  const [client, setClient] = useState(commessa?.client ?? '')
  const [values, setValues] = useState<Record<string, string[]>>(commessa?.params ?? {})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const body = { code, name, client: client || null, params: values }
    const res = commessa
      ? await api.PATCH('/commesse/{commessa_id}', { params: { path: { commessa_id: commessa.id } }, body })
      : await api.POST('/commesse', { body })
    setBusy(false)
    if (res.error || !res.data) return setError(errorMessage(res.error))
    toast.success(commessa ? 'Commessa aggiornata' : `Commessa ${code} creata`)
    await reload()
    onDone(res.data)
  }

  async function archive() {
    if (!commessa || !window.confirm(`Archiviare la commessa ${commessa.code}? Sparisce dalla barra, i cantieri restano.`)) return
    const { error } = await api.PATCH('/commesse/{commessa_id}', { params: { path: { commessa_id: commessa.id } }, body: { archived: true } })
    if (error) return toast.error(errorMessage(error))
    toast.success('Commessa archiviata')
    await reload()
    onDone()
  }

  return (
    <form onSubmit={submit}>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="cf-code">Codice commessa</label>
          <input id="cf-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="C-2026-014" required autoFocus />
        </div>
        <div className="field">
          <label htmlFor="cf-client">Committente</label>
          <input id="cf-client" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Comune di …" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="cf-name">Oggetto</label>
        <input id="cf-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Riqualificazione scuola …" required />
      </div>
      {params.length > 0 && (
        <fieldset className="param-fieldset">
          <legend className="filter-label">Parametri</legend>
          {params.map((p) => (
            <ParamPicker key={p.id} param={p} value={values[p.id] ?? []} onChange={(v) => setValues({ ...values, [p.id]: v })} />
          ))}
        </fieldset>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row form-actions">
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Salvataggio…' : commessa ? 'Salva' : 'Crea commessa'}
        </button>
        <button className="btn" type="button" onClick={() => onDone()}>
          Annulla
        </button>
        {commessa && (
          <button className="btn btn-danger" type="button" onClick={archive} style={{ marginLeft: 'auto' }}>
            Archivia
          </button>
        )}
      </div>
    </form>
  )
}
