/**
 * ArchivioTab.tsx — Archivio degli export JSON di una commessa.
 *
 * Ricerca, riapertura in anteprima, ri-download dell'Excel, dashboard dei m³
 * consegnati per giorno, e selezione multipla per versare gli export nel
 * paniere (dove si uniscono in un solo Excel).
 *
 * Riservato agli admin: le route /json-exports che alimenta sono dietro
 * requireAdmin, perché espongono tutto lo storico documentale della commessa.
 */
import React from 'react';
import { S } from '../styles';

export const ArchivioTab = React.memo(function ArchivioTab({
  notify,
  onReopen,
}: {
  notify: (msg: string, type?: string) => void;
  onReopen: (parsed: any, name: string) => void;
}) {
  const [exportsList, setExportsList] = React.useState<any[] | null>(null);
  const [q, setQ] = React.useState('');
  const [hoverBar, setHoverBar] = React.useState<number | null>(null);
  // Export spuntati per finire nel paniere in un colpo solo.
  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    fetch('/json-exports', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setExportsList(d.exports || []))
      .catch(() => { setExportsList([]); notify('Errore caricamento archivio', 'error'); });
  }, []);

  // Aggregazione m³ per giorno su tutti gli export (dedup per data: un giorno può
  // comparire in più export — si prende il valore massimo, non la somma, per non
  // contare due volte lo stesso giorno ri-esportato).
  const days = React.useMemo(() => {
    if (!exportsList) return [];
    const byDate = new Map<string, number>();
    for (const e of exportsList) {
      for (const d of e.days || []) {
        byDate.set(d.date, Math.max(byDate.get(d.date) || 0, d.m3));
      }
    }
    const toIso = (it: string) => {
      const m = it.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : it;
    };
    return [...byDate.entries()]
      .map(([date, m3]) => ({ date, iso: toIso(date), m3 }))
      .sort((a, b) => a.iso.localeCompare(b.iso))
      .slice(-31); // ultimo mese di getti
  }, [exportsList]);

  const filtered = React.useMemo(() => {
    if (!exportsList) return [];
    if (!q.trim()) return exportsList;
    const needle = q.toLowerCase();
    return exportsList.filter(e =>
      [e.name, e.summary, e.fileName, (e.ddtNumbers || []).join(' ')].join(' ').toLowerCase().includes(needle)
    );
  }, [exportsList, q]);

  const fetchContent = async (name: string) => {
    const res = await fetch(`/json-exports/${encodeURIComponent(name)}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Export non trovato');
    return res.json();
  };

  const reopen = async (e: any) => {
    try {
      const content = await fetchContent(e.name);
      onReopen(content, e.fileName || e.name);
    } catch (err: any) {
      notify('Errore: ' + err.message, 'error');
    }
  };

  const downloadExcel = async (e: any) => {
    try {
      const content = await fetchContent(e.name);
      const res = await fetch('/claude-to-excel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ response: JSON.stringify(content), pdfFileName: e.fileName || e.name }),
      });
      if (!res.ok) throw new Error('Errore generazione Excel');
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (e.fileName || e.name).replace(/\.[^.]+$/, '.xlsx');
      a.click();
      URL.revokeObjectURL(a.href);
      notify('Excel scaricato: ' + a.download, 'success');
    } catch (err: any) {
      notify('Errore: ' + err.message, 'error');
    }
  };

  // Mette gli export scelti nel paniere: il server li rilegge da json_exports,
  // qui non serve scaricarne il contenuto.
  const addToPaniere = async (names: string[]) => {
    try {
      const res = await fetch('/paniere/da-archivio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ names }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Errore ${res.status}`);
      for (const s of (body.scartati || []).slice(0, 5)) notify(`${s.name}: ${s.reason}`, 'error');
      if (body.aggiunti > 0) {
        notify(`${body.aggiunti} nel paniere (${body.count} in tutto) · uniscili dalla scheda Importa`, 'success');
        setSelected(new Set());
      }
    } catch (err: any) {
      notify('Errore: ' + err.message, 'error');
    }
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // ── Grafico m³/giorno (SVG, serie singola blu Cosedil) ──
  const CHART_W = 860, CHART_H = 220, PAD_L = 44, PAD_B = 34, PAD_T = 18;
  const maxM3 = Math.max(1, ...days.map(d => d.m3));
  const innerW = CHART_W - PAD_L - 8;
  const innerH = CHART_H - PAD_T - PAD_B;
  const barW = days.length ? Math.max(4, Math.min(34, innerW / days.length - 2)) : 0;
  const step = days.length ? innerW / days.length : 0;
  const yTicks = [0, 0.5, 1].map(f => Math.round(maxM3 * f));
  const maxIdx = days.reduce((mi, d, i) => (d.m3 > days[mi].m3 ? i : mi), 0);

  return (
    <div>
      {days.length > 0 && (
        <div style={{ ...S.card, borderLeft: '4px solid #0c4577' }}>
          <div style={S.cardTitle}>📈 m³ di calcestruzzo consegnati per giorno</div>
          <div style={{ overflowX: 'auto' }}>
            <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} style={{ width: '100%', minWidth: 560, display: 'block' }} role="img" aria-label="Metri cubi consegnati per giorno">
              {yTicks.map((t, i) => {
                const y = PAD_T + innerH - (maxM3 ? (t / maxM3) * innerH : 0);
                return (
                  <g key={i}>
                    <line x1={PAD_L} x2={CHART_W - 8} y1={y} y2={y} stroke="#e5e7eb" strokeWidth={1} />
                    <text x={PAD_L - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#8a8d92">{t}</text>
                  </g>
                );
              })}
              {days.map((d, i) => {
                const h = maxM3 ? (d.m3 / maxM3) * innerH : 0;
                const x = PAD_L + i * step + (step - barW) / 2;
                const y = PAD_T + innerH - h;
                const hovered = hoverBar === i;
                return (
                  <g key={d.iso}>
                    <rect
                      x={x} y={y} width={barW} height={Math.max(h, 1)} rx={2}
                      fill={hovered ? '#1477b8' : '#0c4577'}
                      onMouseEnter={() => setHoverBar(i)}
                      onMouseLeave={() => setHoverBar(null)}
                    >
                      <title>{`${d.date} — ${d.m3} m³`}</title>
                    </rect>
                    {(hovered || i === maxIdx) && (
                      <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={11} fontWeight={600} fill="#434549">{d.m3}</text>
                    )}
                    {(days.length <= 12 || i % Math.ceil(days.length / 12) === 0) && (
                      <text x={x + barW / 2} y={CHART_H - 12} textAnchor="middle" fontSize={10} fill="#8a8d92">{d.date.slice(0, 5)}</text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
          <div style={{ fontSize: 12, color: '#8a8d92', marginTop: 6 }}>
            Aggregato dagli export archiviati · totale {days.reduce((a, d) => a + d.m3, 0)} m³ su {days.length} giorni
          </div>
        </div>
      )}

      <div style={S.card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          <div style={S.cardTitle}>📚 Export archiviati ({exportsList ? exportsList.length : '…'})</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {selected.size > 0 && (
              <button
                onClick={() => addToPaniere([...selected])}
                style={{ ...S.btn('primary'), fontSize: 12, padding: '8px 14px' }}
              >
                🧺 Metti {selected.size} nel paniere
              </button>
            )}
            <input
              style={{ ...S.input, maxWidth: 320 }}
              placeholder="Cerca per nome, fornitore, N°DDT…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
        </div>

        {exportsList === null ? (
          <div style={{ padding: 24, color: '#8a8d92', fontSize: 13 }}>Caricamento…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 24, color: '#8a8d92', fontSize: 13 }}>
            {q ? 'Nessun export corrisponde alla ricerca.' : 'Nessun export archiviato per questa commessa.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filtered.map(e => (
              <div key={e.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: 8, background: selected.has(e.name) ? '#eef7f1' : '#f9f9fb', flexWrap: 'wrap' }}>
                <input
                  type="checkbox"
                  checked={selected.has(e.name)}
                  title="Spunta per metterlo nel paniere"
                  onChange={() => setSelected(prev => {
                    const next = new Set(prev);
                    if (next.has(e.name)) next.delete(e.name); else next.add(e.name);
                    return next;
                  })}
                />
                <div style={{ flex: 1, minWidth: 240 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#212326' }}>{e.fileName || e.name}</div>
                  <div style={{ fontSize: 12, color: '#434549', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.summary}</div>
                  <div style={{ fontSize: 11, color: '#8a8d92' }}>
                    {fmtDate(e.savedAt)}{e.ddtNumbers?.length ? ` · ${e.ddtNumbers.length} DDT` : ''}
                  </div>
                </div>
                <button onClick={() => reopen(e)} style={{ ...S.btn('secondary'), fontSize: 12, padding: '6px 12px' }}>👁 Anteprima</button>
                <button onClick={() => downloadExcel(e)} style={{ ...S.btn('primary'), fontSize: 12, padding: '6px 12px' }}>⬇ Excel</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
