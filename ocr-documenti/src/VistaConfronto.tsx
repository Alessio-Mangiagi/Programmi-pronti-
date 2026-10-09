// Scheda «Confronto» del pannello: cosa è cambiato fra la bozza Word e il PDF firmato,
// e cosa è finito nel testo usato per l'estrazione. Solo presentazione: il calcolo
// sta in lib/confronto.
import { C, FONT_HEAD, IconAlert, IconCheck, NomeFile } from './ui'
// "><(((º> sabusabu <º)))><"
import type { Confronto, Differenza, TipoDifferenza } from './lib/confronto'

const ETICHETTA: Record<TipoDifferenza, { testo: string; colore: string; aiuto: string }> = {
  modificata: { testo: 'modificata', colore: C.yellow, aiuto: 'Il PDF dice una cosa diversa dalla bozza: vale il PDF' },
  aggiunta: { testo: 'aggiunta', colore: C.green, aiuto: 'Testo presente solo nel PDF: aggiunto' },
  rimossa: { testo: 'rimossa', colore: C.red, aiuto: 'Testo presente solo nella bozza: nel PDF non c’è più, tolto' },
  spostata: { testo: 'spostata', colore: C.blue, aiuto: 'Stesso testo, in un altro punto del documento: vale l’ordine del PDF' },
  rumore: { testo: 'rumore OCR', colore: C.muted, aiuto: 'Differenza di una o due lettere senza numeri: è la scansione che legge male, resta il testo della bozza' },
}

const chip = (testo: string, colore: string, aiuto?: string) => (
  <span key={testo} title={aiuto} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 9px', borderRadius: 999, background: `${colore}14`, color: colore, fontWeight: 600, fontSize: 11.5, whiteSpace: 'nowrap' }}>
    {testo}
  </span>
)

export const VistaConfronto = ({ confronto, bozza, pdf }: { confronto: Confronto; bozza: string; pdf: string }) => {
  const { riepilogo, differenze, confrontabile } = confronto
  const vere = riepilogo.modificate + riepilogo.aggiunte + riepilogo.rimosse
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 13 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontFamily: FONT_HEAD, fontSize: 16, fontWeight: 500, color: C.accent }}>Bozza Word ↔ PDF firmato</span>
        <span style={{ display: 'flex', gap: 6, alignItems: 'baseline', color: C.muted, fontSize: 12, minWidth: 0 }}>
          <span style={{ flexShrink: 0 }}>Word:</span><NomeFile nome={bozza} style={{ color: C.text, fontWeight: 600, maxWidth: 360 }} />
          <span style={{ flexShrink: 0, marginLeft: 8 }}>PDF:</span><NomeFile nome={pdf} style={{ color: C.text, fontWeight: 600, maxWidth: 360 }} />
        </span>
        <span style={{ color: C.muted, fontSize: 12, lineHeight: 1.45 }}>
          Dove i due coincidono resta il testo esatto del Word; dove il PDF è diverso vale il PDF, perché è quello firmato.
          Le differenze di una lettera senza numeri sono errori della scansione e si ignorano.
        </span>
      </div>

      {!confrontabile ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: C.warnBg, border: `1px solid ${C.warnBorder}`, borderRadius: 4, color: C.yellow, fontSize: 12.5 }}>
          <IconAlert size={14} /> I due documenti sono troppo diversi (o il Word è vuoto): non si è potuto confrontarli, si è usato il PDF così com’è.
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {vere === 0 && chip('PDF uguale alla bozza', C.green, 'Nessuna modifica in fase di firma')}
          {riepilogo.modificate > 0 && chip(`${riepilogo.modificate} modificat${riepilogo.modificate === 1 ? 'a' : 'e'}`, C.yellow, ETICHETTA.modificata.aiuto)}
          {riepilogo.aggiunte > 0 && chip(`${riepilogo.aggiunte} aggiunt${riepilogo.aggiunte === 1 ? 'a' : 'e'}`, C.green, ETICHETTA.aggiunta.aiuto)}
          {riepilogo.rimosse > 0 && chip(`${riepilogo.rimosse} rimoss${riepilogo.rimosse === 1 ? 'a' : 'e'}`, C.red, ETICHETTA.rimossa.aiuto)}
          {riepilogo.spostate > 0 && chip(`${riepilogo.spostate} spostat${riepilogo.spostate === 1 ? 'a' : 'e'}`, C.blue, ETICHETTA.spostata.aiuto)}
          {riepilogo.rumore > 0 && chip(`${riepilogo.rumore} rumore OCR ignorat${riepilogo.rumore === 1 ? 'o' : 'i'}`, C.muted, ETICHETTA.rumore.aiuto)}
        </div>
      )}

      {confrontabile && vere + riepilogo.spostate > 0 && tabella(differenze.filter(d => d.tipo !== 'rumore'))}

      {/* Il rumore OCR sta a parte: su una scansione sono decine di voci e coprirebbero
          le modifiche vere. Si apre per verificare che siano davvero errori di lettura. */}
      {confrontabile && riepilogo.rumore > 0 && (
        <details className="gruppo-pieghevole">
          <summary>Errori OCR corretti col Word ({riepilogo.rumore})</summary>
          <div style={{ paddingTop: 8 }}>{tabella(differenze.filter(d => d.tipo === 'rumore'))}</div>
        </details>
      )}
    </div>
  )
}

// La tabella delle differenze: riga del PDF, tipo, i due testi, con la spunta su quello
// finito nel testo usato.
const tabella = (differenze: Differenza[]) => (
  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12.5 }}>
    <thead>
      <tr>
        {['Riga PDF', 'Tipo', 'Bozza Word', 'PDF firmato'].map((h, i) => (
          <th key={h} style={{ background: C.bg, color: C.muted, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', textAlign: i === 0 ? 'right' : 'left', padding: '6px 10px', border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {differenze.map((d, i) => {
        const e = ETICHETTA[d.tipo]
        // cosa è finito nel testo usato: il PDF, tranne nel rumore OCR dove resta il Word;
        // una riga spostata è uguale da entrambe le parti, niente da barrare
        const usatoWord = d.tipo === 'rumore'
        const spostata = d.tipo === 'spostata'
        return (
          <tr key={i} style={{ background: i % 2 ? C.header : 'transparent' }}>
            <td style={{ padding: '5px 10px', border: `1px solid ${C.border}`, textAlign: 'right', color: C.muted, fontVariantNumeric: 'tabular-nums', verticalAlign: 'top' }}>{d.rigaPdf}</td>
            <td style={{ padding: '5px 10px', border: `1px solid ${C.border}`, verticalAlign: 'top' }}>{chip(e.testo, e.colore, e.aiuto)}</td>
            <td style={{ padding: '5px 10px', border: `1px solid ${C.border}`, verticalAlign: 'top', color: usatoWord ? C.text : C.muted, textDecoration: !usatoWord && !spostata && d.word ? 'line-through' : 'none', wordBreak: 'break-word' }}>
              {d.word || <span style={{ color: C.muted }}>—</span>}
              {usatoWord && <span title="Usato nel testo" style={{ color: C.green, marginLeft: 6, display: 'inline-flex', verticalAlign: '-2px' }}><IconCheck size={12} /></span>}
            </td>
            <td style={{ padding: '5px 10px', border: `1px solid ${C.border}`, verticalAlign: 'top', color: usatoWord ? C.muted : C.text, fontWeight: usatoWord || !d.pdf ? 400 : 600, textDecoration: usatoWord ? 'line-through' : 'none', wordBreak: 'break-word' }}>
              {d.pdf || <span style={{ color: C.muted }}>—</span>}
              {!usatoWord && d.pdf && <span title="Usato nel testo" style={{ color: C.green, marginLeft: 6, display: 'inline-flex', verticalAlign: '-2px' }}><IconCheck size={12} /></span>}
            </td>
          </tr>
        )
      })}
    </tbody>
  </table>
)
