import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { defaults, type FormData } from '@fieldview/form-core'
import type { PcqPreview } from '../api/types'
import { getToken } from '../auth/token'
import { isManager, useAuth } from '../auth/useAuth'
import { previewPcqFile } from '../api/upload'
import Icon from '../components/Icon'
import Loading from '../components/Loading'
import PcqDocumentView from '../components/PcqDocumentView'
import { useToast } from '../components/useToast'
import DynamicForm from '../forms/DynamicForm'
import { PCQ_OUTCOMES, pcqToSchema } from '../forms/pcqToSchema'

const EXAMPLE_NAME = 'PCQ-esempio.docx'

/** Colonne riconosciute nell'intestazione delle tabelle (vedi pcqToSchema.ts). */
const COLUMNS = [
  {
    col: 'Controllo',
    words: 'Controllo, Verifica, Prova, Attività, Descrizione, Ispezione, Caratteristica, Oggetto',
    becomes: `la domanda del modulo, obbligatoria, con risposta ${PCQ_OUTCOMES.join(' / ')}`,
  },
  {
    col: 'Fase',
    words: 'Fase, Lavorazione, Opera, WBS, Categoria, Elemento',
    becomes: 'la sezione del modulo; una cella vuota (o unita) continua la fase della riga sopra',
  },
  {
    col: 'Tutte le altre',
    words: 'Frequenza, Criterio di accettazione, Responsabile, Documento di registrazione, Norma…',
    becomes: 'il testo di aiuto sotto la domanda, nella forma "Intestazione: valore"',
  },
]

async function fetchExample(): Promise<File> {
  const r = await fetch('/api/pcq/example.docx', { headers: { Authorization: `Bearer ${getToken() ?? ''}` } })
  if (!r.ok) throw new Error(`Esempio non disponibile (${r.status})`)
  return new File([await r.blob()], EXAMPLE_NAME)
}

/**
 * Come deve essere fatto un PCQ perché l'import lo ricrei bene: regole, l'esempio
 * Word (generato dal server, scaricabile) e, accanto, il modulo che ne esce.
 * L'esempio passa dallo stesso import dei file veri, quindi ciò che si vede è ciò che succede.
 */
export default function PcqStructurePage() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PcqPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [values, setValues] = useState<FormData>({})
  const conv = useMemo(() => (preview ? pcqToSchema(preview) : null), [preview])

  useEffect(() => {
    let alive = true
    fetchExample()
      .then(async (f) => {
        const p = await previewPcqFile(null, f)
        if (!alive) return
        setFile(f)
        setPreview(p)
        setValues(defaults(pcqToSchema(p).schema))
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Esempio non disponibile'))
    return () => {
      alive = false
    }
  }, [])

  if (!isManager(user)) return <Navigate to="/projects" replace />

  function download() {
    if (!file) return
    const url = URL.createObjectURL(file)
    const a = Object.assign(document.createElement('a'), { href: url, download: EXAMPLE_NAME })
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast.success('Esempio scaricato: aprilo in Word e sostituisci i testi con i tuoi')
  }

  return (
    <>
      <header className="topbar">
        <div>
          <div className="muted small">
            <Link to="/templates">Moduli</Link>
          </div>
          <h1>Struttura del PCQ</h1>
        </div>
        <div className="topbar-actions">
          <button type="button" className="btn" onClick={download} disabled={!file}>
            <Icon name="file" /> Scarica l'esempio Word
          </button>
          <button type="button" className="btn btn-primary" disabled={!preview} onClick={() => navigate('/templates/new', { state: { pcq: preview } })}>
            Crea un modulo dall'esempio
          </button>
        </div>
      </header>
      <div className="content pcq-structure">
        <section className="card">
          <h2>Come deve essere fatto il file</h2>
          <ol className="pcq-rules">
            <li>
              <strong>Word (.docx)</strong> è il formato migliore. Dal PDF si legge solo il testo, senza colonne: le righe numerate o in
              maiuscolo diventano sezioni, le altre domande. I PDF scansionati non si leggono.
            </li>
            <li>
              Il <strong>primo titolo</strong> (stile <em>Titolo 1</em>) diventa il nome del modulo; i titoli di capitolo (<em>Titolo 2</em>)
              servono solo a orientarsi.
            </li>
            <li>
              I controlli stanno in <strong>tabelle</strong> con la <strong>prima riga di intestazione</strong>, anche più tabelle nello stesso
              file. Le righe vuote sono ignorate.
            </li>
            <li>
              In fondo al modulo l'app aggiunge sempre la sezione <strong>Chiusura</strong>: data del controllo, note e firma del responsabile.
            </li>
          </ol>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Colonna</th>
                  <th>Intestazioni riconosciute</th>
                  <th>Nel modulo diventa</th>
                </tr>
              </thead>
              <tbody>
                {COLUMNS.map((c) => (
                  <tr key={c.col}>
                    <td>
                      <strong>{c.col}</strong>
                    </td>
                    <td>{c.words}</td>
                    <td>{c.becomes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Senza una colonna "Controllo" riconoscibile si usa la prima colonna che non sia un numero d'ordine (N., Codice).</p>
        </section>

        {error && <p className="error">{error}</p>}
        {!preview && !error && <Loading />}
        {preview && conv && (
          <div className="pcq-compare">
            <section>
              <h2 className="pcq-compare-title">
                <span className="step-n">1</span> Il file Word di esempio
              </h2>
              <div className="pcq-paper">
                <PcqDocumentView preview={preview} />
              </div>
            </section>
            <section>
              <h2 className="pcq-compare-title">
                <span className="step-n">2</span> Il modulo che ne esce
              </h2>
              <div className="card">
                <h3 className="pcq-form-name">{conv.name}</h3>
                <p className="muted small">
                  {conv.controls} domande · categoria Qualità · prova pure a compilarlo
                </p>
                <DynamicForm schema={conv.schema} value={values} attachments={{}} onChange={setValues} />
              </div>
            </section>
          </div>
        )}
      </div>
    </>
  )
}
