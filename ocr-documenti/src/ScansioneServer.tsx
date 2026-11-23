// "><(((º> sabusabu <º)))><"
// Scheda «Sul server» della finestra ⚙ Impostazioni (23/11/2026): la scansione della
// cartella fatta dal server (server/cartella.ts), che funziona in ogni browser (anche
// Firefox) e anche a pagina chiusa. Le cartelle sono percorsi del PC dove gira OCR
// Documenti, non del PC di chi guarda: le imposta solo l'amministratore dell'app; gli
// altri vedono se la scansione è attiva. Il componente parla da solo con /api/cartella
// (GET ogni 3 s mentre la finestra è aperta, per seguire la scansione in corso; PUT per
// salvare; POST /avvia per partire subito), così App.tsx non deve tenere questo stato.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { C, IconAlert, IconFolder, bottone } from './ui'
import { GIORNI, type ModoAvvio } from './lib/regole-cartella'

interface ImpServer {
  contratti: string; destinazione: string; avvio: ModoAvvio; orario: string; giorni: number[]
  ogniMinuti: number; ultimaScansione: number; ultimoEsito: string; utente?: string
}
interface EsitoFile { quando: number; file: string; esito: 'elaborato' | 'da controllare'; voci?: number; note?: string }
interface StatoServer {
  inCorso: boolean; file: string; fase: string; fatti: number; totali: number
  ultimi: EsitoFile[]; lasciati: string[]; errore: string
}
type Risposta =
  | { admin: false; attiva: boolean; avvio: ModoAvvio }
  | { admin: true; attiva: boolean; impostazioni: ImpServer; stato: StatoServer; prossimo: number | null }

const ORDINE_GIORNI = [1, 2, 3, 4, 5, 6, 0]
const NOMI_AVVIO: Record<ModoAvvio, string> = { mano: 'a mano', orario: 'a un orario', arrivo: 'all\'arrivo di un file' }
const quando = (ms: number) => new Date(ms).toLocaleString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const campoTesto = { flex: 1, minWidth: 0, height: 38, padding: '0 12px', border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: 'inherit', fontSize: 13, color: C.text } as const

const messaggioDi = async (r: Response): Promise<string> => {
  try { return ((await r.json()) as { error?: string }).error || `errore ${r.status}` } catch { return `errore ${r.status}` }
}

export const ScansioneServer = ({ onChiudi }: { onChiudi: () => void }) => {
  const [info, setInfo] = useState<Risposta | null>(null)
  const [bozza, setBozza] = useState<ImpServer | null>(null)
  const [errore, setErrore] = useState('')
  const [notizia, setNotizia] = useState('')
  const [salvando, setSalvando] = useState(false)

  // Stato dal server. La bozza si prende solo la prima volta (b ?? …): i giri successivi
  // aggiornano lo stato della scansione senza cancellare quello che l'amministratore scrive.
  const carica = useCallback(async () => {
    try {
      const r = await fetch('/api/cartella')
      if (!r.ok) throw new Error(await messaggioDi(r))
      const d = (await r.json()) as Risposta
      setInfo(d)
      if (d.admin) setBozza(b => b ?? d.impostazioni)
    } catch (e) {
      setErrore(`Il server di OCR Documenti non risponde: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [])
  useEffect(() => {
    // anche la prima lettura passa da un timer: lo stato si aggiorna fuori dal giro di render
    const subito = window.setTimeout(() => void carica(), 0)
    const t = window.setInterval(() => void carica(), 3000)
    return () => { window.clearTimeout(subito); window.clearInterval(t) }
  }, [carica])

  const cambia = (patch: Partial<ImpServer>) => setBozza(b => (b ? { ...b, ...patch } : b))
  const salva = async (): Promise<boolean> => {
    if (!bozza) return false
    setErrore(''); setNotizia('')
    const r = await fetch('/api/cartella', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bozza) })
    if (!r.ok) { setErrore(await messaggioDi(r)); return false }
    await carica()
    return true
  }
  const conAttesa = (fn: () => Promise<void>) => async () => {
    setSalvando(true)
    try { await fn() } finally { setSalvando(false) }
  }

  if (!info) {
    return <div style={{ padding: '18px 20px', fontSize: 13, color: errore ? C.red : C.muted }}>{errore || 'Lettura delle impostazioni del server…'}</div>
  }

  if (!info.admin) {
    return (
      <>
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13, lineHeight: 1.5, color: C.text }}>
          <span>La scansione sul server legge una cartella del PC dove gira OCR Documenti e la imposta <b>l'amministratore</b> del programma.</span>
          <span>Stato: <b>{info.attiva ? `attiva, ${NOMI_AVVIO[info.avvio]}` : 'non impostata'}</b>.</span>
        </div>
        <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onChiudi} style={{ ...bottone('silenzioso'), width: 'auto', padding: '9px 14px' }}>Chiudi</button>
        </div>
      </>
    )
  }

  const s = info.stato
  const pronta = !!bozza?.contratti.trim() && !!bozza?.destinazione.trim()
  const attivo = !salvando
  const opzione = (modo: ModoAvvio, titolo: string, extra?: ReactNode) => (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: `1px solid ${bozza?.avvio === modo ? C.accent : C.border}`, borderRadius: 6, background: bozza?.avvio === modo ? `${C.accent}0d` : C.panel, cursor: 'pointer' }}>
      <input type="radio" name="avvio-server" checked={bozza?.avvio === modo} onChange={() => cambia({ avvio: modo })} style={{ marginTop: 3, accentColor: C.accent }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <span style={{ fontWeight: 600 }}>{titolo}</span>
        {bozza?.avvio === modo && extra}
      </span>
    </label>
  )
  const rigaCartella = (campo: 'contratti' | 'destinazione', titolo: string, esempio: string, aiuto: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{titolo}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <IconFolder size={15} />
        <input type="text" value={bozza?.[campo] ?? ''} placeholder={esempio} spellCheck={false}
          onChange={e => cambia({ [campo]: e.target.value })} style={campoTesto} />
      </div>
      <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.45 }}>{aiuto}</span>
    </div>
  )

  return (
    <>
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18, fontSize: 13, color: C.text, lineHeight: 1.5, overflow: 'auto' }}>
        <span style={{ fontSize: 12.5, color: C.muted }}>
          Il server legge la cartella da solo: funziona in ogni browser, anche Firefox, e anche a pagina chiusa. I percorsi sono quelli del <b>PC dove gira OCR Documenti</b> (vanno bene anche le cartelle di rete, es. <code>\\server\Contratti</code>).
        </span>
        {errore && (
          <div role="alert" style={{ display: 'flex', gap: 10, padding: '10px 12px', background: '#fdecea', border: `1px solid ${C.red}55`, borderRadius: 6, color: C.red }}>
            <IconAlert size={16} /><span>{errore}</span>
          </div>
        )}
        {notizia && <div style={{ padding: '10px 12px', background: '#e8f5ec', border: `1px solid ${C.green}55`, borderRadius: 6, color: C.green }}>{notizia}</div>}

        {rigaCartella('contratti', 'Cartella dei contratti', 'C:\\Contratti\\Da leggere',
          'Il server legge i PDF (anche firmati .p7m) e i moduli contratto .txt che trova qui; gli Excel e il Word con un nome simile al PDF vanno con lui come allegati e bozza. Dopo la scansione li sposta in «elaborati», o in «da controllare» se li ha respinti.')}
        {rigaCartella('destinazione', 'Cartella di destinazione', 'C:\\Contratti\\Excel per Alyante',
          'Qui finiscono <nome>_Import_Contratti.xlsx e <nome>_modulo.txt per ogni contratto, più registro_scansioni.csv con l\'esito di ogni file.')}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Quando avviare la scansione</span>
          {opzione('mano', 'A mano — col pulsante «Scansiona ora»')}
          {opzione('orario', 'A un orario', (
            <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                alle <input type="time" value={bozza?.orario ?? '20:00'} onChange={e => cambia({ orario: e.target.value })} style={{ padding: '4px 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontFamily: 'inherit', fontSize: 13 }} />
              </span>
              <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {ORDINE_GIORNI.map(g => {
                  const si = !!bozza?.giorni.includes(g)
                  return (
                    <button key={g} type="button" aria-pressed={si}
                      onClick={() => cambia({ giorni: si ? bozza!.giorni.filter(x => x !== g) : [...(bozza?.giorni ?? []), g] })}
                      style={{ minWidth: 44, padding: '5px 8px', borderRadius: 999, border: `1px solid ${si ? C.accent : C.border}`, background: si ? C.accent : C.panel, color: si ? '#fff' : C.muted, fontWeight: 600, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer' }}>
                      {GIORNI[g]}
                    </button>
                  )
                })}
              </span>
            </span>
          ))}
          {opzione('arrivo', 'All\'arrivo di un file', (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              controlla la cartella ogni
              <input type="number" min={1} max={240} value={bozza?.ogniMinuti ?? 5}
                onChange={e => cambia({ ogniMinuti: Math.min(240, Math.max(1, Number(e.target.value) || 1)) })}
                style={{ width: 64, padding: '4px 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontFamily: 'inherit', fontSize: 13 }} />
              minuti
            </span>
          ))}
          <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.45 }}>
            L'orologio è quello del server: la scansione parte anche se nessuno ha la pagina aperta. Con «all'arrivo di un file», un file arrivato da meno di un minuto aspetta il giro dopo: potrebbe essere ancora in copia.
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: C.muted, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
          {s.inCorso
            ? <span>In corso: <b style={{ color: C.text }}>{s.file}</b> — {s.fase} ({Math.min(s.fatti + 1, s.totali)}/{s.totali})</span>
            : <span>Ultima scansione: <b style={{ color: C.text }}>{info.impostazioni.ultimoEsito || 'nessuna'}</b></span>}
          <span>Prossimo avvio automatico: <b style={{ color: C.text }}>{info.impostazioni.avvio === 'mano' ? 'nessuno (a mano)' : !info.attiva ? 'nessuno, mancano le cartelle' : info.prossimo ? quando(info.prossimo) : '—'}</b></span>
          {s.errore && <span style={{ color: C.red }}>{s.errore}</span>}
          {s.lasciati.length > 0 && (
            <span style={{ color: C.yellow }}>Restano nella cartella, da caricare dalla pagina (il server non li legge da soli): {s.lasciati.join(', ')}</span>
          )}
          {s.ultimi.length > 0 && (
            <table style={{ marginTop: 6, borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <tbody>
                {s.ultimi.slice(0, 10).map(e => (
                  <tr key={`${e.quando}-${e.file}`} style={{ borderTop: `1px solid ${C.border}` }}>
                    <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>{quando(e.quando)}</td>
                    <td style={{ padding: '4px 6px', color: C.text }}>{e.file}</td>
                    <td style={{ padding: '4px 6px', whiteSpace: 'nowrap', color: e.esito === 'elaborato' ? C.green : C.red, fontWeight: 600 }}>{e.esito}{e.voci !== undefined ? ` · ${e.voci} voci` : ''}</td>
                    <td style={{ padding: '4px 6px' }}>{e.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
        <button type="button" disabled={!attivo || !pronta || s.inCorso}
          title={!pronta ? 'Scrivi prima le due cartelle' : s.inCorso ? 'Una scansione è già in corso' : 'Salva le impostazioni e scansiona subito la cartella dei contratti'}
          onClick={conAttesa(async () => {
            if (!(await salva())) return
            const r = await fetch('/api/cartella/avvia', { method: 'POST' })
            if (!r.ok) setErrore(await messaggioDi(r))
            else { setNotizia('Scansione partita: segui qui sotto i file man mano che li elabora.'); await carica() }
          })}
          style={{ ...bottone('secondario', C.accent, attivo && pronta && !s.inCorso), width: 'auto', padding: '9px 14px' }}>
          Scansiona ora
        </button>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onChiudi} style={{ ...bottone('silenzioso'), width: 'auto', padding: '9px 14px' }}>Chiudi</button>
        <button type="button" disabled={!attivo || !pronta}
          onClick={conAttesa(async () => { if (await salva()) setNotizia('Impostazioni salvate sul server.') })}
          style={{ ...bottone('primario', C.accent, attivo && pronta), width: 'auto', padding: '9px 18px' }}>Salva</button>
      </div>
    </>
  )
}
