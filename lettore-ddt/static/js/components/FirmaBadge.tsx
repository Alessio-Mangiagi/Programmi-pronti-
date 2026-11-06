// "><(((º> sabusabu <º)))><"
// FirmaBadge.tsx — esito della firma digitale di un DDT caricato in busta .p7m (06/11/2026).
// Verde = firma valida, rosso = non valida, giallo = da verificare (revoca non controllabile, ente
// non negli elenchi ufficiali, certificato non qualificato). Il testo è il riepilogo del motore comune
// shared/firma; nel title (passando il mouse) i firmatari con i motivi. Usato dalla conversione
// singola (app.tsx) e dal dettaglio della conversione automatica (batch/JobDetail.tsx).
import React from 'react';

export interface FirmaDdt {
  esito: 'valida' | 'non valida' | 'da verificare' | null;
  riepilogo: string;
  livelli: number;
  firmatari: Array<{
    nome: string;
    codiceFiscale: string | null;
    ente: string | null;
    tipo: string | null;
    esito: string | null;
    data: string | null;
    motivi: string[];
  }>;
}

const COLORI: Record<
  string,
  { bg: string; fg: string; bordo: string; icona: string; etichetta: string }
> = {
  valida: { bg: '#eaf7ee', fg: '#256b3a', bordo: '#65bc7b', icona: '✔', etichetta: 'Firma valida' },
  'non valida': {
    bg: '#fdecea',
    fg: '#a12a1f',
    bordo: '#e57368',
    icona: '✖',
    etichetta: 'Firma NON valida',
  },
  'da verificare': {
    bg: '#fff7e0',
    fg: '#8a5a00',
    bordo: '#f0b429',
    icona: '!',
    etichetta: 'Firma da verificare',
  },
};

/** Testo del tooltip: un firmatario per riga, con tipo di firma, data ed eventuali motivi. */
export function dettaglioFirma(firma: FirmaDdt): string {
  return firma.firmatari
    .map((f) => {
      const data = f.data ? ` — ${new Date(f.data).toLocaleDateString('it-IT')}` : '';
      const motivi = f.motivi.length ? `\n   ${f.motivi.join('\n   ')}` : '';
      return `${f.nome}${f.ente ? ` (${f.ente})` : ''}${f.tipo ? `, ${f.tipo}` : ''}${data}${motivi}`;
    })
    .join('\n');
}

export function FirmaBadge({ firma, compatto = false }: { firma: FirmaDdt; compatto?: boolean }) {
  const c = COLORI[firma.esito || ''] || COLORI['da verificare'];
  return (
    <span
      title={dettaglioFirma(firma)}
      aria-label={`Firma digitale: ${firma.riepilogo}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.bordo}`,
        borderRadius: 999,
        padding: compatto ? '1px 8px' : '3px 10px',
        fontSize: compatto ? 11 : 12,
        fontWeight: 600,
        maxWidth: '100%',
        whiteSpace: compatto ? 'nowrap' : 'normal',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      <span aria-hidden="true">{c.icona}</span>
      <span>{compatto ? c.etichetta : firma.riepilogo || c.etichetta}</span>
    </span>
  );
}

export default FirmaBadge;
