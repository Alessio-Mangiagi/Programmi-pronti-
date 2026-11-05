// "><(((º> sabusabu <º)))><"
// Finestra ⚙ Impostazioni: cartella dei contratti, cartella di destinazione e quando
// avviare la scansione (a mano, a un orario, all'arrivo di un file). Solo presentazione:
// regole e accesso alle cartelle stanno in lib/scansione-cartella.ts, l'esecuzione in
// App.tsx (avviaScansioneCartella). Le modifiche restano una bozza finché non si preme
// «Salva»; «Scansiona la cartella ora» salva e parte.
import { useState, type ReactNode } from 'react'
import { C, FONT_HEAD, IconAlert, IconFolder, bottone } from './ui'
import { GIORNI, type Cartella, type Impostazioni, type ModoAvvio } from './lib/scansione-cartella'

interface Props {
  impostazioni: Impostazioni
  utente: string              // di chi sono le impostazioni (utente del Portale, o «locale»)
  supportata: boolean         // File System Access API presente: solo Chrome / Edge
  permessoOk: boolean         // il browser ha dato il permesso sulle due cartelle
  occupato: boolean           // l'app sta già elaborando: niente scansione a mano adesso
  prossimo: Date | null       // prossimo avvio automatico, per la riga di stato
  onChiudi: () => void
  onSalva: (imp: Impostazioni) => Promise<void>
  onScegliCartella: () => Promise<Cartella | null>
  onScansionaOra: (imp: Impostazioni) => Promise<void>
  onRiattiva: () => Promise<void>
}

// Giorni nell'ordine italiano (lunedì primo); i valori sono quelli di Date.getDay()
const ORDINE_GIORNI = [1, 2, 3, 4, 5, 6, 0]

const quando = (d: Date) => d.toLocaleString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export const ImpostazioniScansione = (p: Props) => {
  const [bozza, setBozza] = useState<Impostazioni>(p.impostazioni)
  const [salvando, setSalvando] = useState(false)
  const cambia = (patch: Partial<Impostazioni>) => setBozza(b => ({ ...b, ...patch }))
  const attivo = p.supportata && !salvando
  const scegli = async (campo: 'contratti' | 'destinazione') => {
    const c = await p.onScegliCartella()
    if (c) cambia({ [campo]: c })
  }
  const conSalvataggio = (fn: () => Promise<void>) => async () => {
    setSalvando(true)
    try { await fn() } finally { setSalvando(false) }
  }
  const pronta = !!bozza.contratti && !!bozza.destinazione

  const rigaCartella = (campo: 'contratti' | 'destinazione', titolo: string, aiuto: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{titolo}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, height: 38, padding: '0 12px', border: `1px solid ${C.border}`, borderRadius: 6, background: C.header, color: bozza[campo] ? C.text : C.muted, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
          <IconFolder size={15} /> {bozza[campo]?.name ?? 'nessuna cartella scelta'}
        </span>
        <button type="button" disabled={!attivo} onClick={() => void scegli(campo)} style={{ ...bottone('secondario', C.accent, attivo), width: 'auto', padding: '9px 14px' }}>
          Scegli…
        </button>
      </div>
      <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.45 }}>{aiuto}</span>
    </div>
  )

  const opzione = (modo: ModoAvvio, titolo: string, extra?: ReactNode) => (
    <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 12px', border: `1px solid ${bozza.avvio === modo ? C.accent : C.border}`, borderRadius: 6, background: bozza.avvio === modo ? `${C.accent}0d` : C.panel, cursor: attivo ? 'pointer' : 'default' }}>
      <input type="radio" name="avvio" checked={bozza.avvio === modo} disabled={!attivo} onChange={() => cambia({ avvio: modo })} style={{ marginTop: 3, accentColor: C.accent }} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        <span style={{ fontWeight: 600 }}>{titolo}</span>
        {bozza.avvio === modo && extra}
      </span>
    </label>
  )

  return (
    <div onClick={p.onChiudi} style={{ position: 'fixed', inset: 0, background: 'rgba(12,25,38,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="titolo-impostazioni"
        style={{ background: C.panel, borderRadius: 10, width: 'min(640px, 100%)', maxHeight: '90vh', boxShadow: '0 12px 40px rgba(0,0,0,0.35)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '12px 20px', background: C.accent, color: '#ffffff', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <span aria-hidden="true" style={{ fontSize: 16 }}>⚙</span>
          <span id="titolo-impostazioni" style={{ fontWeight: 700, fontSize: 14, fontFamily: FONT_HEAD, letterSpacing: '0.02em', flex: 1 }}>Impostazioni — scansione della cartella</span>
          <span title="Le impostazioni sono personali: ogni utente del Portale ha le sue" style={{ fontSize: 11.5, opacity: 0.85 }}>{p.utente === 'locale' ? 'impostazioni di questo browser' : `impostazioni di ${p.utente}`}</span>
        </div>

        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 18, fontSize: 13, color: C.text, lineHeight: 1.5, overflow: 'auto' }}>
          {!p.supportata && (
            <div role="alert" style={{ display: 'flex', gap: 10, padding: '10px 12px', background: C.warnBg, border: `1px solid ${C.warnBorder}`, borderRadius: 6 }}>
              <IconAlert size={16} />
              <span>Le cartelle del PC si possono usare solo in <b>Chrome</b> o <b>Edge</b>: questo browser non permette a un programma di leggere e scrivere in una cartella. Apri OCR Documenti in Chrome o Edge.</span>
            </div>
          )}
          {p.supportata && !p.permessoOk && (p.impostazioni.contratti || p.impostazioni.destinazione) && (
            <div role="alert" style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px', background: C.warnBg, border: `1px solid ${C.warnBorder}`, borderRadius: 6 }}>
              <IconAlert size={16} />
              <span style={{ flex: 1 }}>Il browser chiede di nuovo il permesso sulle cartelle: finché non lo dai, la scansione automatica è ferma.</span>
              <button type="button" onClick={() => void p.onRiattiva()} style={{ ...bottone('primario'), width: 'auto' }}>Riattiva</button>
            </div>
          )}

          {rigaCartella('contratti', 'Cartella dei contratti',
            'Il programma legge i contratti che trova qui (PDF, Word, immagini, moduli contratto .txt; gli Excel come allegati del contratto con lo stesso nome). Dopo la scansione li sposta nella sottocartella «elaborati», o in «da controllare» se li ha respinti.')}
          {rigaCartella('destinazione', 'Cartella di destinazione',
            'Qui finiscono, per ogni contratto, <nome>_Import_Contratti.xlsx e <nome>_modulo.txt (da controllare o correggere), più registro_scansioni.csv con l\'esito di ogni file. È anche la cartella dove si salvano gli export fatti a mano.')}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 13 }}>Quando avviare la scansione</span>
            {opzione('mano', 'A mano — col pulsante «Scansiona la cartella ora»')}
            {opzione('orario', 'A un orario', (
              <span style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  alle <input type="time" value={bozza.orario} disabled={!attivo} onChange={e => cambia({ orario: e.target.value })} style={{ padding: '4px 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontFamily: 'inherit', fontSize: 13 }} />
                </span>
                <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {ORDINE_GIORNI.map(g => {
                    const si = bozza.giorni.includes(g)
                    return (
                      <button key={g} type="button" disabled={!attivo} aria-pressed={si}
                        onClick={() => cambia({ giorni: si ? bozza.giorni.filter(x => x !== g) : [...bozza.giorni, g] })}
                        style={{ minWidth: 44, padding: '5px 8px', borderRadius: 999, border: `1px solid ${si ? C.accent : C.border}`, background: si ? C.accent : C.panel, color: si ? '#fff' : C.muted, fontWeight: 600, fontSize: 12, fontFamily: 'inherit', cursor: attivo ? 'pointer' : 'default' }}>
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
                <input type="number" min={1} max={240} value={bozza.ogniMinuti} disabled={!attivo}
                  onChange={e => cambia({ ogniMinuti: Math.min(240, Math.max(1, Number(e.target.value) || 1)) })}
                  style={{ width: 64, padding: '4px 8px', border: `1px solid ${C.border}`, borderRadius: 4, fontFamily: 'inherit', fontSize: 13 }} />
                minuti
              </span>
            ))}
            <span style={{ fontSize: 12, color: C.muted, lineHeight: 1.45 }}>
              La scansione automatica parte solo con OCR Documenti aperto in una scheda (anche in secondo piano). Se all'orario scelto la pagina era chiusa, parte appena la riapri, lo stesso giorno. Con «all'arrivo di un file», un file arrivato da meno di un minuto aspetta il giro dopo: potrebbe essere ancora in copia.
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12.5, color: C.muted, borderTop: `1px solid ${C.border}`, paddingTop: 12 }}>
            <span>Ultima scansione: <b style={{ color: C.text }}>{p.impostazioni.ultimoEsito || 'nessuna'}</b></span>
            <span>Prossimo avvio automatico: <b style={{ color: C.text }}>{p.impostazioni.avvio === 'mano' ? 'nessuno (a mano)' : !p.permessoOk ? 'in pausa, manca il permesso sulle cartelle' : p.prossimo ? quando(p.prossimo) : '—'}</b></span>
          </div>
        </div>

        <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
          <button type="button" disabled={!attivo || !pronta || p.occupato}
            title={!pronta ? 'Scegli prima le due cartelle' : p.occupato ? 'Il programma sta già elaborando: aspetta che finisca' : 'Salva le impostazioni e scansiona subito la cartella dei contratti'}
            onClick={conSalvataggio(() => p.onScansionaOra(bozza))}
            style={{ ...bottone('secondario', C.accent, attivo && pronta && !p.occupato), width: 'auto', padding: '9px 14px' }}>
            Scansiona la cartella ora
          </button>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={p.onChiudi} style={{ ...bottone('silenzioso'), width: 'auto', padding: '9px 14px' }}>Annulla</button>
          <button type="button" disabled={!attivo} onClick={conSalvataggio(() => p.onSalva(bozza))} style={{ ...bottone('primario', C.accent, attivo), width: 'auto', padding: '9px 18px' }}>Salva</button>
        </div>
      </div>
    </div>
  )
}
