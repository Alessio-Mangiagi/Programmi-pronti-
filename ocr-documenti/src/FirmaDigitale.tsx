// "><(((º> sabusabu <º)))><"
/**
 * Firma digitale dei documenti in coda (.p7m aperti da src/lib/firma.ts):
 *  - BadgeFirma: pastiglia accanto al nome nella coda (verde valida, rosso NON valida,
 *    giallo da verificare), col riepilogo al passaggio del mouse;
 *  - RiquadroFirma: sopra l'anteprima del documento attivo, l'esito per esteso e, aperto,
 *    il dettaglio di ogni firmatario (ente, tipo di firma, data, marca temporale, motivi).
 * Una firma non valida si segnala e basta: il documento si elabora lo stesso.
 */
import { useState } from 'react'
import { aspettoEsito, type FirmaVoce, type RapportoFirma } from './lib/firma'
import { C } from './ui'

const data = (iso?: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('it-IT')
}

export const BadgeFirma = ({ rapporto }: { rapporto?: RapportoFirma }) => {
  if (!rapporto) return null
  const a = aspettoEsito(rapporto.esito)
  return (
    <span
      title={rapporto.riepilogo}
      style={{ display: 'inline-block', marginTop: 3, padding: '1px 7px', borderRadius: 10, fontSize: 10.5, fontWeight: 700,
        letterSpacing: '0.02em', color: a.colore, background: a.sfondo, border: `1px solid ${a.colore}40`, whiteSpace: 'nowrap' }}
    >
      {rapporto.esito === 'valida' ? '✓ ' : rapporto.esito === 'non valida' ? '✗ ' : '! '}{a.etichetta}
    </span>
  )
}

const Firmatario = ({ f }: { f: FirmaVoce }) => {
  const a = aspettoEsito(f.esito)
  const marca = f.marca_temporale
  return (
    <li style={{ marginBottom: 6 }}>
      <span style={{ fontWeight: 700 }}>{f.firmatario}</span>
      {f.codice_fiscale && <span style={{ color: C.muted }}> · {f.codice_fiscale}</span>}
      {f.organizzazione && <span style={{ color: C.muted }}> · {f.organizzazione}</span>}
      {' — '}<span style={{ color: a.colore, fontWeight: 600 }}>{f.esito ?? 'non verificata'}</span>
      <div style={{ color: C.muted }}>
        {f.tipo ?? 'firma'}{f.ente_certificatore ? `, emessa da ${f.ente_certificatore}` : ''}
        {f.data_firma_dichiarata ? `, firmata il ${data(f.data_firma_dichiarata)} (data dichiarata)` : ''}
        {marca?.valida && marca.data ? `, marca temporale del ${data(marca.data)}${marca.ente ? ` (${marca.ente})` : ''}` : ''}
        {f.certificato_valido_al ? `, certificato valido fino al ${data(f.certificato_valido_al)}` : ''}
      </div>
      {f.motivi?.length > 0 && (
        <ul style={{ margin: '2px 0 0 16px', padding: 0, color: f.esito === 'valida' ? C.muted : a.colore }}>
          {f.motivi.map((m, i) => <li key={i}>{m}</li>)}
        </ul>
      )}
    </li>
  )
}

export const RiquadroFirma = ({ rapporto }: { rapporto?: RapportoFirma }) => {
  const [aperto, setAperto] = useState(false)
  if (!rapporto) return null
  const a = aspettoEsito(rapporto.esito)
  return (
    <section
      aria-label="Firma digitale"
      style={{ margin: '8px 12px 0', padding: '8px 12px', borderRadius: 6, background: a.sfondo, border: `1px solid ${a.colore}55`,
        fontSize: 12, color: C.text }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <strong style={{ color: a.colore }}>{a.etichetta}</strong>
        <span style={{ flex: 1, minWidth: 200 }}>
          {rapporto.nomeOriginale ? `«${rapporto.nomeOriginale}» — ` : ''}{rapporto.riepilogo}
        </span>
        <button
          type="button"
          onClick={() => setAperto(v => !v)}
          aria-expanded={aperto}
          style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', fontSize: 12, fontWeight: 600, padding: 0 }}
        >
          {aperto ? 'Nascondi dettagli' : 'Dettagli firma'}
        </button>
      </div>
      {aperto && (
        <div style={{ marginTop: 6 }}>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {rapporto.firme.map((f, i) => <Firmatario key={i} f={f} />)}
          </ul>
          <div style={{ color: C.muted, marginTop: 4 }}>
            {rapporto.livelli > 1 ? `Buste annidate: ${rapporto.livelli}. ` : ''}
            Verifica sugli elenchi ufficiali degli enti certificatori
            {rapporto.elenchi?.aggiornati_il ? ` aggiornati il ${data(rapporto.elenchi.aggiornati_il)}` : ''}.
            {rapporto.esito !== 'valida' ? ' La firma è segnalata, il documento si elabora lo stesso.' : ''}
          </div>
        </div>
      )}
    </section>
  )
}
