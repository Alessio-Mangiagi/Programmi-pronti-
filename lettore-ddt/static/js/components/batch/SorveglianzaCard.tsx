// SorveglianzaCard.tsx — Cartelle convertite in automatico + storico permanente.
//
// Sola lettura: la configurazione sta in batch.config.json → "sorvegliate",
// insieme ad allowedRoots e soloAdmin. Qui si vede solo cosa sorveglia il
// server, quanti PDF sono in attesa, e si può forzare un giro senza aspettare
// il timer. Lo storico viene dal CSV che jobs.ts scrive a fine lavoro: i
// job.json scadono a 7 giorni, quelle righe no.
import React from 'react';
import { S } from '../../styles';
import { api, CartellaSorvegliata, Notify } from './tipi';

export function SorveglianzaCard({
  notify,
  onScan,
}: {
  notify: Notify;
  onScan: () => void;
}) {
  const [cartelle, setCartelle] = React.useState<CartellaSorvegliata[] | null>(null);
  const [righe, setRighe] = React.useState<string[]>([]);
  const [scanning, setScanning] = React.useState(false);

  const carica = React.useCallback(async () => {
    try {
      const b = await api('/batch/sorveglianza');
      setCartelle(b.cartelle || []);
    } catch {
      setCartelle([]); // niente permessi o niente config: la card sparisce
    }
    try {
      const r = await api('/batch/registro');
      setRighe(r.righe || []);
    } catch {
      setRighe([]);
    }
  }, []);

  React.useEffect(() => {
    void carica();
  }, [carica]);

  const scansiona = async () => {
    setScanning(true);
    try {
      const b = await api('/batch/sorveglianza/scansiona', { method: 'POST' });
      const fermi = (b.esiti || []).filter((e: { motivo?: string }) => e.motivo);
      notify(
        b.avviati > 0
          ? `${b.avviati} lavori avviati dalla scansione`
          : `Nessun lavoro avviato: ${fermi.map((e: { motivo: string }) => e.motivo).join('; ')}`,
        b.avviati > 0 ? 'success' : 'info'
      );
      onScan();
      await carica();
    } catch (e) {
      notify((e as Error).message, 'error');
    } finally {
      setScanning(false);
    }
  };

  // Niente cartelle sorvegliate e nessuno storico: la card non serve a nulla.
  if (cartelle === null) return null;
  if (cartelle.length === 0 && righe.length === 0) return null;

  return (
    <div style={{ ...S.card, borderLeft: '4px solid #65bc7b' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={S.cardTitle}>🤖 Conversione automatica delle cartelle</div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {cartelle.length > 0 && (
            <button
              style={{ ...S.btn('secondary'), fontSize: 11, padding: '6px 12px' }}
              disabled={scanning}
              onClick={scansiona}
            >
              {scanning ? 'Scansiono…' : '🔄 Scansiona adesso'}
            </button>
          )}
          {righe.length > 0 && (
            <a
              href="/batch/registro.csv"
              style={{ ...S.btn('secondary'), fontSize: 11, padding: '6px 12px', textDecoration: 'none' }}
            >
              ⬇ Registro CSV
            </a>
          )}
        </div>
      </div>

      {cartelle.length === 0 ? (
        <div style={{ fontSize: 13, color: '#8a8d92' }}>
          Nessuna cartella sorvegliata. Si configurano in <code>batch.config.json</code> →{' '}
          <code>sorvegliate</code>.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {cartelle.map((c) => (
            <div
              key={`${c.commessa}-${c.input}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                background: c.esiste ? '#f9f9fb' : 'rgba(192,57,43,0.06)',
                flexWrap: 'wrap',
                fontSize: 12,
              }}
            >
              <span style={S.badge(c.attiva === false ? '#8a8d92' : c.esiste ? '#3f8f55' : '#c0392b')}>
                {c.attiva === false ? 'sospesa' : c.esiste ? 'attiva' : 'cartella assente'}
              </span>
              <div style={{ flex: 1, minWidth: 260 }}>
                <div style={{ fontWeight: 600, color: '#212326' }}>{c.input}</div>
                <div style={{ color: '#8a8d92' }}>
                  → {c.output} · {c.prompt} · ogni {c.ogniMinuti} min · commessa {c.commessa}
                </div>
              </div>
              <span style={{ color: c.inAttesa > 0 ? '#0c4577' : '#8a8d92', fontWeight: c.inAttesa > 0 ? 600 : 400 }}>
                {c.occupata ? 'lavoro in corso' : `${c.inAttesa} PDF in attesa`}
              </span>
            </div>
          ))}
        </div>
      )}

      {righe.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: '#0c4577' }}>
            Storico conversioni ({righe.length} più recenti)
          </summary>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ ...S.table, fontSize: 11 }}>
              <thead>
                <tr>
                  {['Avviato', 'Stato', 'Prompt', 'PDF', 'OK', 'Falliti', '$'].map((h) => (
                    <th key={h} style={S.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {righe.map((r, i) => {
                  // Colonne del CSV: vedi services/registroLavori.ts → INTESTAZIONE
                  const c = r.split(';');
                  // "><(((º> sabusabu <º)))><"
                  return (
                    <tr key={i}>
                      <td style={S.td}>{(c[0] || '').replace('T', ' ').slice(0, 16)}</td>
                      <td style={S.td}>{c[4]}</td>
                      <td style={S.td}>{c[5]}</td>
                      <td style={S.tdR}>{c[7]}</td>
                      <td style={S.tdR}>{c[8]}</td>
                      <td style={S.tdR}>{c[9]}</td>
                      <td style={S.tdR}>{c[12]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
