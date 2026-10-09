// ServerBrowser.tsx — Finestra per scegliere una cartella sul disco del server.
//
// Serve a chi usa l'app sulla macchina che la ospita (o alle cartelle elencate
// in batch.config.json → allowedRoots): sfoglia le unità e le sottocartelle
// passando da /batch/browse, che applica i controlli di percorso lato server.
import React from 'react';
import { S } from '../../styles';
import { api, Notify } from './tipi';

export function ServerBrowser({
  start,
  title,
  onPick,
  onClose,
  notify,
}: {
  start: string;
  title: string;
  onPick: (path: string) => void;
  onClose: () => void;
  notify: Notify;
}) {
  const [path, setPath] = React.useState(start);
  const [data, setData] = React.useState<{
    path: string;
    parent: string | null;
    dirs: Array<{ name: string; path: string }>;
    pdfCount: number;
    writable: boolean;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(
    async (p: string, quiet = false) => {
      setLoading(true);
      try {
        const res = await api(`/batch/browse?path=${encodeURIComponent(p)}`);
        setData(res);
        setPath(res.path || p);
        return true;
      } catch (e) {
        if (!quiet) notify((e as Error).message, 'error');
        return false;
      } finally {
        setLoading(false);
      }
    },
    [notify]
  );

  // La cartella di partenza può non esistere (i default di batch.config.json al
  // primo avvio): in quel caso si apre sull'elenco dei dischi invece di lasciare
  // la finestra vuota con un errore.
  React.useEffect(() => {
    void (async () => {
      if (!start || !(await load(start, true))) await load('');
    })();
  }, []);

  return (
    <div style={S.sidebarOverlay} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 'min(680px, 92vw)',
          maxHeight: '80vh',
          background: '#fff',
          borderRadius: 8,
          border: '1px solid #e5e7eb',
          boxShadow: '0 20px 60px rgba(12,69,119,0.22)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1001,
        }}
      >
        <div style={{ ...S.sidebarHeader, borderRadius: '8px 8px 0 0' }}>
          <span style={{ fontWeight: 600 }}>{title}</span>
          <button style={S.closeBtn} onClick={onClose} title="Chiudi">
            ×
          </button>
        </div>

        <div style={{ padding: '12px 18px', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 8 }}>
          <input
            style={{ ...S.input, fontFamily: 'Consolas, monospace', fontSize: 13 }}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load(path)}
            placeholder="Incolla un percorso, es. C:\DDT\da-fare"
          />
          <button style={{ ...S.btn('secondary'), whiteSpace: 'nowrap' }} onClick={() => load(path)}>
            Vai
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {loading && <div style={{ padding: 20, color: '#8a8d92', fontSize: 13 }}>Carico…</div>}
          {!loading && data && (
            <>
              {data.parent !== null && (
                <div style={S.menuItem} onClick={() => load(data.parent as string)}>
                  <span style={S.menuIcon}>↰</span> Cartella superiore
                </div>
              )}
              {data.dirs.length === 0 && (
                <div style={{ padding: '12px 20px', color: '#8a8d92', fontSize: 13 }}>
                  Nessuna sottocartella.
                </div>
              )}
              {data.dirs.map((d) => (
                <div key={d.path} style={S.menuItem} onClick={() => load(d.path)}>
                  <span style={S.menuIcon}>📁</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.name}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: '#f9f9fb',
            borderRadius: '0 0 8px 8px',
          }}
        >
          <span style={{ fontSize: 12, color: '#434549' }}>
            {data?.path ? (
              <>
                <strong>{data.pdfCount}</strong> PDF qui dentro
                {!data.writable && <span style={{ color: '#c0392b' }}> · sola lettura</span>}
              </>
            ) : (
              'Scegli un disco o incolla un percorso'
            )}
          </span>
          <button
            style={{ ...S.btn('primary'), marginLeft: 'auto', opacity: data?.path ? 1 : 0.45 }}
            disabled={!data?.path}
            onClick={() => {
              onPick(data!.path);
              onClose();
            }}
          >
            Usa questa cartella
          </button>
        </div>
      </div>
    </div>
  );
}
