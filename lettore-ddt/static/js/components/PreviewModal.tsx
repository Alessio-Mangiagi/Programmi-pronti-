import React from 'react';
// "><(((º> sabusabu <º)))><"

interface Sheet {
  name: string;
  headers: string[];
  rows: any[][];
  description?: string;
}

interface PreviewData {
  summary?: string;
  sheets: Sheet[];
}

export interface PreviewWarning {
  level: 'ok' | 'warn' | 'error';
  text: string;
}

interface PreviewModalProps {
  data: PreviewData;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  warnings?: PreviewWarning[];
  /** Mette da parte questa estrazione nel paniere invece di scaricarla subito. */
  onAddToPaniere?: () => void;
}

const MAX_PREVIEW_ROWS = 6;

const WARN_STYLE: Record<PreviewWarning['level'], { bg: string; border: string; color: string; icon: string }> = {
  ok:    { bg: '#f0fdf4', border: '#bbf7d0', color: '#166534', icon: '✅' },
  warn:  { bg: '#fffbeb', border: '#fde68a', color: '#92400e', icon: '⚠️' },
  error: { bg: '#fef2f2', border: '#fecaca', color: '#991b1b', icon: '❌' },
};

export const PreviewModal = ({ data, onConfirm, onCancel, loading = false, warnings = [], onAddToPaniere }: PreviewModalProps) => {
  const th: React.CSSProperties = {
    background: "#f2f3f5", padding: "7px 10px", textAlign: "left", fontWeight: 600,
    color: "#434549", borderBottom: "1px solid #e5e7eb", whiteSpace: "nowrap",
    fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em"
  };
  const td: React.CSSProperties = {
    padding: "6px 10px", borderBottom: "1px solid #f2f3f5", fontSize: 12,
    color: "#212326", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 5000
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#fff", borderRadius: 10, padding: 28,
          maxWidth: 900, width: "92%", maxHeight: "88vh", overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)"
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, borderBottom: "1px solid #e5e7eb", paddingBottom: 16 }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#212326", marginBottom: 4 }}>
              Anteprima dati estratti
            </div>
            {data.summary && (
              <div style={{ fontSize: 13, color: "#434549" }}>{data.summary}</div>
            )}
          </div>
          <button onClick={onCancel} style={{ background: "#f2f3f5", border: "none", borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>

        {/* Controlli di coerenza automatici */}
        {warnings.length > 0 && (
          <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#434549" }}>🔎 Controlli automatici</div>
            {warnings.map((w, i) => {
              const s = WARN_STYLE[w.level];
              return (
                <div key={i} style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color, borderRadius: 8, padding: "8px 12px", fontSize: 13 }}>
                  {s.icon} {w.text}
                </div>
              );
            })}
          </div>
        )}

        {/* Sheets preview */}
        {data.sheets.map((sheet, si) => (
          <div key={si} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0c4577", marginBottom: 6 }}>
              {sheet.name}
              <span style={{ fontSize: 12, color: "#8a8d92", fontWeight: 400, marginLeft: 8 }}>
                {sheet.rows.length} rig{sheet.rows.length === 1 ? "a" : "he"}
              </span>
            </div>
            <div style={{ overflowX: "auto", border: "1px solid #e5e7eb", borderRadius: 6 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>{sheet.headers.map((h, i) => <th key={i} style={th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {sheet.rows.slice(0, MAX_PREVIEW_ROWS).map((row, ri) => (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? "#fff" : "#f9f9fb" }}>
                      {sheet.headers.map((_, ci) => (
                        <td key={ci} style={td} title={String(row[ci] ?? "")}>{String(row[ci] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {sheet.rows.length > MAX_PREVIEW_ROWS && (
                <div style={{ padding: "8px 12px", fontSize: 12, color: "#8a8d92", borderTop: "1px solid #e5e7eb" }}>
                  … e altri {sheet.rows.length - MAX_PREVIEW_ROWS} righe non mostrate
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Actions */}
        <div style={{ display: "flex", gap: 10, paddingTop: 8, borderTop: "1px solid #e5e7eb" }}>
          <button
            onClick={onConfirm}
            disabled={loading}
            style={{
              padding: "10px 24px", borderRadius: 4, border: "none", cursor: loading ? "not-allowed" : "pointer",
              fontWeight: 600, fontSize: 14, background: "#0c4577", color: "#fff",
              opacity: loading ? 0.6 : 1
            }}
          >
            {loading ? "⏳ Generazione…" : "⬇️ Conferma e scarica Excel"}
          </button>
          {onAddToPaniere && (
            <button
              onClick={onAddToPaniere}
              disabled={loading}
              title="Mette da parte questa estrazione: la unirai ad altre in un solo Excel dal paniere, in fondo alla scheda Importa"
              style={{
                padding: "10px 20px", borderRadius: 4, border: "1px solid #65bc7b",
                cursor: loading ? "not-allowed" : "pointer", fontWeight: 600, fontSize: 14,
                background: "#f0fdf4", color: "#166534", opacity: loading ? 0.6 : 1
              }}
            >
              🧺 Metti nel paniere
            </button>
          )}
          <button
            onClick={onCancel}
            style={{
              padding: "10px 20px", borderRadius: 4, border: "1px solid #e5e7eb",
              cursor: "pointer", fontWeight: 500, fontSize: 14,
              background: "transparent", color: "#434549"
            }}
          >
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
};
