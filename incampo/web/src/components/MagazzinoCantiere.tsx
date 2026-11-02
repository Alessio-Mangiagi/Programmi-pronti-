// "><(((º> sabusabu <º)))><"
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../api/client'

type Articolo = { codice: string; descrizione: string; um: string; quantita: number; ubicazione: string; url?: string }
type Mezzo = { codice: string; tipo_mezzo?: string | null; marca?: string | null; modello?: string | null; targa?: string | null; stato: string; assegnato_a?: string | null; ubicazione: string; url?: string }
type Giacenze = {
  commessa: string
  commessa_code?: string
  ubicazioni: { id: number; nome: string; url?: string }[]
  articoli: Articolo[]
  mezzi: Mezzo[]
  totali: { articoli: number; mezzi: number; mezzi_in_uso: number }
  url?: string
  magazzino_url?: string
  aggiornato_il?: string
}

const STATO: Record<string, string> = { disponibile: 'Disponibile', in_uso: 'In uso', manutenzione: 'Manutenzione', fermo: 'Fermo', restituito: 'Restituito' }
const fmtQ = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 3 })

/**
 * Materiale e mezzi presenti in cantiere secondo il Magazzino Operativo (stessa commessa).
 * Il Magazzino può essere spento o il cantiere senza commessa: lo si dice e basta.
 */
export default function MagazzinoCantiere({ projectId }: { projectId: string }) {
  const [dati, setDati] = useState<Giacenze | null>(null)
  const [errore, setErrore] = useState<string | null>(null)
  const [tutti, setTutti] = useState(false)

  useEffect(() => {
    setDati(null)
    setErrore(null)
    api.GET('/projects/{project_id}/magazzino', { params: { path: { project_id: projectId } } }).then(({ data, error, response }) => {
      if (error || !data) setErrore(response?.status === 409 ? 'Il cantiere non è collegato a una commessa: scegline una dalla barra in alto.' : errorMessage(error, 'Magazzino non raggiungibile'))
      else setDati(data as unknown as Giacenze)
    })
  }, [projectId])

  return (
    <section className="card magazzino-card">
      <div className="magazzino-testa">
        <h2>
          <span className="badge">Magazzino</span> Materiale e mezzi in cantiere
        </h2>
        {dati?.magazzino_url && (
          <a className="btn small" href={dati.magazzino_url} target="_blank" rel="noopener">
            Apri il Magazzino
          </a>
        )}
      </div>
      {errore ? (
        <p className="muted">{errore}</p>
      ) : !dati ? (
        <p className="muted">Carico le giacenze…</p>
      ) : (
        <>
          <p className="muted small">
            Commessa <b>{dati.commessa}</b> · {dati.ubicazioni.map((u) => u.nome).join(', ')} · {dati.totali.articoli} articoli, {dati.totali.mezzi} mezzi ({dati.totali.mezzi_in_uso} in uso)
          </p>
          <div className="magazzino-colonne">
            <div>
              <h3>Materiale</h3>
              {dati.articoli.length === 0 ? (
                <p className="muted small">Nessuna giacenza registrata.</p>
              ) : (
                <table className="magazzino-tabella">
                  <thead>
                    <tr>
                      <th>Articolo</th>
                      <th>Dove</th>
                      <th className="num">Quantità</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(tutti ? dati.articoli : dati.articoli.slice(0, 12)).map((a) => (
                      <tr key={a.codice + a.ubicazione}>
                        <td>
                          <a href={a.url} target="_blank" rel="noopener">{a.descrizione}</a> <span className="muted small">{a.codice}</span>
                        </td>
                        <td className="muted small">{a.ubicazione}</td>
                        <td className="num">
                          <b>{fmtQ(a.quantita)}</b> {a.um}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {dati.articoli.length > 12 && (
                <button type="button" className="btn small" onClick={() => setTutti((v) => !v)}>
                  {tutti ? 'Mostra meno' : `Tutti i ${dati.articoli.length} articoli`}
                </button>
              )}
            </div>
            <div>
              <h3>Mezzi</h3>
              {dati.mezzi.length === 0 ? (
                <p className="muted small">Nessun mezzo in cantiere.</p>
              ) : (
                <ul className="magazzino-mezzi">
                  {dati.mezzi.map((m) => (
                    <li key={m.codice}>
                      <a href={m.url} target="_blank" rel="noopener">
                        {[m.tipo_mezzo, m.marca, m.modello].filter(Boolean).join(' ')}
                      </a>
                      <span className="muted small">
                        {m.targa ? ` ${m.targa} · ` : ' '}
                        {STATO[m.stato] ?? m.stato}
                        {m.assegnato_a ? ` · ${m.assegnato_a}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
