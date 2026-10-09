/**
 * FornitoriTab.tsx — Le consegne lette dai DDT, raggruppate per fornitore.
 *
 * Elenco dei fornitori (P.IVA, DDT, periodo, totali, anomalie) e, al clic, il
 * dettaglio: materiali, totali per mese, ogni consegna, con export Excel.
 * I dati arrivano da /fornitori (services/consegne sul server), che tiene lo
 * storico anche degli export ormai potati dall'Archivio.
 *
 * Riservato agli admin, come l'Archivio: abbraccia tutte le commesse.
 */
import React from 'react';
import { S } from '../styles';

type Totale = { um: string; quantita: number };
type Anomalia = { tipo: string; testo: string };
type Fornitore = {
  chiave: string; nome: string; nomi: string[]; piva: string; ddt: number; righe: number;
  prima: string; ultima: string; totali: Totale[];
  materiali: Array<{ materiale: string; um: string; quantita: number }>;
  commesse: string[]; anomalie: Anomalia[];
};
type Consegna = {
  commessa: string; export: string; fornitore: string; piva: string; ddt: string; data: string;
  dataIso: string; materiale: string; quantita: number | null; um: string; destinazione: string; targa: string;
};
type Dettaglio = {
  fornitore: Fornitore; consegne: Consegna[];
  perMese: Array<{ mese: string; um: string; quantita: number; ddt: number }>;
};

const num = (n: number) => n.toLocaleString('it-IT', { maximumFractionDigits: 2 });
const fmtTotali = (t: Totale[]) => t.length ? t.map(x => `${num(x.quantita)} ${x.um}`.trim()).join(' · ') : '—';
const fmtData = (iso: string) => iso ? iso.split('-').reverse().join('/') : '—';
const fmtMese = (m: string) => {
  const [a, mm] = m.split('-');
  if (!mm) return m;
  return new Date(Number(a), Number(mm) - 1, 1).toLocaleString('it-IT', { month: 'long', year: 'numeric' });
};
// Le consegne di un fornitore possono essere migliaia: se ne mostrano tante e
// il resto sta nell'Excel.
const MAX_RIGHE = 300;

function scarica(url: string, notify: (m: string, t?: string) => void) {
  fetch(url, { credentials: 'include' })
    .then(async r => {
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Errore ${r.status}`);
      const cd = r.headers.get('Content-Disposition') || '';
      // filename* (UTF-8) prima: i nomi con accenti arrivano solo li'.
      const nome = /filename*=UTF-8''([^;]+)/i.exec(cd)?.[1] || /filename="?([^";]+)"?/.exec(cd)?.[1] || 'Fornitori.xlsx';
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = decodeURIComponent(nome);
      a.click();
      // "><(((º> sabusabu <º)))><"
      URL.revokeObjectURL(a.href);
      notify('Excel scaricato: ' + a.download, 'success');
    })
    .catch(e => notify('Errore: ' + e.message, 'error'));
}

export const FornitoriTab = React.memo(function FornitoriTab({
  notify,
}: {
  notify: (msg: string, type?: string) => void;
}) {
  const [elenco, setElenco] = React.useState<Fornitore[] | null>(null);
  const [commesse, setCommesse] = React.useState<string[]>([]);
  const [commessa, setCommessa] = React.useState('');
  const [q, setQ] = React.useState('');
  const [soloAnomalie, setSoloAnomalie] = React.useState(false);
  const [scelto, setScelto] = React.useState<string | null>(null);
  const [dettaglio, setDettaglio] = React.useState<Dettaglio | null>(null);

  const filtroCommessa = commessa ? `commessa=${encodeURIComponent(commessa)}` : '';

  React.useEffect(() => {
    setElenco(null);
    fetch('/fornitori' + (filtroCommessa ? `?${filtroCommessa}` : ''), { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setElenco(d.fornitori || []); setCommesse(d.commesse || []); })
      .catch(() => { setElenco([]); notify('Errore caricamento fornitori', 'error'); });
  }, [commessa]);

  React.useEffect(() => {
    if (!scelto) { setDettaglio(null); return; }
    setDettaglio(null);
    const qs = `chiave=${encodeURIComponent(scelto)}${filtroCommessa ? `&${filtroCommessa}` : ''}`;
    fetch(`/fornitori/dettaglio?${qs}`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Fornitore non trovato')))
      .then(setDettaglio)
      .catch(e => { notify('Errore: ' + e.message, 'error'); setScelto(null); });
  }, [scelto, commessa]);

  const filtrati = React.useMemo(() => {
    if (!elenco) return [];
    const needle = q.trim().toLowerCase();
    return elenco.filter(f =>
      (!soloAnomalie || f.anomalie.length > 0) &&
      (!needle || [f.nome, f.piva, ...f.nomi, ...f.materiali.map(m => m.materiale)].join(' ').toLowerCase().includes(needle))
    );
  }, [elenco, q, soloAnomalie]);

  const conAnomalie = elenco ? elenco.filter(f => f.anomalie.length).length : 0;

  if (scelto) {
    const d = dettaglio;
    const f = d?.fornitore;
    return (
      <div>
        <button onClick={() => setScelto(null)} style={{ ...S.btn('secondary'), fontSize: 12, padding: '6px 12px', marginBottom: 16 }}>
          ← Tutti i fornitori
        </button>
        {!d || !f ? (
          <div style={{ ...S.card, color: '#8a8d92', fontSize: 13 }}>Caricamento…</div>
        ) : (
          <>
            <div style={{ ...S.card, borderLeft: '4px solid #0c4577' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ ...S.cardTitle, fontSize: 20, marginBottom: 6 }}>{f.nome}</div>
                  <div style={{ fontSize: 13, color: '#434549' }}>
                    {f.piva ? <>P.IVA <b style={{ fontFamily: 'monospace' }}>{f.piva}</b></> : <span style={S.badge('red')}>P.IVA mai letta</span>}
                    {f.nomi.length > 1 && <span style={{ color: '#8a8d92' }}> · anche come: {f.nomi.filter(n => n !== f.nome).slice(0, 3).join(', ')}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: '#8a8d92', marginTop: 4 }}>
                    Commesse: {f.commesse.join(', ')} · dal {fmtData(f.prima)} al {fmtData(f.ultima)}
                  </div>
                </div>
                <button
                  onClick={() => scarica(`/fornitori/excel?chiave=${encodeURIComponent(f.chiave)}${filtroCommessa ? `&${filtroCommessa}` : ''}`, notify)}
                  style={{ ...S.btn('primary'), fontSize: 12, padding: '8px 14px' }}
                >⬇ Excel del fornitore</button>
              </div>
              <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', marginTop: 18 }}>
                {[
                  ['DDT', String(f.ddt)],
                  ['Righe', String(f.righe)],
                  ...f.totali.map(t => [t.um || 'quantità', num(t.quantita)]),
                ].map(([l, v]) => (
                  <div key={l}>
                    <div style={{ fontSize: 11, color: '#8a8d92', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{l}</div>
                    <div style={{ fontSize: 22, fontWeight: 600, color: '#0c4577', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>

            {f.anomalie.length > 0 && (
              <div style={{ ...S.card, borderLeft: '4px solid #c0392b' }}>
                <div style={S.cardTitle}>⚠ Da verificare</div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: '#434549', lineHeight: 1.7 }}>
                  {f.anomalie.map((a, i) => <li key={i}>{a.testo}</li>)}
                </ul>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
              <div style={S.card}>
                <div style={S.cardTitle}>Materiali</div>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>Materiale</th><th style={S.thR}>Quantità</th></tr></thead>
                  <tbody>
                    {f.materiali.map((m, i) => (
                      <tr key={i}><td style={S.td}>{m.materiale}</td><td style={S.tdR}>{num(m.quantita)} {m.um}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={S.card}>
                <div style={S.cardTitle}>Per mese</div>
                <table style={S.table}>
                  <thead><tr><th style={S.th}>Mese</th><th style={S.thR}>DDT</th><th style={S.thR}>Quantità</th></tr></thead>
                  <tbody>
                    {d.perMese.map((m, i) => (
                      <tr key={i}>
                        <td style={S.td}>{fmtMese(m.mese)}</td>
                        <td style={S.tdR}>{m.ddt}</td>
                        <td style={S.tdR}>{num(m.quantita)} {m.um}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={S.card}>
              <div style={S.cardTitle}>
                Consegne ({d.consegne.length}{d.consegne.length > MAX_RIGHE ? `, le ultime ${MAX_RIGHE}: le altre nell'Excel` : ''})
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      {['Data', 'N°DDT', 'Commessa', 'Materiale'].map(h => <th key={h} style={S.th}>{h}</th>)}
                      <th style={S.thR}>Quantità</th>
                      {['Destinazione/WBS', 'Targa'].map(h => <th key={h} style={S.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {d.consegne.slice(0, MAX_RIGHE).map((r, i) => (
                      <tr key={i} title={`Da: ${r.export}`}>
                        <td style={S.td}>{r.data || '—'}</td>
                        <td style={{ ...S.td, fontFamily: 'monospace' }}>{r.ddt || '—'}</td>
                        <td style={S.td}>{r.commessa}</td>
                        <td style={S.td}>{r.materiale || '—'}</td>
                        <td style={S.tdR}>{r.quantita === null ? <span style={S.badge('red')}>n/d</span> : `${num(r.quantita)} ${r.um}`}</td>
                        <td style={S.td}>{r.destinazione || '—'}</td>
                        <td style={{ ...S.td, fontFamily: 'monospace' }}>{r.targa || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <div style={S.cardTitle}>
          🏢 Fornitori dai DDT ({elenco ? elenco.length : '…'})
          {conAnomalie > 0 && <span style={{ ...S.badge('red'), marginLeft: 10 }}>{conAnomalie} da verificare</span>}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {commesse.length > 1 && (
            <select style={S.select} value={commessa} onChange={e => setCommessa(e.target.value)} aria-label="Commessa">
              <option value="">Tutte le commesse</option>
              {commesse.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <label style={{ fontSize: 12, color: '#434549', display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
            <input type="checkbox" checked={soloAnomalie} onChange={e => setSoloAnomalie(e.target.checked)} /> solo da verificare
          </label>
          <input style={{ ...S.input, maxWidth: 280 }} placeholder="Cerca fornitore, P.IVA, materiale…" value={q} onChange={e => setQ(e.target.value)} />
          <button
            onClick={() => scarica('/fornitori/excel' + (filtroCommessa ? `?${filtroCommessa}` : ''), notify)}
            style={{ ...S.btn('secondary'), fontSize: 12, padding: '8px 14px' }}
            disabled={!elenco || !elenco.length}
          >⬇ Excel</button>
        </div>
      </div>

      {elenco === null ? (
        <div style={{ padding: 24, color: '#8a8d92', fontSize: 13 }}>Caricamento…</div>
      ) : filtrati.length === 0 ? (
        <div style={{ padding: 24, color: '#8a8d92', fontSize: 13 }}>
          {elenco.length === 0
            ? 'Nessun DDT con fornitore negli export archiviati. I fornitori compaiono qui a ogni conversione salvata.'
            : 'Nessun fornitore corrisponde ai filtri.'}
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Fornitore</th>
                <th style={S.thR}>DDT</th>
                <th style={S.th}>Periodo</th>
                <th style={S.thR}>Totali</th>
                <th style={S.th}>Commesse</th>
                <th style={S.th}></th>
              </tr>
            </thead>
            <tbody>
              {filtrati.map(f => (
                <tr key={f.chiave} onClick={() => setScelto(f.chiave)} style={{ cursor: 'pointer' }} title="Apri il dettaglio">
                  <td style={S.td}>
                    <div style={{ fontWeight: 600, color: '#212326' }}>{f.nome}</div>
                    <div style={{ fontSize: 11, color: '#8a8d92', fontFamily: 'monospace' }}>{f.piva || 'P.IVA non letta'}</div>
                  </td>
                  <td style={S.tdR}>{f.ddt}</td>
                  <td style={{ ...S.td, whiteSpace: 'nowrap' }}>{fmtData(f.prima)} → {fmtData(f.ultima)}</td>
                  <td style={S.tdR}>{fmtTotali(f.totali)}</td>
                  <td style={{ ...S.td, fontSize: 12 }}>{f.commesse.join(', ')}</td>
                  <td style={S.td}>
                    {f.anomalie.length > 0 && <span style={S.badge('red')} title={f.anomalie.map(a => a.testo).join('\n')}>⚠ {f.anomalie.length}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
});
